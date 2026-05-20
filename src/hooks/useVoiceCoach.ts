/**
 * useVoiceCoach
 *
 * Manages the AI voice coach during a workout session.
 * - Reads the voice-enabled toggle from AsyncStorage
 * - Guides the user through exercises by name
 * - Enforces a 30-minute session time limit
 * - Uses ElevenLabs TTS (falls back silently if package not installed)
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { env } from '@/lib/env';
import { speakWithElevenLabs } from '@/lib/elevenlabs';

export const VOICE_COACH_KEY = 'apex.voiceCoach.enabled';
const SESSION_MAX_MS = 30 * 60 * 1000; // 30 minutes

export function useVoiceCoach() {
  const [voiceEnabled, setVoiceEnabledState] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionElapsed, setSessionElapsed] = useState(0); // seconds
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef<number>(0);

  // Load toggle from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(VOICE_COACH_KEY)
      .then((val) => setVoiceEnabledState(val === 'true'))
      .catch(() => null);
  }, []);

  const setVoiceEnabled = useCallback(async (enabled: boolean) => {
    setVoiceEnabledState(enabled);
    await AsyncStorage.setItem(VOICE_COACH_KEY, String(enabled));
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!voiceEnabled) return;
      const apiKey = env.elevenLabsApiKey ?? '';
      if (!apiKey) return;
      await speakWithElevenLabs(text, apiKey).catch(() => null);
    },
    [voiceEnabled],
  );

  const startSession = useCallback(
    async (
      workoutName: string,
      exercises: Array<{ name: string; sets: string }>,
      options?: { openingMessage?: string | null; suppressOpeningSpeech?: boolean },
    ) => {
      if (sessionActive) return;
      setSessionActive(true);
      setSessionElapsed(0);
      sessionStartRef.current = Date.now();

      // Tick every second
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - sessionStartRef.current) / 1000);
        setSessionElapsed(elapsed);
        if (elapsed >= SESSION_MAX_MS / 1000) {
          endSession();
        }
      }, 1000);

      // Opening call
      const first = exercises[0];
      const openingMessage =
        options?.openingMessage?.trim() ||
        `All right, we are starting ${workoutName}. Start with ${first.name}. Stay smooth and get into rhythm.`;
      if (!options?.suppressOpeningSpeech) {
        await speak(openingMessage);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionActive, speak],
  );

  const announceExercise = useCallback(
    async (name: string, sets: string, exerciseNum: number, total: number) => {
      if (!sessionActive) return;
      const remaining = total - exerciseNum;
      const suffix = remaining > 0 ? `After this, you have ${remaining} left.` : `This is your last one.`;
      await speak(`Next is ${name}. ${suffix}`);
    },
    [sessionActive, speak],
  );

  const announceComplete = useCallback(
    async (name: string) => {
      if (!sessionActive) return;
      await speak(`${name} is done. Good work.`);
    },
    [sessionActive, speak],
  );

  const endSession = useCallback(async (closingMessage?: string | null) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSessionActive(false);
    setSessionElapsed(0);
    await speak(closingMessage?.trim() || 'Nice work. Your session is done. Log it when you are ready.');
  }, [speak]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const sessionMinutes = Math.floor(sessionElapsed / 60);
  const sessionSeconds = sessionElapsed % 60;
  const sessionTimeStr = `${String(sessionMinutes).padStart(2, '0')}:${String(sessionSeconds).padStart(2, '0')}`;
  const sessionPct = Math.min(sessionElapsed / (SESSION_MAX_MS / 1000), 1);

  return {
    voiceEnabled,
    setVoiceEnabled,
    sessionActive,
    sessionTimeStr,
    sessionPct,
    startSession,
    announceExercise,
    announceComplete,
    endSession,
    speak,
  };
}
