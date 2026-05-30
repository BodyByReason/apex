import { useCallback, useMemo, useRef, useState } from 'react';

import { Audio } from 'expo-av';
import '@/lib/livekitGlobals';
import { useConversation } from '@elevenlabs/react-native';

import { supabase } from '@/lib/supabase';
import type {
  RealtimeWorkoutToolCall,
  RealtimeWorkoutToolResult,
  RealtimeWorkoutToolName,
} from '@/lib/openaiRealtimeWorkout';

type ConnectInput = {
  agentId: string;
  /** Full system-prompt override — injected via overrides.agent.prompt.prompt so the
   *  ElevenLabs agent receives the live workout context rather than its static dashboard prompt. */
  instructions: string;
  kickoffPrompt?: string | null;
  sessionMetadata?: Record<string, unknown>;
  /** ElevenLabs voice ID to override the agent's default voice */
  voiceId?: string | null;
  workoutContext: string;
};

type InCallManagerModule = {
  setForceSpeakerphoneOn?: (enabled: boolean) => void;
  setKeepScreenOn?: (enabled: boolean) => void;
  setSpeakerphoneOn?: (enabled: boolean) => void;
  start?: (options?: { media?: 'audio' | 'video'; auto?: boolean }) => void;
  stop?: () => void;
};

type UseWorkoutElevenLabsCoachArgs = {
  onToolCall: (call: RealtimeWorkoutToolCall) => Promise<RealtimeWorkoutToolResult>;
};

const TOOL_NAMES: RealtimeWorkoutToolName[] = [
  'log_set',
  'mark_warmup_step',
  'mark_cardio_done',
  'move_to_next_exercise',
  'set_rest_timer',
  'schedule_reminder',
  'apply_plan_adjustment',
];

function getInCallManagerModule(): InCallManagerModule | null {
  try {
    return require('react-native-incall-manager') as InCallManagerModule;
  } catch {
    return null;
  }
}

function configureAudioRoute(inCallManager: InCallManagerModule | null) {
  try {
    inCallManager?.start?.({ media: 'video', auto: true });
    inCallManager?.setSpeakerphoneOn?.(true);
    inCallManager?.setForceSpeakerphoneOn?.(true);
    inCallManager?.setKeepScreenOn?.(true);
  } catch {
    // noop
  }
}

function resetAudioRoute(inCallManager: InCallManagerModule | null) {
  try {
    inCallManager?.setForceSpeakerphoneOn?.(false);
    inCallManager?.setSpeakerphoneOn?.(false);
    inCallManager?.setKeepScreenOn?.(false);
    inCallManager?.stop?.();
  } catch {
    // noop
  }
}

async function ensureMicrophonePermission() {
  const { granted } = await Audio.requestPermissionsAsync().catch(() => ({ granted: false }));
  return granted;
}

export function useWorkoutElevenLabsCoach({ onToolCall }: UseWorkoutElevenLabsCoachArgs) {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const transcriptRef = useRef('');
  // Mirror of `connected` state kept in a ref so the `connect` callback
  // never has `connected` in its dependency array — preventing it from
  // recreating on every connection-state change, which was causing the
  // LiveKit "leave request while (re)connecting" race condition.
  const connectedRef = useRef(false);

  // Keep stable refs so callbacks passed to useConversation never change
  // identity between renders — prevents useConversation from re-initialising
  // (and firing onDisconnect) on every render, which caused an infinite loop.
  const onToolCallRef = useRef(onToolCall);
  onToolCallRef.current = onToolCall;

  // Build clientTools map — one entry per workout tool. ElevenLabs calls these
  // when the agent decides to invoke a tool, passing the parsed parameters.
  const clientTools = useMemo(() => {
    const tools: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
    for (const name of TOOL_NAMES) {
      tools[name] = async (params: Record<string, unknown>) => {
        const result = await onToolCallRef.current({
          arguments: params,
          callId: `${name}-${Date.now()}`,
          name,
        });
        return result;
      };
    }
    return tools;
  }, []);

  // Stable callbacks — useConversation must receive the same function references
  // between renders so it doesn't teardown/rebuild the session on every render.
  const onConnect = useCallback(() => {
    connectedRef.current = true;
    setConnected(true);
    setConnecting(false);
    setLastError(null);
    configureAudioRoute(getInCallManagerModule());
  }, []);

  const onDisconnect = useCallback(() => {
    connectedRef.current = false;
    setConnected(false);
    setConnecting(false);
    resetAudioRoute(getInCallManagerModule());
  }, []);

  const onMessage = useCallback((message: unknown) => {
    const msg = message as Record<string, unknown>;
    if (msg.type === 'agent_response' && typeof msg.agent_response === 'string') {
      transcriptRef.current = msg.agent_response as string;
      setAssistantTranscript(transcriptRef.current);
    }
  }, []);

  const onError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setLastError(message);
    setConnecting(false);
  }, []);

  const conversation = useConversation({
    clientTools,
    onConnect,
    onDisconnect,
    onMessage,
    onError,
  });

  // Store conversation in a ref so disconnect/connect don't need it in their
  // dependency arrays — avoids cascading re-creation on every render.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const disconnect = useCallback(async () => {
    connectedRef.current = false;
    try {
      await conversationRef.current.endSession();
    } catch {
      // noop
    }
    transcriptRef.current = '';
    setAssistantTranscript('');
    setConnected(false);
    setConnecting(false);
  }, []);

  // Send a contextual update to the agent (e.g. a closing instruction) without
  // it appearing as a user turn. Safe to call only while connected.
  const sendContextualUpdate = useCallback((text: string) => {
    try {
      conversationRef.current.sendContextualUpdate?.(text);
    } catch {
      // noop — if the session has already closed this is harmless
    }
  }, []);

  const connect = useCallback(async (input: ConnectInput) => {
    // Use the ref instead of the `connected` state value so this callback
    // never needs `connected` in its deps — keeping its identity stable
    // across renders and preventing the LiveKit leave-request race.
    if (connectedRef.current) return true;

    setConnecting(true);
    setLastError(null);
    transcriptRef.current = '';
    setAssistantTranscript('');

    try {
      const hasMicrophonePermission = await ensureMicrophonePermission();
      if (!hasMicrophonePermission) {
        throw new Error('Microphone permission is required so Serena can hear you.');
      }

      // Fetch a LiveKit conversation token from our edge function — never expose the API key client-side.
      // We use conversationToken (WebRTC/LiveKit transport) instead of signedUrl (WebSocket transport)
      // because the WebSocket path requires browser AudioContext which does not exist in React Native's
      // Hermes runtime. The WebRTC path uses LiveKit's native audio I/O and works correctly on device.
      const { data, error } = await supabase.functions.invoke('elevenlabs-agent-token', {
        body: { agentId: input.agentId },
      });

      if (error) throw new Error(error.message);

      const payload = (data ?? {}) as Record<string, unknown>;
      const conversationToken = typeof payload.conversationToken === 'string' ? payload.conversationToken : null;

      if (!conversationToken) {
        const errMsg = typeof payload.error === 'string'
          ? payload.error
          : 'ElevenLabs conversation token was empty.';
        throw new Error(errMsg);
      }

      // conversationToken selects WebRTC transport via LiveKit — no browser AudioContext needed.
      //
      // NOTE: overrides.agent.prompt is NOT supported for private (token-based) sessions —
      // the API silently rejects the session or returns an error. Workout context is passed
      // via dynamicVariables instead; the agent's dashboard prompt should reference
      // {{workout_context}} to inject it into the system instructions at runtime.
      await conversationRef.current.startSession({
        conversationToken,
        dynamicVariables: {
          user_name: String(input.sessionMetadata?.userName ?? 'Athlete').split(' ')[0],
          workout_name: String(input.sessionMetadata?.todayWorkout ?? ''),
          current_exercise: String(input.sessionMetadata?.currentExercise ?? ''),
          workout_context: input.workoutContext,
          kickoff_prompt: input.kickoffPrompt?.trim() ?? '',
        },
        // Override the agent's default voice with the user's selected coach voice.
        ...(input.voiceId ? { overrides: { tts: { voiceId: input.voiceId } } } : {}),
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ElevenLabs connection failed.';
      setLastError(message);
      setConnecting(false);
      return false;
    }
  }, []); // no `connected` dep — guarded by connectedRef instead

  // Read derived values from conversationRef so useMemo doesn't depend on the
  // unstable conversation object reference.
  const isSpeaking = conversation.isSpeaking;
  const status = conversation.status;

  return useMemo(() => ({
    assistantTranscript,
    connect,
    connected,
    connecting,
    disconnect,
    isSpeaking,
    lastError,
    sendContextualUpdate,
    status,
  }), [
    assistantTranscript,
    connect,
    connected,
    connecting,
    disconnect,
    isSpeaking,
    lastError,
    sendContextualUpdate,
    status,
  ]);
}
