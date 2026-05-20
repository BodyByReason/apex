import { useCallback, useMemo, useRef, useState } from 'react';

import Constants from 'expo-constants';
import { Audio } from 'expo-av';
import { PermissionsAndroid, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import type {
  RealtimeWorkoutToolCall,
  RealtimeWorkoutToolResult,
} from '@/lib/openaiRealtimeWorkout';

type ConnectInput = {
  instructions: string;
  kickoffPrompt?: string | null;
  sessionConfig?: Record<string, unknown>;
  sessionMetadata?: Record<string, unknown>;
  tools?: ReadonlyArray<unknown>;
};

type ReactNativeWebRTCModule = {
  RTCPeerConnection: new (config?: Record<string, unknown>) => any;
  RTCSessionDescription: new (description: { sdp: string; type: 'answer' | 'offer' }) => any;
  mediaDevices: {
    getUserMedia: (constraints: { audio: boolean; video: boolean }) => Promise<any>;
  };
};

type InCallManagerModule = {
  abandonAudioFocus?: () => Promise<unknown>;
  chooseAudioRoute?: (route: string) => Promise<unknown>;
  requestAudioFocus?: () => Promise<unknown>;
  setMicrophoneMute?: (enabled: boolean) => void;
  setForceSpeakerphoneOn?: (enabled: boolean) => void;
  setKeepScreenOn?: (enabled: boolean) => void;
  setSpeakerphoneOn?: (enabled: boolean) => void;
  start?: (options?: { media?: 'audio' | 'video'; auto?: boolean }) => void;
  stop?: () => void;
  stopProximitySensor?: () => void;
  turnScreenOn?: () => void;
};

type RealtimeSessionResponse = {
  clientSecret?: string;
  model?: string;
};

type UseWorkoutRealtimeWebRTCArgs = {
  onToolCall: (call: RealtimeWorkoutToolCall) => Promise<RealtimeWorkoutToolResult>;
};

type VoiceDebugState = {
  connectionState: string | null;
  dataChannelOpen: boolean;
  iceConnectionState: string | null;
  lastEventType: string | null;
  lastMicError: string | null;
  negotiationStage: string | null;
  responseDoneCount: number;
  responseStartedCount: number;
  sessionCreated: boolean;
  sessionUpdated: boolean;
  speechStartedCount: number;
  speechStoppedCount: number;
  toolCallCount: number;
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

function getWebRTCModule(): ReactNativeWebRTCModule | null {
  try {
    return require('@livekit/react-native-webrtc') as ReactNativeWebRTCModule;
  } catch {
    return null;
  }
}

function getInCallManagerModule(): InCallManagerModule | null {
  try {
    return require('react-native-incall-manager') as InCallManagerModule;
  } catch {
    return null;
  }
}

function configureCoachAudioRoute(inCallManager: InCallManagerModule | null) {
  try {
    // Use 'video' on both platforms. On iOS, 'audio' mode activates VoiceChat
    // processing (narrow-band EQ + echo cancellation) which distorts the coach's
    // voice so severely it sounds like a different person. 'video' mode keeps
    // wideband audio and routes to the speaker on both iOS and Android.
    inCallManager?.start?.({
      media: 'video',
      auto: true,
    });
    if (Platform.OS === 'android') {
      inCallManager?.requestAudioFocus?.().catch?.(() => null);
      inCallManager?.chooseAudioRoute?.('SPEAKER_PHONE').catch?.(() => null);
      inCallManager?.turnScreenOn?.();
      inCallManager?.stopProximitySensor?.();
    }
    inCallManager?.setMicrophoneMute?.(false);
    inCallManager?.setSpeakerphoneOn?.(true);
    inCallManager?.setForceSpeakerphoneOn?.(true);
    inCallManager?.setKeepScreenOn?.(true);
  } catch {
    // noop
  }
}

function resetCoachAudioRoute(inCallManager: InCallManagerModule | null) {
  try {
    inCallManager?.setMicrophoneMute?.(false);
    inCallManager?.setForceSpeakerphoneOn?.(false);
    inCallManager?.setSpeakerphoneOn?.(false);
    inCallManager?.setKeepScreenOn?.(false);
    if (Platform.OS === 'android') {
      inCallManager?.abandonAudioFocus?.().catch?.(() => null);
    }
    inCallManager?.stop?.();
  } catch {
    // noop
  }
}

async function ensureMicrophonePermission() {
  if (Platform.OS === 'ios') {
    const { granted } = await Audio.requestPermissionsAsync().catch(() => ({ granted: false }));
    return granted;
  }

  if (Platform.OS !== 'android') {
    return true;
  }

  const alreadyGranted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  if (alreadyGranted) {
    return true;
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone Permission',
      message: 'APEX needs microphone access so your coach can hear you during live voice workouts.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );

  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export function useWorkoutRealtimeWebRTC({ onToolCall }: UseWorkoutRealtimeWebRTCArgs) {
  const peerConnectionRef = useRef<any | null>(null);
  const dataChannelRef = useRef<any | null>(null);
  const localStreamRef = useRef<any | null>(null);
  const assistantTranscriptRef = useRef('');

  const [assistantTranscript, setAssistantTranscript] = useState('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugState, setDebugState] = useState<VoiceDebugState>({
    connectionState: null,
    dataChannelOpen: false,
    iceConnectionState: null,
    lastEventType: null,
    lastMicError: null,
    negotiationStage: null,
    responseDoneCount: 0,
    responseStartedCount: 0,
    sessionCreated: false,
    sessionUpdated: false,
    speechStartedCount: 0,
    speechStoppedCount: 0,
    toolCallCount: 0,
  });

  const isExpoGo = Constants.executionEnvironment === 'storeClient';
  const moduleAvailable = !!getWebRTCModule();
  const supported = !isExpoGo && moduleAvailable;

  const sendJson = useCallback((payload: Record<string, unknown>) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') {
      throw new Error('Workout WebRTC data channel is not open.');
    }
    channel.send(JSON.stringify(payload));
  }, []);

  const disconnect = useCallback(() => {
    const inCallManager = getInCallManagerModule();
    resetCoachAudioRoute(inCallManager);

    try {
      dataChannelRef.current?.close?.();
    } catch {
      // noop
    }
    dataChannelRef.current = null;

    try {
      peerConnectionRef.current?.close?.();
    } catch {
      // noop
    }
    peerConnectionRef.current = null;

    try {
      const tracks = localStreamRef.current?.getTracks?.() ?? [];
      tracks.forEach((track: { stop?: () => void }) => track.stop?.());
    } catch {
      // noop
    }
    localStreamRef.current = null;

    assistantTranscriptRef.current = '';
    setAssistantTranscript('');
    setConnected(false);
    setConnecting(false);
    setDebugState({
      connectionState: null,
      dataChannelOpen: false,
      iceConnectionState: null,
      lastEventType: null,
      lastMicError: null,
      negotiationStage: null,
      responseDoneCount: 0,
      responseStartedCount: 0,
      sessionCreated: false,
      sessionUpdated: false,
      speechStartedCount: 0,
      speechStoppedCount: 0,
      toolCallCount: 0,
    });
  }, []);

  const sendTextPrompt = useCallback(async (text: string) => {
    if (!text.trim()) return;
    assistantTranscriptRef.current = '';
    setAssistantTranscript('');
    sendJson({
      item: {
        content: [{ text, type: 'input_text' }],
        role: 'user',
        type: 'message',
      },
      type: 'conversation.item.create',
    });
    sendJson({ type: 'response.create' });
  }, [sendJson]);

  const connect = useCallback(async (input: ConnectInput) => {
    if (!supported) {
      setLastError(
        isExpoGo
          ? 'Live speech-to-speech needs a dev build because Expo Go does not expose the native WebRTC module.'
          : 'react-native-webrtc is not available in this build.',
      );
      return false;
    }

    if (dataChannelRef.current?.readyState === 'open' && peerConnectionRef.current) {
      return true;
    }

    setConnecting(true);
    setLastError(null);
    assistantTranscriptRef.current = '';
    setAssistantTranscript('');
    setDebugState({
      connectionState: null,
      dataChannelOpen: false,
      iceConnectionState: null,
      lastEventType: null,
      lastMicError: null,
      negotiationStage: 'requesting-client-secret',
      responseDoneCount: 0,
      responseStartedCount: 0,
      sessionCreated: false,
      sessionUpdated: false,
      speechStartedCount: 0,
      speechStoppedCount: 0,
      toolCallCount: 0,
    });

    const rtc = getWebRTCModule();
    if (!rtc) {
      setConnecting(false);
      setLastError('react-native-webrtc could not be loaded.');
      return false;
    }

    try {
      const hasMicrophonePermission = await ensureMicrophonePermission();
      if (!hasMicrophonePermission) {
        throw new Error('Microphone permission was denied.');
      }

      const { data, error } = await supabase.functions.invoke('openai-realtime-session', {
        body: {
          instructions: input.instructions,
          metadata: input.sessionMetadata ?? {},
          sessionConfig: input.sessionConfig ?? {},
          tools: input.tools ?? [],
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      const payload = (data ?? {}) as RealtimeSessionResponse & { openaiError?: string };
      // Surface the real OpenAI rejection reason when session creation fails.
      if (payload.openaiError) {
        throw new Error(`Session creation failed: ${payload.openaiError}`);
      }
      const clientSecret = payload.clientSecret?.trim();
      if (!clientSecret) {
        throw new Error('Realtime client secret was empty.');
      }

      setDebugState((current) => ({
        ...current,
        negotiationStage: 'requesting-user-media',
      }));
      const stream = await rtc.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      const audioTracks = stream.getAudioTracks?.() ?? [];
      if (!audioTracks.length) {
        setDebugState((current) => ({
          ...current,
          lastMicError: 'getUserMedia succeeded but no audio tracks were returned.',
        }));
      }

      const inCallManager = getInCallManagerModule();
      configureCoachAudioRoute(inCallManager);

      setDebugState((current) => ({
        ...current,
        negotiationStage: 'creating-peer-connection',
      }));
      const pc = new rtc.RTCPeerConnection();
      peerConnectionRef.current = pc;

      pc.onconnectionstatechange = () => {
        const state = String(pc.connectionState ?? '');
        setDebugState((current) => ({
          ...current,
          connectionState: state || null,
        }));
        if (state === 'connected') {
          setConnected(true);
          setConnecting(false);
          setLastError(null);
          return;
        }

        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          setConnected(false);
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = String(pc.iceConnectionState ?? '');
        setDebugState((current) => ({
          ...current,
          iceConnectionState: state || null,
        }));
      };

      pc.ontrack = () => {
        setConnected(true);
        setConnecting(false);
      };

      stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));

      const dataChannel = pc.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        setConnected(true);
        setConnecting(false);
        setLastError(null);
        setDebugState((current) => ({
          ...current,
          dataChannelOpen: true,
        }));

        const sessionCfg = (input.sessionConfig ?? {}) as Record<string, unknown>;
        const audioIn = ((sessionCfg.audio as Record<string, unknown> | undefined)?.input) as Record<string, unknown> | undefined;

        // voice is set at session-creation time via the edge function (passed in
        // the session payload to /v1/realtime/client_secrets). Do not include it
        // here — gpt-4o-realtime-preview rejects voice in session.update after
        // the session has already been initialised with a voice.
        sendJson({
          session: {
            instructions: input.instructions,
            tool_choice: sessionCfg.tool_choice ?? 'auto',
            tools: input.tools ?? [],
            ...(audioIn?.turn_detection != null ? { turn_detection: audioIn.turn_detection } : {}),
          },
          type: 'session.update',
        });

        if (input.kickoffPrompt?.trim()) {
          sendTextPrompt(input.kickoffPrompt.trim()).catch(() => null);
        }
      };

      dataChannel.onclose = () => {
        setConnected(false);
        setDebugState((current) => ({
          ...current,
          dataChannelOpen: false,
        }));
      };

      dataChannel.onerror = () => {
        setLastError('Workout WebRTC data channel failed.');
      };

      dataChannel.onmessage = async (message: { data: string }) => {
        const event = parseRealtimeMessage(String(message.data));
        if (!event) return;
        const eventType = String(event.type ?? 'unknown');
        setDebugState((current) => ({
          ...current,
          lastEventType: eventType,
        }));

        if (eventType === 'session.created') {
          setDebugState((current) => ({
            ...current,
            lastEventType: eventType,
            sessionCreated: true,
          }));
        }

        if (eventType === 'session.updated') {
          setDebugState((current) => ({
            ...current,
            lastEventType: eventType,
            sessionUpdated: true,
          }));
        }

        if (eventType === 'input_audio_buffer.speech_started') {
          setDebugState((current) => ({
            ...current,
            lastEventType: eventType,
            speechStartedCount: current.speechStartedCount + 1,
          }));
        }

        if (eventType === 'input_audio_buffer.speech_stopped') {
          setDebugState((current) => ({
            ...current,
            lastEventType: eventType,
            speechStoppedCount: current.speechStoppedCount + 1,
          }));
        }

        if (eventType === 'response.created') {
          setDebugState((current) => ({
            ...current,
            lastEventType: eventType,
            responseStartedCount: current.responseStartedCount + 1,
          }));
        }

        if (eventType === 'response.done') {
          setDebugState((current) => ({
            ...current,
            lastEventType: eventType,
            responseDoneCount: current.responseDoneCount + 1,
          }));
        }

        if (
          event.type === 'response.output_audio_transcript.delta' ||
          event.type === 'response.output_text.delta'
        ) {
          assistantTranscriptRef.current += String(event.delta ?? '');
          setAssistantTranscript(assistantTranscriptRef.current.trim());
          return;
        }

        const functionCall = extractFunctionCall(event);
        if (functionCall) {
          setDebugState((current) => ({
            ...current,
            toolCallCount: current.toolCallCount + 1,
          }));
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
            sendJson({
              item: {
                call_id: functionCall.callId,
                output: JSON.stringify({
                  message: error instanceof Error ? error.message : 'Workout tool failed.',
                  ok: false,
                }),
                type: 'function_call_output',
              },
              type: 'conversation.item.create',
            });
            sendJson({ type: 'response.create' });
          }
          return;
        }

        if (event.type === 'error') {
          setLastError(String((event.error as Record<string, unknown> | undefined)?.message ?? 'Realtime WebRTC error.'));
        }
      };

      setDebugState((current) => ({
        ...current,
        negotiationStage: 'creating-offer',
      }));
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      setDebugState((current) => ({
        ...current,
        negotiationStage: 'setting-local-description',
      }));
      await pc.setLocalDescription(offer);

      setDebugState((current) => ({
        ...current,
        negotiationStage: 'posting-offer',
      }));
      // /v1/realtime/sessions issues a beta client secret — the matching SDP
      // endpoint is /v1/realtime?model=... (not /v1/realtime/calls which is GA-only).
      const realtimeModel = payload.model?.trim() || 'gpt-4o-realtime-preview';
      const response = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(realtimeModel)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        },
      );

      const answerSdp = await response.text();
      if (!response.ok) {
        throw new Error(answerSdp || `Realtime WebRTC negotiation failed (${response.status}).`);
      }

      setDebugState((current) => ({
        ...current,
        negotiationStage: 'setting-remote-description',
      }));
      await pc.setRemoteDescription(
        new rtc.RTCSessionDescription({ sdp: answerSdp, type: 'answer' }),
      );

      setDebugState((current) => ({
        ...current,
        negotiationStage: 'awaiting-data-channel',
      }));

      return true;
    } catch (error) {
      disconnect();
      setLastError(error instanceof Error ? error.message : 'Workout WebRTC connection failed.');
      return false;
    }
  }, [disconnect, isExpoGo, onToolCall, sendJson, sendTextPrompt, supported]);

  return useMemo(() => ({
    assistantTranscript,
    connected,
    connect,
    connecting,
    debugState,
    disconnect,
    lastError,
    moduleAvailable,
    sendTextPrompt,
    supported,
  }), [assistantTranscript, connected, connect, connecting, debugState, disconnect, lastError, moduleAvailable, sendTextPrompt, supported]);
}
