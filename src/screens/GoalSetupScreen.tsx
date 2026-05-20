import React, { useEffect, useRef, useState } from 'react';
import { ConfettiCelebration } from '@/components/ConfettiCelebration';
import { ProWelcomeModal } from '@/components/ProWelcomeModal';

import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getNotifPrefs,
  registerForPushNotificationsAsync,
  scheduleCoachNotifications,
} from '@/lib/notifications';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage, type LanguageId } from '@/contexts/LanguageContext';
import { createProTrialWindow } from '@/lib/proTrial';
import { syncProfileToSupabase } from '@/lib/profileSync';
import { THEMES, useTheme, type ThemeId } from '@/contexts/ThemeContext';
import { getPlanById, getSuggestedPlanId } from '@/lib/plans';
import { getCoachVoiceOptions, setSelectedCoachVoiceId } from '@/lib/coachVoice';
import { apexColors as C } from '@/theme/colors';
import { calcBMR, activityFactor, deriveMacroTargets, lossDeficitForRate, type WeeklyLossRate } from '@/lib/bmr';

export const PROFILE_STORAGE_KEY = 'apex.user.profile';
export const FIRST_ACTION_CTA_KEY = 'apex.onboarding.firstActionPending';

export type UserProfile = {
  activePlanId?: 'power-build' | 'hiit-burn' | 'body-recomp-pro' | 'elite-performance' | 'ai-generated';
  avatarUrl?: string;
  coachBio?: string;
  displayName: string;
  username: string;
  goal: 'lose' | 'build' | 'recomp' | 'performance';
  foodAvoidances?: string;
  foodPreferences?: string[];
  reasonWhy?: string[];
  reasonWhyDetail?: string;
  /** Health conditions selected during onboarding — used to personalise AI coaching */
  healthConditions?: string[];
  /** Current medications (free text) */
  medications?: string;
  /** Past surgeries (free text) */
  surgeries?: string;
  /** GLP-1 / peptide / weight-loss injection status */
  glp1Status?: 'none' | 'glp1' | 'peptides' | 'both';
  /** Available training equipment */
  equipment?: string[];
  /** Activity level outside of workouts */
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  weightLbs: string;
  heightFt: string;
  age: string;
  goalWeightLbs: string;
  gender: 'male' | 'female' | 'other';
  experience: 'beginner' | 'intermediate' | 'advanced';
  wakeTime?: string;
  sleepTime?: string;
  workoutTime?: string;
  workoutWindow?: 'before_work' | 'lunch' | 'after_work' | 'evening' | 'varies';
  mealsPerDay?: '2' | '3' | '4' | '5+';
  language?: LanguageId;
  dailyCalorieTarget?: number;
  dailyProtein?: number;
  dailyCarbs?: number;
  dailyFat?: number;
  weeklyLossRate?: WeeklyLossRate;
  /** ID of the earnable title the user has chosen to display */
  selectedTitle?: string;
  /** Whether this account is a coach and should show a public coach badge */
  isCoach?: boolean;
  /** Accent color / theme chosen by the user */
  themeId?: ThemeId;
  /** App-wide Pro trial window */
  proTrialStartedAt?: string;
  proTrialEndsAt?: string;
  /** ZIP / postal code for local grocery store pricing */
  zipCode?: string;
  /** Who can send this user a private message: everyone / friends / nobody */
  privacyMessages?: 'everyone' | 'friends' | 'nobody';
  /** Who can send this user a friend request: everyone / friends / nobody */
  privacyFriendRequests?: 'everyone' | 'friends' | 'nobody';
  /** How often the user wants to weigh themselves */
  weighFrequency?: 'twice_daily' | 'every_other_day' | 'weekly';
};

// BMR helpers are imported from @/lib/bmr

type WeeklyLoss = { label: string; deficitPerDay: number; tag: string; rate: WeeklyLossRate };
const LOSS_OPTIONS: WeeklyLoss[] = [
  { deficitPerDay: 500,  label: '1 lb / week',   tag: 'Sustainable', rate: '1' },
  { deficitPerDay: 750,  label: '1.5 lbs / week', tag: 'Recommended', rate: '1.5' },
  { deficitPerDay: 1000, label: '2 lbs / week',   tag: 'Aggressive', rate: '2' },
];

const ONBOARDING_META = 'rgba(255,255,255,0.62)';
const ONBOARDING_SUPPORT = 'rgba(255,255,255,0.72)';
const ONBOARDING_SUPPORT_STRONG = 'rgba(255,255,255,0.8)';

const GOALS: Array<{ key: UserProfile['goal']; icon: string; title: string; sub: string }> = [
  { key: 'lose', icon: '🔥', title: 'Lose Fat', sub: 'Burn fat, stay strong' },
  { key: 'build', icon: '💪', title: 'Build Muscle', sub: 'Mass & strength gains' },
  { key: 'recomp', icon: '⚡', title: 'Recomp', sub: 'Lose fat & gain muscle' },
  { key: 'performance', icon: '🏆', title: 'Performance', sub: 'Athletic peak output' },
];

const EXPERIENCE: Array<{ key: UserProfile['experience']; label: string; sub: string }> = [
  { key: 'beginner', label: 'Beginner', sub: 'Under 1 year' },
  { key: 'intermediate', label: 'Intermediate', sub: '1–3 years' },
  { key: 'advanced', label: 'Advanced', sub: '3+ years' },
];

const FOOD_PREFERENCES = [
  'High Protein',
  'Low Carb',
  'Balanced',
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Dairy-Free',
  'Gluten-Free',
  'No Pork',
  'No Red Meat',
] as const;

const REASON_WHY_OPTIONS = [
  'Look better',
  'Feel better',
  'Health',
  'Confidence',
  'Live longer',
  'Clothes fit better',
  'Wedding',
  'Vacation',
  'Event',
  'Performance',
] as const;

const WAKE_TIME_OPTIONS = ['5:00 AM', '6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM'] as const;
const SLEEP_TIME_OPTIONS = ['9:00 PM', '10:00 PM', '11:00 PM', '12:00 AM'] as const;
const WORKOUT_TIME_OPTIONS = ['5:30 AM', '6:30 AM', '12:00 PM', '5:30 PM', '6:30 PM', '7:30 PM'] as const;
const CUSTOM_WORKOUT_TIME_OPTION = 'Custom';
const MEALS_PER_DAY_OPTIONS: Array<UserProfile['mealsPerDay']> = ['2', '3', '4', '5+'];
const WORKOUT_WINDOW_OPTIONS: Array<{ key: NonNullable<UserProfile['workoutWindow']>; label: string; sub: string }> = [
  { key: 'before_work', label: 'Before work', sub: 'Get it done early' },
  { key: 'lunch', label: 'Lunch break', sub: 'Midday training window' },
  { key: 'after_work', label: 'After work', sub: 'Most consistent for me' },
  { key: 'evening', label: 'Evening', sub: 'Later night session' },
  { key: 'varies', label: 'Varies', sub: 'My schedule changes a lot' },
];

// ─── Health conditions grouped by category ────────────────────────────────────

export type HealthConditionCategory = {
  label: string;
  icon: string;
  items: string[];
};

export const HEALTH_CONDITIONS: HealthConditionCategory[] = [
  {
    label: 'Metabolic',
    icon: '🩸',
    items: ['Type 1 Diabetes', 'Type 2 Diabetes', 'Insulin Resistance', 'Metabolic Syndrome', 'Prediabetes'],
  },
  {
    label: 'Cardiovascular',
    icon: '❤️',
    items: ['High Blood Pressure', 'High Cholesterol', 'Heart Disease', 'Previous Heart Attack', 'Arrhythmia / AFib'],
  },
  {
    label: 'Hormonal',
    icon: '⚖️',
    items: ['PCOS', 'Hypothyroidism', 'Hyperthyroidism', 'Pre-Menopausal', 'Post-Menopausal', 'Low Testosterone'],
  },
  {
    label: 'Digestive',
    icon: '🫁',
    items: ['Gallbladder Removed', 'IBS / IBD', 'Celiac Disease', 'Crohn\'s Disease', 'Acid Reflux / GERD'],
  },
  {
    label: 'Renal',
    icon: '🫀',
    items: ['Kidney Disease (CKD)', 'Kidney Removed', 'Kidney Stones (recurring)'],
  },
  {
    label: 'Musculoskeletal',
    icon: '🦴',
    items: ['Knee Pain / Injury', 'Shoulder Pain / Injury', 'Lower Back Pain', 'Upper Back Pain', 'Hip Pain / Replacement', 'Arthritis / Joint Inflammation', 'Osteoporosis'],
  },
  {
    label: 'Other',
    icon: '💊',
    items: ['Lipedema', 'Sleep Apnea', 'Asthma', 'Anemia', 'Anxiety / Depression', 'Chronic Fatigue', 'Eating Disorder (history)'],
  },
];

function StepDots({ total, current, accent }: { current: number; total: number; accent: string }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === current ? styles.dotActive : null, i === current ? { backgroundColor: accent } : null]}
        />
      ))}
    </View>
  );
}

export default function GoalSetupScreen({ onComplete }: { onComplete: () => void }) {
  const { setTheme } = useTheme();
  const { session } = useAuth();
  const { language, languages, setLanguage } = useLanguage();
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [goal, setGoal] = useState<UserProfile['goal']>('recomp');
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>('green');
  const coachVoiceOptions = getCoachVoiceOptions();
  const [selectedCoachVoiceId, setSelectedCoachVoiceChoice] = useState(coachVoiceOptions[0]?.id ?? '');
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageId>(language);
  const [weightLbs, setWeightLbs] = useState('');
  const [heightFt, setHeightFt] = useState('');
  const [age, setAge] = useState('');
  const [goalWeightLbs, setGoalWeightLbs] = useState('');
  const [gender, setGender] = useState<UserProfile['gender']>('male');
  const [experience, setExperience] = useState<UserProfile['experience']>('intermediate');
  const [foodPreferences, setFoodPreferences] = useState<string[]>([]);
  const [foodAvoidances, setFoodAvoidances] = useState('');
  const [reasonWhy, setReasonWhy] = useState<string[]>([]);
  const [reasonWhyDetail, setReasonWhyDetail] = useState('');
  const [selectedLoss, setSelectedLoss] = useState(1); // index into LOSS_OPTIONS
  const [coachingRequested, setCoachingRequested] = useState(false);

  // ── Health conditions step ──
  const [healthConditions, setHealthConditions] = useState<string[]>([]);
  const [medications, setMedications] = useState('');
  const [surgeries, setSurgeries] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [glp1Status, setGlp1Status] = useState<UserProfile['glp1Status']>('none');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [activityLevel, setActivityLevel] = useState<UserProfile['activityLevel']>('moderate');
  const [wakeTime, setWakeTime] = useState<UserProfile['wakeTime']>('7:00 AM');
  const [sleepTime, setSleepTime] = useState<UserProfile['sleepTime']>('10:00 PM');
  const [workoutTime, setWorkoutTime] = useState<UserProfile['workoutTime']>('6:30 PM');
  const [workoutWindow, setWorkoutWindow] = useState<UserProfile['workoutWindow']>('after_work');
  const [mealsPerDay, setMealsPerDay] = useState<UserProfile['mealsPerDay']>('3');
  const [weighFrequency, setWeighFrequency] = useState<UserProfile['weighFrequency']>('every_other_day');
  const [showCelebration, setShowCelebration] = useState(false);
  const [showProWelcome, setShowProWelcome] = useState(false);
  const pendingOnComplete = useRef(false);
  const coachPulse = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<ScrollView>(null);

  const previewTheme = THEMES.find((theme) => theme.id === selectedTheme) ?? THEMES[0];
  const previewAccent = previewTheme.accent;
  const previewAccentSoft = previewTheme.accentSoft;
  const previewAccentBorder = previewTheme.accentBorder;
  const previewAccentStrongBorder = previewTheme.accentStrongBorder;
  const selectedCoachOption =
    coachVoiceOptions.find((coach) => coach.id === selectedCoachVoiceId) ?? coachVoiceOptions[0];
  const workoutTimeMatchesPreset = WORKOUT_TIME_OPTIONS.includes((workoutTime ?? '') as (typeof WORKOUT_TIME_OPTIONS)[number]);
  const workoutTimeSelection = workoutTimeMatchesPreset ? workoutTime : CUSTOM_WORKOUT_TIME_OPTION;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(coachPulse, {
          toValue: 1.06,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(coachPulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [coachPulse]);

  const animateNext = () => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -30, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
    });
  }, [step]);

  const goNext = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    animateNext();
    setStep((s) => s + 1);
  };

  const handleFinish = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await setTheme(selectedTheme);
    await setLanguage(selectedLanguage);
    if (selectedCoachVoiceId) {
      await setSelectedCoachVoiceId(selectedCoachVoiceId);
    }

    // Compute macro targets if body stats provided; otherwise leave null so
    // getOrComputeMacroTargets() will use sensible defaults throughout the app.
    const hasBodyStats = weightLbs && heightFt && age;
    const targets = hasBodyStats
      ? deriveMacroTargets({
          weightLbs,
          heightFt,
          age,
          gender,
          experience,
          goal,
          goalWeightLbs,
          weeklyLossRate: LOSS_OPTIONS[selectedLoss].rate,
        })
      : null;

    const suggestedPlanId = getSuggestedPlanId(goal, experience);

    const trialWindow = createProTrialWindow();
    const profile: UserProfile = {
      activePlanId: suggestedPlanId,
      displayName: displayName.trim() || 'Athlete',
      username: username.trim() || displayName.trim().toLowerCase().replace(/\s+/g, '') || 'athlete',
      foodAvoidances: foodAvoidances.trim() || undefined,
      foodPreferences: foodPreferences.length > 0 ? foodPreferences : undefined,
      reasonWhy: reasonWhy.length > 0 ? reasonWhy : undefined,
      reasonWhyDetail: reasonWhyDetail.trim() || undefined,
      healthConditions: healthConditions.length > 0 ? healthConditions : undefined,
      medications: medications.trim() || undefined,
      surgeries: surgeries.trim() || undefined,
      glp1Status: glp1Status !== 'none' ? glp1Status : undefined,
      equipment: equipment.length > 0 ? equipment : undefined,
      activityLevel,
      goal,
      weightLbs: weightLbs || '',
      heightFt: heightFt || '',
      age: age || '',
      goalWeightLbs: goalWeightLbs || '',
      gender,
      experience,
      wakeTime,
      sleepTime,
      workoutTime: workoutTime?.trim() || '6:30 PM',
      workoutWindow,
      mealsPerDay,
      language: selectedLanguage,
      themeId: selectedTheme,
      proTrialStartedAt: trialWindow.startedAt,
      proTrialEndsAt: trialWindow.endsAt,
      weeklyLossRate: LOSS_OPTIONS[selectedLoss].rate,
      ...(targets ? {
        dailyCalorieTarget: targets.dailyCalorieTarget,
        dailyProtein: targets.dailyProtein,
        dailyCarbs: targets.dailyCarbs,
        dailyFat: targets.dailyFat,
      } : {}),
      zipCode: zipCode.trim() || undefined,
      weighFrequency: weighFrequency ?? 'every_other_day',
    };
    try {
      await syncProfileToSupabase(session?.user?.id, profile);
    } catch {
      Alert.alert(
        'Profile save failed',
        'We saved your setup on this device, but could not sync it to your account yet. Check your connection and try again from Profile later.',
      );
    }
    await AsyncStorage.removeItem(FIRST_ACTION_CTA_KEY).catch(() => null);

    // Request notification permission and kick off the AI Coach schedule
    // immediately after onboarding — this is the best moment since the user
    // has just provided their goal and name.
    try {
      await registerForPushNotificationsAsync();
      const prefs = await getNotifPrefs();
      await scheduleCoachNotifications({
        goal: profile.goal,
        displayName: profile.displayName,
        mealsPerDay: profile.mealsPerDay,
        prefs,
        reasonWhy: profile.reasonWhy,
        reasonWhyDetail: profile.reasonWhyDetail,
        sleepTime: profile.sleepTime,
        wakeTime: profile.wakeTime,
        workoutTime: profile.workoutTime,
        workoutWindow: profile.workoutWindow,
      });
    } catch {
      // Notifications are non-critical — never block onboarding completion
    }

    // Show confetti celebration before completing onboarding
    pendingOnComplete.current = true;
    setShowCelebration(true);
  };

  const handleNameChange = (text: string) => {
    setDisplayName(text);
    if (!username || username === displayName.toLowerCase().replace(/\s+/g, '')) {
      setUsername(text.toLowerCase().replace(/\s+/g, ''));
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <StepDots total={6} current={step} accent={previewAccent} />

          <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>

          {/* ── STEP 0: Name ── */}
          {step === 0 ? (
            <View style={styles.stepWrap}>
              <Text style={styles.eyebrow}>Step 1 of 6 · Identity</Text>
              <Text style={styles.stepTitle}>{t('goalSetup.nameTitle')}</Text>
              <Text style={styles.stepSub}>{t('goalSetup.nameSubtitle')}</Text>

              <Text style={styles.label}>{t('goalSetup.fullName')}</Text>
              <TextInput
                style={styles.input}
                placeholder="Jordan Rivera"
                placeholderTextColor={C.muted}
                value={displayName}
                onChangeText={handleNameChange}
                autoFocus
                returnKeyType="next"
              />
              <Text style={styles.label}>{t('goalSetup.username')}</Text>
              <TextInput
                style={styles.input}
                placeholder="jordanriv"
                placeholderTextColor={C.muted}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                returnKeyType="done"
              />

              <Text style={styles.label}>App Color</Text>
              <Text style={[styles.stepSub, { marginTop: -8, marginBottom: 10, fontSize: 12 }]}>
                Pick the accent you want to carry through the app. You can change it later in Profile.
              </Text>
              {THEMES.map((theme) => {
                const active = selectedTheme === theme.id;
                return (
                  <Pressable
                    key={theme.id}
                    style={[
                      styles.themeRow,
                      active ? { borderColor: theme.accentStrongBorder, backgroundColor: theme.accentSoft } : null,
                      { marginBottom: 6 },
                    ]}
                    onPress={async () => { await Haptics.selectionAsync(); setSelectedTheme(theme.id); }}
                  >
                    <View style={[styles.themeSwatch, { backgroundColor: theme.accent, borderColor: theme.accentStrongBorder }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.themeLabel, active ? { color: theme.accent } : null]}>{theme.label}</Text>
                      <Text style={styles.languageNative}>Accent color for tabs, highlights, and primary actions</Text>
                    </View>
                    {active ? <Text style={{ color: theme.accent, fontSize: 16 }}>✓</Text> : null}
                  </Pressable>
                );
              })}

              <Text style={styles.label}>Choose Your Coach</Text>
              <Text style={[styles.stepSub, { marginTop: -8, marginBottom: 10, fontSize: 12 }]}>
                Meet your coach now. Their voice, profile image, and coaching tone will carry through the app.
              </Text>
              {coachVoiceOptions.map((coach) => {
                const active = selectedCoachVoiceId === coach.id;
                return (
                  <Pressable
                    key={coach.id}
                    style={[
                      styles.coachChoiceCard,
                      active ? { borderColor: previewAccentStrongBorder, backgroundColor: previewAccentSoft } : null,
                    ]}
                    onPress={async () => {
                      await Haptics.selectionAsync();
                      setSelectedCoachVoiceChoice(coach.id);
                    }}
                  >
                    <Animated.Image
                      source={coach.avatar}
                      style={[
                        styles.coachChoiceAvatar,
                        active
                          ? {
                              borderColor: previewAccentStrongBorder,
                              shadowColor: previewAccent,
                              transform: [
                                { scale: coachPulse },
                                {
                                  translateY: coachPulse.interpolate({
                                    inputRange: [1, 1.06],
                                    outputRange: [0, -3],
                                  }),
                                },
                              ],
                            }
                          : null,
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.coachChoiceTitle, active ? { color: previewAccent } : null]}>
                        {coach.label} · {coach.role}
                      </Text>
                      <Text style={styles.coachChoiceSubtitle}>{coach.subtitle}</Text>
                      <Text style={styles.coachChoiceBody}>{coach.choiceDescription}</Text>
                    </View>
                    {active ? <Text style={[styles.coachChoiceCheck, { color: previewAccent }]}>✓</Text> : null}
                  </Pressable>
                );
              })}

              <Pressable
                style={({ pressed }) => [styles.btnPrimary, { backgroundColor: previewAccent }, pressed && { opacity: 0.85 }]}
                onPress={goNext}
              >
                <Text style={styles.btnPrimaryText}>{t('common.continue')}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── STEP 1: Goal ── */}
          {step === 1 ? (
            <View style={styles.stepWrap}>
              <Text style={styles.eyebrow}>Step 2 of 6 · Your Goal</Text>
              <Text style={styles.stepTitle}>{t('goalSetup.goalTitle')}</Text>
              <Text style={styles.stepSub}>{t('goalSetup.goalSubtitle')}</Text>

              <View style={styles.goalGrid}>
                {GOALS.map((item) => (
                  <Pressable
                    key={item.key}
                    style={[styles.goalCard, goal === item.key ? styles.goalCardActive : null, goal === item.key ? { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft } : null]}
                    onPress={async () => {
                      await Haptics.selectionAsync();
                      setGoal(item.key);
                    }}
                  >
                    <Text style={styles.goalIcon}>{item.icon}</Text>
                    <Text style={[styles.goalTitle, goal === item.key ? { color: previewAccent } : null]}>
                      {item.title}
                    </Text>
                    <Text style={styles.goalSub}>{item.sub}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                style={({ pressed }) => [styles.btnPrimary, { backgroundColor: previewAccent }, pressed && { opacity: 0.85 }]}
                onPress={goNext}
              >
                <Text style={styles.btnPrimaryText}>{t('common.continue')}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── STEP 2: Reason Why ── */}
          {step === 2 ? (
            <View style={styles.stepWrap}>
              <Text style={styles.eyebrow}>Step 3 of 6 · Your Why</Text>
              <Text style={styles.stepTitle}>{'WHY\nDOES THIS\nMATTER?'}</Text>
              <Text style={styles.stepSub}>Pick the reasons that hit home. Your coach can use this to keep the plan and reminders personal.</Text>

              <Text style={styles.label}>Reason why</Text>
              <View style={styles.optionRow}>
                {REASON_WHY_OPTIONS.map((item) => {
                  const selected = reasonWhy.includes(item);
                  return (
                    <Pressable
                      key={item}
                      style={[styles.optionChip, selected ? [styles.optionChipActive, { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft }] : null]}
                      onPress={async () => {
                        await Haptics.selectionAsync();
                        setReasonWhy((current) =>
                          current.includes(item) ? current.filter((value) => value !== item) : [...current, item],
                        );
                      }}
                    >
                      <Text style={[styles.optionChipText, selected ? { color: previewAccent } : null]}>{item}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>In your own words</Text>
              <TextInput
                style={[styles.input, { minHeight: 92, textAlignVertical: 'top' }]}
                placeholder="I want to feel strong for my wedding, fit my clothes better, and have more confidence..."
                placeholderTextColor={C.muted}
                value={reasonWhyDetail}
                onChangeText={setReasonWhyDetail}
                onFocus={() => {
                  requestAnimationFrame(() => {
                    scrollRef.current?.scrollToEnd({ animated: true });
                  });
                }}
                multiline
              />

              <Pressable style={({ pressed }) => [styles.btnPrimary, { marginTop: 20, backgroundColor: previewAccent }, pressed && { opacity: 0.85 }]} onPress={goNext}>
                <Text style={styles.btnPrimaryText}>Continue →</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── STEP 3: Body Stats ── */}
          {step === 3 ? (
            <View style={styles.stepWrap}>
              <Text style={styles.eyebrow}>Step 4 of 6 · Body Stats</Text>
              <Text style={styles.stepTitle}>{'YOUR\nBODY\nSTATS'}</Text>
              <Text style={styles.stepSub}>These help your coach set your starting plan correctly. You can update them anytime in Profile.</Text>

              <View style={styles.statsRow}>
                <View style={styles.statField}>
                  <Text style={styles.label}>{t('goalSetup.weight')}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="185"
                    placeholderTextColor={C.muted}
                    value={weightLbs}
                    onChangeText={setWeightLbs}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.statField}>
                  <Text style={styles.label}>Age</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="32"
                    placeholderTextColor={C.muted}
                    value={age}
                    onChangeText={setAge}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statField}>
                  <Text style={styles.label}>{t('goalSetup.height')}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="5.9"
                    placeholderTextColor={C.muted}
                    value={heightFt}
                    onChangeText={setHeightFt}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.statField}>
                  <Text style={styles.label}>Goal Weight (lbs)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="165"
                    placeholderTextColor={C.muted}
                    value={goalWeightLbs}
                    onChangeText={setGoalWeightLbs}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <Pressable style={({ pressed }) => [styles.btnPrimary, { marginTop: 12, backgroundColor: previewAccent }, pressed && { opacity: 0.85 }]} onPress={goNext}>
                <Text style={styles.btnPrimaryText}>Continue →</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── STEP 4: Daily Rhythm + Profile ── */}
          {step === 4 ? (
            <View style={styles.stepWrap}>
              <Text style={styles.eyebrow}>Step 5 of 6 · Daily Rhythm</Text>
              <Text style={styles.stepTitle}>{'BUILD\nAROUND\nYOUR LIFE'}</Text>
              <Text style={styles.stepSub}>Give us the shape of your day so workouts, meals, and reminders can match your real schedule.</Text>

              <Text style={styles.label}>Wake time</Text>
              <View style={styles.optionRow}>
                {WAKE_TIME_OPTIONS.map((time) => (
                  <Pressable
                    key={time}
                    style={[styles.optionChip, wakeTime === time ? [styles.optionChipActive, { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft }] : null]}
                    onPress={async () => { await Haptics.selectionAsync(); setWakeTime(time); }}
                  >
                    <Text style={[styles.optionChipText, wakeTime === time ? { color: previewAccent } : null]}>{time}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Sleep time</Text>
              <View style={styles.optionRow}>
                {SLEEP_TIME_OPTIONS.map((time) => (
                  <Pressable
                    key={time}
                    style={[styles.optionChip, sleepTime === time ? [styles.optionChipActive, { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft }] : null]}
                    onPress={async () => { await Haptics.selectionAsync(); setSleepTime(time); }}
                  >
                    <Text style={[styles.optionChipText, sleepTime === time ? { color: previewAccent } : null]}>{time}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Workout window</Text>
              {WORKOUT_WINDOW_OPTIONS.map((option) => (
                <Pressable
                  key={option.key}
                  style={[styles.themeRow, workoutWindow === option.key ? { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft } : null, { marginBottom: 6 }]}
                  onPress={async () => { await Haptics.selectionAsync(); setWorkoutWindow(option.key); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.themeLabel, workoutWindow === option.key ? { color: previewAccent } : null]}>{option.label}</Text>
                    <Text style={styles.languageNative}>{option.sub}</Text>
                  </View>
                  {workoutWindow === option.key ? <Text style={{ color: previewAccent, fontSize: 16 }}>✓</Text> : null}
                </Pressable>
              ))}

              <Text style={styles.label}>Workout time</Text>
              <View style={styles.optionRow}>
                {WORKOUT_TIME_OPTIONS.map((time) => (
                  <Pressable
                    key={time}
                    style={[styles.optionChip, workoutTimeSelection === time ? [styles.optionChipActive, { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft }] : null]}
                    onPress={async () => { await Haptics.selectionAsync(); setWorkoutTime(time); }}
                  >
                    <Text style={[styles.optionChipText, workoutTimeSelection === time ? { color: previewAccent } : null]}>{time}</Text>
                  </Pressable>
                ))}
                <Pressable
                  style={[styles.optionChip, workoutTimeSelection === CUSTOM_WORKOUT_TIME_OPTION ? [styles.optionChipActive, { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft }] : null]}
                  onPress={async () => {
                    await Haptics.selectionAsync();
                    if (workoutTimeMatchesPreset) {
                      setWorkoutTime('');
                    }
                  }}
                >
                  <Text style={[styles.optionChipText, workoutTimeSelection === CUSTOM_WORKOUT_TIME_OPTION ? { color: previewAccent } : null]}>
                    {CUSTOM_WORKOUT_TIME_OPTION}
                  </Text>
                </Pressable>
              </View>
              {workoutTimeSelection === CUSTOM_WORKOUT_TIME_OPTION ? (
                <TextInput
                  style={styles.input}
                  placeholder="Type your workout time (for example 4:45 AM)"
                  placeholderTextColor={C.muted}
                  value={workoutTime ?? ''}
                  onChangeText={setWorkoutTime}
                />
              ) : null}

              <Text style={styles.label}>Meals per day</Text>
              <View style={styles.optionRow}>
                {MEALS_PER_DAY_OPTIONS.map((count) => (
                  <Pressable
                    key={count}
                    style={[styles.optionChip, mealsPerDay === count ? [styles.optionChipActive, { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft }] : null]}
                    onPress={async () => { await Haptics.selectionAsync(); setMealsPerDay(count); }}
                  >
                    <Text style={[styles.optionChipText, mealsPerDay === count ? { color: previewAccent } : null]}>{count} meals</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.stepSub, { marginTop: 6, marginBottom: 10, fontSize: 12 }]}>
                A few final details help your coach set better starting targets from day one.
              </Text>

              <Text style={styles.label}>Biological Sex</Text>
              <View style={[styles.expRow, { marginBottom: 20 }]}>
                {(['male', 'female', 'other'] as const).map((g) => (
                  <Pressable
                    key={g}
                    style={[styles.expBtn, gender === g ? [styles.expBtnActive, { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft }] : null]}
                    onPress={async () => { await Haptics.selectionAsync(); setGender(g); }}
                  >
                    <Text style={[styles.expLabel, gender === g ? { color: previewAccent } : null]}>
                      {g === 'male' ? '♂ Male' : g === 'female' ? '♀ Female' : '⊕ Other'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Activity Level */}
              <Text style={styles.label}>Daily Activity Level</Text>
              <Text style={[styles.stepSub, { marginTop: -8, marginBottom: 10, fontSize: 12 }]}>
                Outside of workouts — this sets your calorie target.
              </Text>
              {([
                { key: 'sedentary', label: '🪑 Sedentary', sub: 'Desk job, little movement' },
                { key: 'light', label: '🚶 Lightly Active', sub: 'Light walking or standing' },
                { key: 'moderate', label: '🏃 Moderately Active', sub: 'Active job or daily walks' },
                { key: 'active', label: '⚡ Active', sub: 'Physical job or sports' },
                { key: 'very_active', label: '🔥 Very Active', sub: 'Athlete / manual labour' },
              ] as const).map((opt) => (
                <Pressable
                  key={opt.key}
                  style={[styles.themeRow, activityLevel === opt.key ? { borderColor: previewAccentBorder, backgroundColor: previewAccentSoft } : null, { marginBottom: 6 }]}
                  onPress={async () => { await Haptics.selectionAsync(); setActivityLevel(opt.key); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.themeLabel, activityLevel === opt.key ? { color: previewAccent } : null]}>{opt.label}</Text>
                    <Text style={styles.languageNative}>{opt.sub}</Text>
                  </View>
                  {activityLevel === opt.key ? <Text style={{ color: previewAccent, fontSize: 16 }}>✓</Text> : null}
                </Pressable>
              ))}

              <Pressable style={({ pressed }) => [styles.btnPrimary, { marginTop: 20, backgroundColor: previewAccent }, pressed && { opacity: 0.85 }]} onPress={goNext}>
                <Text style={styles.btnPrimaryText}>Continue →</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── STEP 5: Done ── */}
          {step === 5 ? (
            <View style={styles.stepWrap}>
              <Text style={styles.eyebrow}>Step 6 of 6 · All Set</Text>
              <Text style={styles.stepTitle}>{'YOU\'RE\nREADY\nTO GO'}</Text>
              <Text style={styles.stepSub}>
                Your plan is ready. We now know your goal, your why, and the shape of your day — so your coach can build around your real life.
              </Text>

              {/* Suggested plan card */}
              {(() => {
                const suggestedPlan = getPlanById(getSuggestedPlanId(goal, experience));
                return (
                  <View style={[styles.planSuggestCard, { backgroundColor: previewAccentSoft, borderColor: previewAccentBorder }]}>
                    <Text style={[styles.planSuggestEyebrow, { color: previewAccent }]}>Your Starting Program</Text>
                    <Text style={styles.planSuggestTitle}>{suggestedPlan.title}</Text>
                    <Text style={styles.planSuggestMeta}>
                      {suggestedPlan.durationWeeks} weeks · {suggestedPlan.daysPerWeek} days · {suggestedPlan.level}
                    </Text>
                    <Text style={styles.planSuggestBody}>{suggestedPlan.reason}</Text>
                  </View>
                );
              })()}

              {/* What's next */}
              <View style={styles.tutorialCard}>
                {[
                  { icon: '⚖️', title: 'Review Your Stats', desc: 'Open Profile → Edit Stats any time to update weight, height, age, or goal weight so your calorie and macro targets stay accurate.' },
                  { icon: '🥗', title: 'Fuel & Grocery Flow', desc: 'Use Fuel for meal logging, meal templates, quick recipes, and grocery lists. Your coach can use recipes there too.' },
                  { icon: '💪', title: 'Train With Your Coach', desc: 'Open Train for warm-ups, lifts, coach demos, and voice coaching that follows the workout in order.' },
                  { icon: '🔥', title: 'Use Tribe & Leaderboard', desc: 'Share wins, vote on features, check challenges, and climb the leaderboard for accountability.' },
                  {
                    avatar: selectedCoachOption.avatar,
                    title: `Ask ${selectedCoachOption.label} & Review Plans`,
                    desc: `${selectedCoachOption.label} answers training and nutrition questions. Plans holds your active program, library, and live coaching path.`,
                  },
                ].map((item) => (
                  <View key={item.title} style={styles.tutorialRow}>
                    {'avatar' in item ? (
                      <Image source={item.avatar} style={styles.tutorialAvatar} />
                    ) : (
                      <Text style={styles.tutorialIcon}>{item.icon}</Text>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tutorialTitle}>{item.title}</Text>
                      <Text style={styles.tutorialDesc}>{item.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <Pressable
                style={({ pressed }) => [styles.btnPrimary, { marginTop: 20, backgroundColor: previewAccent }, pressed && { opacity: 0.85 }]}
                onPress={handleFinish}
              >
                <Text style={styles.btnPrimaryText}>Start My Journey ⚡</Text>
              </Pressable>
            </View>
          ) : null}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfettiCelebration
        visible={showCelebration}
        emoji="🎉"
        title="YOU'RE ALL SET!"
        subtitle={`Welcome to APEX${displayName.trim() ? `, ${displayName.trim()}` : ''}. Your plan is live — let's get to work.`}
        ctaLabel="LET'S GET TO WORK →"
        onDismiss={() => {
          setShowCelebration(false);
          if (pendingOnComplete.current) {
            pendingOnComplete.current = false;
            setShowProWelcome(true);
          }
        }}
      />

      {showProWelcome ? (
        <ProWelcomeModal
          forceVisible
          onDismiss={() => {
            setShowProWelcome(false);
            onComplete();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.black },
  keyboardWrap: { flex: 1 },
  container: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 72 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 28 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  dotActive: { width: 20, backgroundColor: C.green },
  stepWrap: {},
  eyebrow: {
    fontSize: 11,
    color: ONBOARDING_META,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  stepTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 52,
    letterSpacing: 2,
    color: C.text,
    lineHeight: 54,
    marginBottom: 8,
  },
  stepSub: {
    fontSize: 14,
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 20,
    marginBottom: 24,
  },
  label: {
    fontSize: 10,
    color: ONBOARDING_META,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  goalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  goalCard: {
    width: '47%',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  goalCardActive: {
    borderColor: C.green,
    backgroundColor: C.greenSoft,
  },
  goalIcon: { fontSize: 32, marginBottom: 8 },
  goalTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    letterSpacing: 1,
    color: C.text,
    marginBottom: 2,
  },
  goalSub: { fontSize: 10, color: ONBOARDING_SUPPORT, fontFamily: 'DMSans_400Regular', textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 12 },
  statField: { flex: 1 },
  expRow: { flexDirection: 'row', gap: 8, marginBottom: 24, marginTop: 2 },
  expBtn: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  expBtnActive: { borderColor: C.greenBorder, backgroundColor: C.greenSoft },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  optionChipActive: {
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  optionChipText: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  preferenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  preferenceChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  preferenceChipActive: {
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  preferenceChipText: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  preferenceChipTextActive: {
    color: C.green,
  },
  expLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: C.text,
    marginBottom: 2,
  },
  expSub: { fontSize: 9, color: ONBOARDING_META, fontFamily: 'SpaceMono_400Regular' },
  btnPrimary: {
    backgroundColor: C.green,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnPrimaryText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 16, fontWeight: '700' },
  skipBtn: { alignItems: 'center', paddingVertical: 14 },
  skipText: { color: ONBOARDING_SUPPORT, fontFamily: 'DMSans_400Regular', fontSize: 13 },

  // ── Weigh-in frequency step ───────────────────────────────────────────────
  weighCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  weighCardActive: {
    borderColor: C.green,
    backgroundColor: 'rgba(0,255,135,0.06)',
  },
  weighCardIcon: { fontSize: 26, minWidth: 36, textAlign: 'center' },
  weighCardLabel: {
    fontSize: 16,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginBottom: 3,
  },
  weighCardSub: {
    fontSize: 12.5,
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    marginBottom: 2,
  },
  weighCardTip: {
    fontSize: 11,
    color: ONBOARDING_META,
    fontFamily: 'SpaceMono_400Regular',
  },
  weighCardCheck: {
    fontSize: 18,
    color: C.green,
    fontFamily: 'DMSans_700Bold',
  },
  weighNote: {
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.2)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    marginTop: 4,
  },
  weighNoteText: {
    fontSize: 12.5,
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 19,
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  themeSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  themeLabel: {
    flex: 1,
    fontSize: 15,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
  },
  languageEmoji: {
    fontSize: 24,
  },
  languageNative: {
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  // ── BMR Results step ──────────────────────────────────────────────────
  bmrCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  bmrRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  bmrStat: { alignItems: 'center', flex: 1 },
  bmrVal: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    color: C.green,
    letterSpacing: 1,
    lineHeight: 36,
  },
  bmrLabel: {
    fontSize: 9,
    color: ONBOARDING_META,
    fontFamily: 'SpaceMono_400Regular',
    textAlign: 'center',
    textTransform: 'uppercase',
    marginTop: 4,
    lineHeight: 13,
  },
  bmrDivider: { width: 1, height: 40, backgroundColor: C.border },
  lossRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  lossCard: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  lossCardActive: { borderColor: C.greenBorder, backgroundColor: C.greenSoft },
  lossLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: C.text,
    textAlign: 'center',
    marginBottom: 3,
  },
  lossTag: { fontSize: 9, color: ONBOARDING_META, fontFamily: 'SpaceMono_400Regular' },
  targetsCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  targetsTitle: {
    fontSize: 10,
    color: ONBOARDING_META,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  macroGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  macroTile: { alignItems: 'center', flex: 1 },
  macroVal: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 0.5,
    lineHeight: 26,
  },
  macroLbl: {
    fontSize: 8,
    color: ONBOARDING_META,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    marginTop: 3,
  },
  planSuggestCard: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  planSuggestEyebrow: {
    fontSize: 10,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  planSuggestTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 26,
    lineHeight: 28,
    color: C.text,
    letterSpacing: 1.2,
  },
  planSuggestMeta: {
    fontSize: 11,
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    marginTop: 4,
  },
  planSuggestBody: {
    fontSize: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
    marginTop: 8,
  },
  tutorialCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    gap: 14,
    marginBottom: 8,
  },
  tutorialRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  tutorialIcon: { fontSize: 24 },
  tutorialAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginTop: 1,
  },
  tutorialTitle: {
    fontSize: 13,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    marginBottom: 2,
  },
  tutorialDesc: {
    fontSize: 11,
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 16,
  },
  coachCard: {
    marginTop: 8,
    backgroundColor: 'rgba(0,255,135,0.04)',
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 16,
    padding: 16,
  },
  coachCardTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    letterSpacing: 1,
    color: C.text,
    marginBottom: 4,
  },
  coachCardSub: {
    fontSize: 12,
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 17,
    marginBottom: 12,
  },
  coachBtns: { flexDirection: 'row', gap: 8 },
  coachBtn: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  coachBtnDone: { borderColor: C.greenBorder, backgroundColor: C.greenSoft },
  coachBtnText: { fontSize: 11, color: C.text, fontFamily: 'DMSans_500Medium', textAlign: 'center' },
  coachChoiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
  },
  coachChoiceAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: C.border,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
  },
  coachChoiceTitle: {
    fontSize: 15,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginBottom: 2,
  },
  coachChoiceSubtitle: {
    fontSize: 11.5,
    color: ONBOARDING_SUPPORT_STRONG,
    fontFamily: 'DMSans_500Medium',
    marginBottom: 4,
  },
  coachChoiceBody: {
    fontSize: 11.5,
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 17,
  },
  coachChoiceCheck: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
  },

  // ── Health conditions step ──
  healthCatWrap: { marginBottom: 16 },
  healthCatLabel: {
    color: ONBOARDING_META,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 8,
  },
  healthChip: {
    borderColor: C.border,
  },
  healthChipActive: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.55)',
  },
  healthChipTextActive: {
    color: '#ef4444',
  },
  inputMulti: {
    minHeight: 60,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  healthSummaryCard: {
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.25)',
    borderRadius: 14,
    padding: 14,
    marginVertical: 12,
    gap: 5,
  },
  healthSummaryTitle: {
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
  healthSummaryBody: {
    color: ONBOARDING_SUPPORT,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
});
