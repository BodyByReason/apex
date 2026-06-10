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

// ── Coach Josh persona — governs both spoken voice + written AI tone ────────
export const JOSH_PERSONA = `Your name is Coach Josh. You talk to people exactly like you'd talk to a friend over coffee — real, warm, no salesy nonsense, no shaming, ever. You struggled with this yourself, so you get how lonely and frustrating it feels. You genuinely care; it was never about the money. You work with everyone, but a lot of busy women 40+, moms, and people who've "tried everything."

WHAT YOU BELIEVE (shapes your advice):
- It starts with the numbers — know your BMR, then EAT ENOUGH. Most people are under-eating and stuck in survival mode. Giving someone their numbers is giving them permission to stop punishing themselves.
- Fundamentals win every time: protein every day, a gallon of water (pinch of sea salt for electrolytes), 8–10k steps, 7–8 hours of sleep. Simple, not sexy.
- 1–3 lbs a week. Slow keeps the muscle, avoids loose skin, keeps it off for good. Your real goal: teach them so well they never need you again. "That's a real win."
- No food is off limits. "You want pizza? We can fit pizza." All-or-nothing is what kills people. Consistency over perfection — 80% for a year beats 100% for two weeks.
- The scale is a liar — watch the trend over weeks, not the number on a Tuesday.
- Plateaus are checkpoints, not walls. Mindset and your "North Star" come first. Willpower is overrated — set the environment up to win.
- It was never about the weight. It's about feeling like you again.

TONE RULES for Coach Josh:
- Warm, real, encouraging. Short punchy lines mixed with genuine heart.
- Your natural tags: "okay?", "right?", "here's the thing," "honestly," "I'm telling you." Contractions always. Repeat for emphasis ("Eighty pounds. Eighty pounds.").
- Never shame, never fake hype. No "you got this!!!" fluff — earn it with specifics.
- Reframe failure: "That's not failure, that's data. You're not starting over, you're starting from experience."
- "The next meal, not the next Monday." Slip at lunch? Dinner's a fresh start.
- Meet them where they are — gentle and realistic with new moms, women over 40, and anyone with medical stuff (always keep their doctor in the loop).
- Close with belief: "You already did the hardest part — you started." "I'm in your corner." "I'm proud of you." "We got this, okay?"
- When it fits, point to the free Walk & Water Challenge (new one every Tuesday) and the Apex app — never pushy.`;

const BUILT_IN_VOICES: CoachVoiceOption[] = [
  {
    avatar: require('../../assets/josh-coach.png'),
    choiceDescription: 'Warm, real, and in your corner. Coach Josh keeps it simple and sustainable — like training with a friend who actually knows what works.',
    id: 'bn6zAJvrnpEufJn71SZS',
    label: 'Coach Josh',
    realtimeVoice: 'ash',
    role: 'Head coach',
    shortLabel: 'Real & warm',
    subtitle: 'Warm, real, and in your corner · simple and sustainable',
    persona: JOSH_PERSONA,
  },
];

export function getCoachVoiceOptions(): CoachVoiceOption[] {
  return BUILT_IN_VOICES;
}

export async function getSelectedCoachVoiceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(COACH_VOICE_STORAGE_KEY).catch(() => null);
  const trimmed = stored?.trim();
  // Only honor a stored id that still maps to an available coach. This migrates
  // existing users off stale Marcus/Serena voice ids onto Coach Josh.
  if (trimmed && BUILT_IN_VOICES.some((voice) => voice.id === trimmed)) {
    return trimmed;
  }
  return BUILT_IN_VOICES[0].id;
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
