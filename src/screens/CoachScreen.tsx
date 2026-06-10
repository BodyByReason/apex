import React, { useCallback, useEffect, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Animated, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LiveCoachScreen from '@/screens/LiveCoachScreen';

import Constants from 'expo-constants';
import { AppHeader } from '@/components/AppHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useGamification } from '@/contexts/GamificationContext';
import { maybeShowPaywall } from '@/lib/revenuecat';
import { supabase } from '@/lib/supabase';
import { usePro } from '@/hooks/usePro';
import type { MainStackParamList } from '@/navigation/MainNavigator';
import { apexColors as C } from '@/theme/colors';
import { useTheme } from '@/contexts/ThemeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseWorkoutTag, saveAIWorkout, parseProgramTag, saveAIProgram } from '@/lib/aiWorkout';
import { getSavedLabAnalyses } from '@/screens/LabUploadScreen';
import { coachGenerateOrUpdateMealPlan, loadMealPlanFromStorage } from '@/lib/mealPlans';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { getSelectedCoachVoice, type CoachVoiceOption } from '@/lib/coachVoice';
import { isAdminEnabled, verifyCoachAccessPassword } from '@/lib/adminMode';

import { getPlanById, getPlanBuilderExerciseCatalog, getSuggestedPlanId } from '@/lib/plans';
import { calcBMR, getOrComputeMacroTargets } from '@/lib/bmr';
import { syncProfileToSupabase } from '@/lib/profileSync';
import { useHealth } from '@/hooks/useHealth';

function todayProgramIndex(): number {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const diff = Date.now() - start.getTime();
  return Math.floor(diff / 86_400_000) % 7;
}

const freeMsgKey = (userId?: string) => `apex.coach.freeMessageCount.${userId ?? 'guest'}`;
const draftMsgKey = (userId?: string) => `apex.coach.draft.${userId ?? 'guest'}`;
const FREE_MSG_LIMIT = 5;

type Message = {
  id: string;
  role: 'ai' | 'user';
  text: string;
  typing?: boolean;
};

const SYSTEM_PROMPT =
  `You are APEX AI Coach, a direct and expert training and nutrition coach inside the APEX app. Keep responses concise and useful. Use markdown-style bold sparingly. Never ask multiple follow-up questions — make smart assumptions based on what the user said and act immediately.

CRITICAL RULE: When the user asks you to build, create, plan, or design ANYTHING (workout, program, plan, schedule), you MUST do it immediately in your very next reply. Do NOT ask clarifying questions first. Make reasonable assumptions and build it. You can add a one-line note about your assumption in your text reply.

MEAL PLAN CAPABILITY: If the user asks to create, change, swap, or update meals or a meal plan, assume the app can save that plan for them and speak as if you are making the change right now.

WORKOUT PUSH CAPABILITY: When the user asks for a workout, today's session, or what to do at the gym, push the workout directly to their Train page by appending this tag at the very end of your reply — no line breaks inside the JSON:
[[WORKOUT:{"name":"Workout Name","duration":30,"focus":"Upper body","exercises":[{"name":"Exercise Name","sets":3,"reps":"8-10","rest":"60s"}],"coachNote":"One short coach tip"}]]
Always include at least 4 exercises. Never mention the tag to the user — just say "I've pushed this to your Train page — tap START when you're ready."

PROGRAM PUSH CAPABILITY: When the user asks for a training program, plan, or schedule (any duration), push it to their Plans page by appending this tag at the very end of your reply — no line breaks inside the JSON:
[[PROGRAM:{"title":"Program Name","icon":"💪","durationWeeks":8,"daysPerWeek":4,"level":"Intermediate","subtitle":"Short program tagline","focus":"Hypertrophy + fat loss","coachNote":"One short motivating tip"}]]
Choose a fitting emoji, realistic weeks (4–16), days/week (3–6), and level (Beginner/Intermediate/Advanced). Never mention the tag — just say "I've set this as your Active Program on the Plans page — let's get to work."

NEVER ask more than one question per reply. NEVER delay building something the user asked for.`;


const QUICK_CHIPS = [
  "Plan today's workout for me",
  'What should I eat before training?',
  'Analyze my progress this week',
  'How do I break a plateau?',
];

function looksLikeMealPlanRequest(message: string) {
  const normalized = message.toLowerCase();
  return [
    'meal plan',
    'mealprep',
    'meal prep',
    'breakfast',
    'lunch',
    'dinner',
    'snack',
    'swap this meal',
    'change my meals',
    'update my meals',
    'update my meal plan',
    'make my meals',
    'grocery list',
    'groceries',
    'shopping list',
    'what should i eat',
    'what to eat',
  ].some((token) => normalized.includes(token));
}

function TypingIndicator({ accentColor }: { accentColor: string }) {
  const anims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    const loops = anims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(anim, { toValue: -5, duration: 220, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.delay((2 - i) * 140 + 80),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [anims]);

  return (
    <View style={styles.typingWrap}>
      {anims.map((anim, index) => (
        <Animated.View
          key={index}
          style={[styles.typingDot, { transform: [{ translateY: anim }], backgroundColor: accentColor }]}
        />
      ))}
    </View>
  );
}

function MsgBubble({
  msg,
  userInitials,
  userAvatarUrl,
  accentSoft,
  accentStrongBorder,
  coachAvatar,
  coachLabel,
}: {
  msg: Message;
  userInitials: string;
  userAvatarUrl?: string;
  accentSoft: string;
  accentStrongBorder: string;
  coachAvatar?: CoachVoiceOption['avatar'];
  coachLabel: string;
}) {
  const isUser = msg.role === 'user';
  const parts = msg.text.split(/(\*\*.*?\*\*)/g);

  return (
    <View style={[styles.msgRow, isUser ? styles.msgRowUser : null]}>
      {!isUser ? (
        <View style={styles.aiAva}>
          {coachAvatar ? (
            <Image source={coachAvatar} style={styles.aiAvaImage} />
          ) : (
            <Text style={styles.aiAvaFallbackText}>{coachLabel.slice(0, 1)}</Text>
          )}
        </View>
      ) : null}
      <View style={[styles.bubble, isUser ? [styles.bubbleUser, { backgroundColor: accentSoft, borderColor: accentStrongBorder }] : styles.bubbleAI]}>
        {msg.typing ? (
          <TypingIndicator accentColor={accentSoft} />
        ) : (
          <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : null]}>
            {parts.map((part, index) =>
              part.startsWith('**') && part.endsWith('**') ? (
                <Text key={index} style={styles.boldText}>
                  {part.slice(2, -2)}
                </Text>
              ) : (
                <React.Fragment key={index}>{part}</React.Fragment>
              ),
            )}
          </Text>
        )}
      </View>
      {isUser ? (
        <View style={styles.userAva}>
          {userAvatarUrl ? (
            <Image source={{ uri: userAvatarUrl }} style={styles.userAvaImage} />
          ) : (
            <Text style={styles.userAvaText}>{userInitials}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

type CoachTab = 'ai' | 'live';

export default function CoachScreen() {
  const { accent, accentSoft, accentBorder, accentStrongBorder } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<any>();
  const { session } = useAuth();
  const { level, xp } = useGamification();
  const { isPro, isLoading: proLoading } = usePro();
  const { activeEnergy, steps, sleep } = useHealth();
  const insets = useSafeAreaInsets();
  const [coachTab, setCoachTab] = useState<CoachTab>('ai');
  // Resolved admin flag — `isAdminEnabled()` is async; the previous code
  // dereferenced the returned Promise (which is always truthy) so the Studio
  // tab leaked to every user. Now resolved into proper state and refreshed
  // when the screen regains focus.
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);

  // ── Hidden dev tool: 7-tap on coach label → password → dev screens ──
  const devTapCount = useRef(0);
  const devTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDevTap = useCallback(() => {
    devTapCount.current += 1;
    if (devTapTimer.current) clearTimeout(devTapTimer.current);
    devTapTimer.current = setTimeout(() => { devTapCount.current = 0; }, 2000);

    if (devTapCount.current >= 7) {
      devTapCount.current = 0;
      if (devTapTimer.current) clearTimeout(devTapTimer.current);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => null);
      Alert.prompt(
        '🔒 Dev Access',
        'Enter coach access password',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unlock',
            onPress: async (password) => {
              const ok = await verifyCoachAccessPassword(password ?? '');
              if (ok) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
                navigation.navigate('ChallengeComplete');
                setTimeout(() => navigation.navigate('ShakeCheckout', { flavor: 'chocolate' } as any), 600);
              } else {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => null);
                Alert.alert('Access Denied', 'Incorrect password.');
              }
            },
          },
        ],
        'secure-text',
      );
    }
  }, [navigation]);

  // Auto-switch to live tab when navigated with openLiveCoach param
  useEffect(() => {
    if (route.params?.openLiveCoach) {
      setCoachTab('live');
    }
  }, [route.params?.openLiveCoach]);

  useFocusEffect(
    React.useCallback(() => {
      isAdminEnabled().then(setIsAdminUnlocked).catch(() => null);
    }, []),
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chipsVisible, setChipsVisible] = useState(true);
  const [userInitials, setUserInitials] = useState('ME');
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>(undefined);
  const [freeMessagesUsed, setFreeMessagesUsed] = useState(0);
  const [activeCoachVoice, setActiveCoachVoice] = useState<CoachVoiceOption | null>(null);
  const flatRef = useRef<FlatList<Message>>(null);
  const activeCoachLabel = activeCoachVoice?.label ?? 'Coach Josh';
  const activeCoachAvatar = activeCoachVoice?.avatar;

  // Reload selected coach voice whenever this screen is focused
  // (user may have changed it in Profile settings)
  useFocusEffect(
    React.useCallback(() => {
      getSelectedCoachVoice().then(setActiveCoachVoice).catch(() => null);
    }, [])
  );

  // Load profile → build real welcome + initials + free message count
  useEffect(() => {
    AsyncStorage.getItem(PROFILE_STORAGE_KEY)
      .then((raw) => {
        const p: UserProfile | null = raw ? (JSON.parse(raw) as UserProfile) : null;
        const name: string = p?.displayName || session?.user?.email?.split('@')[0] || 'Athlete';
        setUserAvatarUrl(p?.avatarUrl);
        const initials = name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
        if (initials) setUserInitials(initials);

        // Build today's workout line from real active plan
        const planId = p?.activePlanId && p.activePlanId !== 'ai-generated'
          ? p.activePlanId
          : getSuggestedPlanId(p?.goal ?? 'recomp', p?.experience ?? 'intermediate');
        const plan = getPlanById(planId);
        const dayIdx = todayProgramIndex();
        const todayEntry = plan.schedule[dayIdx] ?? plan.schedule[0];
        const todayWorkout = todayEntry?.name ?? 'Rest Day';

        // Macro targets from real profile data
        const targets = getOrComputeMacroTargets(p);
        const goalLabel: Record<string, string> = {
          lose: 'fat loss', build: 'muscle gain', recomp: 'body recomposition', performance: 'performance',
        };
        const goal = goalLabel[p?.goal ?? ''] ?? 'your goals';

        const firstName = name.split(' ')[0] ?? name;
        const welcomeText = [
          `Hey ${firstName}! 💪 I'm ${activeCoachLabel}, your coach.`,
          '',
          `**Today's session:** ${todayWorkout}`,
          `**Your target:** ${targets.dailyCalorieTarget} kcal · ${targets.dailyProtein}g protein`,
          `**Goal:** ${goal}`,
          '',
          "What do you want to work on today? I'll build it immediately.",
        ].join('\n');

        setMessages([{ id: 'welcome', role: 'ai', text: welcomeText }]);
      })
      .catch(() => {
        setMessages([{
          id: 'welcome',
          role: 'ai',
          text: `Hey! 💪 I'm ${activeCoachLabel}, your coach. What do you want to work on today? I'll build it immediately.`,
        }]);
      });
  }, [activeCoachLabel, session?.user?.email]);

  // Load free message counter
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(freeMsgKey(session?.user?.id)),
      AsyncStorage.getItem(draftMsgKey(session?.user?.id)),
    ])
      .then(([freeVal, draftVal]) => {
        setFreeMessagesUsed(freeVal ? Number(freeVal) : 0);
        if (draftVal) setInput(draftVal);
      })
      .catch(() => null);
  }, [session?.user?.id]);

  useEffect(() => {
    AsyncStorage.setItem(draftMsgKey(session?.user?.id), input).catch(() => null);
  }, [input, session?.user?.id]);

  useEffect(() => {
    const loadMessages = async () => {
      if (!session?.user?.id) {
        return;
      }

      const { data } = await supabase
        .from('coach_messages')
        .select('id, sender_role, content')
        .eq('user_id', session.user.id)
        .order('sent_at', { ascending: true })
        .limit(20);

      if (!data?.length) {
        return;
      }

      setMessages(
        data.map((item) => ({
          id: item.id,
          role: item.sender_role === 'user' ? 'user' : 'ai',
          text: item.content,
        })),
      );
      setChipsVisible(false);
    };

    loadMessages().catch(() => null);
  }, [session?.user?.id]);

  const saveMessage = async (role: 'user' | 'coach', text: string) => {
    if (!session?.user?.id) {
      return;
    }

    await supabase.from('coach_messages').insert({
      content: text,
      sender_role: role,
      user_id: session.user.id,
    });
  };

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) {
      return;
    }

    // AI Coach gate removed for Apex 1-on-1 launch (RECONCILED_DECISIONS_V2 §6.3):
    // Apex users have already paid for coaching outside the app and should not
    // see consumer-style upgrade language or message limits. The free-message
    // counter is also no longer surfaced in the UI below.

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    AsyncStorage.removeItem(draftMsgKey(session?.user?.id)).catch(() => null);
    setChipsVisible(false);

    const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', text: msg };
    const typingId = `typing-${Date.now()}`;
    const typingMsg: Message = { id: typingId, role: 'ai', text: '', typing: true };

    setMessages((prev) => [...prev, userMsg, typingMsg]);
    setLoading(true);
    saveMessage('user', msg).catch(() => null);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      if (looksLikeMealPlanRequest(msg)) {
        const [profileRaw, existingPlan, labAnalysesForMeal] = await Promise.all([
          AsyncStorage.getItem(PROFILE_STORAGE_KEY),
          loadMealPlanFromStorage(),
          getSavedLabAnalyses(),
        ]);

        const profile = profileRaw ? (JSON.parse(profileRaw) as UserProfile) : null;
        let labContext: string | undefined;
        if (labAnalysesForMeal.length > 0) {
          const l = labAnalysesForMeal[0];
          labContext = `Summary: ${l.summary}`;
          if (l.deficiencies.length) labContext += `\nDeficiencies: ${l.deficiencies.join(', ')}`;
          if (l.supplements.length) labContext += `\nRecommended supplements: ${l.supplements.join('; ')}`;
          if (l.mealAdjustments.length) labContext += `\nMeal adjustments: ${l.mealAdjustments.join('; ')}`;
          if (l.biomarkers.length) labContext += `\nKey biomarkers: ${l.biomarkers.map((b) => `${b.name} ${b.value}${b.unit} (${b.status})`).join(', ')}`;
        }

        const { reply } = await coachGenerateOrUpdateMealPlan({
          existingPlan,
          profile,
          request: msg,
          labContext,
        });

        setMessages((prev) => [
          ...prev.filter((item) => item.id !== typingId),
          { id: `ai-${Date.now()}`, role: 'ai', text: `${reply} Open Fuel → Meal Plans to review it.` },
        ]);
        saveMessage('coach', `${reply} Open Fuel → Meal Plans to review it.`).catch(() => null);
        return;
      }

      // Build conversation history — exclude typing indicators and the just-added user message
      // (it was already pushed to state; we re-add it as the final entry below)
      const historyMessages = messages
        .filter((m) => !m.typing && m.id !== 'welcome')
        .slice(-12) // last 12 messages for context window efficiency
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

      // Append current user turn
      historyMessages.push({ role: 'user', content: msg });

      // ── Build real user context for every AI call ──────────────────
      let contextBlock = `User level: ${level}. XP: ${xp}.`;
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const [profileRaw, recentWorkouts, todayNutrition, labAnalyses] = await Promise.all([
          AsyncStorage.getItem(PROFILE_STORAGE_KEY),
          supabase
            .from('workouts')
            .select('workout_type, duration_minutes, calories_burned, workout_date')
            .eq('user_id', session?.user?.id ?? '')
            .order('workout_date', { ascending: false })
            .limit(5)
            .then(({ data }) => data ?? []),
          session?.user?.id
            ? supabase
                .from('nutrition_entries')
                .select('calories, protein_grams, carbs_grams, fat_grams')
                .eq('user_id', session.user.id)
                .gte('consumed_at', startOfDay.toISOString())
                .then(({ data }) => data ?? [])
            : Promise.resolve([]),
          getSavedLabAnalyses(),
        ]);

        if (labAnalyses.length > 0) {
          const latest = labAnalyses[0];
          const biomarkerLines = latest.biomarkers.length > 0
            ? latest.biomarkers.map((b) => `  • ${b.name}: ${b.value} ${b.unit} (${b.status})${b.note ? ` — ${b.note}` : ''}`).join('\n')
            : '  • No individual biomarkers extracted';
          contextBlock += `\n\nLAB RESULTS (uploaded ${new Date(latest.analysedAt).toLocaleDateString()}):\nSummary: ${latest.summary}\nBiomarkers:\n${biomarkerLines}`;
          if (latest.deficiencies.length > 0) contextBlock += `\nDeficiencies: ${latest.deficiencies.join(', ')}`;
          if (latest.supplements.length > 0) contextBlock += `\nRecommended supplements: ${latest.supplements.join('; ')}`;
          if (latest.mealAdjustments.length > 0) contextBlock += `\nMeal adjustments: ${latest.mealAdjustments.join('; ')}`;
          if (latest.workoutAdjustments.length > 0) contextBlock += `\nWorkout adjustments: ${latest.workoutAdjustments.join('; ')}`;
        }

        const p: UserProfile | null = profileRaw ? (JSON.parse(profileRaw) as UserProfile) : null;
        if (p) {
          const targets = getOrComputeMacroTargets(p);
          const bmr = calcBMR(
            p.weightLbs || '185',
            p.heightFt || "5'10",
            p.age || '30',
            p.gender || 'male',
          );
          const minutesIntoDay = new Date().getHours() * 60 + new Date().getMinutes();
          const restingBurnSoFar = Math.round(bmr * Math.max(0, Math.min(1, minutesIntoDay / (24 * 60))));
          const planId = p.activePlanId && p.activePlanId !== 'ai-generated'
            ? p.activePlanId
            : getSuggestedPlanId(p.goal ?? 'recomp', p.experience ?? 'intermediate');
          const plan = getPlanById(planId);
          const todayEntry = plan.schedule[todayProgramIndex()] ?? plan.schedule[0];

          contextBlock += `\n\nUSER PROFILE:
- Name: ${p.displayName ?? 'Athlete'}
- Goal: ${p.goal ?? 'recomp'} | Experience: ${p.experience ?? 'intermediate'}
- Weight: ${p.weightLbs ? `${p.weightLbs} lbs` : 'unknown'} | Goal weight: ${p.goalWeightLbs ? `${p.goalWeightLbs} lbs` : 'unknown'}
- BMR: ${bmr} kcal/day | Resting burn so far today: ${restingBurnSoFar} kcal
- Daily targets: ${targets.dailyCalorieTarget} kcal · ${targets.dailyProtein}g protein · ${targets.dailyCarbs}g carbs · ${targets.dailyFat}g fat
- Active plan: ${plan.title} | Today: ${todayEntry?.name ?? 'Rest'}
- Food preferences: ${p.foodPreferences?.join(', ') || 'none specified'}
- Foods to avoid: ${p.foodAvoidances?.trim() || 'none specified'}
- Health conditions: ${p.healthConditions?.length ? p.healthConditions.join(', ') : 'none'}
- Equipment: ${p.equipment?.join(', ') || 'standard gym'}`;

          const exerciseCatalog = getPlanBuilderExerciseCatalog();
          contextBlock += `\n\nPLAN BUILDER EXERCISE CATALOG:
- Strength / main lifts: ${exerciseCatalog.strength.join(', ')}
- Hypertrophy / accessory lifts: ${exerciseCatalog.hypertrophy.join(', ')}
- Conditioning / athletic work: ${exerciseCatalog.conditioning.join(', ')}
- Recovery / mobility work: ${exerciseCatalog.recovery.join(', ')}
When building workouts or programs, prefer exercises from this catalog unless the user's equipment or request clearly calls for something else. Use specific exercise names with equipment, grip, position, or bench angle when relevant.`;
        }

        if (recentWorkouts.length > 0) {
          const workoutLines = (recentWorkouts as Array<{ workout_type: string; duration_minutes: number; calories_burned: number; workout_date: string }>)
            .map((w) => `  • ${w.workout_date}: ${w.workout_type} (${w.duration_minutes} min, ${w.calories_burned} kcal)`)
            .join('\n');
          contextBlock += `\n\nRECENT WORKOUTS (last 5):\n${workoutLines}`;
        }

        // Sleep data from HealthKit
        if (sleep) {
          contextBlock += `\n\nLAST NIGHT'S SLEEP (from Apple Health): ${sleep.totalHours}h total — REM: ${sleep.remMinutes}m, Deep: ${sleep.deepMinutes}m, Light: ${sleep.lightMinutes}m`;
        }
        if ((steps ?? 0) > 0 || (activeEnergy ?? 0) > 0) {
          contextBlock += `\n\nTODAY'S HEALTH DATA (from phone / Apple Health): ${(steps ?? 0).toLocaleString()} steps · ${Math.round(activeEnergy ?? 0)} active kcal`;
        }

        const nutritionRows = todayNutrition as Array<{ calories: number; protein_grams: number; carbs_grams: number; fat_grams: number }>;
        if (nutritionRows.length > 0) {
          const todayTotals = nutritionRows.reduce(
            (sum, e) => ({ kcal: sum.kcal + (e.calories ?? 0), protein: sum.protein + (e.protein_grams ?? 0), carbs: sum.carbs + (e.carbs_grams ?? 0), fat: sum.fat + (e.fat_grams ?? 0) }),
            { kcal: 0, protein: 0, carbs: 0, fat: 0 },
          );
          contextBlock += `\n\nTODAY'S NUTRITION SO FAR: ${Math.round(todayTotals.kcal)} kcal · ${Math.round(todayTotals.protein)}g protein · ${Math.round(todayTotals.carbs)}g carbs · ${Math.round(todayTotals.fat)}g fat`;
        }
      } catch { /* context fetch failed — proceed with base system prompt */ }
      // ── End context build ───────────────────────────────────────────

      const personaBlock = activeCoachVoice?.persona
        ? `\n\n── COACH PERSONA ──\n${activeCoachVoice.persona}`
        : '';

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 1200,
          messages: historyMessages,
          system: `${SYSTEM_PROMPT}${personaBlock}\n\n${contextBlock}`,
        },
      });

      if (error) {
        throw error;
      }

      const rawReply =
        data?.content?.map((block: { text?: string }) => block.text ?? '').join('') ||
        'I could not generate a reply right now. Try again in a moment.';

      // Parse and save any embedded workout
      const { workout, cleanText: afterWorkout } = parseWorkoutTag(rawReply);
      if (workout) {
        saveAIWorkout(workout).catch(() => null);
      }

      // Parse and save any embedded program, then set activePlanId = 'ai-generated'
      const { program, cleanText: reply } = parseProgramTag(afterWorkout);
      if (program) {
        saveAIProgram(program).catch(() => null);
        // Persist activePlanId so PlansScreen shows the AI program
        AsyncStorage.getItem(PROFILE_STORAGE_KEY)
          .then((raw) => {
            const base = raw ? (JSON.parse(raw) as UserProfile) : {} as UserProfile;
            return syncProfileToSupabase(session?.user?.id, { ...base, activePlanId: 'ai-generated' });
          })
          .catch(() => null);
      }

      setMessages((prev) => [
        ...prev.filter((item) => item.id !== typingId),
        { id: `ai-${Date.now()}`, role: 'ai', text: reply },
      ]);
      saveMessage('coach', reply).catch(() => null);
    } catch {
      const isExpoGo = Constants.executionEnvironment === 'storeClient';
      const fallbackReply = isExpoGo
        ? '**Pre-workout plan:** have 25 to 40g carbs plus 20 to 30g protein 60 to 90 minutes before training. Try oats and whey, Greek yogurt with fruit, or rice and chicken if you want a heavier meal.'
        : 'Connection issue right now. Try again in a moment and I will pick it back up.';
      setMessages((prev) => [
        ...prev.filter((item) => item.id !== typingId),
        {
          id: `ai-${Date.now()}`,
          role: 'ai',
          text: fallbackReply,
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  // Shared tab switcher used in both branches
  const tabSwitcher = (
    <View style={styles.coachTabRow}>
      <Pressable
        style={[styles.coachTabBtn, coachTab === 'ai' ? [styles.coachTabBtnActive, { backgroundColor: accent, borderColor: accent }] : null]}
        onPress={() => { setCoachTab('ai'); handleDevTap(); }}
      >
        <Text style={[styles.coachTabText, coachTab === 'ai' ? styles.coachTabTextActive : null]}>{activeCoachLabel}</Text>
      </Pressable>
      <Pressable
        style={[styles.coachTabBtn, coachTab === 'live' ? [styles.coachTabBtnActive, { backgroundColor: accent, borderColor: accent }] : null]}
        onPress={() => setCoachTab('live')}
      >
        <Text style={[styles.coachTabText, coachTab === 'live' ? styles.coachTabTextActive : null]}>📹 Live Coach</Text>
      </Pressable>
    </View>
  );

  if (coachTab === 'live') {
    return (
      <View style={{ flex: 1, backgroundColor: '#080808' }}>
        <AppHeader />
        {tabSwitcher}
        <LiveCoachScreen embedded />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <AppHeader />
      {tabSwitcher}
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MsgBubble
            msg={item}
            userInitials={userInitials}
            userAvatarUrl={userAvatarUrl}
            accentSoft={accentSoft}
            accentStrongBorder={accentStrongBorder}
            coachAvatar={activeCoachAvatar}
            coachLabel={activeCoachLabel}
          />
        )}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <Pressable
              style={({ pressed }) => [styles.labCard, pressed && styles.labCardPressed]}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
                navigation.navigate('LabUpload');
              }}
            >
              <View style={styles.labCardIcon}>
                <Text style={{ fontSize: 22 }}>🧪</Text>
              </View>
              <View style={styles.labCardBody}>
                <Text style={styles.labCardTitle}>Lab Analysis</Text>
                <Text style={styles.labCardSub}>
                  {`Upload bloodwork or health data — ${activeCoachLabel} interprets every marker`}
                </Text>
              </View>
              <Text style={styles.labCardChevron}>›</Text>
            </Pressable>
          </>
        }
      />

      {/* Pro gate banner removed for Apex 1-on-1 launch (RECONCILED_DECISIONS_V2 §6.3) */}

      {chipsVisible ? (
        <View style={styles.chipWrap}>
          {QUICK_CHIPS.map((chip) => (
            <Pressable key={chip} style={[styles.chip, { borderColor: accent }]} onPress={() => sendMessage(chip)}>
              <Text style={styles.chipText}>{chip}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Free message counter removed for Apex 1-on-1 launch (RECONCILED_DECISIONS_V2 §6.3) */}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={`Ask ${activeCoachLabel} anything...`}
          placeholderTextColor={C.subtle}
          value={input}
          onChangeText={setInput}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, !input.trim() || loading ? styles.sendBtnDisabled : null, { backgroundColor: accent }]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.sendBtnText}>➤</Text>
        </Pressable>
      </View>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  devClearBtn: {
    paddingVertical: 5,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,60,60,0.2)',
    backgroundColor: 'rgba(255,60,60,0.05)',
  },
  devClearBtnText: {
    fontSize: 10,
    fontFamily: 'SpaceMono_400Regular',
    color: 'rgba(255,100,100,0.7)',
    letterSpacing: 0.3,
  },
  coachTabRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  coachTabBtn: { flex: 1, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center' },
  coachTabBtnActive: { backgroundColor: C.green, borderColor: C.green },
  coachTabText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_500Medium' },
  coachTabTextActive: { color: '#000', fontFamily: 'DMSans_700Bold' },
  messageList: { padding: 14, gap: 12, paddingBottom: 8 },
  labCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(99,102,241,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.35)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  labCardLocked: {
    opacity: 0.7,
  },
  labCardPressed: {
    opacity: 0.75,
  },
  labCardIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(99,102,241,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labCardBody: { flex: 1, gap: 3 },
  labCardTitle: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    color: '#a5b4fc',
  },
  labCardSub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: C.muted,
    lineHeight: 17,
  },
  labCardChevron: {
    color: '#a5b4fc',
    fontSize: 20,
    lineHeight: 24,
  },
  msgRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', maxWidth: '85%' },
  msgRowUser: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  aiAva: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,255,135,0.1)',
    borderWidth: 1,
    borderColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  aiAvaImage: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
  },
  aiAvaFallbackText: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 13,
  },
  userAva: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.purple,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  userAvaImage: { width: '100%', height: '100%' },
  userAvaText: { fontSize: 11, color: '#fff', fontFamily: 'DMSans_500Medium', fontWeight: '700' },
  bubble: { padding: 10, paddingHorizontal: 13, borderRadius: 14, flexShrink: 1 },
  bubbleAI: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderTopLeftRadius: 4,
  },
  bubbleUser: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderTopRightRadius: 4,
  },
  bubbleText: { fontSize: 13, lineHeight: 20, color: C.text, fontFamily: 'DMSans_400Regular' },
  bubbleTextUser: { color: C.text },
  boldText: { fontFamily: 'DMSans_500Medium', color: C.text },
  typingWrap: { flexDirection: 'row', gap: 4, alignItems: 'center', padding: 4 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 0,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    minHeight: 34,
    justifyContent: 'center',
  },
  chipText: { fontSize: 11, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  freeCounterBar: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.black,
  },
  freeCounterText: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    textAlign: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    padding: 10,
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.dark,
  },
  input: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 11,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    maxHeight: 120,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: { color: '#000', fontSize: 20 },
  proBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,107,53,0.12)',
    borderTopWidth: 1,
    borderTopColor: C.orangeBorder,
  },
  proBannerText: {
    fontSize: 11,
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 0.3,
  },
  // Fit calls dashboard (coach admin)
  fitCallsSection: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  fitCallsSectionTitle: {
    fontSize: 13,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginBottom: 2,
  },
  fitCallsEmpty: {
    fontSize: 13,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    paddingVertical: 8,
  },
  fitCallCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  fitCallCardName: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginBottom: 2,
  },
  fitCallCardDateTime: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginBottom: 4,
  },
  fitCallCardChallenge: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 17,
  },
  fitCallCardRight: {
    alignItems: 'flex-end',
    gap: 8,
    flexShrink: 0,
  },
  fitCallStatusBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fitCallStatusPending: {
    backgroundColor: 'rgba(255,196,0,0.1)',
    borderColor: 'rgba(255,196,0,0.4)',
  },
  fitCallStatusConfirmed: {
    backgroundColor: 'rgba(0,255,136,0.08)',
    borderColor: C.greenBorder,
  },
  fitCallStatusText: {
    fontSize: 9,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 0.5,
  },
  fitCallStatusTextPending: { color: '#FFC400' },
  fitCallStatusTextConfirmed: { color: C.green },
  fitCallCallBtn: {
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,255,136,0.06)',
  },
  fitCallCallBtnText: {
    fontSize: 12,
    color: C.green,
    fontFamily: 'DMSans_500Medium',
  },
});
