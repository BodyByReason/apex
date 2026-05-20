/**
 * aiWorkout.ts
 *
 * Stores and retrieves AI-generated workouts and programs.
 *
 * WORKOUT: The AI embeds a [[WORKOUT:{json}]] tag in its response; CoachScreen
 * parses it, strips it from the displayed message, and calls saveAIWorkout().
 * TrainScreen reads getAIWorkout() on focus to show an "AI Suggested" card.
 *
 * PROGRAM: The AI embeds a [[PROGRAM:{json}]] tag when the user asks for a full
 * multi-week training program. PlansScreen reads getAIProgram() on focus and
 * displays it in the Active Program hero when activePlanId === 'ai-generated'.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const AI_WORKOUT_KEY = '@apex_ai_workout';

export type AIWorkoutExercise = {
  name: string;
  sets: number;
  reps: string;       // e.g. "8-10" or "60s"
  weight?: string;    // e.g. "bodyweight" or "moderate"
  rest?: string;      // e.g. "60s"
};

export type AIWorkout = {
  name: string;
  duration: number;           // minutes
  focus?: string;             // e.g. "Upper body" | "Full body" etc.
  exercises: AIWorkoutExercise[];
  coachNote?: string;         // 1-sentence coach cue stripped from the main reply
  quickWorkoutMeta?: {
    equipment?: string;
    focusLabel?: string;
    minutes?: number;
  };
  generatedAt: string;        // ISO timestamp
};

function normalizeRecoveryExercise(exercise: AIWorkoutExercise): AIWorkoutExercise {
  const name = exercise.name.toLowerCase();

  if (name.includes('walk')) {
    return {
      ...exercise,
      sets: 1,
      reps: '15-20 min',
      rest: undefined,
      weight: 'conversational pace',
    };
  }

  if (name.includes('foam rolling') || name.includes('foam roll')) {
    return {
      ...exercise,
      sets: 1,
      reps: '8-10 min',
      rest: undefined,
      weight: 'slow pressure',
    };
  }

  if (name.includes('stretch')) {
    return {
      ...exercise,
      sets: 1,
      reps: name.includes('side') ? exercise.reps || '60s each side' : '45-60s',
      rest: undefined,
      weight: 'easy breathing',
    };
  }

  return exercise;
}

function buildRecoveryCoachNote(exercises: AIWorkoutExercise[]) {
  const names = exercises.map((exercise) => exercise.name);
  const details = exercises.map((exercise) => {
    const lower = exercise.name.toLowerCase();
    if (lower.includes('walk')) return `${exercise.reps} walk`;
    if (lower.includes('foam')) return `${exercise.reps} of foam rolling`;
    if (lower.includes('stretch')) return `${exercise.reps} stretch`;
    return `${exercise.reps} on ${exercise.name}`;
  });
  const lead = names.slice(0, 3).join(', ');
  return `Keep recovery light today: ${details.join(', ')}. Stay loose, breathe easy, and finish feeling better than you started with ${lead}.`;
}

function normalizeAIWorkout(workout: AIWorkout): AIWorkout {
  const isRecoveryWorkout =
    /recovery|walk|mobility|stretch|foam/i.test(workout.name) ||
    workout.exercises.some((exercise) => /walk|stretch|foam/i.test(exercise.name));

  if (!isRecoveryWorkout) return workout;

  const normalizedExercises = workout.exercises.map(normalizeRecoveryExercise);
  return {
    ...workout,
    focus: workout.focus ?? 'Recovery',
    coachNote: buildRecoveryCoachNote(normalizedExercises),
    exercises: normalizedExercises,
  };
}

/**
 * Save the AI-generated workout so TrainScreen can pick it up.
 */
export async function saveAIWorkout(workout: AIWorkout): Promise<void> {
  await AsyncStorage.setItem(AI_WORKOUT_KEY, JSON.stringify(normalizeAIWorkout(workout)));
}

/**
 * Load the most recent AI workout. Returns null if none saved.
 */
export async function getAIWorkout(): Promise<AIWorkout | null> {
  const raw = await AsyncStorage.getItem(AI_WORKOUT_KEY);
  if (!raw) return null;
  try {
    return normalizeAIWorkout(JSON.parse(raw) as AIWorkout);
  } catch {
    return null;
  }
}

/**
 * Clear the AI workout (user dismissed the card on TrainScreen).
 */
export async function clearAIWorkout(): Promise<void> {
  await AsyncStorage.removeItem(AI_WORKOUT_KEY);
}

// ─── AI Program ──────────────────────────────────────────────────────────────

export const AI_PROGRAM_KEY = '@apex_ai_program';

export type AIProgram = {
  title: string;
  icon: string;           // emoji, e.g. "🤖"
  durationWeeks: number;
  daysPerWeek: number;
  level: string;          // e.g. "Intermediate"
  subtitle: string;       // short tagline
  focus?: string;         // e.g. "Hypertrophy + fat loss"
  coachNote?: string;     // 1-sentence tip shown to user
  generatedAt: string;    // ISO timestamp
};

export async function saveAIProgram(program: AIProgram): Promise<void> {
  await AsyncStorage.setItem(AI_PROGRAM_KEY, JSON.stringify(program));
}

export async function getAIProgram(): Promise<AIProgram | null> {
  const raw = await AsyncStorage.getItem(AI_PROGRAM_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AIProgram;
  } catch {
    return null;
  }
}

export async function clearAIProgram(): Promise<void> {
  await AsyncStorage.removeItem(AI_PROGRAM_KEY);
}

/**
 * Parse a [[PROGRAM:{...}]] block embedded in an AI reply.
 * Returns { program, cleanText } — cleanText has the tag stripped out.
 */
export function parseProgramTag(raw: string): { program: AIProgram | null; cleanText: string } {
  const TAG_RE = /\[\[PROGRAM:([\s\S]*?)\]\]/;
  const match = TAG_RE.exec(raw);
  if (!match) return { program: null, cleanText: raw };

  const cleanText = raw.replace(TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  try {
    const parsed = JSON.parse(match[1]) as Partial<AIProgram>;
    if (!parsed.title) return { program: null, cleanText };
    const program: AIProgram = {
      title: parsed.title,
      icon: parsed.icon ?? '🤖',
      durationWeeks: parsed.durationWeeks ?? 8,
      daysPerWeek: parsed.daysPerWeek ?? 4,
      level: parsed.level ?? 'Intermediate',
      subtitle: parsed.subtitle ?? 'AI-generated program',
      focus: parsed.focus,
      coachNote: parsed.coachNote,
      generatedAt: new Date().toISOString(),
    };
    return { program, cleanText };
  } catch {
    return { program: null, cleanText };
  }
}

// ─── AI Workout ───────────────────────────────────────────────────────────────

/**
 * Parse a [[WORKOUT:{...}]] block embedded in an AI reply.
 * Returns { workout, cleanText } — cleanText has the tag stripped out.
 * Returns null for workout if no valid tag found.
 */
export function parseWorkoutTag(raw: string): { workout: AIWorkout | null; cleanText: string } {
  const TAG_RE = /\[\[WORKOUT:([\s\S]*?)\]\]/;
  const match = TAG_RE.exec(raw);
  if (!match) return { workout: null, cleanText: raw };

  const cleanText = raw.replace(TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  try {
    const parsed = JSON.parse(match[1]) as Partial<AIWorkout>;
    if (!parsed.name || !Array.isArray(parsed.exercises)) {
      return { workout: null, cleanText };
    }
    const workout: AIWorkout = {
      name: parsed.name,
      duration: parsed.duration ?? 45,
      focus: parsed.focus,
      exercises: parsed.exercises.map((e) => ({
        name: e.name ?? 'Exercise',
        sets: e.sets ?? 3,
        reps: e.reps ?? '10',
        weight: e.weight,
        rest: e.rest,
      })),
      coachNote: parsed.coachNote,
      generatedAt: new Date().toISOString(),
    };
    return { workout: normalizeAIWorkout(workout), cleanText };
  } catch {
    return { workout: null, cleanText };
  }
}
