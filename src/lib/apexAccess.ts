import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSuggestedPlanId } from '@/lib/plans';
import { loadCachedProfile, syncProfileToSupabase } from '@/lib/profileSync';
import { supabase } from '@/lib/supabase';
import {
  getWalkWaterPlan,
  getWalkWaterQuizAnswers,
  setWWUpgraded,
  setWalkWaterModeEnabled,
} from '@/lib/walkWaterMode';
import type { UserProfile } from '@/screens/GoalSetupScreen';

const APEX_ORIGIN_STORAGE_KEY = 'apex.access.originFlow';
const APEX_ACCESS_PREVIEW_KEY = 'apex._dev.appAccessPreview';

export type ApexOriginFlow = 'client_migration' | 'ww_upgrade';

export type ApexAccessState = {
  appAccess: 'apex' | 'ww';
  coachUserId: string | null;
  originFlow: ApexOriginFlow | null;
  status: string | null;
};

export async function isApexAccessPreviewEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(APEX_ACCESS_PREVIEW_KEY)) === 'apex';
  } catch {
    return false;
  }
}

export async function setApexAccessPreviewEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await AsyncStorage.setItem(APEX_ACCESS_PREVIEW_KEY, 'apex');
    return;
  }

  await AsyncStorage.removeItem(APEX_ACCESS_PREVIEW_KEY);
}

function buildFallbackProfile(email?: string | null): UserProfile {
  const emailName = email?.split('@')[0]?.trim() ?? 'athlete';
  const displayName = emailName
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    activePlanId: getSuggestedPlanId('recomp', 'beginner'),
    age: '',
    displayName: displayName || 'Athlete',
    experience: 'beginner',
    gender: 'other',
    goal: 'recomp',
    goalWeightLbs: '',
    heightFt: '',
    mealsPerDay: '3',
    privacyFriendRequests: 'everyone',
    privacyMessages: 'everyone',
    username: emailName.toLowerCase() || 'athlete',
    weightLbs: '',
    workoutWindow: 'varies',
  };
}

function mapWalkWaterGoalToApexGoal(goal?: string): UserProfile['goal'] {
  switch (goal) {
    case 'lose_weight':
      return 'lose';
    case 'more_energy':
      return 'performance';
    case 'build_habit':
      return 'recomp';
    case 'feel_better':
      return 'recomp';
    default:
      return 'recomp';
  }
}

function mapWalkTimeToWorkoutWindow(bestWalkTime?: string): UserProfile['workoutWindow'] {
  switch (bestWalkTime) {
    case 'morning':
      return 'before_work';
    case 'lunch':
      return 'lunch';
    case 'afternoon':
      return 'after_work';
    case 'evening':
      return 'evening';
    default:
      return 'varies';
  }
}

export async function getMyApexAccess(userId?: string | null): Promise<ApexAccessState> {
  const previewEnabled = await isApexAccessPreviewEnabled().catch(() => false);
  if (previewEnabled) {
    return {
      appAccess: 'apex',
      coachUserId: null,
      originFlow: null,
      status: 'preview',
    };
  }

  if (!userId) {
    return {
      appAccess: 'ww',
      coachUserId: null,
      originFlow: null,
      status: null,
    };
  }

  const { data, error } = await supabase
    .from('coach_client_links')
    .select('app_access, coach_user_id, origin_flow, status')
    .eq('client_user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return {
      appAccess: 'ww',
      coachUserId: null,
      originFlow: null,
      status: null,
    };
  }

  return {
    appAccess: data.app_access === 'apex' ? 'apex' : 'ww',
    coachUserId: data.coach_user_id ?? null,
    originFlow: (data.origin_flow as ApexOriginFlow | null) ?? null,
    status: data.status ?? null,
  };
}

export async function claimApexAccessLink(token: string): Promise<ApexAccessState> {
  const { data, error } = await supabase.rpc('claim_apex_access_link', {
    p_token: token.trim(),
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : (data as {
    app_access?: 'apex' | 'ww';
    coach_user_id?: string | null;
    origin_flow?: ApexOriginFlow | null;
  } | null);

  if (!row) {
    throw new Error('This Apex access link is invalid or expired.');
  }

  const accessState: ApexAccessState = {
    appAccess: row.app_access === 'apex' ? 'apex' : 'ww',
    coachUserId: row.coach_user_id ?? null,
    originFlow: row.origin_flow ?? null,
    status: 'active',
  };

  await applyApexAccessState(accessState);
  return accessState;
}

export async function applyApexAccessState(state: ApexAccessState): Promise<void> {
  const shouldUseWalkWater = state.appAccess !== 'apex';
  await setWalkWaterModeEnabled(shouldUseWalkWater);

  if (state.appAccess === 'apex') {
    await setWWUpgraded(true).catch(() => null);
  }

  if (state.originFlow) {
    await AsyncStorage.setItem(APEX_ORIGIN_STORAGE_KEY, state.originFlow).catch(() => null);
  }
}

export async function ensureApexProfileFromWalkWater(userId: string, email?: string | null): Promise<UserProfile | null> {
  const existing = await loadCachedProfile().catch(() => null);
  if (existing) {
    return existing;
  }

  const [quizAnswers, walkPlan] = await Promise.all([
    getWalkWaterQuizAnswers(),
    getWalkWaterPlan(),
  ]);

  if (!quizAnswers) {
    return null;
  }

  const goal = mapWalkWaterGoalToApexGoal(quizAnswers.primaryGoal);
  const fallbackProfile = buildFallbackProfile(email);
  const nextProfile: UserProfile = {
    ...fallbackProfile,
    activePlanId: getSuggestedPlanId(goal, 'beginner'),
    gender: quizAnswers.gender,
    goal,
    reasonWhy:
      goal === 'lose'
        ? ['Look better', 'Feel better']
        : goal === 'performance'
          ? ['Performance', 'Health']
          : ['Confidence', 'Feel better'],
    reasonWhyDetail: walkPlan
      ? `Imported from WW challenge. Daily target was ${walkPlan.dailyStepGoal} steps and ${walkPlan.dailyWaterGoalOz} oz of water.`
      : 'Imported from WW challenge onboarding.',
    workoutWindow: mapWalkTimeToWorkoutWindow(quizAnswers.bestWalkTime),
  };

  return syncProfileToSupabase(userId, nextProfile);
}
