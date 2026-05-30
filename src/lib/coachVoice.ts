import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImageSourcePropType } from 'react-native';
import { DeviceEventEmitter } from 'react-native';

import { env } from '@/lib/env';

export const COACH_VOICE_STORAGE_KEY = 'apex.coach.voiceId';
export const COACH_VOICE_CHANGED_EVENT = 'apex.coach.voiceChanged';

export type CoachVoiceOption = {
  avatar: ImageSourcePropType;
  choiceDescription: string;
  shortLabel: string;
  id: string;
  label: string;
  realtimeVoice: string;
  role: string;
  subtitle: string;
  /** Injected into the AI system prompt to shape written responses when this voice is active */
  persona?: string;
};

// ── Marcus persona — governs both voice + written AI tone ──────────────────
export const MARCUS_PERSONA = `Your name is Marcus. You are a commanding, battle-tested strength and nutrition coach — think elite military discipline meeting raw athletic power. You speak with authority and weight. Every word is deliberate. You do not waste sentences.

TONE RULES for Marcus:
- Short, direct sentences. No filler. No fluff.
- Calm but intense. You never raise your voice — you don't need to. The weight of your words does it.
- You care deeply, but you show it through action and standards, not softness.
- No motivational clichés ("you got this!", "amazing job!"). Replace with specific, earned affirmations ("Good. Now do it again." / "That's how it's done." / "Progress. Lock it in.").
- When the user is slacking or making excuses, call it out directly but without cruelty: "That's not a reason. That's a choice."
- Military-style precision in workout advice. Specific, numbered, no ambiguity.
- You believe in the user completely — but they have to earn it.`;

export const SERENA_PERSONA = `Your name is Serena. You are a bright, warm, high-energy coach who feels like a best friend that also knows exactly how to train and eat for results.

TONE RULES for Serena:
- Short, upbeat, conversational replies.
- Warm and encouraging, never aggressive.
- Fun during workouts, calm and supportive at rest.
- Use clear coaching cues, but make them feel light and natural.
- No fluff and no fake hype. Keep it real, specific, and easy to follow.
- When the user struggles, reassure them and give the next practical step right away.
- You sound like someone who genuinely cares and knows what they are doing.`;

const BUILT_IN_VOICES: CoachVoiceOption[] = [
  {
    avatar: require('../../assets/marcus-coach.png'),
    choiceDescription: 'Deep, disciplined, and intense. Marcus coaches like a battle-tested strength leader who expects real effort and gives direct cues.',
    id: '5Aez7JD323lKZNUXqJ5O',
    label: 'Marcus',
    realtimeVoice: 'ash',
    role: 'Strength coach',
    shortLabel: 'Commanding',
    subtitle: 'Deep, commanding baritone · disciplined and intense',
    persona: MARCUS_PERSONA,
  },
  {
    avatar: require('../../assets/serena-coach.png'),
    choiceDescription: 'Bright, warm, and high-energy. Serena feels like a supportive performance coach who keeps things fun, clear, and encouraging.',
    id: '4kNZ9bSWRYstzUABkH8v',
    label: 'Serena',
    realtimeVoice: 'shimmer',
    role: 'Performance coach',
    shortLabel: 'Encouraging',
    subtitle: 'Bright, warm coach · upbeat and encouraging',
    persona: SERENA_PERSONA,
  },
];

export function getCoachVoiceOptions(): CoachVoiceOption[] {
  return BUILT_IN_VOICES;
}

export async function getSelectedCoachVoiceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(COACH_VOICE_STORAGE_KEY).catch(() => null);
  return stored?.trim() || BUILT_IN_VOICES[0].id;
}

export async function getSelectedCoachVoice(): Promise<CoachVoiceOption> {
  const voiceId = await getSelectedCoachVoiceId();
  return getCoachVoiceOptionById(voiceId);
}

export async function setSelectedCoachVoiceId(voiceId: string) {
  await AsyncStorage.setItem(COACH_VOICE_STORAGE_KEY, voiceId);
  DeviceEventEmitter.emit(COACH_VOICE_CHANGED_EVENT, voiceId);
}

export function getCoachVoiceOptionById(voiceId?: string | null): CoachVoiceOption {
  const options = getCoachVoiceOptions();
  return options.find((option) => option.id === voiceId) ?? options[0];
}

export function getCoachRealtimeVoiceByLabel(label?: string | null): string {
  const options = getCoachVoiceOptions();
  return options.find((option) => option.label === label)?.realtimeVoice ?? options[0].realtimeVoice;
}

/**
 * Returns the full persona system-prompt string for the currently selected coach.
 * Drop this at the START of any Anthropic system prompt to give the AI the coach's
 * voice, tone, and personality rules.
 */
export async function getCoachPersonaPrefix(): Promise<string> {
  const voice = await getSelectedCoachVoice();
  return voice.persona ? `${voice.persona}\n\n` : '';
}
