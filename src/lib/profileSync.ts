import AsyncStorage from '@react-native-async-storage/async-storage';

import { getOrComputeMacroTargets } from '@/lib/bmr';
import type { ThemeId } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabase';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';

type ProfileRow = {
  active_plan_id?: UserProfile['activePlanId'] | null;
  activity_level?: UserProfile['activityLevel'] | null;
  age?: string | null;
  avatar_url?: string | null;
  coach_bio?: string | null;
  daily_calorie_target?: number | null;
  daily_carbs?: number | null;
  daily_fat?: number | null;
  daily_protein?: number | null;
  display_name?: string | null;
  equipment?: string[] | null;
  experience?: UserProfile['experience'] | null;
  food_avoidances?: string | null;
  food_preferences?: string[] | null;
  reason_why?: string[] | null;
  reason_why_detail?: string | null;
  gender?: UserProfile['gender'] | null;
  glp1_status?: UserProfile['glp1Status'] | null;
  goal?: UserProfile['goal'] | null;
  goal_weight_lbs?: string | null;
  health_conditions?: string[] | null;
  height_ft?: string | null;
  id?: string;
  is_coach?: boolean | null;
  language?: UserProfile['language'] | null;
  medications?: string | null;
  privacy_friend_requests?: UserProfile['privacyFriendRequests'] | null;
  privacy_messages?: UserProfile['privacyMessages'] | null;
  pro_trial_ends_at?: string | null;
  pro_trial_started_at?: string | null;
  selected_title?: string | null;
  surgeries?: string | null;
  theme_id?: ThemeId | null;
  wake_time?: string | null;
  sleep_time?: string | null;
  workout_time?: string | null;
  workout_window?: UserProfile['workoutWindow'] | null;
  meals_per_day?: UserProfile['mealsPerDay'] | null;
  user_id: string;
  username?: string | null;
  weigh_frequency?: UserProfile['weighFrequency'] | null;
  weekly_loss_rate?: UserProfile['weeklyLossRate'] | null;
  weight_lbs?: string | null;
  zip_code?: string | null;
};

function toRow(userId: string, profile: UserProfile): ProfileRow {
  return {
    user_id: userId,
    display_name: profile.displayName ?? null,
    username: profile.username ?? null,
    avatar_url: profile.avatarUrl ?? null,
    coach_bio: profile.coachBio ?? null,
    active_plan_id: profile.activePlanId ?? null,
    goal: profile.goal ?? null,
    food_avoidances: profile.foodAvoidances ?? null,
    food_preferences: profile.foodPreferences ?? null,
    reason_why: profile.reasonWhy ?? null,
    reason_why_detail: profile.reasonWhyDetail ?? null,
    health_conditions: profile.healthConditions ?? null,
    medications: profile.medications ?? null,
    surgeries: profile.surgeries ?? null,
    glp1_status: profile.glp1Status ?? null,
    equipment: profile.equipment ?? null,
    activity_level: profile.activityLevel ?? null,
    weight_lbs: profile.weightLbs ?? null,
    height_ft: profile.heightFt ?? null,
    age: profile.age ?? null,
    goal_weight_lbs: profile.goalWeightLbs ?? null,
    gender: profile.gender ?? null,
    experience: profile.experience ?? null,
    wake_time: profile.wakeTime ?? null,
    sleep_time: profile.sleepTime ?? null,
    workout_time: profile.workoutTime ?? null,
    workout_window: profile.workoutWindow ?? null,
    meals_per_day: profile.mealsPerDay ?? null,
    language: profile.language ?? null,
    daily_calorie_target: profile.dailyCalorieTarget ?? null,
    daily_protein: profile.dailyProtein ?? null,
    daily_carbs: profile.dailyCarbs ?? null,
    daily_fat: profile.dailyFat ?? null,
    weekly_loss_rate: profile.weeklyLossRate ?? null,
    selected_title: profile.selectedTitle ?? null,
    is_coach: profile.isCoach ?? false,
    theme_id: profile.themeId ?? null,
    zip_code: profile.zipCode ?? null,
    privacy_messages: profile.privacyMessages ?? null,
    privacy_friend_requests: profile.privacyFriendRequests ?? null,
    pro_trial_started_at: profile.proTrialStartedAt ?? null,
    pro_trial_ends_at: profile.proTrialEndsAt ?? null,
    weigh_frequency: profile.weighFrequency ?? null,
  };
}

function fromRow(row: ProfileRow, fallback?: UserProfile | null): UserProfile {
  return {
    ...(fallback ?? {
      displayName: 'Athlete',
      username: 'athlete',
      goal: 'recomp',
      weightLbs: '',
      heightFt: '',
      age: '',
      goalWeightLbs: '',
      gender: 'male',
      experience: 'intermediate',
    }),
    activePlanId: row.active_plan_id ?? fallback?.activePlanId,
    avatarUrl: row.avatar_url ?? fallback?.avatarUrl,
    coachBio: row.coach_bio ?? fallback?.coachBio,
    displayName: row.display_name ?? fallback?.displayName ?? 'Athlete',
    username: row.username ?? fallback?.username ?? 'athlete',
    goal: row.goal ?? fallback?.goal ?? 'recomp',
    foodAvoidances: row.food_avoidances ?? fallback?.foodAvoidances,
    foodPreferences: row.food_preferences ?? fallback?.foodPreferences,
    reasonWhy: row.reason_why ?? fallback?.reasonWhy,
    reasonWhyDetail: row.reason_why_detail ?? fallback?.reasonWhyDetail,
    healthConditions: row.health_conditions ?? fallback?.healthConditions,
    medications: row.medications ?? fallback?.medications,
    surgeries: row.surgeries ?? fallback?.surgeries,
    glp1Status: row.glp1_status ?? fallback?.glp1Status,
    equipment: row.equipment ?? fallback?.equipment,
    activityLevel: row.activity_level ?? fallback?.activityLevel,
    weightLbs: row.weight_lbs ?? fallback?.weightLbs ?? '',
    heightFt: row.height_ft ?? fallback?.heightFt ?? '',
    age: row.age ?? fallback?.age ?? '',
    goalWeightLbs: row.goal_weight_lbs ?? fallback?.goalWeightLbs ?? '',
    gender: row.gender ?? fallback?.gender ?? 'male',
    experience: row.experience ?? fallback?.experience ?? 'intermediate',
    wakeTime: row.wake_time ?? fallback?.wakeTime,
    sleepTime: row.sleep_time ?? fallback?.sleepTime,
    workoutTime: row.workout_time ?? fallback?.workoutTime,
    workoutWindow: row.workout_window ?? fallback?.workoutWindow,
    mealsPerDay: row.meals_per_day ?? fallback?.mealsPerDay,
    language: row.language ?? fallback?.language,
    dailyCalorieTarget: row.daily_calorie_target ?? fallback?.dailyCalorieTarget,
    dailyProtein: row.daily_protein ?? fallback?.dailyProtein,
    dailyCarbs: row.daily_carbs ?? fallback?.dailyCarbs,
    dailyFat: row.daily_fat ?? fallback?.dailyFat,
    weeklyLossRate: row.weekly_loss_rate ?? fallback?.weeklyLossRate,
    selectedTitle: row.selected_title ?? fallback?.selectedTitle,
    isCoach: row.is_coach ?? fallback?.isCoach,
    themeId: row.theme_id ?? fallback?.themeId,
    zipCode: row.zip_code ?? fallback?.zipCode,
    privacyMessages: row.privacy_messages ?? fallback?.privacyMessages,
    privacyFriendRequests: row.privacy_friend_requests ?? fallback?.privacyFriendRequests,
    proTrialStartedAt: row.pro_trial_started_at ?? fallback?.proTrialStartedAt,
    proTrialEndsAt: row.pro_trial_ends_at ?? fallback?.proTrialEndsAt,
    weighFrequency: row.weigh_frequency ?? fallback?.weighFrequency,
  };
}

export async function cacheProfileLocally(profile: UserProfile) {
  await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export async function loadCachedProfile() {
  const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as UserProfile) : null;
}

function isSchemaMismatch(error: unknown) {
  // Also treat missing unique constraint (42P10) as non-fatal — the profiles
  // table may not have a UNIQUE index on user_id yet in this environment.
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  if (code === '42P10' || code === '23505') return true;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');

  const normalized = message.toLowerCase();
  return (
    normalized.includes('schema cache') ||
    normalized.includes('does not exist') ||
    normalized.includes('could not find the') ||
    normalized.includes('unique or exclusion constraint') ||
    normalized.includes('on conflict') ||
    normalized.includes('column') ||
    normalized.includes('relation') ||
    normalized.includes('function')
  );
}

export async function syncProfileToSupabase(userId: string | undefined, profile: UserProfile) {
  const computedTargets = getOrComputeMacroTargets(profile);
  const normalizedProfile: UserProfile = {
    ...profile,
    dailyCalorieTarget: computedTargets.dailyCalorieTarget,
    dailyProtein: computedTargets.dailyProtein,
    dailyCarbs: computedTargets.dailyCarbs,
    dailyFat: computedTargets.dailyFat,
  };

  await cacheProfileLocally(normalizedProfile);

  if (!userId) {
    return normalizedProfile;
  }

  try {
    const { error } = await supabase.from('profiles').upsert(toRow(userId, normalizedProfile), { onConflict: 'user_id' });
    if (error) {
      throw error;
    }
  } catch (error) {
    if (isSchemaMismatch(error)) {
      // Schema may not be migrated yet; local cache remains source-of-last-write.
      return normalizedProfile;
    }
    console.error('Failed to sync profile to Supabase', error);
    throw error;
  }

  return normalizedProfile;
}

export async function hydrateProfileFromSupabase(userId: string | undefined) {
  const cached = await loadCachedProfile();

  if (!userId) {
    return cached;
  }

  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) {
      return cached;
    }
    const row = data as ProfileRow;

    // If display_name was never written to profiles (signup only saves it to auth
    // user_metadata), pull it from auth and backfill the profiles row so future
    // logins don't fall back to 'Athlete'.
    if (!row.display_name) {
      const { data: { user } } = await supabase.auth.getUser();
      const metaName = user?.user_metadata?.display_name as string | undefined;
      if (metaName) {
        row.display_name = metaName;
        supabase.from('profiles').update({ display_name: metaName }).eq('user_id', userId).catch(() => null);
      }
    }

    const merged = fromRow(row, cached);
    await cacheProfileLocally(merged);
    return merged;
  } catch {
    return cached;
  }
}
