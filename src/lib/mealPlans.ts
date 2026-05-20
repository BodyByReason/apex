import AsyncStorage from '@react-native-async-storage/async-storage';

import { getOrComputeMacroTargets } from '@/lib/bmr';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/screens/GoalSetupScreen';

export const MEAL_PLAN_KEY = 'apex.mealplan.v1';
export const MEAL_PLAN_HISTORY_KEY = 'apex.mealplan.history.v1';

export type MealPlanDay = {
  day: string;
  meals: Array<{ name: string; kcal: number; protein: number; time: string }>;
};

export type MealPlanHistoryEntry = {
  generatedAt: string;
  id: string;
  label: string;
  plan: MealPlanDay[];
};

const goalLabelMap: Record<string, string> = {
  build: 'muscle building',
  lose: 'fat loss',
  performance: 'athletic performance',
  recomp: 'body recomposition',
};

export async function loadMealPlanFromStorage() {
  const raw = await AsyncStorage.getItem(MEAL_PLAN_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as MealPlanDay[]) : null;
}

export async function saveMealPlanHistory(plan: MealPlanDay[], label: string) {
  const nextEntry: MealPlanHistoryEntry = {
    generatedAt: new Date().toISOString(),
    id: `${Date.now()}`,
    label,
    plan,
  };

  const raw = await AsyncStorage.getItem(MEAL_PLAN_HISTORY_KEY).catch(() => null);
  const current = raw ? (JSON.parse(raw) as MealPlanHistoryEntry[]) : [];
  const nextHistory = [nextEntry, ...current].slice(0, 3);
  await AsyncStorage.setItem(MEAL_PLAN_HISTORY_KEY, JSON.stringify(nextHistory)).catch(() => null);
}

export async function saveMealPlanToStorage(plan: MealPlanDay[], label: string) {
  await AsyncStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(plan));
  await saveMealPlanHistory(plan, label);
}

export async function coachGenerateOrUpdateMealPlan({
  existingPlan,
  profile,
  request,
  labContext,
}: {
  existingPlan?: MealPlanDay[] | null;
  profile: UserProfile | null;
  request: string;
  labContext?: string;
}) {
  const { dailyCalorieTarget: kcal, dailyProtein: protein, dailyCarbs: carbs, dailyFat: fat } =
    getOrComputeMacroTargets(profile);
  const goal = profile?.goal ?? 'recomp';
  const goalLabel = goalLabelMap[goal] ?? goal;
  const preferenceLine = profile?.foodPreferences?.length
    ? `Food preferences: ${profile.foodPreferences.join(', ')}`
    : 'Food preferences: none specified';
  const avoidanceLine = profile?.foodAvoidances?.trim()
    ? `Avoid these foods: ${profile.foodAvoidances.trim()}`
    : 'Avoid these foods: none specified';
  const labLine = labContext ? `\nLab results on file:\n${labContext}` : '';

  const prompt = existingPlan?.length
    ? `You are updating an athlete's existing 7-day meal plan.
Daily targets: ${kcal} calories · ${protein} grams protein · ${carbs} grams carbs · ${fat} grams fat
Goal: ${goalLabel}
${preferenceLine}
${avoidanceLine}${labLine}

Current plan:
${JSON.stringify(existingPlan)}

User request:
"${request.trim()}"

Update the meal plan while keeping the daily targets approximately aligned.
Reply with ONLY valid JSON, no markdown:
{"reply":"one short coach sentence confirming the change","plan":[{"day":"Monday","meals":[{"name":"Meal name","kcal":500,"protein":35,"time":"Breakfast"}]}]}`
    : `You are creating a 7-day meal plan for an athlete.
Daily targets: ${kcal} calories · ${protein} grams protein · ${carbs} grams carbs · ${fat} grams fat
Goal: ${goalLabel}
${preferenceLine}
${avoidanceLine}${labLine}

User request:
"${request.trim()}"

Create the plan from scratch around the request.
Reply with ONLY valid JSON, no markdown:
{"reply":"one short coach sentence confirming the new plan","plan":[{"day":"Monday","meals":[{"name":"Meal name","kcal":500,"protein":35,"time":"Breakfast"}]}]}`;

  const { data, error } = await supabase.functions.invoke('anthropic', {
    body: {
      max_tokens: 2200,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a meal-planning coach. Output valid JSON only, with a short natural reply and a valid 7-day plan.',
    },
  });

  if (error) {
    throw error;
  }

  const raw: string = Array.isArray(data?.content)
    ? (data.content as Array<{ text?: string }>).map((block) => block.text ?? '').join('')
    : typeof data?.content === 'string'
      ? data.content
      : '';

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Bad meal plan format');
  }

  const parsed = JSON.parse(match[0]) as { plan?: MealPlanDay[]; reply?: string };
  if (!Array.isArray(parsed.plan) || parsed.plan.length === 0) {
    throw new Error('Meal plan was empty');
  }

  await saveMealPlanToStorage(parsed.plan, existingPlan?.length ? 'Coach Updated Plan' : 'Coach Generated Plan');

  return {
    plan: parsed.plan,
    reply: parsed.reply?.trim() || (existingPlan?.length
      ? 'I updated your meal plan and saved it in Fuel.'
      : 'I built your meal plan and saved it in Fuel.'),
  };
}
