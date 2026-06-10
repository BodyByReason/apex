import React from 'react';

import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Alert, AppState, type AppStateStatus, Image, Modal, PanResponder, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import Svg, { Circle, Polyline, Text as SvgText } from 'react-native-svg';
import { Animated } from 'react-native';
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
import { getPlanById, getSuggestedPlanId } from '@/lib/plans';
import { calcBMR, getOrComputeMacroTargets } from '@/lib/bmr';
import { getAIWorkout, saveAIWorkout, type AIWorkout } from '@/lib/aiWorkout';

// Returns 0=MON … 6=SUN from JS getDay() (0=Sun … 6=Sat)
function todayProgramIndex(): number {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Builds a personalised 1–2 sentence AI Coach summary based on today's real data.
 * Prioritises the most actionable insight for the user right now.
 */
function buildCoachSummary(
  protein: number,
  calories: number,
  burned: number,
  totalSteps: number,
  workoutName: string,
  latestWeightLbs?: number | null,
  weeklyWeightAvg?: number | null,
  goalWeightLbs?: number | null,
  proteinGoal = 150,
  calGoal = 2000,
  voiceName = 'Coach Josh',
): string {
  const hour = new Date().getHours();
  const proteinLeft = Math.max(proteinGoal - protein, 0);
  const calsLeft = Math.max(calGoal - calories, 0);

  const lines: string[] = [];

  // ── Primary: protein (most critical for recomp / muscle building) ──
  if (protein === 0) {
    lines.push(hour < 10 ? 'Start your food log — first meal sets the tone.' : 'No protein logged yet — track your meals to hit your goal.');
  } else if (proteinLeft > 80) {
    lines.push(`${proteinLeft}g protein still needed today — prioritise your next meal.`);
  } else if (proteinLeft > 20) {
    lines.push(`${proteinLeft}g protein left to hit ${proteinGoal}g — load up.`);
  } else if (proteinLeft > 0) {
    lines.push(`Almost at protein goal — just ${proteinLeft}g to go.`);
  } else {
    lines.push(`Protein goal crushed — ${protein}g in ✓`);
  }

  // ── Secondary: weight trend analysis (highest signal when available) ──
  if (latestWeightLbs && weeklyWeightAvg) {
    const delta = Math.round((latestWeightLbs - weeklyWeightAvg) * 10) / 10;
    const toGoal = goalWeightLbs ? Math.round((latestWeightLbs - goalWeightLbs) * 10) / 10 : null;
    if (delta < -0.5) {
      lines.push(`Down ${Math.abs(delta)} lbs vs 7-day avg${toGoal !== null && toGoal > 0 ? ` — ${toGoal} lbs from goal.` : ' — trend is solid.'}`);
    } else if (delta > 0.5) {
      const isHighCal = calsLeft < 0 || (calories > 0 && calories > calGoal * 0.9);
      lines.push(`Up ${delta} lbs vs avg${isHighCal ? ' — watch calories today.' : ' — could be water weight, keep logging.'}`);
    } else if (toGoal !== null && toGoal > 0) {
      lines.push(`${toGoal} lbs to goal — you're on track, keep going.`);
    } else if (toGoal !== null && toGoal <= 0) {
      lines.push(`Goal weight reached — focus on maintenance & muscle retention.`);
    }
  } else if (latestWeightLbs && !weeklyWeightAvg) {
    // Only one entry — encourage consistent logging
    lines.push(`Last weigh-in: ${latestWeightLbs} lbs — log daily for trend analysis.`);
  }

  // ── Tertiary (if still only one line): calories, workout, movement ──
  if (lines.length < 2) {
    if (burned > 0 && calories > 0) {
      lines.push(`${burned} kcal burned · ${calsLeft > 0 ? `${calsLeft} kcal left to fuel recovery.` : 'calorie goal hit.'}`);
    } else if (burned > 0) {
      lines.push(`${burned} kcal burned from training — refuel now.`);
    } else if (calories === 0 && hour >= 11) {
      lines.push(`No food logged — fuel up before ${workoutName}.`);
    } else if (calsLeft > 0 && calories > 0) {
      lines.push(`${calsLeft} kcal remaining — ${hour < 14 ? 'solid window for a big lunch.' : 'finish strong at dinner.'}`);
    } else if (totalSteps > 5000) {
      lines.push(`${totalSteps.toLocaleString()} steps in — keep moving.`);
    } else {
      lines.push(`${workoutName} is on the schedule — get it done.`);
    }
  }

  const summary = lines.join(' ');
  // Coach Josh's warm tone softens the punchy base copy (same treatment Serena used).
  if (voiceName === 'Coach Josh' || voiceName === 'Serena') {
    return summary
      .replace('load up.', 'you can close that gap with one strong meal.')
      .replace('keep going.', 'keep rolling.')
      .replace('watch calories today.', 'stay a little tighter today.')
      .replace('get it done.', 'go knock it out.');
  }
  return summary;
}

function getRestingBurnSoFar(profile: UserProfile | null, now = new Date()): number {
  if (!profile) return 0;
  const bmr = calcBMR(
    profile.weightLbs || '185',
    profile.heightFt || "5'10",
    profile.age || '30',
    profile.gender || 'male',
  );
  const minutesIntoDay = now.getHours() * 60 + now.getMinutes();
  const dayFraction = Math.max(0, Math.min(1, minutesIntoDay / (24 * 60)));
  return Math.round(bmr * dayFraction);
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_EMOJIS: Record<string, string> = {
  lift: '💪', cardio: '🏃', rest: '🧘',
};

// Build hero copy from today's actual plan entry
function buildHero(
  name: string,
  meta: string,
  badge: 'lift' | 'cardio' | 'rest',
  dayIndex: number,
  firstName?: string,
): { eyebrow: string; title: string; sub: string } {
  const dayName = DAY_NAMES[dayIndex] ?? 'Today';
  const emoji = DAY_EMOJIS[badge] ?? '⚡';
  const eyebrowCopy =
    badge === 'lift'
      ? 'Show up strong.'
      : badge === 'cardio'
        ? 'Keep your foot on the gas.'
        : 'Recover hard so you can train hard.';
  // Convert workout name to dramatic upper-case title (max 2 lines)
  const words = name.toUpperCase().split(' ');
  const mid = Math.ceil(words.length / 2);
  const title = words.slice(0, mid).join(' ') + '.\n' + words.slice(mid).join(' ') + (words.length > mid ? '.' : '');
  return {
    eyebrow: `${dayName} · ${eyebrowCopy} ${emoji}`,
    title: title.trim(),
    sub: meta,
  };
}

import { AppHeader } from '@/components/AppHeader';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useAuth } from '@/contexts/AuthContext'; // signOut removed — lives in ProfileScreen
import { useGamification } from '@/contexts/GamificationContext';
import { useHealth } from '@/hooks/useHealth';
import { usePro } from '@/hooks/usePro';
import { maybeShowPaywall } from '@/lib/revenuecat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addTextPostToFeed, formatRelativeTime, getStoredTribeFeedPosts, migratePostAuthors, type TribeFeedPost } from '@/lib/tribeFeed';
import { getDailyWalkTotals } from '@/lib/walkRecords';
import { supabase } from '@/lib/supabase';
import { FIRST_ACTION_CTA_KEY, PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { getDueSessions, getLatestEntry, getTodayEntries, get7DayAverage, getWeightLog, weighSessionLabel, type WeighSession, type WeightEntry } from '@/lib/weightLog';
import { WeightLogModal } from '@/components/WeightLogModal';
import { ConfettiCelebration } from '@/components/ConfettiCelebration';
import { SkeletonCard } from '@/components/SkeletonCard';
import { speakWithElevenLabs } from '@/lib/elevenlabs';
import { env } from '@/lib/env';
import { getCoachPersonaPrefix, getSelectedCoachVoice, type CoachVoiceOption } from '@/lib/coachVoice';
import { scheduleAIInsightNotifications } from '@/lib/notifications';
import { syncProfileToSupabase } from '@/lib/profileSync';
import { apexColors as C } from '@/theme/colors';
import { useTheme } from '@/contexts/ThemeContext';
import FoodScanModal, { type ScannedFood } from '@/components/FoodScanModal';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { MealShareCard, MEAL_CARD_W, MEAL_CARD_H, type MealShareData } from '@/components/MealShareCard';
import { VerifyEmailBanner } from '@/components/VerifyEmailBanner';

const FIRST_ACTION_REWARD_KEY = 'apex.onboarding.firstActionRewarded.v1';
const DASHBOARD_SHORTCUTS_KEY = 'apex.dashboard.shortcuts.v1';
const ON_THE_GO_OPEN_REQUEST_KEY = 'apex.onthego.openRequest.v1';
const TRAIN_ENTRY_TAB_KEY = 'apex.train.entryTab';
const MACRO_ACTION_PLAN_KEY = 'apex.macroActionPlan.v1';
const MACRO_ACTION_PLAN_PENDING_KEY = 'apex.macroActionPlan.pending.v1';
const STEP_GOAL_CELEBRATION_KEY = 'apex.stepGoalCelebrationShownDate.v1';
const FOOD_GOAL_CELEBRATION_KEY = 'apex.foodGoalCelebrationShownDate.v1';
const ACTION_PLAN_SHARE_W = 390;
const ACTION_PLAN_SHARE_H = 693;

type DashboardShortcutId =
  | 'meals'
  | 'on_the_go'
  | 'water'
  | 'weight'
  | 'walk'
  | 'tribe'
  | 'leaderboard'
  | 'academy'
  | 'coach'
  | 'live_coach'
  | 'this_week';

type MacroWeightPoint = {
  calories: number;
  carbs: number;
  date: string;
  fat: number;
  protein: number;
  weight: number | null;
};

type MacroMetricKey = 'weight' | 'calories' | 'protein' | 'carbs' | 'fat';

type MacroMetricVisibility = Record<MacroMetricKey, boolean>;

const DEFAULT_MACRO_METRIC_VISIBILITY: MacroMetricVisibility = {
  weight: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
};

const MACRO_METRICS: Array<{ color: string; key: MacroMetricKey; label: string }> = [
  { key: 'weight', label: 'Weight', color: '#F7CF65' },
  { key: 'calories', label: 'Calories', color: '#FF9F43' },
  { key: 'protein', label: 'Protein', color: '#60A5FA' },
  { key: 'carbs', label: 'Carbs', color: '#F472B6' },
  { key: 'fat', label: 'Fat', color: '#A78BFA' },
];

const DEFAULT_DASHBOARD_SHORTCUTS: DashboardShortcutId[] = ['meals', 'walk', 'weight', 'coach'];

function getWorkoutProgressStorageKey(userId: string, workoutDate: string, workoutName: string) {
  return `apex.train.progress.${userId}.${workoutDate}.${workoutName}`;
}

function getWorkoutCompletionStorageKey(userId: string, workoutDate: string, workoutName: string) {
  return `apex.train.complete.${userId}.${workoutDate}.${workoutName}`;
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function AIBar({ text, accentColor, accentColorSoft, accentColorBorder }: { text: React.ReactNode; accentColor?: string; accentColorSoft?: string; accentColorBorder?: string }) {
  return (
    <View style={[styles.aiBar, accentColor ? { backgroundColor: accentColorSoft, borderColor: accentColorBorder } : null]}>
      <Text style={styles.aiBarIcon}>🤖</Text>
      <Text style={styles.aiBarText}>{text}</Text>
    </View>
  );
}

function buildFixedMacroWeightWindow(points: MacroWeightPoint[]) {
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const nutritionLoggedDays = ordered.filter((point) => point.calories > 0 || point.protein > 0 || point.carbs > 0 || point.fat > 0);
  const weightLoggedDays = ordered.filter((point) => point.weight != null);
  const firstWeight = weightLoggedDays[0]?.weight ?? null;
  const latestWeight = weightLoggedDays[weightLoggedDays.length - 1]?.weight ?? null;

  const avg = (values: number[]) =>
    values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

  const weightChange =
    firstWeight != null && latestWeight != null ? Math.round((latestWeight - firstWeight) * 10) / 10 : null;

  return {
    dateSpanDays:
      ordered.length > 1
        ? Math.max(
            1,
            Math.round(
              (new Date(ordered[ordered.length - 1]!.date).getTime() - new Date(ordered[0]!.date).getTime()) /
                (1000 * 60 * 60 * 24),
            ) + 1,
          )
        : ordered.length,
    nutritionLoggedDays: nutritionLoggedDays.length,
    nutritionCoveragePct: Math.round((nutritionLoggedDays.length / Math.max(ordered.length, 1)) * 100),
    weightLoggedDays: weightLoggedDays.length,
    weightCoveragePct: Math.round((weightLoggedDays.length / Math.max(ordered.length, 1)) * 100),
    avgCalories: avg(nutritionLoggedDays.map((point) => point.calories)),
    avgProtein: avg(nutritionLoggedDays.map((point) => point.protein)),
    avgCarbs: avg(nutritionLoggedDays.map((point) => point.carbs)),
    avgFat: avg(nutritionLoggedDays.map((point) => point.fat)),
    firstWeight,
    latestWeight,
    weightChange,
  };
}

function formatTrendWindowLabel(dayCount: number) {
  if (dayCount <= 1) return '1 day';
  if (dayCount < 30) return `${dayCount} days`;
  const months = dayCount / 30;
  if (months < 2) return '1 month';
  if (months < 12) return `${Math.round(months)} months`;
  return '12 months';
}

function getMealsGoalCount(profile: UserProfile | null) {
  const raw = profile?.mealsPerDay ?? '3';
  if (raw === '5+') return 5;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 3;
}

function MacroRing({
  color,
  grams,
  label,
  percent,
}: {
  color: string;
  grams: string;
  label: string;
  percent: number;
}) {
  const size = 80;
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference * (1 - percent / 100);
  const cx = size / 2;
  const cy = size / 2;

  // Animate stroke from empty → filled when percent changes
  const animatedOffset = React.useRef(new Animated.Value(circumference)).current;
  React.useEffect(() => {
    Animated.timing(animatedOffset, {
      toValue: targetOffset,
      duration: 800,
      useNativeDriver: false, // SVG props can't use native driver
    }).start();
  }, [targetOffset, animatedOffset]);

  return (
    <View style={styles.ringWrap}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={cx} cy={cy} r={radius} fill="none" stroke={C.border} strokeWidth={7} />
        <AnimatedCircle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={animatedOffset as unknown as number}
        />
        <SvgText
          x={cx}
          y={cy}
          fill={C.text}
          fontSize={13}
          fontFamily="BebasNeue_400Regular"
          textAnchor="middle"
          alignmentBaseline="middle"
          transform={`rotate(90, ${cx}, ${cy})`}
        >
          {grams}
        </SvgText>
      </Svg>
      <Text style={styles.ringVal}>{percent}%</Text>
      <Text style={styles.ringName}>{label}</Text>
    </View>
  );
}

function StatCard({
  children,
  label,
  sub,
  value,
}: {
  children?: React.ReactNode;
  label: string;
  sub?: string;
  value?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      {value !== undefined ? <Text style={styles.statVal}>{value}</Text> : null}
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
      {children}
    </View>
  );
}

function WearTile({
  hint,
  icon,
  label,
  onPress,
  value,
  valueColor,
}: {
  hint?: string;
  icon: string;
  label: string;
  onPress?: () => void;
  value: string;
  valueColor?: string;
}) {
  return (
    <Pressable style={styles.wearTile} onPress={onPress}>
      <Text style={styles.wearIcon}>{icon}</Text>
      <Text style={[styles.wearVal, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text style={styles.wearLbl}>{label}</Text>
      {hint ? <Text style={styles.wearHint}>{hint}</Text> : null}
    </Pressable>
  );
}

function ActivityItem({ text, who }: { text: string; who: string }) {
  return (
    <View style={styles.activityItem}>
      <Text style={styles.activityWho}>{who}</Text>
      <Text style={styles.activityText}>{text}</Text>
    </View>
  );
}

function LevelBar({ level, xp, accentColor }: { level: number; xp: number; accentColor?: string }) {
  const xpInLevel = xp % 100;

  return (
    <View style={styles.levelWrap}>
      <View style={styles.levelInfo}>
        <Text style={styles.levelInfoText}>{xp} XP</Text>
        <Text style={styles.levelInfoText}>+{100 - xpInLevel} to L{level + 1}</Text>
      </View>
      <View style={styles.levelTrack}>
        <View style={[styles.levelFill, { width: `${xpInLevel}%`, backgroundColor: accentColor }, { width: `${xpInLevel}%` }]} />
      </View>
    </View>
  );
}

function WeightTrendMini({
  entries,
  accentColor,
}: {
  entries: WeightEntry[];
  accentColor: string;
}) {
  if (entries.length < 2) {
    return (
      <View style={styles.weightTrendEmpty}>
        <Text style={styles.weightTrendEmptyText}>Log a few weigh-ins to see your trend line here.</Text>
      </View>
    );
  }

  const ordered = [...entries].sort((a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime());
  const values = ordered.map((entry) => entry.weightLbs);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const width = 280;
  const height = 110;
  const padX = 12;
  const padY = 12;
  const innerWidth = width - padX * 2;
  const innerHeight = height - padY * 2;

  const points = ordered.map((entry, index) => {
    const x = padX + (index / Math.max(ordered.length - 1, 1)) * innerWidth;
    const y = padY + ((max - entry.weightLbs) / range) * innerHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <View style={styles.weightTrendWrap}>
      <Svg width={width} height={height}>
        <Polyline
          points={points}
          fill="none"
          stroke={accentColor}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <View style={styles.weightTrendLabels}>
        <Text style={styles.weightTrendLabel}>{ordered[0] ? new Date(ordered[0].loggedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</Text>
        <Text style={styles.weightTrendLabel}>{ordered[ordered.length - 1] ? new Date(ordered[ordered.length - 1].loggedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</Text>
      </View>
    </View>
  );
}

function MacroWeightTrendChart({
  accentBorder,
  accentColor,
  accentColorSoft,
  activeMetrics,
  data,
  onSelectDate,
  onToggleMetric,
  selectedDate,
}: {
  accentBorder: string;
  accentColor: string;
  accentColorSoft: string;
  activeMetrics: MacroMetricVisibility;
  data: MacroWeightPoint[];
  onSelectDate: (date: string) => void;
  onToggleMetric: (metric: MacroMetricKey) => void;
  selectedDate: string | null;
}) {
  if (data.length < 2) {
    return (
      <View style={styles.weightTrendEmpty}>
        <Text style={styles.weightTrendEmptyText}>Log meals and weigh-ins for a few days to unlock your macro versus weight trend.</Text>
      </View>
    );
  }

  const width = 320;
  const height = 180;
  const padX = 12;
  const padY = 16;
  const innerWidth = width - padX * 2;
  const innerHeight = height - padY * 2;
  const summary = buildFixedMacroWeightWindow(data);
  const selectedPoint = data.find((point) => point.date === selectedDate) ?? data[data.length - 1] ?? null;

  const buildLine = (values: Array<number | null>) => {
    const present = values.filter((value): value is number => value != null);
    if (present.length < 2) return [];

    const min = Math.min(...present);
    const max = Math.max(...present);
    const range = Math.max(max - min, 1);
    const segments: string[] = [];
    let current: string[] = [];

    values.forEach((value, index) => {
      if (value == null) {
        if (current.length > 1) segments.push(current.join(' '));
        current = [];
        return;
      }
      const x = padX + (index / Math.max(values.length - 1, 1)) * innerWidth;
      const y = padY + ((max - value) / range) * innerHeight;
      current.push(`${x},${y}`);
    });

    if (current.length > 1) segments.push(current.join(' '));
    return segments;
  };

  const lines = MACRO_METRICS.map((metric) => {
    const values = data.map((point) => {
      if (metric.key === 'weight') return point.weight;
      return point[metric.key];
    });
    return {
      ...metric,
      active: activeMetrics[metric.key],
      segments: buildLine(values),
    };
  });

  return (
    <View style={styles.macroWeightChartWrap}>
      <View style={styles.macroWeightSummaryRow}>
        <View style={styles.macroWeightSummaryCard}>
          <Text style={styles.macroWeightSummaryLabel}>Logged change</Text>
          <Text style={styles.macroWeightSummaryValue}>
            {summary.weightChange == null ? 'No trend' : `${summary.weightChange > 0 ? '+' : ''}${summary.weightChange} lbs`}
          </Text>
        </View>
        <View style={styles.macroWeightSummaryCard}>
          <Text style={styles.macroWeightSummaryLabel}>Avg calories</Text>
          <Text style={styles.macroWeightSummaryValue}>{summary.avgCalories ? `${summary.avgCalories}` : 'No logs'}</Text>
        </View>
        <View style={styles.macroWeightSummaryCard}>
          <Text style={styles.macroWeightSummaryLabel}>Avg protein</Text>
          <Text style={styles.macroWeightSummaryValue}>{summary.avgProtein ? `${summary.avgProtein}g` : 'No logs'}</Text>
        </View>
      </View>

      <View style={styles.macroWeightToggleRow}>
        {lines.map((line) => (
          <Pressable
            key={line.key}
            onPress={() => onToggleMetric(line.key)}
            style={[
              styles.macroWeightTogglePill,
              line.active ? { backgroundColor: `${line.color}22`, borderColor: line.color } : { borderColor: accentBorder },
            ]}
          >
            <View style={[styles.macroWeightLegendDot, { backgroundColor: line.color }]} />
            <Text style={[styles.macroWeightToggleText, line.active && { color: C.text }]}>{line.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.macroWeightChartStage}>
        <Svg width={width} height={height}>
          {[0.25, 0.5, 0.75].map((fraction) => (
            <Polyline
              key={fraction}
              points={`${padX},${padY + innerHeight * fraction} ${width - padX},${padY + innerHeight * fraction}`}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
          ))}
          {lines.flatMap((line) =>
            line.active
              ? line.segments.map((segment, index) => (
                  <Polyline
                    key={`${line.key}-${index}`}
                    points={segment}
                    fill="none"
                    stroke={line.color}
                    strokeWidth={line.key === 'weight' ? 3 : 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))
              : [],
          )}
        </Svg>
        <View style={styles.macroWeightHitGrid} pointerEvents="box-none">
          {data.map((point) => (
            <Pressable
              key={point.date}
              style={styles.macroWeightHitTarget}
              onPress={() => onSelectDate(point.date)}
            />
          ))}
        </View>
      </View>
      <View style={styles.macroWeightLegend}>
        {lines.filter((line) => line.active).map((line) => (
          <View key={line.label} style={styles.macroWeightLegendItem}>
            <View style={[styles.macroWeightLegendDot, { backgroundColor: line.color }]} />
            <Text style={styles.macroWeightLegendText}>{line.label}</Text>
          </View>
        ))}
      </View>
      {selectedPoint ? (
        <View style={[styles.macroWeightDetailCard, { backgroundColor: accentColorSoft, borderColor: accentBorder }]}>
          <View style={styles.macroWeightDetailHeader}>
            <Text style={styles.macroWeightDetailDate}>
              {new Date(selectedPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
            <Text style={styles.macroWeightDetailMeta}>
              {selectedPoint.weight == null ? 'No weigh-in logged' : `${selectedPoint.weight.toFixed(1)} lbs`}
            </Text>
          </View>
          <View style={styles.macroWeightDetailStats}>
            <Text style={styles.macroWeightDetailStat}>Calories {selectedPoint.calories || '—'}</Text>
            <Text style={styles.macroWeightDetailStat}>Protein {selectedPoint.protein ? `${selectedPoint.protein}g` : '—'}</Text>
            <Text style={styles.macroWeightDetailStat}>Carbs {selectedPoint.carbs ? `${selectedPoint.carbs}g` : '—'}</Text>
            <Text style={styles.macroWeightDetailStat}>Fat {selectedPoint.fat ? `${selectedPoint.fat}g` : '—'}</Text>
          </View>
        </View>
      ) : null}
      <Text style={styles.macroWeightCompletenessText}>
        {`Showing ${formatTrendWindowLabel(summary.dateSpanDays)} · ${summary.nutritionLoggedDays} nutrition days logged · ${summary.weightLoggedDays} weigh-ins logged`}
      </Text>
      <View style={styles.weightTrendLabels}>
        <Text style={styles.weightTrendLabel}>{new Date(data[0]!.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
        <Text style={styles.weightTrendLabel}>{new Date(data[data.length - 1]!.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
      </View>
    </View>
  );
}

// ─── Daily Checklist ──────────────────────────────────────────────────────────
function fmt12h(hour: number): string {
  const h = hour % 12 || 12;
  return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}

function DailyChecklist({
  workoutDone,
  mealsLogged,
  mealHints,
  weightItems,
  onWorkoutPress,
  onMealPress,
  onWeightPress,
  onAllDone,
  accent,
  accentSoft,
  accentBorder,
}: {
  workoutDone: boolean;
  mealsLogged: number;
  mealHints: { meal1: number; meal2: number; meal3: number };
  weightItems: Array<{ key: string; label: string; done: boolean; session: WeighSession }>;
  onWorkoutPress: () => void;
  onMealPress: () => void;
  onWeightPress: (session: WeighSession) => void;
  onAllDone?: () => void;
  accent: string;
  accentSoft: string;
  accentBorder: string;
}) {
  const hour = new Date().getHours();
  const meal1Done = mealsLogged >= 1;
  const meal2Done = mealsLogged >= 2;
  const meal3Done = mealsLogged >= 3;

  // Collapsible state — starts closed so the page feels clean on first open
  const [open, setOpen] = React.useState(false);
  const chevronAnim = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.timing(chevronAnim, {
      toValue: open ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [open, chevronAnim]);
  const chevronRotate = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  // Smart nudge: highlight next due item based on time of day
  const nextDue =
    !meal1Done && hour >= mealHints.meal1 - 1 ? 'meal1'
    : !meal2Done && hour >= mealHints.meal2 - 1 ? 'meal2'
    : !workoutDone && hour >= 6 ? 'workout'
    : !meal3Done && hour >= mealHints.meal3 - 1 ? 'meal3'
    : null;

  const coreItems: Array<{ key: string; label: string; hint: string; done: boolean; onPress: () => void; isNext: boolean }> = [
    {
      key: 'workout',
      label: 'Complete Workout',
      hint: 'Tap to open Train',
      done: workoutDone,
      onPress: onWorkoutPress,
      isNext: nextDue === 'workout',
    },
    {
      key: 'meal1',
      label: 'Log Meal 1',
      hint: `Usually around ${fmt12h(mealHints.meal1)}`,
      done: meal1Done,
      onPress: onMealPress,
      isNext: nextDue === 'meal1',
    },
    {
      key: 'meal2',
      label: 'Log Meal 2',
      hint: `Usually around ${fmt12h(mealHints.meal2)}`,
      done: meal2Done,
      onPress: onMealPress,
      isNext: nextDue === 'meal2',
    },
    {
      key: 'meal3',
      label: 'Log Meal 3',
      hint: `Usually around ${fmt12h(mealHints.meal3)}`,
      done: meal3Done,
      onPress: onMealPress,
      isNext: nextDue === 'meal3',
    },
  ];

  const weightChecklistItems: Array<{ key: string; label: string; hint: string; done: boolean; onPress: () => void; isNext: boolean }> =
    weightItems.map((w) => ({
      key: w.key,
      label: w.label,
      hint: '⚖️ Tap to log weight',
      done: w.done,
      onPress: () => onWeightPress(w.session),
      isNext: false,
    }));

  const items = [...coreItems, ...weightChecklistItems];
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length && items.length > 0;
  // Only show uncompleted items — completed ones disappear from the list
  const visibleItems = items.filter((i) => !i.done);

  // Fire onAllDone once when everything is checked off
  const prevAllDone = React.useRef(false);
  React.useEffect(() => {
    if (allDone && !prevAllDone.current) {
      prevAllDone.current = true;
      onAllDone?.();
    }
    if (!allDone) prevAllDone.current = false;
  }, [allDone, onAllDone]);

  return (
    <View style={[styles.checklistCard, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
      {/* Tappable header — collapses/expands the list */}
      <Pressable
        style={styles.activityPreviewHeaderRow}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
          setOpen((o) => !o);
        }}
      >
        <Text style={[styles.activityPreviewEyebrow, { color: accent }]}>Today's Checklist</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.checklistCount, allDone && { color: accent }]}>
            {doneCount}/{items.length} {allDone ? '🔥' : ''}
          </Text>
          <Text style={{ color: C.muted, fontSize: 16 }}>{open ? '▲' : '▼'}</Text>
        </View>
      </Pressable>

      {/* Progress bar — always visible */}
      <View style={[styles.checklistBar, { marginTop: 12 }]}>
        <View style={[styles.checklistBarFill, { width: `${items.length > 0 ? (doneCount / items.length) * 100 : 0}%`, backgroundColor: accent }]} />
      </View>

      {/* Collapsible item list — only uncompleted items shown */}
      {open && (
        visibleItems.length === 0 ? (
          <View style={styles.checklistAllDoneRow}>
            <Text style={[styles.checklistAllDoneText, { color: accent }]}>🔥 All done — you crushed today!</Text>
          </View>
        ) : (
          visibleItems.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.checklistRow, item.isNext && { backgroundColor: `${accent}08`, marginHorizontal: -16, paddingHorizontal: 16 }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null); item.onPress(); }}
            >
              <View style={styles.checklistBox} />
              <View style={{ flex: 1 }}>
                <Text style={styles.checklistItemLabel}>{item.label}</Text>
                <Text style={[styles.checklistItemHint, item.isNext && { color: accent }]}>
                  {item.isNext ? '⏰ ' : ''}{item.hint}
                </Text>
              </View>
              <Text style={styles.checklistChevron}>›</Text>
            </Pressable>
          ))
        )
      )}
    </View>
  );
}

// ─── Macro Action Plan types ──────────────────────────────────────────────────
type MacroMealSuggestion = {
  name: string;       // e.g. "Breakfast"
  suggestion: string; // e.g. "3-egg scramble + oats + banana"
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tip: string;
};
type MacroMovementSuggestion = {
  type: 'light' | 'moderate' | 'intense' | 'rest';
  description: string;
  stepGoal: number;
  workoutNote: string;
};
type MacroNotifSuggestion = { title: string; body: string; hour: number; minute: number };
type MacroActionPlan = {
  insight: string;
  score: string;          // e.g. "B+"
  scoreReason: string;
  badges: string[];
  todayMeals: MacroMealSuggestion[];
  tomorrowMeals: MacroMealSuggestion[];
  todayMovement: MacroMovementSuggestion;
  tomorrowMovement: MacroMovementSuggestion;
  groceryItems: string[];
  notificationSuggestions: MacroNotifSuggestion[];
};
type MacroApplyState = {
  mealPlan: 'idle' | 'loading' | 'done';
  grocery: 'idle' | 'loading' | 'done';
  notifications: 'idle' | 'loading' | 'done';
  training: 'idle' | 'loading' | 'done';
};

function MacroActionPlanShareCard({
  accent,
  badges,
  displayName,
  goalLabel,
  insight,
  movementGoal,
  score,
  todayMeals,
}: {
  accent: string;
  badges: string[];
  displayName: string;
  goalLabel: string;
  insight: string;
  movementGoal?: MacroMovementSuggestion | null;
  score: string;
  todayMeals: MacroMealSuggestion[];
}) {
  const stepLabel = movementGoal?.stepGoal
    ? `${(movementGoal.stepGoal / 1000).toFixed(0)}K steps`
    : 'Stay active';
  const moveNote = movementGoal?.workoutNote ?? movementGoal?.description ?? 'Move with intent today.';

  return (
    <View style={styles.macroShareCard}>
      {/* Ambient glow behind score area */}
      <View style={[styles.macroShareGlow, { backgroundColor: accent }]} />

      {/* Top bar */}
      <View style={styles.macroShareTopRow}>
        <Text style={styles.macroShareBrand}>APEX</Text>
        <View style={[styles.macroSharePill, { borderColor: `${accent}55`, backgroundColor: `${accent}22` }]}>
          <Text style={[styles.macroSharePillText, { color: accent }]}>ACTION PLAN</Text>
        </View>
      </View>

      {/* Identity line */}
      <Text style={styles.macroShareSubtitle} numberOfLines={1}>{displayName} · {goalLabel}</Text>

      {/* Score hero */}
      <View style={styles.macroShareScoreHero}>
        <Text style={[styles.macroShareScoreBig, { color: accent }]}>{score}</Text>
        <Text style={styles.macroShareScoreLabel}>TREND SCORE</Text>
      </View>

      {/* Insight */}
      <View style={[styles.macroShareInsightCard, { borderColor: `${accent}30` }]}>
        <Text style={styles.macroShareInsightText} numberOfLines={3}>{insight}</Text>
      </View>

      {/* Split cards */}
      <View style={styles.macroShareSplitRow}>
        <View style={[styles.macroShareMiniCard, { borderColor: `${accent}28` }]}>
          <Text style={styles.macroShareMiniEyebrow}>TODAY'S FOOD</Text>
          <Text style={styles.macroShareMiniText} numberOfLines={3}>
            {todayMeals.slice(0, 2).map((m) => m.name).join('\n') || 'On track'}
          </Text>
        </View>
        <View style={[styles.macroShareMiniCard, { borderColor: `${accent}28` }]}>
          <Text style={styles.macroShareMiniEyebrow}>MOVEMENT</Text>
          <Text style={[styles.macroShareMiniValue, { color: accent }]}>{stepLabel}</Text>
          <Text style={styles.macroShareMiniText} numberOfLines={2}>{moveNote}</Text>
        </View>
      </View>

      {/* Badges */}
      {badges.length > 0 && (
        <View style={styles.macroShareBadgeRow}>
          {badges.slice(0, 2).map((badge) => (
            <View key={badge} style={[styles.macroShareBadge, { borderColor: `${accent}50`, backgroundColor: `${accent}18` }]}>
              <Text style={[styles.macroShareBadgeText, { color: accent }]}>{badge}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Footer */}
      <View style={styles.macroShareBottom}>
        <Text style={[styles.macroShareHandle, { color: accent }]}>apex.fitness</Text>
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const { accent, accentSoft, accentBorder, accentStrongBorder } = useTheme();
  const navigation = useNavigation<any>();
  const { session } = useAuth();
  const { addXp, level, xp } = useGamification();
  const { isPro, isLoading: proLoading } = usePro();
  const { activeEnergy, available, loading, refresh: refreshHealth, steps, sleep } = useHealth();
  const showWearables = available;
  const [tribePosts, setTribePosts] = React.useState<TribeFeedPost[]>([]);
  const [, setTick] = React.useState(0);           // drives live timestamps
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [aiWorkout, setAiWorkout] = React.useState<AIWorkout | null>(null);
  const mealShareRef = React.useRef<ViewShot>(null);
  const macroShareRef = React.useRef<ViewShot>(null);
  const [mealShareData, setMealShareData] = React.useState<MealShareData | null>(null);
  const [macroShareVisible, setMacroShareVisible] = React.useState(false);
  const [dashboardLoading, setDashboardLoading] = React.useState(true);
  const [workoutInProgress, setWorkoutInProgress] = React.useState(false);
  const [dashboardShortcuts, setDashboardShortcuts] = React.useState<DashboardShortcutId[]>(DEFAULT_DASHBOARD_SHORTCUTS);
  const [shortcutPickerVisible, setShortcutPickerVisible] = React.useState(false);
  const [macroWeightTrend, setMacroWeightTrend] = React.useState<MacroWeightPoint[]>([]);
  const [macroMetricVisibility, setMacroMetricVisibility] = React.useState<MacroMetricVisibility>(DEFAULT_MACRO_METRIC_VISIBILITY);
  const [macroSelectedDate, setMacroSelectedDate] = React.useState<string | null>(null);
  const [macroInsightVisible, setMacroInsightVisible] = React.useState(false);
  const [macroInsightLoading, setMacroInsightLoading] = React.useState(false);
  const [macroInsightText, setMacroInsightText] = React.useState<string | null>(null);
  const [macroInsightSpeaking, setMacroInsightSpeaking] = React.useState(false);
  const [macroInsightTab, setMacroInsightTab] = React.useState<'insight' | 'eat' | 'move' | 'apply'>('insight');
  const [macroActionPlan, setMacroActionPlan] = React.useState<MacroActionPlan | null>(null);
  const [macroApplyState, setMacroApplyState] = React.useState<MacroApplyState>({ mealPlan: 'idle', grocery: 'idle', notifications: 'idle', training: 'idle' });
  const [movementGoalCelebration, setMovementGoalCelebration] = React.useState(false);
  const [foodGoalCelebration, setFoodGoalCelebration] = React.useState(false);
  const [macroTrendExpanded, setMacroTrendExpanded] = React.useState(false);
  const [tribeExpanded, setTribeExpanded] = React.useState(false);
  const [wearablesExpanded, setWearablesExpanded] = React.useState(false);
  const macroSheetTranslateY = React.useRef(new Animated.Value(0)).current;
  const macros = React.useMemo(() => getOrComputeMacroTargets(profile), [profile]);
  const hasSavedMacroReview = Boolean(macroActionPlan || macroInsightText);

  const closeMacroInsight = React.useCallback(() => {
    Animated.timing(macroSheetTranslateY, {
      toValue: 540,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      macroSheetTranslateY.setValue(0);
      setMacroInsightVisible(false);
    });
  }, [macroSheetTranslateY]);

  const macroSheetPanResponder = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          macroSheetTranslateY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 100 || gesture.vy > 0.85) {
          closeMacroInsight();
        } else {
          Animated.spring(macroSheetTranslateY, {
            toValue: 0,
            speed: 18,
            bounciness: 5,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  async function openTrainToday() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await rewardFirstAction().catch(() => null);
    await AsyncStorage.removeItem(FIRST_ACTION_CTA_KEY).catch(() => null);
    await AsyncStorage.setItem(TRAIN_ENTRY_TAB_KEY, 'today').catch(() => null);
    navigation.navigate('Train');
  }

  const rewardFirstAction = React.useCallback(async () => {
    const rewarded = await AsyncStorage.getItem(FIRST_ACTION_REWARD_KEY);
    if (rewarded === '1') {
      return;
    }
    await addXp(25);
    await AsyncStorage.setItem(FIRST_ACTION_REWARD_KEY, '1');
  }, [addXp]);

  // Hero card fade-in
  const heroOpacity = useSharedValue(0);
  const heroTranslate = useSharedValue(12);
  const heroAnimStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroTranslate.value }],
  }));
  React.useEffect(() => {
    if (!dashboardLoading) {
      heroOpacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
      heroTranslate.value = withTiming(0, { duration: 500, easing: Easing.out(Easing.quad) });
    }
  }, [dashboardLoading, heroOpacity, heroTranslate]);
  // Build hero from actual plan data so it always matches the real workout
  const hero = React.useMemo(() => {
    const dayIdx = todayProgramIndex();
    const planId = profile?.activePlanId ?? getSuggestedPlanId(profile?.goal ?? 'recomp', profile?.experience ?? 'intermediate');
    const plan = getPlanById(planId);
    const baseEntry = plan.schedule[dayIdx] ?? plan.schedule[0];
    const todayEntry = profile?.activePlanId === 'ai-generated' && aiWorkout
      ? { ...baseEntry, name: aiWorkout.name, meta: `${aiWorkout.exercises.length} exercises · ${aiWorkout.duration} min` }
      : baseEntry;
    const firstName = profile?.displayName?.split(' ')[0] ?? undefined;
    return { ...buildHero(todayEntry.name, todayEntry.meta, todayEntry.badge, dayIdx, firstName), badge: todayEntry.badge };
  }, [aiWorkout, profile]);
  const todayWorkoutName = React.useMemo(() => {
    const dayIdx = todayProgramIndex();
    const planId = profile?.activePlanId ?? getSuggestedPlanId(profile?.goal ?? 'recomp', profile?.experience ?? 'intermediate');
    const plan = getPlanById(profile?.activePlanId === 'ai-generated' ? undefined : planId);
    const todayEntry = plan.schedule[dayIdx] ?? plan.schedule[0];
    return profile?.activePlanId === 'ai-generated' && aiWorkout ? aiWorkout.name : todayEntry.name;
  }, [aiWorkout, profile]);
  const [walkSteps, setWalkSteps] = React.useState(0);
  const phoneTrackedSteps = Math.max(0, steps || 0);
  const totalStepCount = available && phoneTrackedSteps > 0
    ? phoneTrackedSteps
    : Math.max(0, walkSteps);
  // Emergency Coach modal
  const [emergencyVisible, setEmergencyVisible] = React.useState(false);
  const [emergencyState, setEmergencyState] = React.useState<string | null>(null);
  const [emergencyReply, setEmergencyReply] = React.useState<string | null>(null);
  const [emergencyLoading, setEmergencyLoading] = React.useState(false);
  const [emergencyUsesThisMonth, setEmergencyUsesThisMonth] = React.useState(0);
  const FREE_EMERGENCY_LIMIT = 2;

  // Voice state
  const [coachVoicePlaying, setCoachVoicePlaying] = React.useState(false);
  const [emergencyVoicePlaying, setEmergencyVoicePlaying] = React.useState(false);
  const [activeCoachVoice, setActiveCoachVoice] = React.useState<CoachVoiceOption | null>(null);

  // Load monthly emergency usage count
  React.useEffect(() => {
    const monthKey = `apex.emergency.month.${new Date().toISOString().slice(0, 7)}`;
    AsyncStorage.getItem(monthKey)
      .then((val) => setEmergencyUsesThisMonth(val ? parseInt(val, 10) : 0))
      .catch(() => null);
  }, []);

  const canUseEmergency = isPro || emergencyUsesThisMonth < FREE_EMERGENCY_LIMIT;

  const openUpgrade = React.useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await maybeShowPaywall(session?.user?.id).catch(() => null);
    navigation.navigate('Upgrade');
  }, [navigation, session?.user?.id]);

  const openEmergencyCoach = React.useCallback(async () => {
    if (!canUseEmergency) {
      openUpgrade();
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setEmergencyState(null);
    setEmergencyReply(null);
    setEmergencyVisible(true);
  }, [canUseEmergency, openUpgrade]);

  const [workoutLoggedToday, setWorkoutLoggedToday] = React.useState(false);
  const [mealsLoggedToday, setMealsLoggedToday] = React.useState(0);
  // Hour-of-day when each historical meal slot was typically logged (learned from last 14 days)
  const [mealHints, setMealHints] = React.useState<{ meal1: number; meal2: number; meal3: number }>({ meal1: 8, meal2: 12, meal3: 18 });
  // Weight tracking
  const [todayWeightEntries, setTodayWeightEntries] = React.useState<WeightEntry[]>([]);
  const [latestWeightLbs, setLatestWeightLbs] = React.useState<number | null>(null);
  const [weeklyWeightAvg, setWeeklyWeightAvg] = React.useState<number | null>(null);
  const [weightModalVisible, setWeightModalVisible] = React.useState(false);
  const [weightInsightsVisible, setWeightInsightsVisible] = React.useState(false);
  const [weightHistory, setWeightHistory] = React.useState<WeightEntry[]>([]);
  const [weightModalSession, setWeightModalSession] = React.useState<WeighSession>('manual');
  // Meal scan shortcut
  const [mealScanVisible, setMealScanVisible] = React.useState(false);
  // Water tracking (shared key with FuelScreen)
  const [waterModalVisible, setWaterModalVisible] = React.useState(false);
  const [waterOz, setWaterOz] = React.useState(0);
  const WATER_GOAL_OZ = 64; // 8 glasses × 8 oz
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const loadWaterOz = React.useCallback(() => {
    AsyncStorage.getItem(`apex.hydration.${todayDateStr}`)
      .then((raw) => setWaterOz(raw ? Number(raw) : 0))
      .catch(() => null);
  }, [todayDateStr]);
  const addWaterOz = async (oz: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setWaterOz((prev) => {
      const next = Math.min(prev + oz, WATER_GOAL_OZ * 2);
      AsyncStorage.setItem(`apex.hydration.${todayDateStr}`, String(next)).catch(() => null);
      return next;
    });
  };
  // ── Checklist XP rewards — awarded once per item per day via AsyncStorage ──
  const awardChecklistXp = React.useCallback(async (key: string, amount: number) => {
    const storageKey = `apex.checklist.xp.${key}`;
    const already = await AsyncStorage.getItem(storageKey).catch(() => null);
    if (already === '1') return;
    await AsyncStorage.setItem(storageKey, '1').catch(() => null);
    await addXp(amount).catch(() => null);
  }, [addXp]);

  React.useEffect(() => {
    if (workoutLoggedToday) {
      awardChecklistXp(`workout.${todayDateStr}`, 25);
    }
  }, [workoutLoggedToday, todayDateStr, awardChecklistXp]);

  React.useEffect(() => {
    if (mealsLoggedToday >= 1) awardChecklistXp(`meal1.${todayDateStr}`, 10);
    if (mealsLoggedToday >= 2) awardChecklistXp(`meal2.${todayDateStr}`, 10);
    if (mealsLoggedToday >= 3) awardChecklistXp(`meal3.${todayDateStr}`, 10);
  }, [mealsLoggedToday, todayDateStr, awardChecklistXp]);

  const [checklistCelebration, setChecklistCelebration] = React.useState(false);
  const [sleepModalVisible, setSleepModalVisible] = React.useState(false);
  const [totals, setTotals] = React.useState({
    activeCaloriesBurned: 0,
    caloriesBurned: 0,
    caloriesConsumed: 0,
    carbs: 0,
    fat: 0,
    protein: 0,
    restingCaloriesBurned: 0,
  });

  const refreshWeightData = React.useCallback(async () => {
    const [entries, latest, avg, fullLog] = await Promise.all([
      getTodayEntries(),
      getLatestEntry(),
      get7DayAverage(),
      getWeightLog(),
    ]);
    setTodayWeightEntries(entries);
    setLatestWeightLbs(latest?.weightLbs ?? null);
    setWeeklyWeightAvg(avg);
    setWeightHistory(fullLog.slice(-7));
  }, []);

  const handleSpeakCoachTip = React.useCallback(async () => {
    if (coachVoicePlaying) return;
    const elevenKey = env.elevenLabsApiKey;
    const tip = buildCoachSummary(
      totals.protein, totals.caloriesConsumed, totals.caloriesBurned,
      totalStepCount, '', latestWeightLbs, weeklyWeightAvg,
      profile?.goalWeightLbs ? parseFloat(profile.goalWeightLbs) : null,
      macros.dailyProtein, macros.dailyCalorieTarget, activeCoachVoice?.label ?? 'Coach Josh',
    );
    setCoachVoicePlaying(true);
    await speakWithElevenLabs(tip, elevenKey).catch(() => null);
    setCoachVoicePlaying(false);
  }, [activeCoachVoice?.label, coachVoicePlaying, latestWeightLbs, macros.dailyCalorieTarget, macros.dailyProtein, profile, totalStepCount, totals, weeklyWeightAvg]);

  const handleSpeakEmergencyReply = React.useCallback(async () => {
    if (!emergencyReply || emergencyVoicePlaying) return;
    const elevenKey = env.elevenLabsApiKey;
    setEmergencyVoicePlaying(true);
    await speakWithElevenLabs(emergencyReply, elevenKey).catch(() => null);
    setEmergencyVoicePlaying(false);
  }, [emergencyReply, emergencyVoicePlaying, profile]);

  React.useEffect(() => {
    const loadTotals = async () => {
      if (!session?.user?.id) {
        return;
      }

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // Use the local calendar date (not UTC) so the "today" boundary matches
      // the user's timezone — avoids false positives from yesterday's workouts.
      const todayLocalStr = `${startOfDay.getFullYear()}-${String(startOfDay.getMonth() + 1).padStart(2, '0')}-${String(startOfDay.getDate()).padStart(2, '0')}`;

      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      const [{ data: workouts }, { data: meals }, { data: historyMeals }] = await Promise.all([
        supabase
          .from('workouts')
          .select('calories_burned')
          .eq('user_id', session.user.id)
          .gte('workout_date', todayLocalStr),
        supabase
          .from('nutrition_entries')
          .select('calories, protein_grams, carbs_grams, fat_grams')
          .eq('user_id', session.user.id)
          .gte('consumed_at', startOfDay.toISOString()),
        supabase
          .from('nutrition_entries')
          .select('consumed_at')
          .eq('user_id', session.user.id)
          .gte('consumed_at', fourteenDaysAgo.toISOString())
          .order('consumed_at', { ascending: true }),
      ]);

      setMealsLoggedToday((meals ?? []).length);

      // Learn typical meal hours from history — bucket entries into early/mid/late by day
      if (historyMeals && historyMeals.length > 0) {
        const byDay: Record<string, number[]> = {};
        historyMeals.forEach((m: { consumed_at: string }) => {
          const d = m.consumed_at.slice(0, 10);
          const h = new Date(m.consumed_at).getHours();
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(h);
        });
        const allDays = Object.values(byDay).filter((hrs) => hrs.length >= 2);
        if (allDays.length >= 3) {
          const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
          const firstHours = allDays.map((hrs) => Math.min(...hrs));
          const lastHours = allDays.map((hrs) => Math.max(...hrs));
          const midHours = allDays.map((hrs) => {
            const sorted = [...hrs].sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
          });
          setMealHints({ meal1: avg(firstHours), meal2: avg(midHours), meal3: avg(lastHours) });
        }
      }

      const manualWalkTotals = await getDailyWalkTotals();
      const loggedActivityBurn =
        (workouts ?? []).reduce(
          (sum, item) => sum + (item.calories_burned ?? 0),
          0,
        ) + manualWalkTotals.caloriesBurned;
      // Step-based calorie estimate as a floor when Watch/workout data is absent.
      // Formula: steps × 0.04 kcal is a standard approximation for a ~70 kg person walking.
      const stepCalories = Math.round((steps || 0) * 0.04);
      const activeCaloriesBurned = available
        ? Math.max(Math.round(activeEnergy || 0), loggedActivityBurn, stepCalories)
        : Math.max(loggedActivityBurn, stepCalories);
      const restingCaloriesBurned = getRestingBurnSoFar(profile);

      setTotals({
        activeCaloriesBurned,
        caloriesBurned: activeCaloriesBurned + restingCaloriesBurned,
        caloriesConsumed: (meals ?? []).reduce((sum, item) => sum + (item.calories ?? 0), 0),
        protein: Math.round(
          (meals ?? []).reduce((sum, item) => sum + Number(item.protein_grams ?? 0), 0),
        ),
        carbs: Math.round(
          (meals ?? []).reduce((sum, item) => sum + Number(item.carbs_grams ?? 0), 0),
        ),
        fat: Math.round((meals ?? []).reduce((sum, item) => sum + Number(item.fat_grams ?? 0), 0)),
        restingCaloriesBurned,
      });
    };

    loadTotals().catch(() => null);
  }, [activeEnergy, available, profile, session?.user?.id]);

  // Tick every 60 s so tribe timestamps re-render without a page reload
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Check if Start Here has been completed or dismissed (read once on mount)
  React.useEffect(() => {
    AsyncStorage.getItem('apex_start_here_v1')
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as { dismissed?: boolean; checked?: Record<string, boolean> };
          setStartHereDone(!!saved.dismissed);
        }
      })
      .catch(() => null);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      // Reload active coach voice name (may have changed in Profile)
      getSelectedCoachVoice()
        .then((v) => setActiveCoachVoice(v))
        .catch(() => null);
      getAIWorkout().then(setAiWorkout).catch(() => setAiWorkout(null));
      AsyncStorage.getItem(DASHBOARD_SHORTCUTS_KEY)
        .then((raw) => {
          if (!raw) return;
          const parsed = JSON.parse(raw) as DashboardShortcutId[];
          if (Array.isArray(parsed) && parsed.length) {
            setDashboardShortcuts(parsed.slice(0, 4));
          }
        })
        .catch(() => null);

      refreshHealth().catch(() => null);

      // Tribe posts (3 most recent)
      getStoredTribeFeedPosts()
        .then((posts) => setTribePosts(posts.slice(0, 3)))
        .catch(() => setTribePosts([]));

      // Profile (for display name in tribe activity rows)
      // Also migrate any stored posts that still carry an old author name
      AsyncStorage.getItem(PROFILE_STORAGE_KEY)
        .then(async (raw) => {
          const p = raw ? (JSON.parse(raw) as UserProfile) : null;
          setProfile(p);
          setDashboardLoading(false);
          if (p?.displayName) {
            const emailFrag = session?.user?.email?.split('@')[0];
            const oldNames = [p.username, emailFrag].filter(
              (n): n is string => Boolean(n) && n !== p.displayName,
            );
            if (oldNames.length) {
              await migratePostAuthors(oldNames, p.displayName);
              const fresh = await getStoredTribeFeedPosts();
              setTribePosts(fresh.slice(0, 3));
            }
          }
        })
        .catch(() => { setProfile(null); setDashboardLoading(false); });

      AsyncStorage.removeItem(FIRST_ACTION_CTA_KEY).catch(() => null);

      refreshWeightData().catch(() => null);

      // Today's walk steps from tracker (fallback when HealthKit unavailable)
      getDailyWalkTotals()
        .then((totals) => {
          setWalkSteps(totals.steps);
        })
        .catch(() => setWalkSteps(0));

      // Today's water intake (shared key with FuelScreen)
      loadWaterOz();
    }, [session?.user?.email, workoutLoggedToday, loadWaterOz, refreshHealth, refreshWeightData]),
  );

  React.useEffect(() => {
    if (!session?.user?.id || !todayWorkoutName) {
      setWorkoutInProgress(false);
      return;
    }

    const progressKey = getWorkoutProgressStorageKey(session.user.id, todayDateStr, todayWorkoutName);
    const completionKey = getWorkoutCompletionStorageKey(session.user.id, todayDateStr, todayWorkoutName);

    Promise.all([
      AsyncStorage.getItem(progressKey),
      AsyncStorage.getItem(completionKey),
    ])
      .then(([progressRaw, completedRaw]) => {
        const completed = completedRaw === '1';
        if (completed) {
          setWorkoutInProgress(false);
          setWorkoutLoggedToday(true);
          return;
        }

        if (!progressRaw) {
          setWorkoutInProgress(false);
          return;
        }

        const parsed = JSON.parse(progressRaw) as {
          cardioCompleted?: boolean;
          completedWarmupSteps?: number[];
          doneSets?: number[];
        };
        const hasProgress =
          Boolean(parsed.cardioCompleted) ||
          Boolean(parsed.completedWarmupSteps?.length) ||
          Boolean(parsed.doneSets?.length);
        setWorkoutInProgress(hasProgress);
      })
      .catch(() => setWorkoutInProgress(false));
  }, [session?.user?.id, todayDateStr, todayWorkoutName]);

  React.useEffect(() => {
    if (!session?.user?.id) {
      setMacroWeightTrend([]);
      setMacroSelectedDate(null);
      return;
    }

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    twelveMonthsAgo.setDate(twelveMonthsAgo.getDate() - 364);
    const sinceIso = twelveMonthsAgo.toISOString();

    Promise.all([
      supabase
        .from('nutrition_entries')
        .select('consumed_at, created_at, calories, protein_grams, carbs_grams, fat_grams')
        .eq('user_id', session.user.id)
        .or(`consumed_at.gte.${sinceIso},and(consumed_at.is.null,created_at.gte.${sinceIso})`)
        .order('consumed_at', { ascending: true, nullsFirst: false }),
      getWeightLog(),
    ]).then(([nutritionResponse, weightLog]) => {
      const nutritionRows = nutritionResponse.data ?? [];
      const weightRows = weightLog
        .filter((entry) => new Date(entry.loggedAt).getTime() >= twelveMonthsAgo.getTime())
        .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

      const loggedDates = [
        ...nutritionRows.map((row) => String(row.consumed_at ?? row.created_at).slice(0, 10)),
        ...weightRows.map((entry) => entry.loggedAt.slice(0, 10)),
      ].filter(Boolean);

      if (!loggedDates.length) {
        setMacroWeightTrend([]);
        setMacroSelectedDate(null);
        return;
      }

      const firstLoggedDate = loggedDates.reduce((earliest, current) => (current < earliest ? current : earliest), loggedDates[0]!);
      const lastLoggedDate = loggedDates.reduce((latest, current) => (current > latest ? current : latest), loggedDates[0]!);

      const byDate = new Map<string, MacroWeightPoint>();
      const seededDates: string[] = [];
      const cursor = new Date(`${firstLoggedDate}T00:00:00`);
      const endDate = new Date(`${lastLoggedDate}T00:00:00`);
      while (cursor <= endDate) {
        const dateKey = cursor.toISOString().slice(0, 10);
        byDate.set(dateKey, { date: dateKey, calories: 0, protein: 0, carbs: 0, fat: 0, weight: null });
        seededDates.push(dateKey);
        cursor.setDate(cursor.getDate() + 1);
      }

      nutritionRows.forEach((row) => {
        const timestamp = row.consumed_at ?? row.created_at;
        const date = String(timestamp).slice(0, 10);
        const point = byDate.get(date);
        if (!point) return;
        point.calories += Number(row.calories ?? 0);
        point.protein += Number(row.protein_grams ?? 0);
        point.carbs += Number(row.carbs_grams ?? 0);
        point.fat += Number(row.fat_grams ?? 0);
      });

      weightRows.forEach((entry) => {
          const date = entry.loggedAt.slice(0, 10);
          const point = byDate.get(date);
          if (!point) return;
          point.weight = entry.weightLbs;
        });

      const nextTrend = seededDates.map((date) => byDate.get(date)!);
      setMacroWeightTrend(nextTrend);
      setMacroSelectedDate((current) => {
        if (current && byDate.has(current)) return current;
        return nextTrend[nextTrend.length - 1]?.date ?? null;
      });
    }).catch(() => {
      setMacroWeightTrend([]);
      setMacroSelectedDate(null);
    });
  }, [session?.user?.id, latestWeightLbs]);

  React.useEffect(() => {
    AsyncStorage.getItem(MACRO_ACTION_PLAN_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as { actionPlan?: MacroActionPlan | null; generatedAt?: string; insightText?: string | null };
        if (parsed.actionPlan) setMacroActionPlan(parsed.actionPlan);
        if (parsed.insightText) setMacroInsightText(parsed.insightText);
      })
      .catch(() => null);
  }, []);

  React.useEffect(() => {
    if (!macroActionPlan && !macroInsightText) return;
    AsyncStorage.setItem(
      MACRO_ACTION_PLAN_KEY,
      JSON.stringify({
        actionPlan: macroActionPlan,
        generatedAt: new Date().toISOString(),
        insightText: macroInsightText,
      }),
    ).catch(() => null);
  }, [macroActionPlan, macroInsightText]);

  const handleStartWorkout = async () => {
    await openTrainToday();
  };

  const handleOpenPlan = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await rewardFirstAction().catch(() => null);
    await AsyncStorage.removeItem(FIRST_ACTION_CTA_KEY).catch(() => null);
    navigation.navigate('Plans');
  };

  const handleViewDiary = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('Fuel');
  };

  const handleOpenWalkTracker = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('WalkTracker');
  };

  const handleOpenWeightInsights = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await refreshWeightData().catch(() => null);
    setWeightInsightsVisible(true);
  };

  const handleShareMealCard = React.useCallback(async (food: ScannedFood) => {
    setMealShareData({
      foodName: food.name,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      displayName: profile?.displayName || session?.user?.email?.split('@')[0],
      accent,
    });

    setTimeout(async () => {
      try {
        const uri = await mealShareRef.current?.capture?.();
        if (!uri) throw new Error('capture_failed');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: 'Share your meal win',
          });
        }
      } catch {
        Share.share({
          message: `Just logged ${food.name} on APEX — ${food.calories} kcal · ${food.protein}g protein 💪 #APEX #NutritionWin`,
        }).catch(() => null);
      }
    }, 200);
  }, [accent, profile?.displayName, session?.user?.email]);

  const handleAnalyzeMacroData = React.useCallback(async () => {
    if (macroInsightLoading || macroWeightTrend.length < 2) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    setMacroInsightVisible(true);
    setMacroInsightLoading(true);
    setMacroInsightText(null);
    setMacroActionPlan(null);
    setMacroInsightTab('insight');
    setMacroApplyState({ mealPlan: 'idle', grocery: 'idle', notifications: 'idle', training: 'idle' });

    await AsyncStorage.setItem(MACRO_ACTION_PLAN_PENDING_KEY, '1').catch(() => null);

    try {
      const allDays = macroWeightTrend;
      const avg = (values: number[]) => values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;
      const nutritionDays = allDays.filter((p) => p.calories > 0 || p.protein > 0 || p.carbs > 0 || p.fat > 0);
      const weightPoints = allDays.filter((p) => p.weight != null).map((p) => p.weight as number);
      const latestWeight = weightPoints.length ? weightPoints[weightPoints.length - 1] : null;
      const firstWeight = weightPoints.length ? weightPoints[0] : null;
      const weightChange = latestWeight != null && firstWeight != null ? Math.round((latestWeight - firstWeight) * 10) / 10 : null;
      const personaPrefix = await getCoachPersonaPrefix().catch(() => '');
      const displayName = profile?.displayName || session?.user?.email?.split('@')[0] || 'Athlete';
      const goalLabels: Record<string, string> = {
        lose: 'fat loss', build: 'muscle building', recomp: 'body recomposition', performance: 'athletic performance',
      };
      const goalLabel = profile?.goal ? goalLabels[profile.goal] ?? profile.goal : 'general progress';

      // Summarize the logged trend window into weekly buckets to keep prompt small but rich
      const weekBuckets: Array<{ week: string; avgCal: number; avgProtein: number; avgCarbs: number; avgFat: number; avgWeight: number | null; days: number }> = [];
      for (let i = 0; i < allDays.length; i += 7) {
        const chunk = allDays.slice(i, i + 7);
        const nutritionChunk = chunk.filter((p) => p.calories > 0 || p.protein > 0 || p.carbs > 0 || p.fat > 0);
        const wPts = chunk.filter((p) => p.weight != null).map((p) => p.weight as number);
        weekBuckets.push({
          week: chunk[0].date,
          avgCal: avg(nutritionChunk.map((p) => p.calories)),
          avgProtein: avg(nutritionChunk.map((p) => p.protein)),
          avgCarbs: avg(nutritionChunk.map((p) => p.carbs)),
          avgFat: avg(nutritionChunk.map((p) => p.fat)),
          avgWeight: wPts.length ? Math.round((wPts.reduce((s, v) => s + v, 0) / wPts.length) * 10) / 10 : null,
          days: nutritionChunk.length,
        });
      }

      const payload = {
        totalDays: allDays.length,
        nutritionDaysLogged: nutritionDays.length,
        weighInsLogged: weightPoints.length,
        latestWeight,
        weightChangeLoggedWindow: weightChange,
        overallAvgCalories: avg(nutritionDays.map((p) => p.calories)),
        overallAvgProtein: avg(nutritionDays.map((p) => p.protein)),
        overallAvgCarbs: avg(nutritionDays.map((p) => p.carbs)),
        overallAvgFat: avg(nutritionDays.map((p) => p.fat)),
        weeklyBreakdown: weekBuckets,
      };

      const system = `${personaPrefix}You are the APEX AI Coach. Analyze the user's logged macro vs weight trend data and return a JSON action plan — no markdown, no commentary outside the JSON.
Treat resting burn / BMR as real daily energy expenditure. If both active burn and resting burn are present, reason about the user's total daily burn using both together instead of pretending calories are only burned through exercise.

Return ONLY valid JSON in this exact shape:
{
  "insight": "5-7 sentence plain-English coaching analysis. It must explicitly explain: 1) when this user's weight tends to go down based on calories, protein, carbs, fat, movement, calorie burn, resting burn / BMR, and food quality, 2) when this user's weight tends to go up, 3) what to do today and tomorrow to move toward the user's goal, and 4) end with: Would you like me to apply these changes to your overall plan now so we can reach [goal]?",
  "score": "A|B+|B|C+|C|D",
  "scoreReason": "One sentence explaining the score.",
  "badges": ["up to 3 short achievement labels based on data, e.g. Protein Champion, Consistent Logger, Fat Loss Streak"],
  "todayMeals": [
    {"name":"Breakfast","suggestion":"specific foods","calories":0,"protein":0,"carbs":0,"fat":0,"tip":"short coach tip"},
    {"name":"Lunch","suggestion":"specific foods","calories":0,"protein":0,"carbs":0,"fat":0,"tip":"short coach tip"},
    {"name":"Dinner","suggestion":"specific foods","calories":0,"protein":0,"carbs":0,"fat":0,"tip":"short coach tip"},
    {"name":"Snack","suggestion":"specific foods","calories":0,"protein":0,"carbs":0,"fat":0,"tip":"short coach tip"}
  ],
  "tomorrowMeals": [same structure],
  "todayMovement": {"type":"light|moderate|intense|rest","description":"2-sentence coaching note","stepGoal":8000,"workoutNote":"specific training focus"},
  "tomorrowMovement": {"type":"light|moderate|intense|rest","description":"2-sentence coaching note","stepGoal":8000,"workoutNote":"specific training focus"},
  "groceryItems": ["6-8 specific food items the user should buy based on their goals and intake gaps"],
  "notificationSuggestions": [
    {"title":"short title","body":"coaching message","hour":8,"minute":0},
    {"title":"short title","body":"coaching message","hour":13,"minute":0},
    {"title":"short title","body":"coaching message","hour":19,"minute":0}
  ]
}`;

      // Pull today's food entries from Supabase for richer context
      const userId = session?.user?.id;
      let todayFoodLog: Array<{ name: string; calories: number; protein: number; carbs: number; fat: number }> = [];
      if (userId) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: foodRows } = await supabase
          .from('nutrition_entries')
          .select('meal_name, calories, protein_grams, carbs_grams, fat_grams')
          .eq('user_id', userId)
          .gte('created_at', `${today}T00:00:00`)
          .order('created_at', { ascending: true })
          .limit(20);
        if (foodRows) {
          todayFoodLog = foodRows.map((r: { meal_name: string | null; calories: number | null; protein_grams: number | null; carbs_grams: number | null; fat_grams: number | null }) => ({
            name: r.meal_name ?? 'Unknown',
            calories: r.calories ?? 0,
            protein: r.protein_grams ?? 0,
            carbs: r.carbs_grams ?? 0,
            fat: r.fat_grams ?? 0,
          }));
        }
      }

      const liveContext = {
        todayConsumed: { calories: totals.caloriesConsumed, protein: totals.protein, carbs: totals.carbs, fat: totals.fat },
        todayBurned: totals.caloriesBurned > 0 ? totals.caloriesBurned : undefined,
        todayActiveBurn: totals.activeCaloriesBurned > 0 ? totals.activeCaloriesBurned : undefined,
        todayRestingBurn: totals.restingCaloriesBurned > 0 ? totals.restingCaloriesBurned : undefined,
        todaySteps: totalStepCount > 0 ? totalStepCount : undefined,
        todayWaterOz: waterOz > 0 ? waterOz : undefined,
        sleep: sleep ? { totalHours: sleep.totalHours, remMinutes: sleep.remMinutes, deepMinutes: sleep.deepMinutes } : undefined,
        todayFoodLog: todayFoodLog.length > 0 ? todayFoodLog : undefined,
        currentWeight: latestWeightLbs,
        goalWeight: profile?.goalWeightLbs ? parseFloat(profile.goalWeightLbs) : undefined,
        currentLevel: level,
        workoutActiveToday: workoutInProgress || totals.activeCaloriesBurned > 0,
      };

      const userPrompt = `Athlete: ${displayName} | Goal: ${goalLabel}
Daily targets: ${macros.dailyCalorieTarget} kcal · ${macros.dailyProtein}g protein · ${macros.dailyCarbs}g carbs · ${macros.dailyFat}g fat
Body stats: ${profile?.heightFt && profile?.weightLbs ? `${profile.heightFt}' · ${profile.weightLbs} lbs current` : `${latestWeightLbs ?? '?'} lbs current`} · ${profile?.goalWeightLbs || '?'} lbs goal · ${profile?.activityLevel ?? 'unknown'} activity level · ${profile?.age ?? '?'} yrs old
Experience: ${profile?.experience ?? 'unspecified'} | Health notes: ${profile?.healthConditions?.join(', ') || 'none'} | Preferred foods: ${profile?.foodPreferences?.join(', ') || 'unspecified'} | Avoidances: ${profile?.foodAvoidances || 'none'}

TODAY'S LIVE DATA:
${JSON.stringify(liveContext, null, 0)}

LOGGED TREND SUMMARY (${payload.totalDays} days of data, grouped weekly):
${JSON.stringify(payload, null, 0)}`;

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 2400,
          system,
          messages: [{ role: 'user', content: userPrompt }],
        },
      });

      if (error) throw new Error(error.message);

      const raw =
        typeof data?.content === 'string' ? data.content
        : Array.isArray(data?.content) ? (data.content as Array<{ text?: string }>).map((b) => b.text ?? '').join('').trim()
        : typeof data?.data?.content === 'string' ? data.data.content
        : Array.isArray(data?.data?.content) ? (data.data.content as Array<{ text?: string }>).map((b) => b.text ?? '').join('').trim()
        : '';

      // Robust JSON extraction: strip fences, then find outermost {...} block
      let plan: MacroActionPlan | null = null;
      try {
        const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        // Try direct parse first
        plan = JSON.parse(stripped) as MacroActionPlan;
      } catch {
        // Fall back to extracting the first complete {...} block
        try {
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) plan = JSON.parse(match[0]) as MacroActionPlan;
        } catch { /* fall through to fallback text */ }
      }

      if (plan?.insight) {
        setMacroActionPlan(plan);
        setMacroInsightText(plan.insight);
      } else {
        setMacroInsightText(raw || 'Keep logging consistently — the pattern is building. Protein and weight trend look like they\'re responding. Stay the course for another 7 days and we\'ll have a sharper picture.');
      }
    } catch {
      setMacroInsightText('I can already see the shape of the trend. Keep protein high, stay consistent, and use the next 7–14 days to confirm the direction.');
    } finally {
      AsyncStorage.removeItem(MACRO_ACTION_PLAN_PENDING_KEY).catch(() => null);
      setMacroInsightLoading(false);
    }
  }, [macroInsightLoading, macroWeightTrend, macros, profile, session, totals, walkSteps, steps, waterOz, sleep, latestWeightLbs, level, workoutInProgress]);

  const resumePendingMacroAnalysis = React.useCallback(async () => {
    if (macroInsightLoading || macroWeightTrend.length < 2) return;
    const pending = await AsyncStorage.getItem(MACRO_ACTION_PLAN_PENDING_KEY).catch(() => null);
    if (pending !== '1') return;
    setMacroInsightVisible(true);
    handleAnalyzeMacroData().catch(() => null);
  }, [handleAnalyzeMacroData, macroInsightLoading, macroWeightTrend.length]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        resumePendingMacroAnalysis().catch(() => null);
      }
    });
    return () => subscription.remove();
  }, [resumePendingMacroAnalysis]);

  useFocusEffect(
    React.useCallback(() => {
      resumePendingMacroAnalysis().catch(() => null);
    }, [resumePendingMacroAnalysis]),
  );

  const handleOpenMacroReview = React.useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    if (hasSavedMacroReview) {
      setMacroInsightTab('insight');
      setMacroInsightVisible(true);
      return;
    }
    handleAnalyzeMacroData().catch(() => null);
  }, [handleAnalyzeMacroData, hasSavedMacroReview]);

  const handleSpeakMacroInsight = React.useCallback(async () => {
    if (!macroInsightText || macroInsightSpeaking) return;
    setMacroInsightSpeaking(true);
    await speakWithElevenLabs(macroInsightText, env.elevenLabsApiKey, { maxSentences: 12 }).catch(() => null);
    setMacroInsightSpeaking(false);
  }, [macroInsightSpeaking, macroInsightText]);

  // ── Apply: save AI meal plan to AsyncStorage so FuelScreen can read it ────
  const handleApplyMealPlan = React.useCallback(async () => {
    if (!macroActionPlan || macroApplyState.mealPlan !== 'idle') return;
    setMacroApplyState((s) => ({ ...s, mealPlan: 'loading' }));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    try {
      const today = macroActionPlan.todayMeals.map((m) => ({
        mealName: m.name,
        suggestion: m.suggestion,
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        coachTip: m.tip,
      }));
      const tomorrow = macroActionPlan.tomorrowMeals.map((m) => ({
        mealName: m.name,
        suggestion: m.suggestion,
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        coachTip: m.tip,
      }));
      await AsyncStorage.setItem('apex.aiMealSuggestions.v1', JSON.stringify({ today, tomorrow, generatedAt: new Date().toISOString() }));
      setMacroApplyState((s) => ({ ...s, mealPlan: 'done' }));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
    } catch {
      setMacroApplyState((s) => ({ ...s, mealPlan: 'idle' }));
    }
  }, [macroActionPlan, macroApplyState.mealPlan]);

  // ── Apply: inject AI grocery items into existing grocery list ─────────────
  const handleApplyGroceryList = React.useCallback(async () => {
    if (!macroActionPlan || macroApplyState.grocery !== 'idle') return;
    setMacroApplyState((s) => ({ ...s, grocery: 'loading' }));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    try {
      const raw = await AsyncStorage.getItem('apex.grocerylist.v1');
      const existing = raw ? JSON.parse(raw) as { items: Array<{ id: string; name: string; quantity: string; estimatedPrice: number; category: string; checked: boolean }> } : { items: [] };
      const newItems = macroActionPlan.groceryItems.map((item, i) => ({
        id: `ai-${Date.now()}-${i}`,
        name: item,
        quantity: '1',
        estimatedPrice: 4.99,
        category: 'Protein' as const,
        checked: false,
      }));
      // Deduplicate by name
      const existingNames = new Set(existing.items.map((it) => it.name.toLowerCase()));
      const toAdd = newItems.filter((it) => !existingNames.has(it.name.toLowerCase()));
      const merged = { ...existing, items: [...existing.items, ...toAdd], generatedAt: new Date().toISOString(), totalEstimate: 0 };
      await AsyncStorage.setItem('apex.grocerylist.v1', JSON.stringify(merged));
      setMacroApplyState((s) => ({ ...s, grocery: 'done' }));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
    } catch {
      setMacroApplyState((s) => ({ ...s, grocery: 'idle' }));
    }
  }, [macroActionPlan, macroApplyState.grocery]);

  // ── Apply: schedule smart notifications from AI suggestions ──────────────
  const handleApplyNotifications = React.useCallback(async () => {
    if (!macroActionPlan || macroApplyState.notifications !== 'idle') return;
    setMacroApplyState((s) => ({ ...s, notifications: 'loading' }));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    try {
      const scheduled = await scheduleAIInsightNotifications(macroActionPlan.notificationSuggestions);
      if (!scheduled) {
        setMacroApplyState((s) => ({ ...s, notifications: 'idle' }));
        return;
      }
      setMacroApplyState((s) => ({ ...s, notifications: 'done' }));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
    } catch {
      setMacroApplyState((s) => ({ ...s, notifications: 'idle' }));
    }
  }, [macroActionPlan, macroApplyState.notifications]);

  const handleApplyTrainingPlan = React.useCallback(async () => {
    if (!macroActionPlan || macroApplyState.training !== 'idle' || !profile) return;
    setMacroApplyState((s) => ({ ...s, training: 'loading' }));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    try {
      const planId = profile.activePlanId ?? getSuggestedPlanId(profile.goal ?? 'recomp', profile.experience ?? 'intermediate');
      const basePlan = getPlanById(planId === 'ai-generated' ? undefined : planId);
      const todayBase = basePlan.schedule[todayProgramIndex()] ?? basePlan.schedule[0];
      const adjustedWorkout: AIWorkout = {
        name: `AI Adjusted ${todayBase.name}`,
        duration: Math.max(20, Math.round((todayBase.meta.match(/(\d+)\s*min/i)?.[1] ? Number(todayBase.meta.match(/(\d+)\s*min/i)?.[1]) : 45))),
        focus: macroActionPlan.todayMovement.type === 'rest' ? 'Recovery' : macroActionPlan.todayMovement.type === 'intense' ? 'Performance push' : 'Goal-focused training',
        exercises: todayBase.exercises.map((exercise) => {
          const setsMatch = exercise.sets.match(/(\d+)\s*x\s*([^·]+)/i);
          const restMatch = exercise.sets.match(/Rest\s*(.+)$/i);
          return {
            name: exercise.name,
            reps: setsMatch?.[2]?.trim() ?? '8-10',
            rest: restMatch?.[1]?.trim(),
            sets: Number(setsMatch?.[1] ?? 3),
            weight: macroActionPlan.todayMovement.type === 'intense' ? 'push with intent' : 'controlled effort',
          };
        }),
        coachNote: macroActionPlan.todayMovement.workoutNote,
        generatedAt: new Date().toISOString(),
      };

      await saveAIWorkout(adjustedWorkout);
      const nextProfile: UserProfile = { ...profile, activePlanId: 'ai-generated' };
      await syncProfileToSupabase(session?.user?.id, nextProfile).catch(() => null);
      setProfile(nextProfile);
      setAiWorkout(adjustedWorkout);
      setMacroApplyState((s) => ({ ...s, training: 'done' }));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
    } catch {
      setMacroApplyState((s) => ({ ...s, training: 'idle' }));
    }
  }, [macroActionPlan, macroApplyState.training, profile, session?.user?.id]);

  const handleShareMacroActionPlan = React.useCallback(async () => {
    if (!macroActionPlan) return;
    setMacroShareVisible(true);
    setTimeout(async () => {
      try {
        const uri = await macroShareRef.current?.capture?.();
        if (!uri) throw new Error('capture_failed');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: 'Share your action plan',
          });
        }
      } catch {
        Share.share({
          message: `APEX AI Coach built my action plan — trend score ${macroActionPlan.score}. Locking in my food and movement goals today. #APEX`,
        }).catch(() => null);
      } finally {
        setMacroShareVisible(false);
      }
    }, 200);
  }, [macroActionPlan]);

  React.useEffect(() => {
    const stepGoal = macroActionPlan?.todayMovement?.stepGoal;
    if (!stepGoal || totalStepCount < stepGoal) return;
    AsyncStorage.getItem(STEP_GOAL_CELEBRATION_KEY)
      .then(async (shownDate) => {
        if (shownDate === todayDateStr) return;
        await AsyncStorage.setItem(STEP_GOAL_CELEBRATION_KEY, todayDateStr).catch(() => null);
        setMovementGoalCelebration(true);
      })
      .catch(() => null);
  }, [macroActionPlan?.todayMovement?.stepGoal, todayDateStr, totalStepCount]);

  React.useEffect(() => {
    const mealGoalCount = getMealsGoalCount(profile);
    const caloriesWithinRange =
      totals.caloriesConsumed >= Math.round(macros.dailyCalorieTarget * 0.8) &&
      totals.caloriesConsumed <= Math.round(macros.dailyCalorieTarget * 1.15);
    const foodGoalHit = mealsLoggedToday >= mealGoalCount && totals.protein >= macros.dailyProtein && caloriesWithinRange;
    if (!foodGoalHit) return;
    AsyncStorage.getItem(FOOD_GOAL_CELEBRATION_KEY)
      .then(async (shownDate) => {
        if (shownDate === todayDateStr) return;
        await AsyncStorage.setItem(FOOD_GOAL_CELEBRATION_KEY, todayDateStr).catch(() => null);
        setFoodGoalCelebration(true);
      })
      .catch(() => null);
  }, [macros.dailyCalorieTarget, macros.dailyProtein, mealsLoggedToday, profile, todayDateStr, totals.caloriesConsumed, totals.protein]);

  const dashboardShortcutMeta = React.useMemo(() => {
    const todayStepGoal = macroActionPlan?.todayMovement?.stepGoal ?? null;
    const remainingSteps = todayStepGoal ? Math.max(todayStepGoal - totalStepCount, 0) : null;
    const meta: Record<DashboardShortcutId, { avatar?: ImageSourcePropType; badge?: string; emoji: string; label: string; onPress: () => void; sub?: string }> = {
      meals: {
        badge: mealsLoggedToday > 0 ? `${mealsLoggedToday} logged` : undefined,
        emoji: '🍽️',
        label: 'Meals',
        onPress: () => setMealScanVisible(true),
        sub: 'Log food',
      },
      on_the_go: {
        badge: profile?.zipCode?.trim() ? profile.zipCode.trim() : undefined,
        emoji: '🥗',
        label: 'On the Go',
        onPress: () => {
          AsyncStorage.setItem(ON_THE_GO_OPEN_REQUEST_KEY, '1').catch(() => null);
          navigation.navigate('Fuel');
        },
        sub: 'Nearby food',
      },
      water: {
        badge: waterOz > 0 ? `${Math.round(waterOz / 8)} gl` : undefined,
        emoji: '💧',
        label: 'Water',
        onPress: () => { loadWaterOz(); setWaterModalVisible(true); },
        sub: `${waterOz} oz`,
      },
      weight: {
        badge: latestWeightLbs != null ? `${latestWeightLbs} lbs` : undefined,
        emoji: '⚖️',
        label: 'Weight',
        onPress: handleOpenWeightInsights,
        sub: latestWeightLbs != null ? 'View trend' : 'Log weight',
      },
      walk: {
        badge: todayStepGoal
          ? (remainingSteps ?? 0) === 0
            ? 'Goal hit ✓'
            : `${(remainingSteps ?? 0).toLocaleString()} left`
          : totalStepCount > 0
            ? totalStepCount.toLocaleString()
            : undefined,
        emoji: '🚶',
        label: 'Steps',
        onPress: handleOpenWalkTracker,
        sub: todayStepGoal
          ? `Goal ${todayStepGoal.toLocaleString()}`
          : totalStepCount > 0
            ? 'Steps today'
            : 'Track steps',
      },
      tribe: { emoji: '🔥', label: 'Tribe', onPress: () => navigation.navigate('Tribe'), sub: 'Community' },
      leaderboard: { emoji: '🏆', label: 'Leaderboard', onPress: () => navigation.navigate('Tribe', { initialTab: 'leaderboard' } as never), sub: 'Ranks' },
      academy: { emoji: '🎓', label: 'Academy', onPress: () => navigation.navigate('Tribe', { initialTab: 'academy' } as never), sub: 'Learn' },
      coach: {
        avatar: activeCoachVoice?.avatar,
        emoji: '🤖',
        label: activeCoachVoice?.label ?? 'Coach',
        onPress: () => navigation.navigate('Coach'),
        sub: activeCoachVoice?.label ? `Ask ${activeCoachVoice.label}` : 'Ask Coach',
      },
      live_coach: { emoji: '🎥', label: 'Live Coach', onPress: () => navigation.navigate('LiveCoach'), sub: 'Book session' },
      this_week: { emoji: '📅', label: 'This Week', onPress: () => navigation.navigate('Train'), sub: 'Plan view' },
    };
    return meta;
  }, [activeCoachVoice?.avatar, activeCoachVoice?.label, handleOpenWalkTracker, handleOpenWeightInsights, latestWeightLbs, loadWaterOz, macroActionPlan?.todayMovement?.stepGoal, mealsLoggedToday, navigation, profile?.zipCode, totalStepCount, waterOz]);

  const toggleDashboardShortcut = React.useCallback(async (id: DashboardShortcutId) => {
    setDashboardShortcuts((prev) => {
      const exists = prev.includes(id);
      const next = exists
        ? prev.filter((item) => item !== id)
        : [...prev, id].slice(-4);
      AsyncStorage.setItem(DASHBOARD_SHORTCUTS_KEY, JSON.stringify(next)).catch(() => null);
      return next.length ? next : DEFAULT_DASHBOARD_SHORTCUTS;
    });
  }, []);

  const handleEmergencySelect = async (feeling: string) => {
    setEmergencyState(feeling);
    setEmergencyReply(null);
    setEmergencyLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Increment free usage count for non-Pro users
    if (!isPro) {
      const monthKey = `apex.emergency.month.${new Date().toISOString().slice(0, 7)}`;
      const next = emergencyUsesThisMonth + 1;
      setEmergencyUsesThisMonth(next);
      AsyncStorage.setItem(monthKey, String(next)).catch(() => null);
    }

    const displayName = profile?.displayName || session?.user?.email?.split('@')[0] || 'Athlete';
    const goalLabels: Record<string, string> = {
      lose: 'fat loss',
      build: 'muscle building',
      recomp: 'body recomposition',
      performance: 'athletic performance',
    };
    const profileContext = [
      profile?.goal ? `Goal: ${goalLabels[profile.goal] ?? profile.goal}` : null,
      profile?.healthConditions?.length ? `Health conditions: ${profile.healthConditions.join(', ')}` : null,
    ].filter(Boolean).join('. ');

    const personaPrefix = await getCoachPersonaPrefix().catch(() => '');
    const systemPrompt = `${personaPrefix}You are an APEX Emergency Coach — fierce, deeply human, refusing to let athletes quit. Help someone struggling to stay consistent and reignite their fire. Keep your response to 3–4 sentences maximum. Be direct, personal, and emotionally resonant. No fluff, no generic platitudes. Speak directly to them by name. End with one powerful action they can take RIGHT NOW.${profileContext ? ` Context: ${profileContext}.` : ''}`;

    const userMsg = `My name is ${displayName}. I'm reaching out to my coach because: "${feeling}". I need help staying consistent and not giving up.`;

    try {
      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMsg }],
        },
      });

      if (error || !data?.content?.[0]?.text) {
        // Demo fallback
        const fallbacks: Record<string, string> = {
          "I want to quit": `${displayName}, every champion has stood exactly where you're standing right now. The urge to quit is proof you've been pushing hard — that's not weakness, that's progress. Your future self is counting on the decision you make in the next 60 seconds. Right now, put your shoes on and take one walk around the block. One. That's all.`,
          "I've been slacking": `${displayName}, slacking isn't failure — it's a signal your routine needs a reset, not an ending. Every single day is a clean slate and today is yours. Don't wait for motivation — it follows action, never precedes it. Stand up right now and do 10 squats. Ten. Your comeback starts this second.`,
          "I'm overwhelmed": `${displayName}, you don't have to do everything — you just have to do one thing. Overwhelm is your brain protecting you by dramatising the distance, but the finish line doesn't matter right now. Only the next step does. Right now: drink a full glass of water and take three slow deep breaths. Reset. You've got this.`,
          "I don't see results": `${displayName}, results live in the dark — you rarely see them until you're already past them. Your body is changing every single workout even when the mirror lies. Trust the process you started and honour the version of yourself who began. Open your logs right now and find one measurable thing that IS better than week one. It's there.`,
          "I feel like I'm failing": `${displayName}, failure is showing up and going through it anyway — quitting is the only real failure. Every rep you've ever done lives in your body permanently. No one can take that from you. Text one friend right now and tell them your goal out loud. Accountability is the antidote to feeling like you're failing alone.`,
          "I'm exhausted": `${displayName}, exhaustion means you've been giving real effort — that matters. But rest isn't retreat, it's strategy. Your body builds muscle and resilience in recovery, not just during training. Give yourself permission to do a 10-minute gentle stretch tonight instead of a full session. That IS training. Show up soft — just show up.`,
        };
        setEmergencyReply(fallbacks[feeling] ?? `${displayName}, you reached out — that took courage and that IS the first step. You haven't quit. You're here. Take one small action right now: write down the reason you started. That reason is still true.`);
      } else {
        setEmergencyReply(data.content[0].text as string);
      }
    } catch {
      setEmergencyReply(`${displayName}, reaching out is the first act of not quitting — you're already doing it. Take one breath, then take one step. That's all that's required right now.`);
    } finally {
      setEmergencyLoading(false);
    }
  };

  const proteinPct = Math.min(Math.round((totals.protein / macros.dailyProtein) * 100), 100);
  const carbsPct = Math.min(Math.round((totals.carbs / macros.dailyCarbs) * 100), 100);
  const fatPct = Math.min(Math.round((totals.fat / macros.dailyFat) * 100), 100);

  return (
    <View style={styles.screen}>
      <AppHeader />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <VerifyEmailBanner />
        {dashboardLoading ? (
          <View style={[styles.heroCard, { gap: 12 }]}>
            <SkeletonCard height={14} width="50%" borderRadius={8} />
            <SkeletonCard height={32} borderRadius={8} />
            <SkeletonCard height={14} width="70%" borderRadius={8} />
            <SkeletonCard height={11} width="90%" borderRadius={6} style={{ marginTop: 4 }} />
            <SkeletonCard height={44} borderRadius={14} style={{ marginTop: 4 }} />
          </View>
        ) : (
          <Reanimated.View style={[styles.heroCard, { backgroundColor: accentSoft, borderColor: accentBorder }, workoutLoggedToday && hero.badge !== 'rest' ? { backgroundColor: `${accent}12`, borderColor: `${accent}60` } : null, heroAnimStyle]}>
            <Text style={[styles.heroEyebrow, { color: accent }]}>{hero.eyebrow}</Text>
            <View style={styles.heroTitleRow}>
              <Text style={[styles.heroTitle, { flex: 1, color: C.text }]}>{hero.title}</Text>
              <View style={styles.heroMiniStats}>
                <View style={styles.heroMiniStat}>
                  <Text style={[styles.heroMiniStatVal, { color: accent }]}>
                    {Math.max(macros.dailyCalorieTarget - totals.caloriesConsumed, 0)}
                  </Text>
                  <Text style={styles.heroMiniStatLabel}>food left today</Text>
                </View>
                <View style={styles.heroMiniStat}>
                  <Text style={[styles.heroMiniStatVal, { color: C.text }]}>{totals.caloriesBurned}</Text>
                  <Text style={styles.heroMiniStatLabel}>total burn</Text>
                  <Text style={styles.heroMiniStatSub}>
                    {`${totals.restingCaloriesBurned} rest · ${totals.activeCaloriesBurned} active`}
                  </Text>
                </View>
                <View style={styles.heroMiniStat}>
                  <Text style={[styles.heroMiniStatVal, { color: accent }]}>Lv.{level}</Text>
                  <Text style={styles.heroMiniStatLabel}>level</Text>
                </View>
              </View>
            </View>
            {/* ── AI Coach tip — inset card ── */}
            <View style={styles.heroAiCard}>
              <View style={styles.heroAiCardHeader}>
                {activeCoachVoice ? (
                  <Image source={activeCoachVoice.avatar} style={styles.heroAiAvatar} />
                ) : (
                  <Text style={styles.heroAiIcon}>🤖</Text>
                )}
                <Text style={[styles.heroAiStrong, { color: accent }]}>
                  {activeCoachVoice ? `${activeCoachVoice.label} · ${activeCoachVoice.shortLabel}` : 'AI Coach'}
                </Text>
                {isPro && (
                  <Pressable
                    style={({ pressed }) => [styles.heroVoiceBtn, { backgroundColor: `${accent}20`, borderColor: `${accent}40` }, pressed && { opacity: 0.7 }]}
                    onPress={handleSpeakCoachTip}
                    hitSlop={10}
                  >
                    <Text style={[styles.heroVoiceBtnText, { color: accent }]}>
                      {coachVoicePlaying ? '⏹ Stop' : `🔊 ${activeCoachVoice?.label ?? 'Coach'}`}
                    </Text>
                  </Pressable>
                )}
              </View>
              <Text style={styles.heroAiText}>
                {!isPro
                  ? 'Upgrade to Pro for personalised daily coaching insights.'
                  : buildCoachSummary(
                      totals.protein, totals.caloriesConsumed, totals.caloriesBurned,
                      totalStepCount,
                      hero.eyebrow.split(' · ')[1]?.split(' ')[0] ?? "today's workout",
                      latestWeightLbs, weeklyWeightAvg,
                      profile?.goalWeightLbs ? parseFloat(profile.goalWeightLbs) : null,
                      macros.dailyProtein, macros.dailyCalorieTarget, activeCoachVoice?.label ?? 'Coach Josh',
                    )}
              </Text>
            </View>

            {/* ── Quick-action chips — always visible ── */}
            <View style={styles.restChipRow}>
              {dashboardShortcuts.map((shortcutId) => {
                const item = dashboardShortcutMeta[shortcutId];
                return (
                  <Pressable
                    key={shortcutId}
                    style={styles.restChip}
                    onPress={item.onPress}
                    onLongPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
                      setShortcutPickerVisible(true);
                    }}
                  >
                    {item.avatar ? (
                      <Image source={item.avatar} style={styles.restChipAvatar} />
                    ) : (
                      <Text style={styles.restChipEmoji}>{item.emoji}</Text>
                    )}
                    <Text style={styles.restChipText}>{item.label}</Text>
                    <Text style={styles.restChipSub}>{item.sub}</Text>
                    {item.badge ? (
                      <Text style={[styles.restChipBadge, { color: accent }]}>{item.badge}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.shortcutHelperText}>Press and hold any shortcut to choose your dashboard chips.</Text>

            {/* ── Primary action button — only on training days ── */}
            {hero.badge !== 'rest' && (
              <Pressable
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { backgroundColor: workoutLoggedToday ? 'transparent' : accent },
                  workoutLoggedToday ? { borderWidth: 1.5, borderColor: accentStrongBorder } : null,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleStartWorkout}
              >
                <Text style={[styles.btnPrimaryText, workoutLoggedToday ? { color: accent } : null]}>
                  {workoutLoggedToday ? 'Workout Complete ✓' : workoutInProgress ? 'Continue Workout ⚡' : "Start Today's Workout ⚡"}
                </Text>
              </Pressable>
            )}

            {/* ── Emergency Coach — subtle inline link ── */}
            <View style={styles.emergencyDivider} />
            <Pressable style={styles.emergencyInlineBtn} onPress={openEmergencyCoach}>
              <Text style={styles.emergencyInlineText}>
                {!isPro && emergencyUsesThisMonth >= FREE_EMERGENCY_LIMIT
                  ? `🔒 Emergency Coach · upgrade for unlimited`
                  : `🚨 Struggling right now? Emergency Coach${!isPro ? `  ·  ${FREE_EMERGENCY_LIMIT - emergencyUsesThisMonth} free left` : ''}`}
              </Text>
            </Pressable>
          </Reanimated.View>
        )}

        {(() => {
          const freq = profile?.weighFrequency ?? null;
          const dueSessions = freq
            ? getDueSessions(freq, todayWeightEntries)
            : [];
          const weightItems = dueSessions.map((s) => ({
            key: `weight-${s.session}`,
            label: s.label,
            done: s.done,
            session: s.session,
          }));
          return (
            <DailyChecklist
              workoutDone={workoutLoggedToday}
              mealsLogged={mealsLoggedToday}
              mealHints={mealHints}
              weightItems={weightItems}
              onWorkoutPress={() => handleStartWorkout().catch(() => null)}
              onMealPress={() => navigation.navigate('Fuel')}
              onWeightPress={(session) => {
                setWeightModalSession(session);
                setWeightModalVisible(true);
              }}
              onAllDone={async () => {
                const todayKey = new Date().toISOString().slice(0, 10);
                const shownDate = await AsyncStorage.getItem('apex.checklist.celebrationShownDate');
                if (shownDate === todayKey) return;
                await AsyncStorage.setItem('apex.checklist.celebrationShownDate', todayKey);
                setChecklistCelebration(true);
              }}
              accent={accent}
              accentSoft={accentSoft}
              accentBorder={accentBorder}
            />
          );
        })()}

        <View style={[styles.activityPreviewCard, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
          <Pressable
            style={styles.activityPreviewHeaderRow}
            onPress={() => { setMacroTrendExpanded((v) => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null); }}
          >
            <Text style={[styles.activityPreviewEyebrow, { color: accent }]}>Macro vs Weight Trend</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {macroTrendExpanded && (
                <Pressable
                  style={({ pressed }) => [
                    styles.activityAnalyzeBtn,
                    { backgroundColor: accentSoft, borderColor: accentBorder },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => handleOpenMacroReview().catch(() => null)}
                >
                  <Text style={[styles.activityAnalyzeBtnText, { color: accent }]}>{hasSavedMacroReview ? 'Review Data' : 'Analyze Data'}</Text>
                </Pressable>
              )}
              <Text style={{ color: C.muted, fontSize: 16 }}>{macroTrendExpanded ? '▲' : '▼'}</Text>
            </View>
          </Pressable>
          {macroTrendExpanded && (
            <>
              <Text style={styles.activityPreviewText}>
                See how calories, protein, carbs, fat, and body weight have moved together across the logged data you have so far, up to the last 12 months.
              </Text>
              <MacroWeightTrendChart
                data={macroWeightTrend}
                accentBorder={accentBorder}
                accentColor={accent}
                accentColorSoft={accentSoft}
                activeMetrics={macroMetricVisibility}
                selectedDate={macroSelectedDate}
                onSelectDate={setMacroSelectedDate}
                onToggleMetric={(metric) => setMacroMetricVisibility((current) => {
                  const next = { ...current, [metric]: !current[metric] };
                  return Object.values(next).some(Boolean) ? next : current;
                })}
              />
            </>
          )}
        </View>

        {/* ── Tribe Preview — below checklist ── */}
        <View style={[styles.activityPreviewCard, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
          <Pressable
            style={styles.activityPreviewHeaderRow}
            onPress={() => { setTribeExpanded((v) => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null); }}
          >
            <Text style={[styles.activityPreviewEyebrow, { color: accent }]}>Latest from the Tribe 🔥</Text>
            <Text style={{ color: C.muted, fontSize: 16 }}>{tribeExpanded ? '▲' : '▼'}</Text>
          </Pressable>
          {tribeExpanded && (tribePosts.length ? (
            <>
              <Text style={styles.activityPreviewWho}>
                {`${tribePosts[0].author === (session?.user?.email?.split('@')[0] || '')
                  ? (profile?.displayName || session?.user?.email?.split('@')[0] || 'You')
                  : tribePosts[0].author} · ${formatRelativeTime(tribePosts[0].createdAt)}`}
              </Text>
              <Text style={styles.activityPreviewText} numberOfLines={2}>
                {tribePosts[0].body}
              </Text>
              <Text style={styles.activityPreviewMeta}>
                {tribePosts.length > 1 ? `${tribePosts.length} recent posts ready in Tribe` : 'Jump in and join the conversation'}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.btnGhost, pressed && styles.btnPressed]}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  navigation.navigate('Tribe');
                }}
              >
                <Text style={styles.btnGhostText}>Open Tribe Feed</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.activityPreviewText}>
                Share a win, ask a question, or check the feed when you want community support.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.btnGhost, pressed && styles.btnPressed]}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  navigation.navigate('Tribe');
                }}
              >
                <Text style={styles.btnGhostText}>Open Tribe Feed</Text>
              </Pressable>
            </>
          ))}
        </View>

        {showWearables ? (
          <View style={[styles.activityPreviewCard, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
            <Pressable
              style={styles.activityPreviewHeaderRow}
              onPress={() => { setWearablesExpanded((v) => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null); }}
            >
              <Text style={[styles.activityPreviewEyebrow, { color: accent }]}>Wearable Data — Today</Text>
              <Text style={{ color: C.muted, fontSize: 16 }}>{wearablesExpanded ? '▲' : '▼'}</Text>
            </Pressable>
            {wearablesExpanded && (
              <View style={styles.wearGrid}>
                <WearTile
                  icon="💤"
                  value={loading ? '…' : sleep ? `${sleep.totalHours}h` : '—'}
                  valueColor={C.blue}
                  label="Sleep"
                  hint={sleep ? 'Tap for breakdown' : undefined}
                  onPress={() => { if (sleep) setSleepModalVisible(true); }}
                />
                <WearTile
                  icon="❤️"
                  value="58"
                  valueColor={C.orange}
                  label="Resting HR"
                />
                <WearTile
                  icon="⚡"
                  value={loading ? '...' : `${Math.max(Math.round(activeEnergy || 0), Math.round((steps || 0) * 0.04))}`}
                  valueColor={accent}
                  label="Active Burn"
                />
                <WearTile
                  icon="👣"
                  value={
                    loading
                      ? '...'
                      : totalStepCount > 0
                        ? totalStepCount.toLocaleString()
                          : '0'
                  }
                  label="Steps"
                  hint="Tap to start a walk"
                  onPress={handleOpenWalkTracker}
                />
              </View>
            )}
          </View>
        ) : null}

      </ScrollView>

      {/* ── Emergency Coach Modal ── */}
      <Modal
        visible={emergencyVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEmergencyVisible(false)}
      >
        <View style={styles.emergencyOverlay}>
          <View style={styles.emergencySheet}>
            {/* Header */}
            <View style={styles.emergencyHeader}>
              <Text style={styles.emergencyTitle}>🚨 Emergency Coach</Text>
              <Pressable
                style={styles.emergencyClose}
                onPress={() => setEmergencyVisible(false)}
                hitSlop={12}
              >
                <Text style={styles.emergencyCloseText}>✕</Text>
              </Pressable>
            </View>

            {!emergencyState ? (
              <>
                <Text style={styles.emergencySubtitle}>What&apos;s going on right now?</Text>
                <Text style={styles.emergencyHint}>Tap what you&apos;re feeling and your AI Coach responds instantly.</Text>
                <View style={styles.emergencyChips}>
                  {[
                    'I want to quit',
                    "I've been slacking",
                    "I'm overwhelmed",
                    "I don't see results",
                    "I feel like I'm failing",
                    "I'm exhausted",
                  ].map((feeling) => (
                    <Pressable
                      key={feeling}
                      style={({ pressed }) => [styles.emergencyChip, pressed && { opacity: 0.7 }]}
                      onPress={() => handleEmergencySelect(feeling)}
                    >
                      <Text style={styles.emergencyChipText}>{feeling}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.emergencyReplyWrap}>
                <View style={styles.emergencyStateTag}>
                  <Text style={styles.emergencyStateTagText}>&quot;{emergencyState}&quot;</Text>
                </View>
                {emergencyLoading ? (
                  <View style={styles.emergencyLoadingWrap}>
                    <ActivityIndicator color="#00ff87" size="large" />
                    <Text style={styles.emergencyLoadingText}>Your coach is responding…</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.emergencyReplyText}>{emergencyReply}</Text>
                    <View style={styles.emergencyReplyActions}>
                      <Pressable
                        style={({ pressed }) => [styles.emergencyVoiceBtn, { backgroundColor: `${accent}12`, borderColor: `${accent}40` }, pressed && { opacity: 0.7 }]}
                        onPress={handleSpeakEmergencyReply}
                      >
                        <Text style={[styles.emergencyVoiceBtnText, { color: accent }]}>
                          {emergencyVoicePlaying ? '⏹ Stop' : '🔊 Hear this'}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.emergencyRetryBtn, pressed && styles.btnPressed]}
                        onPress={() => {
                          setEmergencyState(null);
                          setEmergencyReply(null);
                        }}
                      >
                        <Text style={styles.emergencyRetryText}>← Different feeling</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── 90-Day Analysis Action Plan Modal ── */}
      <Modal
        visible={macroInsightVisible}
        animationType="fade"
        transparent
        onRequestClose={closeMacroInsight}
      >
        <View style={[styles.firstActionOverlay, { justifyContent: 'flex-end' }]}>
          <Animated.View
            style={[styles.firstActionCard, { paddingBottom: 0, height: '88%', transform: [{ translateY: macroSheetTranslateY }] }]}
          >
            <View {...macroSheetPanResponder.panHandlers} style={styles.firstActionHandleWrap}>
              <View style={styles.firstActionHandle} />
            </View>

            {/* Header */}
            <View {...macroSheetPanResponder.panHandlers} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
              <View>
                <Text style={[styles.firstActionEyebrow, { color: accent, marginBottom: 2 }]}>TREND ANALYSIS</Text>
                <Text style={[styles.firstActionTitle, { marginBottom: 0, fontSize: 22 }]}>Your Action Plan</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {!macroInsightLoading && (
                  <Pressable
                    onPress={() => {
                      Alert.alert(
                        'Reanalyze Data?',
                        'Are you sure? This will re-read your logged trend data and rebuild your action plan. Your current suggestions will be replaced.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Reanalyze Data', style: 'destructive', onPress: () => handleAnalyzeMacroData().catch(() => null) },
                        ],
                      );
                    }}
                    style={({ pressed }) => [{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: `${accent}50`, backgroundColor: pressed ? `${accent}15` : `${accent}0d` }]}
                  >
                    <Text style={{ color: accent, fontFamily: 'DMSans_600SemiBold', fontSize: 12 }}>↺ Reanalyze Data</Text>
                  </Pressable>
                )}
                <Pressable onPress={closeMacroInsight} style={{ padding: 8 }}>
                  <Text style={[styles.firstActionSkipText, { fontSize: 13 }]}>Close</Text>
                </Pressable>
              </View>
            </View>

            {macroInsightLoading ? (
              <View style={[styles.emergencyLoadingWrap, { paddingBottom: 40 }]}>
                <ActivityIndicator color={accent} size="large" />
                <Text style={styles.emergencyLoadingText}>Coach is reading your logged trend…</Text>
                <Text style={[styles.emergencyLoadingText, { fontSize: 12, marginTop: 4, opacity: 0.6 }]}>Building your meal plan, movement guide & more</Text>
              </View>
            ) : (
              <>
                {/* Tab bar */}
                <View style={[styles.aiTabBar, { borderBottomColor: `${accent}30` }]}>
                  {([
                    { id: 'insight', label: '📊 Insight' },
                    { id: 'eat',     label: '🍽️ Eat' },
                    { id: 'move',    label: '💪 Move' },
                    { id: 'apply',   label: '✅ Apply' },
                  ] as const).map((tab) => (
                    <Pressable
                      key={tab.id}
                      style={[styles.aiTabBtn, macroInsightTab === tab.id && { borderBottomColor: accent, borderBottomWidth: 2 }]}
                      onPress={() => { setMacroInsightTab(tab.id); Haptics.selectionAsync().catch(() => null); }}
                    >
                      <Text style={[styles.aiTabBtnText, macroInsightTab === tab.id && { color: accent }]}>{tab.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

                  {/* ── INSIGHT TAB ── */}
                  {macroInsightTab === 'insight' && (
                    <View style={{ gap: 16 }}>
                      {/* Score card */}
                      {macroActionPlan && (
                        <View style={[styles.aiScoreCard, { borderColor: `${accent}50`, backgroundColor: `${accent}10` }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.aiScoreLabel, { color: accent }]}>TREND SCORE</Text>
                            <Text style={styles.aiScoreReason}>{macroActionPlan.scoreReason}</Text>
                          </View>
                          <Text style={[styles.aiScoreGrade, { color: accent }]}>{macroActionPlan.score}</Text>
                        </View>
                      )}

                      {/* Badges */}
                      {macroActionPlan?.badges && macroActionPlan.badges.length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {macroActionPlan.badges.map((badge) => (
                            <View key={badge} style={[styles.aiBadge, { backgroundColor: `${accent}18`, borderColor: `${accent}40` }]}>
                              <Text style={[styles.aiBadgeText, { color: accent }]}>🏅 {badge}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Insight text */}
                      <View style={styles.aiInsightBlock}>
                        <Text style={styles.aiInsightText}>{macroInsightText}</Text>
                      </View>

                      {/* Hear coach button */}
                      <Pressable
                        style={[styles.btnPrimary, { backgroundColor: accent }]}
                        onPress={() => handleSpeakMacroInsight().catch(() => null)}
                      >
                        <Text style={styles.btnPrimaryText}>{macroInsightSpeaking ? '🔊 Speaking…' : '🎙️ Hear from Coach'}</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* ── EAT TAB ── */}
                  {macroInsightTab === 'eat' && (
                    <View style={{ gap: 20 }}>
                      {(['todayMeals', 'tomorrowMeals'] as const).map((key) => {
                        const meals = macroActionPlan?.[key];
                        const label = key === 'todayMeals' ? 'TODAY' : 'TOMORROW';
                        if (!meals?.length) return (
                          <View key={key} style={[styles.aiEmptyCard, { borderColor: `${accent}30` }]}>
                            <Text style={styles.aiEmptyCardTitle}>No meal plan yet</Text>
                            <Text style={styles.aiEmptyCardBody}>Run an analysis to get personalized meal suggestions for today and tomorrow based on your 90-day data.</Text>
                            <Pressable
                              style={[styles.aiEmptyCardBtn, { backgroundColor: accent }]}
                              onPress={() => handleAnalyzeMacroData().catch(() => null)}
                            >
                              <Text style={styles.aiEmptyCardBtnText}>Run Analysis →</Text>
                            </Pressable>
                          </View>
                        );
                        return (
                          <View key={key} style={{ gap: 10 }}>
                            <Text style={[styles.aiSectionEyebrow, { color: accent }]}>{label}'S PLATE</Text>
                            {meals.map((meal) => (
                              <View key={meal.name} style={[styles.aiMealCard, { borderColor: `${accent}25` }]}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <Text style={styles.aiMealName}>{meal.name}</Text>
                                  <Text style={[styles.aiMealKcal, { color: accent }]}>{meal.calories} kcal</Text>
                                </View>
                                <Text style={styles.aiMealSuggestion}>{meal.suggestion}</Text>
                                <View style={styles.aiMealMacroRow}>
                                  <Text style={styles.aiMealMacro}>P {meal.protein}g</Text>
                                  <Text style={styles.aiMealMacro}>C {meal.carbs}g</Text>
                                  <Text style={styles.aiMealMacro}>F {meal.fat}g</Text>
                                </View>
                                {meal.tip ? (
                                  <View style={[styles.aiMealTip, { backgroundColor: `${accent}0d` }]}>
                                    <Text style={[styles.aiMealTipText, { color: accent }]}>💡 {meal.tip}</Text>
                                  </View>
                                ) : null}
                              </View>
                            ))}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* ── MOVE TAB ── */}
                  {macroInsightTab === 'move' && (
                    <View style={{ gap: 20 }}>
                      {(['todayMovement', 'tomorrowMovement'] as const).map((key) => {
                        const move = macroActionPlan?.[key];
                        const label = key === 'todayMovement' ? 'TODAY' : 'TOMORROW';
                        const typeColor: Record<string, string> = { rest: '#6b7280', light: '#3b82f6', moderate: '#f59e0b', intense: '#ef4444' };
                        if (!move) return (
                          <View key={key} style={[styles.aiEmptyCard, { borderColor: `${accent}30` }]}>
                            <Text style={styles.aiEmptyCardTitle}>No movement plan yet</Text>
                            <Text style={styles.aiEmptyCardBody}>Run an analysis to get a personalized movement and training plan tailored to your recent performance data.</Text>
                            <Pressable
                              style={[styles.aiEmptyCardBtn, { backgroundColor: accent }]}
                              onPress={() => handleAnalyzeMacroData().catch(() => null)}
                            >
                              <Text style={styles.aiEmptyCardBtnText}>Run Analysis →</Text>
                            </Pressable>
                          </View>
                        );
                        return (
                          <View key={key} style={{ gap: 10 }}>
                            <Text style={[styles.aiSectionEyebrow, { color: accent }]}>{label}'S MOVEMENT</Text>
                            <View style={[styles.aiMoveCard, { borderColor: `${accent}25` }]}>
                              {/* Intensity badge */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                <View style={[styles.aiMoveBadge, { backgroundColor: (typeColor[move.type] ?? accent) + '20', borderColor: typeColor[move.type] ?? accent }]}>
                                  <Text style={[styles.aiMoveBadgeText, { color: typeColor[move.type] ?? accent }]}>{move.type.toUpperCase()}</Text>
                                </View>
                                <View style={{ flex: 1, height: 6, backgroundColor: `${accent}20`, borderRadius: 3 }}>
                                  <View style={[{ height: 6, borderRadius: 3, backgroundColor: typeColor[move.type] ?? accent }, {
                                    width: move.type === 'rest' ? '10%' : move.type === 'light' ? '35%' : move.type === 'moderate' ? '65%' : '95%',
                                  }]} />
                                </View>
                              </View>
                              <Text style={styles.aiMoveDesc}>{move.description}</Text>
                              {/* Step goal */}
                              <View style={[styles.aiMoveStatRow, { borderColor: `${accent}20` }]}>
                                <Text style={styles.aiMoveStatIcon}>🚶</Text>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.aiMoveStatLabel}>Step Goal</Text>
                                  <Text style={[styles.aiMoveStatValue, { color: accent }]}>{move.stepGoal.toLocaleString()} steps</Text>
                                </View>
                              </View>
                              {move.workoutNote ? (
                                <View style={[styles.aiMealTip, { backgroundColor: `${accent}0d`, marginTop: 8 }]}>
                                  <Text style={[styles.aiMealTipText, { color: accent }]}>💪 {move.workoutNote}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* ── APPLY TAB ── */}
                  {macroInsightTab === 'apply' && (
                    <View style={{ gap: 14 }}>
                      {!macroActionPlan ? (
                        <View style={[styles.aiEmptyCard, { borderColor: `${accent}30` }]}>
                          <Text style={styles.aiEmptyCardTitle}>No action plan yet</Text>
                          <Text style={styles.aiEmptyCardBody}>Run an analysis first to unlock meal plan, grocery list, and smart reminder sync.</Text>
                          <Pressable
                            style={[styles.aiEmptyCardBtn, { backgroundColor: accent }]}
                            onPress={() => { setMacroInsightTab('insight'); handleAnalyzeMacroData().catch(() => null); }}
                          >
                            <Text style={styles.aiEmptyCardBtnText}>Run Analysis →</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text style={styles.aiApplyIntro}>Apply your AI Action Plan across the app with one tap. Changes sync instantly.</Text>
                      )}

                      {/* Meal Plan */}
                      <Pressable
                        style={[styles.aiApplyCard, { borderColor: `${accent}30`, opacity: !macroActionPlan ? 0.4 : 1 }]}
                        onPress={() => handleApplyMealPlan().catch(() => null)}
                        disabled={!macroActionPlan || macroApplyState.mealPlan === 'loading'}
                      >
                        <Text style={styles.aiApplyCardIcon}>🍽️</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.aiApplyCardTitle}>Apply to Meal Plan</Text>
                          <Text style={styles.aiApplyCardSub}>Saves today & tomorrow's AI meals to your Fuel diary suggestions</Text>
                        </View>
                        {macroApplyState.mealPlan === 'loading' ? <ActivityIndicator color={accent} size="small" /> :
                         macroApplyState.mealPlan === 'done' ? <Text style={[styles.aiApplyDone, { color: accent }]}>✓ Done</Text> :
                         <Text style={[styles.aiApplyArrow, { color: accent }]}>→</Text>}
                      </Pressable>

                      {/* Grocery List */}
                      <Pressable
                        style={[styles.aiApplyCard, { borderColor: `${accent}30`, opacity: !macroActionPlan ? 0.4 : 1 }]}
                        onPress={() => handleApplyGroceryList().catch(() => null)}
                        disabled={!macroActionPlan || macroApplyState.grocery === 'loading'}
                      >
                        <Text style={styles.aiApplyCardIcon}>🛒</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.aiApplyCardTitle}>Update Grocery List</Text>
                          <Text style={styles.aiApplyCardSub}>
                            {macroActionPlan?.groceryItems?.length
                              ? `Adds ${macroActionPlan.groceryItems.length} AI-picked items to your Fuel grocery list`
                              : 'Adds AI-recommended items to your grocery list'}
                          </Text>
                        </View>
                        {macroApplyState.grocery === 'loading' ? <ActivityIndicator color={accent} size="small" /> :
                         macroApplyState.grocery === 'done' ? <Text style={[styles.aiApplyDone, { color: accent }]}>✓ Done</Text> :
                         <Text style={[styles.aiApplyArrow, { color: accent }]}>→</Text>}
                      </Pressable>

                      {/* Smart Notifications */}
                      <Pressable
                        style={[styles.aiApplyCard, { borderColor: `${accent}30`, opacity: !macroActionPlan ? 0.4 : 1 }]}
                        onPress={() => handleApplyNotifications().catch(() => null)}
                        disabled={!macroActionPlan || macroApplyState.notifications === 'loading'}
                      >
                        <Text style={styles.aiApplyCardIcon}>🔔</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.aiApplyCardTitle}>Set Smart Reminders</Text>
                          <Text style={styles.aiApplyCardSub}>
                            {macroActionPlan?.notificationSuggestions?.length
                              ? `Schedules ${macroActionPlan.notificationSuggestions.length} coach-timed reminders for today`
                              : 'Schedules personalised meal & movement reminders'}
                          </Text>
                        </View>
                        {macroApplyState.notifications === 'loading' ? <ActivityIndicator color={accent} size="small" /> :
                         macroApplyState.notifications === 'done' ? <Text style={[styles.aiApplyDone, { color: accent }]}>✓ Done</Text> :
                         <Text style={[styles.aiApplyArrow, { color: accent }]}>→</Text>}
                      </Pressable>

                      {/* Navigate to Training */}
                      <Pressable
                        style={[styles.aiApplyCard, { borderColor: `${accent}30` }]}
                        onPress={() => handleApplyTrainingPlan().catch(() => null)}
                        disabled={!macroActionPlan || macroApplyState.training === 'loading'}
                      >
                        <Text style={styles.aiApplyCardIcon}>📋</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.aiApplyCardTitle}>Apply / Update Training Plan</Text>
                          <Text style={styles.aiApplyCardSub}>Updates today&apos;s training flow with the coach&apos;s movement recommendation instead of just opening Train</Text>
                        </View>
                        {macroApplyState.training === 'loading' ? <ActivityIndicator color={accent} size="small" /> :
                         macroApplyState.training === 'done' ? <Text style={[styles.aiApplyDone, { color: accent }]}>✓ Done</Text> :
                         <Text style={[styles.aiApplyArrow, { color: accent }]}>→</Text>}
                      </Pressable>

                      {/* Share progress */}
                      <Pressable
                        style={[styles.aiApplyCard, { borderColor: `${accent}30` }]}
                        onPress={() => {
                          const score = macroActionPlan?.score ?? '—';
                          addTextPostToFeed({ author: profile?.displayName || 'Athlete', badgeType: 'win', body: `Just got my 90-day analysis from APEX AI Coach — trend score: ${score} 📊 Adjusting my plan and locking in 💪 #APEX` })
                            .then(() => Alert.alert('Posted to Tribe! 🔥', 'Your progress is live in the feed.'))
                            .catch(() => null);
                        }}
                      >
                        <Text style={styles.aiApplyCardIcon}>🔥</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.aiApplyCardTitle}>Share to Tribe</Text>
                          <Text style={styles.aiApplyCardSub}>Post your trend score and commitment to the community feed</Text>
                        </View>
                        <Text style={[styles.aiApplyArrow, { color: accent }]}>→</Text>
                      </Pressable>

                      <Pressable
                        style={[styles.aiApplyCard, { borderColor: `${accent}30`, opacity: !macroActionPlan ? 0.4 : 1 }]}
                        onPress={() => { handleShareMacroActionPlan().catch(() => null); }}
                        disabled={!macroActionPlan}
                      >
                        <Text style={styles.aiApplyCardIcon}>📱</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.aiApplyCardTitle}>Share to Social</Text>
                          <Text style={styles.aiApplyCardSub}>Create a clean story-sized post for Instagram, TikTok, or Facebook without borders</Text>
                        </View>
                        <Text style={[styles.aiApplyArrow, { color: accent }]}>→</Text>
                      </Pressable>
                    </View>
                  )}

                </ScrollView>
              </>
            )}
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={sleepModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSleepModalVisible(false)}
      >
        <View style={styles.firstActionOverlay}>
          <View style={[styles.firstActionCard, { paddingBottom: 32 }]}>
            <View style={styles.firstActionHandle} />
            <Text style={[styles.heroTitle, { fontSize: 28, lineHeight: 30, marginBottom: 4 }]}>LAST NIGHT</Text>
            <Text style={[styles.heroSub, { marginBottom: 20 }]}>Sleep breakdown from Apple Health</Text>
            {sleep ? (
              <View style={{ gap: 12 }}>
                {[
                  { label: 'Total Sleep', value: `${sleep.totalHours}h`, color: C.blue, icon: '💤' },
                  { label: 'REM Sleep', value: `${sleep.remMinutes}m`, color: C.purple, icon: '🌙' },
                  { label: 'Deep Sleep', value: `${sleep.deepMinutes}m`, color: accent, icon: '🌊' },
                  { label: 'Light Sleep', value: `${sleep.lightMinutes}m`, color: C.orange, icon: '☁️' },
                ].map((row) => (
                  <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ fontSize: 20 }}>{row.icon}</Text>
                      <Text style={{ color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 14 }}>{row.label}</Text>
                    </View>
                    <Text style={{ color: row.color, fontFamily: 'BebasNeue_400Regular', fontSize: 24 }}>{row.value}</Text>
                  </View>
                ))}
                <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                  REM + Deep sleep drive muscle recovery and memory consolidation.
                </Text>
              </View>
            ) : null}
            <Pressable style={[styles.btnPrimary, { marginTop: 16 }]} onPress={() => setSleepModalVisible(false)}>
              <Text style={styles.btnPrimaryText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Weight Log Modal ── */}
      <Modal
        visible={weightInsightsVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setWeightInsightsVisible(false)}
      >
        <View style={styles.firstActionOverlay}>
          <View style={[styles.firstActionCard, { paddingBottom: 28 }]}>
            <View style={styles.firstActionHandle} />
            <Pressable
              style={styles.firstActionSkip}
              onPress={() => setWeightInsightsVisible(false)}
            >
              <Text style={styles.firstActionSkipText}>Close</Text>
            </Pressable>

            <Text style={[styles.firstActionEyebrow, { color: accent }]}>BODY WEIGHT</Text>
            <Text style={styles.firstActionTitle}>
              {latestWeightLbs != null ? `${latestWeightLbs} lbs today` : 'Track your trend'}
            </Text>

            <View style={styles.weightInsightsRow}>
              <View style={styles.weightInsightsStat}>
                <Text style={styles.weightInsightsValue}>
                  {weeklyWeightAvg != null ? weeklyWeightAvg.toFixed(1) : '—'}
                </Text>
                <Text style={styles.weightInsightsLabel}>7-day avg</Text>
              </View>
              <View style={styles.weightInsightsStat}>
                <Text style={styles.weightInsightsValue}>
                  {weightHistory.length >= 2
                    ? `${(weightHistory[weightHistory.length - 1]!.weightLbs - weightHistory[0]!.weightLbs).toFixed(1)}`
                    : '—'}
                </Text>
                <Text style={styles.weightInsightsLabel}>change</Text>
              </View>
            </View>

            <WeightTrendMini entries={weightHistory} accentColor={accent} />

            <View style={styles.weightHistoryList}>
              {weightHistory.length ? (
                [...weightHistory].reverse().slice(0, 4).map((entry) => (
                  <View key={entry.id} style={styles.weightHistoryRow}>
                    <View>
                      <Text style={styles.weightHistoryDate}>
                        {new Date(entry.loggedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                      <Text style={styles.weightHistoryMeta}>{weighSessionLabel(entry.session)}</Text>
                    </View>
                    <Text style={[styles.weightHistoryValue, { color: accent }]}>{entry.weightLbs} lbs</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.weightTrendEmptyText}>No weigh-ins yet. Log your first one to start building the trend.</Text>
              )}
            </View>

            <Pressable
              style={styles.btnPrimary}
              onPress={() => {
                setWeightInsightsVisible(false);
                setWeightModalSession('manual');
                setWeightModalVisible(true);
              }}
            >
              <Text style={styles.btnPrimaryText}>Log Weight</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <WeightLogModal
        visible={weightModalVisible}
        session={weightModalSession}
        onClose={() => setWeightModalVisible(false)}
        onLogged={(entry) => {
          setWeightModalVisible(false);
          refreshWeightData().catch(() => null);
          setWeightInsightsVisible(true);
        }}
      />

      <Modal
        visible={shortcutPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setShortcutPickerVisible(false)}
      >
        <View style={styles.firstActionOverlay}>
          <View style={styles.shortcutPickerCard}>
            <View style={styles.firstActionHandle} />
            <Pressable style={styles.firstActionSkip} onPress={() => setShortcutPickerVisible(false)}>
              <Text style={styles.firstActionSkipText}>Done</Text>
            </Pressable>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
              style={{ flex: 1, marginTop: 4 }}
            >
              <Text style={[styles.firstActionEyebrow, { color: accent }]}>DASHBOARD SHORTCUTS</Text>
              <Text style={styles.firstActionTitle}>Pick your 4 quick chips</Text>
              <Text style={styles.heroSub}>Tap to add or remove shortcuts. The first four selected stay on Home.</Text>
              {(Object.keys(dashboardShortcutMeta) as DashboardShortcutId[]).map((shortcutId) => {
                const item = dashboardShortcutMeta[shortcutId];
                const selected = dashboardShortcuts.includes(shortcutId);
                return (
                  <Pressable
                    key={shortcutId}
                    style={[styles.shortcutOptionRow, selected ? { borderColor: accent, backgroundColor: accentSoft } : null]}
                    onPress={() => toggleDashboardShortcut(shortcutId).catch(() => null)}
                  >
                    <Text style={styles.shortcutOptionEmoji}>{item.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.shortcutOptionLabel, selected ? { color: accent } : null]}>{item.label}</Text>
                      <Text style={styles.shortcutOptionSub}>{item.sub}</Text>
                    </View>
                    <Text style={[styles.shortcutOptionCheck, selected ? { color: accent } : null]}>{selected ? '✓' : '+'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Checklist completion confetti ── */}
      <ConfettiCelebration
        visible={checklistCelebration}
        emoji="🔥"
        title="CHECKLIST DONE!"
        subtitle="Workout logged, meals tracked, weight recorded. You showed up completely today."
        ctaLabel="Keep the momentum →"
        onDismiss={() => setChecklistCelebration(false)}
      />
      <ConfettiCelebration
        visible={movementGoalCelebration}
        emoji="🚶"
        title="MOVEMENT GOAL HIT!"
        subtitle="You knocked out your step target for today. Keep that momentum rolling."
        ctaLabel="Stay in motion →"
        onDismiss={() => setMovementGoalCelebration(false)}
      />
      <ConfettiCelebration
        visible={foodGoalCelebration}
        emoji="🍽️"
        title="FOOD GOAL LOCKED!"
        subtitle="You hit your food target today. Protein, calories, and consistency are lining up."
        ctaLabel="Keep eating with purpose →"
        onDismiss={() => setFoodGoalCelebration(false)}
      />


      {/* ── Meal Scan Shortcut Modal ── */}
      <FoodScanModal
        visible={mealScanVisible}
        onClose={() => setMealScanVisible(false)}
        scanContext={{
          caloriesRemaining: Math.max(macros.dailyCalorieTarget - totals.caloriesConsumed, 0),
          carbsRemaining: Math.max(macros.dailyCarbs - totals.carbs, 0),
          fatRemaining: Math.max(macros.dailyFat - totals.fat, 0),
          goal: profile?.goal,
          proteinRemaining: Math.max(macros.dailyProtein - totals.protein, 0),
        }}
        onResult={async (food: ScannedFood) => {
          setMealScanVisible(false);
          const userId = session?.user?.id;
          if (!userId) { navigation.navigate('Fuel'); return; }

          // Save directly to diary
          const { error } = await supabase.from('nutrition_entries').insert({
            calories: food.calories,
            carbs_grams: food.carbs,
            fat_grams: food.fat,
            meal_name: food.name,
            protein_grams: food.protein,
            user_id: userId,
            consumed_at: new Date().toISOString(),
          });

          if (error) { navigation.navigate('Fuel'); return; }

          await addXp(5).catch(() => null);

          const authorName = profile?.displayName || session?.user?.email?.split('@')[0] || 'Someone';

          Alert.alert(
            `✅ ${food.name} Logged!`,
            `${food.calories} kcal · P${food.protein}g C${food.carbs}g F${food.fat}g  ·  +5 XP`,
            [
              {
                text: '🔥 Share to Tribe',
                onPress: () => {
                  addTextPostToFeed({
                    author: authorName,
                    badgeType: 'win',
                    body: `Just logged ${food.name} — ${food.calories} kcal, ${food.protein}g protein 💪 Fuelling the work.`,
                  })
                    .then(() => Alert.alert('Posted to Tribe! 🔥', 'Your meal win is live in the feed.'))
                    .catch(() => null);
                },
              },
              {
                text: '📲 Share on Social',
                onPress: async () => {
                  handleShareMealCard(food).catch(() => null);
                },
              },
              { text: 'Done', style: 'cancel' },
            ],
          );
        }}
      />

      {/* ── Water Quick-Log Modal ── */}
      <Modal
        visible={waterModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setWaterModalVisible(false)}
      >
        <Pressable style={styles.waterOverlay} onPress={() => setWaterModalVisible(false)}>
          <Pressable style={styles.waterCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.waterHandle} />
            <Text style={styles.waterTitle}>💧 Track Water</Text>
            {/* Progress bar */}
            <View style={styles.waterProgressBg}>
              <View style={[styles.waterProgressFill, { width: `${Math.min((waterOz / WATER_GOAL_OZ) * 100, 100)}%` as any }]} />
            </View>
            <Text style={styles.waterProgressLabel}>
              {Math.round(waterOz / 8)} of {Math.round(WATER_GOAL_OZ / 8)} glasses  ·  {waterOz} oz / {WATER_GOAL_OZ} oz goal
            </Text>
            {/* Quick add buttons */}
            <View style={styles.waterBtnRow}>
              {[
                { label: '+1 glass', oz: 8, emoji: '🥛' },
                { label: '+2 glasses', oz: 16, emoji: '💧' },
                { label: '+4 glasses', oz: 32, emoji: '🫗' },
              ].map((item) => (
                <Pressable
                  key={item.oz}
                  style={({ pressed }) => [styles.waterAddBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => addWaterOz(item.oz)}
                >
                  <Text style={styles.waterAddEmoji}>{item.emoji}</Text>
                  <Text style={styles.waterAddLabel}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={styles.waterDoneBtn}
              onPress={() => setWaterModalVisible(false)}
            >
              <Text style={styles.waterDoneBtnText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Hidden meal share card — captured by ViewShot, shared as image so
          Instagram / TikTok / Facebook appear in the iOS share sheet */}
      <View style={{ position: 'absolute', left: -9999, top: 0 }} pointerEvents="none">
        <ViewShot
          ref={macroShareRef}
          options={{ format: 'png', quality: 1, width: ACTION_PLAN_SHARE_W, height: ACTION_PLAN_SHARE_H }}
        >
          {macroActionPlan && macroShareVisible ? (
            <MacroActionPlanShareCard
              accent={accent}
              badges={macroActionPlan.badges}
              displayName={profile?.displayName || 'Athlete'}
              goalLabel={profile?.goal ?? 'progress'}
              insight={macroActionPlan.insight}
              movementGoal={macroActionPlan.todayMovement}
              score={macroActionPlan.score}
              todayMeals={macroActionPlan.todayMeals}
            />
          ) : (
            <View style={{ width: ACTION_PLAN_SHARE_W, height: ACTION_PLAN_SHARE_H }} />
          )}
        </ViewShot>
      </View>
      <View style={{ position: 'absolute', left: -9999, top: 0 }} pointerEvents="none">
        <ViewShot
          ref={mealShareRef}
          options={{ format: 'png', quality: 1, width: MEAL_CARD_W, height: MEAL_CARD_H }}
        >
          {mealShareData ? (
            <MealShareCard {...mealShareData} />
          ) : (
            <View style={{ width: MEAL_CARD_W, height: MEAL_CARD_H }} />
          )}
        </ViewShot>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  scroll: { flex: 1, backgroundColor: C.black },
  content: { padding: 14, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 10,
  },
  heroCard: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },
  heroEyebrow: {
    fontSize: 12,
    color: C.green,
    marginBottom: 4,
    fontFamily: 'DMSans_500Medium',
    letterSpacing: 0.3,
  },
  heroTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 36,
    letterSpacing: 2,
    lineHeight: 38,
    color: C.text,
    marginBottom: 6,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 0,
  },
  heroMiniStats: {
    gap: 6,
    alignItems: 'flex-end',
    paddingTop: 4,
    flexShrink: 0,
  },
  heroMiniStat: {
    alignItems: 'flex-end',
  },
  heroMiniStatVal: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 16,
    letterSpacing: 0.5,
    lineHeight: 18,
    color: C.text,
  },
  heroMiniStatLabel: {
    fontSize: 8,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    lineHeight: 10,
  },
  heroMiniStatSub: {
    marginTop: 2,
    fontSize: 8,
    color: 'rgba(255,255,255,0.68)',
    fontFamily: 'DMSans_500Medium',
    textAlign: 'right',
    lineHeight: 10,
  },
  heroSub: {
    fontSize: 12,
    color: C.muted,
    marginBottom: 14,
    marginTop: 4,
    fontFamily: 'DMSans_400Regular',
  },
  btnPrimary: {
    backgroundColor: C.green,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  heroCardComplete: {
    borderColor: C.greenStrongBorder,
    backgroundColor: 'rgba(0,255,136,0.07)',
  },
  btnComplete: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: C.greenStrongBorder,
  },
  btnCompleteText: { color: C.green },
  btnGhost: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginTop: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnGhostText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 12 },
  btnPressed: { opacity: 0.82 },
  aiBar: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  aiBarIcon: {
    fontSize: 16,
    marginTop: 1,
    flexShrink: 0,
  },
  aiBarText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 20,
    color: '#bbb',
    fontFamily: 'DMSans_400Regular',
  },
  aiBarStrong: { color: C.green, fontFamily: 'DMSans_500Medium' },

  // ── Hero card embedded AI card ──
  heroAiCard: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: 12,
    marginTop: 14,
    marginBottom: 4,
    gap: 6,
  },
  heroAiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // kept for legacy references
  heroAiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.2)',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    marginBottom: 2,
  },
  heroAiIcon: { fontSize: 13, flexShrink: 0 },
  heroAiAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  heroAiText: {
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'DMSans_400Regular',
  },
  heroAiStrong: {
    flex: 1,
    color: C.green,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  heroVoiceBtn: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(52,211,153,0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  heroVoiceBtnText: {
    fontSize: 11,
    color: C.green,
    fontFamily: 'DMSans_500Medium',
  },

  // Quick-action chips
  restChipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    marginBottom: 10,
  },
  restChip: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 5,
  },
  restChipEmoji: { fontSize: 22 },
  restChipAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'transparent',
  },
  restChipText: {
    fontSize: 10,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    letterSpacing: 0.3,
  },
  restChipSub: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.78)',
    fontFamily: 'DMSans_400Regular',
    marginTop: -2,
  },
  restChipBadge: {
    fontSize: 9,
    color: C.green,
    fontFamily: 'DMSans_600SemiBold',
    marginTop: -2,
  },
  shortcutHelperText: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    marginBottom: 12,
    marginTop: -2,
  },
  shortcutOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
  },
  shortcutOptionEmoji: { fontSize: 20 },
  shortcutOptionLabel: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
  },
  shortcutOptionSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  shortcutOptionCheck: {
    color: C.muted,
    fontFamily: 'DMSans_700Bold',
    fontSize: 20,
  },

  // ── Water quick-log modal ──
  waterOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  waterCard: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
  waterHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 4,
  },
  waterTitle: {
    fontSize: 20,
    fontFamily: 'BebasNeue_400Regular',
    letterSpacing: 1.5,
    color: C.text,
    textAlign: 'center',
  },
  waterProgressBg: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  waterProgressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 4,
  },
  waterProgressLabel: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    textAlign: 'center',
  },
  waterBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  waterAddBtn: {
    flex: 1,
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  waterAddEmoji: { fontSize: 24 },
  waterAddLabel: {
    fontSize: 11,
    color: '#93c5fd',
    fontFamily: 'DMSans_500Medium',
    textAlign: 'center',
  },
  waterDoneBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  waterDoneBtnText: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: '#fff',
  },

  // kept for compatibility
  btnRestDay: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  btnRestDayText: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },

  // Divider above Emergency Coach
  emergencyDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginTop: 12,
    marginHorizontal: 4,
  },

  // Inline Emergency Coach link
  emergencyInlineBtn: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  emergencyInlineText: {
    fontSize: 12,
    color: 'rgba(239,68,68,0.8)',
    fontFamily: 'DMSans_500Medium',
    textAlign: 'center',
  },
  lockedAiBar: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(255,107,53,0.1)',
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  lockedAiBarIcon: { fontSize: 16, marginTop: 1, flexShrink: 0 },
  lockedAiBarTitle: {
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  lockedAiBarBody: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12.5,
    lineHeight: 20,
  },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  statCard: {
    width: '47%',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
  },
  statLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 4,
  },
  statVal: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: 1,
    color: C.text,
  },
  statSub: { fontSize: 11, color: C.muted, marginTop: 3, fontFamily: 'DMSans_400Regular' },
  levelWrap: { marginTop: 8 },
  levelInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  levelInfoText: { fontSize: 10, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  levelTrack: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  levelFill: { height: '100%', borderRadius: 3, backgroundColor: C.green, opacity: 0.9 },
  wearGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  wearTile: {
    width: '47%',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  wearIcon: { fontSize: 22, marginBottom: 4 },
  wearVal: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 26,
    lineHeight: 28,
    letterSpacing: 1,
    color: C.text,
  },
  wearLbl: {
    fontSize: 9,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  wearHint: {
    fontSize: 8,
    color: C.green,
    fontFamily: 'DMSans_400Regular',
    marginTop: 3,
    textAlign: 'center',
    opacity: 0.8,
  },
  helperText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  ringRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 4,
    marginBottom: 12,
  },
  ringWrap: { alignItems: 'center', gap: 5 },
  ringVal: { fontFamily: 'BebasNeue_400Regular', fontSize: 15, letterSpacing: 0.5, color: C.text },
  ringName: {
    fontSize: 9,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
  },
  activityItem: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 11,
    marginBottom: 8,
  },
  activityWho: {
    fontSize: 11,
    color: C.muted,
    marginBottom: 3,
    fontFamily: 'DMSans_400Regular',
  },
  activityText: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  activityPreviewCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 6,
  },
  activityPreviewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activityAnalyzeBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  activityAnalyzeBtnText: {
    fontSize: 11,
    fontFamily: 'DMSans_700Bold',
  },
  macroShareCard: {
    width: ACTION_PLAN_SHARE_W,
    height: ACTION_PLAN_SHARE_H,
    backgroundColor: '#080808',
    paddingHorizontal: 28,
    paddingTop: 54,
    paddingBottom: 50,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  macroShareGlow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.08,
    top: 140,
    alignSelf: 'center',
  },
  macroShareTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  macroShareBrand: {
    color: '#fff',
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 42,
    letterSpacing: 6,
  },
  macroSharePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  macroSharePillText: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 1.2,
  },
  macroShareSubtitle: {
    color: 'rgba(255,255,255,0.50)',
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    marginTop: 2,
  },
  macroShareScoreHero: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  macroShareScoreBig: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 96,
    lineHeight: 96,
  },
  macroShareScoreLabel: {
    color: 'rgba(255,255,255,0.38)',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 2,
    marginTop: 4,
  },
  macroShareInsightCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
  },
  macroShareInsightText: {
    color: 'rgba(255,255,255,0.90)',
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    lineHeight: 21,
  },
  macroShareSplitRow: {
    flexDirection: 'row',
    gap: 10,
  },
  macroShareMiniCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    padding: 13,
    borderWidth: 1,
    gap: 5,
  },
  macroShareMiniEyebrow: {
    color: 'rgba(255,255,255,0.38)',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 1.1,
  },
  macroShareMiniValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    lineHeight: 22,
  },
  macroShareMiniText: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  macroShareBadgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  macroShareBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  macroShareBadgeText: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 11,
  },
  macroShareBottom: {
    alignItems: 'center',
  },
  macroShareHandle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    letterSpacing: 2,
  },
  macroWeightChartWrap: {
    marginTop: 12,
    alignItems: 'center',
  },
  macroWeightSummaryRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  macroWeightSummaryCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  macroWeightSummaryLabel: {
    color: C.muted,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontFamily: 'SpaceMono_400Regular',
  },
  macroWeightSummaryValue: {
    color: C.text,
    fontSize: 15,
    fontFamily: 'DMSans_700Bold',
  },
  macroWeightToggleRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  macroWeightTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  macroWeightToggleText: {
    color: C.muted,
    fontSize: 11,
    fontFamily: 'DMSans_500Medium',
  },
  macroWeightChartStage: {
    position: 'relative',
  },
  macroWeightHitGrid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  macroWeightHitTarget: {
    flex: 1,
  },
  macroWeightLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  macroWeightLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  macroWeightLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  macroWeightLegendText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
  },
  macroWeightDetailCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    gap: 8,
  },
  macroWeightDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  macroWeightDetailDate: {
    color: C.text,
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
  },
  macroWeightDetailMeta: {
    color: C.muted,
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
  },
  macroWeightDetailStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  macroWeightDetailStat: {
    color: C.text,
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
  },
  macroWeightCompletenessText: {
    width: '100%',
    color: C.muted,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'DMSans_400Regular',
    marginTop: 8,
    textAlign: 'left',
  },
  activityPreviewEyebrow: {
    fontSize: 10,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  activityPreviewWho: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },
  activityPreviewText: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    lineHeight: 20,
  },
  activityPreviewMeta: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginBottom: 4,
  },
  analysisActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    alignItems: 'center',
  },

  // ── AI Action Plan Modal styles ───────────────────────────────────────────
  aiTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginHorizontal: 20,
    marginBottom: 0,
  },
  aiTabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  aiTabBtnText: {
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
    fontSize: 11.5,
    letterSpacing: 0.2,
  },
  aiScoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  aiScoreLabel: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  aiScoreGrade: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 52,
    lineHeight: 52,
  },
  aiScoreReason: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  aiBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  aiBadgeText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  aiInsightBlock: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },
  aiInsightText: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 22,
  },
  aiSectionEyebrow: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 1.4,
  },
  aiMealCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  aiMealName: {
    color: C.text,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
  },
  aiMealKcal: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
  },
  aiMealSuggestion: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  aiMealMacroRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  aiMealMacro: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
  },
  aiMealTip: {
    borderRadius: 8,
    padding: 8,
    marginTop: 2,
  },
  aiMealTipText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 16,
  },
  aiMoveCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  aiMoveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  aiMoveBadgeText: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  aiMoveDesc: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
  },
  aiMoveStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  aiMoveStatIcon: { fontSize: 20 },
  aiMoveStatLabel: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 11 },
  aiMoveStatValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 24 },
  aiApplyIntro: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  aiApplyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  aiApplyCardIcon: { fontSize: 26 },
  aiApplyCardTitle: {
    color: C.text,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    marginBottom: 2,
  },
  aiApplyCardSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 16,
  },
  aiApplyArrow: { fontFamily: 'DMSans_600SemiBold', fontSize: 18 },
  aiApplyDone: { fontFamily: 'DMSans_700Bold', fontSize: 14 },
  aiEmptyText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  aiEmptyCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  aiEmptyCardTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 15,
    textAlign: 'center',
  },
  aiEmptyCardBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  aiEmptyCardBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 22,
  },
  aiEmptyCardBtnText: {
    color: '#fff',
    fontFamily: 'DMSans_700Bold',
    fontSize: 13,
  },

  // Pro quick-action row
  emergencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    minHeight: 44,
  },
  emergencyBtnFull: {
    alignSelf: 'stretch',
    marginBottom: 20,
  },
  proLockedAction: {
    opacity: 0.95,
  },
  emergencyBtnIcon: { fontSize: 14 },
  emergencyBtnText: {
    color: '#ef4444',
    fontFamily: 'DMSans_500Medium',
    fontSize: 12.5,
  },
  // Emergency Coach modal
  emergencyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  emergencySheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    padding: 22,
    paddingBottom: 40,
  },
  emergencyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  emergencyTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 26,
    letterSpacing: 1.5,
    color: '#ef4444',
  },
  emergencyClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyCloseText: {
    color: C.muted,
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
  },
  emergencySubtitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: C.text,
    marginBottom: 4,
  },
  emergencyHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: C.muted,
    marginBottom: 16,
    lineHeight: 18,
  },
  emergencyChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emergencyChip: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    borderRadius: 22,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  emergencyChipText: {
    color: '#ef4444',
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  emergencyReplyWrap: {
    gap: 14,
  },
  emergencyStateTag: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  emergencyStateTagText: {
    color: '#ef4444',
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    fontStyle: 'italic',
  },
  emergencyLoadingWrap: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 12,
  },
  emergencyLoadingText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  emergencyReplyText: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14.5,
    lineHeight: 23,
  },
  emergencyReplyActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    alignItems: 'center',
  },
  emergencyVoiceBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderWidth: 1,
    borderColor: C.greenBorder,
  },
  emergencyVoiceBtnText: {
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  emergencyRetryBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: C.border,
  },
  emergencyRetryText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  firstActionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  firstActionCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(0,255,136,0.25)',
    padding: 20,
    paddingBottom: 36,
    gap: 4,
  },
  shortcutPickerCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(0,255,136,0.25)',
    padding: 20,
    paddingBottom: 24,
    gap: 4,
    minHeight: '92%',
    maxHeight: '96%',
  },
  firstActionHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  firstActionHandleWrap: {
    paddingTop: 2,
  },
  firstActionSkip: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  firstActionSkipText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.74)',
    fontFamily: 'DMSans_400Regular',
  },
  firstActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
  },
  firstActionItemIcon: { fontSize: 22 },
  firstActionItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  firstActionItemLabel: {
    fontSize: 15,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    flex: 1,
  },
  firstActionXpPill: {
    backgroundColor: 'rgba(0,255,135,0.12)',
    borderColor: 'rgba(0,255,135,0.32)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  firstActionXpText: {
    color: C.green,
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
  },
  firstActionItemSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
  },
  firstActionEyebrow: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  firstActionTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 30,
    letterSpacing: 1.2,
    lineHeight: 34,
    marginBottom: 8,
  },
  weightInsightsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  weightInsightsStat: {
    flex: 1,
    backgroundColor: C.dark,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  weightInsightsValue: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    lineHeight: 28,
  },
  weightInsightsLabel: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.8,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  weightTrendWrap: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  weightTrendLabels: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    marginTop: 4,
  },
  weightTrendLabel: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
  },
  weightTrendEmpty: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  weightTrendEmptyText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  weightHistoryList: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 14,
  },
  weightHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  weightHistoryDate: {
    color: C.text,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 13,
  },
  weightHistoryMeta: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  weightHistoryValue: {
    color: C.green,
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
  },

  // ── Daily Checklist ──────────────────────────────────────────────────────
  checklistCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 6,
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  checklistTitle: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 1,
  },
  checklistCount: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_700Bold',
  },
  checklistBar: {
    height: 3,
    backgroundColor: C.border,
    borderRadius: 2,
    marginBottom: 12,
    overflow: 'hidden',
  },
  checklistBarFill: {
    height: '100%',
    backgroundColor: C.green,
    borderRadius: 2,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  checklistRowNext: {
    backgroundColor: 'rgba(0,255,136,0.04)',
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  checklistBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checklistBoxDone: {
    backgroundColor: C.green,
    borderColor: C.green,
  },
  checklistTick: {
    fontSize: 12,
    color: '#000',
    fontFamily: 'DMSans_700Bold',
  },
  checklistItemLabel: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
  },
  checklistItemLabelDone: {
    color: C.muted,
    textDecorationLine: 'line-through',
  },
  checklistItemHint: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginTop: 1,
  },
  checklistChevron: {
    fontSize: 20,
    color: C.muted,
  },
  checklistChevronIcon: {
    fontSize: 16,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
  },
  checklistAllDoneRow: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  checklistAllDoneText: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
  },
});
