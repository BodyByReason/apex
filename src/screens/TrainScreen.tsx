import React, { useMemo, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Animated, Image, type ImageSourcePropType, Linking, Alert, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, Vibration, Easing } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import ActiveWorkoutPanel from '@/components/ActiveWorkoutPanel';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import { useAuth } from '@/contexts/AuthContext';
import { useGamification } from '@/contexts/GamificationContext';
import { maybeRequestReview } from '@/hooks/useAppRating';
import { usePro } from '@/hooks/usePro';
import { useWorkoutRealtimeAudio } from '@/hooks/useWorkoutRealtimeAudio';
import { useWorkoutStats } from '@/hooks/useWorkoutStats';
import { useVoiceCoach } from '@/hooks/useVoiceCoach';
import { type RealtimeWorkoutToolCall, type RealtimeWorkoutToolResult } from '@/lib/openaiRealtimeWorkout';
import { getYoutubeIdForExercise, getPlanById, getSuggestedPlanId, type WorkoutProgramDay, type WorkoutProgramExercise } from '@/lib/plans';
import { type AIProgram, type AIWorkout, clearAIWorkout, getAIProgram, getAIWorkout, saveAIWorkout } from '@/lib/aiWorkout';
import type { MainStackParamList } from '@/navigation/MainNavigator';
import { maybeShowPaywall } from '@/lib/revenuecat';
import { env } from '@/lib/env';
import { getCoachVoiceOptionById, getSelectedCoachVoice, getSelectedCoachVoiceId, type CoachVoiceOption } from '@/lib/coachVoice';
import { transcribeWithElevenLabs } from '@/lib/elevenlabs';
import { scheduleAICoachReminder } from '@/lib/notifications';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { supabase } from '@/lib/supabase';
import { getApprovedDemoAsset } from '@/lib/demoAssets';
import { apexColors as C } from '@/theme/colors';
import { useTheme } from '@/contexts/ThemeContext';

type DayStatus = 'done' | 'today' | 'upcoming' | 'rest';
type Tab = 'week' | 'today' | 'history' | 'library';

function todayProgramIndex(): number {
  const jsDay = new Date().getDay(); // 0=Sun, 1=Mon ... 6=Sat
  return jsDay === 0 ? 6 : jsDay - 1;
}

function getStartOfWeek(date = new Date()) {
  const start = new Date(date);
  const jsDay = start.getDay();
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  start.setDate(start.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getWeekDateForIndex(index: number, baseDate = new Date()) {
  const day = getStartOfWeek(baseDate);
  day.setDate(day.getDate() + index);
  return day.toISOString().slice(0, 10);
}

function getWorkoutProgressStorageKey(userId: string, workoutDate: string, workoutName: string) {
  return `apex.train.progress.${userId}.${workoutDate}.${workoutName}`;
}

function getWorkoutCompletionStorageKey(userId: string, workoutDate: string, workoutName: string) {
  return `apex.train.complete.${userId}.${workoutDate}.${workoutName}`;
}

function getWorkoutDemoCacheKey(coachLabel: string, exerciseName: string) {
  return `apex.train.demo.${coachLabel.toLowerCase()}.${exerciseName.toLowerCase().replace(/\s+/g, '-')}`;
}

function normalizeExerciseLookup(name: string) {
  return name.trim().toLowerCase();
}


function buildWeek(
  schedule: WorkoutProgramDay[],
  completedDates: Set<string>,
): Array<WorkoutProgramDay & { status: DayStatus }> {
  const todayIdx = todayProgramIndex();
  return schedule.map((day, i) => {
    let status: DayStatus;
    const dayDate = getWeekDateForIndex(i);
    const isCompleted = completedDates.has(dayDate);
    if (i < todayIdx) status = isCompleted ? 'done' : day.badge === 'rest' ? 'rest' : 'upcoming';
    else if (i === todayIdx) status = 'today';
    else status = 'upcoming';
    if (day.badge === 'rest') {
      status = i === todayIdx ? 'today' : isCompleted ? 'done' : 'rest';
    }
    return { ...day, status };
  });
}

const WORKOUT_REVIEW_MILESTONES = [5, 10, 25, 50];
const STREAK_REVIEW_MILESTONES = [7, 14, 30];
const WORKOUT_COACH_SPEECH_THRESHOLD_DB = -38;
const WORKOUT_COACH_SPEECH_SUSTAINED_MS = 500;
const WORKOUT_COACH_SILENCE_AFTER_SPEECH_MS = 1400;
const WORKOUT_COACH_IDLE_TIMEOUT_MS = 30000;
const WORKOUT_COACH_MIN_TRANSCRIBE_MS = 1800;
const WORKOUT_COACH_MAX_UTTERANCE_MS = 9000;
const WARMUP_STEPS = [
  { icon: '🚶', label: 'Walk for 5 minutes', detail: 'Optional foam rolling & stretching' },
] as const;

const COACH_VISUALS: Record<string, { image: ImageSourcePropType; role: string }> = {
  'Coach Josh': {
    image: require('../../assets/josh-coach.png'),
    role: 'Head coach',
  },
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function AIBar({
  text,
  accentSoft,
  accentBorder,
  coachAvatar,
  coachLabel,
}: {
  text: string;
  accentSoft?: string;
  accentBorder?: string;
  coachAvatar?: ImageSourcePropType;
  coachLabel?: string;
}) {
  return (
    <View style={[styles.aiBar, accentSoft ? { backgroundColor: accentSoft, borderColor: accentBorder } : null]}>
      {coachAvatar ? <Image source={coachAvatar} style={styles.aiBarAvatar} /> : <Text style={styles.aiBarIcon}>🤖</Text>}
      <Text style={styles.aiBarText}>{text}</Text>
    </View>
  );
}

// ─── Fat-burn heart rate helpers ─────────────────────────────────────────────
function calcFatBurnZone(age: number): { low: number; high: number; max: number } {
  const maxHR = Math.round(220 - age);
  return { low: Math.round(maxHR * 0.6), high: Math.round(maxHR * 0.7), max: maxHR };
}

function getCardioOptions(planId: string) {
  return [
    { icon: '🚶', label: 'Walk 10 to 15 minutes', detail: 'Keep your heart rate in your fat-burning zone' },
  ];
}

const EXERCISE_LIBRARY = [
  { icon: '💪', name: 'Bench Press', muscles: 'Chest · Triceps', cat: 'Chest', defaultSets: '4 x 8', youtubeId: '_FkbD0FhgVE' },
  { icon: '💪', name: 'Incline DB Press', muscles: 'Upper Chest · Shoulders', cat: 'Chest', defaultSets: '3 x 10', youtubeId: '8fXfwG4ftaQ' },
  { icon: '💪', name: 'Decline Bench Press', muscles: 'Lower Chest', cat: 'Chest', defaultSets: '3 x 10', youtubeId: '' },
  { icon: '💪', name: 'Cable Fly', muscles: 'Chest · Pecs', cat: 'Chest', defaultSets: '3 x 12', youtubeId: '' },
  { icon: '💪', name: 'Push-Up', muscles: 'Chest · Triceps · Core', cat: 'Chest', defaultSets: '3 x 20', youtubeId: '' },
  { icon: '💪', name: 'Dips', muscles: 'Chest · Triceps', cat: 'Chest', defaultSets: '3 x max', youtubeId: '' },
  { icon: '🔼', name: 'Pull-Up', muscles: 'Back · Biceps', cat: 'Back', defaultSets: '4 x max', youtubeId: '1Sw5mevOsb0' },
  { icon: '🔼', name: 'Barbell Row', muscles: 'Mid Back · Lats', cat: 'Back', defaultSets: '4 x 6', youtubeId: 'dpYI8K6e-jE' },
  { icon: '🔼', name: 'Lat Pulldown', muscles: 'Lats · Biceps', cat: 'Back', defaultSets: '3 x 10', youtubeId: '' },
  { icon: '🔼', name: 'Seated Cable Row', muscles: 'Mid Back · Lats', cat: 'Back', defaultSets: '3 x 10', youtubeId: 'KaCcBqhiXtc' },
  { icon: '🔼', name: 'Face Pulls', muscles: 'Rear Delt · Rotator Cuff', cat: 'Back', defaultSets: '4 x 15', youtubeId: 'qEyoBOpvqR4' },
  { icon: '🔼', name: 'Single Arm DB Row', muscles: 'Lats · Rhomboids', cat: 'Back', defaultSets: '3 x 10 each', youtubeId: '' },
  { icon: '🏋️', name: 'Overhead Press', muscles: 'Shoulders · Triceps', cat: 'Shoulders', defaultSets: '4 x 8', youtubeId: 'zoN5EH50Dro' },
  { icon: '🏋️', name: 'Lateral Raises', muscles: 'Side Delts', cat: 'Shoulders', defaultSets: '4 x 15', youtubeId: 'Kl3LEzQ5Zqs' },
  { icon: '🏋️', name: 'Arnold Press', muscles: 'Full Deltoid', cat: 'Shoulders', defaultSets: '3 x 10', youtubeId: '' },
  { icon: '🦾', name: 'Barbell Curl', muscles: 'Biceps', cat: 'Arms', defaultSets: '3 x 10', youtubeId: '' },
  { icon: '🦾', name: 'Hammer Curls', muscles: 'Biceps · Brachialis', cat: 'Arms', defaultSets: '3 x 10 each', youtubeId: 'K9LiwcGuqA0' },
  { icon: '🦾', name: 'Tricep Pushdowns', muscles: 'Triceps', cat: 'Arms', defaultSets: '3 x 12', youtubeId: '4s8Fdhnk6aI' },
  { icon: '🏋️', name: 'Back Squat', muscles: 'Quads · Glutes', cat: 'Legs', defaultSets: '4 x 6', youtubeId: 'dW3zj79xfrc' },
  { icon: '🏋️', name: 'Romanian Deadlift', muscles: 'Hamstrings · Glutes', cat: 'Legs', defaultSets: '3 x 8', youtubeId: '_TchJLlBO-4' },
  { icon: '🏋️', name: 'Leg Press', muscles: 'Quads · Glutes', cat: 'Legs', defaultSets: '4 x 10', youtubeId: '' },
  { icon: '🏋️', name: 'Walking Lunges', muscles: 'Quads · Glutes', cat: 'Legs', defaultSets: '3 x 12 each', youtubeId: 'L8fvypPrzzs' },
  { icon: '🏋️', name: 'Bulgarian Split Squat', muscles: 'Quads · Glutes', cat: 'Legs', defaultSets: '3 x 10 each', youtubeId: '' },
  { icon: '🔥', name: 'Plank Hold', muscles: 'Core · Stability', cat: 'Core', defaultSets: '3 x 60s', youtubeId: '' },
  { icon: '🔥', name: 'Crunches', muscles: 'Abs', cat: 'Core', defaultSets: '3 x 20', youtubeId: '' },
  { icon: '🔥', name: 'Sit Ups', muscles: 'Abs · Core', cat: 'Core', defaultSets: '3 x 15', youtubeId: '' },
  { icon: '🔥', name: 'Russian Twists', muscles: 'Obliques · Core', cat: 'Core', defaultSets: '3 x 20', youtubeId: 'aRUMRbl7KS4' },
] as const;

function findExerciseSwapSuggestion(request: string) {
  const normalized = request.toLowerCase();
  const afterFor = normalized.match(/(?:swap|replace).+?for\s+(.+)/)?.[1] ?? normalized.match(/(?:do|use)\s+(.+)/)?.[1];
  const search = afterFor?.trim() || normalized;

  return EXERCISE_LIBRARY.find((exercise) =>
    exercise.name.toLowerCase() === search ||
    exercise.name.toLowerCase().includes(search) ||
    search.includes(exercise.name.toLowerCase()),
  ) ?? null;
}

function parseWorkoutCoachCommand(prompt: string) {
  const normalized = prompt.toLowerCase();
  const weightForRepsMatch =
    normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)?\s*for\s*(\d+)\b/) ??
    normalized.match(/\b(\d+(?:\.\d+)?)\s*x\s*(\d+)\b/);
  const spokenSetIndex =
    normalized.match(/\bset\s*(\d+)\b/)?.[1] ??
    normalized.match(/\b(\d+)(?:st|nd|rd|th)\s*set\b/)?.[1];
  const namedSetIndex =
    /\bfirst\s+set\b/.test(normalized) ? 1 :
    /\bsecond\s+set\b/.test(normalized) ? 2 :
    /\bthird\s+set\b/.test(normalized) ? 3 :
    /\bfourth\s+set\b/.test(normalized) ? 4 :
    /\bfifth\s+set\b/.test(normalized) ? 5 :
    /\bsixth\s+set\b/.test(normalized) ? 6 :
    /\bseventh\s+set\b/.test(normalized) ? 7 :
    /\beighth\s+set\b/.test(normalized) ? 8 :
    undefined;
  const repsMatch =
    weightForRepsMatch
      ? [weightForRepsMatch[0], weightForRepsMatch[2]]
      : (
    normalized.match(/(?:log|got|did|that was|i did)?\s*(\d+)\s*(?:reps?|rep)\b/) ??
    normalized.match(/\b(\d+)\s*x\s*\d+\b/)
      );
  const setsMatch =
    normalized.match(/(\d+)\s*(?:sets?|set)\b/) ??
    normalized.match(/\b(\d+)\s*x\s*(\d+)\b/);
  const weightMatch =
    weightForRepsMatch
      ? [weightForRepsMatch[0], weightForRepsMatch[1]]
      : normalized.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/) ??
        normalized.match(/\b(?:bump(?:\s+it)?\s+to|up\s+to|make\s+it)\s*(\d+(?:\.\d+)?)\b/);

  const markComplete =
    /\b(done|finished|complete|completed|mark done|mark complete)\b/.test(normalized);
  const warmup = /\b(warm ?up|warmup)\b/.test(normalized);
  const cardio = /\b(cardio|bike|rower|treadmill|walk|finisher|cool ?down)\b/.test(normalized);
  const wantsNext = /\b(next|move on|keep going|what's next|next exercise|go next)\b/.test(normalized);
  const logOnly = /\b(log|record|track|save)\b/.test(normalized);
  const askRest = /\b(rest|rest time|how long should i rest|how long to rest)\b/.test(normalized);
  const repeatCue = /\b(repeat|say that again|again|repeat that cue|repeat that)\b/.test(normalized);
  const skipExercise = /\b(skip|skip this|skip this exercise|swap this|replace this movement)\b/.test(normalized);
  const goLighter = /\b(drop the weight|go lighter|too heavy|lower the weight|reduce the weight)\b/.test(normalized);
  const goHeavier = /\b(go heavier|increase the weight|add weight|too easy)\b/.test(normalized);
  const sameWeight = /\b(same weight|same load|same as last|same as before|keep the weight the same)\b/.test(normalized);
  const restDurationMatch =
    normalized.match(/\b(?:start|set|make)?\s*(30|60|90|120)\s*(?:second|seconds|sec|s)\s*rest\b/) ??
    normalized.match(/\b(?:start|set)\s*(30|60|90|120)\b/);
  const swapExercise = /\b(swap|replace)\b/.test(normalized);

  const setCount = setsMatch
    ? Number(setsMatch[2] ?? setsMatch[1])
    : undefined;
  const reps = repsMatch
    ? String(repsMatch[1])
    : setsMatch?.[2]
      ? String(setsMatch[2])
      : undefined;
  const weightLbs = weightMatch?.[1];
  const setIndex = spokenSetIndex
    ? Math.max(1, Number(spokenSetIndex))
    : namedSetIndex;

  const shouldLog =
    markComplete ||
    logOnly ||
    wantsNext ||
    askRest ||
    repeatCue ||
    skipExercise ||
    goLighter ||
    goHeavier ||
    swapExercise ||
    Boolean(restDurationMatch?.[1]) ||
    Boolean(reps) ||
    Boolean(weightLbs) ||
    warmup ||
    cardio;
  if (!shouldLog) {
    return null;
  }

  return {
    askRest,
    cardio,
    sameWeight,
    goHeavier,
    goLighter,
    logOnly,
    markComplete,
    explicitlyMarkedComplete: markComplete,
    reps,
    repeatCue,
    requestedRestSeconds: restDurationMatch?.[1] ? Number(restDurationMatch[1]) : undefined,
    setCount,
    setIndex,
    swapExercise,
    skipExercise,
    warmup,
    wantsNext,
    weightLbs,
  };
}

function parseCoachReminder(prompt: string): { body: string; remindAt: Date; title: string } | null {
  const normalized = prompt.toLowerCase().trim();
  if (!normalized.includes('remind me')) return null;

  const now = new Date();
  const remindAt = new Date(now);
  let body = 'Open APEX and keep your momentum going.';
  let title = 'APEX Coach Reminder';

  if (normalized.includes('meal')) {
    title = 'Log your next meal';
    body = 'Your coach wants your meals logged so the plan stays accurate.';
  } else if (normalized.includes('walk')) {
    title = 'Time for your walk';
    body = 'Your coach set a reminder to get your walk in.';
  } else if (normalized.includes('weigh') || normalized.includes('weight')) {
    title = 'Log your weight';
    body = 'Your coach wants today’s weigh-in logged.';
  } else if (normalized.includes('workout') || normalized.includes('train')) {
    title = 'Start your workout';
    body = 'Your coach set a reminder so you stay on schedule.';
  }

  if (normalized.includes('tomorrow morning')) {
    remindAt.setDate(remindAt.getDate() + 1);
    remindAt.setHours(8, 0, 0, 0);
  } else if (normalized.includes('tomorrow evening')) {
    remindAt.setDate(remindAt.getDate() + 1);
    remindAt.setHours(18, 0, 0, 0);
  } else if (normalized.includes('tomorrow')) {
    remindAt.setDate(remindAt.getDate() + 1);
    remindAt.setHours(9, 0, 0, 0);
  } else if (normalized.includes('tonight')) {
    remindAt.setHours(19, 0, 0, 0);
    if (remindAt <= now) remindAt.setDate(remindAt.getDate() + 1);
  } else {
    remindAt.setHours(remindAt.getHours() + 1, 0, 0, 0);
  }

  return { body, remindAt, title };
}

function WarmupSection({
  accentColor,
  accentSoft,
  accentStrongBorder,
  completedSteps,
  onToggleStep,
}: {
  accentColor: string;
  accentSoft: string;
  accentStrongBorder: string;
  completedSteps: number[];
  onToggleStep: (index: number) => void;
}) {
  return (
    <View style={[styles.warmupCard, { backgroundColor: accentSoft, borderColor: accentStrongBorder }]}>
      <View style={styles.warmupHeader}>
        <Text style={[styles.warmupTitle, { color: accentColor }]}>🔥 WARM UP</Text>
        <Text style={styles.warmupMeta}>5 min · Dynamic · Before every session</Text>
      </View>
      {WARMUP_STEPS.map((step, i) => (
        <Pressable
          key={i}
          style={[styles.warmupRow, i > 0 && { borderTopWidth: 1, borderTopColor: `${accentColor}20` }]}
          onPress={() => onToggleStep(i)}
        >
          <Text style={styles.warmupStepIcon}>{step.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.warmupStepLabel, completedSteps.includes(i) && styles.warmupStepDone, completedSteps.includes(i) ? { color: accentColor } : null]}>{step.label}</Text>
            <Text style={styles.warmupStepDetail}>{step.detail}</Text>
          </View>
          <View style={[styles.warmupCheck, completedSteps.includes(i) && styles.warmupCheckDone, completedSteps.includes(i) ? { borderColor: accentStrongBorder, backgroundColor: accentSoft } : null]}>
            <Text style={[styles.warmupCheckText, completedSteps.includes(i) ? { color: accentColor } : null]}>{completedSteps.includes(i) ? '✓' : ''}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function CardioSection({
  age,
  accentColor,
  accentSoft,
  accentStrongBorder,
  completed,
  onToggleComplete,
  planId,
}: {
  age: number;
  accentColor: string;
  accentSoft: string;
  accentStrongBorder: string;
  completed: boolean;
  onToggleComplete: () => void;
  planId: string;
}) {
  const zone = calcFatBurnZone(age > 10 ? age : 30);
  const options = getCardioOptions(planId);

  return (
    <View style={[styles.cardioCard, { borderColor: `${accentColor}44`, backgroundColor: `${accentColor}12` }]}>
      <View style={styles.cardioHeader}>
        <Text style={[styles.cardioTitle, { color: accentColor }]}>💓 CARDIO FINISHER</Text>
        <Text style={styles.cardioMeta}>15–20 min · End of session</Text>
      </View>

      {/* Personalised fat-burn zone callout */}
      <View style={[styles.hrZoneRow, { backgroundColor: `${accentColor}12`, borderColor: `${accentColor}33` }]}>
        <Text style={styles.hrZoneIcon}>❤️‍🔥</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.hrZoneLabel}>Your Fat-Burning Zone</Text>
          <Text style={[styles.hrZoneValue, { color: accentColor }]}>{zone.low}–{zone.high} BPM</Text>
        </View>
        <View style={[styles.hrZoneBadge, { backgroundColor: `${accentColor}18` }]}>
          <Text style={[styles.hrZoneBadgeText, { color: accentColor }]}>60–70%</Text>
          <Text style={styles.hrZoneBadgeSub}>of max {zone.max}</Text>
        </View>
      </View>

      <Text style={styles.cardioOptionHeader}>PICK YOUR CARDIO:</Text>
      {options.map((opt, i) => (
        <View key={i} style={[styles.cardioOption, i > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }]}>
          <Text style={styles.cardioOptionIcon}>{opt.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardioOptionLabel}>{opt.label}</Text>
            <Text style={styles.cardioOptionDetail}>{opt.detail}</Text>
          </View>
        </View>
      ))}
      <Pressable style={[styles.cardioDoneBtn, completed && styles.cardioDoneBtnActive, completed ? { backgroundColor: accentSoft, borderColor: accentStrongBorder } : null]} onPress={onToggleComplete}>
        <Text style={[styles.cardioDoneBtnText, completed && styles.cardioDoneBtnTextActive, completed ? { color: accentColor } : null]}>
          {completed ? 'Cardio Logged ✓' : 'Log Cardio'}
        </Text>
      </Pressable>
    </View>
  );
}

const BADGE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  done: { bg: 'rgba(0,255,135,0.12)', color: C.green, border: C.green },
  cardio: { bg: 'rgba(255,107,53,0.15)', color: C.orange, border: C.orange },
  lift: { bg: C.blueSoft, color: C.blue, border: C.blue },
  rest: { bg: C.border, color: C.muted, border: C.border },
};

function WorkoutRow({
  item,
  onGo,
  onPreview,
  todayState = 'not_started',
  accentColor,
  accentStrongBorderColor,
}: {
  item: WorkoutProgramDay & { status: DayStatus };
  onGo?: () => void;
  onPreview?: (item: WorkoutProgramDay) => void;
  todayState?: 'complete' | 'in_progress' | 'not_started';
  accentColor?: string;
  accentStrongBorderColor?: string;
}) {
  const badge =
    item.badge === 'lift' && accentColor
      ? { bg: `${accentColor}18`, color: accentColor, border: accentColor }
      : BADGE_COLORS[item.badge];
  // Only mark as "done/complete" if today's workout was actually logged.
  // Chronologically past days (status === 'done') are shown as previewable —
  // the user can still tap them to see the exercises they may have skipped.
  const isActuallyCompleted = item.status === 'today' && todayState === 'complete';
  const isInProgress = item.status === 'today' && todayState === 'in_progress';
  const isPastDay = item.status === 'done'; // past by date, not necessarily logged
  const showGoBtn = Boolean(onGo && item.status === 'today' && todayState === 'not_started');
  const showContinueBtn = Boolean(onGo && item.status === 'today' && todayState === 'in_progress');
  const isPreviewable = Boolean(
    onPreview && (isPastDay || item.status === 'upcoming' || item.status === 'rest'),
  );

  const inner = (
    <View
      style={[
        styles.workoutRow,
        item.status === 'today' && todayState !== 'complete' ? { borderColor: C.orange } : null,
        isActuallyCompleted ? { borderColor: accentStrongBorderColor || C.greenStrongBorder, opacity: 0.78 } : null,
        isPastDay ? { opacity: 0.6 } : null,
      ]}
    >
      <View style={[styles.dayBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
        <Text style={[styles.dayBadgeText, { color: badge.color }]}>{item.day}</Text>
      </View>
      <View style={styles.workoutInfo}>
        <Text style={styles.workoutName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.workoutMeta} numberOfLines={1}>{item.meta}</Text>
      </View>
      {isActuallyCompleted ? (
        <View style={[styles.completeChip, { backgroundColor: accentColor ? `${accentColor}20` : 'rgba(0,0,0,0.3)', borderColor: accentStrongBorderColor || C.greenStrongBorder }]}>
          <Text style={[styles.completeChipText, { color: accentColor || C.green }]}>COMPLETE ✓</Text>
        </View>
      ) : showContinueBtn ? (
        <Pressable style={[styles.goBtn, { backgroundColor: accentColor || C.green }]} onPress={onGo}>
          <Text style={styles.goBtnText}>CONTINUE</Text>
        </Pressable>
      ) : showGoBtn ? (
        <Pressable style={[styles.goBtn, { backgroundColor: accentColor || C.green }]} onPress={onGo}>
          <Text style={styles.goBtnText}>GO</Text>
        </Pressable>
      ) : isPreviewable ? (
        <View style={[styles.previewChip, isPastDay ? styles.previewChipPast : null]}>
          <Text style={styles.previewChipText}>{isPastDay ? 'VIEW' : 'PREVIEW'}</Text>
        </View>
      ) : null}
    </View>
  );

  if (isPreviewable) {
    return (
      <Pressable onPress={() => onPreview?.(item)}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

// ─── Workout Preview Modal ────────────────────────────────────────────────────
function WorkoutPreviewModal({
  visible,
  workout,
  age,
  planId,
  coachLabel,
  onClose,
  onAIDemo,
  accentColor,
}: {
  visible: boolean;
  workout: WorkoutProgramDay | null;
  age: number;
  planId: string;
  coachLabel?: string;
  onClose: () => void;
  onAIDemo: (exercise: WorkoutProgramExercise) => void | Promise<void>;
  accentColor?: string;
}) {
  const sheetY = React.useRef(new Animated.Value(0)).current;
  const dismissSheet = React.useCallback(() => {
    sheetY.setValue(0);
    onClose();
  }, [onClose, sheetY]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gestureState) => gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          sheetY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 80 || gestureState.vy > 0.8) {
            Animated.timing(sheetY, {
              toValue: 500,
              duration: 180,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }).start(() => dismissSheet());
            return;
          }

          Animated.spring(sheetY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
      }),
    [dismissSheet, sheetY],
  );

  React.useEffect(() => {
    if (!visible) {
      sheetY.setValue(0);
    }
  }, [sheetY, visible]);

  if (!workout) return null;
  const isActive = workout.badge !== 'rest';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Separate backdrop pressable so it never intercepts inner taps */}
      <View style={styles.modalOverlay} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[styles.modal, { maxHeight: '88%', transform: [{ translateY: sheetY }] }]}
          {...panResponder.panHandlers}
        >
          <View style={styles.modalHandle} />
          <Text style={styles.previewModalEyebrow}>{workout.day} · PREVIEW</Text>
          <Text style={styles.previewModalTitle}>{workout.name}</Text>
          <Text style={styles.previewModalMeta}>{workout.meta}</Text>
          <ScrollView style={{ marginTop: 12 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {/* Warm-up block */}
            {isActive && <WarmupSection accentColor={accentColor ?? C.green} accentSoft={`${accentColor ?? C.green}14`} accentStrongBorder={accentColor ?? C.green} completedSteps={[]} onToggleStep={() => null} />}

            {/* Main exercises */}
            {workout.exercises.map((ex, i) => (
              <View
                key={ex.num}
                style={[
                  styles.previewExRow,
                  i > 0 && { marginTop: 0 },
                  accentColor ? { backgroundColor: `${accentColor}14`, borderColor: `${accentColor}44` } : null,
                ]}
              >
                <View style={[styles.previewExNum, accentColor ? { backgroundColor: accentColor } : null]}>
                  <Text style={styles.previewExNumText}>{ex.num}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.previewExName}>{ex.name}</Text>
                  <Text style={styles.previewExSets}>{ex.sets}</Text>
                </View>
              </View>
            ))}

            {/* Cardio finisher + HR zone */}
            {isActive && <CardioSection age={age} accentColor={accentColor ?? C.green} accentSoft={`${accentColor ?? C.green}14`} accentStrongBorder={accentColor ?? C.green} completed={false} onToggleComplete={() => null} planId={planId} />}

            <View style={{ height: 16 }} />
          </ScrollView>
          <Pressable style={styles.btnGhost} onPress={onClose}>
            <Text style={styles.btnGhostText}>Close</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ExerciseItem({
  accentBorder,
  coachLabel,
  done,
  ex,
  loggedSummary,
  onAIDemo,
  onFormReview,
  onLog,
  onToggle,
  onVideoPress,
  accentColor,
  accentSoft,
}: {
  accentBorder?: string;
  coachLabel?: string;
  done: boolean;
  ex: WorkoutProgramExercise;
  loggedSummary?: string | null;
  onAIDemo?: (exerciseName: string) => void;
  onFormReview?: (exerciseName: string) => void;
  onLog: () => void;
  onToggle: () => void;
  onVideoPress?: (exercise: WorkoutProgramExercise) => void;
  accentColor?: string;
  accentSoft?: string;
}) {
  return (
    <Pressable style={[styles.exItem, accentSoft ? { backgroundColor: accentSoft, borderColor: accentBorder ?? accentColor } : null, done ? styles.exItemDone : null]} onPress={onToggle}>
      <View style={styles.exNum}>
        <Text style={styles.exNumText}>{done ? '✓' : ex.num}</Text>
      </View>
      <View style={styles.exInfo}>
        <Text style={[styles.exName, done ? styles.exNameDone : null]}>{ex.name}</Text>
        <Text style={styles.exSets}>{ex.sets}</Text>
        {loggedSummary ? <Text style={styles.exLogSummary}>{loggedSummary}</Text> : null}
        <View style={styles.exActions}>
          <Pressable
            style={[styles.exLogBtn, accentSoft ? { backgroundColor: accentSoft, borderColor: accentBorder ?? accentColor } : null]}
            onPress={(e) => { e.stopPropagation(); onLog(); }}
          >
            <Text style={[styles.exLogText, accentColor ? { color: accentColor } : null]}>LOG</Text>
          </Pressable>
          {ex.youtubeId ? (
            <Pressable
              style={styles.exDemoBtn}
              onPress={(e) => {
                e.stopPropagation();
                onVideoPress?.(ex);
              }}
            >
              <Text style={styles.exDemoText}>View Video</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.exFormReviewBtn}
            onPress={(e) => {
              e.stopPropagation();
              onFormReview?.(ex.name);
            }}
          >
            <Text style={styles.exFormReviewText}>Send Form Video</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Per-set data type ────────────────────────────────────────────────────────
type SetEntry = {
  reps: string;
  weightLbs: string;
  restSeconds: string; // '30','60','90','120','180','0'(=none)
  setType?: 'straight' | 'drop' | 'superset' | 'triset' | 'circuit';
};

type ExercisePrescription = {
  intensity: string | null;
  raw: string;
  reps: string;
  setCount: number;
};

type WorkoutDemoResult = {
  cameraPlan: string;
  demoScript: string;
  generationPrompt?: string;
  headline: string;
  videoRequestId?: string | null;
  videoStatus?: 'ready' | 'queued' | 'not_configured' | 'failed';
  videoUrl?: string | null;
};

function buildCoachFallbackDemo(
  exerciseName: string,
  exerciseSets: string,
  coach: CoachVoiceOption | null,
): WorkoutDemoResult {
  const coachName = coach?.label ?? 'Coach Josh';
  const roleLabel = coach?.role ?? 'Coach';

  return {
    headline: `${exerciseName} with ${coachName}`,
    demoScript:
      `${coachName} walks you through ${exerciseName}. Keep it simple — set up clean, control the weight on the way down, and stay smooth through every rep. Finish strong, reset your breath, and we go again.`,
    cameraPlan: [
      `Front setup angle on ${exerciseName}`,
      'Side angle showing range of motion and bar path',
      `${coachName} cue close-up on tempo, brace, and finish`,
    ].join(' • '),
    generationPrompt: `${coachName}, a ${roleLabel.toLowerCase()}, demonstrates ${exerciseName} for ${exerciseSets}. Premium short-form training demo. Clear setup, one key form cue, one clean working rep, and a strong finish. Use the ${coachName} coach look and personality.`,
    videoUrl: null,
  };
}

const REST_LABELS = ['30s', '60s', '90s', '2 min', '3 min', 'None'];
const REST_SECONDS = ['30', '60', '90', '120', '180', '0'];
const QUICK_WORKOUT_FOCUS_OPTIONS = [
  { id: 'upper', label: 'Upper Body' },
  { id: 'lower', label: 'Lower Body' },
  { id: 'core', label: 'Core' },
  { id: 'conditioning', label: 'Conditioning' },
  { id: 'full', label: 'Full Body' },
] as const;
const QUICK_WORKOUT_EQUIPMENT_OPTIONS = [
  { id: 'gym', label: 'Gym' },
  { id: 'home', label: 'Home' },
  { id: 'none', label: 'No Equipment' },
] as const;
const SET_TYPE_OPTIONS: Array<{ id: NonNullable<SetEntry['setType']>; label: string }> = [
  { id: 'straight', label: 'Straight' },
  { id: 'drop', label: 'Drop' },
  { id: 'superset', label: 'Superset' },
  { id: 'triset', label: 'Tri-set' },
  { id: 'circuit', label: 'Circuit' },
];

type QuickWorkoutFocus = typeof QUICK_WORKOUT_FOCUS_OPTIONS[number]['id'];
type QuickWorkoutEquipment = typeof QUICK_WORKOUT_EQUIPMENT_OPTIONS[number]['id'];

function getSetTypeLabel(setType?: SetEntry['setType']) {
  return SET_TYPE_OPTIONS.find((option) => option.id === (setType ?? 'straight'))?.label ?? 'Straight';
}

function getQuickWorkoutFocusIcon(focusLabel?: string) {
  if (!focusLabel) return '⚡';
  if (focusLabel.toLowerCase().includes('upper')) return '💪';
  if (focusLabel.toLowerCase().includes('lower')) return '🦵';
  if (focusLabel.toLowerCase().includes('core')) return '🔥';
  if (focusLabel.toLowerCase().includes('conditioning')) return '🏃';
  return '⚡';
}

function getQuickWorkoutEquipmentIcon(equipmentLabel?: string) {
  if (!equipmentLabel) return '🏋️';
  if (equipmentLabel.toLowerCase().includes('no equipment')) return '🧍';
  if (equipmentLabel.toLowerCase().includes('home')) return '🏠';
  return '🏋️';
}

function parseExercisePrescription(raw: string | undefined): ExercisePrescription {
  const trimmed = raw?.trim() || '';
  const match = trimmed.match(/^(\d+)\s*x\s*([^@]+?)(?:\s*@\s*(.+))?$/i);
  if (match) {
    return {
      intensity: match[3]?.trim() || null,
      raw: trimmed,
      reps: match[2].trim(),
      setCount: Math.max(1, Number(match[1]) || 1),
    };
  }

  return {
    intensity: null,
    raw: trimmed || '3 x 12',
    reps: trimmed || '12',
    setCount: 3,
  };
}

function makeDefaultSets(count: number, defaultReps: string): SetEntry[] {
  return Array.from({ length: count }, () => ({
    reps: defaultReps,
    weightLbs: '',
    restSeconds: '90',
    setType: 'straight',
  }));
}

function buildQuickWorkout(
  minutes: number,
  focus: QuickWorkoutFocus,
  equipment: QuickWorkoutEquipment,
  goal: string | undefined,
  coach: CoachVoiceOption | null,
): AIWorkout {
  const goalKey = goal ?? 'recomp';
  const equipmentFilteredLibrary = EXERCISE_LIBRARY.filter((exercise) => {
    if (equipment === 'gym') return true;
    if (equipment === 'none') {
      return ['Push-Up', 'Walking Lunges', 'Plank Hold', 'Crunches', 'Sit Ups', 'Russian Twists'].includes(exercise.name);
    }
    return !['Bench Press', 'Decline Bench Press', 'Cable Fly', 'Pull-Up', 'Barbell Row', 'Lat Pulldown', 'Seated Cable Row', 'Overhead Press', 'Barbell Curl', 'Tricep Pushdowns', 'Back Squat', 'Romanian Deadlift', 'Leg Press'].includes(exercise.name);
  });
  const byCategory = {
    Arms: equipmentFilteredLibrary.filter((exercise) => exercise.cat === 'Arms'),
    Back: equipmentFilteredLibrary.filter((exercise) => exercise.cat === 'Back'),
    Chest: equipmentFilteredLibrary.filter((exercise) => exercise.cat === 'Chest'),
    Core: equipmentFilteredLibrary.filter((exercise) => exercise.cat === 'Core'),
    Legs: equipmentFilteredLibrary.filter((exercise) => exercise.cat === 'Legs'),
    Shoulders: equipmentFilteredLibrary.filter((exercise) => exercise.cat === 'Shoulders'),
  };

  const sequence =
    focus === 'upper'
      ? ['Chest', 'Back', 'Shoulders', 'Arms', 'Chest']
      : focus === 'lower'
        ? ['Legs', 'Legs', 'Core', 'Legs', 'Core']
        : focus === 'core'
          ? ['Core', 'Core', 'Core', 'Back', 'Legs']
          : focus === 'conditioning'
            ? ['Legs', 'Core', 'Chest', 'Back', 'Shoulders']
            : goalKey === 'lose'
              ? ['Legs', 'Chest', 'Back', 'Core', 'Shoulders']
              : goalKey === 'build'
                ? ['Chest', 'Back', 'Shoulders', 'Arms', 'Chest']
                : goalKey === 'performance'
                  ? ['Legs', 'Back', 'Shoulders', 'Core', 'Legs']
                  : ['Chest', 'Legs', 'Back', 'Core', 'Shoulders'];

  const exerciseCount = minutes <= 10 ? 3 : minutes <= 20 ? 4 : 5;
  const prescription =
    focus === 'conditioning'
      ? (minutes <= 10 ? { reps: '40s on / 20s off', sets: 2, rest: '20s' } : minutes <= 20 ? { reps: '45s on / 15s off', sets: 3, rest: '15s' } : { reps: '50s on / 10s off', sets: 3, rest: '10s' })
      : minutes <= 10
        ? { reps: '10-12', sets: 2, rest: '30s' }
        : minutes <= 20
          ? { reps: '8-10', sets: 3, rest: '45s' }
          : { reps: '8-12', sets: 3, rest: '60s' };

  const exercises = sequence
    .slice(0, exerciseCount)
    .map((category, index) => {
      const pool = byCategory[category as keyof typeof byCategory];
      const fallbackPool = equipmentFilteredLibrary.length > 0 ? equipmentFilteredLibrary : EXERCISE_LIBRARY;
      const exercise = pool.length > 0 ? pool[index % pool.length] : fallbackPool[index % fallbackPool.length];
      return {
        name: exercise.name,
        reps: prescription.reps,
        rest: prescription.rest,
        sets: prescription.sets,
        weight: exercise.cat === 'Core' ? 'bodyweight' : 'controlled load',
      };
    });

  return {
    name: `${QUICK_WORKOUT_FOCUS_OPTIONS.find((option) => option.id === focus)?.label ?? 'Quick Workout'} · ${minutes} min`,
    duration: minutes,
    focus:
      focus === 'upper'
        ? 'Upper-body express session'
        : focus === 'lower'
          ? 'Lower-body express session'
          : focus === 'core'
            ? 'Core-focused express session'
            : focus === 'conditioning'
              ? 'Conditioning finisher'
              : goalKey === 'lose'
                ? 'Fast fat-loss session'
                : goalKey === 'build'
                  ? 'Muscle-building express session'
                  : goalKey === 'performance'
                    ? 'Performance primer'
                    : 'Full-body express session',
    exercises,
    coachNote:
      `No wasted time here. ${equipment === 'none' ? 'Bodyweight only, still effective.' : equipment === 'home' ? 'Home setup, serious intent.' : 'Use the equipment around you and get after it.'} Let's stack a real win in ${minutes} minutes. We got this.`,
    quickWorkoutMeta: {
      equipment: QUICK_WORKOUT_EQUIPMENT_OPTIONS.find((option) => option.id === equipment)?.label ?? 'Gym',
      focusLabel: QUICK_WORKOUT_FOCUS_OPTIONS.find((option) => option.id === focus)?.label ?? 'Full Body',
      minutes,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── LogModal ─────────────────────────────────────────────────────────────────
function LogModal({
  canEstimateCalories,
  calories,
  duration,
  exampleExercises,
  exerciseName,
  initialSets,
  initialReps,
  plannedPrescription,
  isPro,
  currentLoggedExerciseName,
  currentLoggedSets,
  lastSession,
  youtubeId,
  onEstimateCaloriesPress,
  onUpgradePress,
  onChangeExerciseName,
  onChangeCalories,
  onChangeDuration,
  onDismissRestTimer,
  onSaveAndNext,
  onClose,
  onSave,
  canSaveNext,
  restTimerSeconds,
  visible,
  accentColor,
  accentSoft,
  onDemoPress,
}: {
  canEstimateCalories: boolean;
  calories: string;
  duration: string;
  exampleExercises: string;
  exerciseName: string;
  initialSets: number;
  initialReps: string;
  plannedPrescription?: string;
  isPro: boolean;
  currentLoggedExerciseName?: string | null;
  currentLoggedSets?: SetEntry[];
  lastSession?: { sets: Array<{ reps: string; weightLbs: string; restSeconds: number }>; date: string } | null;
  youtubeId?: string;
  onEstimateCaloriesPress: () => void;
  onUpgradePress: () => void;
  onChangeExerciseName: (value: string) => void;
  onChangeCalories: (value: string) => void;
  onChangeDuration: (value: string) => void;
  onDismissRestTimer: () => void;
  onSaveAndNext: (sets: SetEntry[]) => void;
  onClose: () => void;
  onSave: (sets: SetEntry[]) => void;
  canSaveNext: boolean;
  restTimerSeconds: number;
  visible: boolean;
  accentColor?: string;
  accentSoft?: string;
  onDemoPress?: () => void;
}) {
  const [inAppVideoId, setInAppVideoId] = useState<string | null>(null);
  const sheetY = React.useRef(new Animated.Value(0)).current;
  const scrollOffsetYRef = React.useRef(0);
  const lastSessionDateLabel = lastSession?.date
    ? new Date(`${lastSession.date}T12:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : null;

  const [setEntries, setSetEntries] = useState<SetEntry[]>(() =>
    makeDefaultSets(initialSets, initialReps),
  );

  const [isPR, setIsPR] = useState(false);
  const lastMaxWeight = lastSession
    ? Math.max(0, ...lastSession.sets.map((s) => parseFloat(s.weightLbs || '0')))
    : 0;

  // Re-seed rows when the modal opens with a new exercise
  const prevVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible && !prevVisible.current) {
      const shouldUseCurrentLoggedSets =
        currentLoggedExerciseName === exerciseName &&
        currentLoggedSets &&
        currentLoggedSets.length > 0;
      setSetEntries(
        shouldUseCurrentLoggedSets
          ? currentLoggedSets
          : makeDefaultSets(initialSets, initialReps),
      );
    }
    prevVisible.current = visible;
  }, [visible, currentLoggedExerciseName, currentLoggedSets, exerciseName, initialSets, initialReps]);

  const updateSet = (index: number, field: keyof SetEntry, value: string) => {
    setSetEntries((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (field === 'weightLbs' && lastMaxWeight > 0) {
        const currentMax = Math.max(0, ...next.map((s) => parseFloat(s.weightLbs || '0')));
        setIsPR(currentMax > lastMaxWeight);
      }
      return next;
    });
  };

  const addSet = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const last = setEntries[setEntries.length - 1];
    setSetEntries((prev) => [
      ...prev,
      {
        reps: last?.reps ?? initialReps,
        weightLbs: last?.weightLbs ?? '',
        restSeconds: last?.restSeconds ?? '90',
        setType: last?.setType ?? 'straight',
      },
    ]);
  };

  const removeSet = (index: number) => {
    if (setEntries.length <= 1) return;
    setSetEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const dismissSheet = React.useCallback(() => {
    sheetY.setValue(0);
    onClose();
  }, [onClose, sheetY]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          scrollOffsetYRef.current <= 0 &&
          gestureState.dy > 4 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onMoveShouldSetPanResponder: (_, gestureState) =>
          scrollOffsetYRef.current <= 0 &&
          Math.abs(gestureState.dy) > 5 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gestureState) => {
          sheetY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 80 || gestureState.vy > 0.8) {
            Animated.timing(sheetY, {
              toValue: 500,
              duration: 180,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }).start(() => dismissSheet());
            return;
          }

          Animated.spring(sheetY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
      }),
    [dismissSheet, sheetY],
  );

  React.useEffect(() => {
    if (!visible) {
      sheetY.setValue(0);
    }
  }, [sheetY, visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.modal, { flex: 1, transform: [{ translateY: sheetY }] }]} {...panResponder.panHandlers}>
          <View style={{ flex: 1 }}>
            <View style={styles.logModalDragArea}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>LOG WORKOUT</Text>
            </View>
          <ScrollView
            style={styles.logModalScroll}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="always"
            bounces
            onScroll={(event) => {
              scrollOffsetYRef.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            contentContainerStyle={styles.logModalScrollContent}
          >

          {/* Demo video removed from log modal — watchable via the exercise preview page */}

          {/* Last session summary */}
          {lastSession && (
            <View style={[styles.lastSessionBanner, accentColor ? { backgroundColor: `${accentColor}10`, borderColor: `${accentColor}30` } : null]}>
              <Text style={[styles.lastSessionLabel, accentColor ? { color: accentColor } : null]}>
                📅 Last time{lastSessionDateLabel ? ` · ${lastSessionDateLabel}` : ''}
              </Text>
              <Text style={styles.lastSessionValue}>
                {lastSession.sets.length} sets · {lastSession.sets[0]?.reps ?? '—'} reps
                {lastMaxWeight > 0 ? ` · ${lastMaxWeight} lbs` : ''}
              </Text>
              <View style={styles.lastSessionHistoryList}>
                {lastSession.sets.map((set, index) => {
                  const repsLabel = set.reps?.trim() ? `${set.reps.trim()} reps` : 'reps not logged';
                  const weightLabel = set.weightLbs?.trim() ? `${set.weightLbs.trim()} lbs` : 'bodyweight';
                  return (
                    <Text key={`${lastSession.date}-${index}`} style={styles.lastSessionHistoryItem}>
                      Set {index + 1}: {repsLabel} · {weightLabel}
                    </Text>
                  );
                })}
              </View>
            </View>
          )}

          {/* PR badge */}
          {isPR && (
            <View style={[styles.prBadge, accentColor ? { backgroundColor: accentSoft, borderColor: accentColor } : null]}>
              <Text style={[styles.prBadgeText, accentColor ? { color: accentColor } : null]}>🏆 NEW PERSONAL RECORD!</Text>
            </View>
          )}

          {/* Exercise name */}
          <Text style={styles.formLabel}>Exercise</Text>
          <TextInput
            style={styles.formInput}
            value={exerciseName}
            onChangeText={onChangeExerciseName}
            placeholder="e.g. Bench Press"
            placeholderTextColor={styles.placeholder.color}
          />
          {youtubeId ? (
            <Pressable
              style={styles.demoBtn}
              onPress={() => onDemoPress?.()}
            >
              <Text style={[styles.demoBtnText, accentColor ? { color: accentColor } : null]}>▶ Watch Demo</Text>
            </Pressable>
          ) : null}
          {plannedPrescription ? (
            <Text style={styles.exercisePlanText}>Planned today: {plannedPrescription}</Text>
          ) : null}
          {exampleExercises ? (
            <Text style={styles.exerciseExampleText}>Examples: {exampleExercises}</Text>
          ) : null}

          {restTimerSeconds > 0 ? (
            <View style={styles.restTimerCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.restTimerEyebrow}>REST TIMER</Text>
                <Text style={styles.restTimerValue}>{restTimerSeconds}s remaining</Text>
              </View>
              <Pressable style={styles.restTimerSkipBtn} onPress={onDismissRestTimer}>
                <Text style={styles.restTimerSkipText}>Skip</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── Per-set rows ── */}
          <View style={styles.setHeader}>
            <Text style={[styles.formLabel, { flex: 0.5, marginBottom: 0 }]}>#</Text>
            <Text style={[styles.formLabel, { flex: 1.2, marginBottom: 0 }]}>Reps</Text>
            <Text style={[styles.formLabel, { flex: 1.6, marginBottom: 0 }]}>Weight (lbs)</Text>
            <View style={{ width: 28 }} />
          </View>

          {setEntries.map((entry, i) => (
            <View key={i}>
              <View style={styles.setRow}>
                {/* Set number */}
                <View style={styles.setNumBadge}>
                  <Text style={styles.setNumText}>{i + 1}</Text>
                </View>

                {/* Reps */}
                <TextInput
                  style={[styles.setInput, { flex: 1.2 }]}
                  keyboardType="numeric"
                  value={entry.reps}
                  onChangeText={(v) => updateSet(i, 'reps', v)}
                  placeholder="12"
                  placeholderTextColor={styles.placeholder.color}
                />

                {/* Weight */}
                <TextInput
                  style={[styles.setInput, { flex: 1.6 }]}
                  keyboardType="decimal-pad"
                  value={entry.weightLbs}
                  onChangeText={(v) => updateSet(i, 'weightLbs', v)}
                  placeholder="lbs"
                  placeholderTextColor={styles.placeholder.color}
                />

                {/* Remove button */}
                <Pressable
                  style={styles.setRemoveBtn}
                  onPress={() => removeSet(i)}
                  hitSlop={8}
                  disabled={setEntries.length <= 1}
                >
                  <Text style={[styles.setRemoveText, setEntries.length <= 1 ? { opacity: 0.2 } : null]}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.restRow}>
                <Text style={styles.restLabel}>Type:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.restPills}>
                  {SET_TYPE_OPTIONS.map((option) => {
                    const active = (entry.setType ?? 'straight') === option.id;
                    return (
                      <Pressable
                        key={option.id}
                        style={[styles.restPill, active ? [styles.restPillActive, { backgroundColor: accentSoft, borderColor: accentColor }] : null]}
                        onPress={() => updateSet(i, 'setType', option.id)}
                      >
                        <Text style={[styles.restPillText, active ? [styles.restPillTextActive, { color: accentColor }] : null]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Rest time selector — shown below every set except the last */}
              {i < setEntries.length - 1 ? (
                <View style={styles.restRow}>
                  <Text style={styles.restLabel}>Rest:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.restPills}>
                    {REST_LABELS.map((label, ri) => {
                      const active = entry.restSeconds === REST_SECONDS[ri];
                      return (
                        <Pressable
                          key={label}
                          style={[styles.restPill, active ? [styles.restPillActive, { backgroundColor: accentSoft, borderColor: accentColor }] : null]}
                          onPress={() => updateSet(i, 'restSeconds', REST_SECONDS[ri])}
                        >
                          <Text style={[styles.restPillText, active ? [styles.restPillTextActive, { color: accentColor }] : null]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          ))}

          {/* Add set */}
          <Pressable style={styles.addSetBtn} onPress={addSet}>
            <Text style={styles.addSetText}>+ Add Set</Text>
          </Pressable>

          {/* Duration */}
          <Text style={styles.formLabel}>Duration Minutes</Text>
          <TextInput
            style={styles.formInput}
            keyboardType="numeric"
            value={duration}
            onChangeText={onChangeDuration}
            placeholder="45"
            placeholderTextColor={styles.placeholder.color}
          />

          {/* Calories */}
          <Text style={styles.formLabel}>Calories Burned (est.)</Text>
          {canEstimateCalories ? (
            <TextInput
              style={[styles.formInput, { marginBottom: 16 }]}
              keyboardType="numeric"
              value={calories}
              onChangeText={onChangeCalories}
              placeholder="320"
              placeholderTextColor={styles.placeholder.color}
            />
          ) : (
            <Pressable style={[styles.formInput, styles.lockedInput]} onPress={onEstimateCaloriesPress}>
              <Text style={styles.lockedInputText}>🔒 AI calorie estimate is Pro</Text>
              <Text style={styles.lockedInputSubtext}>Tap to unlock smarter workout calorie estimates</Text>
            </Pressable>
          )}

          {/* Action buttons */}
          <View style={styles.modalBtns}>
            <Pressable style={styles.btnGhost} onPress={onClose}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            {canSaveNext ? (
              <Pressable style={[styles.btnGhost, { flex: 1.2 }]} onPress={() => onSaveAndNext(setEntries)}>
                <Text style={styles.btnGhostText}>Save + Next</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.btnPrimary, { flex: canSaveNext ? 1.6 : 2 }]}
              onPress={() => onSave(setEntries)}
            >
              <Text style={styles.btnPrimaryText}>Save & Finish</Text>
            </Pressable>
          </View>
          </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default function TrainScreen() {
  const { accent, accentSoft, accentBorder, accentStrongBorder } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { session } = useAuth();
  const { addXp } = useGamification();
  const { isPro, isLoading: proLoading } = usePro();
  const { getWorkoutCount, getWorkoutStreak } = useWorkoutStats();
  const voice = useVoiceCoach();
  const [tab, setTab] = useState<Tab>('week');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [doneSets, setDoneSets] = useState<number[]>([]);
  const [logVisible, setLogVisible] = useState(false);
  const [lastSession, setLastSession] = useState<{ sets: Array<{ reps: string; weightLbs: string; restSeconds: number }>; date: string } | null>(null);
  const [currentLoggedExerciseName, setCurrentLoggedExerciseName] = useState<string | null>(null);
  const [currentExerciseLogSets, setCurrentExerciseLogSets] = useState<SetEntry[]>([]);
  const [todayExerciseLogCounts, setTodayExerciseLogCounts] = useState<Record<string, number>>({});
  const [todayExerciseSets, setTodayExerciseSets] = useState<Record<string, SetEntry[]>>({});
  const [previewWorkout, setPreviewWorkout] = useState<WorkoutProgramDay | null>(null);
  const [coachImagePreviewVisible, setCoachImagePreviewVisible] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState('45');
  const [caloriesBurned, setCaloriesBurned] = useState('320');
  // initialSets / initialReps seed the per-set rows when the modal opens
  const [initialSets, setInitialSets] = useState(3);
  const [initialReps, setInitialReps] = useState('12');
  const [selectedWorkoutName, setSelectedWorkoutName] = useState('');
  const [selectedExerciseIndex, setSelectedExerciseIndex] = useState(0);
  const [selectedExercise, setSelectedExercise] = useState('');
  const [completedWarmupSteps, setCompletedWarmupSteps] = useState<number[]>([]);
  const [cardioCompleted, setCardioCompleted] = useState(false);
  const [restTimerSeconds, setRestTimerSeconds] = useState(0);
  const [history, setHistory] = useState<Array<{ calories_burned: number; duration_minutes: number; workout_date: string; workout_type: string }>>([]);
  const [aiWorkout, setAiWorkout] = useState<AIWorkout | null>(null);
  const [aiProgram, setAiProgram] = useState<AIProgram | null>(null);
  const [historyDetailItem, setHistoryDetailItem] = useState<{ workout_type: string; workout_date: string; duration_minutes: number; calories_burned: number } | null>(null);
  const [historyDetailSets, setHistoryDetailSets] = useState<SetEntry[]>([]);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [workoutDemo, setWorkoutDemo] = useState<WorkoutDemoResult | null>(null);
  const [workoutDemoExercise, setWorkoutDemoExercise] = useState<string>('');
  const [workoutDemoExerciseSets, setWorkoutDemoExerciseSets] = useState<string>('Use programmed sets and reps');
  const [workoutDemoLoading, setWorkoutDemoLoading] = useState(false);
  const workoutDemoPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coachDemoPulse = useRef(new Animated.Value(0)).current;
  const workoutDemoSheetY = useRef(new Animated.Value(0)).current;
  const [libQuery, setLibQuery] = useState('');
  const [libCat, setLibCat] = useState<string>('All');
  const [libDetail, setLibDetail] = useState<{ icon: string; name: string; muscles: string; cat: string; defaultSets: string; youtubeId: string } | null>(null);
  const [customTodayExs, setCustomTodayExs] = useState<Array<{ name: string; sets: string; muscles: string }>>([]);
  const [workoutCoachReply, setWorkoutCoachReply] = useState('');
  const [workoutCoachLoading, setWorkoutCoachLoading] = useState(false);
  const [workoutCoachRecording, setWorkoutCoachRecording] = useState(false);
  const [workoutCoachTranscribing, setWorkoutCoachTranscribing] = useState(false);
  const [workoutCoachSpeaking, setWorkoutCoachSpeaking] = useState(false);
  const [selectedCoachVoice, setSelectedCoachVoice] = useState<CoachVoiceOption | null>(null);
  const [selectedCoachVoiceLabel, setSelectedCoachVoiceLabel] = useState('Coach voice');
  const [progressHydrated, setProgressHydrated] = useState(false);
  const [quickToolsExpanded, setQuickToolsExpanded] = useState(false);
  const [quickWorkoutFocus, setQuickWorkoutFocus] = useState<QuickWorkoutFocus>('full');
  const [quickWorkoutEquipment, setQuickWorkoutEquipment] = useState<QuickWorkoutEquipment>('gym');
  const [quickWorkoutMinutes, setQuickWorkoutMinutes] = useState<number | null>(null);
  const [completedWorkoutDates, setCompletedWorkoutDates] = useState<Set<string>>(new Set());
  const [workoutCoachDebug, setWorkoutCoachDebug] = useState<{
    lastRecordingMs: number;
    lastTranscript: string;
    lastTranscriptStatus: 'idle' | 'transcribing' | 'empty' | 'ok' | 'error';
  }>({
    lastRecordingMs: 0,
    lastTranscript: '',
    lastTranscriptStatus: 'idle',
  });
  const workoutCoachRecordingRef = useRef<Audio.Recording | null>(null);
  const workoutCoachRecordingStartedAtRef = useRef(0);
  const workoutCoachStatusRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workoutCoachSpeechDetectedRef = useRef(false);
  const [showActiveWorkout, setShowActiveWorkout] = useState(false);
  // Tracks whether Serena has connected at least once this session — used to
  // send a context-rich "welcome back" kickoff instead of a cold greeting.
  const coachHasConnectedRef = useRef(false);
  // Throttle: timestamp of last form cue forwarded to Serena. Positive cues
  // get a longer cooldown (20s) — fix/critical cues break through after 10s.
  const lastFormCueSentAtRef = useRef(0);
  const workoutCoachSpeechSustainedMsRef = useRef(0);
  const workoutCoachSilenceMsRef = useRef(0);
  const workoutCoachAutoRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      AsyncStorage.getItem('apex.train.entryTab')
        .then((entryTab) => {
          if (entryTab === 'today') {
            setTab('today');
            AsyncStorage.removeItem('apex.train.entryTab').catch(() => null);
          }
        })
        .catch(() => null);
      AsyncStorage.getItem(PROFILE_STORAGE_KEY)
        .then((raw) => setProfile(raw ? (JSON.parse(raw) as UserProfile) : null))
        .catch(() => setProfile(null));
      // Check for AI-pushed workout and program
      getAIWorkout()
        .then((w) => setAiWorkout(w))
        .catch(() => null);
      getAIProgram()
        .then((p) => setAiProgram(p))
        .catch(() => null);
      // Load custom exercises added from the library for today
      const todayKey = new Date().toISOString().slice(0, 10);
      AsyncStorage.getItem(`apex.customExercises.${todayKey}`)
        .then((raw) => setCustomTodayExs(raw ? JSON.parse(raw) : []))
        .catch(() => null);
      getSelectedCoachVoice()
        .then(setSelectedCoachVoice)
        .catch(() => setSelectedCoachVoice(null));
      getSelectedCoachVoiceId()
        .then((voiceId) => setSelectedCoachVoiceLabel(getCoachVoiceOptionById(voiceId).label))
        .catch(() => setSelectedCoachVoiceLabel('Coach voice'));
    }, []),
  );

  const activePlanId = profile?.activePlanId ?? getSuggestedPlanId(profile?.goal ?? 'recomp', profile?.experience ?? 'intermediate');
  const isAiGenerated = activePlanId === 'ai-generated';

  const closeWorkoutDemo = React.useCallback(() => {
    setWorkoutDemo(null);
    setWorkoutDemoExercise('');
    setWorkoutDemoExerciseSets('Use programmed sets and reps');
    workoutDemoSheetY.setValue(0);
  }, [workoutDemoSheetY]);

  const launchQuickWorkout = React.useCallback(async (minutes: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    const quickWorkout = buildQuickWorkout(minutes, quickWorkoutFocus, quickWorkoutEquipment, profile?.goal, selectedCoachVoice);
    setQuickWorkoutMinutes(minutes);
    setAiWorkout(quickWorkout);
    await saveAIWorkout(quickWorkout).catch(() => null);
    setTab('week');
  }, [profile?.goal, quickWorkoutEquipment, quickWorkoutFocus, selectedCoachVoice]);

  const workoutDemoPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          workoutDemoSheetY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 80 || gestureState.vy > 0.8) {
            Animated.timing(workoutDemoSheetY, {
              toValue: 500,
              duration: 180,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }).start(() => closeWorkoutDemo());
            return;
          }

          Animated.spring(workoutDemoSheetY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
      }),
    [closeWorkoutDemo, workoutDemoSheetY],
  );

  // Base static plan — for ai-generated we fall back to a static plan purely for
  // the schedule shape, but we'll override display fields below.
  const basePlan = useMemo(
    () => getPlanById(isAiGenerated ? undefined : activePlanId),
    [activePlanId, isAiGenerated],
  );

  // When an AI program is active, overlay its metadata onto the base plan so the
  // program title, icon, subtitle, etc. reflect the AI-generated program.
  const activePlan = useMemo(() => {
    if (isAiGenerated && aiProgram) {
      return {
        ...basePlan,
        title: aiProgram.title,
        icon: aiProgram.icon,
        subtitle: aiProgram.subtitle,
        description: aiProgram.focus ?? basePlan.description,
        durationWeeks: aiProgram.durationWeeks,
        daysPerWeek: aiProgram.daysPerWeek,
        level: aiProgram.level as typeof basePlan.level,
        id: 'ai-generated' as typeof basePlan.id,
      };
    }
    return basePlan;
  }, [basePlan, isAiGenerated, aiProgram]);

  const week = useMemo(() => buildWeek(activePlan.schedule, completedWorkoutDates), [activePlan, completedWorkoutDates]);

  // Build today's program — when an AI workout has been pushed from the Coach
  // tab, use it as today's exercise list so both tabs stay in sync.
  const todayProgram = useMemo((): WorkoutProgramDay => {
    const base = activePlan.schedule[todayProgramIndex()] ?? activePlan.schedule[0];
    if (isAiGenerated && aiWorkout) {
      return {
        ...base,
        name: aiWorkout.name,
        badge: 'lift',
        meta: `${aiWorkout.exercises.length} exercises · ${aiWorkout.duration} min${aiWorkout.focus ? ' · ' + aiWorkout.focus : ''}`,
        exercises: aiWorkout.exercises.map((ex, i) => ({
          num: i + 1,
          name: ex.name,
          sets: `${ex.sets} x ${ex.reps}${ex.rest ? ' · Rest ' + ex.rest : ''}`,
          youtubeId: getYoutubeIdForExercise(ex.name, basePlan.schedule.flatMap((d) => d.exercises)),
        })),
      };
    }
    return base;
  }, [activePlan, basePlan, aiWorkout, isAiGenerated]);

  const exercises = useMemo(() => todayProgram.exercises, [todayProgram]);

  const customWorkoutProgram = useMemo<WorkoutProgramDay | null>(() => {
    if (customTodayExs.length === 0) return null;
    return {
      day: 'Custom',
      name: 'Custom Workout',
      badge: 'lift',
      meta: `${customTodayExs.length} exercises · Build your own session`,
      exercises: customTodayExs.map((exercise, index) => ({
        num: index + 1,
        name: exercise.name,
        sets: exercise.sets,
        youtubeId: '',
      })),
    };
  }, [customTodayExs]);

  React.useEffect(() => {
    if (!selectedWorkoutName) {
      setSelectedWorkoutName(todayProgram.name);
      setSelectedExercise(exercises[0]?.name ?? todayProgram.name);
    }
  }, [exercises, selectedExercise, selectedWorkoutName, todayProgram.name]);

  React.useEffect(() => {
    setCompletedWarmupSteps([]);
    setCardioCompleted(false);
    setDoneSets([]);
    setSelectedExerciseIndex(0);
    setSelectedExercise(exercises[0]?.name ?? todayProgram.name);
    setProgressHydrated(false);
  }, [exercises, todayProgram.day, todayProgram.name]);

  const findProgramByName = React.useCallback(
    (name: string) => {
      if (name === 'Custom Workout') {
        return customWorkoutProgram;
      }
      return activePlan.schedule.find((item) => item.name === name) ?? null;
    },
    [activePlan, customWorkoutProgram],
  );

  const findProgramByExerciseName = React.useCallback(
    (exerciseName: string) => {
      if (customWorkoutProgram?.exercises.some((exercise) => exercise.name === exerciseName)) {
        return customWorkoutProgram;
      }
      return activePlan.schedule.find((item) => item.exercises.some((exercise) => exercise.name === exerciseName)) ?? null;
    },
    [activePlan, customWorkoutProgram],
  );

  const getExampleExercises = React.useCallback(
    (workoutName: string) => {
      const program = findProgramByName(workoutName) ?? findProgramByExerciseName(workoutName);
      if (!program) return '';
      return program.exercises.slice(0, 3).map((exercise) => exercise.name).join(' · ');
    },
    [findProgramByExerciseName, findProgramByName],
  );

  const getDefaultExerciseForWorkout = React.useCallback(
    (workoutName: string) => {
      const program = findProgramByName(workoutName) ?? findProgramByExerciseName(workoutName);
      if (!program) return { exerciseName: workoutName, exerciseIndex: -1 };
      return {
        exerciseIndex: 0,
        exerciseName: program.exercises[0]?.name ?? workoutName,
      };
    },
    [findProgramByExerciseName, findProgramByName],
  );

  const getExercisePrescriptionForWorkout = React.useCallback(
    (workoutName: string, exerciseIndex: number, exerciseName?: string) => {
      const program = findProgramByName(workoutName) ?? findProgramByExerciseName(exerciseName ?? workoutName);
      if (!program) {
        return parseExercisePrescription(undefined);
      }

      const selectedByIndex =
        exerciseIndex >= 0 ? program.exercises[exerciseIndex] : undefined;
      const selectedExerciseDef =
        selectedByIndex ??
        program.exercises.find((exercise) => exercise.name === exerciseName) ??
        program.exercises[0];

      return parseExercisePrescription(selectedExerciseDef?.sets);
    },
    [findProgramByExerciseName, findProgramByName],
  );

  const getNextExerciseInWorkout = React.useCallback(
    (workoutName: string, exerciseIndex: number) => {
      const program = findProgramByName(workoutName) ?? findProgramByExerciseName(workoutName);
      if (!program) return null;
      const nextExercise = program.exercises[exerciseIndex + 1];
      if (!nextExercise) return null;
      return {
        exerciseIndex: exerciseIndex + 1,
        exerciseName: nextExercise.name,
      };
    },
    [findProgramByExerciseName, findProgramByName],
  );

  const getNextIncompleteExercise = React.useCallback(() => {
    return exercises.find((exercise) => !doneSets.includes(exercise.num)) ?? null;
  }, [doneSets, exercises]);

  React.useEffect(() => {
    const loadHistory = async () => {
      if (!session?.user?.id) {
        setHistory([]);
        return;
      }

      const { data } = await supabase
        .from('workouts')
        .select('workout_type, duration_minutes, calories_burned, workout_date')
        .eq('user_id', session.user.id)
        .order('workout_date', { ascending: false })
        .limit(50);

      setHistory(data ?? []);
    };

    loadHistory().catch(() => null);
  }, [session?.user?.id]);

  const weeklyBurn = useMemo(
    () => history.reduce((sum, item) => sum + (item.calories_burned ?? 0), 0),
    [history],
  );

  const todayStr = new Date().toISOString().slice(0, 10);
  const workoutProgressKey = useMemo(() => {
    if (!session?.user?.id) return null;
    return getWorkoutProgressStorageKey(session.user.id, todayStr, todayProgram.name);
  }, [session?.user?.id, todayProgram.name, todayStr]);
  const workoutCompletionKey = useMemo(() => {
    if (!session?.user?.id) return null;
    return getWorkoutCompletionStorageKey(session.user.id, todayStr, todayProgram.name);
  }, [session?.user?.id, todayProgram.name, todayStr]);

  React.useEffect(() => {
    if (!session?.user?.id) {
      setCompletedWorkoutDates(new Set());
      return;
    }

    const keys = activePlan.schedule.map((day, index) =>
      getWorkoutCompletionStorageKey(session.user.id, getWeekDateForIndex(index), day.name),
    );

    AsyncStorage.multiGet(keys)
      .then((rows) => {
        const next = new Set<string>();
        rows.forEach(([key, value], index) => {
          if (value === '1') {
            next.add(getWeekDateForIndex(index));
          }
        });
        setCompletedWorkoutDates(next);
      })
      .catch(() => setCompletedWorkoutDates(new Set()));
  }, [activePlan.schedule, session?.user?.id]);

  React.useEffect(() => {
    if (!workoutProgressKey) {
      setProgressHydrated(true);
      return;
    }

    let cancelled = false;
    AsyncStorage.getItem(workoutProgressKey)
      .then((raw) => {
        if (cancelled) return;
        if (!raw) {
          setProgressHydrated(true);
          return;
        }

        const parsed = JSON.parse(raw) as {
          cardioCompleted?: boolean;
          completedWarmupSteps?: number[];
          doneSets?: number[];
          selectedExercise?: string;
          selectedExerciseIndex?: number;
          selectedWorkoutName?: string;
        };

        setDoneSets(parsed.doneSets ?? []);
        setCompletedWarmupSteps(parsed.completedWarmupSteps ?? []);
        setCardioCompleted(Boolean(parsed.cardioCompleted));
        setSelectedWorkoutName(parsed.selectedWorkoutName ?? todayProgram.name);
        setSelectedExerciseIndex(parsed.selectedExerciseIndex ?? 0);
        setSelectedExercise(parsed.selectedExercise ?? exercises[parsed.selectedExerciseIndex ?? 0]?.name ?? exercises[0]?.name ?? todayProgram.name);
        setProgressHydrated(true);
      })
      .catch(() => setProgressHydrated(true));

    return () => {
      cancelled = true;
    };
  }, [exercises, todayProgram.name, workoutProgressKey]);

  React.useEffect(() => {
    if (!workoutProgressKey || !progressHydrated) {
      return;
    }

    AsyncStorage.setItem(
      workoutProgressKey,
      JSON.stringify({
        cardioCompleted,
        completedWarmupSteps,
        doneSets,
        selectedExercise,
        selectedExerciseIndex,
        selectedWorkoutName,
      }),
    ).catch(() => null);
  }, [
    cardioCompleted,
    completedWarmupSteps,
    doneSets,
    progressHydrated,
    selectedExercise,
    selectedExerciseIndex,
    selectedWorkoutName,
    workoutProgressKey,
  ]);

  const todayLogged = useMemo(
    () => history.some((h) => h.workout_date?.slice(0, 10) === todayStr),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, todayStr],
  );

  const isWorkoutFlowComplete = useMemo(() => {
    const activeDayRequiresWarmup = todayProgram.badge !== 'rest';
    const activeDayRequiresCardio = todayProgram.badge !== 'rest';
    const allExercisesDone = exercises.length > 0 && exercises.every((exercise) => doneSets.includes(exercise.num));

    return (
      (!activeDayRequiresWarmup || completedWarmupSteps.length === WARMUP_STEPS.length) &&
      allExercisesDone &&
      (!activeDayRequiresCardio || cardioCompleted)
    );
  }, [cardioCompleted, completedWarmupSteps.length, doneSets, exercises, todayProgram.badge]);

  const todayHasProgress = useMemo(() => {
    const hasLoggedSets = Object.values(todayExerciseLogCounts).some((count) => count > 0);
    return completedWarmupSteps.length > 0 || doneSets.length > 0 || cardioCompleted || hasLoggedSets || todayLogged;
  }, [cardioCompleted, completedWarmupSteps.length, doneSets.length, todayExerciseLogCounts, todayLogged]);

  const todayWeekState = useMemo<'complete' | 'in_progress' | 'not_started'>(() => {
    if (isWorkoutFlowComplete) return 'complete';
    if (todayHasProgress) return 'in_progress';
    return 'not_started';
  }, [isWorkoutFlowComplete, todayHasProgress]);

  React.useEffect(() => {
    if (!workoutProgressKey || !workoutCompletionKey || !session?.user?.id) {
      return;
    }
    if (!isWorkoutFlowComplete) {
      AsyncStorage.removeItem(workoutCompletionKey).catch(() => null);
      return;
    }

    AsyncStorage.setItem(workoutCompletionKey, '1').catch(() => null);
    AsyncStorage.removeItem(workoutProgressKey).catch(() => null);
    setCompletedWorkoutDates((prev) => {
      const next = new Set(prev);
      next.add(todayStr);
      return next;
    });
  }, [isWorkoutFlowComplete, session?.user?.id, todayStr, workoutCompletionKey, workoutProgressKey]);

  // Show today's workout first, then upcoming, then past days
  const sortedWeek = useMemo(() => {
    const order: Record<DayStatus, number> = { today: 0, upcoming: 1, rest: 2, done: 3 };
    return [...week].sort((a, b) => order[a.status] - order[b.status]);
  }, [week]);
  const weeklyManualRows = useMemo(() => sortedWeek, [sortedWeek]);

  const toggleDone = (num: number) => {
    handleToggleDone(num).catch(() => null);
  };

  const openLog = (exerciseName: string) => {
    const program = findProgramByExerciseName(exerciseName) ?? todayProgram;
    const exerciseIndex = program.exercises.findIndex((exercise) => exercise.name === exerciseName);
    const prescription = getExercisePrescriptionForWorkout(program.name, exerciseIndex, exerciseName);
    setSelectedWorkoutName(program.name);
    setSelectedExerciseIndex(exerciseIndex);
    setSelectedExercise(exerciseName);
    setDurationMinutes('12');
    setCaloriesBurned(isPro ? '120' : '');
    setInitialSets(prescription.setCount);
    setInitialReps(prescription.reps);
    setCurrentLoggedExerciseName(exerciseName);
    setCurrentExerciseLogSets([]);
    setLogVisible(true);
    refreshLastSessionForExercise(exerciseName).catch(() => setLastSession(null));
    refreshCurrentExerciseLogSets(exerciseName).catch(() => {
      setCurrentLoggedExerciseName(exerciseName);
      setCurrentExerciseLogSets([]);
    });
  };

  const openManualWorkoutLog = async () => {
    await Haptics.selectionAsync();
    const next = getDefaultExerciseForWorkout(todayProgram.name);
    const prescription = getExercisePrescriptionForWorkout(todayProgram.name, next.exerciseIndex, next.exerciseName);
    setSelectedWorkoutName(todayProgram.name);
    setSelectedExerciseIndex(next.exerciseIndex);
    setSelectedExercise(next.exerciseName);
    setDurationMinutes('12');
    setCaloriesBurned(isPro ? '120' : '');
    setInitialSets(prescription.setCount);
    setInitialReps(prescription.reps);
    setCurrentLoggedExerciseName(next.exerciseName);
    setCurrentExerciseLogSets([]);
    setLogVisible(true);
    refreshLastSessionForExercise(next.exerciseName).catch(() => setLastSession(null));
    refreshCurrentExerciseLogSets(next.exerciseName).catch(() => {
      setCurrentLoggedExerciseName(next.exerciseName);
      setCurrentExerciseLogSets([]);
    });
  };

  const openManualWorkoutLogForDay = async (dayName: string) => {
    await Haptics.selectionAsync();
    const next = getDefaultExerciseForWorkout(dayName);
    const prescription = getExercisePrescriptionForWorkout(dayName, next.exerciseIndex, next.exerciseName);
    setSelectedWorkoutName(dayName);
    setSelectedExerciseIndex(next.exerciseIndex);
    setSelectedExercise(next.exerciseName);
    setDurationMinutes('12');
    setCaloriesBurned(isPro ? '120' : '');
    setInitialSets(prescription.setCount);
    setInitialReps(prescription.reps);
    setCurrentLoggedExerciseName(next.exerciseName);
    setCurrentExerciseLogSets([]);
    setLogVisible(true);
    refreshLastSessionForExercise(next.exerciseName).catch(() => setLastSession(null));
    refreshCurrentExerciseLogSets(next.exerciseName).catch(() => {
      setCurrentLoggedExerciseName(next.exerciseName);
      setCurrentExerciseLogSets([]);
    });
  };

  const resetLogFields = () => {
    const prescription = getExercisePrescriptionForWorkout(selectedWorkoutName, selectedExerciseIndex, selectedExercise);
    setDurationMinutes('12');
    setCaloriesBurned(isPro ? '120' : '');
    setInitialSets(prescription.setCount);
    setInitialReps(prescription.reps);
  };

  const resolveStoredExerciseKey = React.useCallback(async (prefix: string, exerciseName: string) => {
    const normalizedExerciseName = normalizeExerciseLookup(exerciseName);
    if (!normalizedExerciseName) return null;

    const exactKey = `${prefix}${exerciseName}`;
    const exactValue = await AsyncStorage.getItem(exactKey).catch(() => null);
    if (exactValue) {
      return { key: exactKey, value: exactValue };
    }

    const keys = await AsyncStorage.getAllKeys().catch(() => [] as string[]);
    const matchingKey = keys.find((key) => {
      if (!key.startsWith(prefix)) return false;
      const suffix = key.slice(prefix.length);
      return normalizeExerciseLookup(suffix) === normalizedExerciseName;
    });
    if (!matchingKey) return null;

    const matchingValue = await AsyncStorage.getItem(matchingKey).catch(() => null);
    if (!matchingValue) return null;

    return { key: matchingKey, value: matchingValue };
  }, []);

  const getCurrentExerciseRestSeconds = React.useCallback(() => {
    if (restTimerSeconds > 0) {
      return restTimerSeconds;
    }

    if (lastSession?.sets?.length) {
      const nextRest = [...lastSession.sets]
        .reverse()
        .map((set) => Number(set.restSeconds ?? 0))
        .find((seconds) => seconds > 0);
      if (nextRest) {
        return nextRest;
      }
    }

    return 90;
  }, [lastSession?.sets, restTimerSeconds]);

  const refreshLastSessionForExercise = React.useCallback(async (exerciseName: string) => {
    const resolved = await resolveStoredExerciseKey('@apex_last_', exerciseName);
    setLastSession(resolved?.value ? JSON.parse(resolved.value) : null);
  }, [resolveStoredExerciseKey]);

  const refreshCurrentExerciseLogSets = React.useCallback(async (exerciseName: string) => {
    const workoutDate = new Date().toISOString().slice(0, 10);
    const resolved = await resolveStoredExerciseKey(`@apex_sets_${workoutDate}_`, exerciseName);
    const raw = resolved?.value ?? null;
    setCurrentLoggedExerciseName(exerciseName);
    setCurrentExerciseLogSets(raw ? (JSON.parse(raw) as SetEntry[]) : []);
  }, [resolveStoredExerciseKey]);

  React.useEffect(() => {
    if (!logVisible) return;

    const typedExerciseName = selectedExercise.trim();
    if (!typedExerciseName) {
      setLastSession(null);
      setCurrentLoggedExerciseName(null);
      setCurrentExerciseLogSets([]);
      return;
    }

    refreshLastSessionForExercise(typedExerciseName).catch(() => setLastSession(null));
    refreshCurrentExerciseLogSets(typedExerciseName).catch(() => {
      setCurrentLoggedExerciseName(typedExerciseName);
      setCurrentExerciseLogSets([]);
    });
  }, [logVisible, refreshCurrentExerciseLogSets, refreshLastSessionForExercise, selectedExercise]);

  const openCustomWorkoutLog = React.useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    const firstCustomExercise = customWorkoutProgram?.exercises[0];
    const initialExerciseName = firstCustomExercise?.name ?? 'Custom Exercise';
    const initialExerciseIndex = firstCustomExercise ? 0 : -1;
    const initialPrescription = parseExercisePrescription(firstCustomExercise?.sets);
    setSelectedWorkoutName('Custom Workout');
    setSelectedExercise(initialExerciseName);
    setSelectedExerciseIndex(initialExerciseIndex);
    setInitialSets(initialPrescription.setCount);
    setInitialReps(initialPrescription.reps);
    setDurationMinutes('45');
    setCaloriesBurned(isPro ? '120' : '');
    setCurrentLoggedExerciseName(initialExerciseName);
    setCurrentExerciseLogSets([]);
    setLogVisible(true);
    refreshLastSessionForExercise(initialExerciseName).catch(() => setLastSession(null));
    refreshCurrentExerciseLogSets(initialExerciseName).catch(() => {
      setCurrentLoggedExerciseName(initialExerciseName);
      setCurrentExerciseLogSets([]);
    });
  }, [customWorkoutProgram, isPro, refreshCurrentExerciseLogSets, refreshLastSessionForExercise]);

  const refreshTodayExerciseLogCounts = React.useCallback(async () => {
    const workoutDate = new Date().toISOString().slice(0, 10);
    const exerciseNames = Array.from(new Set(exercises.map((exercise) => exercise.name)));
    const keys = exerciseNames.map((name) => `@apex_sets_${workoutDate}_${name}`);
    const rows = await AsyncStorage.multiGet(keys).catch(() => [] as [string, string | null][]);
    const nextCounts = exerciseNames.reduce<Record<string, number>>((acc, name) => {
      acc[name] = 0;
      return acc;
    }, {});

    const nextSets: Record<string, SetEntry[]> = {};
    rows.forEach(([key, value]) => {
      const match = key.match(/^@apex_sets_\d{4}-\d{2}-\d{2}_(.+)$/);
      const exerciseName = match?.[1];
      if (!exerciseName) return;
      try {
        const parsed = value ? (JSON.parse(value) as SetEntry[]) : [];
        nextCounts[exerciseName] = parsed.filter((entry) => entry.reps?.trim() || entry.weightLbs?.trim()).length;
        nextSets[exerciseName] = parsed;
      } catch {
        nextCounts[exerciseName] = 0;
      }
    });

    setTodayExerciseLogCounts(nextCounts);
    setTodayExerciseSets(nextSets);
  }, [exercises]);

  React.useEffect(() => {
    refreshTodayExerciseLogCounts().catch(() => null);
  }, [refreshTodayExerciseLogCounts, progressHydrated]);

  const persistStructuredVoiceWorkoutLog = React.useCallback(async (input: {
    cardio?: boolean;
    exerciseName?: string;
    explicitlyMarkedComplete?: boolean;
    markComplete?: boolean;
    reps?: string;
    sameWeight?: boolean;
    setCount?: number;
    setIndex?: number;
    warmup?: boolean;
    wantsNext?: boolean;
    weightLbs?: string;
  }) => {
    if (!session?.user?.id) {
      return null;
    }

    const warmupOutstanding = todayProgram.badge !== 'rest' && completedWarmupSteps.length < WARMUP_STEPS.length;
    const currentExercise = exercises[selectedExerciseIndex] ?? exercises[0];
    const currentPrescription = parseExercisePrescription(currentExercise?.sets);
    const workoutDate = new Date().toISOString().slice(0, 10);
    const resolvedExerciseName =
      input.exerciseName?.trim() ||
      currentExercise?.name ||
      selectedExercise ||
      todayProgram.name;
    const exerciseName = input.warmup || warmupOutstanding
      ? 'Warm Up'
      : input.cardio
        ? 'Cardio Finisher'
        : resolvedExerciseName;
    const reps = input.reps ?? currentPrescription.reps;
    const inferredSetCount =
      input.setCount ??
      (input.reps || input.weightLbs ? 1 : currentPrescription.setCount);
    const setCount = Math.min(Math.max(inferredSetCount, 1), 8);
    const explicitSetIndex = input.setIndex && input.setIndex > 0
      ? Math.min(input.setIndex, 8)
      : undefined;
    const weightLbs = input.weightLbs ?? '';
    const duration = input.warmup ? 5 : input.cardio ? 15 : 12;
    const estimatedCalories = input.warmup ? 30 : input.cardio ? 140 : 80;
    const createdSetEntries = Array.from({ length: setCount }, () => ({
      reps,
      restSeconds: input.cardio ? '60' : '90',
      setType: 'straight' as const,
      weightLbs,
    }));

    const setsKey = `@apex_sets_${workoutDate}_${exerciseName}`;
    const existingRaw = await AsyncStorage.getItem(setsKey).catch(() => null);
    const existing = existingRaw ? (JSON.parse(existingRaw) as SetEntry[]) : [];
    const fallbackLoggedWeight =
      [...existing]
        .reverse()
        .find((entry) => entry.weightLbs?.trim())?.weightLbs?.trim() ||
      [...(lastSession?.sets ?? [])]
        .reverse()
        .find((entry) => entry.weightLbs?.trim())?.weightLbs?.trim() ||
      '';
    const resolvedWeightLbs = weightLbs || (input.sameWeight ? fallbackLoggedWeight : '');
    let mergedSets = [...existing];

    const isSingleSetVoiceLog =
      !input.cardio &&
      !input.warmup &&
      !warmupOutstanding &&
      setCount === 1 &&
      Boolean(input.reps || input.weightLbs || explicitSetIndex);

    if (isSingleSetVoiceLog) {
      const targetIndex =
        explicitSetIndex != null
          ? explicitSetIndex - 1
          : Math.min(existing.length, Math.max(currentPrescription.setCount - 1, 0));
      const entry = createdSetEntries[0];
      if (targetIndex >= mergedSets.length) {
        while (mergedSets.length < targetIndex) {
          mergedSets.push({
            reps: currentPrescription.reps,
            restSeconds: input.cardio ? '60' : '90',
            setType: 'straight',
            weightLbs: '',
          });
        }
        mergedSets.push({
          ...entry,
          weightLbs: resolvedWeightLbs,
        });
      } else {
        mergedSets[targetIndex] = {
          ...mergedSets[targetIndex],
          reps: entry.reps || mergedSets[targetIndex]?.reps || currentPrescription.reps,
          restSeconds: entry.restSeconds || mergedSets[targetIndex]?.restSeconds || '90',
          setType: entry.setType || mergedSets[targetIndex]?.setType || 'straight',
          weightLbs: resolvedWeightLbs || mergedSets[targetIndex]?.weightLbs || '',
        };
      }
    } else {
      mergedSets = [
        ...existing,
        ...createdSetEntries.map((entry) => ({
          ...entry,
          weightLbs: resolvedWeightLbs || entry.weightLbs,
        })),
      ];
    }
    await AsyncStorage.setItem(setsKey, JSON.stringify(mergedSets)).catch(() => null);
    await AsyncStorage.setItem(
      `@apex_last_${exerciseName}`,
      JSON.stringify({ date: workoutDate, sets: mergedSets }),
    ).catch(() => null);
    setCurrentLoggedExerciseName(exerciseName);
    setCurrentExerciseLogSets(mergedSets);
    setTodayExerciseLogCounts((prev) => ({
      ...prev,
      [exerciseName]: mergedSets.filter((entry) => entry.reps?.trim() || entry.weightLbs?.trim()).length,
    }));
    setTodayExerciseSets((prev) => ({ ...prev, [exerciseName]: mergedSets }));

    const { error } = await supabase.from('workouts').insert({
      calories_burned: estimatedCalories,
      duration,
      duration_minutes: duration,
      type: exerciseName,
      user_id: session.user.id,
      workout_date: workoutDate,
      workout_type: exerciseName,
    });

    if (error) {
      throw error;
    }

    const savedRow = {
      calories_burned: estimatedCalories,
      duration_minutes: duration,
      workout_date: workoutDate,
      workout_type: exerciseName,
    };

    setHistory((prev) => [savedRow, ...prev].slice(0, 5));

    if (input.warmup) {
      setCompletedWarmupSteps(WARMUP_STEPS.map((_, index) => index));
    } else if (warmupOutstanding && (input.markComplete || input.wantsNext)) {
      setCompletedWarmupSteps((prev) => {
        const nextIncomplete = WARMUP_STEPS.findIndex((_, index) => !prev.includes(index));
        if (nextIncomplete === -1) return prev;
        return [...prev, nextIncomplete].sort((a, b) => a - b);
      });
    }

    if (input.cardio) {
      setCardioCompleted(true);
    }

    await refreshLastSessionForExercise(exerciseName);

    if (
      !input.warmup &&
      !warmupOutstanding &&
      !input.cardio &&
      currentExercise?.num &&
      (input.explicitlyMarkedComplete || input.wantsNext)
    ) {
      setDoneSets((prev) => (prev.includes(currentExercise.num) ? prev : [...prev, currentExercise.num]));

      if (input.wantsNext) {
        const nextExercise = getNextExerciseInWorkout(selectedWorkoutName, selectedExerciseIndex);
        if (nextExercise) {
          setSelectedExerciseIndex(nextExercise.exerciseIndex);
          setSelectedExercise(nextExercise.exerciseName);
        }
      }
    }

    const nextExerciseName = getNextExerciseInWorkout(selectedWorkoutName, selectedExerciseIndex)?.exerciseName;
    const summary = input.cardio
      ? 'Cardio logged. Session wrapped up strong.'
      : input.warmup
        ? `Warm-up is done. Next is ${currentExercise?.name ?? nextExerciseName ?? 'your first exercise'}.`
        : warmupOutstanding
          ? completedWarmupSteps.length + 1 >= WARMUP_STEPS.length
            ? `Warm-up is done. Next is ${currentExercise?.name ?? nextExerciseName ?? 'your first exercise'}.`
            : `Warm-up step logged. Keep moving, then we go to ${currentExercise?.name ?? 'your first exercise'}.`
        : input.wantsNext
          ? `Logged. Next is ${nextExerciseName ?? 'up next'}.`
          : input.explicitlyMarkedComplete
            ? `${exerciseName} is marked complete.`
          : explicitSetIndex
            ? `Logged set ${explicitSetIndex} at ${resolvedWeightLbs ? `${resolvedWeightLbs} lbs` : 'bodyweight'} for ${reps} reps.`
          : resolvedWeightLbs
          ? `Logged ${setCount} set${setCount > 1 ? 's' : ''} of ${reps} at ${resolvedWeightLbs} pounds for ${exerciseName}.`
            : `Logged ${setCount} set${setCount > 1 ? 's' : ''} of ${reps} for ${exerciseName}.`;

    return summary;
  }, [
    completedWarmupSteps.length,
    exercises,
    getNextExerciseInWorkout,
    lastSession?.sets,
    selectedExercise,
    selectedExerciseIndex,
    selectedWorkoutName,
    session?.user?.id,
    todayProgram.badge,
    todayProgram.name,
  ]);

  const persistVoiceWorkoutLog = React.useCallback(async (prompt: string) => {
    const command = parseWorkoutCoachCommand(prompt);
    if (!command) {
      return null;
    }

    if (command.requestedRestSeconds && [30, 60, 90, 120].includes(command.requestedRestSeconds)) {
      setRestTimerSeconds(command.requestedRestSeconds);
      return `Rest timer set for ${command.requestedRestSeconds} seconds.`;
    }

    const warmupOutstanding = todayProgram.badge !== 'rest' && completedWarmupSteps.length < WARMUP_STEPS.length;
    const currentExercise = exercises[selectedExerciseIndex] ?? exercises[0];
    if (command.swapExercise) {
      const swap = findExerciseSwapSuggestion(prompt);
      if (swap && currentExercise) {
        const updatedExercises = exercises.map((exercise, index) =>
          index === selectedExerciseIndex
            ? {
                ...exercise,
                name: swap.name,
                sets: swap.defaultSets,
                youtubeId: swap.youtubeId,
              }
            : exercise,
        );
        const nextProgram = {
          ...todayProgram,
          exercises: updatedExercises,
        };

        const coachSwapWorkout: AIWorkout = {
          name: nextProgram.name,
          duration: 30,
          focus: nextProgram.meta,
          coachNote: `Swapped ${currentExercise.name} for ${swap.name}.`,
          generatedAt: new Date().toISOString(),
          exercises: updatedExercises.map((exercise) => ({
            name: exercise.name,
            reps: exercise.sets.split(' x ')[1] ?? exercise.sets,
            rest: '90s',
            sets: Number(exercise.sets.split(' x ')[0]) || 3,
          })),
        };

        await saveAIWorkout(coachSwapWorkout).catch(() => null);
        setSelectedExercise(swap.name);
        await refreshLastSessionForExercise(swap.name);
        return `Swapped it. Do ${swap.name} instead.`;
      }
    }

    return persistStructuredVoiceWorkoutLog({
      cardio: command.cardio,
      explicitlyMarkedComplete: command.explicitlyMarkedComplete,
      markComplete: command.markComplete || command.logOnly,
      reps: command.reps,
      sameWeight: command.sameWeight,
      setCount: command.setCount,
      setIndex: command.setIndex,
      warmup: command.warmup,
      wantsNext: command.wantsNext,
      weightLbs: command.weightLbs,
    });
  }, [
    completedWarmupSteps.length,
    exercises,
    persistStructuredVoiceWorkoutLog,
    refreshLastSessionForExercise,
    selectedExerciseIndex,
    todayProgram.badge,
    todayProgram.meta,
    todayProgram.name,
  ]);

  const handleGenerateWorkoutDemo = React.useCallback(async (exerciseName: string, exerciseSets?: string) => {
    if (!exerciseName || workoutDemoLoading) return;

    const currentExercise = exercises.find((exercise) => exercise.name === exerciseName) ?? exercises[selectedExerciseIndex] ?? exercises[0];
    const resolvedExerciseName = currentExercise?.name === exerciseName ? currentExercise.name : exerciseName;
    const resolvedExerciseSets =
      (currentExercise?.name === exerciseName ? currentExercise.sets : undefined) ??
      exerciseSets ??
      'Use programmed sets and reps';
    const coachLabel = selectedCoachVoice?.label ?? 'Coach Josh';
    const demoCacheKey = getWorkoutDemoCacheKey(coachLabel, resolvedExerciseName);
    const fallbackDemo = buildCoachFallbackDemo(
      resolvedExerciseName,
      resolvedExerciseSets,
      selectedCoachVoice,
    );
    const warmupContext = todayProgram.badge !== 'rest'
      ? WARMUP_STEPS.map((step) => `${step.label} (${step.detail})`).join('; ')
      : 'none';
    const cardioContext = todayProgram.badge !== 'rest'
      ? getCardioOptions(activePlanId).map((option) => `${option.label} (${option.detail})`).join('; ')
      : 'none';

    setWorkoutDemoLoading(true);
    setWorkoutDemoExercise(resolvedExerciseName);
    setWorkoutDemoExerciseSets(resolvedExerciseSets);
    try {
      const approvedVideo = await getApprovedDemoAsset(coachLabel, resolvedExerciseName, 'video').catch(() => null);
      if (approvedVideo?.videoUrl) {
        const approvedDemo: WorkoutDemoResult = {
          ...fallbackDemo,
          headline: `${resolvedExerciseName} with ${coachLabel}`,
          videoStatus: 'ready',
          videoUrl: approvedVideo.videoUrl,
        };
        setWorkoutDemo(approvedDemo);
        await AsyncStorage.setItem(demoCacheKey, JSON.stringify(approvedDemo)).catch(() => null);
        return;
      }

      const approvedReference = await getApprovedDemoAsset(coachLabel, resolvedExerciseName, 'reference').catch(() => null);
      const cached = await AsyncStorage.getItem(demoCacheKey).catch(() => null);
      if (cached) {
        const parsedCached = JSON.parse(cached) as WorkoutDemoResult;
        if (parsedCached.videoUrl) {
          setWorkoutDemo({
            ...fallbackDemo,
            ...parsedCached,
            videoStatus: 'ready',
          });
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke('workout-demo', {
        body: {
          exerciseName: resolvedExerciseName,
          exerciseSets: resolvedExerciseSets,
          coachPersona: coachLabel,
          coachPersonaPrompt: selectedCoachVoice?.persona ?? '',
          planTitle: activePlan.title,
          todayWorkout: todayProgram.name,
          referenceImageUrl: approvedReference?.imageUrl ?? null,
          warmup: warmupContext,
          cardio: cardioContext,
        },
      });

      if (error) throw error;

      const rawCameraPlan = (data as { cameraPlan?: string[] | string }).cameraPlan;
      const normalizedCameraPlan = Array.isArray(rawCameraPlan)
        ? rawCameraPlan.filter(Boolean).join(' • ')
        : String(rawCameraPlan ?? '').trim();

      const nextDemo: WorkoutDemoResult = {
        cameraPlan: normalizedCameraPlan || fallbackDemo.cameraPlan,
        demoScript: String((data as { demoScript?: string }).demoScript ?? fallbackDemo.demoScript),
        generationPrompt: String((data as { generationPrompt?: string }).generationPrompt ?? fallbackDemo.generationPrompt ?? ''),
        headline: String((data as { headline?: string }).headline ?? fallbackDemo.headline),
        videoRequestId: (data as { video_request_id?: string | null }).video_request_id ?? null,
        videoStatus: (data as { video_status?: WorkoutDemoResult['videoStatus'] }).video_status ?? undefined,
        videoUrl: (data as { video_url?: string | null }).video_url ?? null,
      };

      setWorkoutDemo(nextDemo);
      if (nextDemo.videoUrl) {
        await AsyncStorage.setItem(demoCacheKey, JSON.stringify(nextDemo)).catch(() => null);
        supabase.functions.invoke('demo-reference-studio', {
          body: {
            action: 'save_video',
            coachLabel,
            exerciseName: resolvedExerciseName,
            videoUrl: nextDemo.videoUrl,
            prompt: nextDemo.generationPrompt ?? fallbackDemo.generationPrompt ?? '',
            metadata: {
              source: 'train-ai-demo',
            },
          },
        }).catch(() => null);
      }
      if (nextDemo.videoUrl) {
        await Linking.openURL(nextDemo.videoUrl);
      }
    } catch {
      setWorkoutDemo(fallbackDemo);
    } finally {
      setWorkoutDemoLoading(false);
    }
  }, [
    activePlan.title,
    activePlanId,
    exercises,
    selectedCoachVoice,
    selectedExerciseIndex,
    todayProgram.badge,
    todayProgram.name,
    workoutDemoLoading,
  ]);

  const handleOpenSavedWorkoutDemo = React.useCallback(async (exerciseName: string, exerciseSets?: string) => {
    const currentExercise = exercises.find((exercise) => exercise.name === exerciseName) ?? exercises[selectedExerciseIndex] ?? exercises[0];
    const resolvedExerciseName = currentExercise?.name === exerciseName ? currentExercise.name : exerciseName;
    const resolvedExerciseSets =
      (currentExercise?.name === exerciseName ? currentExercise.sets : undefined) ??
      exerciseSets ??
      'Use programmed sets and reps';
    const coachLabel = selectedCoachVoice?.label ?? 'Coach Josh';
    const approvedVideo = await getApprovedDemoAsset(coachLabel, resolvedExerciseName, 'video').catch(() => null);
    if (approvedVideo?.videoUrl) {
      setVideoUrl(approvedVideo.videoUrl);
      setVideoId(null);
      setVideoTitle(`${resolvedExerciseName} with ${coachLabel}`);
      setWorkoutDemoExercise(resolvedExerciseName);
      setWorkoutDemoExerciseSets(resolvedExerciseSets);
      return true;
    }

    const demoCacheKey = getWorkoutDemoCacheKey(coachLabel, resolvedExerciseName);
    const cached = await AsyncStorage.getItem(demoCacheKey).catch(() => null);
    if (!cached) {
      return false;
    }

    try {
      const parsedCached = JSON.parse(cached) as WorkoutDemoResult;
      if (parsedCached.videoUrl) {
        setVideoUrl(parsedCached.videoUrl);
        setVideoId(null);
        setVideoTitle(parsedCached.headline || `${resolvedExerciseName} with ${coachLabel}`);
        setWorkoutDemoExercise(resolvedExerciseName);
        setWorkoutDemoExerciseSets(resolvedExerciseSets);
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }, [exercises, selectedCoachVoice, selectedExerciseIndex]);

  React.useEffect(() => {
    if (workoutDemoPollRef.current) {
      clearTimeout(workoutDemoPollRef.current);
      workoutDemoPollRef.current = null;
    }

    if (!workoutDemo?.videoRequestId || workoutDemo.videoUrl || workoutDemo.videoStatus !== 'queued') {
      return;
    }

    workoutDemoPollRef.current = setTimeout(() => {
      supabase.functions.invoke('workout-demo', {
        body: {
          exerciseName: workoutDemoExercise,
          exerciseSets: workoutDemoExerciseSets,
          coachPersona: selectedCoachVoice?.label ?? 'Coach Josh',
          coachPersonaPrompt: selectedCoachVoice?.persona ?? '',
          videoRequestId: workoutDemo.videoRequestId,
        },
      }).then(({ data, error }) => {
        if (error) return;
        setWorkoutDemo((current) => {
          if (!current) return current;
          const nextVideoUrl = (data as { video_url?: string | null }).video_url ?? current.videoUrl ?? null;
          const nextVideoStatus = (data as { video_status?: WorkoutDemoResult['videoStatus'] }).video_status ?? current.videoStatus;
          const nextVideoRequestId = (data as { video_request_id?: string | null }).video_request_id ?? current.videoRequestId ?? null;
          return {
            ...current,
            videoRequestId: nextVideoRequestId,
            videoStatus: nextVideoStatus,
            videoUrl: nextVideoUrl,
          };
        });
        const nextVideoUrl = (data as { video_url?: string | null }).video_url ?? null;
        if (nextVideoUrl) {
          const coachLabel = selectedCoachVoice?.label ?? 'Coach Josh';
          const cacheKey = getWorkoutDemoCacheKey(coachLabel, workoutDemoExercise);
          AsyncStorage.setItem(
            cacheKey,
            JSON.stringify({
              ...workoutDemo,
              videoRequestId: (data as { video_request_id?: string | null }).video_request_id ?? workoutDemo?.videoRequestId ?? null,
              videoStatus: 'ready',
              videoUrl: nextVideoUrl,
            }),
          ).catch(() => null);
          supabase.functions.invoke('demo-reference-studio', {
            body: {
              action: 'save_video',
              coachLabel,
              exerciseName: workoutDemoExercise,
              videoUrl: nextVideoUrl,
              prompt: workoutDemo?.generationPrompt ?? '',
              metadata: {
                source: 'train-ai-demo-poll',
              },
            },
          }).catch(() => null);
        }
      }).catch(() => null);
    }, 5000);

    return () => {
      if (workoutDemoPollRef.current) {
        clearTimeout(workoutDemoPollRef.current);
        workoutDemoPollRef.current = null;
      }
    };
  }, [selectedCoachVoice, workoutDemo, workoutDemoExercise, workoutDemoExerciseSets]);

  React.useEffect(() => {
    if (!workoutDemo || workoutDemo.videoUrl) {
      coachDemoPulse.stopAnimation();
      coachDemoPulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(coachDemoPulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(coachDemoPulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
      coachDemoPulse.stopAnimation();
      coachDemoPulse.setValue(0);
    };
  }, [coachDemoPulse, workoutDemo]);

  const buildRealtimeWorkoutContext = React.useCallback(() => {
    const warmupOutstanding = todayProgram.badge !== 'rest' && completedWarmupSteps.length < WARMUP_STEPS.length;
    const currentExercise = exercises[selectedExerciseIndex] ?? exercises[0];
    const currentWarmupStep = WARMUP_STEPS[completedWarmupSteps.length];
    const currentCoachTarget = warmupOutstanding
      ? { name: currentWarmupStep?.label ?? 'Warm-up', sets: '5 min · Dynamic · Before every session' }
      : currentExercise;
    const completedExercises = exercises
      .filter((exercise) => doneSets.includes(exercise.num))
      .map((exercise) => `${exercise.name} (${exercise.sets})`);
    const remainingExercises = exercises
      .filter((exercise) => !doneSets.includes(exercise.num))
      .map((exercise) => `${exercise.name} (${exercise.sets})`);
    const warmupContext = WARMUP_STEPS
      .map((step) => `${step.label} (${step.detail})`)
      .join('; ');
    const cardioContext = getCardioOptions(activePlanId)
      .map((option) => `${option.label} (${option.detail})`)
      .join('; ');
    const targets = profile
      ? {
          calories: profile.dailyCalorieTarget ?? 0,
          protein: profile.dailyProtein ?? 0,
          carbs: profile.dailyCarbs ?? 0,
          fat: profile.dailyFat ?? 0,
        }
      : { calories: 0, protein: 0, carbs: 0, fat: 0 };

    const loggedSetLines = Object.entries(todayExerciseSets)
      .filter(([, sets]) => sets.some((s) => s.reps?.trim() || s.weightLbs?.trim()))
      .map(([name, sets]) => {
        const detail = sets
          .filter((s) => s.reps?.trim() || s.weightLbs?.trim())
          .map((s, i) => {
            const weight = s.weightLbs?.trim() ? `${s.weightLbs} lbs × ` : '';
            return `Set ${i + 1}: ${weight}${s.reps} reps`;
          })
          .join(', ');
        return `  ${name}: ${detail}`;
      })
      .join('\n');

    return `ACTIVE WORKOUT CONTEXT
- User: ${profile?.displayName ?? 'Athlete'}
- Goal: ${profile?.goal ?? 'recomp'}
- Experience: ${profile?.experience ?? 'intermediate'}
- Active plan: ${activePlan.title}
- Today's workout: ${todayProgram.name}
- Today's session timer: ${voice.sessionTimeStr}
- Current exercise: ${(currentCoachTarget?.name ?? selectedExercise) || todayProgram.name}
- First main exercise: ${exercises[selectedExerciseIndex]?.name ?? exercises[0]?.name ?? 'see remaining exercises'}
- Exercise sequence: ${exercises.map((ex, i) => `${i + 1}. ${ex.name}`).join('; ')}
- Current exercise prescription: ${currentCoachTarget?.sets ?? 'Use current plan guidance'}
- Warm-up status: ${todayProgram.badge !== 'rest' ? `${completedWarmupSteps.length}/${WARMUP_STEPS.length} steps done` : 'none'}
- Warm-up today: ${todayProgram.badge !== 'rest' ? warmupContext : 'none'}
- Cardio status: ${todayProgram.badge !== 'rest' ? (cardioCompleted ? 'already logged' : 'not logged yet') : 'none'}
- Cardio finisher today: ${todayProgram.badge !== 'rest' ? cardioContext : 'none'}
- Rest timer: ${restTimerSeconds > 0 ? `${restTimerSeconds} seconds left` : `${getCurrentExerciseRestSeconds()} seconds suggested`}
- Completed exercises: ${completedExercises.length > 0 ? completedExercises.join('; ') : 'none yet'}
- Remaining exercises: ${remainingExercises.length > 0 ? remainingExercises.join('; ') : 'none left'}
- Logged sets with weights and reps:\n${loggedSetLines || '  none yet'}
- Daily targets: ${targets.calories} kcal · ${targets.protein}g protein · ${targets.carbs}g carbs · ${targets.fat}g fat
- Food preferences: ${profile?.foodPreferences?.join(', ') || 'none specified'}
- Foods to avoid: ${profile?.foodAvoidances?.trim() || 'none specified'}

COACHING BEHAVIOR — follow these rules at all times:
1. ALWAYS start with the first incomplete item in order: warm-up first, then main exercises, then cardio. Never skip ahead.
2. Before each exercise begins, say 1-2 movement-specific setup cues out loud (e.g. "chest up, belly button tight, push your hips back"). Do this unprompted.
3. REP COUNTING — CRITICAL: When you receive "📷 Rep N just completed", say that rep number out loud IMMEDIATELY. Do NOT wait for the athlete to respond. They are physically lifting and CANNOT speak — silence from them is normal. Just keep calling each rep as it comes: "one!", "two!", "three!" etc. Never stop counting mid-set because the athlete is quiet.
4. After every set (when you receive a rest_start event), speak up: acknowledge the set with energy, ask where they felt it, then ask difficulty 1-10. Use their answer to adjust the next set.
5. CAMERA VISION — CRITICAL: You have real-time visual access to the athlete through the APEX app's integrated computer vision system. When you receive [VISION] messages, those are your direct observations — what you are literally seeing right now. If the athlete asks "can you see me?", your answer is YES: "Yes, I can see you through the APEX camera system." React to [VISION] messages immediately as a coach who is physically watching — call out what you see, correct form, encourage. Never deny having visual access.
6. Be proactive. Drive the session forward. Do not wait for the athlete to initiate — you lead.
7. Keep every reply to one or two short sentences. Sound like a real coach in an earbud, not a chatbot.`;
  }, [
    activePlan.title,
    activePlanId,
    cardioCompleted,
    completedWarmupSteps.length,
    doneSets,
    exercises,
    getCurrentExerciseRestSeconds,
    profile,
    restTimerSeconds,
    selectedExercise,
    selectedExerciseIndex,
    todayExerciseSets,
    todayProgram.badge,
    todayProgram.name,
    voice.sessionTimeStr,
  ]);

  const handleRealtimeWorkoutTool = React.useCallback(async (call: RealtimeWorkoutToolCall): Promise<RealtimeWorkoutToolResult> => {
    switch (call.name) {
      case 'log_set': {
        const message = await persistStructuredVoiceWorkoutLog({
          cardio: Boolean(call.arguments.cardio),
          exerciseName: typeof call.arguments.exerciseName === 'string' ? call.arguments.exerciseName : undefined,
          explicitlyMarkedComplete: call.arguments.markComplete === true,
          markComplete: call.arguments.markComplete === true,
          reps: typeof call.arguments.reps === 'string' ? call.arguments.reps : undefined,
          setCount: typeof call.arguments.setCount === 'number' ? call.arguments.setCount : undefined,
          warmup: Boolean(call.arguments.warmup),
          weightLbs: typeof call.arguments.weightLbs === 'string' ? call.arguments.weightLbs : undefined,
        });
        return { message: message ?? 'Logged it.', ok: true };
      }
      case 'mark_warmup_step': {
        const stepIndex = Number(call.arguments.stepIndex);
        if (!Number.isFinite(stepIndex) || stepIndex < 0 || stepIndex >= WARMUP_STEPS.length) {
          return { message: 'Warm-up step index was invalid.', ok: false };
        }
        const complete = call.arguments.complete !== false;
        setCompletedWarmupSteps((prev) => {
          if (complete) {
            return prev.includes(stepIndex) ? prev : [...prev, stepIndex].sort((a, b) => a - b);
          }
          return prev.filter((item) => item !== stepIndex);
        });
        return { message: `${WARMUP_STEPS[stepIndex]?.label ?? 'Warm-up step'} ${complete ? 'done' : 'reopened'}.`, ok: true };
      }
      case 'mark_cardio_done': {
        const complete = call.arguments.complete !== false;
        setCardioCompleted(complete);
        return { message: complete ? 'Cardio marked complete.' : 'Cardio marked incomplete.', ok: true };
      }
      case 'move_to_next_exercise': {
        const nextExercise = getNextExerciseInWorkout(selectedWorkoutName, selectedExerciseIndex);
        if (!nextExercise) {
          return { message: 'No next exercise left in this workout.', ok: false };
        }
        const currentExerciseNum = exercises[selectedExerciseIndex]?.num;
        if (call.arguments.skipCurrent === true && currentExerciseNum) {
          setDoneSets((prev) => (prev.includes(currentExerciseNum) ? prev : [...prev, currentExerciseNum]));
        }
        setSelectedExerciseIndex(nextExercise.exerciseIndex);
        setSelectedExercise(nextExercise.exerciseName);
        await refreshLastSessionForExercise(nextExercise.exerciseName);
        return { message: `Moved to ${nextExercise.exerciseName}.`, ok: true };
      }
      case 'set_rest_timer': {
        const seconds = Number(call.arguments.seconds);
        if (![30, 60, 90, 120].includes(seconds)) {
          return { message: 'Rest timer must be 30, 60, 90, or 120 seconds.', ok: false };
        }
        setRestTimerSeconds(seconds);
        return { message: `Rest timer set for ${seconds} seconds.`, ok: true };
      }
      case 'schedule_reminder': {
        const title = typeof call.arguments.title === 'string' ? call.arguments.title : 'APEX Coach Reminder';
        const body = typeof call.arguments.body === 'string'
          ? call.arguments.body
          : 'Open APEX and stay on the plan.';
        const remindAtIso = typeof call.arguments.remindAtIso === 'string' ? call.arguments.remindAtIso : '';
        const remindAt = remindAtIso ? new Date(remindAtIso) : new Date(Date.now() + 60 * 60 * 1000);
        const scheduled = await scheduleAICoachReminder({ body, remindAt, title });
        return {
          message: scheduled ? `Reminder set for ${title.toLowerCase()}.` : 'Reminder could not be scheduled.',
          ok: scheduled,
        };
      }
      case 'apply_plan_adjustment': {
        const note = typeof call.arguments.note === 'string' ? call.arguments.note.trim() : '';
        if (!note) {
          return { message: 'No adjustment note was provided.', ok: false };
        }

        const nextWorkout: AIWorkout = aiWorkout ?? {
          coachNote: note,
          duration: 30,
          exercises: exercises.map((exercise) => ({
            name: exercise.name,
            reps: exercise.sets.split(' x ')[1] ?? exercise.sets,
            rest: '90s',
            sets: Number(exercise.sets.split(' x ')[0]) || 3,
          })),
          focus: todayProgram.meta,
          generatedAt: new Date().toISOString(),
          name: todayProgram.name,
        };

        const updatedWorkout = {
          ...nextWorkout,
          coachNote: note,
          generatedAt: new Date().toISOString(),
        };

        await saveAIWorkout(updatedWorkout).catch(() => null);
        setAiWorkout(updatedWorkout);
        return { message: 'Training plan note updated.', ok: true };
      }
      case 'update_weight': {
        const weightLbs = typeof call.arguments.weightLbs === 'string' ? call.arguments.weightLbs.trim() : '';
        const exerciseName = typeof call.arguments.exerciseName === 'string' ? call.arguments.exerciseName : undefined;
        if (!weightLbs) {
          return { message: 'No weight was provided.', ok: false };
        }
        const message = await persistStructuredVoiceWorkoutLog({ exerciseName, weightLbs });
        return { message: message ?? `Weight updated to ${weightLbs} lbs.`, ok: true };
      }
      default:
        return { message: 'Unknown workout tool.', ok: false };
    }
  }, [
    aiWorkout,
    exercises,
    getNextExerciseInWorkout,
    persistStructuredVoiceWorkoutLog,
    refreshLastSessionForExercise,
    selectedExerciseIndex,
    selectedWorkoutName,
    todayProgram.meta,
    todayProgram.name,
  ]);

  const realtimeCoach = useWorkoutRealtimeAudio({
    onToolCall: handleRealtimeWorkoutTool,
  });

  const askWorkoutCoach = React.useCallback(async (prompt: string) => {
    if (!prompt || workoutCoachLoading || !voice.voiceEnabled || !voice.sessionActive) {
      return;
    }

    const warmupOutstanding = todayProgram.badge !== 'rest' && completedWarmupSteps.length < WARMUP_STEPS.length;
    const currentExercise = exercises[selectedExerciseIndex] ?? exercises[0];
    const currentWarmupStep = WARMUP_STEPS[completedWarmupSteps.length];
    const currentCoachTarget = warmupOutstanding
      ? { name: currentWarmupStep?.label ?? 'Warm-up', sets: '5 min · Dynamic · Before every session' }
      : currentExercise;
    const parsedCommand = parseWorkoutCoachCommand(prompt);
    const reminderRequest = parseCoachReminder(prompt);

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    setWorkoutCoachLoading(true);
    setWorkoutCoachReply('');

    try {
      if (parsedCommand?.repeatCue) {
        const repeatReply = workoutCoachReply || `For ${currentCoachTarget?.name ?? 'this exercise'}, stay smooth and keep one solid rep in the tank.`;
        setWorkoutCoachReply(repeatReply);
        setWorkoutCoachSpeaking(true);
        await voice.speak(repeatReply);
        return;
      }

      if (reminderRequest) {
        const scheduled = await scheduleAICoachReminder(reminderRequest);
        const reminderReply = scheduled
          ? `Done. I will remind you about ${reminderRequest.title.toLowerCase()}.`
          : 'I could not schedule that reminder yet. Check notification permissions and try again.';
        setWorkoutCoachReply(reminderReply);
        setWorkoutCoachSpeaking(true);
        await voice.speak(reminderReply);
        return;
      }

      if (parsedCommand?.askRest) {
        const restSeconds = getCurrentExerciseRestSeconds();
        const restReply = `Take ${restSeconds} seconds here, then go again when your breathing settles.`;
        setWorkoutCoachReply(restReply);
        setWorkoutCoachSpeaking(true);
        await voice.speak(restReply);
        return;
      }

      if (parsedCommand?.skipExercise) {
        const nextExercise = getNextExerciseInWorkout(selectedWorkoutName, selectedExerciseIndex);
        if (nextExercise) {
          setSelectedExerciseIndex(nextExercise.exerciseIndex);
          setSelectedExercise(nextExercise.exerciseName);
          const skipReply = `Skip it. Next is ${nextExercise.exerciseName}.`;
          setWorkoutCoachReply(skipReply);
          setWorkoutCoachSpeaking(true);
          await voice.speak(skipReply);
          return;
        }
      }

      const hasSpecificSetData = Boolean(
        parsedCommand?.reps ||
        parsedCommand?.weightLbs ||
        parsedCommand?.setIndex ||
        parsedCommand?.sameWeight,
      );

      if (parsedCommand?.goLighter && !hasSpecificSetData) {
        const lighterReply = `Go a little lighter and keep the reps clean.`;
        setWorkoutCoachReply(lighterReply);
        setWorkoutCoachSpeaking(true);
        await voice.speak(lighterReply);
        return;
      }

      if (parsedCommand?.goHeavier && !hasSpecificSetData) {
        const heavierReply = `If that last set stayed sharp, add a little weight and keep your form honest.`;
        setWorkoutCoachReply(heavierReply);
        setWorkoutCoachSpeaking(true);
        await voice.speak(heavierReply);
        return;
      }

      const logSummary = await persistVoiceWorkoutLog(prompt);
      if (logSummary) {
        setWorkoutCoachReply(logSummary);
        setWorkoutCoachSpeaking(true);
        await voice.speak(logSummary);
        return;
      }

      const connected = await realtimeCoach.connectWorkoutCoach({
        coachVoice: selectedCoachVoice,
        currentExercise: currentCoachTarget?.name ?? selectedExercise ?? todayProgram.name,
        todayWorkout: todayProgram.name,
        workoutContext: buildRealtimeWorkoutContext(),
      });

      if (!connected) {
        throw new Error(realtimeCoach.lastError ?? 'Realtime workout coach could not connect.');
      }

      const reply =
        (await realtimeCoach.ask(prompt)).trim() ||
        'Stay smooth here and keep one clean rep in the tank.';

      setWorkoutCoachReply(reply);
      setWorkoutCoachSpeaking(true);
      await voice.speak(reply);
    } catch {
      const fallback = `For ${currentCoachTarget?.name ?? 'this movement'}, keep it clean and leave one solid rep in the tank.`;
      setWorkoutCoachReply(fallback);
      setWorkoutCoachSpeaking(true);
      await voice.speak(fallback);
    } finally {
      setWorkoutCoachSpeaking(false);
      setWorkoutCoachLoading(false);
    }
  }, [
    buildRealtimeWorkoutContext,
    getNextExerciseInWorkout,
    realtimeCoach,
    selectedCoachVoice,
    selectedExercise,
    selectedExerciseIndex,
    selectedWorkoutName,
    todayProgram.name,
    todayProgram.badge,
    voice,
    workoutCoachLoading,
    workoutCoachReply,
    persistVoiceWorkoutLog,
  ]);

  const startWorkoutCoachRecording = React.useCallback(async () => {
    if (!voice.voiceEnabled || !voice.sessionActive || workoutCoachRecording || workoutCoachLoading || workoutCoachTranscribing) {
      return;
    }

    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Allow microphone access so your workout coach can hear your question.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        interruptionModeAndroid: 1,
        playThroughEarpieceAndroid: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        staysActiveInBackground: false,
      });

      const options = {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        ios: {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
          isMeteringEnabled: true,
        },
        android: {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
          isMeteringEnabled: true,
        },
      };

      const { recording } = await Audio.Recording.createAsync(options);
      workoutCoachRecordingRef.current = recording;
      workoutCoachRecordingStartedAtRef.current = Date.now();
      workoutCoachSpeechDetectedRef.current = false;
      workoutCoachSpeechSustainedMsRef.current = 0;
      workoutCoachSilenceMsRef.current = 0;
      setWorkoutCoachRecording(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);

      if (workoutCoachStatusRef.current) {
        clearInterval(workoutCoachStatusRef.current);
      }

      workoutCoachStatusRef.current = setInterval(() => {
        recording.getStatusAsync()
          .then((status) => {
            if (!status.isRecording) {
              return;
            }

            const metering = typeof status.metering === 'number' ? status.metering : -160;
            const heardSpeech = metering > WORKOUT_COACH_SPEECH_THRESHOLD_DB;

            if (heardSpeech) {
              workoutCoachSpeechSustainedMsRef.current += 250;
              workoutCoachSilenceMsRef.current = 0;
              if (
                !workoutCoachSpeechDetectedRef.current &&
                workoutCoachSpeechSustainedMsRef.current >= WORKOUT_COACH_SPEECH_SUSTAINED_MS
              ) {
                workoutCoachSpeechDetectedRef.current = true;
              }
              return;
            }

            workoutCoachSpeechSustainedMsRef.current = 0;

            const elapsedMs = Date.now() - workoutCoachRecordingStartedAtRef.current;

            if (workoutCoachSpeechDetectedRef.current) {
              workoutCoachSilenceMsRef.current += 250;
              if (workoutCoachSilenceMsRef.current >= WORKOUT_COACH_SILENCE_AFTER_SPEECH_MS) {
                stopWorkoutCoachRecording().catch(() => null);
              }
              return;
            }

            workoutCoachSilenceMsRef.current += 250;
            if (elapsedMs >= WORKOUT_COACH_MAX_UTTERANCE_MS) {
              stopWorkoutCoachRecording(false).catch(() => null);
              return;
            }
            if (workoutCoachSilenceMsRef.current >= WORKOUT_COACH_IDLE_TIMEOUT_MS) {
              stopWorkoutCoachRecording(true).catch(() => null);
            }
          })
          .catch(() => null);
      }, 250);
    } catch {
      Alert.alert('Mic unavailable', 'I could not start listening. Try again in a moment.');
    }
  }, [voice.sessionActive, voice.voiceEnabled, workoutCoachLoading, workoutCoachRecording, workoutCoachTranscribing]);

  const stopWorkoutCoachRecording = React.useCallback(async (silentTimeout = false) => {
    const recording = workoutCoachRecordingRef.current;
    if (!recording) {
      return;
    }

    if (workoutCoachStatusRef.current) {
      clearInterval(workoutCoachStatusRef.current);
      workoutCoachStatusRef.current = null;
    }
    setWorkoutCoachRecording(false);
    workoutCoachRecordingRef.current = null;

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playThroughEarpieceAndroid: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        staysActiveInBackground: false,
      });
      const uri = recording.getURI();
      if (!uri) {
        throw new Error('No audio file found.');
      }

      const recordingDurationMs = Date.now() - workoutCoachRecordingStartedAtRef.current;
      workoutCoachRecordingStartedAtRef.current = 0;

      if (
        silentTimeout &&
        !workoutCoachSpeechDetectedRef.current &&
        recordingDurationMs < WORKOUT_COACH_MIN_TRANSCRIBE_MS
      ) {
        setWorkoutCoachDebug({
          lastRecordingMs: recordingDurationMs,
          lastTranscript: '',
          lastTranscriptStatus: 'idle',
        });
        return;
      }

      setWorkoutCoachTranscribing(true);
      setWorkoutCoachReply('');
      setWorkoutCoachDebug({
        lastRecordingMs: recordingDurationMs,
        lastTranscript: '',
        lastTranscriptStatus: 'transcribing',
      });
      const transcript = await transcribeWithElevenLabs(uri, env.elevenLabsApiKey);
      const normalizedTranscript = transcript.trim();
      const words = normalizedTranscript.split(/\s+/).filter(Boolean);
      if (!normalizedTranscript || normalizedTranscript.length < 3 || words.length < 1) {
        setWorkoutCoachDebug({
          lastRecordingMs: recordingDurationMs,
          lastTranscript: normalizedTranscript,
          lastTranscriptStatus: 'empty',
        });
        setWorkoutCoachReply('I did not catch that clearly. Try speaking a little closer to the phone and pausing after your question.');
        return;
      }

      setWorkoutCoachDebug({
        lastRecordingMs: recordingDurationMs,
        lastTranscript: normalizedTranscript,
        lastTranscriptStatus: 'ok',
      });
      await askWorkoutCoach(normalizedTranscript);
    } catch (error) {
      setWorkoutCoachDebug({
        lastRecordingMs: 0,
        lastTranscript: error instanceof Error && error.message ? error.message : 'Unknown transcription error',
        lastTranscriptStatus: 'error',
      });
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'I could not understand that. Try again in a moment.';
      if (message.toLowerCase().includes('no speech detected')) {
        return;
      }
      if (silentTimeout) {
        return;
      }
      Alert.alert('Voice question failed', message);
    } finally {
      setWorkoutCoachTranscribing(false);
    }
  }, [askWorkoutCoach]);

  React.useEffect(() => {
    return () => {
      if (workoutDemoPollRef.current) {
        clearTimeout(workoutDemoPollRef.current);
      }
      if (workoutCoachRecordingRef.current) {
        workoutCoachRecordingRef.current.stopAndUnloadAsync().catch(() => null);
      }
      if (workoutCoachStatusRef.current) {
        clearInterval(workoutCoachStatusRef.current);
      }
      if (workoutCoachAutoRestartRef.current) {
        clearTimeout(workoutCoachAutoRestartRef.current);
      }
      realtimeCoach.disconnect();
    };
  }, [realtimeCoach.disconnect]);

  React.useEffect(() => {
    if (!voice.sessionActive || !voice.voiceEnabled) {
      if (workoutCoachAutoRestartRef.current) {
        clearTimeout(workoutCoachAutoRestartRef.current);
        workoutCoachAutoRestartRef.current = null;
      }
      if (workoutCoachStatusRef.current) {
        clearInterval(workoutCoachStatusRef.current);
        workoutCoachStatusRef.current = null;
      }
      return;
    }

    if (realtimeCoach.liveAudioTransportReady) {
      return;
    }

    if (Platform.OS === 'ios') {
      return;
    }

    if (workoutCoachRecording || workoutCoachLoading || workoutCoachTranscribing || workoutCoachSpeaking) {
      return;
    }

    if (workoutCoachAutoRestartRef.current) {
      clearTimeout(workoutCoachAutoRestartRef.current);
    }

    workoutCoachAutoRestartRef.current = setTimeout(() => {
      startWorkoutCoachRecording().catch(() => null);
    }, 450);

    return () => {
      if (workoutCoachAutoRestartRef.current) {
        clearTimeout(workoutCoachAutoRestartRef.current);
        workoutCoachAutoRestartRef.current = null;
      }
    };
  }, [
    realtimeCoach.liveAudioTransportReady,
    startWorkoutCoachRecording,
    voice.sessionActive,
    voice.voiceEnabled,
    workoutCoachLoading,
    workoutCoachRecording,
    workoutCoachSpeaking,
    workoutCoachTranscribing,
  ]);

  React.useEffect(() => {
    if (restTimerSeconds <= 0) {
      return;
    }

    const id = setInterval(() => {
      setRestTimerSeconds((current) => {
        if (current <= 1) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
          Vibration.vibrate([0, 220, 120, 220]);
          return 0;
        }
        if ((current - 1) % 10 === 0) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [restTimerSeconds]);

  const startRestTimer = React.useCallback(async (sets?: SetEntry[]) => {
    const nextRest = [...(sets ?? [])]
      .reverse()
      .map((set) => Number(set.restSeconds ?? 0))
      .find((seconds) => seconds > 0 && [60, 90, 120].includes(seconds));

    if (!nextRest) {
      setRestTimerSeconds(0);
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRestTimerSeconds(nextRest);
  }, []);

  const handleSaveWorkout = async ({ goNext = false, sets }: { goNext?: boolean; sets?: SetEntry[] } = {}) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!session?.user?.id) {
      Alert.alert('Not signed in', 'Log in before saving workouts.');
      return;
    }

    const normalizedWorkoutType = selectedExercise.trim() || 'Workout';
    const workoutDate = new Date().toISOString().slice(0, 10);

    // Persist sets/reps/weights to AsyncStorage for history detail view
    if (sets && sets.length > 0) {
      const setsKey = `@apex_sets_${workoutDate}_${normalizedWorkoutType}`;
      await AsyncStorage.setItem(setsKey, JSON.stringify(sets)).catch(() => null);
      setCurrentLoggedExerciseName(normalizedWorkoutType);
      setCurrentExerciseLogSets(sets);
      setTodayExerciseLogCounts((prev) => ({
        ...prev,
        [normalizedWorkoutType]: sets.filter((entry) => entry.reps?.trim() || entry.weightLbs?.trim()).length,
      }));
      setTodayExerciseSets((prev) => ({ ...prev, [normalizedWorkoutType]: sets }));
      // Save as last session for this exercise (for pre-fill and PR detection)
      await AsyncStorage.setItem(
        `@apex_last_${normalizedWorkoutType}`,
        JSON.stringify({ sets, date: workoutDate }),
      ).catch(() => null);
    }

    const durationNum = Number(durationMinutes || 0);
    const { error } = await supabase.from('workouts').insert({
      calories_burned: Number(caloriesBurned || 0),
      duration: durationNum,
      duration_minutes: durationNum,
      type: normalizedWorkoutType,
      user_id: session.user.id,
      workout_date: workoutDate,
      workout_type: normalizedWorkoutType,
    });

    if (error) {
      Alert.alert('Save failed', error.message);
      return;
    }

    await addXp(10);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Inform the voice coach of the freshly logged sets so she can coach with real numbers.
    if (sets && sets.length > 0 && realtimeCoach.elevenLabsAgentEnabled && realtimeCoach.supportsNativeLiveMode) {
      const setsSummary = sets
        .filter((s) => s.reps?.trim() || s.weightLbs?.trim())
        .map((s, i) => {
          const weight = s.weightLbs?.trim() ? `${s.weightLbs} lbs × ` : '';
          return `Set ${i + 1}: ${weight}${s.reps} reps`;
        })
        .join(', ');
      realtimeCoach.sendContextualUpdate(
        `${normalizedWorkoutType} just logged: ${setsSummary}. Acknowledge briefly and encourage the next set or exercise.`,
      );
    }

    const { data } = await supabase
      .from('workouts')
      .select('workout_type, duration_minutes, calories_burned, workout_date')
      .eq('user_id', session.user.id)
      .order('workout_date', { ascending: false })
      .limit(5);

    setHistory(data ?? []);

    const [workoutCount, streakCount] = await Promise.all([
      getWorkoutCount(session.user.id),
      getWorkoutStreak(session.user.id),
    ]);

    const hitWorkoutMilestone = WORKOUT_REVIEW_MILESTONES.includes(workoutCount);
    const hitStreakMilestone = STREAK_REVIEW_MILESTONES.includes(streakCount);

    if (hitWorkoutMilestone || hitStreakMilestone) {
      await maybeRequestReview();
    }

    const nextExercise = getNextExerciseInWorkout(selectedWorkoutName, selectedExerciseIndex);
    await startRestTimer(sets);

    const currentExerciseNum = exercises[selectedExerciseIndex]?.num;
    if (currentExerciseNum) {
      setDoneSets((prev) => (prev.includes(currentExerciseNum) ? prev : [...prev, currentExerciseNum]));
    }

    if (goNext && nextExercise) {
      setSelectedExerciseIndex(nextExercise.exerciseIndex);
      setSelectedExercise(nextExercise.exerciseName);
      resetLogFields();
      return;
    }

    setLogVisible(false);
    Alert.alert('Logged', `${selectedExercise} saved. You earned +10 XP.`);
  };

  const getCoachStageMessage = React.useCallback(
    (mode: 'start' | 'resume') => {
      const firstExercise = exercises[0];
      const selectedEx = exercises[selectedExerciseIndex];
      const currentExercise = (selectedEx && !doneSets.includes(selectedEx.num))
        ? selectedEx
        : (getNextIncompleteExercise() ?? selectedEx ?? firstExercise);
      const prefix = mode === 'start' ? `We are starting ${todayProgram.name}.` : `I am back with you for ${todayProgram.name}.`;

      if (todayProgram.badge !== 'rest' && completedWarmupSteps.length < WARMUP_STEPS.length) {
        const nextWarmup = WARMUP_STEPS[completedWarmupSteps.length] ?? WARMUP_STEPS[0];
        return `${prefix} Start with the warm-up. ${nextWarmup.label}. Once your warm-up is done, we move into ${(exercises[selectedExerciseIndex] ?? firstExercise)?.name ?? 'your first exercise'}.`;
      }

      if (!isWorkoutFlowComplete && currentExercise && !doneSets.includes(currentExercise.num)) {
        return `${prefix} Pick up at ${currentExercise.name}. Stay locked in and finish this movement clean before we move on.`;
      }

      if (!cardioCompleted && todayProgram.badge !== 'rest') {
        return `${prefix} Main work is done. Finish your cardio strong. While you are moving, you can ask me questions, share wins, or tell me when cardio is complete. When you are ready to shut me off, just end the session.`;
      }

      return `${prefix} You are right where you need to be. Let's finish this session the right way.`;
    },
    [cardioCompleted, completedWarmupSteps.length, doneSets, exercises, getNextIncompleteExercise, isWorkoutFlowComplete, selectedExerciseIndex, todayProgram.badge, todayProgram.name],
  );

  const getCoachSessionEndingMessage = React.useCallback(() => {
    if (isWorkoutFlowComplete) {
      return 'Nice work. You finished the session strong. Log anything left when you are ready.';
    }

    const currentExercise = exercises[selectedExerciseIndex] ?? exercises[0];

    if (todayProgram.badge !== 'rest' && completedWarmupSteps.length < WARMUP_STEPS.length) {
      return 'We did not finish the warm-up yet, and that is okay. Come back later when you are ready and I will pick it up with you.';
    }

    if (currentExercise && !doneSets.includes(currentExercise.num)) {
      return `We did not finish ${currentExercise.name} yet, and that is okay. Come back later when you are ready and we will pick it up right there.`;
    }

    if (todayProgram.badge !== 'rest' && !cardioCompleted) {
      return 'Main work is in. Come back later when you are ready and we will finish the cardio together.';
    }

    return 'We did not finish everything yet, and that is okay. Come back later when you are ready and we will keep going.';
  }, [
    cardioCompleted,
    completedWarmupSteps.length,
    doneSets,
    exercises,
    isWorkoutFlowComplete,
    selectedExerciseIndex,
    todayProgram.badge,
  ]);

  const getExerciseLoggedSummary = React.useCallback((exercise: WorkoutProgramExercise) => {
    const loggedCount = todayExerciseLogCounts[exercise.name] ?? 0;
    if (loggedCount <= 0) {
      return null;
    }

    const plannedCount = parseExercisePrescription(exercise.sets).setCount;
    return `${Math.min(loggedCount, plannedCount)}/${plannedCount} sets logged`;
  }, [todayExerciseLogCounts]);

  const handleVoiceToggle = React.useCallback(async (enabled: boolean) => {
    await Haptics.selectionAsync().catch(() => null);

    if (!enabled) {
      if (workoutCoachRecordingRef.current) {
        await stopWorkoutCoachRecording(true).catch(() => null);
      }
      realtimeCoach.disconnect();
      if (voice.voiceEnabled && voice.sessionActive) {
        await voice.speak(
          "If you need me again, just hit the toggle button, and I'll be here. In the meantime, I'll keep track of your weights, reps and sets in silence. Feel free to listen to music while I'm away. Go crush it!",
        );
      }
      await voice.setVoiceEnabled(false);
      return;
    }

    await voice.setVoiceEnabled(true);
    if (voice.sessionActive) {
      const nextIncompleteExercise = getNextIncompleteExercise();
      const stageMessage = getCoachStageMessage('resume');
      if (!realtimeCoach.liveAudioTransportReady) {
        setWorkoutCoachSpeaking(true);
        try {
          await voice.speak(stageMessage);
        } finally {
          setWorkoutCoachSpeaking(false);
        }
      }
      const connected = await realtimeCoach.connectWorkoutCoach({
        coachVoice: selectedCoachVoice,
        currentExercise: (() => {
            const sel = exercises[selectedExerciseIndex];
            return (sel && !doneSets.includes(sel.num))
              ? sel.name
              : (nextIncompleteExercise?.name ?? sel?.name ?? todayProgram.name);
          })(),
        kickoffPrompt: realtimeCoach.liveAudioTransportReady ? stageMessage : null,
        todayWorkout: todayProgram.name,
        userName: profile?.displayName?.split(' ')[0] ?? null,
        workoutContext: buildRealtimeWorkoutContext(),
      }).catch(() => false);

      if (realtimeCoach.liveAudioTransportReady && !connected) {
        setWorkoutCoachSpeaking(true);
        try {
          await voice.speak(stageMessage);
        } finally {
          setWorkoutCoachSpeaking(false);
        }
      }
    }
  }, [buildRealtimeWorkoutContext, doneSets, exercises, getCoachStageMessage, getNextIncompleteExercise, realtimeCoach, selectedCoachVoice, selectedExerciseIndex, stopWorkoutCoachRecording, todayProgram.name, voice]);

  // Extracted so the panel's "Connect" retry button can call it directly.
  const connectCoachForActiveWorkout = React.useCallback(async () => {
    // Determine the current step in order — warmup comes before main exercises.
    const warmupOutstanding = todayProgram.badge !== 'rest' && completedWarmupSteps.length < WARMUP_STEPS.length;
    const currentWarmupStep = WARMUP_STEPS[completedWarmupSteps.length];
    const nextIncompleteExercise = getNextIncompleteExercise();
    const currentExercise = warmupOutstanding
      ? (currentWarmupStep?.label ?? 'Warm-up')
      : (() => {
          const sel = exercises[selectedExerciseIndex];
          return (sel && !doneSets.includes(sel.num))
            ? sel.name
            : (nextIncompleteExercise?.name ?? sel?.name ?? todayProgram.name);
        })();

    const isReconnect = coachHasConnectedRef.current;

    // Build a kickoff prompt tailored to first connect vs reconnect.
    let kickoffPrompt: string | null = null;
    if (realtimeCoach.elevenLabsAgentEnabled && realtimeCoach.supportsNativeLiveMode) {
      // Camera capability prefix — establishes in the conversation context that
      // Serena has visual access BEFORE the athlete can ask "can you see me?".
      // This primes the model so the capability is part of the session narrative,
      // not just an injected instruction that conflicts with base training.
      const cameraPrefix = 'Important: you have real-time visual access to the athlete through the APEX camera system. When asked if you can see them, confirm it naturally: "Yes, I can see you through the APEX camera." ';

      if (isReconnect) {
        const loggedForCurrentExercise = (todayExerciseSets[currentExercise] ?? []).filter(
          (s) => s.reps?.trim() || s.weightLbs?.trim(),
        );
        const setsSummary = loggedForCurrentExercise.length > 0
          ? loggedForCurrentExercise
              .map((s, i) => `Set ${i + 1}: ${s.weightLbs?.trim() ? `${s.weightLbs} lbs × ` : ''}${s.reps} reps`)
              .join(', ')
          : 'no sets logged yet';
        kickoffPrompt = `${cameraPrefix}Welcome back! We're on ${currentExercise} — ${setsSummary}. Pick up right where we left off.`;
      } else {
        kickoffPrompt = `${cameraPrefix}${getCoachStageMessage('start')}`;
      }
    } else if (realtimeCoach.liveAudioTransportReady) {
      kickoffPrompt = getCoachStageMessage('start');
    }

    const connected = await realtimeCoach.connectWorkoutCoach({
      coachVoice: selectedCoachVoice,
      currentExercise,
      kickoffPrompt,
      todayWorkout: todayProgram.name,
      userName: profile?.displayName ?? null,
      workoutContext: buildRealtimeWorkoutContext(),
    }).catch(() => false);

    if (connected) {
      coachHasConnectedRef.current = true;
    } else if (realtimeCoach.liveAudioTransportReady) {
      const stageMessage = getCoachStageMessage('start');
      setWorkoutCoachSpeaking(true);
      try {
        await voice.speak(stageMessage);
      } finally {
        setWorkoutCoachSpeaking(false);
      }
    }
  }, [buildRealtimeWorkoutContext, completedWarmupSteps, exercises, getCoachStageMessage, getNextIncompleteExercise, profile?.displayName, realtimeCoach, selectedCoachVoice, selectedExerciseIndex, todayExerciseSets, todayProgram.badge, todayProgram.name, voice]);

  const handleStartSession = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (!voice.voiceEnabled) {
      await voice.setVoiceEnabled(true).catch(() => null);
    }
    if (!isPro && !proLoading) {
      await maybeShowPaywall(session?.user?.id).catch(() => null);
      navigation.navigate('Upgrade');
      return;
    }

    // Open the overlay immediately so the user sees "Connecting…" from the start.
    setShowActiveWorkout(true);

    const stageMessage = getCoachStageMessage('start');

    // When ElevenLabs Agent is active it owns the audio session and delivers its
    // own opening greeting over WebRTC. Speaking via the legacy TTS path first
    // grabs the audio route before the WebRTC handshake completes, causing
    // the ElevenLabs connection to fail. Suppress the legacy greeting in that case.
    const elevenLabsActive =
      realtimeCoach.elevenLabsAgentEnabled && realtimeCoach.supportsNativeLiveMode;

    if (elevenLabsActive) {
      // Start the session timer without any spoken greeting — ElevenLabs will greet.
      await voice.startSession(
        todayProgram.name,
        exercises.map((e) => ({ name: e.name, sets: e.sets })),
        { suppressOpeningSpeech: true },
      );
    } else if (!realtimeCoach.liveAudioTransportReady) {
      setWorkoutCoachSpeaking(true);
      try {
        await voice.startSession(
          todayProgram.name,
          exercises.map((e) => ({ name: e.name, sets: e.sets })),
          { openingMessage: stageMessage },
        );
      } finally {
        setWorkoutCoachSpeaking(false);
      }
    } else {
      await voice.startSession(
        todayProgram.name,
        exercises.map((e) => ({ name: e.name, sets: e.sets })),
        { suppressOpeningSpeech: true },
      );
    }

    await connectCoachForActiveWorkout();

    if (!voice.voiceEnabled) {
      Alert.alert('Session started ▶', 'Timer running. Log exercises as you complete them.');
    }
  };

  const handleEndSession = React.useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const closingMessage = getCoachSessionEndingMessage();
    realtimeCoach.disconnect();
    coachHasConnectedRef.current = false;
    await voice.endSession(closingMessage);
    if (isWorkoutFlowComplete && workoutProgressKey) {
      await AsyncStorage.removeItem(workoutProgressKey).catch(() => null);
    }
  }, [getCoachSessionEndingMessage, isWorkoutFlowComplete, realtimeCoach, voice, workoutProgressKey]);

  // Disconnect just the voice coach after 2 minutes of inactivity — keeps the
  // workout timer running but stops burning ElevenLabs tokens while idle.
  const handleDisconnectCoachOnly = React.useCallback(async () => {
    if (realtimeCoach.elevenLabsAgentEnabled && realtimeCoach.supportsNativeLiveMode) {
      realtimeCoach.sendContextualUpdate(
        'The session has been quiet for a while. Say a brief goodbye and let the user know they can tap the mic button to bring you back.',
      );
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    realtimeCoach.disconnect();
  }, [realtimeCoach]);

  React.useEffect(() => {
    if (!voice.sessionActive || !voice.voiceEnabled) {
      return;
    }

    const idleTimer = setTimeout(() => {
      handleDisconnectCoachOnly().catch(() => null);
    }, 2 * 60 * 1000);

    return () => clearTimeout(idleTimer);
  }, [
    handleDisconnectCoachOnly,
    realtimeCoach.liveDebugSummary,
    voice.sessionActive,
    voice.voiceEnabled,
    workoutCoachReply,
    workoutCoachTranscribing,
  ]);

  const handleUnlockCalorieEstimate = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await maybeShowPaywall(session?.user?.id).catch(() => null);
    navigation.navigate('Upgrade');
  };

  const handleToggleDone = async (num: number) => {
    const wasAlreadyDone = doneSets.includes(num);
    setDoneSets((prev) => prev.includes(num) ? prev.filter((i) => i !== num) : [...prev, num]);

    if (!wasAlreadyDone && voice.sessionActive) {
      const idx = exercises.findIndex((e) => e.num === num);
      const ex = exercises[idx];
      const nextEx = exercises[idx + 1];
      if (nextEx) {
        await voice.announceExercise(nextEx.name, nextEx.sets, idx + 1, exercises.length);
      } else if (todayProgram.badge !== 'rest' && !cardioCompleted) {
        await voice.speak('Main work is done. Finish with your cardio and close it out strong.');
      } else {
        await voice.announceComplete(ex.name);
      }
    }
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'week', label: 'This Week' },
    { key: 'today', label: 'Today' },
    { key: 'history', label: 'History' },
    { key: 'library', label: 'Library' },
  ];
  const selectedExercisePrescription = getExercisePrescriptionForWorkout(
    selectedWorkoutName,
    selectedExerciseIndex,
    selectedExercise,
  );

  return (
    <View style={styles.screen}>
      <AppHeader />
      <View style={styles.tabRow}>
        {tabs.map((item) => (
          <Pressable
            key={item.key}
            style={[styles.tabBtn, tab === item.key ? styles.tabBtnActive : null]}
            onPress={() => setTab(item.key)}
          >
            <Text style={[styles.tabBtnText, tab === item.key ? [styles.tabBtnTextActive, { color: accent }] : null]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Serena AI Prototype removed for launch                       */}
        {/* Per RECONCILED_DECISIONS_V2 §5.3, the AI vision form-review      */}
        {/* surfaces (Serena Live, tempo overlays, rep counter, vision      */}
        {/* indicator) are not user-accessible at launch. The 15-second    */}
        {/* "send clip to Coach Josh" flow is the only retained form-review */}
        {/* path and is reachable via the FormReview route.                  */}

        {/* ── AI Coach Suggested Workout Card ── */}
        {aiWorkout && tab === 'week' ? (
          <View style={[styles.aiWorkoutCard, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
            <View style={styles.aiWorkoutHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.aiWorkoutEyebrow, { color: C.muted }]}>{selectedCoachVoice?.label ?? 'Coach'} · SUGGESTED WORKOUT</Text>
                <Text style={styles.aiWorkoutName}>{aiWorkout.name}</Text>
                <Text style={styles.aiWorkoutMeta}>
                  {aiWorkout.duration} min{aiWorkout.focus ? ` · ${aiWorkout.focus}` : ''} · {aiWorkout.exercises.length} exercises
                </Text>
              </View>
              <Pressable
                style={styles.aiWorkoutDismiss}
                onPress={async () => {
                  await clearAIWorkout();
                  setAiWorkout(null);
                }}
                hitSlop={8}
              >
                <Text style={styles.aiWorkoutDismissText}>✕</Text>
              </Pressable>
            </View>
            {aiWorkout.coachNote ? (
              <Text style={styles.aiWorkoutNote} numberOfLines={2}>💬 {aiWorkout.coachNote}</Text>
            ) : null}
            <View style={styles.aiWorkoutExercises}>
              {aiWorkout.exercises.slice(0, 5).map((ex, i) => (
                <View key={`${ex.name}-${i}`} style={styles.aiWorkoutExRow}>
                  <Text style={[styles.aiWorkoutExNum, { backgroundColor: accentSoft, borderColor: accentBorder, color: accent }]}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.aiWorkoutExName}>{ex.name}</Text>
                    <Text style={styles.aiWorkoutExDetail}>
                      {ex.sets} × {ex.reps}{ex.rest ? ` · ${ex.rest} rest` : ''}{ex.weight ? ` · ${ex.weight}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
              {aiWorkout.exercises.length > 5 ? (
                <Text style={styles.aiWorkoutMore}>+{aiWorkout.exercises.length - 5} more exercises</Text>
              ) : null}
            </View>
            <Pressable
              style={[styles.aiWorkoutStartBtn, { backgroundColor: accent }]}
              onPress={() => {
                const firstEx = aiWorkout.exercises[0];
                if (!firstEx) return;
                setSelectedWorkoutName(aiWorkout.name);
                setSelectedExercise(firstEx.name);
                setSelectedExerciseIndex(0);
                setInitialSets(firstEx.sets);
                setInitialReps(firstEx.reps);
                // Flip activePlanId → 'ai-generated' so todayProgram uses aiWorkout.exercises
                setProfile((prev) => {
                  const updated = { ...(prev ?? {} as UserProfile), activePlanId: 'ai-generated' as const };
                  AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(updated)).catch(() => null);
                  return updated;
                });
                setTab('today');
              }}
            >
              <Text style={styles.aiWorkoutStartBtnText}>START THIS WORKOUT →</Text>
            </Pressable>
          </View>
        ) : null}

        {tab === 'week' ? (
          <View style={styles.quickToolsCard}>
            <Pressable
              style={styles.quickToolsToggle}
              onPress={() => setQuickToolsExpanded((current) => !current)}
            >
              <View style={styles.quickToolsHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.quickToolsEyebrow, { color: accent }]}>TRAIN YOUR WAY</Text>
                  <Text style={styles.quickToolsTitle}>Need something faster or custom today?</Text>
                  <Text style={styles.quickToolsBody}>
                    Choose a quick workout by time, or log your own session with custom exercises, drop sets, supersets, tri-sets, and circuits.
                  </Text>
                </View>
                <View style={[styles.quickToolsChevronWrap, { borderColor: accentBorder, backgroundColor: accentSoft }]}>
                  <Text style={[styles.quickToolsChevron, { color: accent }]}>
                    {quickToolsExpanded ? '−' : '+'}
                  </Text>
                </View>
              </View>
            </Pressable>

            {quickToolsExpanded ? (
              <>
                <View style={styles.quickWorkoutChipRow}>
                  {QUICK_WORKOUT_FOCUS_OPTIONS.map((option) => (
                    <Pressable
                      key={option.id}
                      style={[
                        styles.quickWorkoutFocusChip,
                        quickWorkoutFocus === option.id ? { backgroundColor: accentSoft, borderColor: accent } : null,
                      ]}
                      onPress={() => setQuickWorkoutFocus(option.id)}
                    >
                      <Text style={[styles.quickWorkoutFocusChipText, quickWorkoutFocus === option.id ? { color: accent } : null]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.quickWorkoutChipRow}>
                  {QUICK_WORKOUT_EQUIPMENT_OPTIONS.map((option) => (
                    <Pressable
                      key={option.id}
                      style={[
                        styles.quickWorkoutFocusChip,
                        quickWorkoutEquipment === option.id ? { backgroundColor: accentSoft, borderColor: accent } : null,
                      ]}
                      onPress={() => setQuickWorkoutEquipment(option.id)}
                    >
                      <Text style={[styles.quickWorkoutFocusChipText, quickWorkoutEquipment === option.id ? { color: accent } : null]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.quickWorkoutChipRow}>
                  {[10, 20, 30].map((minutes) => (
                    <Pressable
                      key={minutes}
                      style={[
                        styles.quickWorkoutChip,
                        quickWorkoutMinutes === minutes ? { backgroundColor: accentSoft, borderColor: accent } : null,
                      ]}
                      onPress={() => launchQuickWorkout(minutes).catch(() => null)}
                    >
                      <Text style={[styles.quickWorkoutChipText, quickWorkoutMinutes === minutes ? { color: accent } : null]}>
                        {minutes} min
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable style={[styles.quickWorkoutPrimaryBtn, { backgroundColor: accent }]} onPress={() => openCustomWorkoutLog().catch(() => null)}>
                  <Text style={styles.quickWorkoutPrimaryBtnText}>Did My Own Workout</Text>
                </Pressable>

                <Text style={styles.quickToolsFootnote}>
                  Custom sessions save into your history too, so APEX can use them as training context over time.
                </Text>
              </>
            ) : null}
          </View>
        ) : null}

        {tab === 'week' ? (
          <>
            {!isPro && !proLoading ? (
              <View style={styles.premiumGateCard}>
                <Text style={styles.premiumGateEyebrow}>PREMIUM FEATURE</Text>
                <Text style={styles.premiumGateTitle}>AI Workouts Are Part Of APEX Pro</Text>
                <Text style={styles.premiumGateBody}>
                  Week view, plan previews, and manual workout logging stay free. Pro unlocks AI-built programming, guided workout flow, and voice coaching inside Train.
                </Text>
                <View style={styles.premiumList}>
                  <Text style={styles.premiumListItem}>• AI-powered workout recommendations</Text>
                  <Text style={styles.premiumListItem}>• Guided sessions that run in order</Text>
                  <Text style={styles.premiumListItem}>• Voice coach and advanced session guidance</Text>
                </View>
                <Pressable
                  style={[styles.btnPrimary, { backgroundColor: accent }]}
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    await maybeShowPaywall(session?.user?.id).catch(() => null);
                    navigation.navigate('Upgrade');
                  }}
                >
                  <Text style={styles.btnPrimaryText}>Unlock AI Workouts</Text>
                </Pressable>

                {/* Today's workout shortcut */}
                <View style={styles.todayShortcutCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.todayShortcutEyebrow}>{todayProgram.day} · TODAY</Text>
                    <Text style={styles.todayShortcutName}>{todayProgram.name}</Text>
                    <Text style={styles.todayShortcutMeta}>{todayProgram.meta}</Text>
                  </View>
                  <Pressable
                    style={[styles.todayShortcutBtn, { backgroundColor: accent }]}
                    onPress={() => openManualWorkoutLogForDay(todayProgram.name).catch(() => null)}
                  >
                    <Text style={styles.todayShortcutBtnText}>START →</Text>
                  </Pressable>
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Free Manual Logging</Text>
                {weeklyManualRows.map((item) => (
                  <WorkoutRow
                    key={`manual-${item.day}`}
                    item={item}
                    todayState={todayWeekState}
                    onGo={item.status === 'today' ? () => setTab('today') : undefined}
                    onPreview={(w) => setPreviewWorkout(w)}
                    accentColor={accent}
                    accentStrongBorderColor={accentStrongBorder}
                  />
                ))}
              </View>
            ) : (
              <>
                <AIBar
                  text={`${selectedCoachVoice?.label ?? 'Coach'} Program: ${activePlan.title} · Today is ${todayProgram.name}. ${todayProgram.meta}. Weekly burn from real logs below.`}
                  accentSoft={accentSoft}
                  accentBorder={accentBorder}
                  coachAvatar={selectedCoachVoice?.avatar}
                  coachLabel={selectedCoachVoice?.label}
                />
                {sortedWeek.map((item) => (
                  <WorkoutRow
                    key={item.day}
                    item={item}
                    todayState={todayWeekState}
                    onGo={item.status === 'today' ? () => setTab('today') : undefined}
                    onPreview={(w) => setPreviewWorkout(w)}
                    accentColor={accent}
                    accentStrongBorderColor={accentStrongBorder}
                  />
                ))}
                <View style={[styles.card, { marginTop: 8 }]}>
                  <Text style={styles.weeklyMetricLabel}>Weekly workout burn</Text>
                  <Text style={styles.weeklyMetricValue}>{weeklyBurn} kcal</Text>
                  <Text style={[styles.weeklyMetricSub, { color: accent }]}>{history.length} recent logged sessions</Text>
                </View>
              </>
            )}
          </>
        ) : null}

        {tab === 'today' ? (
          <>
            {!isPro && !proLoading ? (
              <View style={styles.premiumGateCard}>
                <Text style={styles.premiumGateEyebrow}>PREMIUM FEATURE</Text>
                <Text style={styles.premiumGateTitle}>Today&apos;s AI Workout Is Locked</Text>
                <Text style={styles.premiumGateBody}>
                  You can still track today manually for free. Pro unlocks the guided AI workout flow, session setup, and live voice coach that walks you through the day.
                </Text>
                <Pressable
                  style={styles.btnPrimary}
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    await maybeShowPaywall(session?.user?.id).catch(() => null);
                    navigation.navigate('Upgrade');
                  }}
                >
                  <Text style={styles.btnPrimaryText}>Unlock AI Workout Flow</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <SectionLabel>{todayProgram.name} — {exercises.length} Exercises</SectionLabel>

                <View style={[styles.coachPortraitCard, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
                  <Pressable
                    onPress={() => setCoachImagePreviewVisible(true)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${selectedCoachVoice?.label ?? 'coach'} photo`}
                  >
                    <Image
                      source={COACH_VISUALS[selectedCoachVoice?.label ?? 'Coach Josh']?.image ?? COACH_VISUALS['Coach Josh'].image}
                      style={styles.coachPortraitImage}
                    />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.coachPortraitEyebrow, { color: accent }]}>
                      {selectedCoachVoice?.label ?? 'Coach Josh'} · {COACH_VISUALS[selectedCoachVoice?.label ?? 'Coach Josh']?.role ?? 'Coach'}
                    </Text>
                    <Text style={styles.coachPortraitTitle}>
                      {todayProgram.badge !== 'rest' && completedWarmupSteps.length < WARMUP_STEPS.length
                        ? `Warm-up first. ${WARMUP_STEPS[completedWarmupSteps.length]?.label ?? 'Let’s get moving.'}`
                        : !cardioCompleted && doneSets.length >= exercises.length && todayProgram.badge !== 'rest'
                          ? 'Main work is done. Finish your cardio and close it out strong.'
                          : `Locked in on ${exercises[selectedExerciseIndex]?.name ?? 'today’s work'}.`}
                    </Text>
                    <Text style={styles.coachPortraitSub}>
                      {voice.sessionActive
                        ? `${selectedCoachVoice?.label ?? 'Your coach'} is on and tracking your workout live.`
                        : `Tap Talk To ${selectedCoachVoice?.label ?? 'Your Coach'} for real-time cues, logging, and motivation.`}
                    </Text>
                  </View>
                </View>

                {!voice.sessionActive ? (
                  <Pressable style={[styles.btnPrimary, { marginBottom: 14, backgroundColor: accent }]} onPress={handleStartSession}>
                    <Text style={styles.btnPrimaryText}>Talk To {selectedCoachVoice?.label ?? 'Your Coach'}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.sessionActiveCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sessionTimer, { color: accent }]}>{voice.sessionTimeStr}</Text>
                      <View style={styles.sessionTrack}>
                        <View style={[styles.sessionFill, { width: `${voice.sessionPct * 100}%`, backgroundColor: accent }]} />
                      </View>
                      <Text style={styles.sessionSub}>30 min session · {doneSets.length}/{exercises.length} done</Text>
                    </View>
                    <Pressable style={styles.endSessionBtn} onPress={handleEndSession}>
                      <Text style={styles.endSessionText}>■ End</Text>
                    </Pressable>
                  </View>
                )}

                {voice.sessionActive && voice.voiceEnabled ? (
                  <View style={styles.workoutCoachBar}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.workoutCoachBarTitle}>Talk To {selectedCoachVoice?.label ?? 'Your Coach'}</Text>
                      <Text style={styles.workoutCoachBarText}>
                        {workoutCoachRecording
                          ? 'Listening now... just talk naturally and pause when you are done.'
                          : workoutCoachTranscribing
                            ? 'Turning your voice into a question for your coach...'
                              : workoutCoachLoading
                              ? 'Your coach is thinking and will answer out loud.'
                              : workoutCoachSpeaking
                                ? 'Your coach is answering now. I will listen again when the reply ends.'
                              : realtimeCoach.liveAudioTransportReady && realtimeCoach.assistantTranscript
                                ? realtimeCoach.assistantTranscript
                              : workoutCoachReply
                                ? workoutCoachReply
                                : `Just talk — try logging sets, asking for motivation, or moving to the next exercise.`}
                      </Text>
                      {!realtimeCoach.liveAudioTransportReady ? (
                        <View style={styles.workoutCoachControls}>
                          <Pressable
                            style={[
                              styles.workoutCoachMicBtn,
                              { borderColor: accent, backgroundColor: workoutCoachRecording ? accentSoft : C.card },
                            ]}
                            onPress={() => {
                              if (workoutCoachRecording) {
                                stopWorkoutCoachRecording(false).catch(() => null);
                                return;
                              }
                              startWorkoutCoachRecording().catch(() => null);
                            }}
                          >
                            <Text style={[styles.workoutCoachMicBtnText, { color: accent }]}>
                              {workoutCoachRecording ? 'Send To Coach' : 'Ask Coach'}
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {/* ── Warm-up block (all non-rest days) ── */}
                {todayProgram.badge !== 'rest' && (
                  <WarmupSection
                    accentColor={accent}
                    accentSoft={accentSoft}
                    accentStrongBorder={accentStrongBorder}
                    completedSteps={completedWarmupSteps}
                    onToggleStep={(index) => {
                      setCompletedWarmupSteps((prev) => {
                        const next = prev.includes(index)
                          ? prev.filter((item) => item !== index)
                          : [...prev, index].sort((a, b) => a - b);

                        const wasIncomplete = prev.length < WARMUP_STEPS.length;
                        const nowComplete = next.length === WARMUP_STEPS.length;
                        if (voice.sessionActive && voice.voiceEnabled && wasIncomplete && nowComplete) {
                          const firstExercise = exercises[0];
                          voice
                            .speak(`Warm-up is done. Move into ${firstExercise?.name ?? 'your first exercise'}.`)
                            .catch(() => null);
                        }

                        return next;
                      });
                    }}
                  />
                )}

                {exercises.map((exercise) => (
                  <ExerciseItem
                    key={exercise.num}
                    accentBorder={accentBorder}
                    coachLabel={selectedCoachVoice?.label}
                    ex={exercise}
                    done={doneSets.includes(exercise.num)}
                    loggedSummary={getExerciseLoggedSummary(exercise)}
                    onAIDemo={(exerciseName) => handleGenerateWorkoutDemo(exerciseName).catch(() => null)}
                    onFormReview={(exerciseName) => navigation.navigate('FormReview', { exerciseName, hasLiveCoach: true })}
                    onVideoPress={(exerciseItem) => {
                      setVideoId(exerciseItem.youtubeId);
                      setVideoTitle(exerciseItem.name);
                    }}
                    onToggle={() => toggleDone(exercise.num)}
                    onLog={() => openLog(exercise.name)}
                    accentColor={accent}
                    accentSoft={accentSoft}
                  />
                ))}

                {/* ── Custom exercises added from Library ── */}
                {customTodayExs.length > 0 && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 4 }}>
                      <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>ADDED FROM LIBRARY</Text>
                      <View style={{ backgroundColor: accentSoft + '26', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, color: accent, fontFamily: 'DMSans_700Bold', letterSpacing: 0.5 }}>+{customTodayExs.length}</Text>
                      </View>
                    </View>
                    {customTodayExs.map((ex, i) => (
                      <ExerciseItem
                        key={`custom-${i}`}
                        accentBorder={accentBorder}
                        coachLabel={selectedCoachVoice?.label}
                        ex={{ num: exercises.length + i + 1, name: ex.name, sets: ex.sets, youtubeId: '' }}
                        done={doneSets.includes(exercises.length + i + 1)}
                        onAIDemo={(exerciseName) => handleGenerateWorkoutDemo(exerciseName).catch(() => null)}
                        onFormReview={(exerciseName) => navigation.navigate('FormReview', { exerciseName, hasLiveCoach: true })}
                        accentColor={accent}
                        accentSoft={accentSoft}
                        onToggle={() => toggleDone(exercises.length + i + 1)}
                        onLog={() => openLog(ex.name)}
                      />
                    ))}
                  </>
                )}

                {/* ── Cardio finisher / HR zone (all active days) ── */}
                {todayProgram.badge !== 'rest' && (
                    <CardioSection
                      age={parseInt(profile?.age ?? '30', 10)}
                      accentColor={accent}
                      accentSoft={accentSoft}
                      accentStrongBorder={accentStrongBorder}
                      completed={cardioCompleted}
                    onToggleComplete={() => {
                      setCardioCompleted((prev) => {
                        const next = !prev;
                        if (next && voice.sessionActive && voice.voiceEnabled) {
                          voice.speak('Cardio is logged. Nice work.').catch(() => null);
                        }
                        return next;
                      });
                    }}
                    planId={activePlanId}
                  />
                )}
              </>
            )}
          </>
        ) : null}

        {tab === 'history' ? (
          <>
            <SectionLabel>Recent Sessions</SectionLabel>
            {history.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.emptyText}>No workouts logged yet. Save your first session from the Today tab.</Text>
              </View>
            ) : (
              history.map((item, index) => (
                <Pressable
                  key={`${item.workout_type}-${item.workout_date}-${index}`}
                  style={({ pressed }) => [styles.card, { marginBottom: 8, opacity: pressed ? 0.75 : 1 }]}
                  onPress={async () => {
                    const setsKey = `@apex_sets_${item.workout_date}_${item.workout_type}`;
                    const raw = await AsyncStorage.getItem(setsKey).catch(() => null);
                    const sets: SetEntry[] = raw ? (JSON.parse(raw) as SetEntry[]) : [];
                    setHistoryDetailSets(sets);
                    setHistoryDetailItem(item);
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyTitle}>{item.workout_type}</Text>
                      <Text style={styles.historyMeta}>
                        {item.workout_date} · {item.duration_minutes} min · {item.calories_burned} kcal
                      </Text>
                    </View>
                    <Text style={{ color: C.muted, fontSize: 18 }}>›</Text>
                  </View>
                </Pressable>
              ))
            )}
          </>
        ) : null}

        {tab === 'library' ? (
          <>
            <TextInput
              style={styles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={C.muted}
              value={libQuery}
              onChangeText={setLibQuery}
              clearButtonMode="while-editing"
            />
            {/* Category pills */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 7, paddingRight: 8 }}>
              {['All','Chest','Back','Shoulders','Arms','Legs','Core','Full Body','Cardio'].map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => setLibCat(cat)}
                  style={[styles.catPill, libCat === cat && [styles.catPillActive, { backgroundColor: accent }]]}
                >
                  <Text style={[styles.catPillText, libCat === cat && [styles.catPillTextActive, { color: accent }]]}>{cat}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {/* Exercise grid */}
            {(() => {
              const q = libQuery.toLowerCase().trim();
              const allEx = [
                // Chest
                { icon: '💪', name: 'Bench Press', muscles: 'Chest · Triceps', cat: 'Chest', defaultSets: '4 x 8', youtubeId: '_FkbD0FhgVE' },
                { icon: '💪', name: 'Incline DB Press', muscles: 'Upper Chest · Shoulders', cat: 'Chest', defaultSets: '3 x 10', youtubeId: '8fXfwG4ftaQ' },
                { icon: '💪', name: 'Decline Bench Press', muscles: 'Lower Chest', cat: 'Chest', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '💪', name: 'Cable Fly', muscles: 'Chest · Pecs', cat: 'Chest', defaultSets: '3 x 12', youtubeId: '' },
                { icon: '💪', name: 'Push-Up', muscles: 'Chest · Triceps · Core', cat: 'Chest', defaultSets: '3 x 20', youtubeId: '' },
                { icon: '💪', name: 'Dips', muscles: 'Chest · Triceps', cat: 'Chest', defaultSets: '3 x max', youtubeId: '' },
                // Back
                { icon: '🔼', name: 'Pull-Up', muscles: 'Back · Biceps', cat: 'Back', defaultSets: '4 x max', youtubeId: '1Sw5mevOsb0' },
                { icon: '🔼', name: 'Barbell Row', muscles: 'Mid Back · Lats', cat: 'Back', defaultSets: '4 x 6', youtubeId: 'dpYI8K6e-jE' },
                { icon: '🔼', name: 'Lat Pulldown', muscles: 'Lats · Biceps', cat: 'Back', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '🔼', name: 'Seated Cable Row', muscles: 'Mid Back · Lats', cat: 'Back', defaultSets: '3 x 10', youtubeId: 'KaCcBqhiXtc' },
                { icon: '🔼', name: 'Face Pulls', muscles: 'Rear Delt · Rotator Cuff', cat: 'Back', defaultSets: '4 x 15', youtubeId: 'qEyoBOpvqR4' },
                { icon: '🔼', name: 'T-Bar Row', muscles: 'Mid Back · Lats', cat: 'Back', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '🔼', name: 'Single Arm DB Row', muscles: 'Lats · Rhomboids', cat: 'Back', defaultSets: '3 x 10 each', youtubeId: '' },
                // Shoulders
                { icon: '🏋️', name: 'Overhead Press', muscles: 'Shoulders · Triceps', cat: 'Shoulders', defaultSets: '4 x 8', youtubeId: 'zoN5EH50Dro' },
                { icon: '🏋️', name: 'Lateral Raises', muscles: 'Side Delts', cat: 'Shoulders', defaultSets: '4 x 15', youtubeId: 'Kl3LEzQ5Zqs' },
                { icon: '🏋️', name: 'Front Raises', muscles: 'Front Delts', cat: 'Shoulders', defaultSets: '3 x 12', youtubeId: '' },
                { icon: '🏋️', name: 'Arnold Press', muscles: 'Full Deltoid', cat: 'Shoulders', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '🏋️', name: 'Rear Delt Fly', muscles: 'Rear Delt', cat: 'Shoulders', defaultSets: '3 x 15', youtubeId: '' },
                { icon: '🏋️', name: 'Upright Row', muscles: 'Traps · Side Delts', cat: 'Shoulders', defaultSets: '3 x 12', youtubeId: '' },
                // Arms
                { icon: '🦾', name: 'Barbell Curl', muscles: 'Biceps', cat: 'Arms', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '🦾', name: 'DB Curls', muscles: 'Biceps', cat: 'Arms', defaultSets: '3 x 12 each', youtubeId: 'iui51E31sX8' },
                { icon: '🦾', name: 'Hammer Curls', muscles: 'Biceps · Brachialis', cat: 'Arms', defaultSets: '3 x 10 each', youtubeId: 'K9LiwcGuqA0' },
                { icon: '🦾', name: 'Tricep Pushdowns', muscles: 'Triceps', cat: 'Arms', defaultSets: '3 x 12', youtubeId: '4s8Fdhnk6aI' },
                { icon: '🦾', name: 'Skull Crushers', muscles: 'Triceps', cat: 'Arms', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '🦾', name: 'Preacher Curl', muscles: 'Biceps', cat: 'Arms', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '🦾', name: 'Cable Curl', muscles: 'Biceps', cat: 'Arms', defaultSets: '3 x 12', youtubeId: '' },
                // Legs
                { icon: '🏋️', name: 'Back Squat', muscles: 'Quads · Glutes', cat: 'Legs', defaultSets: '4 x 6', youtubeId: 'dW3zj79xfrc' },
                { icon: '🏋️', name: 'Romanian Deadlift', muscles: 'Hamstrings · Glutes', cat: 'Legs', defaultSets: '3 x 8', youtubeId: '_TchJLlBO-4' },
                { icon: '🏋️', name: 'Leg Press', muscles: 'Quads · Glutes', cat: 'Legs', defaultSets: '4 x 10', youtubeId: '' },
                { icon: '🏋️', name: 'Walking Lunges', muscles: 'Quads · Glutes', cat: 'Legs', defaultSets: '3 x 12 each', youtubeId: 'L8fvypPrzzs' },
                { icon: '🏋️', name: 'Leg Curl', muscles: 'Hamstrings', cat: 'Legs', defaultSets: '3 x 12', youtubeId: '' },
                { icon: '🏋️', name: 'Leg Extension', muscles: 'Quads', cat: 'Legs', defaultSets: '3 x 12', youtubeId: '' },
                { icon: '🏋️', name: 'Calf Raises', muscles: 'Calves', cat: 'Legs', defaultSets: '4 x 15', youtubeId: '' },
                { icon: '🏋️', name: 'Bulgarian Split Squat', muscles: 'Quads · Glutes', cat: 'Legs', defaultSets: '3 x 10 each', youtubeId: '' },
                // Core
                { icon: '🔥', name: 'Plank Hold', muscles: 'Core · Stability', cat: 'Core', defaultSets: '3 x 60s', youtubeId: '' },
                { icon: '🔥', name: 'Crunches', muscles: 'Abs', cat: 'Core', defaultSets: '3 x 20', youtubeId: '' },
                { icon: '🔥', name: 'Russian Twist', muscles: 'Obliques', cat: 'Core', defaultSets: '3 x 20 each', youtubeId: '' },
                { icon: '🔥', name: 'Hanging Leg Raise', muscles: 'Lower Abs', cat: 'Core', defaultSets: '3 x 12', youtubeId: '' },
                { icon: '🔥', name: 'Mountain Climbers', muscles: 'Core · Cardio', cat: 'Core', defaultSets: '3 x 30s', youtubeId: '' },
                { icon: '🔥', name: 'Ab Wheel Rollout', muscles: 'Core', cat: 'Core', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '🔥', name: 'Sit-Ups', muscles: 'Abs', cat: 'Core', defaultSets: '3 x 20', youtubeId: '' },
                // Full Body
                { icon: '⬇️', name: 'Deadlift', muscles: 'Posterior Chain', cat: 'Full Body', defaultSets: '4 x 5', youtubeId: '' },
                { icon: '⬇️', name: 'Kettlebell Swing', muscles: 'Glutes · Core · Shoulders', cat: 'Full Body', defaultSets: '4 x 15', youtubeId: '' },
                { icon: '⬇️', name: 'Burpees', muscles: 'Full Body · Cardio', cat: 'Full Body', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '⬇️', name: 'Thrusters', muscles: 'Legs · Shoulders', cat: 'Full Body', defaultSets: '3 x 10', youtubeId: '' },
                { icon: '⬇️', name: 'Power Clean', muscles: 'Full Body · Explosive', cat: 'Full Body', defaultSets: '4 x 4', youtubeId: '' },
                { icon: '⬇️', name: 'Bear Crawl', muscles: 'Core · Shoulders · Legs', cat: 'Full Body', defaultSets: '3 x 20m', youtubeId: '' },
                // Cardio
                { icon: '🏃', name: 'Treadmill Run', muscles: 'Cardio · Legs', cat: 'Cardio', defaultSets: '20–30 min', youtubeId: '' },
                { icon: '🏃', name: 'Rowing Machine', muscles: 'Cardio · Back', cat: 'Cardio', defaultSets: '15–20 min', youtubeId: '' },
                { icon: '🏃', name: 'Jump Rope', muscles: 'Cardio · Calves', cat: 'Cardio', defaultSets: '3 x 3 min', youtubeId: '' },
                { icon: '🏃', name: 'StairMaster', muscles: 'Cardio · Glutes', cat: 'Cardio', defaultSets: '20 min', youtubeId: '' },
                { icon: '🏃', name: 'Battle Ropes', muscles: 'Cardio · Arms', cat: 'Cardio', defaultSets: '4 x 30s', youtubeId: '' },
                { icon: '🏃', name: 'Cycling', muscles: 'Cardio · Quads', cat: 'Cardio', defaultSets: '30–45 min', youtubeId: '' },
              ];
              const filtered = allEx.filter((ex) => {
                const matchCat = libCat === 'All' || ex.cat === libCat;
                const matchQ = !q || ex.name.toLowerCase().includes(q) || ex.muscles.toLowerCase().includes(q) || ex.cat.toLowerCase().includes(q);
                return matchCat && matchQ;
              });
              // Group by category when showing All without search
              const showGrouped = libCat === 'All' && !q;
              if (showGrouped) {
                const cats = ['Chest','Back','Shoulders','Arms','Legs','Core','Full Body','Cardio'];
                return cats.map((cat) => {
                  const group = filtered.filter((ex) => ex.cat === cat);
                  if (!group.length) return null;
                  return (
                    <View key={cat}>
                      <SectionLabel>{cat}</SectionLabel>
                      <View style={styles.libraryGrid}>
                        {group.map((item) => (
                          <Pressable key={item.name} style={styles.libCard} onPress={() => setLibDetail(item)}>
                            <Text style={styles.libIcon}>{item.icon}</Text>
                            <Text style={styles.libName}>{item.name}</Text>
                            <Text style={styles.libMeta}>{item.muscles}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  );
                });
              }
              return (
                <>
                  <SectionLabel>{filtered.length} Exercise{filtered.length !== 1 ? 's' : ''}</SectionLabel>
                  <View style={styles.libraryGrid}>
                    {filtered.map((item) => (
                      <Pressable key={item.name} style={styles.libCard} onPress={() => setLibDetail(item)}>
                        <Text style={styles.libIcon}>{item.icon}</Text>
                        <Text style={styles.libName}>{item.name}</Text>
                        <Text style={styles.libMeta}>{item.muscles}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              );
            })()}
          </>
        ) : null}
      </ScrollView>

      {/* ── Library Exercise Detail Sheet ── */}
      <Modal
        visible={Boolean(libDetail)}
        transparent
        animationType="slide"
        onRequestClose={() => setLibDetail(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setLibDetail(null)}>
          <View style={[styles.modal, { maxHeight: '55%' }]}>
            <View style={styles.modalHandle} />
            <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 6 }}>{libDetail?.icon}</Text>
            <Text style={[styles.modalTitle, { textAlign: 'center', marginBottom: 4 }]}>{libDetail?.name}</Text>
            <Text style={[styles.modalMeta, { textAlign: 'center', marginBottom: 4 }]}>{libDetail?.muscles}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
              <View style={styles.previewChip}>
                <Text style={[styles.previewChipText, { color: accent }]}>{libDetail?.cat}</Text>
              </View>
              <View style={styles.previewChip}>
                <Text style={[styles.previewChipText, { color: C.muted }]}>{libDetail?.defaultSets}</Text>
              </View>
            </View>
            {/* Add to Today */}
            <Pressable
              style={[styles.btnPrimary, { marginBottom: 10 }]}
              onPress={async () => {
                if (!libDetail) return;
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                const todayKey = new Date().toISOString().slice(0, 10);
                const storageKey = `apex.customExercises.${todayKey}`;
                const existing = await AsyncStorage.getItem(storageKey).catch(() => null);
                const list: Array<{ name: string; sets: string; muscles: string }> = existing ? JSON.parse(existing) : [];
                if (!list.find((e) => e.name === libDetail.name)) {
                  list.push({ name: libDetail.name, sets: libDetail.defaultSets, muscles: libDetail.muscles });
                  await AsyncStorage.setItem(storageKey, JSON.stringify(list));
                  setCustomTodayExs(list);
                }
                setLibDetail(null);
                setTab('today');
              }}
            >
              <Text style={styles.btnPrimaryText}>＋ Add to Today's Workout</Text>
            </Pressable>
            <Pressable
              style={styles.btnGhost}
              onPress={() => {
                if (!libDetail) return;
                setLibDetail(null);
                openLog(libDetail.name);
              }}
            >
              <Text style={styles.btnGhostText}>▶ Log Now</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <LogModal
        visible={logVisible}
        currentLoggedExerciseName={currentLoggedExerciseName}
        currentLoggedSets={currentExerciseLogSets}
        lastSession={lastSession}
        canEstimateCalories={isPro}
        isPro={isPro}
        youtubeId={getYoutubeIdForExercise(selectedExercise, basePlan.schedule.flatMap((d) => d.exercises))}
        exerciseName={selectedExercise}
        exampleExercises={getExampleExercises(selectedWorkoutName)}
        duration={durationMinutes}
        calories={caloriesBurned}
        initialSets={initialSets}
        initialReps={initialReps}
        plannedPrescription={selectedExercisePrescription.raw}
        onEstimateCaloriesPress={handleUnlockCalorieEstimate}
        onUpgradePress={async () => {
          await maybeShowPaywall(session?.user?.id).catch(() => null);
          setLogVisible(false);
          navigation.navigate('Upgrade');
        }}
        onChangeDuration={setDurationMinutes}
        onChangeCalories={setCaloriesBurned}
        onChangeExerciseName={setSelectedExercise}
        onDismissRestTimer={() => setRestTimerSeconds(0)}
        onClose={() => setLogVisible(false)}
        onSave={(sets) => handleSaveWorkout({ sets })}
        onSaveAndNext={(sets) => handleSaveWorkout({ goNext: true, sets })}
        canSaveNext={Boolean(getNextExerciseInWorkout(selectedWorkoutName, selectedExerciseIndex))}
        restTimerSeconds={restTimerSeconds}
        accentColor={accent}
        accentSoft={accentSoft}
        onDemoPress={() => {
          const id = getYoutubeIdForExercise(selectedExercise, basePlan.schedule.flatMap((d) => d.exercises));
          if (id) setVideoId(id);
        }}
      />

      <WorkoutPreviewModal
        visible={Boolean(previewWorkout)}
        workout={previewWorkout}
        age={parseInt(profile?.age ?? '30', 10)}
        planId={activePlanId}
        coachLabel={selectedCoachVoice?.label}
        onClose={() => setPreviewWorkout(null)}
        onAIDemo={(exercise) => {
          handleOpenSavedWorkoutDemo(exercise.name, exercise.sets)
            .then((openedSaved) => {
              if (openedSaved) return;
              return handleGenerateWorkoutDemo(exercise.name, exercise.sets);
            })
            .catch(() => null);
        }}
        accentColor={accent}
      />

      {/* History Detail Modal */}
      <Modal
        visible={Boolean(historyDetailItem)}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryDetailItem(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setHistoryDetailItem(null)}>
          <View style={[styles.modal, { maxHeight: '75%' }]}>
            <View style={styles.modalHandle} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>{historyDetailItem?.workout_type ?? ''}</Text>
              <Pressable onPress={() => setHistoryDetailItem(null)} hitSlop={12}>
                <Text style={{ color: C.muted, fontSize: 20 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={[styles.historyMeta, { marginBottom: 16 }]}>
              {historyDetailItem?.workout_date} · {historyDetailItem?.duration_minutes} min · {historyDetailItem?.calories_burned} kcal
            </Text>

            {historyDetailSets.length === 0 ? (
              <Text style={styles.emptyText}>No set details saved for this session.</Text>
            ) : (
              <>
                <View style={[styles.setRow, { paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border }]}>
                  <Text style={[styles.setLabel, { flex: 1, fontFamily: 'DMSans_700Bold' }]}>Set</Text>
                  <Text style={[styles.setLabel, { flex: 1.2, textAlign: 'center', fontFamily: 'DMSans_700Bold' }]}>Type</Text>
                  <Text style={[styles.setLabel, { flex: 1, textAlign: 'center', fontFamily: 'DMSans_700Bold' }]}>Reps</Text>
                  <Text style={[styles.setLabel, { flex: 1.5, textAlign: 'center', fontFamily: 'DMSans_700Bold' }]}>Weight (lbs)</Text>
                  <Text style={[styles.setLabel, { flex: 1, textAlign: 'center', fontFamily: 'DMSans_700Bold' }]}>Rest</Text>
                </View>
                {historyDetailSets.map((s, i) => (
                  <View key={i} style={[styles.setRow, { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border + '44' }]}>
                    <Text style={[styles.setLabel, { flex: 1 }]}>{i + 1}</Text>
                    <Text style={[styles.setLabel, { flex: 1.2, textAlign: 'center' }]}>{getSetTypeLabel(s.setType)}</Text>
                    <Text style={[styles.setLabel, { flex: 1, textAlign: 'center' }]}>{s.reps || '—'}</Text>
                    <Text style={[styles.setLabel, { flex: 1.5, textAlign: 'center' }]}>{s.weightLbs || '—'}</Text>
                    <Text style={[styles.setLabel, { flex: 1, textAlign: 'center' }]}>{s.restSeconds ? `${s.restSeconds}s` : '—'}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* In-app YouTube video player */}
      <VideoPlayerModal
        visible={Boolean(videoId || videoUrl)}
        videoUrl={videoUrl ?? undefined}
        youtubeId={videoId ?? ''}
        title={videoTitle}
        onClose={() => { setVideoId(null); setVideoUrl(null); }}
      />

      <Modal
        visible={coachImagePreviewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCoachImagePreviewVisible(false)}
      >
        <Pressable style={styles.coachImagePreviewBackdrop} onPress={() => setCoachImagePreviewVisible(false)}>
          <View style={styles.coachImagePreviewCard}>
            <Text style={styles.coachImagePreviewTitle}>{selectedCoachVoice?.label ?? 'Coach'}</Text>
            <Image
              source={COACH_VISUALS[selectedCoachVoice?.label ?? 'Coach Josh']?.image ?? COACH_VISUALS['Coach Josh'].image}
              style={styles.coachImagePreviewImage}
            />
            <Pressable style={styles.coachImagePreviewCloseBtn} onPress={() => setCoachImagePreviewVisible(false)}>
              <Text style={styles.coachImagePreviewCloseText}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(workoutDemo)}
        transparent
        animationType="slide"
        onRequestClose={closeWorkoutDemo}
      >
        <Pressable style={styles.modalOverlay} onPress={closeWorkoutDemo}>
          <Pressable onPress={() => null}>
            <Animated.View
              style={[styles.modal, { maxHeight: '78%', transform: [{ translateY: workoutDemoSheetY }] }]}
              {...workoutDemoPanResponder.panHandlers}
            >
              <View style={styles.modalHandle} />
              <Text style={styles.previewModalEyebrow}>AI DEMO · {workoutDemoExercise.toUpperCase()}</Text>
              <Text style={styles.modalTitle}>{workoutDemo?.headline ?? 'Movement Demo'}</Text>
              {!workoutDemo?.videoUrl ? (
                <Animated.View
                  style={[
                    styles.demoVisualCard,
                    {
                      borderColor: accent,
                      backgroundColor: `${accent}14`,
                      transform: [
                        {
                          scale: coachDemoPulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.035],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Image
                    source={COACH_VISUALS[selectedCoachVoice?.label ?? 'Coach Josh']?.image ?? COACH_VISUALS['Coach Josh'].image}
                    style={styles.demoVisualAvatar}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.demoVisualTitle, { color: accent }]}>
                      {selectedCoachVoice?.label ?? 'Coach'} visual demo
                    </Text>
                    <Text style={styles.demoVisualBody}>
                      Your rendered coach video is being built. This live preview keeps the chosen coach visually present while the full demo file is still coming together.
                    </Text>
                  </View>
                </Animated.View>
              ) : null}
              <View style={styles.demoInfoCard}>
                <Text style={styles.demoInfoLabel}>Coach script</Text>
                <Text style={styles.demoInfoBody}>{workoutDemo?.demoScript}</Text>
              </View>
              <View style={styles.demoInfoCard}>
                <Text style={styles.demoInfoLabel}>Camera plan</Text>
                <Text style={styles.demoInfoBody}>{workoutDemo?.cameraPlan}</Text>
              </View>
              {workoutDemo?.generationPrompt ? (
                <View style={styles.demoInfoCard}>
                  <Text style={styles.demoInfoLabel}>Generator prompt</Text>
                  <Text style={styles.demoPromptBody}>{workoutDemo.generationPrompt}</Text>
                </View>
              ) : null}
              <View style={styles.modalBtns}>
                <Pressable
                  style={styles.btnGhost}
                  onPress={() => {
                    if (!workoutDemo?.demoScript) return;
                    voice.speak(workoutDemo.demoScript).catch(() => null);
                  }}
                >
                  <Text style={styles.btnGhostText}>Read It Aloud</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btnPrimary,
                    styles.demoVideoBtn,
                    {
                      backgroundColor: workoutDemo?.videoUrl ? accent : `${accent}24`,
                      borderColor: accent,
                    },
                  ]}
                  onPress={() => {
                    if (!workoutDemo?.videoUrl) return;
                    Linking.openURL(workoutDemo.videoUrl).catch(() => null);
                  }}
                  disabled={!workoutDemo?.videoUrl}
                >
                  <Text
                    style={[
                      styles.btnPrimaryText,
                      styles.demoVideoBtnText,
                      !workoutDemo?.videoUrl ? { color: accent } : null,
                    ]}
                  >
                    {workoutDemo?.videoUrl
                      ? 'Open Video'
                      : workoutDemo?.videoStatus === 'queued'
                        ? 'Generating…'
                        : workoutDemo?.videoStatus === 'failed'
                          ? 'Render Unavailable'
                          : 'Video Pending'}
                  </Text>
                </Pressable>
              </View>
              <Pressable style={[styles.btnGhost, { marginTop: 10 }]} onPress={closeWorkoutDemo}>
                <Text style={styles.btnGhostText}>Close</Text>
              </Pressable>
            </Animated.View>
          </Pressable>
        </Pressable>
      </Modal>

      {restTimerSeconds > 0 ? (
        <View style={styles.floatingRestTimer}>
          <View>
            <Text style={styles.floatingRestEyebrow}>REST TIMER</Text>
            <Text style={styles.floatingRestValue}>{restTimerSeconds}s</Text>
          </View>
          <Pressable onPress={() => setRestTimerSeconds(0)} style={styles.floatingRestSkipBtn}>
            <Text style={styles.floatingRestSkipText}>Skip</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Active Workout Overlay ── */}
      {showActiveWorkout && (
        <ActiveWorkoutPanel
          assistantTranscript={realtimeCoach.assistantTranscript}
          coachAvatar={COACH_VISUALS[selectedCoachVoice?.label ?? 'Coach Josh']?.image}
          coachLabel={selectedCoachVoice?.label ?? 'Coach'}
          connectionError={realtimeCoach.connectionDetail}
          currentExerciseName={exercises[selectedExerciseIndex]?.name ?? selectedExercise ?? todayProgram.name}
          currentExercisePrescription={exercises[selectedExerciseIndex]?.sets ?? ''}
          doneSets={doneSets}
          exercises={exercises.map((e) => ({ name: e.name, num: e.num, sets: e.sets }))}
          isConnected={realtimeCoach.isConnected}
          isConnecting={realtimeCoach.isConnecting}
          isSpeaking={realtimeCoach.isSpeaking}
          nextExerciseName={
            getNextExerciseInWorkout(selectedWorkoutName, selectedExerciseIndex)?.exerciseName
          }
          sessionTimeStr={voice.sessionTimeStr}
          todayExerciseSets={todayExerciseSets}
          todayWorkoutName={todayProgram.name}
          onClose={() => setShowActiveWorkout(false)}
          onConnect={connectCoachForActiveWorkout}
          onEndSession={() => {
            setShowActiveWorkout(false);
            handleEndSession();
          }}
          onSendFormVideo={(exerciseName) => navigation.navigate('FormReview', { exerciseName, hasLiveCoach: true })}
          onFormCue={(cue) => {
            if (!realtimeCoach.isConnected) return;
            const now = Date.now();
            const cooldownMs = cue.severity === 'positive' ? 20_000 : 10_000;
            if (now - lastFormCueSentAtRef.current < cooldownMs) return;
            lastFormCueSentAtRef.current = now;
            // Frame as first-person observations so Serena treats them as her
            // own sight, not as external data — prevents "I can't see you" replies.
            const what = cue.description ?? cue.cue;
            const reaction = cue.severity === 'positive'
              ? `Say something encouraging right now: "${cue.cue}"`
              : `Give this correction right now: "${cue.cue}"`;
            realtimeCoach.sendContextualUpdate(
              `[VISION] You can see: ${what}. ${reaction}. Speak immediately — do not mention the vision system.`,
            );
          }}
          onRepEvent={(event) => {
            if (!realtimeCoach.isConnected) return;
            if (event.type === 'rep') {
              realtimeCoach.sendContextualUpdate(
                `[VISION] You just watched rep ${event.repNumber} complete. Say "${event.repNumber}!" out loud RIGHT NOW. Do not wait for the athlete to respond — they are lifting and cannot speak. Keep counting every rep as it comes.`,
              );
            } else if (event.type === 'rest_start') {
              realtimeCoach.sendContextualUpdate(
                `[VISION] You can see the athlete has stopped — they finished ${event.totalReps} reps and are now resting. Speak up now: acknowledge the set with energy, ask where they felt it, then ask difficulty 1-10.`,
              );
            } else if (event.type === 'rest_end') {
              realtimeCoach.sendContextualUpdate(
                `[VISION] You can see the athlete moving again — they are starting their next set. Fire them up RIGHT NOW with a quick setup cue, then count from rep 1 as you watch them go.`,
              );
            }
          }}
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 10,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.black,
  },
  tabBtn: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBtnActive: { borderColor: C.border, backgroundColor: C.dark },
  tabBtnText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_500Medium' },
  tabBtnTextActive: { color: C.green },
  floatingRestTimer: {
    position: 'absolute',
    right: 16,
    bottom: 94,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  floatingRestEyebrow: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1,
  },
  floatingRestValue: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 1,
    lineHeight: 24,
    marginTop: 2,
  },
  floatingRestSkipBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  floatingRestSkipText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
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
  aiBarAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginTop: 1,
  },
  aiBarIcon: { fontSize: 16, marginTop: 1, flexShrink: 0 },
  aiBarText: { flex: 1, fontSize: 12.5, lineHeight: 20, color: '#bbb', fontFamily: 'DMSans_400Regular' },
  workoutRow: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dayBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBadgeText: { fontSize: 10, fontFamily: 'SpaceMono_400Regular' },
  workoutInfo: { flex: 1, minWidth: 0 },
  workoutName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_500Medium' },
  workoutMeta: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2, fontFamily: 'DMSans_400Regular' },
  goBtn: { backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  goBtnText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 12 },
  completeChip: { backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenStrongBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center' },
  completeChipText: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 11 },
  previewChip: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center' },
  previewChipPast: { backgroundColor: 'transparent', borderColor: C.border },
  previewChipText: { color: C.muted, fontFamily: 'DMSans_500Medium', fontSize: 11 },
  // Today shortcut card (shown under "Unlock AI Workouts" for free users)
  todayShortcutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.orange,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    gap: 12,
  },
  todayShortcutEyebrow: { fontSize: 10, color: C.orange, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 2 },
  todayShortcutName: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 2 },
  todayShortcutMeta: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  todayShortcutBtn: { backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  todayShortcutBtnText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 13 },
  // Workout preview modal
  previewModalEyebrow: { fontSize: 10, color: C.orange, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  previewModalTitle: { fontSize: 22, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 2 },
  previewModalMeta: { fontSize: 13, color: 'rgba(255,255,255,0.72)', fontFamily: 'DMSans_400Regular', marginBottom: 4 },
  previewExRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,255,135,0.09)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,255,135,0.28)', padding: 12 },
  previewExNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  previewExNumText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 13 },
  previewExName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_500Medium' },
  previewExSets: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: 'DMSans_400Regular', marginTop: 1 },
  previewExActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewDemoBtn: { minWidth: 36, height: 36, borderRadius: 18, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  previewDemoText: { color: C.orange, fontSize: 11, fontFamily: 'SpaceMono_400Regular' },
  previewWatchBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  previewWatchText: { color: '#000', fontSize: 14 },
  exItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    backgroundColor: 'rgba(0,255,135,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.28)',
    borderRadius: 12,
    marginBottom: 7,
  },
  exItemDone: { opacity: 0.5 },
  exNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exNumText: { fontSize: 11, fontFamily: 'SpaceMono_400Regular', color: C.muted },
  exInfo: { flex: 1, minWidth: 0 },
  exName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_400Regular' },
  exNameDone: { textDecorationLine: 'line-through' },
  exSets: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2, fontFamily: 'DMSans_400Regular' },
  exLogSummary: { fontSize: 11, color: C.green, marginTop: 4, fontFamily: 'DMSans_700Bold' },
  exLogBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    minHeight: 36,
    justifyContent: 'center',
  },
  exLogText: { fontSize: 11, fontFamily: 'SpaceMono_400Regular', color: C.green },
  exDemoBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,138,60,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,138,60,0.35)',
    minHeight: 34,
    justifyContent: 'center',
  },
  exDemoText: { fontSize: 10, fontFamily: 'SpaceMono_400Regular', color: C.orange },
  exFormReviewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.35)',
    minHeight: 34,
    justifyContent: 'center',
  },
  exFormReviewText: { fontSize: 10, fontFamily: 'SpaceMono_400Regular', color: C.blue },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
  },
  weeklyMetricLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 4,
  },
  weeklyMetricValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 34, lineHeight: 36, color: C.text },
  weeklyMetricSub: { fontSize: 12, color: C.green, fontFamily: 'DMSans_400Regular' },
  emptyText: { color: C.muted, fontSize: 13, lineHeight: 20, fontFamily: 'DMSans_400Regular' },
  historyTitle: { fontSize: 14, color: C.text, fontFamily: 'DMSans_500Medium' },
  historyMeta: { fontSize: 11, color: C.muted, marginTop: 2, fontFamily: 'DMSans_400Regular' },
  searchInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    color: C.text,
    paddingHorizontal: 16,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    marginBottom: 12,
  },
  libraryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  libCard: {
    width: '47%',
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.22)',
    borderRadius: 16,
    padding: 12,
  },
  libIcon: { fontSize: 26, marginBottom: 5 },
  libName: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium' },
  libMeta: { fontSize: 10, color: C.muted, fontFamily: 'DMSans_400Regular' },
  catPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  catPillActive: {
    backgroundColor: 'rgba(0,255,135,0.15)',
    borderColor: C.green,
  },
  catPillText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_500Medium' },
  catPillTextActive: { color: C.green },
  btnPrimary: {
    backgroundColor: C.green,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  demoVideoBtn: {
    minWidth: 112,
    flex: 0.9,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  demoVideoBtnText: {
    fontSize: 13,
    textAlign: 'center',
  },
  // AI Coach Suggested Workout card
  aiWorkoutCard: {
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderWidth: 1.5,
    borderColor: C.greenStrongBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  aiWorkoutHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  aiWorkoutEyebrow: { fontSize: 9, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  aiWorkoutName: { fontSize: 18, color: C.text, fontFamily: 'DMSans_700Bold' },
  aiWorkoutMeta: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  aiWorkoutDismiss: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  aiWorkoutDismissText: { color: C.muted, fontSize: 12 },
  aiWorkoutNote: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular', fontStyle: 'italic', marginBottom: 12, lineHeight: 18 },
  aiWorkoutExercises: { gap: 8, marginBottom: 14 },
  aiWorkoutExRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiWorkoutExNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, textAlign: 'center', lineHeight: 20, fontSize: 11, color: C.green, fontFamily: 'DMSans_700Bold' },
  aiWorkoutExName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_500Medium' },
  aiWorkoutExDetail: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  aiWorkoutMore: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', textAlign: 'center', marginTop: 4 },
  aiWorkoutStartBtn: { backgroundColor: C.green, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  aiWorkoutStartBtnText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 14, letterSpacing: 0.5 },
  quickToolsCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  quickToolsToggle: {
    marginBottom: 2,
  },
  quickToolsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  quickToolsChevronWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  quickToolsChevron: {
    fontSize: 18,
    lineHeight: 18,
    fontFamily: 'DMSans_700Bold',
  },
  quickToolsEyebrow: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 5,
  },
  quickToolsTitle: {
    fontSize: 18,
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  quickToolsBody: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.72)',
    fontFamily: 'DMSans_400Regular',
  },
  quickWorkoutChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  quickWorkoutFocusChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    borderRadius: 999,
  },
  quickWorkoutFocusChipText: {
    color: C.text,
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
  },
  quickWorkoutChip: {
    flex: 1,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    borderRadius: 12,
    paddingVertical: 12,
  },
  quickWorkoutChipText: {
    color: C.text,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
  },
  quickWorkoutPrimaryBtn: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginBottom: 10,
  },
  quickWorkoutPrimaryBtnText: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
  },
  quickToolsFootnote: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'DMSans_400Regular',
  },
  premiumGateCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
  },
  premiumGateEyebrow: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 8,
  },
  premiumGateTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: 1.2,
  },
  premiumGateBody: {
    marginTop: 10,
    color: C.muted,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'DMSans_400Regular',
  },
  premiumList: {
    gap: 8,
    marginTop: 14,
    marginBottom: 16,
  },
  premiumListItem: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'DMSans_400Regular',
  },
  btnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnGhostText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '88%',
  },
  logModalScroll: {
    flex: 1,
  },
  logModalScrollContent: {
    paddingBottom: 60,
  },
  logModalDragArea: {
    paddingBottom: 4,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    letterSpacing: 2,
    color: C.text,
    marginBottom: 16,
  },
  modalMeta: {
    fontSize: 13,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginBottom: 8,
  },
  formLabel: {
    fontSize: 10,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 5,
  },
  formInput: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    marginBottom: 12,
  },
  exerciseExampleText: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 17,
    fontFamily: 'DMSans_400Regular',
    marginTop: -6,
    marginBottom: 12,
    opacity: 0.8,
  },
  exercisePlanText: {
    color: C.green,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'DMSans_700Bold',
    marginTop: -6,
    marginBottom: 6,
  },
  modalBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  demoInfoCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  demoVisualCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  demoVisualAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  demoVisualTitle: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  demoVisualBody: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  demoInfoLabel: {
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  demoInfoBody: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
  demoPromptBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  voiceHintText: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'DMSans_400Regular',
    marginTop: -2,
    marginBottom: 12,
  },
  restTimerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  restTimerEyebrow: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 1,
  },
  restTimerValue: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    marginTop: 2,
  },
  restTimerSkipBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  restTimerSkipText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  lockedInput: {
    justifyContent: 'center',
    marginBottom: 16,
    minHeight: 68,
  },
  lockedInputText: {
    color: C.text,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
  },
  lockedInputSubtext: {
    color: C.orange,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'DMSans_400Regular',
    marginTop: 4,
  },
  // Exercise card extras
  exActions: { flexDirection: 'row', gap: 6, marginTop: 6 },
  exWatchBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    minHeight: 34,
    justifyContent: 'center',
  },
  exWatchText: { fontSize: 10, fontFamily: 'SpaceMono_400Regular', color: C.blue },
  coachPortraitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  coachPortraitImage: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'transparent',
  },
  coachImagePreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  coachImagePreviewCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
  },
  coachImagePreviewTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 20,
    marginBottom: 14,
  },
  coachImagePreviewImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 24,
    backgroundColor: 'transparent',
    marginBottom: 16,
  },
  coachImagePreviewCloseBtn: {
    minWidth: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachImagePreviewCloseText: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
  coachPortraitEyebrow: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  coachPortraitTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 2,
  },
  coachPortraitSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  // Voice toggle
  voiceToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  voiceToggleLabel: { flex: 1, fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  voiceInfo: {
    backgroundColor: C.orangeSoft,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 10,
    padding: 8,
    marginBottom: 10,
  },
  voiceInfoText: { fontSize: 10, color: C.orange, fontFamily: 'SpaceMono_400Regular', lineHeight: 16 },
  // Session active card
  sessionActiveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    gap: 12,
  },
  sessionTimer: { fontFamily: 'BebasNeue_400Regular', fontSize: 36, color: C.green, lineHeight: 38 },
  sessionTrack: { height: 4, backgroundColor: C.border, borderRadius: 2, marginTop: 4, marginBottom: 4 },
  sessionFill: { height: 4, backgroundColor: C.green, borderRadius: 2 },
  sessionSub: { fontSize: 10, color: C.muted, fontFamily: 'DMSans_400Regular' },
  endSessionBtn: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  endSessionText: { fontSize: 12, color: C.orange, fontFamily: 'SpaceMono_400Regular' },
  workoutCoachBar: {
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.24)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  workoutCoachBarTitle: {
    color: C.green,
    fontSize: 10,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  workoutCoachBarText: {
    fontSize: 13,
    lineHeight: 19,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
  },
  workoutCoachBarDebug: {
    marginTop: 8,
    fontSize: 10,
    lineHeight: 14,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },
  workoutCoachControls: {
    marginTop: 10,
    flexDirection: 'row',
  },
  workoutCoachMicBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  workoutCoachMicBtnText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 13,
  },
  // Voice log button
  // ── Video demo thumbnail ──────────────────────────────────────────────────
  videoThumb: {
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
  },
  videoThumbImg: { width: '100%', height: '100%' },
  videoThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  videoPlayBtn: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,255,135,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  videoPlayIcon: { color: '#000', fontSize: 14, marginLeft: 2 },
  videoThumbBadge: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  videoThumbBadgeText: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 0.8,
  },

  // ── AI Voice logging ──────────────────────────────────────────────────────
  voiceLockedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,107,53,0.08)',
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  voiceLockedIcon: { fontSize: 18 },
  voiceLockedTitle: {
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  voiceLockedSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  voiceRecordingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.5)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  voiceRecordingPulse: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  voiceRecordingIcon: { fontSize: 22 },
  voiceRecordingTitle: {
    color: '#ef4444',
    fontFamily: 'DMSans_500Medium',
    fontSize: 13.5,
    marginBottom: 2,
  },
  voiceRecordingSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  voiceStopBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceStopText: { color: '#fff', fontSize: 10, fontFamily: 'DMSans_500Medium' },
  voiceProcessingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  voiceProcessingText: {
    color: C.green,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  voiceLogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,255,135,0.08)',
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  voiceLogBtnActive: {
    backgroundColor: 'rgba(255,107,53,0.1)',
    borderColor: C.orangeBorder,
  },
  voiceLogIcon: { fontSize: 22 },
  voiceLogText: { fontSize: 13, color: C.green, fontFamily: 'DMSans_500Medium' },
  voiceLogSub: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },

  // Placeholder helper — used as placeholderTextColor reference (not a real style)
  placeholder: { color: 'rgba(255,255,255,0.22)' } as { color: string },

  // Per-set table
  setHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  setLabel: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  setNumBadge: {
    width: 28,
    height: 36,
    borderRadius: 8,
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  setNumText: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
  },
  setInput: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    minHeight: 42,
  },
  setRemoveBtn: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  setRemoveText: { fontSize: 14, color: C.muted },

  // Rest time selector
  restRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: -2,
    paddingLeft: 36,
    gap: 8,
  },
  restLabel: {
    fontSize: 10,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    flexShrink: 0,
  },
  restPills: { flexDirection: 'row', gap: 6, paddingRight: 8 },
  restPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
  },
  restPillActive: {
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  restPillText: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular' },
  restPillTextActive: { color: C.green },

  lastSessionBanner: {
    backgroundColor: 'rgba(52,211,153,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 4,
  },
  lastSessionLabel: {
    fontSize: 11,
    color: C.green,
    fontFamily: 'DMSans_500Medium',
  },
  lastSessionValue: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },
  lastSessionHistoryList: {
    marginTop: 4,
    gap: 2,
  },
  lastSessionHistoryItem: {
    fontSize: 12,
    lineHeight: 18,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
  },
  prBadge: {
    backgroundColor: 'rgba(251,191,36,0.15)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  prBadgeText: {
    fontSize: 13,
    color: '#fbbf24',
    fontFamily: 'DMSans_700Bold',
    letterSpacing: 0.5,
  },

  demoBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
  },
  demoBtnText: {
    fontSize: 12,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
  },

  // Add set button
  addSetBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 2,
  },
  addSetText: {
    fontSize: 13,
    color: C.green,
    fontFamily: 'DMSans_500Medium',
  },

  // kept for backwards compat (no longer used directly in JSX)
  repsRow: { flexDirection: 'row', gap: 10, marginBottom: 0 },

  // Smart workout description / auto-fill
  descInputRow: {
    marginBottom: 10,
    gap: 6,
  },
  descInputField: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 12,
    padding: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    minHeight: 44,
  },
  voiceFillBtn: {
    backgroundColor: C.green,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  voiceFillBtnText: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
  },

  // ── Warm-up section ──────────────────────────────────────────────────────
  warmupCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  warmupHeader: { marginBottom: 10 },
  warmupTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    letterSpacing: 1,
  },
  warmupMeta: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'DMSans_400Regular',
    marginTop: 2,
  },
  warmupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    gap: 10,
  },
  warmupStepIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  warmupStepLabel: {
    fontSize: 13,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
  },
  warmupStepDetail: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'DMSans_400Regular',
    marginTop: 1,
  },
  warmupStepDone: {
    color: C.green,
    textDecorationLine: 'line-through',
  },
  warmupCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
  },
  warmupCheckDone: {
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  warmupCheckText: {
    color: C.green,
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
    lineHeight: 15,
  },

  // ── Cardio finisher section ──────────────────────────────────────────────
  cardioCard: {
    backgroundColor: 'rgba(59,130,246,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.25)',
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    marginBottom: 10,
  },
  cardioHeader: { marginBottom: 10 },
  cardioTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    color: C.blue,
    letterSpacing: 1,
  },
  cardioMeta: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'DMSans_400Regular',
    marginTop: 2,
  },
  hrZoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,255,135,0.08)',
    borderRadius: 10,
    padding: 10,
    gap: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.2)',
  },
  hrZoneIcon: { fontSize: 22 },
  hrZoneLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.68)',
    fontFamily: 'DMSans_400Regular',
  },
  hrZoneValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    color: C.green,
    letterSpacing: 0.5,
  },
  hrZoneBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,255,135,0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  hrZoneBadgeText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 16,
    color: C.green,
  },
  hrZoneBadgeSub: {
    fontSize: 9,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },
  cardioOptionHeader: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.56)',
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  cardioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  cardioOptionIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  cardioOptionLabel: {
    fontSize: 13,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
  },
  cardioOptionDetail: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'DMSans_400Regular',
    marginTop: 1,
  },
  cardioDoneBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: C.blue,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },
  cardioDoneBtnActive: {
    backgroundColor: C.greenSoft,
    borderColor: C.greenStrongBorder,
  },
  cardioDoneBtnText: {
    color: C.blue,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
  },
  cardioDoneBtnTextActive: {
    color: C.green,
  },
});
