// useLiveCoach — single source of truth for the live Serena WebSocket session.
// Owns: connection lifecycle, outbound message helpers, inbound state,
// and a small audio playback queue for incoming MP3 utterances.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';

// Mirrors WorkoutExercise in backend/src/types.ts — keep in sync.
export type WorkoutExercise = {
  name: string;
  sets: number;
  reps: number;
  weight: number;
};

// Set this to whatever the orchestrator is running on.
// For physical-device testing use your machine's LAN IP, not localhost.
export const SERVER_URL = 'ws://192.168.0.69:8080';

export type CoachMode = 'conversation' | 'vision';

export type WorkoutState = {
  sessionId: string;
  currentExercise: string;
  setNumber: number;
  targetReps: number;
  actualReps: number;
  weight: number;
  mode: CoachMode;
  visionSecondsRemaining: number;
};

export type LoggedSet = {
  setId: string;
  exercise: string;
  reps: number;
  weight: number;
};

type ClientStartWorkout = {
  type: 'start_workout';
  athleteId: string;
  workoutTemplateId?: string;
  exercises?: WorkoutExercise[];
};

type ServerMessage =
  | { type: 'audio_chunk'; data: string }
  | { type: 'transcript'; text: string }
  | { type: 'mode_changed'; mode: CoachMode }
  | { type: 'rep_counted'; repNumber: number }
  | { type: 'set_logged'; setId: string; exercise: string; reps: number; weight: number; formNotes: string }
  | { type: 'workout_state'; state: WorkoutState }
  | { type: 'error'; message: string };

export function useLiveCoach() {
  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const transcriptBufferRef = useRef('');

  const [isConnected, setIsConnected] = useState(false);
  const [mode, setMode] = useState<CoachMode>('conversation');
  const [workoutState, setWorkoutState] = useState<WorkoutState | null>(null);
  const [repCount, setRepCount] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [loggedSets, setLoggedSets] = useState<LoggedSet[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // isAudioPlaying: true while an MP3 clip is actively playing.
  // Used for UI indicators only — the mic loop no longer pauses on this flag
  // because iOS PlayAndRecord handles simultaneous recording and playback.
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Play queued MP3 clips one at a time.
  // Audio mode is set to PlayAndRecord ONCE in SerenaProtoScreen on mount —
  // this function never touches setAudioModeAsync so the mic keeps recording
  // while Serena speaks. isAudioPlaying is exposed for UI indicators only.
  const playNext = useCallback(async () => {
    if (playingRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) {
      setIsAudioPlaying(false);
      return;
    }

    playingRef.current = true;
    setIsAudioPlaying(true);
    console.log(`[coach:audio] playing MP3 clip (queue remaining: ${audioQueueRef.current.length})`);

    try {
      const uri = `data:audio/mpeg;base64,${next}`;
      const { sound } = await Audio.Sound.createAsync({ uri });
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          void sound.unloadAsync();
          playingRef.current = false;
          void playNext();
        }
      });
      await sound.playAsync();
    } catch (err) {
      console.warn('[coach:audio] playback error:', err instanceof Error ? err.message : err);
      playingRef.current = false;
      void playNext();
    }
  }, []);

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'audio_chunk':
          // Server sends complete MP3 utterances. Queue the clip and kick off
          // the play chain if nothing is running. No audio mode switching —
          // PlayAndRecord (set once on mount) handles mic + speaker together.
          audioQueueRef.current.push(msg.data);
          void playNext();
          break;

        case 'transcript':
          // Accumulate streaming text tokens into a complete utterance.
          // Reset on newline (which the orchestrator sends after response.text.done).
          if (msg.text === '\n') {
            transcriptBufferRef.current = '';
          } else {
            transcriptBufferRef.current += msg.text;
            setTranscript(transcriptBufferRef.current);
          }
          // Show speaking indicator and extend it on every token.
          setIsSpeaking(true);
          if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
          speakingTimerRef.current = setTimeout(() => setIsSpeaking(false), 2000);
          break;

        case 'mode_changed':
          setMode(msg.mode);
          if (msg.mode === 'vision') setRepCount(0);
          break;

        case 'rep_counted':
          setRepCount(msg.repNumber);
          break;

        case 'set_logged':
          setLoggedSets((prev) => [
            ...prev,
            { setId: msg.setId, exercise: msg.exercise, reps: msg.reps, weight: msg.weight },
          ]);
          break;

        case 'workout_state':
          setWorkoutState(msg.state);
          setMode(msg.state.mode);
          break;

        case 'error':
          setLastError(msg.message);
          break;
      }
    },
    [playNext],
  );

  const connect = useCallback(
    (serverUrl: string = SERVER_URL) => {
      if (wsRef.current) return;
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;
      ws.onopen = () => setIsConnected(true);
      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
      };
      ws.onerror = (e: unknown) => {
        const msg = e instanceof Error ? e.message : 'websocket error';
        setLastError(msg);
      };
      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as ServerMessage;
          handleMessage(parsed);
        } catch {
          // ignore malformed
        }
      };
    },
    [handleMessage],
  );

  const sendRaw = useCallback((obj: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
  }, []);

  const sendAudio = useCallback(
    (base64: string) => {
      if (!base64) return;
      console.log(`[coach:mic] sending audio chunk b64len=${base64.length} (~${Math.round(base64.length * 0.75)}B)`);
      sendRaw({ type: 'audio_chunk', data: base64 });
    },
    [sendRaw],
  );
  const sendCameraFrame = useCallback(
    (base64: string) => sendRaw({ type: 'camera_frame', data: base64 }),
    [sendRaw],
  );
  const startVisionMode = useCallback(() => sendRaw({ type: 'start_vision_mode' }), [sendRaw]);
  const endVisionMode = useCallback(() => sendRaw({ type: 'end_vision_mode' }), [sendRaw]);
  const startWorkout = useCallback(
    (athleteId: string, exercises: WorkoutExercise[]) => {
      const msg: ClientStartWorkout = { type: 'start_workout', athleteId, exercises };
      sendRaw(msg);
    },
    [sendRaw],
  );
  const endWorkout = useCallback(() => sendRaw({ type: 'end_workout' }), [sendRaw]);
  const updateRpe = useCallback((rpe: number) => sendRaw({ type: 'update_rpe', rpe }), [sendRaw]);

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    connect,
    disconnect,
    sendAudio,
    sendCameraFrame,
    startVisionMode,
    endVisionMode,
    startWorkout,
    endWorkout,
    updateRpe,
    isConnected,
    isSpeaking,
    isAudioPlaying,
    mode,
    workoutState,
    repCount,
    transcript,
    loggedSets,
    lastError,
  };
}
