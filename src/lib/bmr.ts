/**
 * BMR / TDEE / macro target helpers — shared across GoalSetupScreen,
 * FuelScreen, and ProfileScreen.
 *
 * Formula: Mifflin-St Jeor
 *   Male:   10w(kg) + 6.25h(cm) - 5a + 5
 *   Female: 10w(kg) + 6.25h(cm) - 5a - 161
 */

import type { UserProfile } from '@/screens/GoalSetupScreen';

// ─── Low-level helpers ────────────────────────────────────────────────────────

export function parseHeightToInches(h: string): number {
  const raw = String(h || '').trim();
  if (!raw) return 70;

  // Support common phone keyboard formats like 5'10", 5’10”, 5 10, 5-10.
  const feetInches = raw.match(/^\s*(\d)\s*['’′\-\s]?\s*(\d{1,2})\s*(?:["”″]|in)?\s*$/i);
  if (feetInches) {
    return parseInt(feetInches[1], 10) * 12 + parseInt(feetInches[2], 10);
  }

  // Handle compact values like 510 meaning 5'10".
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly.length === 3) {
    return parseInt(digitsOnly.slice(0, 1), 10) * 12 + parseInt(digitsOnly.slice(1), 10);
  }

  const numericValue = parseFloat(raw.replace(/[^\d.]/g, ''));
  if (!numericValue) return 70;
  if (numericValue > 100) return Math.round(numericValue / 2.54); // cm → inches
  return Math.round(numericValue);
}

export function calcBMR(
  weightLbs: string,
  heightFt: string,
  age: string,
  gender: 'male' | 'female' | 'other',
): number {
  const wKg = (parseFloat(weightLbs) || 185) / 2.205;
  const hCm = parseHeightToInches(heightFt || "5'10") * 2.54;
  const a = parseInt(age, 10) || 30;
  const offset = gender === 'female' ? -161 : 5;
  return Math.round(10 * wKg + 6.25 * hCm - 5 * a + offset);
}

export function activityFactor(
  exp: 'beginner' | 'intermediate' | 'advanced',
): number {
  return exp === 'beginner' ? 1.375 : exp === 'advanced' ? 1.725 : 1.55;
}

export type MacroTargets = {
  dailyCalorieTarget: number;
  dailyProtein: number;
  dailyCarbs: number;
  dailyFat: number;
};

export type WeeklyLossRate = '1' | '1.5' | '2';

function safeCalorieFloor(gender: 'male' | 'female' | 'other'): number {
  return gender === 'male' ? 1600 : 1400;
}

export function lossDeficitForRate(rate: WeeklyLossRate = '1.5'): number {
  if (rate === '1') return 500;
  if (rate === '2') return 1000;
  return 750;
}

// Grams per lb of reference weight for each goal.
// lose/recomp/performance use goal weight; build uses current weight.
const MACRO_MULTIPLIERS: Record<
  UserProfile['goal'],
  { protein: number; carbs: number; fat: number }
> = {
  lose:        { protein: 1.0, carbs: 0.75, fat: 0.35 },
  recomp:      { protein: 1.0, carbs: 1.0,  fat: 0.35 },
  performance: { protein: 1.0, carbs: 1.2,  fat: 0.35 },
  build:       { protein: 1.0, carbs: 1.5,  fat: 0.4  },
};

/**
 * Derive macro targets from goal body weight.
 * All three macros are set from the reference weight, then calories
 * are derived from the macros — not the other way around.
 * This guarantees protein ≥ carbs > fat (in grams) for the lose goal
 * and keeps targets predictable at any calorie level.
 */
export function deriveMacroTargets(
  profile: Pick<
    UserProfile,
    'weightLbs' | 'heightFt' | 'age' | 'gender' | 'experience' | 'goal' | 'goalWeightLbs' | 'weeklyLossRate'
  >,
): MacroTargets {
  const refWeight = parseFloat(profile.goalWeightLbs || profile.weightLbs) || 185;
  const m = MACRO_MULTIPLIERS[profile.goal] ?? MACRO_MULTIPLIERS.recomp;

  const dailyProtein = Math.round(refWeight * m.protein);
  const dailyCarbs   = Math.round(refWeight * m.carbs);
  const dailyFat     = Math.round(refWeight * m.fat);
  const dailyCalorieTarget = Math.max(
    safeCalorieFloor(profile.gender),
    dailyProtein * 4 + dailyCarbs * 4 + dailyFat * 9,
  );

  return { dailyCalorieTarget, dailyProtein, dailyCarbs, dailyFat };
}

/**
 * Return stored targets if they exist, or compute them on-the-fly
 * from raw profile stats. Returns sensible defaults if profile data
 * is insufficient (e.g. legacy profiles missing height/weight).
 */
export function getOrComputeMacroTargets(profile: UserProfile | null): MacroTargets {
  if (!profile) {
    return { dailyCalorieTarget: 2000, dailyProtein: 150, dailyCarbs: 200, dailyFat: 65 };
  }

  if (
    profile.dailyCalorieTarget &&
    profile.dailyProtein &&
    profile.dailyCarbs &&
    profile.dailyFat
  ) {
    return {
      dailyCalorieTarget: profile.dailyCalorieTarget,
      dailyProtein: profile.dailyProtein,
      dailyCarbs: profile.dailyCarbs,
      dailyFat: profile.dailyFat,
    };
  }

  // Legacy profile — compute from raw stats
  return deriveMacroTargets({
    weightLbs: profile.weightLbs || '185',
    heightFt: profile.heightFt || "5'10",
    age: profile.age || '30',
    gender: profile.gender || 'male',
    experience: profile.experience || 'intermediate',
    goal: profile.goal || 'recomp',
    goalWeightLbs: profile.goalWeightLbs || profile.weightLbs || '185',
    weeklyLossRate: profile.weeklyLossRate || '1.5',
  });
}
