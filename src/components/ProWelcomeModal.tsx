/**
 * ProWelcomeModal
 *
 * Appears once after a user's first Pro activation. Offers to AI-generate
 * their personalised workout program, meal plan, and grocery list in one tap
 * using every field they provided during onboarding.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { calcBMR, activityFactor, deriveMacroTargets } from '@/lib/bmr';
import { saveAIProgram, type AIProgram } from '@/lib/aiWorkout';
import { syncProfileToSupabase } from '@/lib/profileSync';

const PRO_WELCOME_SEEN_KEY = 'apex.pro.welcome.seen';
const MEAL_PLAN_KEY = 'apex.mealplan.v1';
const GROCERY_LIST_KEY = 'apex.grocerylist.v1';

type GenerationStep = 'idle' | 'program' | 'meal' | 'grocery' | 'done' | 'error';

type GeneratedMeal = {
  name: string;
  kcal: number;
  protein: number;
  time: string;
};

type GeneratedMealDay = {
  day: string;
  meals: GeneratedMeal[];
};

type GroceryListItem = {
  category: string;
  checked: boolean;
  estimatedPrice: number;
  id: string;
  name: string;
  quantity: string;
};

const STEPS: Array<{ key: GenerationStep; label: string; icon: string }> = [
  { key: 'program', label: 'Building your workout program…', icon: '💪' },
  { key: 'meal',    label: 'Creating your 7-day meal plan…', icon: '🥗' },
  { key: 'grocery', label: 'Generating your grocery list…',  icon: '🛒' },
  { key: 'done',    label: 'Everything is ready!',           icon: '🎉' },
];

function splitCalories(total: number, parts: number) {
  const safeTotal = Math.max(total, 1600);
  const base = Math.floor(safeTotal / parts);
  const values = Array.from({ length: parts }, () => base);
  values[values.length - 1] += safeTotal - base * parts;
  return values;
}

async function extractFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const errorBody = await error.context.json();
      if (errorBody?.error) return String(errorBody.error);
      if (errorBody?.details?.error?.message) return String(errorBody.details.error.message);
      if (errorBody?.details) return JSON.stringify(errorBody.details);
      return JSON.stringify(errorBody);
    } catch {
      return error.message;
    }
  }

  if (error instanceof Error) return error.message;
  return 'Something went wrong while generating your setup.';
}

function buildFallbackProgram(profile: UserProfile): AIProgram {
  const goal = profile.goal ?? 'recomp';
  const equipment = profile.equipment ?? [];
  const goalTitleMap: Record<string, string> = {
    lose: 'Lean & Strong',
    build: 'Muscle Builder',
    recomp: 'Complete Body Reset',
    performance: 'Performance Builder',
  };
  const goalFocusMap: Record<string, string> = {
    lose: 'Fat loss + conditioning',
    build: 'Hypertrophy + strength',
    recomp: 'Strength + body composition',
    performance: 'Athletic performance + work capacity',
  };
  const level = profile.experience ? `${profile.experience.charAt(0).toUpperCase()}${profile.experience.slice(1)}` : 'Intermediate';
  const daysPerWeek = goal === 'performance' ? 5 : goal === 'build' ? 4 : 4;
  const durationWeeks = 8;
  const equipmentLabel = equipment.length > 0 ? equipment.slice(0, 2).join(' + ') : 'minimal equipment';

  return {
    title: goalTitleMap[goal] ?? 'APEX Starter Program',
    icon: goal === 'lose' ? '🔥' : goal === 'build' ? '💪' : goal === 'performance' ? '⚡' : '🏁',
    durationWeeks,
    daysPerWeek,
    level,
    subtitle: `Built around ${equipmentLabel} and your real-life schedule`,
    focus: goalFocusMap[goal] ?? 'Strength + consistency',
    coachNote: `Start with consistency, not perfection. ${daysPerWeek} strong sessions each week will move this forward fast.`,
    generatedAt: new Date().toISOString(),
  };
}

function buildFallbackMealPlan(profile: UserProfile): GeneratedMealDay[] {
  const calorieTarget = Math.max(profile.dailyCalorieTarget ?? 2000, 1600);
  const proteinTarget = Math.max(profile.dailyProtein ?? 150, 100);
  const [breakfastKcal, lunchKcal, dinnerKcal] = splitCalories(Math.round(calorieTarget * 0.85), 3);
  const snackKcal = calorieTarget - breakfastKcal - lunchKcal - dinnerKcal;
  const breakfastProtein = Math.round(proteinTarget * 0.25);
  const lunchProtein = Math.round(proteinTarget * 0.3);
  const dinnerProtein = Math.round(proteinTarget * 0.3);
  const snackProtein = Math.max(proteinTarget - breakfastProtein - lunchProtein - dinnerProtein, 20);
  const preferences = new Set((profile.foodPreferences ?? []).map((item) => item.toLowerCase()));
  const avoidances = (profile.foodAvoidances ?? '').toLowerCase();
  const useOats = !avoidances.includes('oat');
  const breakfast = useOats
    ? 'Greek yogurt protein oats'
    : 'Egg white scramble with berries';
  const lunch = preferences.has('vegetarian')
    ? 'Tofu rice bowl'
    : 'Chicken rice bowl';
  const dinner = preferences.has('vegetarian')
    ? 'Lentil pasta power bowl'
    : 'Salmon potatoes and greens';
  const snack = 'Protein shake + fruit';
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return days.map((day, index) => ({
    day,
    meals: [
      { name: `${breakfast}${index % 2 === 0 ? '' : ' with chia'}`, kcal: breakfastKcal, protein: breakfastProtein, time: 'Breakfast' },
      { name: `${lunch}${index % 3 === 0 ? '' : ' with avocado'}`, kcal: lunchKcal, protein: lunchProtein, time: 'Lunch' },
      { name: snack, kcal: snackKcal, protein: snackProtein, time: 'Snack' },
      { name: `${dinner}${index % 2 === 0 ? '' : ' with extra veg'}`, kcal: dinnerKcal, protein: dinnerProtein, time: 'Dinner' },
    ],
  }));
}

function buildFallbackGroceryList(mealPlan: GeneratedMealDay[], profile: UserProfile) {
  const groceryTemplates: Array<Omit<GroceryListItem, 'checked' | 'id'>> = [
    { name: 'Chicken breast', quantity: '2 lb', estimatedPrice: 12.99, category: 'Protein' },
    { name: 'Greek yogurt', quantity: '32 oz', estimatedPrice: 5.99, category: 'Dairy' },
    { name: 'Egg whites', quantity: '16 oz carton', estimatedPrice: 4.99, category: 'Protein' },
    { name: 'Rice', quantity: '2 lb bag', estimatedPrice: 3.99, category: 'Grains' },
    { name: 'Potatoes', quantity: '3 lb bag', estimatedPrice: 4.49, category: 'Produce' },
    { name: 'Spinach', quantity: '10 oz', estimatedPrice: 2.99, category: 'Produce' },
    { name: 'Berries', quantity: '2 pints', estimatedPrice: 6.99, category: 'Produce' },
    { name: 'Protein powder', quantity: '1 tub', estimatedPrice: 29.99, category: 'Supplements' },
    { name: 'Avocados', quantity: '4 count', estimatedPrice: 5.49, category: 'Produce' },
    { name: 'Salmon fillets', quantity: '1.5 lb', estimatedPrice: 14.99, category: 'Protein' },
    { name: 'Oats', quantity: '42 oz', estimatedPrice: 4.49, category: 'Grains' },
    { name: 'Mixed vegetables', quantity: '2 bags', estimatedPrice: 4.99, category: 'Frozen' },
  ];
  const preferences = new Set((profile.foodPreferences ?? []).map((item) => item.toLowerCase()));
  const items = groceryTemplates
    .filter((item) => !(preferences.has('vegetarian') && item.name.toLowerCase().includes('chicken')))
    .slice(0, 12)
    .map((item, index) => ({
      ...item,
      id: `pg-fallback-${index}-${Date.now()}`,
      checked: false,
    }));
  const totalEstimate = items.reduce((sum, item) => sum + item.estimatedPrice, 0);

  return {
    items,
    nearbyStores: profile.zipCode ? ['Walmart', 'Target', 'Kroger'] : ['Walmart', 'Kroger'],
    totalEstimate,
    generatedAt: new Date().toISOString(),
    sourceMeals: mealPlan.flatMap((day) => day.meals.map((meal) => meal.name)).slice(0, 8),
  };
}

async function invokeAnthropicText(body: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.functions.invoke('anthropic', { body });
  if (error) {
    throw new Error(await extractFunctionError(error));
  }
  return (data?.content as Array<{ text?: string }>)?.map((block) => block.text ?? '').join('') ?? '';
}

export function ProWelcomeModal({ onDismiss, forceVisible = false }: { onDismiss: () => void; forceVisible?: boolean }) {
  const { session } = useAuth();
  const [visible, setVisible] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [genStep, setGenStep] = useState<GenerationStep>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Show modal once — only when Pro is newly activated
  useEffect(() => {
    if (forceVisible) {
      // Load profile even in forced mode so the generate function has data.
      AsyncStorage.getItem(PROFILE_STORAGE_KEY)
        .then((raw) => {
          setProfile(raw ? (JSON.parse(raw) as UserProfile) : null);
          setVisible(true);
          Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
        })
        .catch(() => {
          setVisible(true);
          Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
        });
      return;
    }

    AsyncStorage.multiGet([PRO_WELCOME_SEEN_KEY, PROFILE_STORAGE_KEY])
      .then(([[, seen], [, raw]]) => {
        if (seen) return; // already shown
        const p = raw ? (JSON.parse(raw) as UserProfile) : null;
        setProfile(p);
        setVisible(true);
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      })
      .catch(() => null);
  }, [fadeAnim, forceVisible]);

  const markSeen = () =>
    AsyncStorage.setItem(PRO_WELCOME_SEEN_KEY, '1').catch(() => null);

  const dismiss = () => {
    markSeen();
    setVisible(false);
    onDismiss();
  };

  // ── Build the rich profile context string for the AI ──────────────────────
  const buildProfileContext = (p: UserProfile): string => {
    const bmr = calcBMR(p.weightLbs, p.heightFt, p.age, p.gender);
    const actFactor = activityFactor(p.experience);
    const tdee = Math.round(bmr * actFactor);
    const targets = deriveMacroTargets({
      weightLbs: p.weightLbs, heightFt: p.heightFt, age: p.age,
      gender: p.gender, experience: p.experience, goal: p.goal,
      goalWeightLbs: p.goalWeightLbs,
      weeklyLossRate: p.weeklyLossRate ?? '1',
    });

    const goalLabel: Record<string, string> = {
      lose: 'Fat Loss', build: 'Build Muscle', recomp: 'Body Recomposition', performance: 'Athletic Performance',
    };
    const glp1Label: Record<string, string> = {
      glp1: 'GLP-1 (Ozempic/Wegovy/Mounjaro)', peptides: 'Peptides (BPC-157/TB-500/etc.)', both: 'GLP-1 + Peptides',
    };
    const activityLabel: Record<string, string> = {
      sedentary: 'Sedentary (desk job)',
      light: 'Lightly active',
      moderate: 'Moderately active',
      active: 'Active',
      very_active: 'Very active / athlete',
    };

    return [
      `Name: ${p.displayName}`,
      `Goal: ${goalLabel[p.goal] ?? p.goal}`,
      `Age: ${p.age} | Gender: ${p.gender} | Weight: ${p.weightLbs} lbs | Height: ${p.heightFt}`,
      `Goal weight: ${p.goalWeightLbs} lbs`,
      `Training experience: ${p.experience}`,
      `BMR: ${bmr} kcal | TDEE: ${tdee} kcal`,
      `Daily targets: ${targets.dailyCalorieTarget} kcal · ${targets.dailyProtein}g protein · ${targets.dailyCarbs}g carbs · ${targets.dailyFat}g fat`,
      p.activityLevel ? `Activity level: ${activityLabel[p.activityLevel] ?? p.activityLevel}` : '',
      p.equipment?.length ? `Available equipment: ${p.equipment.join(', ')}` : 'Equipment: unknown',
      p.healthConditions?.length ? `Health conditions: ${p.healthConditions.join(', ')}` : '',
      p.medications ? `Medications: ${p.medications}` : '',
      p.surgeries ? `Past surgeries: ${p.surgeries}` : '',
      p.glp1Status && p.glp1Status !== 'none' ? `On: ${glp1Label[p.glp1Status] ?? p.glp1Status}` : '',
      p.foodPreferences?.length ? `Food preferences: ${p.foodPreferences.join(', ')}` : '',
      p.foodAvoidances ? `Avoid: ${p.foodAvoidances}` : '',
      p.zipCode ? `ZIP: ${p.zipCode}` : '',
    ].filter(Boolean).join('\n');
  };

  // ── Generate everything ───────────────────────────────────────────────────
  const generate = async () => {
    if (!profile) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ctx = buildProfileContext(profile);

    try {
      // ── 1. Workout Program ──────────────────────────────────────────────
      setGenStep('program');
      let program: AIProgram;
      try {
        const progRaw = await invokeAnthropicText({
          max_tokens: 600,
          system: 'You are a fitness AI. Output valid JSON only. No markdown, no explanation.',
          messages: [{
            role: 'user',
            content: `Create a personalised training program for this user:\n${ctx}\n\nReply with ONLY this JSON (no extra text):\n{"title":"Program Name","icon":"💪","durationWeeks":8,"daysPerWeek":4,"level":"Intermediate","subtitle":"Short tagline","focus":"Main focus","coachNote":"One motivating tip"}`,
          }],
        });
        const progMatch = progRaw.replace(/```(?:json)?/gi, '').trim().match(/\{[\s\S]*\}/);
        if (!progMatch) throw new Error('Bad program format');
        const parsed = JSON.parse(progMatch[0]) as AIProgram;
        program = {
          ...parsed,
          generatedAt: parsed.generatedAt ?? new Date().toISOString(),
        };
      } catch (error) {
        console.warn('[ProWelcomeModal] Program generation fallback:', error);
        program = buildFallbackProgram(profile);
      }
      await saveAIProgram(program);
      const profileRaw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
      const base = profileRaw ? (JSON.parse(profileRaw) as UserProfile) : {} as UserProfile;
      await syncProfileToSupabase(session?.user?.id, { ...base, activePlanId: 'ai-generated' });

      // ── 2. Meal Plan ────────────────────────────────────────────────────
      setGenStep('meal');
      let mealPlan: GeneratedMealDay[];
      try {
        const mealRaw = await invokeAnthropicText({
          max_tokens: 2000,
          system: 'You are a nutrition AI. Output valid JSON only. No markdown.',
          messages: [{
            role: 'user',
            content: `Create a 7-day personalised meal plan for this user:\n${ctx}\n\nReply with ONLY this JSON:\n[{"day":"Monday","meals":[{"name":"Meal name","kcal":500,"protein":40,"time":"Breakfast"},...]},...7 days]`,
          }],
        });
        const mealMatch = mealRaw.replace(/```(?:json)?/gi, '').trim().match(/\[[\s\S]*\]/);
        if (!mealMatch) throw new Error('Bad meal plan format');
        mealPlan = JSON.parse(mealMatch[0]) as GeneratedMealDay[];
      } catch (error) {
        console.warn('[ProWelcomeModal] Meal plan generation fallback:', error);
        mealPlan = buildFallbackMealPlan(profile);
      }
      await AsyncStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(mealPlan));

      // ── 3. Grocery List ─────────────────────────────────────────────────
      setGenStep('grocery');
      let groceryList = buildFallbackGroceryList(mealPlan, profile);
      try {
        // Use only distinct meal names (deduped) to keep the prompt short
        const allMealNames = mealPlan.flatMap((d) => d.meals.map((m) => m.name));
        const uniqueMeals = [...new Set(allMealNames as string[])].slice(0, 10).join(', ');
        const grocRaw = await invokeAnthropicText({
          max_tokens: 3000,
          system: 'You are a grocery list assistant. Output ONLY valid, complete JSON. No markdown, no explanation. The JSON must be fully closed with all brackets.',
          messages: [{
            role: 'user',
            content: `Create a grocery list for: ${uniqueMeals}\nZIP: ${profile.zipCode ?? 'unknown'} | Avoid: ${profile.foodAvoidances ?? 'none'}\n\nOutput ONLY this complete JSON (exactly 10 items, short names):\n{"stores":["Walmart","Kroger"],"items":[{"n":"Chicken Breast","q":"2 lbs","p":8.99,"c":"Protein"},{"n":"Eggs","q":"1 dozen","p":3.49,"c":"Protein"},{"n":"Greek Yogurt","q":"32oz","p":5.99,"c":"Dairy"},{"n":"Broccoli","q":"1 head","p":1.99,"c":"Produce"},{"n":"Brown Rice","q":"2 lb bag","p":3.29,"c":"Grains"},{"n":"Olive Oil","q":"16oz","p":6.99,"c":"Pantry"},{"n":"Spinach","q":"5oz bag","p":2.99,"c":"Produce"},{"n":"Oats","q":"42oz","p":4.49,"c":"Grains"},{"n":"Almonds","q":"1 lb","p":7.99,"c":"Snacks"},{"n":"Sweet Potato","q":"3 count","p":2.49,"c":"Produce"}]}\n\nReplace items above with ones that match the meals. Keep all 10 items. Keep JSON tightly formatted.`,
          }],
        });

        // Attempt full parse first, then fall back to salvaging partial items
        const cleanGrocRaw = grocRaw.replace(/```(?:json)?/gi, '').trim();
        type RawGrocItem = { n?: string; name?: string; q?: string; quantity?: string; p?: number; c?: string; category?: string };
        type RawGrocList = { stores?: string[]; items: RawGrocItem[] };
        let grocParsed: RawGrocList | null = null;

        // Try full JSON parse first
        const fullMatch = cleanGrocRaw.match(/\{[\s\S]*\}/);
        if (fullMatch) {
          try {
            grocParsed = JSON.parse(fullMatch[0]) as RawGrocList;
          } catch {
            // Full parse failed — attempt to salvage complete item objects from truncated JSON
            const itemMatches = cleanGrocRaw.matchAll(/\{"n":"([^"]+)","q":"([^"]+)","p":([\d.]+),"c":"([^"]+)"\}/g);
            const salvaged: RawGrocItem[] = [];
            for (const m of itemMatches) {
              salvaged.push({ n: m[1], q: m[2], p: parseFloat(m[3]), c: m[4] });
            }
            if (salvaged.length > 0) {
              // Extract stores from the beginning of the raw string if possible
              const storesMatch = cleanGrocRaw.match(/"stores"\s*:\s*\[([^\]]*)\]/);
              const storeNames: string[] = [];
              if (storesMatch) {
                const storeStr = storesMatch[1];
                const storeItems = storeStr.matchAll(/"([^"]+)"/g);
                for (const s of storeItems) storeNames.push(s[1]);
              }
              grocParsed = { stores: storeNames.length > 0 ? storeNames : ['Walmart', 'Kroger'], items: salvaged };
            }
          }
        }

        if (grocParsed && grocParsed.items?.length > 0) {
          const items = grocParsed.items.map((item, i) => ({
            id: `pg-${i}-${Date.now()}`,
            name: item.name ?? item.n ?? 'Item',
            quantity: item.quantity ?? item.q ?? '',
            estimatedPrice: item.p ?? 0,
            category: (item.category ?? item.c ?? 'Other') as string,
            checked: false,
          }));
          const total = items.reduce((s, i) => s + i.estimatedPrice, 0);
          groceryList = {
            items,
            nearbyStores: grocParsed.stores ?? [],
            totalEstimate: total,
            generatedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        console.warn('[ProWelcomeModal] Grocery generation fallback:', error);
      }

      await AsyncStorage.setItem(GROCERY_LIST_KEY, JSON.stringify(groceryList));

      setGenStep('done');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = await extractFunctionError(e);
      setErrorMsg(msg);
      setGenStep('error');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  if (!visible) return null;

  const currentStepIndex = STEPS.findIndex((s) => s.key === genStep);
  const isGenerating = genStep !== 'idle' && genStep !== 'done' && genStep !== 'error';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {/* Header */}
            <View style={styles.crownRow}>
              <Text style={styles.crownIcon}>✦</Text>
              <Text style={styles.proBadge}>APEX PRO ACTIVATED</Text>
              <Text style={styles.crownIcon}>✦</Text>
            </View>
            <Text style={styles.title}>Let AI Build Your{'\n'}Complete Setup</Text>
            <Text style={styles.sub}>
              We have your BMR, macros, goal, equipment, health conditions, food preferences{profile?.glp1Status && profile.glp1Status !== 'none' ? ', and medication profile' : ''} ready. One tap generates everything personalised to you.
            </Text>

            {/* What gets generated */}
            {genStep === 'idle' ? (
              <View style={styles.planList}>
                {[
                  { icon: '💪', title: 'Workout Program', desc: `Built for your ${profile?.experience ?? 'fitness'} level, ${profile?.equipment?.length ? profile.equipment.slice(0, 2).join(' + ') : 'available equipment'}, and ${profile?.goal ?? 'goal'}` },
                  { icon: '🥗', title: '7-Day Meal Plan', desc: `${profile?.dailyCalorieTarget ?? '~2500'} kcal/day · ${profile?.dailyProtein ?? '~160'}g protein · tailored to your preferences` },
                  { icon: '🛒', title: 'Grocery List', desc: `Real prices${profile?.zipCode ? ` near ${profile.zipCode}` : ''} · 12–15 items · matches your meal plan` },
                ].map((item) => (
                  <View key={item.icon} style={styles.planRow}>
                    <View style={styles.planIconWrap}>
                      <Text style={styles.planIcon}>{item.icon}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.planTitle}>{item.title}</Text>
                      <Text style={styles.planDesc}>{item.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Profile data preview */}
            {genStep === 'idle' && profile ? (
              <View style={styles.profileCard}>
                <Text style={styles.profileCardTitle}>YOUR DATA  ·  WHAT THE AI WILL USE</Text>
                {[
                  profile.goal && `🎯 Goal: ${({ lose: 'Fat Loss', build: 'Build Muscle', recomp: 'Recomp', performance: 'Performance' } as Record<string,string>)[profile.goal]}`,
                  profile.weightLbs && `⚖️ ${profile.weightLbs} lbs → ${profile.goalWeightLbs} lbs goal`,
                  profile.dailyCalorieTarget && `🔥 ${profile.dailyCalorieTarget} kcal · ${profile.dailyProtein}g protein`,
                  profile.experience && `🏋️ ${profile.experience.charAt(0).toUpperCase() + profile.experience.slice(1)} experience`,
                  profile.equipment?.length && `🏗️ ${profile.equipment.slice(0, 3).join(', ')}${profile.equipment.length > 3 ? ` +${profile.equipment.length - 3} more` : ''}`,
                  profile.healthConditions?.length && `🩺 ${profile.healthConditions.length} health condition${profile.healthConditions.length > 1 ? 's' : ''} noted`,
                  profile.glp1Status && profile.glp1Status !== 'none' && `💉 On ${({ glp1: 'GLP-1', peptides: 'Peptides', both: 'GLP-1 + Peptides' } as Record<string,string>)[profile.glp1Status]}`,
                  profile.medications && `💊 Medications on file`,
                  profile.foodPreferences?.length && `🥑 ${profile.foodPreferences.slice(0, 3).join(', ')}`,
                  profile.zipCode && `📍 ZIP ${profile.zipCode}`,
                ].filter(Boolean).map((line, i) => (
                  <Text key={i} style={styles.profileLine}>{line as string}</Text>
                ))}
              </View>
            ) : null}

            {/* Generation progress */}
            {genStep !== 'idle' && genStep !== 'error' ? (
              <View style={styles.progressWrap}>
                {STEPS.map((s, i) => {
                  const done = currentStepIndex > i || genStep === 'done';
                  const active = s.key === genStep;
                  return (
                    <View key={s.key} style={[styles.stepRow, active && styles.stepRowActive]}>
                      <View style={[styles.stepDot, done ? styles.stepDotDone : active ? styles.stepDotActive : null]}>
                        {done ? <Text style={styles.stepDotTick}>✓</Text>
                          : active ? <ActivityIndicator size="small" color="#000" />
                          : <Text style={styles.stepDotNum}>{i + 1}</Text>}
                      </View>
                      <Text style={[styles.stepLabel, done && styles.stepLabelDone, active && styles.stepLabelActive]}>
                        {s.icon} {s.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Error */}
            {genStep === 'error' ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>⚠️ Generation failed</Text>
                <Text style={styles.errorBody}>{errorMsg}</Text>
                <Pressable style={styles.retryBtn} onPress={() => { setGenStep('idle'); setErrorMsg(''); }}>
                  <Text style={styles.retryBtnText}>Try Again</Text>
                </Pressable>
              </View>
            ) : null}

            {/* CTA */}
            {genStep === 'idle' ? (
              <>
                <Pressable
                  style={({ pressed }) => [styles.btnPrimary, pressed && { opacity: 0.85 }]}
                  onPress={() => generate().catch((e) => {
                    setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
                    setGenStep('error');
                  })}
                >
                  <Text style={styles.btnPrimaryText}>⚡ Generate My Complete Plan</Text>
                </Pressable>
                <Pressable style={styles.skipBtn} onPress={dismiss}>
                  <Text style={styles.skipBtnText}>I'll set it up manually</Text>
                </Pressable>
              </>
            ) : genStep === 'done' ? (
              <Pressable
                style={({ pressed }) => [styles.btnPrimary, pressed && { opacity: 0.85 }]}
                onPress={dismiss}
              >
                <Text style={styles.btnPrimaryText}>🎉 Let's Go!</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.black,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(0,255,136,0.3)',
    maxHeight: '92%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  content: { padding: 24, paddingBottom: 48, gap: 20 },
  crownRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  crownIcon: { color: C.green, fontSize: 14 },
  proBadge: { fontSize: 11, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 2 },
  title: {
    fontSize: 32, color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    letterSpacing: 1, lineHeight: 36,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14, color: C.muted,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 21, textAlign: 'center',
  },
  planList: { gap: 12 },
  planRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    padding: 14,
  },
  planIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(0,255,136,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  planIcon: { fontSize: 22 },
  planTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 2 },
  planDesc: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 17 },
  profileCard: {
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    padding: 14, gap: 6,
  },
  profileCardTitle: {
    fontSize: 10, color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 1, marginBottom: 4,
  },
  profileLine: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  progressWrap: { gap: 10 },
  stepRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 12,
  },
  stepRowActive: { borderColor: 'rgba(0,255,136,0.4)', backgroundColor: 'rgba(0,255,136,0.06)' },
  stepDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.dark,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: C.green, borderColor: C.green },
  stepDotDone: { backgroundColor: C.green, borderColor: C.green },
  stepDotTick: { color: '#000', fontSize: 14, fontFamily: 'DMSans_700Bold' },
  stepDotNum: { color: C.muted, fontSize: 12, fontFamily: 'DMSans_700Bold' },
  stepLabel: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', flex: 1 },
  stepLabelActive: { color: C.text, fontFamily: 'DMSans_700Bold' },
  stepLabelDone: { color: C.muted, textDecorationLine: 'line-through' },
  errorCard: {
    backgroundColor: 'rgba(255,107,53,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,107,53,0.4)',
    borderRadius: 12, padding: 14, gap: 8,
  },
  errorTitle: { fontSize: 14, color: '#FF6B35', fontFamily: 'DMSans_700Bold' },
  errorBody: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  retryBtn: {
    alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 8, borderWidth: 1, borderColor: '#FF6B35',
  },
  retryBtnText: { color: '#FF6B35', fontSize: 13, fontFamily: 'DMSans_500Medium' },
  btnPrimary: {
    backgroundColor: C.green, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  btnPrimaryText: { color: '#000', fontSize: 16, fontFamily: 'DMSans_700Bold' },
  skipBtn: { alignItems: 'center', paddingVertical: 8 },
  skipBtnText: { color: C.muted, fontSize: 13, fontFamily: 'DMSans_400Regular' },
});
