import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type {
  RealtimeWorkoutToolCall,
  RealtimeWorkoutToolResult,
} from '@/lib/openaiRealtimeWorkout';

type ReactNativeWebSocketCtor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

type RealtimeSessionResponse = {
  clientSecret?: string;
  model?: string;
  session?: Record<string, unknown>;
};

type PendingTurn = {
  assistantText: string;
  reject: (error: Error) => void;
  resolve: (value: string) => void;
  waitingForFollowup: boolean;
};

type UseRealtimeWorkoutCoachArgs = {
  onToolCall: (call: RealtimeWorkoutToolCall) => Promise<RealtimeWorkoutToolResult>;
};

type ConnectInput = {
  instructions: string;
  sessionConfig?: Record<string, unknown>;
  sessionMetadata?: Record<string, unknown>;
  tools?: ReadonlyArray<unknown>;
};

function parseRealtimeMessage(data: string) {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractFunctionCall(event: Record<string, unknown>): RealtimeWorkoutToolCall | null {
  if (event.type !== 'response.output_item.done') return null;
  const item = event.item as Record<string, unknown> | undefined;
  if (!item || item.type !== 'function_call') return null;
  const rawArgs = String(item.arguments ?? '{}');
  let parsedArgs: Record<string, unknown> = {};
  try {
    parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    parsedArgs = {};
  }

  return {
    arguments: parsedArgs,
    callId: String(item.call_id ?? ''),
    name: String(item.name ?? '') as RealtimeWorkoutToolCall['name'],
  };
}

export function useRealtimeWorkoutCoach({ onToolCall }: UseRealtimeWorkoutCoachArgs) {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingTurnRef = useRef<PendingTurn | null>(null);
  const sessionInstructionsRef = useRef('');
  const sessionToolsRef = useRef<ReadonlyArray<unknown>>([]);
  const reconnectModelRef = useRef('gpt-realtime-mini');

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const cleanupSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setConnecting(false);
  }, []);

  const sendJson = useCallback((payload: Record<string, unknown>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime coach is not connected.');
    }
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  const attachSocket = useCallback((
    socket: WebSocket,
    instructions: string,
    tools: ReadonlyArray<unknown>,
    sessionConfig?: Record<string, unknown>,
  ) => {
    socket.onopen = () => {
      setConnecting(false);
      setConnected(true);
      setLastError(null);
      sendJson({
        session: {
          ...(sessionConfig ?? {}),
          instructions,
          tools,
          type: 'realtime',
        },
        type: 'session.update',
      });
    };

    socket.onerror = () => {
      setLastError('Realtime workout coach connection failed.');
    };

    socket.onclose = () => {
      setConnected(false);
      setConnecting(false);
    };

    socket.onmessage = async (message) => {
      const event = parseRealtimeMessage(String(message.data));
      if (!event) return;

      if (event.type === 'response.output_text.delta' && pendingTurnRef.current) {
        pendingTurnRef.current.assistantText += String(event.delta ?? '');
        return;
      }

      if (event.type === 'response.output_audio_transcript.delta' && pendingTurnRef.current) {
        pendingTurnRef.current.assistantText += String(event.delta ?? '');
        return;
      }

      const functionCall = extractFunctionCall(event);
      if (functionCall && pendingTurnRef.current) {
        pendingTurnRef.current.waitingForFollowup = true;
        try {
          const toolResult = await onToolCall(functionCall);
          sendJson({
            item: {
              call_id: functionCall.callId,
              output: JSON.stringify(toolResult),
              type: 'function_call_output',
            },
            type: 'conversation.item.create',
          });
          sendJson({ type: 'response.create' });
        } catch (error) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : 'The workout tool failed.';
          sendJson({
            item: {
              call_id: functionCall.callId,
              output: JSON.stringify({ message, ok: false }),
              type: 'function_call_output',
            },
            type: 'conversation.item.create',
          });
          sendJson({ type: 'response.create' });
        }
        return;
      }

      if (event.type === 'error') {
        const messageText =
          String((event.error as Record<string, unknown> | undefined)?.message ?? 'Realtime workout coach error.');
        setLastError(messageText);
        if (pendingTurnRef.current) {
          pendingTurnRef.current.reject(new Error(messageText));
          pendingTurnRef.current = null;
        }
        return;
      }

      if (event.type === 'response.done' && pendingTurnRef.current) {
        if (pendingTurnRef.current.waitingForFollowup && !pendingTurnRef.current.assistantText.trim()) {
          pendingTurnRef.current.waitingForFollowup = false;
          return;
        }
        const assistantText = pendingTurnRef.current.assistantText.trim();
        pendingTurnRef.current.resolve(assistantText);
        pendingTurnRef.current = null;
      }
    };
  }, [onToolCall, sendJson]);

  const connect = useCallback(async (input: ConnectInput) => {
    sessionInstructionsRef.current = input.instructions;
    sessionToolsRef.current = input.tools ?? [];

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendJson({
        session: {
          ...(input.sessionConfig ?? {}),
          instructions: input.instructions,
          tools: input.tools ?? [],
          type: 'realtime',
        },
        type: 'session.update',
      });
      return true;
    }

    if (connecting) {
      return false;
    }

    setConnecting(true);
    setLastError(null);

    const { data, error } = await supabase.functions.invoke('openai-realtime-session', {
      body: {
        instructions: input.instructions,
        metadata: input.sessionMetadata ?? {},
        sessionConfig: input.sessionConfig ?? {},
        tools: input.tools ?? [],
      },
    });

    if (error) {
      setConnecting(false);
      setLastError(error.message);
      return false;
    }

    const payload = (data ?? {}) as RealtimeSessionResponse;
    const clientSecret = payload.clientSecret?.trim();
    if (!clientSecret) {
      setConnecting(false);
      setLastError('Realtime client secret was empty.');
      return false;
    }

    reconnectModelRef.current = payload.model?.trim() || 'gpt-realtime-mini';

    const WebSocketWithHeaders = WebSocket as unknown as ReactNativeWebSocketCtor;
    const socket = new WebSocketWithHeaders(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(reconnectModelRef.current)}`,
      [],
      {
        headers: {
          Authorization: `Bearer ${clientSecret}`,
        },
      },
    );

    wsRef.current = socket;
    attachSocket(socket, input.instructions, input.tools ?? [], input.sessionConfig);
    return true;
  }, [attachSocket, connecting, sendJson]);

  const disconnect = useCallback(() => {
    cleanupSocket();
    if (pendingTurnRef.current) {
      pendingTurnRef.current.reject(new Error('Realtime workout coach disconnected.'));
      pendingTurnRef.current = null;
    }
  }, [cleanupSocket]);

  const ask = useCallback(async (text: string) => {
    if (!text.trim()) {
      return '';
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime workout coach is not connected.');
    }

    return new Promise<string>((resolve, reject) => {
      pendingTurnRef.current = {
        assistantText: '',
        reject,
        resolve,
        waitingForFollowup: false,
      };

      try {
        sendJson({
          item: {
            content: [{ text, type: 'input_text' }],
            role: 'user',
            type: 'message',
          },
          type: 'conversation.item.create',
        });
        sendJson({ type: 'response.create' });
      } catch (error) {
        pendingTurnRef.current = null;
        reject(error instanceof Error ? error : new Error('Could not send workout coach message.'));
      }
    });
  }, [sendJson]);

  useEffect(() => () => disconnect(), [disconnect]);

  return useMemo(
    () => ({
      ask,
      connect,
      connected,
      connecting,
      disconnect,
      lastError,
    }),
    [ask, connect, connected, connecting, disconnect, lastError],
  );
}
