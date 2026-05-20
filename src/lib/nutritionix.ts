/**
 * nutritionix.ts
 *
 * AI-powered food nutrition lookup using the Anthropic edge function.
 * Replaces the Nutritionix API (which required paid credentials).
 *
 * Returns multiple serving variants for the searched food so the user
 * can pick the right portion.
 */

import { supabase } from '@/lib/supabase';

export type NutritionixFoodResult = {
  calories: number;
  carbs: number;
  name: string;
  protein: number;
  servingText: string;
  fat: number;
  source?: string;
};

const AI_SYSTEM = `You are a precise nutrition database. Given a food name or description, return ONLY a valid JSON array of 3-5 common serving variants.

Each item must follow this exact schema:
{"name":"food name","servingText":"serving size","calories":number,"protein":number,"carbs":number,"fat":number}

Rules:
- calories, protein, carbs, fat must be numbers (integers or one decimal place)
- Include variants like: 100g, 1 cup, 1 piece/slice, 1 oz — whichever are relevant
- Use realistic USDA-level values
- Return ONLY the JSON array, no markdown, no explanation`;

export async function searchFood(query: string): Promise<NutritionixFoodResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { data, error } = await supabase.functions.invoke('anthropic', {
    body: {
      max_tokens: 600,
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: trimmed }],
    },
  });

  if (error) throw new Error('AI food search failed. Please try again.');

  const raw: string = data?.content?.[0]?.text ?? '';

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Could not parse AI food data. Try a more specific food name.');
  }

  if (!Array.isArray(parsed)) throw new Error('Unexpected AI response format.');

  return (parsed as Array<Record<string, unknown>>).map((item) => ({
    name: String(item.name ?? trimmed),
    servingText: String(item.servingText ?? item.serving ?? '1 serving'),
    calories: Number(item.calories ?? 0),
    protein: Number(item.protein ?? 0),
    carbs: Number(item.carbs ?? 0),
    fat: Number(item.fat ?? 0),
    source: 'ai',
  }));
}
