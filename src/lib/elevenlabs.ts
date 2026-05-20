/**
 * ElevenLabs TTS integration for APEX Voice Coach
 * Voice: "Adam" — professional, energetic coaching voice
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

import { getSelectedCoachVoiceId } from '@/lib/coachVoice';
import { env } from '@/lib/env';

const DEFAULT_VOICE_ID = '5Aez7JD323lKZNUXqJ5O'; // Marcus fallback
const EL_BASE = 'https://api.elevenlabs.io/v1';

function getAudioUploadMetadata(uri: string) {
  const extensionMatch = uri.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? 'm4a';

  switch (extension) {
    case 'caf':
      return {
        name: 'apex-workout-question.caf',
        type: 'audio/x-caf',
      };
    case 'wav':
      return {
        name: 'apex-workout-question.wav',
        type: 'audio/wav',
      };
    case 'mp3':
      return {
        name: 'apex-workout-question.mp3',
        type: 'audio/mpeg',
      };
    case 'mp4':
    case 'm4a':
    default:
      return {
        name: 'apex-workout-question.m4a',
        type: 'audio/mp4',
      };
  }
}

function normalizeSpeechText(text: string, maxSentences = 2) {
  const cleaned = text
    .replace(/^\s*-\s+/gm, '')
    .replace(/\n-\s+/g, '. ')
    .replace(/\n+/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[`#*_>]/g, '')
    .replace(/[—–]/g, ' — ')
    .replace(/\b(\d+(?:\.\d+)?)\s*kcal\b/gi, '$1 calories')
    .replace(/\b(\d+(?:\.\d+)?)\s*lbs?\b/gi, '$1 pounds')
    .replace(/\b(\d+(?:\.\d+)?)\s*g\b/gi, '$1 grams')
    .replace(/•/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return (sentences.slice(0, maxSentences).join(' ') || cleaned).trim();
}

export async function speakWithElevenLabs(
  text: string,
  apiKey: string,
  options?: { maxSentences?: number },
): Promise<void> {
  if (!apiKey) {
    console.warn('[APEX Voice] No ElevenLabs API key set.');
    return;
  }

  const voiceId = (await getSelectedCoachVoiceId()) || env.elevenLabsVoiceId || DEFAULT_VOICE_ID;
  const spokenText = normalizeSpeechText(text, options?.maxSentences ?? 2);

  const res = await fetch(`${EL_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: spokenText,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.55, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    console.warn('[APEX Voice] ElevenLabs error:', res.status, await res.text());
    return;
  }

  // Write audio to a temp file and play it
  const arrayBuf = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = Buffer.from(binary, 'binary').toString('base64');

  const path = `${FileSystem.cacheDirectory ?? ''}apex_coach_${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await Audio.setAudioModeAsync({
    playThroughEarpieceAndroid: false,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: false,
    staysActiveInBackground: false,
  });

  const { sound } = await Audio.Sound.createAsync(
    { uri: path },
    { shouldPlay: false, volume: 1.0, rate: 1.0, shouldCorrectPitch: true },
  );

  await sound.setVolumeAsync(1.0).catch(() => null);
  await sound.playAsync().catch(() => null);

  await new Promise<void>((resolve) => {
    sound.setOnPlaybackStatusUpdate((status: { isLoaded: boolean; didJustFinish?: boolean }) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => null);
        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => null);
        resolve();
      }
    });
  });
}

export async function transcribeWithElevenLabs(
  uri: string,
  apiKey: string,
): Promise<string> {
  if (!apiKey) {
    throw new Error('Missing ElevenLabs API key.');
  }

  const upload = getAudioUploadMetadata(uri);
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  form.append('language_code', 'eng');
  form.append('file', {
    uri,
    name: upload.name,
    type: upload.type,
  } as unknown as Blob);

  const res = await fetch(`${EL_BASE}/speech-to-text`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs transcription failed (${res.status})`);
  }

  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? '';
}
