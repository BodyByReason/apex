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

/**
 * Derive macro targets from raw profile stats.
 * Uses a 750 kcal/day deficit for fat loss, +300 for building,
 * and maintenance for recomp / performance.
 */
export function deriveMacroTargets(
  profile: Pick<
    UserProfile,
    'weightLbs' | 'heightFt' | 'age' | 'gender' | 'experience' | 'goal' | 'goalWeightLbs' | 'weeklyLossRate'
  >,
): MacroTargets {
  const bmr = calcBMR(
    profile.weightLbs,
    profile.heightFt,
    profile.age,
    profile.gender,
  );
  const tdee = Math.round(bmr * activityFactor(profile.experience));

  const rawDeficit = lossDeficitForRate(profile.weeklyLossRate);
  const cappedDeficit = Math.min(rawDeficit, Math.round(tdee * 0.3));
  const adjustment =
    profile.goal === 'lose'
      ? -cappedDeficit
      : profile.goal === 'build'
        ? 300
        : 0; // recomp / performance → maintenance

  const dailyCalorieTarget = Math.max(safeCalorieFloor(profile.gender), tdee + adjustment);
  const refWeight = parseFloat(profile.goalWeightLbs || profile.weightLbs) || 185;
  const dailyProtein = Math.round(refWeight * 0.9);
  const dailyFat = Math.round((dailyCalorieTarget * 0.28) / 9);
  const dailyCarbs = Math.max(
    0,
    Math.round((dailyCalorieTarget - dailyProtein * 4 - dailyFat * 9) / 4),
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
