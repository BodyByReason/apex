/**
 * WalkWaterFuelScreen
 *
 * Walk & Water Challenge Edition — Fuel tab.
 * Water tracker + macro targets at the top.
 * 3 meal sections (Breakfast / Lunch / Dinner), each showing
 * one card at a time from a pool of 5.
 *
 * Card front: meal name, calories, macros.
 * Card back (tap to flip): photo + ingredients + instructions.
 * Refresh icon: cycles to next meal in pool.
 * Heart icon: saves meal to AsyncStorage.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addWaterOz,
  getWalkWaterPlan,
  getWaterOzToday,
  type WalkGoal,
  type WalkWaterPlan,
} from '@/lib/walkWaterMode';
import {
  WW_MEAL_CATEGORIES,
  getMealsByCategory,
  type WWMeal,
} from '@/lib/wwMeals';
import FoodScanModal, { type ScannedFood } from '@/components/FoodScanModal';
import { addFoodLogEntry, getFoodLogToday, type FoodLogTotals } from '@/lib/wwFoodLog';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black:      '#050A14',
  card:       '#0D1B2A',
  border:     '#1A2E45',
  blue:       '#0EA5E9',
  teal:       '#06B6D4',
  orange:     '#F59E0B',
  blueSoft:   'rgba(14,165,233,0.08)',
  blueBorder: 'rgba(14,165,233,0.2)',
  tealSoft:   'rgba(6,182,212,0.08)',
  tealBorder: 'rgba(6,182,212,0.2)',
  text:       '#F0F8FF',
  muted:      '#6B8BA4',
};

const SAVED_MEALS_KEY   = 'apex.ww.savedMeals';
const MEAL_INDICES_KEY  = 'apex.ww.mealIndices';

// ─── FlipCard ─────────────────────────────────────────────────────────────────

function FlipCard({
  meal,
  saved,
  onToggleSave,
  onRefresh,
}: {
  meal: WWMeal;
  saved: boolean;
  onToggleSave: () => void;
  onRefresh: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  // Reset flip when the meal changes (after refresh)
  useEffect(() => {
    setFlipped(false);
    flipAnim.setValue(0);
  }, [meal.id, flipAnim]);

  const handleFlip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    const toValue = flipped ? 0 : 1;
    Animated.spring(flipAnim, {
      toValue,
      friction: 8,
      tension: 60,
      useNativeDriver: true,
    }).start();
    setFlipped(!flipped);
  };

  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const backRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.5, 1],
    outputRange: [1, 1, 0, 0],
  });

  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  return (
    <View style={flipStyles.container}>
      {/* Front — name, calories, macros */}
      <Animated.View
        style={[
          flipStyles.card,
          { transform: [{ perspective: 1200 }, { rotateY: frontRotate }], opacity: frontOpacity },
        ]}
        pointerEvents={flipped ? 'none' : 'auto'}
      >
        {/* Front — large image fills top, tap hint + name + macros below */}
        <Pressable style={flipStyles.inner} onPress={handleFlip}>
          <View style={flipStyles.imageBox}>
            {meal.imageUrl ? (
              <Image source={{ uri: meal.imageUrl }} style={flipStyles.image} resizeMode="cover" />
            ) : (
              <View style={flipStyles.imagePlaceholder}>
                <Text style={flipStyles.imagePlaceholderEmoji}>
                  {meal.category === 'breakfast' ? '🌅' : meal.category === 'lunch' ? '☀️' : '🌙'}
                </Text>
                <Text style={flipStyles.imagePlaceholderText}>Photo coming soon</Text>
              </View>
            )}
          </View>

          {/* Tap hint → name → macros, no dead space */}
          <View style={flipStyles.frontBody}>
            <Text style={flipStyles.tapHint}>Tap to see recipe →</Text>
            <Text style={flipStyles.mealName}>{meal.name}</Text>
            <View style={flipStyles.macroRow}>
              <View style={flipStyles.macroPill}>
                <Text style={flipStyles.macroVal}>{meal.macros.calories}</Text>
                <Text style={flipStyles.macroLbl}>CAL</Text>
              </View>
              <View style={flipStyles.macroDivider} />
              <View style={flipStyles.macroPill}>
                <Text style={[flipStyles.macroVal, { color: WW.blue }]}>{meal.macros.protein}g</Text>
                <Text style={flipStyles.macroLbl}>PROTEIN</Text>
              </View>
              <View style={flipStyles.macroDivider} />
              <View style={flipStyles.macroPill}>
                <Text style={[flipStyles.macroVal, { color: WW.teal }]}>{meal.macros.carbs}g</Text>
                <Text style={flipStyles.macroLbl}>CARBS</Text>
              </View>
              <View style={flipStyles.macroDivider} />
              <View style={flipStyles.macroPill}>
                <Text style={[flipStyles.macroVal, { color: WW.orange }]}>{meal.macros.fat}g</Text>
                <Text style={flipStyles.macroLbl}>FAT</Text>
              </View>
            </View>
          </View>

          {/* Actions row */}
          <View style={flipStyles.actionsRow}>
            <Pressable
              style={flipStyles.actionBtn}
              onPress={(e) => { e.stopPropagation?.(); onToggleSave(); }}
            >
              <Text style={flipStyles.actionIcon}>{saved ? '❤️' : '🤍'}</Text>
              <Text style={flipStyles.actionLabel}>{saved ? 'Saved' : 'Save'}</Text>
            </Pressable>
            <Pressable
              style={flipStyles.actionBtn}
              onPress={(e) => { e.stopPropagation?.(); onRefresh(); }}
            >
              <Text style={flipStyles.actionIcon}>🔄</Text>
              <Text style={flipStyles.actionLabel}>Different meal</Text>
            </Pressable>
          </View>
        </Pressable>
      </Animated.View>

      {/* Back — scrollable ingredients & instructions */}
      <Animated.View
        style={[
          flipStyles.card,
          flipStyles.cardBack,
          { transform: [{ perspective: 1200 }, { rotateY: backRotate }], opacity: backOpacity },
        ]}
        pointerEvents={flipped ? 'auto' : 'none'}
      >
        {/* Header taps to flip back; body scrolls independently */}
        <Pressable style={flipStyles.backHeader} onPress={handleFlip}>
          <Text style={flipStyles.backTitle}>{meal.name}</Text>
          <Text style={flipStyles.backHint}>← Tap to flip back</Text>
        </Pressable>

        <ScrollView
          style={flipStyles.backScroll}
          contentContainerStyle={flipStyles.backScrollContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <Text style={flipStyles.backSectionLabel}>INGREDIENTS</Text>
          <View style={flipStyles.ingredientList}>
            {meal.ingredients.map((ing, i) => (
              <View key={i} style={flipStyles.ingredientRow}>
                <Text style={flipStyles.ingredientDot}>·</Text>
                <Text style={flipStyles.ingredientText}>{ing}</Text>
              </View>
            ))}
          </View>

          <Text style={flipStyles.backSectionLabel}>HOW TO MAKE IT</Text>
          <View style={flipStyles.instructionList}>
            {meal.instructions.map((step, i) => (
              <View key={i} style={flipStyles.instructionRow}>
                <View style={flipStyles.stepNumber}>
                  <Text style={flipStyles.stepNumberText}>{i + 1}</Text>
                </View>
                <Text style={flipStyles.instructionText}>{step}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

// ─── LogBar ───────────────────────────────────────────────────────────────────

function LogBar({ color, done, pct }: { color: string; done: boolean; pct: number }) {
  const fillAnim  = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const wasDoneRef = useRef(false);

  useEffect(() => {
    Animated.spring(fillAnim, { toValue: pct, useNativeDriver: false, tension: 60, friction: 8 }).start();
    if (done && !wasDoneRef.current) {
      wasDoneRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
      Animated.sequence([
        Animated.spring(scaleAnim, { toValue: 1.08, useNativeDriver: true, tension: 250, friction: 4 }),
        Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true, tension: 250, friction: 4 }),
      ]).start();
    } else if (!done) {
      wasDoneRef.current = false;
    }
  }, [pct, done, fillAnim, scaleAnim]);

  return (
    <Animated.View style={[logBarStyles.track, { transform: [{ scaleY: scaleAnim }] }]}>
      <Animated.View
        style={[logBarStyles.fill, {
          backgroundColor: done ? '#22C55E' : color,
          width: fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }]}
      />
    </Animated.View>
  );
}

const logBarStyles = StyleSheet.create({
  track: { height: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  fill:  { height: '100%', borderRadius: 3 },
});

// ─── WalkWaterFuelScreen ──────────────────────────────────────────────────────

export default function WalkWaterFuelScreen() {
  const insets = useSafeAreaInsets();

  const [plan, setPlan]           = useState<WalkWaterPlan | null>(null);
  const [waterOz, setWaterOz]     = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [savedIds, setSavedIds]   = useState<Set<string>>(new Set());
  const [scanVisible, setScanVisible] = useState(false);
  const [lastScan, setLastScan]   = useState<ScannedFood | null>(null);
  const [foodTotals, setFoodTotals] = useState<FoodLogTotals>({ calories: 0, carbs: 0, entries: [], fat: 0, protein: 0 });

  // Per-category current index in the pool
  const [mealIndices, setMealIndices] = useState<Record<string, number>>({
    breakfast: 0, lunch: 0, dinner: 0,
  });

  const load = useCallback(async () => {
    const [p, oz, savedRaw, indicesRaw, totals] = await Promise.all([
      getWalkWaterPlan(),
      getWaterOzToday(),
      AsyncStorage.getItem(SAVED_MEALS_KEY).catch(() => null),
      AsyncStorage.getItem(MEAL_INDICES_KEY).catch(() => null),
      getFoodLogToday(),
    ]);
    setPlan(p);
    setWaterOz(oz);
    setFoodTotals(totals);
    if (savedRaw) setSavedIds(new Set(JSON.parse(savedRaw) as string[]));
    if (indicesRaw) setMealIndices(JSON.parse(indicesRaw));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleAddWater = useCallback(async (oz: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = await addWaterOz(oz);
    setWaterOz(next);
  }, []);

  const handleToggleSave = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      AsyncStorage.setItem(SAVED_MEALS_KEY, JSON.stringify([...next])).catch(() => null);
      return next;
    });
  }, []);

  const handleRefreshMeal = useCallback((category: WWMeal['category']) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    const pool = getMealsByCategory(category);
    setMealIndices(prev => {
      const next = { ...prev, [category]: (prev[category] + 1) % pool.length };
      AsyncStorage.setItem(MEAL_INDICES_KEY, JSON.stringify(next)).catch(() => null);
      return next;
    });
  }, []);

  const waterGoalOz    = plan?.dailyWaterGoalOz ?? 64;
  const waterGlasses   = Math.round(waterOz / 8);
  const waterGlassGoal = Math.round(waterGoalOz / 8);
  const waterPct       = Math.min(1, waterOz / waterGoalOz);

  const waterFillAnim = useRef(new Animated.Value(waterPct)).current;
  useEffect(() => {
    Animated.spring(waterFillAnim, {
      toValue: waterPct,
      useNativeDriver: false,
      tension: 60,
      friction: 8,
    }).start();
  }, [waterPct, waterFillAnim]);
  const goalKey        = (plan as any)?.primaryGoal as WalkGoal | undefined;

  const macros = (() => {
    switch (goalKey) {
      case 'lose_weight':  return { protein: '130g', carbs: '150g', fat: '55g',  cal: '1,600' };
      case 'more_energy':  return { protein: '120g', carbs: '220g', fat: '65g',  cal: '1,950' };
      case 'build_habit':  return { protein: '125g', carbs: '190g', fat: '60g',  cal: '1,800' };
      case 'feel_better':  return { protein: '120g', carbs: '180g', fat: '65g',  cal: '1,800' };
      default:             return { protein: '125g', carbs: '190g', fat: '60g',  cal: '1,800' };
    }
  })();

  const macroNums = (() => {
    switch (goalKey) {
      case 'lose_weight':  return { protein: 130, carbs: 150, fat: 55,  cal: 1600 };
      case 'more_energy':  return { protein: 120, carbs: 220, fat: 65,  cal: 1950 };
      case 'build_habit':  return { protein: 125, carbs: 190, fat: 60,  cal: 1800 };
      case 'feel_better':  return { protein: 120, carbs: 180, fat: 65,  cal: 1800 };
      default:             return { protein: 125, carbs: 190, fat: 60,  cal: 1800 };
    }
  })();

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={WW.teal} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>APEX FUEL</Text>
        <Text style={styles.title}>Fuel the{'\n'}walk forward.</Text>
        <Text style={styles.sub}>
          Simple nutrition to support your movement every day.
        </Text>
      </View>

      {/* Water tracker */}
      <View style={styles.waterCard}>
        <View style={styles.waterCardHeader}>
          <Text style={styles.waterCardEyebrow}>TODAY'S HYDRATION</Text>
          <Text style={styles.waterCardValue}>
            <Text style={styles.waterCardNum}>{waterGlasses}</Text>
            <Text style={styles.waterCardDenom}> / {waterGlassGoal} glasses</Text>
          </Text>
        </View>
        <View style={styles.waterTrack}>
          <Animated.View style={[styles.waterFill, { width: waterFillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        </View>
        <Text style={styles.waterPct}>{Math.round(waterPct * 100)}% of daily goal</Text>
        <View style={styles.waterBtnsRow}>
          {[8, 12, 16, 20].map((oz) => (
            <Pressable key={oz} style={styles.waterBtn} onPress={() => handleAddWater(oz)}>
              <Text style={styles.waterBtnOz}>{oz} oz</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Nutrition hub — targets, log, and scanner in one card */}
      <View style={styles.macroCard}>
        {/* Targets row */}
        <Text style={styles.macroEyebrow}>DAILY TARGETS FOR YOUR GOAL</Text>
        <View style={styles.macroRow}>
          <View style={styles.macro}>
            <Text style={styles.macroValue}>{macros.protein}</Text>
            <Text style={styles.macroLabel}>PROTEIN</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macro}>
            <Text style={[styles.macroValue, { color: WW.teal }]}>{macros.carbs}</Text>
            <Text style={styles.macroLabel}>CARBS</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macro}>
            <Text style={[styles.macroValue, { color: WW.orange }]}>{macros.fat}</Text>
            <Text style={styles.macroLabel}>FAT</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macro}>
            <Text style={styles.macroValue}>{macros.cal}</Text>
            <Text style={styles.macroLabel}>CALORIES</Text>
          </View>
        </View>

        <View style={styles.logDivider} />

        {/* Logged row */}
        <Text style={styles.macroEyebrow}>TODAY'S LOG</Text>
        <View style={styles.macroRow}>
          {([
            { key: 'protein'  as const, label: 'PROTEIN',  logged: foodTotals.protein,  target: macroNums.protein, color: WW.blue,   unit: 'g' },
            { key: 'carbs'    as const, label: 'CARBS',    logged: foodTotals.carbs,    target: macroNums.carbs,   color: WW.teal,   unit: 'g' },
            { key: 'fat'      as const, label: 'FAT',      logged: foodTotals.fat,      target: macroNums.fat,     color: WW.orange, unit: 'g' },
            { key: 'calories' as const, label: 'CALORIES', logged: foodTotals.calories, target: macroNums.cal,     color: WW.blue,   unit: ''  },
          ]).map(({ key, label, logged, target, color, unit }, idx, arr) => {
            const pct  = Math.min(1, target > 0 ? logged / target : 0);
            const done = pct >= 1;
            return (
              <React.Fragment key={key}>
                <View style={styles.macro}>
                  <Text style={[styles.macroValue, { color: done ? '#22C55E' : color }]}>{logged}{unit}</Text>
                  <Text style={styles.macroLabel}>{label}</Text>
                  <LogBar pct={pct} color={color} done={done} />
                </View>
                {idx < arr.length - 1 ? <View style={styles.macroDivider} /> : null}
              </React.Fragment>
            );
          })}
        </View>

        <View style={styles.logDivider} />

        {/* Scanner tap row */}
        <Pressable
          style={styles.scannerRow}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null); setScanVisible(true); }}
        >
          <Text style={styles.scannerRowEmoji}>📷</Text>
          <Text style={styles.scannerRowText}>Snap what you eat — AI reads the macros</Text>
          <Text style={styles.scannerRowArrow}>→</Text>
        </Pressable>
      </View>

      {lastScan ? (
        <View style={styles.lastScanCard}>
          <Text style={styles.lastScanLabel}>LAST SCANNED</Text>
          <Text style={styles.lastScanName}>{lastScan.name}</Text>
          <View style={styles.lastScanMacros}>
            {([['cal', lastScan.calories], ['pro', lastScan.protein + 'g'], ['carbs', lastScan.carbs + 'g'], ['fat', lastScan.fat + 'g']] as const).map(([label, val]) => (
              <View key={label} style={styles.lastScanMacro}>
                <Text style={styles.lastScanVal}>{val}</Text>
                <Text style={styles.lastScanKey}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <FoodScanModal
        variant="ww"
        visible={scanVisible}
        onClose={() => setScanVisible(false)}
        onResult={async (food) => {
          setLastScan(food);
          setScanVisible(false);
          const totals = await addFoodLogEntry(food);
          setFoodTotals(totals);
        }}
      />

      {/* Meal sections */}
      {WW_MEAL_CATEGORIES.map(cat => {
        const pool    = getMealsByCategory(cat.key);
        const idx     = mealIndices[cat.key] ?? 0;
        const meal    = pool[idx % pool.length];
        return (
          <View key={cat.key} style={styles.mealSection}>
            <View style={styles.mealSectionHeader}>
              <Text style={styles.mealSectionEmoji}>{cat.emoji}</Text>
              <Text style={styles.mealSectionLabel}>{cat.label.toUpperCase()}</Text>
              <Text style={styles.mealPoolHint}>{(idx % pool.length) + 1} / {pool.length}</Text>
            </View>
            <FlipCard
              meal={meal}
              saved={savedIds.has(meal.id)}
              onToggleSave={() => handleToggleSave(meal.id)}
              onRefresh={() => handleRefreshMeal(cat.key)}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: WW.black },
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 20 },

  header:  { gap: 6, marginBottom: 4 },
  eyebrow: { fontSize: 9, color: WW.teal, fontWeight: '700', letterSpacing: 2 },
  title:   { fontSize: 34, color: WW.text, fontWeight: '900', letterSpacing: -0.6, lineHeight: 40 },
  sub:     { fontSize: 14, color: WW.muted, lineHeight: 21, fontWeight: '500' },

  waterCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.tealBorder,
    borderRadius: 16, padding: 16, gap: 10,
  },
  waterCardHeader:  { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  waterCardEyebrow: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.2 },
  waterCardValue:   {},
  waterCardNum:     { fontSize: 26, color: WW.teal, fontWeight: '900' },
  waterCardDenom:   { fontSize: 13, color: WW.muted, fontWeight: '600' },
  waterTrack: { height: 6, backgroundColor: WW.border, borderRadius: 3, overflow: 'hidden' },
  waterFill:  { height: '100%', backgroundColor: WW.teal, borderRadius: 3 },
  waterPct:   { fontSize: 11, color: WW.teal, fontWeight: '700' },
  waterBtnsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  waterBtn: {
    flex: 1, backgroundColor: WW.tealSoft, borderWidth: 1, borderColor: WW.tealBorder,
    borderRadius: 10, paddingVertical: 10, alignItems: 'center',
  },
  waterBtnOz: { fontSize: 13, color: WW.teal, fontWeight: '800' },

  macroCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 16, padding: 16, gap: 12,
  },
  macroEyebrow: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.2 },
  macroRow:     { flexDirection: 'row', alignItems: 'center' },
  macro:        { flex: 1, alignItems: 'center', gap: 4 },
  macroValue:   { fontSize: 18, color: WW.blue, fontWeight: '900', letterSpacing: -0.3 },
  macroLabel:   { fontSize: 8, color: WW.muted, fontWeight: '700', letterSpacing: 0.8 },
  macroDivider: { width: 1, height: 36, backgroundColor: WW.border },
  logDivider: { height: 1, backgroundColor: WW.border, marginVertical: 2 },

  scannerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  scannerRowEmoji: { fontSize: 18 },
  scannerRowText:  { flex: 1, fontSize: 13, color: WW.blue, fontWeight: '600' },
  scannerRowArrow: { fontSize: 16, color: WW.blue, fontWeight: '700' },

  lastScanCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 12, padding: 12, gap: 6,
  },
  lastScanLabel: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.2 },
  lastScanName:  { fontSize: 14, color: WW.text, fontWeight: '700' },
  lastScanMacros: { flexDirection: 'row', gap: 16, marginTop: 2 },
  lastScanMacro:  { alignItems: 'center', gap: 1 },
  lastScanVal:    { fontSize: 15, color: WW.blue, fontWeight: '800' },
  lastScanKey:    { fontSize: 9, color: WW.muted, fontWeight: '600', letterSpacing: 0.5 },

  mealSection: { gap: 10 },
  mealSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealSectionEmoji:  { fontSize: 16 },
  mealSectionLabel:  { fontSize: 10, color: WW.muted, fontWeight: '700', letterSpacing: 1.5, flex: 1 },
  mealPoolHint:      { fontSize: 10, color: WW.muted, fontWeight: '500' },
});

const flipStyles = StyleSheet.create({
  container: { height: 520 },

  card: {
    position: 'absolute', width: '100%', height: '100%',
    backfaceVisibility: 'hidden',
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 16, overflow: 'hidden',
  },
  cardBack: {
    backgroundColor: '#0A1520',
  },
  inner: { flex: 1, flexDirection: 'column' },

  // Front
  imageBox: { flex: 1 },
  image:    { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#0A1520',
  },
  imagePlaceholderEmoji: { fontSize: 40 },
  imagePlaceholderText:  { fontSize: 12, color: WW.muted, fontWeight: '500' },

  tapHint: { fontSize: 11, color: WW.muted, fontWeight: '500' },

  frontBody: { padding: 14, paddingTop: 10, paddingBottom: 12, gap: 6 },
  mealName:    { fontSize: 17, color: WW.text, fontWeight: '800', letterSpacing: -0.2 },
  mealTagline: { fontSize: 12, color: WW.muted, lineHeight: 17 },

  macroRow: { flexDirection: 'row', alignItems: 'center' },
  macroPill:   { flex: 1, alignItems: 'center', gap: 2 },
  macroVal:    { fontSize: 16, color: WW.text, fontWeight: '900', letterSpacing: -0.3 },
  macroLbl:    { fontSize: 7, color: WW.muted, fontWeight: '700', letterSpacing: 0.8 },
  macroDivider:{ width: 1, height: 28, backgroundColor: WW.border },

  actionsRow: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: WW.border,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
  },
  actionIcon:  { fontSize: 14 },
  actionLabel: { fontSize: 12, color: WW.muted, fontWeight: '600' },

  // Back
  backHeader: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: WW.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backTitle:  { fontSize: 16, color: WW.text, fontWeight: '800', flex: 1 },
  backHint:   { fontSize: 10, color: WW.muted, fontWeight: '500' },
  backScroll: { flex: 1 },
  backScrollContent: { paddingBottom: 20 },

  backSectionLabel: {
    fontSize: 8, color: WW.muted, fontWeight: '700', letterSpacing: 1.5,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },

  ingredientList: { paddingHorizontal: 16, gap: 4 },
  ingredientRow:  { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  ingredientDot:  { fontSize: 14, color: WW.teal, lineHeight: 20 },
  ingredientText: { fontSize: 13, color: WW.text, lineHeight: 20, flex: 1 },

  instructionList: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  instructionRow:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNumber: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: WW.blueSoft, borderWidth: 1, borderColor: WW.blueBorder,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stepNumberText:  { fontSize: 10, color: WW.blue, fontWeight: '800' },
  instructionText: { fontSize: 13, color: WW.text, lineHeight: 20, flex: 1 },
});
