/**
 * coachDM.ts
 *
 * Types, conversation state machine, script helpers, and persistence
 * for the Coach DM chat feature.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// ─── PDF URLs ─────────────────────────────────────────────────────────────────

export const STRONGHER_FUEL_PDF_URL =
  'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/The%20StrongHER%20Daily%20Fuel%20Blueprint/The%20StrongHER%20Daily%20Fuel%20Blueprint.pdf';

export const STRONGHER_STRENGTH_PDF_URL =
  'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/The%20StrongHER%20Daily%20Strength%20Program/The%20StrongHER%20Daily%20Strength%20Program%20.pdf';

// ─── Transformation image URLs ────────────────────────────────────────────────

const ROSE_IMAGE_URL =
  'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/coach-assets/rose-transformation.jpg';
const JOSH_IMAGE_URL =
  'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/coach-assets/josh-transformation.jpg';

// ─── Testimonial video URL (used on Coach card entry point) ──────────────────

export const MARIA_TESTIMONIAL_URL =
  'https://nitruxotcddfkxyaosiy.supabase.co/storage/v1/object/public/Maria%20Testimonial/v15044gf0000d77ar5fog65mo7tqvgtg.MP4';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DMStage =
  | 'greeting'
  | 'awaiting_diet'
  | 'social_proof'
  | 'awaiting_challenge'
  | 'day_selection'
  | 'time_selection'
  | 'phone_collection'
  | 'booked'
  | 'awaiting_resources'
  | 'reschedule_slot_selection'
  | 'rescheduled';

export type DMMessage = {
  id: string;
  role: 'coach' | 'user';
  kind: 'text' | 'image' | 'quickReplies';
  text?: string;
  imageUrl?: string;
  quickReplies?: Array<{ label: string; value: string }>;
  createdAt: number;
};

export type DMConversationState = {
  stage: DMStage;
  messages: DMMessage[];
  collected: {
    goal?: string;
    dietHabits?: string;
    biggestChallenge?: string;
    preferredDate?: string;
    preferredTime?: string;
    phone?: string;
    resourcesSent?: boolean;
  };
  gender: 'male' | 'female' | 'other';
  userName: string;
  userId: string;
  userTimezone: string;
  bookingId?: string;
  morningReminderId?: string;
  silenceNotifIds: string[];
  lastUserReplyAt?: number;
};

// ─── Persistence ──────────────────────────────────────────────────────────────

export const COACH_DM_STORAGE_KEY = '@apex.coach_dm.v1';

export async function saveConversation(state: DMConversationState): Promise<void> {
  try {
    await AsyncStorage.setItem(COACH_DM_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal — state lives in memory
  }
}

export async function loadConversation(): Promise<DMConversationState | null> {
  try {
    const raw = await AsyncStorage.getItem(COACH_DM_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DMConversationState;
  } catch {
    return null;
  }
}

export async function clearConversation(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COACH_DM_STORAGE_KEY);
  } catch {
    // Non-fatal
  }
}

/**
 * Dev/testing utility: cancel all DM-related scheduled notifications and clear
 * the conversation from AsyncStorage. Returns the bookingId so callers can
 * also delete the corresponding Supabase row.
 */
export async function resetDMFlowForTesting(): Promise<{ bookingId?: string }> {
  try {
    const state = await loadConversation();
    const bookingId = state?.bookingId;

    if (state?.silenceNotifIds?.length) {
      await cancelSilenceFollowUps(state.silenceNotifIds);
    }

    if (state?.morningReminderId) {
      await Notifications.cancelScheduledNotificationAsync(state.morningReminderId).catch(() => null);
    }

    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const dmIds = scheduled
        .filter((n) =>
          n.content.data?.type === 'coach_dm_morning_reminder' ||
          n.content.data?.type === 'coach_dm_silence',
        )
        .map((n) => n.identifier);
      for (const id of dmIds) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => null);
      }
    } catch { /* notifications may not be permitted */ }

    await clearConversation();
    return { bookingId };
  } catch {
    return {};
  }
}

// ─── Message factory ──────────────────────────────────────────────────────────

export function makeMessage(
  role: DMMessage['role'],
  kind: DMMessage['kind'],
  partial: Partial<Omit<DMMessage, 'id' | 'role' | 'kind' | 'createdAt'>>,
): DMMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    kind,
    createdAt: Date.now(),
    ...partial,
  };
}

// ─── Goal label map ───────────────────────────────────────────────────────────

const GOAL_LABELS: Record<string, string> = {
  // Full APEX goals
  lose:        'lose some weight',
  build:       'build muscle',
  recomp:      'transform your body',
  performance: 'level up your performance',
  // Walk & Water challenge goals
  lose_weight: 'lean out',
  more_energy: 'get more energy',
  build_habit: 'build better habits',
  feel_better: 'feel better every day',
};

export function goalLabel(goal: string): string {
  return GOAL_LABELS[goal] ?? goal;
}

// ─── Typing durations (ms) ────────────────────────────────────────────────────

export const TYPING_SHORT = 1800;
export const TYPING_LONG = 2800;
export const TYPING_IMAGE = 1200;

// ─── Script helpers ───────────────────────────────────────────────────────────

/** Returns the opening message for the greeting stage. */
export function greetingMessages(firstName: string, goal: string): DMMessage[] {
  return [
    makeMessage('coach', 'text', {
      text: `Hey hey ${firstName} 👋 thank you for joining the challenge! Sounds like you might want to ${goalLabel(goal)}. Am I wrong?`,
    }),
  ];
}

/** Returns the coach reply after the user responds to the greeting. */
export function greetingReplyMessage(): DMMessage {
  return makeMessage('coach', 'text', {
    text: "You got it! What does a typical day of eating & movement look like?",
  });
}

/** Returns messages for the social proof stage (text + image). */
export function socialProofMessages(gender: DMConversationState['gender']): DMMessage[] {
  const isFemale = gender === 'female';
  return [
    makeMessage('coach', 'text', {
      text: isFemale
        ? "That's a great start, super proud of you! There are a few tweaks we can already make. Not too different from Rose 👇"
        : "That's a great start, super proud of you! There are a few tweaks we can already make. Not too different from me 👇",
    }),
    makeMessage('coach', 'image', {
      imageUrl: isFemale ? ROSE_IMAGE_URL : JOSH_IMAGE_URL,
    }),
  ];
}

/** Returns the challenge question message. */
export function challengeQuestionMessage(): DMMessage {
  return makeMessage('coach', 'text', {
    text: 'What do you feel is your biggest challenge right now? Mindset, food, movements, hormones, strength, stamina, your schedule, medications, all of the above?',
  });
}

/** Returns the day selection message with time-aware copy and authentic day quick replies. */
// ─── Challenge keyword extraction ────────────────────────────────────────────

const CHALLENGE_KEYWORDS: Array<{ words: string[]; label: string }> = [
  { words: ['strength', 'strong', 'lifting', 'weights', 'muscle'], label: 'strength' },
  { words: ['stamina', 'endurance', 'cardio', 'energy', 'fatigue', 'tired'], label: 'stamina' },
  { words: ['hormone', 'hormones', 'estrogen', 'testosterone', 'thyroid'], label: 'hormones' },
  { words: ['mindset', 'motivation', 'mental', 'consistency', 'discipline'], label: 'mindset' },
  { words: ['food', 'eating', 'nutrition', 'diet', 'meal', 'meals', 'calories'], label: 'nutrition' },
  { words: ['movement', 'workout', 'workouts', 'exercise', 'training', 'walk', 'walking'], label: 'movement' },
  { words: ['schedule', 'time', 'busy', 'work', 'kids', 'family'], label: 'schedule' },
  { words: ['medication', 'medications', 'meds', 'medicine', 'prescription'], label: 'medications' },
  { words: ['weight', 'fat', 'belly', 'lose', 'losing', 'pounds', 'lbs'], label: 'weight' },
  { words: ['sleep', 'rest', 'recovery', 'recovering'], label: 'recovery' },
];

function extractChallengePhrase(text: string): string {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const { words, label } of CHALLENGE_KEYWORDS) {
    if (words.some((w) => lower.includes(w)) && !matched.includes(label)) {
      matched.push(label);
    }
  }

  if (matched.length === 0) return '';
  if (matched.length === 1) return `your ${matched[0]}`;
  if (matched.length === 2) return `your ${matched[0]} & ${matched[1]}`;
  // 3+ keywords: pick the two most specific (first two matched, de-prioritise "all of the above" cases)
  return `your ${matched[0]} & ${matched[1]}`;
}

export function daySelectionMessage(biggestChallenge?: string): DMMessage {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const formatLabel = (d: Date, prefix: string): string => {
    const day = DAY_NAMES[d.getDay()];
    const month = MONTH_NAMES[d.getMonth()];
    return `${prefix} (${day} ${month} ${d.getDate()})`;
  };

  const toDateStr = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Current hour in Arizona time (UTC-7, no DST)
  const azOffset = -7 * 60;
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const azHour = new Date(utcMs + azOffset * 60000).getHours();

  // Build a natural phrase from detected keywords; fall back to generic "you"
  const detectedPhrase = biggestChallenge ? extractChallengePhrase(biggestChallenge) : '';
  const target = detectedPhrase || 'you';
  const controlLine = detectedPhrase
    ? `sounds like we might be able to help get ${target} back in control!`
    : `sounds like we might be able to help get you back in control!`;

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const dayAfter = new Date(now);
  dayAfter.setDate(now.getDate() + 2);

  // Morning (5am–11am): "train" — offer today or tomorrow
  if (azHour >= 5 && azHour < 11) {
    return makeMessage('coach', 'quickReplies', {
      text: `Then we got this 🤜🤛 ${controlLine} Starting off small & slowly progressing. I'm about to train right now but I can make time to speak more today or tomorrow. Which is the least busy for you?`,
      quickReplies: [
        { label: formatLabel(now, 'Today'), value: toDateStr(now) },
        { label: formatLabel(tomorrow, 'Tomorrow'), value: toDateStr(tomorrow) },
      ],
    });
  }

  // Late night (10pm–5am): "head to bed" — offer tomorrow or day after
  if (azHour >= 22 || azHour < 5) {
    return makeMessage('coach', 'quickReplies', {
      text: `Then we got this 🤜🤛 ${controlLine} Starting off small & slowly progressing. I'm about to head to bed right now but I can make time to speak more tomorrow or ${formatLabel(dayAfter, '')}. Which is the least busy for you?`,
      quickReplies: [
        { label: formatLabel(tomorrow, 'Tomorrow'), value: toDateStr(tomorrow) },
        { label: formatLabel(dayAfter, ''), value: toDateStr(dayAfter) },
      ],
    });
  }

  // Afternoon/evening (11am–10pm): "cook for the kids" — offer tomorrow or day after
  return makeMessage('coach', 'quickReplies', {
    text: `Then we got this 🤜🤛 ${controlLine} Starting off small & slowly progressing. I'm about to cook for the kids right now but I can make time to speak more tomorrow or ${formatLabel(dayAfter, '')}. Which is the least busy for you?`,
    quickReplies: [
      { label: formatLabel(tomorrow, 'Tomorrow'), value: toDateStr(tomorrow) },
      { label: formatLabel(dayAfter, ''), value: toDateStr(dayAfter) },
    ],
  });
}

/** Returns the time selection message with slot quick replies. */
export function timeSelectionMessage(
  slots: string[],
  dayContext: 'today' | 'tomorrow' | 'selected day' = 'selected day',
): DMMessage {
  const formatSlot = (slot: string): string => {
    const [h, m] = slot.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${hour}:${String(m).padStart(2, '0')} ${period}`;
  };

  return makeMessage('coach', 'quickReplies', {
    text:
      dayContext === 'today'
        ? 'Great! I can make time for you today around:'
        : dayContext === 'tomorrow'
          ? 'Great! I can make time for you tomorrow around:'
          : 'Great! I can make time for you around:',
    quickReplies: slots.map((slot) => ({ label: formatSlot(slot), value: slot })),
  });
}

/** Returns the phone collection message. */
export function phoneCollectionMessage(): DMMessage {
  return makeMessage('coach', 'text', {
    text: "You got it! Here's my number: (210) 771-0772. What's a good contact number for you?",
  });
}

/** Returns the booking confirmation messages (gender-aware). */
export function bookingConfirmationMessages(gender: DMConversationState['gender']): DMMessage[] {
  if (gender === 'female') {
    return [
      makeMessage('coach', 'text', {
        text: "Great! If you need workout or meal ideas in the meantime, let me know & I'll send a few over 😊 speak more then.",
      }),
      makeMessage('coach', 'quickReplies', {
        quickReplies: [
          { label: "Yes please! 🙌", value: 'send_resources' },
          { label: 'Maybe later', value: 'resources_later' },
        ],
      }),
    ];
  }
  return [
    makeMessage('coach', 'text', {
      text: 'Great! If you need anything else, let me know 🔥 speak more then. In the meantime, feel free to binge watch my Tiktok & follow me on Instagram.',
    }),
    makeMessage('coach', 'quickReplies', {
      quickReplies: [
        { label: '🎵 TikTok @BodyByReasonBBR', value: 'tiktok' },
        { label: '📸 Instagram @BodyByReason', value: 'instagram' },
      ],
    }),
  ];
}

/** Returns the StrongHER resource messages (PDF links + follow-up). */
export function resourceMessages(preferredDate?: string): DMMessage[] {
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let dayLabel = 'our call';
  if (preferredDate) {
    const d = new Date(`${preferredDate}T12:00:00`);
    if (!isNaN(d.getTime())) {
      dayLabel = `${DAY_NAMES[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
    }
  }

  return [
    makeMessage('coach', 'text', {
      text: "Here's your StrongHER Daily Fuel Plan & Strength Program 👇🏼",
    }),
    makeMessage('coach', 'quickReplies', {
      quickReplies: [
        { label: '📋 StrongHER Daily Fuel Blueprint', value: `pdf:${STRONGHER_FUEL_PDF_URL}` },
        { label: '💪 StrongHER Daily Strength Program', value: `pdf:${STRONGHER_STRENGTH_PDF_URL}` },
      ],
    }),
    makeMessage('coach', 'text', {
      text: `After you read them 👆🏼 let me know if you have any questions! Speak more ${dayLabel} 😊`,
    }),
  ];
}

/** Returns the booking error message. */
export function bookingErrorMessage(): DMMessage {
  return makeMessage('coach', 'text', {
    text: "Hmm, something went sideways on my end. Shoot me a text at (210) 771-0772 and we'll lock it in! 💪",
  });
}

/**
 * Returns a rephrased re-ask for whatever question was in play when a price
 * objection fired. Returns null for stages where quick-reply chips are still
 * visible and no text re-ask is needed.
 */
export function priceObjectionReaskMessage(stage: DMStage): DMMessage | null {
  switch (stage) {
    case 'greeting':
    case 'awaiting_diet':
      return makeMessage('coach', 'text', {
        text: 'What does your current nutrition & workout routine look like now?',
      });
    case 'awaiting_challenge':
      return makeMessage('coach', 'text', {
        text: 'So what would you say is the main thing holding you back right now?',
      });
    case 'phone_collection':
      return makeMessage('coach', 'text', {
        text: "What's the best number to reach you on?",
      });
    // day_selection & time_selection already have visible quick-reply chips — no re-ask needed
    default:
      return null;
  }
}

/** Returns the price objection handler message. */
export function priceObjectionMessage(): DMMessage {
  return makeMessage('coach', 'text', {
    text: "To put your mind at ease, it's not $2,000 or $3,000 or anything like that 😅 My suggestion before we commit to anything — let's first see what you've tried in the past, what worked well, and make sure you don't hate me lol",
  });
}

/** Detects price objection keywords in a user message. */
export function hasPriceObjection(text: string): boolean {
  const lower = text.toLowerCase();
  return ['cost', 'price', 'expensive', 'how much', 'charge', '$'].some((kw) =>
    lower.includes(kw),
  );
}

/**
 * Detects acknowledgment-only replies that carry no real information
 * (e.g. "Ok", "Sounds good", "Sure"). Used to re-ask the diet/movement
 * question when the user hasn't actually answered it yet.
 */
export function isAcknowledgmentOnly(text: string): boolean {
  const lower = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  const ACK_PHRASES = [
    'ok', 'okay', 'k', 'kk', 'sure', 'sounds good', 'alright', 'all right',
    'cool', 'got it', 'makes sense', 'yes', 'yep', 'yeah', 'yea', 'ye',
    'great', 'perfect', 'awesome', 'nice', 'good', 'noted', 'understood',
    'lol', 'haha', 'ha', 'fair enough', 'fair', 'of course', 'absolutely',
  ];
  return ACK_PHRASES.includes(lower) || lower.length <= 3;
}

// ─── Notification helpers ─────────────────────────────────────────────────────

/**
 * Schedules silence follow-up notifications (10 min, 60 min, 24 hr).
 * Returns the notification IDs so they can be cancelled when the user replies.
 */
export async function scheduleSilenceFollowUps(): Promise<string[]> {
  const ids: string[] = [];

  try {
    const id10 = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Coach Josh',
        body: "I'm not trying to rush you, just making sure we're still connected? 👊",
        data: { type: 'coach_dm_silence' },
      },
      trigger: { seconds: 10 * 60 },
    });
    ids.push(id10);

    const id60 = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Coach Josh',
        body: "I hope that's not too much to ask 😅",
        data: { type: 'coach_dm_silence' },
      },
      trigger: { seconds: 60 * 60 },
    });
    ids.push(id60);

    const id24 = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Coach Josh',
        body: 'Tried to reach you a few times... where should we go from here?',
        data: { type: 'coach_dm_silence' },
      },
      trigger: { seconds: 24 * 60 * 60 },
    });
    ids.push(id24);
  } catch {
    // Notifications may not be permitted — fail gracefully
  }

  return ids;
}

/**
 * Cancels previously scheduled silence follow-up notifications.
 */
export async function cancelSilenceFollowUps(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // Ignore errors for individual cancellations
    }
  }
}

/** Coach response when user wants to reschedule — shows available slots. */
export function rescheduleAckMessage(slots: string[], dateLabel = 'tomorrow'): DMMessage {
  const formatSlot = (slot: string): string => {
    const [h, m] = slot.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${hour}:${String(m).padStart(2, '0')} ${period}`;
  };
  return makeMessage('coach', 'quickReplies', {
    text: `All Good! I hope everything is alright 🙏🏼 I can make time for you ${dateLabel} at:`,
    quickReplies: slots.slice(0, 6).map((slot) => ({ label: formatSlot(slot), value: slot })),
  });
}

/**
 * Coach response when the user specifies a different day after the initial ack.
 * e.g. "Of course! Friday I can make time around:"
 */
export function rescheduleFollowUpMessage(slots: string[], dateLabel: string): DMMessage {
  const formatSlot = (slot: string): string => {
    const [h, m] = slot.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${hour}:${String(m).padStart(2, '0')} ${period}`;
  };
  const label = dateLabel === 'today' || dateLabel === 'tomorrow' ? dateLabel : `on ${dateLabel}`;
  return makeMessage('coach', 'quickReplies', {
    text: `Of course! ${label.charAt(0).toUpperCase() + label.slice(1)} I can make time around:`,
    quickReplies: slots.slice(0, 6).map((slot) => ({ label: formatSlot(slot), value: slot })),
  });
}

/** Final coach confirmation after reschedule is booked. */
export function rescheduleConfirmMessage(): DMMessage {
  return makeMessage('coach', 'text', {
    text: "You got it 🤜🤛 I'll move us now! If you need anything else in the meantime, let me know. Speak more then!",
  });
}

/**
 * Parse a natural-language reschedule request into a date string and approximate hour.
 * Examples: "next Monday around 12 PM", "tomorrow at 2pm", "Friday morning"
 */
export function parseRescheduleRequest(text: string): { date: string | null; approxHour: number | null } {
  const lower = text.toLowerCase();
  const today = new Date();
  let targetDate: Date | null = null;
  let approxHour: number | null = null;

  // Day detection
  const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (lower.includes('tomorrow')) {
    targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 1);
  } else if (lower.includes('today')) {
    targetDate = new Date(today);
  } else {
    for (let i = 0; i < DAY_NAMES.length; i++) {
      if (lower.includes(DAY_NAMES[i])) {
        const currentDay = today.getDay();
        let daysUntil = (i - currentDay + 7) % 7;
        if (daysUntil === 0 || lower.includes('next')) daysUntil = ((i - currentDay + 7) % 7) || 7;
        targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysUntil);
        break;
      }
    }
  }

  // Time detection — "2pm", "2:30 PM", "noon", "morning", "afternoon", "evening"
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const isPM = timeMatch[3] === 'pm';
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    approxHour = hour;
  } else if (lower.includes('noon')) {
    approxHour = 12;
  } else if (lower.includes('morning')) {
    approxHour = 9;
  } else if (lower.includes('afternoon')) {
    approxHour = 14;
  } else if (lower.includes('evening')) {
    approxHour = 18;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const toDateStr = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return { date: targetDate ? toDateStr(targetDate) : null, approxHour };
}

/**
 * Schedules a morning reminder at 6:00 AM on the day of the booked call.
 * @param date YYYY-MM-DD
 * @param time HH:MM (user's local timezone)
 * @returns notification ID or null if scheduling failed
 */
export async function scheduleMorningReminder(
  date: string,
  time: string,
): Promise<string | null> {
  try {
    const [year, month, day] = date.split('-').map(Number);
    const trigger = new Date(year, month - 1, day, 6, 0, 0, 0);

    // Only schedule if the trigger is in the future
    if (trigger.getTime() <= Date.now()) return null;

    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const displayTime = `${hour}:${String(m).padStart(2, '0')} ${period}`;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Coach Josh',
        body: `Good morning — speak more at ${displayTime} 💪`,
        data: { type: 'coach_dm_morning_reminder' },
      },
      trigger: {
        date: trigger,
      },
    });
    return id;
  } catch {
    return null;
  }
}
