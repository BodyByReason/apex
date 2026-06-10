import { useCallback, useMemo, useRef, useState } from 'react';

import { Platform } from 'react-native';
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

type PendingConnect = {
  resolve: (connected: boolean) => void;
};

const TOOL_NAMES: RealtimeWorkoutToolName[] = [
  'log_set',
  'mark_warmup_step',
  'mark_cardio_done',
  'move_to_next_exercise',
  'set_rest_timer',
  'schedule_reminder',
  'apply_plan_adjustment',
  'update_weight',
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
  const [lastDebug, setLastDebug] = useState<string | null>(null);
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const transcriptRef = useRef('');
  const lastDebugRef = useRef<string | null>(null);
  const debugTrailRef = useRef<string[]>([]);
  const pendingConnectRef = useRef<PendingConnect | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const finishPendingConnect = useCallback((didConnect: boolean) => {
    const pending = pendingConnectRef.current;
    pendingConnectRef.current = null;
    connectTimeoutRef.current = null;
    pending?.resolve(didConnect);
  }, []);

  const pushDebug = useCallback((message: string) => {
    const trimmed = message.length > 140 ? `${message.slice(0, 137)}...` : message;
    const nextTrail = [...debugTrailRef.current, trimmed].slice(-8);
    debugTrailRef.current = nextTrail;
    const next = nextTrail.join('\n');
    lastDebugRef.current = next;
    setLastDebug(next);
  }, []);

  // Stable callbacks — useConversation must receive the same function references
  // between renders so it doesn't teardown/rebuild the session on every render.
  const onConnect = useCallback(() => {
    clearConnectTimeout();
    connectedRef.current = true;
    setConnected(true);
    setConnecting(false);
    setLastError(null);
    configureAudioRoute(getInCallManagerModule());
    finishPendingConnect(true);
  }, [clearConnectTimeout, finishPendingConnect]);

  const onDisconnect = useCallback(() => {
    clearConnectTimeout();
    connectedRef.current = false;
    setConnected(false);
    setConnecting(false);
    resetAudioRoute(getInCallManagerModule());
    finishPendingConnect(false);
  }, [clearConnectTimeout, finishPendingConnect]);

  const onMessage = useCallback((message: unknown) => {
    const msg = message as Record<string, unknown>;
    if (msg.type === 'agent_response' && typeof msg.agent_response === 'string') {
      transcriptRef.current = msg.agent_response as string;
      setAssistantTranscript(transcriptRef.current);
    }
  }, []);

  const onError = useCallback((error: unknown, context?: unknown) => {
    clearConnectTimeout();
    const message = error instanceof Error ? error.message : String(error);
    const contextMessage = (() => {
      if (!context) return null;
      if (context instanceof Error) {
        return context.stack ?? context.message;
      }
      try {
        return JSON.stringify(context, (_key, value) =>
          typeof value === 'function' ? '[function]' : value,
        );
      } catch {
        return String(context);
      }
    })();
    const fullMessage = contextMessage ? `${message}\ncontext: ${contextMessage}` : message;
    setLastError(fullMessage);
    pushDebug(`error: ${fullMessage}`);
    setConnecting(false);
    finishPendingConnect(false);
  }, [clearConnectTimeout, finishPendingConnect, pushDebug]);

  const onStatusChange = useCallback((event: { status?: string }) => {
    const status = event.status ?? 'unknown';
    pushDebug(`SDK status: ${status}`);
  }, [pushDebug]);

  const onDebug = useCallback((info: unknown) => {
    let summary = '';
    try {
      summary =
        typeof info === 'string'
          ? info
          : JSON.stringify(info, (_key, value) =>
              typeof value === 'function' ? '[function]' : value,
            );
    } catch {
      summary = String(info);
    }
    pushDebug(summary || String(info));
  }, [pushDebug]);

  const conversation = useConversation({
    clientTools,
    onDebug,
    onConnect,
    onDisconnect,
    onMessage,
    onError,
    onStatusChange,
  });

  // Store conversation in a ref so disconnect/connect don't need it in their
  // dependency arrays — avoids cascading re-creation on every render.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const disconnect = useCallback(async () => {
    clearConnectTimeout();
    connectedRef.current = false;
    try {
      await conversationRef.current.endSession();
    } catch {
      // noop
    }
    // Re-enable expo-av audio (we disabled it in connect() to free the iOS
    // session for LiveKit) so legacy TTS / sound cues work again afterward.
    try {
      await Audio.setIsEnabledAsync(true);
    } catch {
      // noop
    }
    transcriptRef.current = '';
    setAssistantTranscript('');
    setConnected(false);
    setConnecting(false);
    finishPendingConnect(false);
  }, [clearConnectTimeout, finishPendingConnect]);

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
    setLastDebug(null);
    debugTrailRef.current = [];
    pushDebug('APEX Serena OTA self-test 2026-05-31i');
    pushDebug(
      `mediaDevices.getUserMedia: ${typeof (global as any).navigator?.mediaDevices?.getUserMedia}`,
    );
    // ── Native preflight self-test ────────────────────────────────────────────
    // Probes every native method the ElevenLabs RN SDK setup strategy touches.
    // If an OTA shipped JS expecting a newer native module than this binary
    // bundles, one of these prints "undefined" — which is the exact source of
    // the "undefined is not a function" crash, identified WITHOUT connecting.
    // The volume-processor calls are the prime suspects: they are the only
    // native calls NOT covered by the livekitGlobals compat patch.
    try {
      const { AudioSession } = require('@livekit/react-native') as Record<string, any>;
      const { NativeModules } = require('react-native') as Record<string, any>;
      const nativeLiveKit = NativeModules?.LivekitReactNativeModule;
      pushDebug(`AudioSession.configureAudio: ${typeof AudioSession?.configureAudio}`);
      pushDebug(`AudioSession.startAudioSession: ${typeof AudioSession?.startAudioSession}`);
      pushDebug(`Native configureAudio: ${typeof nativeLiveKit?.configureAudio}`);
      pushDebug(`Native setAppleAudioConfiguration: ${typeof nativeLiveKit?.setAppleAudioConfiguration}`);
      pushDebug(`Native startAudioSession: ${typeof nativeLiveKit?.startAudioSession}`);
      // NOT covered by the compat patch — the SDK calls these in attachNativeVolume.
      pushDebug(`Native createVolumeProcessor: ${typeof nativeLiveKit?.createVolumeProcessor}`);
      pushDebug(`Native createMultibandVolumeProcessor: ${typeof nativeLiveKit?.createMultibandVolumeProcessor}`);
      // expo-av mic permission — workout-only path the working home hook avoids.
      pushDebug(`expo-av requestPermissionsAsync: ${typeof Audio?.requestPermissionsAsync}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushDebug(`preflight require error: ${message}`);
    }
    transcriptRef.current = '';
    setAssistantTranscript('');
    clearConnectTimeout();

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

      const connectedPromise = new Promise<boolean>((resolve) => {
        pendingConnectRef.current = { resolve };
        connectTimeoutRef.current = setTimeout(() => {
          if (connectedRef.current) return;
          const message =
            `Serena did not finish connecting. ${lastDebugRef.current ?? 'No ElevenLabs SDK status was reported.'}`;
          setLastError(message);
          setConnecting(false);
          finishPendingConnect(false);
        }, 10000);
      });

      // conversationToken selects WebRTC transport via LiveKit — no browser AudioContext needed.
      //
      // NOTE: overrides.agent.prompt is NOT supported for private (token-based) sessions —
      // the API silently rejects the session or returns an error. Workout context is passed
      // via dynamicVariables instead; the agent's dashboard prompt should reference
      // {{workout_context}} to inject it into the system instructions at runtime.
      // IMPORTANT: every key here must be declared in the ElevenLabs agent
      // dashboard (agent → Variables tab). An undeclared variable causes the
      // server to accept the WebRTC connection then close it with code 1001
      // "stream end" ~2 seconds after onConnect fires.
      //
      // The Serena agent currently declares: user_name, workout_name,
      // workout_context, kickoff_prompt. Add any new variables to the
      // dashboard BEFORE adding them here.
      // ── Hand the iOS audio session to LiveKit ────────────────────────────
      // The workout plays voice greetings/cues through expo-av (see
      // lib/elevenlabs.ts → Audio.setAudioModeAsync + Audio.Sound), which leaves
      // expo-av owning the iOS AVAudioSession. iOS then REJECTS LiveKit's
      // setActive(true) — fired inside startSession() — with "Session activation
      // failed" (confirmed on-device). Disabling expo-av audio deactivates its
      // session so LiveKit can claim it. The home-screen Serena hook works
      // without this only because the home screen never plays expo-av audio.
      // iOS ONLY: expo-av owns the AVAudioSession, and iOS rejects LiveKit's
      // setActive(true) unless we release it first. On Android this is unnecessary
      // and disabling expo-av audio mid-connect destabilises the LiveKit/WebRTC
      // setup — which is what produced the "undefined is not a function" crash on
      // Android. The working home-screen coach never does this on either platform.
      if (Platform.OS === 'ios') {
        try {
          await Audio.setIsEnabledAsync(false);
          pushDebug('expo-av audio disabled — released iOS session for LiveKit');
        } catch (audioErr) {
          const m = audioErr instanceof Error ? audioErr.message : String(audioErr);
          pushDebug(`expo-av disable failed: ${m}`);
        }
      }

      // Matches the proven-working home-screen coach: conversationToken +
      // dynamicVariables ONLY. The previous `overrides: { tts: { voiceId } }` is
      // both redundant (Coach Josh's voice is already the agent's dashboard voice)
      // and unsupported on private token-based sessions — passing it is what sent
      // the SDK down a code path that threw "undefined is not a function" during
      // connect on Android. `useWakeLock` also dropped for parity.
      await conversationRef.current.startSession({
        conversationToken,
        dynamicVariables: {
          user_name: String(input.sessionMetadata?.userName ?? 'Athlete').split(' ')[0],
          workout_name: String(input.sessionMetadata?.todayWorkout ?? ''),
          workout_context: input.workoutContext ?? '',
          kickoff_prompt: input.kickoffPrompt ?? '',
        },
      });

      return connectedPromise;
    } catch (err) {
      clearConnectTimeout();
      finishPendingConnect(false);
      // Capture the FULL stack — not just err.message. "undefined is not a
      // function" is meaningless without the frame that threw it. The top stack
      // frames name the exact native/SDK call this binary's JS expected but the
      // runtime could not resolve. Push the top frames individually (the trail
      // truncates each line) AND set lastError to the full message+stack so the
      // on-screen panel shows it on a TestFlight/OTA build with no Metro logs.
      const message = err instanceof Error ? err.message : 'ElevenLabs connection failed.';
      const stack = err instanceof Error && typeof err.stack === 'string' ? err.stack : null;
      pushDebug(`connect threw: ${message}`);
      if (stack) {
        const frames = stack
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('at '))
          .slice(0, 5);
        for (const frame of frames) {
          pushDebug(frame);
        }
      }
      setLastError(stack ? `${message}\n${stack}` : message);
      setConnecting(false);
      return false;
    }
  }, [clearConnectTimeout, finishPendingConnect]); // no `connected` dep — guarded by connectedRef instead

  // Read derived values from conversationRef so useMemo doesn't depend on the
  // unstable conversation object reference.
  const isSpeaking = conversation.isSpeaking;
  const status = conversation.status;
  const statusMessage = conversation.message;

  return useMemo(() => ({
    assistantTranscript,
    connect,
    connected,
    connecting,
    disconnect,
    isSpeaking,
    lastDebug,
    lastError,
    sendContextualUpdate,
    status,
    statusMessage,
  }), [
    assistantTranscript,
    connect,
    connected,
    connecting,
    disconnect,
    isSpeaking,
    lastDebug,
    lastError,
    sendContextualUpdate,
    status,
    statusMessage,
  ]);
}
