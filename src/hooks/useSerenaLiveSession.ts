// useSerenaLiveSession — voice session for the Serena Live prototype screen.
// Uses the same useConversation / LiveKit WebRTC architecture as Talk to Serena
// (useWorkoutElevenLabsCoach). No expo-av, no WebSocket backend, no WAV files.
//
// CRITICAL: All handlers passed to useConversation MUST use useCallback/useMemo
// so their references are stable across renders. Inline objects recreate on every
// render, causing useConversation to tear down and rebuild the session continuously,
// which produces the "connect → immediate disconnect → ping timeout" failure mode.

import { useCallback, useMemo, useRef, useState } from 'react';
import '@/lib/livekitGlobals';
import { useConversation } from '@elevenlabs/react-native';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';

export type SerenaLoggedSet = {
  exercise: string;
  reps: number;
  weight: number;
};

type ToolArgs = Record<string, unknown>;

function getInCallManager() {
  try {
    // react-native-incall-manager forces audio to speaker/headphones and keeps
    // the screen on — same as Talk to Serena uses in useWorkoutElevenLabsCoach.
    return require('react-native-incall-manager') as {
      start?: (opts?: { media?: string; auto?: boolean }) => void;
      stop?: () => void;
      setSpeakerphoneOn?: (on: boolean) => void;
      setForceSpeakerphoneOn?: (on: boolean) => void;
      setKeepScreenOn?: (on: boolean) => void;
    };
  } catch {
    return null;
  }
}

export function useSerenaLiveSession() {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [loggedSets, setLoggedSets] = useState<SerenaLoggedSet[]>([]);
  const [currentExercise, setCurrentExercise] = useState('');
  const [setNumber, setSetNumber] = useState(1);
  const [lastError, setLastError] = useState<string | null>(null);

  // Ref mirrors connected state so callbacks never need `connected` in their
  // dep arrays — same pattern as useWorkoutElevenLabsCoach to avoid the LiveKit
  // "leave request while reconnecting" race condition.
  const connectedRef = useRef(false);

  // ── Client tools ─────────────────────────────────────────────────────────────
  // MUST be wrapped in useMemo so the object reference is stable between renders.
  // Inline object literals here would cause useConversation to tear down the
  // session on every render.
  const currentExerciseRef = useRef(currentExercise);
  currentExerciseRef.current = currentExercise;

  const clientTools = useMemo(() => ({
    log_set: async (args: ToolArgs) => {
      console.log('[serena] tool: log_set', args);
      const set: SerenaLoggedSet = {
        exercise: String(args.exercise ?? currentExerciseRef.current),
        reps: Number(args.reps ?? 0),
        weight: Number(args.weight ?? 0),
      };
      setLoggedSets((prev) => [...prev, set]);
      setSetNumber((n) => n + 1);
      return { success: true };
    },

    move_to_next_exercise: async (args: ToolArgs) => {
      console.log('[serena] tool: move_to_next_exercise', args);
      const name = String(args.exercise ?? '');
      if (name) {
        setCurrentExercise(name);
        currentExerciseRef.current = name;
        setSetNumber(1);
      }
      return { success: true };
    },

    update_weight: async (args: ToolArgs) => {
      console.log('[serena] tool: update_weight', args.exercise, args.weight, 'lbs');
      return { success: true };
    },
  }), []); // empty deps — tools never need to change identity

  // ── Stable event handlers ─────────────────────────────────────────────────
  // MUST use useCallback with stable deps. Passing inline arrow functions to
  // useConversation gives it new references on every render and causes it to
  // teardown/rebuild the session continuously.

  const onConnect = useCallback(() => {
    console.log('[serena] onConnect — session established');
    connectedRef.current = true;
    setConnected(true);
    setConnecting(false);
    setLastError(null);
    const m = getInCallManager();
    try {
      m?.start?.({ media: 'audio', auto: true });
      m?.setSpeakerphoneOn?.(true);
      m?.setForceSpeakerphoneOn?.(true);
      m?.setKeepScreenOn?.(true);
    } catch {
      // noop — incall-manager is optional
    }
  }, []);

  const onDisconnect = useCallback(() => {
    console.log('[serena] onDisconnect — session ended');
    connectedRef.current = false;
    setConnected(false);
    setConnecting(false);
    const m = getInCallManager();
    try {
      m?.setForceSpeakerphoneOn?.(false);
      m?.setSpeakerphoneOn?.(false);
      m?.setKeepScreenOn?.(false);
      m?.stop?.();
    } catch {
      // noop
    }
  }, []);

  const onMessage = useCallback((message: unknown) => {
    const msg = message as Record<string, unknown>;
    if (msg.type === 'agent_response' && typeof msg.agent_response === 'string') {
      console.log('[serena] agent_response:', (msg.agent_response as string).slice(0, 80));
      setTranscript(msg.agent_response as string);
    }
  }, []);

  const onError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[serena] onError:', message);
    setLastError(message);
    setConnecting(false);
  }, []);

  // ── useConversation ───────────────────────────────────────────────────────
  // Receives stable references — will not tear down between renders.
  const conversation = useConversation({
    clientTools,
    onConnect,
    onDisconnect,
    onMessage,
    onError,
  });

  // Keep a stable ref so connect/disconnect/sendContext never need conversation
  // in their dep arrays.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  // ── connect ───────────────────────────────────────────────────────────────
  // Accepts an optional AbortSignal so the caller (SerenaProtoScreen) can cancel
  // the in-flight token fetch before startSession() is ever called. This prevents
  // React Strict Mode's double-mount from creating two simultaneous WebRTC peer
  // connections (which ElevenLabs detects as a duplicate session and terminates
  // both with code 1001 "Stream end encountered").
  //
  // The guard connectedRef.current blocks re-entry when already connected, but
  // does nothing for a second call that races the async token fetch. The signal
  // check after the fetch is the only reliable gate.

  const connect = useCallback(async (
    workoutContext: string,
    athleteName: string,
    firstExercise: string,
    signal?: AbortSignal,
  ) => {
    if (connectedRef.current) {
      console.log('[serena] connect() skipped — already connected');
      return;
    }

    console.log('[serena] connect() start — fetching token');
    setConnecting(true);
    setLastError(null);
    setCurrentExercise(firstExercise);
    currentExerciseRef.current = firstExercise;
    setSetNumber(1);

    try {
      const agentId = env.elevenLabsAgentJoshId || env.elevenLabsAgentSerenaId;
      if (!agentId) {
        throw new Error(
          'Coach Josh agent ID not configured. Set EXPO_PUBLIC_ELEVENLABS_AGENT_JOSH_ID in .env.local',
        );
      }

      // Fetch LiveKit conversation token from the Supabase edge function.
      // Uses conversationToken (WebRTC/LiveKit) not signedUrl (WebSocket) —
      // WebSocket transport requires browser AudioContext which doesn't exist
      // in React Native's Hermes runtime. The API key never touches the device.
      const { data, error } = await supabase.functions.invoke('elevenlabs-agent-token', {
        body: { agentId },
      });

      // ── Abort gate ─────────────────────────────────────────────────────────
      // React Strict Mode fires cleanup (which calls controller.abort()) almost
      // immediately after mount, well before this network request completes
      // (~100–500 ms). When the cleanup wins the race, we discard the token
      // and return without calling startSession(). The Strict Mode remount then
      // runs connect() fresh with a new un-aborted signal → one clean session.
      if (signal?.aborted) {
        console.log('[serena] connect() aborted after token fetch — discarding (Strict Mode or unmount)');
        setConnecting(false);
        return;
      }

      if (error) throw new Error(error.message);

      const payload = (data ?? {}) as Record<string, unknown>;
      const token = typeof payload.conversationToken === 'string' ? payload.conversationToken : null;

      if (!token) {
        const errMsg = typeof payload.error === 'string' ? payload.error : 'Empty conversation token';
        throw new Error(errMsg);
      }

      console.log('[serena] token received — calling startSession()');

      // ── Dynamic variables diagnostic ───────────────────────────────────────
      // IMPORTANT: Every key in dynamicVariables MUST be declared in the
      // ElevenLabs agent dashboard (Serena agent → Variables tab).
      // Sending an undeclared variable causes the server to accept the WebRTC
      // connection (onConnect fires) then immediately close the session with
      // code 1001 "Stream end" — typically ~1-2 seconds after onConnect.
      //
      // TO DIAGNOSE: If you are getting "Stream end" ~2s after onConnect,
      // temporarily comment out dynamicVariables entirely and test bare:
      //
      //   await conversationRef.current.startSession({ conversationToken: token });
      //
      // If the session stays alive, one or more variables below are not declared
      // on the dashboard. Add them there (exact same key names) then re-enable.
      //
      // Variables that MUST exist on the Serena agent dashboard:
      //   • workout_context   (type: string)
      //   • athlete_name      (type: string)
      //   • kickoff_prompt    (type: string)
      await conversationRef.current.startSession({
        conversationToken: token,
        dynamicVariables: {
          // Names must exactly match the Variables tab in the ElevenLabs agent dashboard.
          user_name: athleteName,          // agent uses {{user_name}} in first message
          workout_name: firstExercise,     // agent uses {{workout_name}} in first message
          workout_context: workoutContext, // full session context block
          kickoff_prompt: `Live workout session starting. First exercise: ${firstExercise}. ` +
            `You have a Form Review camera mode — the athlete can tap "Review my form" to enter guided rep coaching with Claude Vision. ` +
            `In that mode you receive structured vision events and must coach proactively without waiting for the athlete to speak. ` +
            `Silence during Form Review is EXPECTED — the athlete is moving. NEVER ask "Are you still there?" during Form Review. ` +
            `Greet the athlete warmly and stand by.`,
        },
      });

      console.log('[serena] startSession() resolved — waiting for onConnect');
    } catch (err) {
      // Don't surface errors caused by a deliberate abort.
      if (signal?.aborted) {
        setConnecting(false);
        return;
      }
      const message = err instanceof Error ? err.message : 'Connection failed';
      console.error('[serena] connect failed:', message);
      setLastError(message);
      setConnecting(false);
    }
  }, []);

  // ── disconnect ────────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    console.log('[serena] disconnect() called');
    connectedRef.current = false;
    try {
      await conversationRef.current.endSession();
    } catch {
      // noop
    }
    setConnected(false);
    setConnecting(false);
    setTranscript('');
  }, []);

  // ── sendContext ───────────────────────────────────────────────────────────
  // Silent context update — used for vision mode transitions and form cues.
  // Does NOT appear as a user turn in the conversation.

  const sendContext = useCallback((text: string) => {
    console.log('[serena] sendContext:', text.slice(0, 80));
    try {
      conversationRef.current.sendContextualUpdate?.(text);
    } catch {
      // noop — harmless if session isn't active
    }
  }, []);

  return useMemo(() => ({
    connect,
    disconnect,
    sendContext,
    connected,
    connecting,
    isSpeaking: conversation.isSpeaking,
    transcript,
    loggedSets,
    currentExercise,
    setNumber,
    lastError,
  }), [
    connect,
    disconnect,
    sendContext,
    connected,
    connecting,
    conversation.isSpeaking,
    transcript,
    loggedSets,
    currentExercise,
    setNumber,
    lastError,
  ]);
}
