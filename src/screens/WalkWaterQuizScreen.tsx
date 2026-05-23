/**
 * WalkWaterQuizScreen
 *
 * Walk & Water Challenge Edition onboarding:
 *   Step 1–5: 5 quiz questions about current habits + goals
 *   Step 6:   Plan reveal (personalized step & water targets)
 *   Step 7:   Paywall ($4.99/wk or $14.99/mo)
 *   Step 8:   Sign-up (name + email) or log in
 *
 * On completion, saves quiz answers + plan and navigates into the
 * WalkWater tab navigator via the auth/navigation layer.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DeviceEventEmitter } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { PROFILE_STORAGE_KEY } from '@/screens/GoalSetupScreen';
import { purchasePackageByType } from '@/lib/revenuecat';
import type { WalkWaterStackParamList } from '@/navigation/WalkWaterNavigator';
import {
  type BestWalkTime,
  type ChallengeDuration,
  type DailyStepsRange,
  type DailyWaterRange,
  type WalkGoal,
  type WalkWaterQuizAnswers,
  buildWalkWaterPlan,
  getWalkWaterQuizAnswers,
  isWWUpgraded,
  saveWalkWaterPlan,
  saveWalkWaterQuizAnswers,
  WALK_WATER_QUIZ_DONE_EVENT,
} from '@/lib/walkWaterMode';
import { clearConversation } from '@/lib/coachDM';
import { scheduleWalkWaterNotifications } from '@/lib/notifications';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black: '#050A14',
  card: '#0D1B2A',
  border: '#1A2E45',
  blue: '#0EA5E9',
  teal: '#06B6D4',
  blueSoft: 'rgba(14,165,233,0.1)',
  blueBorder: 'rgba(14,165,233,0.25)',
  text: '#F0F8FF',
  muted: '#6B8BA4',
  accent: '#38BDF8',
};

const { width: W } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

type QuizStep = 'steps' | 'water' | 'goal' | 'gender' | 'time' | 'days' | 'plan' | 'paywall' | 'signup';

const STEP_ORDER: QuizStep[] = ['steps', 'water', 'goal', 'gender', 'time', 'days', 'plan', 'signup'];
const QUIZ_STEPS_BASE: QuizStep[] = ['steps', 'water', 'goal', 'gender', 'time', 'days'];

// Step order used when the quiz runs as a re-quiz (signed-in returning
// completer): no gender step, no signup step. Per RECONCILED_DECISIONS_V2 §2.2.
const STEP_ORDER_REQUIZ: QuizStep[] = ['steps', 'water', 'goal', 'time', 'days', 'plan'];

// ─── Option configs ───────────────────────────────────────────────────────────

const STEPS_OPTIONS: Array<{ value: DailyStepsRange; label: string; sub: string }> = [
  { value: 'under2k', label: 'Under 2,000', sub: 'Mostly sedentary' },
  { value: '2to5k',   label: '2,000 – 5,000', sub: 'Light daily movement' },
  { value: '5to8k',   label: '5,000 – 8,000', sub: 'Moderately active' },
  { value: 'over8k',  label: '8,000+', sub: 'Already walking regularly' },
];

const WATER_OPTIONS: Array<{ value: DailyWaterRange; label: string; sub: string }> = [
  { value: 'under4', label: 'Under 4 glasses', sub: 'I forget to drink water' },
  { value: '4to6',   label: '4 – 6 glasses', sub: 'Some days are better' },
  { value: '6to8',   label: '6 – 8 glasses', sub: 'Pretty consistent' },
  { value: 'over8',  label: '8+ glasses', sub: 'Hydration is a priority' },
];

const GOAL_OPTIONS: Array<{ value: WalkGoal; label: string; emoji: string }> = [
  { value: 'lose_weight',  label: 'Lean out',             emoji: '🔥' },
  { value: 'more_energy',  label: 'More energy',          emoji: '⚡' },
  { value: 'build_habit',  label: 'Build confidence', emoji: '💪' },
  { value: 'feel_better',  label: 'Feel better daily',    emoji: '✨' },
];

const GENDER_OPTIONS: Array<{ value: 'male' | 'female' | 'other'; label: string; emoji: string }> = [
  { value: 'female', label: 'Woman', emoji: '👩' },
  { value: 'male',   label: 'Man',   emoji: '👨' },
  { value: 'other',  label: 'Prefer not to say', emoji: '🙂' },
];

const TIME_OPTIONS: Array<{ value: BestWalkTime; label: string; emoji: string }> = [
  { value: 'morning',   label: 'Morning',   emoji: '🌅' },
  { value: 'lunch',     label: 'Lunch',     emoji: '☀️' },
  { value: 'afternoon', label: 'Afternoon', emoji: '🌤' },
  { value: 'evening',   label: 'Evening',   emoji: '🌆' },
];

const DAY_OPTIONS: Array<{ value: ChallengeDuration; label: string; badge: string; sub: string }> = [
  { value: 3,  label: '3 Days',  badge: 'RESET',          sub: 'Quick reset, minimum commitment'       },
  { value: 7,  label: '7 Days',  badge: 'POPULAR ⭐',     sub: 'One week of consistent walking'        },
  { value: 14, label: '14 Days', badge: 'HABIT BUILDER',  sub: 'Two weeks to solidify the habit'       },
  { value: 21, label: '21 Days', badge: 'TRANSFORMATION', sub: 'The habit-formation sweet spot'        },
];

// ─── WalkWaterQuizScreen ──────────────────────────────────────────────────────

export default function WalkWaterQuizScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<WalkWaterStackParamList, 'WalkWaterQuiz'>>();
  const { session } = useAuth();

  // Re-quiz mode: entered from "Don't Stop Now" banner. User is already
  // signed in, has completed at least one challenge, and should not be asked
  // to re-authenticate or re-state their gender.
  // Signin mode: returning user who signed out — skip the quiz entirely and
  // land directly on the login screen so they can get back in without
  // re-answering questions they already answered.
  const shortQuizMode = route.params?.mode;
  const isShortQuiz = shortQuizMode === 'requiz' || shortQuizMode === 'upgrade';
  const isUpgradeQuiz = shortQuizMode === 'upgrade';
  const isSignIn = shortQuizMode === 'signin';
  const initialStepOrder = isSignIn ? (['signup'] as QuizStep[]) : (isShortQuiz ? STEP_ORDER_REQUIZ : STEP_ORDER);

  const [stepOrder, setStepOrder] = useState<QuizStep[]>(initialStepOrder);
  const [hasCompletedChallenge, setHasCompletedChallenge] = useState(isShortQuiz);
  const [step, setStep] = useState<QuizStep>(isSignIn ? 'signup' : 'steps');
  const [dailySteps, setDailySteps] = useState<DailyStepsRange | null>(null);
  const [dailyWater, setDailyWater] = useState<DailyWaterRange | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState<WalkGoal | null>(null);
  const [gender, setGender] = useState<'male' | 'female' | 'other' | null>(null);
  const [bestWalkTime, setBestWalkTime] = useState<BestWalkTime | null>(null);
  const [challengeDays, setChallengeDays] = useState<ChallengeDuration>(3);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signup' | 'login'>(isSignIn ? 'login' : 'signup');
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'weekly' | 'monthly'>('monthly');

  // Pre-populate from previous challenge. Longer durations unlock only after:
  // 1) the user upgraded, or
  // 2) they are explicitly starting a new challenge via re-quiz after
  //    completing the initial 3-day challenge.
  //
  // In re-quiz mode the signup step is already filtered out
  // (see STEP_ORDER_REQUIZ above) — preserve that when also filtering gender
  // so we don't accidentally re-introduce the auth gate.
  useEffect(() => {
    Promise.all([getWalkWaterQuizAnswers(), isWWUpgraded()]).then(([prev, upgraded]) => {
      if (upgraded) setHasCompletedChallenge(true);
      if (prev?.gender) {
        setGender(prev.gender);
        const base = isShortQuiz ? STEP_ORDER_REQUIZ : STEP_ORDER;
        setStepOrder(base.filter((s) => s !== 'gender'));
      }
    }).catch(() => null);
  }, [isShortQuiz]);

  // Re-quiz finish: signed-in returning completer. No auth gate. Save the
  // plan locally, emit done event, and replace into the WalkWater tabs so
  // the new challenge starts immediately.
  const finishShortQuiz = useCallback(async () => {
    if (!dailySteps || !dailyWater || !primaryGoal || !bestWalkTime || !challengeDays) return;
    setSubmitting(true);
    setAuthError(null);
    try {
      const answers: WalkWaterQuizAnswers = {
        dailySteps,
        dailyWater,
        primaryGoal,
        gender: gender ?? 'other',
        bestWalkTime,
        challengeDays,
      };
      const reQuizPlan = buildWalkWaterPlan(answers);
      await saveWalkWaterQuizAnswers(answers);
      await saveWalkWaterPlan(reQuizPlan);
      await scheduleWalkWaterNotifications(reQuizPlan).catch(() => null);
      await clearConversation();
      // Reset the post-challenge offer expiry so the next ChallengeComplete
      // run starts a fresh 48h window when this challenge ends.
      await AsyncStorage.removeItem('apex.ww.challengeOfferExpiry').catch(() => null);
      DeviceEventEmitter.emit(WALK_WATER_QUIZ_DONE_EVENT);
      (navigation as any).replace('WalkWaterTabs');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Could not start your next challenge. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [dailySteps, dailyWater, primaryGoal, gender, bestWalkTime, challengeDays, navigation]);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const animateToNext = useCallback((next: QuizStep) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
      Animated.timing(slideAnim, { toValue: -30, duration: 150, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
    ]).start(() => {
      slideAnim.setValue(30);
      setStep(next);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
        Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
      ]).start();
    });
  }, [fadeAnim, slideAnim]);

  const goNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    const idx = stepOrder.indexOf(step);
    const next = stepOrder[idx + 1];
    if (next) animateToNext(next);
  }, [step, stepOrder, animateToNext]);

  const goBack = useCallback(() => {
    const idx = stepOrder.indexOf(step);
    const prev = stepOrder[idx - 1];
    if (prev) animateToNext(prev);
  }, [step, stepOrder, animateToNext]);

  const handleSignUp = useCallback(async () => {
    if (authMode === 'signup' && !displayName.trim()) { setAuthError('Add your name to continue.'); return; }
    if (!email.trim()) { setAuthError('Email is required.'); return; }
    if (!password || password.length < 6) { setAuthError('Password must be at least 6 characters.'); return; }

    setSubmitting(true);
    setAuthError(null);

    try {
      if (authMode === 'signup') {
        if (!dailySteps || !dailyWater || !primaryGoal || !gender || !bestWalkTime || !challengeDays) {
          setAuthError('Please complete the quiz steps first.');
          return;
        }
        const answers: WalkWaterQuizAnswers = { dailySteps, dailyWater, primaryGoal, gender, bestWalkTime, challengeDays };
        const plan = buildWalkWaterPlan(answers);
        // Save plan locally first — before auth so a signup error doesn't leave plan null
        await saveWalkWaterQuizAnswers(answers);
        await saveWalkWaterPlan(plan);
        await scheduleWalkWaterNotifications(plan).catch(() => null);
        await clearConversation();
        await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
          displayName: displayName.trim(),
          goal: primaryGoal,
          gender: gender,
        }));
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        // Ignore "already registered" — plan is saved, user can proceed
        if (error && !error.message.toLowerCase().includes('already registered')) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        // Save plan for returning users who went through the quiz again
        if (dailySteps && dailyWater && primaryGoal && gender && bestWalkTime) {
          const answers: WalkWaterQuizAnswers = { dailySteps, dailyWater, primaryGoal, gender, bestWalkTime, challengeDays };
          const returningPlan = buildWalkWaterPlan(answers);
          await saveWalkWaterPlan(returningPlan);
          await scheduleWalkWaterNotifications(returningPlan).catch(() => null);
        }
      }
      DeviceEventEmitter.emit(WALK_WATER_QUIZ_DONE_EVENT);
      (navigation as any).replace('WalkWaterTabs');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [authMode, displayName, email, password, dailySteps, dailyWater, primaryGoal, gender, bestWalkTime, challengeDays, navigation]);

  const quizSteps = stepOrder.filter((s) => QUIZ_STEPS_BASE.includes(s));
  const quizProgress = quizSteps.indexOf(step as QuizStep);
  const isQuizStep = quizProgress >= 0;
  const stepLabel = isQuizStep ? `${quizProgress + 1} of ${quizSteps.length}` : '';

  const plan = dailySteps && dailyWater && primaryGoal && bestWalkTime && challengeDays
    ? buildWalkWaterPlan({ dailySteps, dailyWater, primaryGoal, bestWalkTime, challengeDays })
    : null;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Progress bar — quiz steps only */}
      {isQuizStep && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((quizProgress + 1) / quizSteps.length) * 100}%` }]} />
        </View>
      )}

      {/* Back button */}
      {stepOrder.indexOf(step) > 0 && (
        <Pressable style={[styles.backBtn, { top: insets.top + 16 }]} onPress={goBack} hitSlop={12}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
      )}

      <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Step: Daily Steps ── */}
          {step === 'steps' && (
            <>
              <View style={styles.eyebrowRow}>
                <Text style={styles.stepCounter}>{stepLabel}</Text>
                <Text style={styles.eyebrow}>WALK + WATER CHALLENGE</Text>
              </View>
              <Text style={styles.question}>How many steps do you currently average per day?</Text>
              <View style={styles.options}>
                {STEPS_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.optionCard, dailySteps === opt.value && styles.optionCardSelected]}
                    onPress={() => { setDailySteps(opt.value); setTimeout(goNext, 220); }}
                  >
                    <Text style={[styles.optionLabel, dailySteps === opt.value && styles.optionLabelSelected]}>{opt.label}</Text>
                    <Text style={styles.optionSub}>{opt.sub}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* ── Step: Daily Water ── */}
          {step === 'water' && (
            <>
              <View style={styles.eyebrowRow}>
                <Text style={styles.stepCounter}>{stepLabel}</Text>
                <Text style={styles.eyebrow}>WALK + WATER CHALLENGE</Text>
              </View>
              <Text style={styles.question}>How much water do you drink each day?</Text>
              <View style={styles.options}>
                {WATER_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.optionCard, dailyWater === opt.value && styles.optionCardSelected]}
                    onPress={() => { setDailyWater(opt.value); setTimeout(goNext, 220); }}
                  >
                    <Text style={[styles.optionLabel, dailyWater === opt.value && styles.optionLabelSelected]}>{opt.label}</Text>
                    <Text style={styles.optionSub}>{opt.sub}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* ── Step: Goal ── */}
          {step === 'goal' && (
            <>
              <View style={styles.eyebrowRow}>
                <Text style={styles.stepCounter}>{stepLabel}</Text>
                <Text style={styles.eyebrow}>WALK + WATER CHALLENGE</Text>
              </View>
              <Text style={styles.question}>What's your main goal?</Text>
              <View style={styles.goalGrid}>
                {GOAL_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.goalCard, primaryGoal === opt.value && styles.goalCardSelected]}
                    onPress={() => { setPrimaryGoal(opt.value); setTimeout(goNext, 220); }}
                  >
                    <Text style={styles.goalEmoji}>{opt.emoji}</Text>
                    <Text style={[styles.goalLabel, primaryGoal === opt.value && styles.goalLabelSelected]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* ── Step: Gender ── */}
          {step === 'gender' && (
            <>
              <View style={styles.eyebrowRow}>
                <Text style={styles.stepCounter}>{stepLabel}</Text>
                <Text style={styles.eyebrow}>WALK + WATER CHALLENGE</Text>
              </View>
              <Text style={styles.question}>How do you identify?</Text>
              <Text style={styles.questionSub}>Helps us personalize your plan and coaching experience.</Text>
              <View style={styles.goalGrid}>
                {GENDER_OPTIONS.filter((o) => o.value !== 'other').map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.goalCard, gender === opt.value && styles.goalCardSelected]}
                    onPress={() => { setGender(opt.value); setTimeout(goNext, 220); }}
                  >
                    <Text style={styles.goalEmoji}>{opt.emoji}</Text>
                    <Text style={[styles.goalLabel, gender === opt.value && styles.goalLabelSelected]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={[styles.optionCard, { marginTop: 10 }, gender === 'other' && styles.optionCardSelected]}
                onPress={() => { setGender('other'); setTimeout(goNext, 220); }}
              >
                <View style={styles.optionRow}>
                  <Text style={[styles.optionLabel, gender === 'other' && styles.optionLabelSelected]}>🙂  Prefer not to say</Text>
                </View>
              </Pressable>
            </>
          )}

          {/* ── Step: Best Walk Time ── */}
          {step === 'time' && (
            <>
              <View style={styles.eyebrowRow}>
                <Text style={styles.stepCounter}>{stepLabel}</Text>
                <Text style={styles.eyebrow}>WALK + WATER CHALLENGE</Text>
              </View>
              <Text style={styles.question}>When's the best time for your daily walk?</Text>
              <View style={styles.goalGrid}>
                {TIME_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.goalCard, bestWalkTime === opt.value && styles.goalCardSelected]}
                    onPress={() => { setBestWalkTime(opt.value); setTimeout(goNext, 220); }}
                  >
                    <Text style={styles.goalEmoji}>{opt.emoji}</Text>
                    <Text style={[styles.goalLabel, bestWalkTime === opt.value && styles.goalLabelSelected]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* ── Step: Challenge Duration ── */}
          {step === 'days' && (
            <>
              <View style={styles.eyebrowRow}>
                <Text style={styles.stepCounter}>{stepLabel}</Text>
                <Text style={styles.eyebrow}>WALK + WATER CHALLENGE</Text>
              </View>
              <Text style={styles.question}>How long is your challenge?</Text>
              <View style={styles.options}>
                {DAY_OPTIONS.map((opt) => {
                  const isLocked = !hasCompletedChallenge && opt.value !== 3;
                  const isSelected = challengeDays === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      style={[
                        styles.optionCard,
                        isSelected && styles.optionCardSelected,
                        isLocked && styles.durationCardLocked,
                      ]}
                      onPress={() => {
                        if (isLocked) return;
                        setChallengeDays(opt.value);
                        setTimeout(goNext, 220);
                      }}
                    >
                      <View style={styles.optionRow}>
                        <View>
                          <Text style={[
                            styles.optionLabel,
                            isSelected && styles.optionLabelSelected,
                            isLocked && styles.durationLabelLocked,
                          ]}>
                            {opt.label}
                          </Text>
                          <Text style={[styles.optionSub, isLocked && styles.durationSubLocked]}>
                            {opt.sub}
                          </Text>
                        </View>
                        {isLocked ? (
                          <View style={styles.lockChip}>
                            <Text style={styles.lockChipText}>🔒</Text>
                          </View>
                        ) : (
                          <View style={[styles.badge, isSelected && styles.badgeSelected]}>
                            <Text style={[styles.badgeText, isSelected && styles.badgeTextSelected]}>
                              {opt.badge}
                            </Text>
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {!hasCompletedChallenge && (
                <Text style={styles.lockCaption}>
                  7, 14, and 21 days unlock after you upgrade or finish the 3-day challenge and start a new one
                </Text>
              )}
            </>
          )}

          {/* ── Step: Plan Reveal ── */}
          {step === 'plan' && plan && (
            <>
              <Text style={styles.planHero}>Your{'\n'}Challenge Plan</Text>
              <Text style={styles.planSub}>Built around your habits and goal.</Text>

              <View style={styles.planCard}>
                <View style={styles.planRow}>
                  <View style={styles.planStat}>
                    <Text style={styles.planStatValue}>{plan.dailyStepGoal.toLocaleString()}</Text>
                    <Text style={styles.planStatLabel}>DAILY STEPS</Text>
                  </View>
                  <View style={styles.planDivider} />
                  <View style={styles.planStat}>
                    <Text style={styles.planStatValue}>{Math.round(plan.dailyWaterGoalOz / 8)}</Text>
                    <Text style={styles.planStatLabel}>GLASSES / DAY</Text>
                  </View>
                  <View style={styles.planDivider} />
                  <View style={styles.planStat}>
                    <Text style={styles.planStatValue}>{plan.challengeDays}</Text>
                    <Text style={styles.planStatLabel}>DAY CHALLENGE</Text>
                  </View>
                </View>
              </View>

              <View style={styles.planDetailCard}>
                <View style={styles.planDetailRow}>
                  <Text style={styles.planDetailIcon}>🎯</Text>
                  <View>
                    <Text style={styles.planDetailLabel}>YOUR GOAL</Text>
                    <Text style={styles.planDetailValue}>{plan.goalLabel}</Text>
                  </View>
                </View>
                <View style={styles.planDetailRow}>
                  <Text style={styles.planDetailIcon}>🕐</Text>
                  <View>
                    <Text style={styles.planDetailLabel}>BEST WALK TIME</Text>
                    <Text style={styles.planDetailValue}>{plan.walkTimeLabel}</Text>
                  </View>
                </View>
                <View style={styles.planDetailRow}>
                  <Text style={styles.planDetailIcon}>📈</Text>
                  <View>
                    <Text style={styles.planDetailLabel}>DAILY GOAL</Text>
                    <Text style={styles.planDetailValue}>Hit your steps and water every day</Text>
                  </View>
                </View>
              </View>

              <View style={styles.freeNotice}>
                <Text style={styles.freeNoticeText}>
                  {isUpgradeQuiz
                    ? '🎉 You unlocked Train + Fuel. Your upgraded WW plan is ready — we’ll drop you into your new experience now.'
                    : "🎉 The challenge is completely free — no credit card required.\nAt the end you'll have the option to continue with APEX."}
                </Text>
              </View>

              {isShortQuiz ? (
                <>
                  <Pressable
                    style={[styles.btnPrimary, submitting && styles.btnDisabled]}
                    onPress={finishShortQuiz}
                    disabled={submitting}
                  >
                    {submitting
                      ? <ActivityIndicator color="#000" />
                      : <Text style={styles.btnPrimaryText}>
                          {isUpgradeQuiz ? 'Build My Upgraded Plan →' : 'Start My Next Challenge →'}
                        </Text>
                    }
                  </Pressable>
                  {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
                </>
              ) : (
                <Pressable style={styles.btnPrimary} onPress={goNext}>
                  <Text style={styles.btnPrimaryText}>Start My Challenge →</Text>
                </Pressable>
              )}
            </>
          )}

          {/* ── Step: Paywall ── */}
          {step === 'paywall' && (
            <>
              <Text style={styles.planHero}>Unlock the{'\n'}Full Challenge</Text>
              <Text style={styles.planSub}>AI coach, daily tracking, and accountability built in.</Text>

              <View style={styles.paywallFeatures}>
                {[
                  { icon: '🤖', text: 'AI Walk & Water coach — daily check-ins & guidance' },
                  { icon: '📊', text: 'Progress dashboard — steps, hydration & streak' },
                  { icon: '🔔', text: 'Smart reminders at your best walk time' },
                  { icon: '🏆', text: 'Challenge leaderboard & community' },
                  { icon: '🎯', text: 'Weekly goals that adapt as you improve' },
                ].map((f) => (
                  <View key={f.text} style={styles.featureRow}>
                    <Text style={styles.featureIcon}>{f.icon}</Text>
                    <Text style={styles.featureText}>{f.text}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.planToggle}>
                <Pressable
                  style={[styles.planOption, selectedPlan === 'weekly' && styles.planOptionSelected]}
                  onPress={() => setSelectedPlan('weekly')}
                >
                  <Text style={[styles.planOptionTitle, selectedPlan === 'weekly' && styles.planOptionTitleSelected]}>Weekly</Text>
                  <Text style={[styles.planOptionPrice, selectedPlan === 'weekly' && styles.planOptionPriceSelected]}>$4.99 / week</Text>
                </Pressable>
                <Pressable
                  style={[styles.planOption, selectedPlan === 'monthly' && styles.planOptionSelected]}
                  onPress={() => setSelectedPlan('monthly')}
                >
                  <View style={styles.saveBadge}><Text style={styles.saveBadgeText}>SAVE 70%</Text></View>
                  <Text style={[styles.planOptionTitle, selectedPlan === 'monthly' && styles.planOptionTitleSelected]}>Monthly</Text>
                  <Text style={[styles.planOptionPrice, selectedPlan === 'monthly' && styles.planOptionPriceSelected]}>$14.99 / month</Text>
                </Pressable>
              </View>

              <Pressable
                style={styles.btnPrimary}
                onPress={async () => {
                  await purchasePackageByType(selectedPlan).catch(() => null);
                  goNext();
                }}
              >
                <Text style={styles.btnPrimaryText}>Start My Free Trial →</Text>
              </Pressable>
              <Text style={styles.legalText}>
                Free trial included. Cancel anytime.
              </Text>
            </>
          )}

          {/* ── Step: Sign Up / Login ── */}
          {step === 'signup' && (
            <>
              <Text style={styles.planHero}>{authMode === 'signup' ? 'Create Your\nAccount' : 'Welcome\nBack'}</Text>
              <Text style={styles.planSub}>
                {authMode === 'signup' ? 'Save your plan and track progress across devices.' : 'Log in to continue your challenge.'}
              </Text>

              {authMode === 'signup' && (
                <TextInput
                  style={styles.input}
                  placeholder="Your first name"
                  placeholderTextColor={WW.muted}
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              )}
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={WW.muted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
              />
              <TextInput
                style={styles.input}
                placeholder="Password (min 6 characters)"
                placeholderTextColor={WW.muted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={handleSignUp}
              />

              {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

              <Pressable style={[styles.btnPrimary, submitting && styles.btnDisabled]} onPress={handleSignUp} disabled={submitting}>
                {submitting
                  ? <ActivityIndicator color="#000" />
                  : <Text style={styles.btnPrimaryText}>{authMode === 'signup' ? 'Create Account & Start →' : 'Log In & Continue →'}</Text>
                }
              </Pressable>

              <Pressable
                onPress={() => {
                  if (authMode === 'login' && !dailySteps) {
                    // Quiz answers missing (signin-mode path skips the quiz).
                    // Restart from the beginning so they get a plan before signing up.
                    (navigation as any).replace('WalkWaterQuiz');
                  } else {
                    setAuthMode(authMode === 'signup' ? 'login' : 'signup');
                  }
                }}
                style={styles.switchAuthBtn}
              >
                <Text style={styles.switchAuthText}>
                  {authMode === 'signup' ? 'Already have an account? Log in' : "Don't have an account? Sign up"}
                </Text>
              </Pressable>
            </>
          )}

        </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WW.black },
  progressTrack: { height: 3, backgroundColor: WW.border, marginHorizontal: 0 },
  progressFill: { height: '100%', backgroundColor: WW.blue, borderRadius: 2 },
  backBtn: { position: 'absolute', left: 16, zIndex: 10 },
  backBtnText: { color: WW.muted, fontSize: 22 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 32 },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  stepCounter: { fontSize: 12, color: WW.muted, fontWeight: '600', letterSpacing: 0.5 },
  eyebrow: { fontSize: 9, color: WW.blue, fontWeight: '700', letterSpacing: 1.5 },

  question:    { fontSize: 26, color: WW.text, fontWeight: '800', lineHeight: 34, marginBottom: 28, letterSpacing: -0.3 },
  questionSub: { fontSize: 13, color: WW.muted, lineHeight: 19, marginTop: -20, marginBottom: 24, fontWeight: '500' },

  options: { gap: 10 },
  optionCard: {
    backgroundColor: WW.card, borderWidth: 1.5, borderColor: WW.border,
    borderRadius: 14, padding: 18,
  },
  optionCardSelected: { borderColor: WW.blue, backgroundColor: WW.blueSoft },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionLabel: { fontSize: 16, color: WW.text, fontWeight: '600' },
  optionLabelSelected: { color: WW.blue },
  optionSub: { fontSize: 12, color: WW.muted, marginTop: 3 },
  badge: { backgroundColor: 'rgba(14,165,233,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, color: WW.blue, fontWeight: '700', letterSpacing: 0.5 },
  badgeSelected: { backgroundColor: 'rgba(14,165,233,0.25)' },
  badgeTextSelected: { color: WW.accent },

  durationCardLocked:  { opacity: 0.35 },
  durationLabelLocked: { color: WW.muted },
  durationSubLocked:   { color: WW.muted },
  lockChip:     { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  lockChipText: { fontSize: 12 },
  lockCaption:  { fontSize: 12, color: WW.muted, textAlign: 'center', marginTop: 8, fontWeight: '500', opacity: 0.7 },

  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  goalCard: {
    width: (W - 58) / 2,
    backgroundColor: WW.card, borderWidth: 1.5, borderColor: WW.border,
    borderRadius: 14, padding: 20, alignItems: 'center', gap: 8,
  },
  goalCardSelected: { borderColor: WW.blue, backgroundColor: WW.blueSoft },
  goalEmoji: { fontSize: 28 },
  goalLabel: { fontSize: 13, color: WW.text, fontWeight: '600', textAlign: 'center' },
  goalLabelSelected: { color: WW.blue },

  planHero: {
    fontSize: 34, color: WW.text, fontWeight: '900', lineHeight: 40,
    letterSpacing: -0.6, marginBottom: 8,
  },
  planSub: { fontSize: 14, color: WW.muted, marginBottom: 28, lineHeight: 20 },

  planCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 18, padding: 20, marginBottom: 14,
  },
  planRow: { flexDirection: 'row', alignItems: 'center' },
  planStat: { flex: 1, alignItems: 'center' },
  planStatValue: { fontSize: 28, color: WW.blue, fontWeight: '900', letterSpacing: -0.5 },
  planStatLabel: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1, marginTop: 3 },
  planDivider: { width: 1, height: 40, backgroundColor: WW.border },

  planDetailCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 14, padding: 16, gap: 14, marginBottom: 24,
  },
  planDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planDetailIcon: { fontSize: 20, width: 28 },
  planDetailLabel: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  planDetailValue: { fontSize: 14, color: WW.text, fontWeight: '600' },

  paywallFeatures: { gap: 14, marginBottom: 28 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  featureIcon: { fontSize: 18, width: 24 },
  featureText: { fontSize: 14, color: WW.text, fontWeight: '500', flex: 1, lineHeight: 20 },

  planToggle: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  planOption: {
    flex: 1, backgroundColor: WW.card, borderWidth: 1.5, borderColor: WW.border,
    borderRadius: 14, padding: 16, alignItems: 'center', position: 'relative',
  },
  planOptionSelected: { borderColor: WW.blue, backgroundColor: WW.blueSoft },
  planOptionTitle: { fontSize: 14, color: WW.muted, fontWeight: '700', marginBottom: 4 },
  planOptionTitleSelected: { color: WW.blue },
  planOptionPrice: { fontSize: 16, color: WW.text, fontWeight: '800' },
  planOptionPriceSelected: { color: WW.blue },
  saveBadge: {
    position: 'absolute', top: -10, backgroundColor: WW.teal,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
  },
  saveBadgeText: { fontSize: 9, color: '#000', fontWeight: '800', letterSpacing: 0.5 },

  input: {
    backgroundColor: WW.card, borderWidth: 1.5, borderColor: WW.border,
    borderRadius: 12, padding: 16, color: WW.text, fontSize: 15,
    marginBottom: 12,
  },
  errorText: { fontSize: 13, color: '#EF4444', marginBottom: 12, fontWeight: '500' },
  legalText: { fontSize: 11, color: WW.muted, textAlign: 'center', marginTop: 10, lineHeight: 16 },

  freeNotice: {
    backgroundColor: 'rgba(14,165,233,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(14,165,233,0.2)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  freeNoticeText: {
    fontSize: 13,
    color: WW.accent,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
  },
  btnPrimary: {
    backgroundColor: WW.blue, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', marginBottom: 0,
  },
  btnPrimaryText: { fontSize: 16, color: '#000', fontWeight: '800', letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.5 },
  switchAuthBtn: { paddingVertical: 16, alignItems: 'center' },
  switchAuthText: { fontSize: 13, color: WW.muted, fontWeight: '500' },
});
