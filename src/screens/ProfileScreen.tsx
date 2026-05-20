import React, { useCallback, useEffect, useMemo, useState } from 'react';

import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { Animated, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '@/contexts/AuthContext';
import { useGamification } from '@/contexts/GamificationContext';
import { AchievementShareCard, STORY_CARD_W, STORY_CARD_H } from '@/components/AchievementShareCard';
import { useAchievements } from '@/hooks/useAchievements';
import { getAchievementShareMessage, type UserAchievement } from '@/lib/achievements';
import type { MainStackParamList } from '@/navigation/MainNavigator';
import { supabase } from '@/lib/supabase';
import { requestWearablePermissions, readWearableMetrics, type WearableMetrics } from '@/lib/wearables';
import { deriveMacroTargets, getOrComputeMacroTargets } from '@/lib/bmr';
import { apexColors as C } from '@/theme/colors';
import { THEMES, useTheme, type ThemeId } from '@/contexts/ThemeContext';
import { getCalendarSettings, saveCalendarSettings, type CalendarSettings } from '@/lib/calendarIntegration';
import { addAchievementPostToFeed } from '@/lib/tribeFeed';
import { HEALTH_CONDITIONS, PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { getEarnedTitles, getTitleById, TITLE_DEFINITIONS, type TitleDefinition } from '@/lib/titles';
import {
  cancelAllCoachNotifications,
  DEFAULT_NOTIF_PREFS,
  getNotifPrefs,
  registerForPushNotificationsAsync,
  saveNotifPrefs,
  scheduleCoachNotifications,
  type NotifPrefs,
} from '@/lib/notifications';
import { clearAIWorkout, clearAIProgram } from '@/lib/aiWorkout';
import { cacheProfileLocally, hydrateProfileFromSupabase, syncProfileToSupabase } from '@/lib/profileSync';
import { VerifyEmailBanner } from '@/components/VerifyEmailBanner';
import { usePro } from '@/hooks/usePro';
import {
  clearAdminOverrides,
  isAdminEnabled,
  isProPreview,
  setAdminEnabled,
  setProPreview,
} from '@/lib/adminMode';
import { Switch } from 'react-native';
import { maybeShowPaywall } from '@/lib/revenuecat';
import {
  getCoachVoiceOptionById,
  getCoachVoiceOptions,
  getSelectedCoachVoiceId,
  setSelectedCoachVoiceId,
} from '@/lib/coachVoice';
import { migratePostAuthors } from '@/lib/tribeFeed';

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
const MEALS_PER_DAY_OPTIONS: Array<NonNullable<UserProfile['mealsPerDay']>> = ['2', '3', '4', '5+'];
const WORKOUT_WINDOW_OPTIONS: Array<{ key: NonNullable<UserProfile['workoutWindow']>; label: string; sub: string }> = [
  { key: 'before_work', label: 'Before work', sub: 'Get it done early' },
  { key: 'lunch', label: 'Lunch break', sub: 'Midday training window' },
  { key: 'after_work', label: 'After work', sub: 'Most consistent for me' },
  { key: 'evening', label: 'Evening', sub: 'Later night session' },
  { key: 'varies', label: 'Varies', sub: 'My schedule changes a lot' },
];

const GOAL_LABELS: Record<string, string> = {
  lose: '🔥 Lose Fat',
  build: '💪 Build Muscle',
  recomp: '⚡ Recomp',
  performance: '🏆 Performance',
};

// Third-party device rows — none have a real SDK integration yet.
// comingSoon: true = show a "Coming Soon" label instead of a Connect button.
const DEVICES = [
  { icon: '💎', key: 'whoop', name: 'WHOOP 4.0', connected: false, comingSoon: true },
  { icon: '🔴', key: 'garmin', name: 'Garmin', connected: false, comingSoon: true },
];

const PROGRESS_PHOTOS_STORAGE_KEY = 'apex.progress.photos.v1';
const GOAL_PREVIEW_STORAGE_KEY = 'apex.progress.goalPreview.v1';
const LOCAL_FACTORY_RESET_KEYS = [
  'apex._edition.walkWater',
  'apex._edition.walkWaterQuiz',
  'apex._edition.walkWaterPlan',
  'apex._edition.wwUpgraded',
  'apex.user.profile',
  '@apex.coach_dm.v1',
  'apex.ww.coachCardMinimized',
  'apex.ww.challengeOfferExpiry',
  'apex.ww.community.chat',
  'apex.ww.tribe.chat',
  'apex.walk.completedWalks.v1',
  'apex.inapp.seenWalkStreakMilestones',
  'apex.onboarding.firstActionPending',
] as const;

type ProgressPhotoSlot = 'front' | 'rear' | 'side';

type ProgressPhotos = Record<ProgressPhotoSlot, string | null> & {
  updatedAt?: string;
};

type GoalPreviewResult = {
  focus: string[];
  headline: string;
  imageUrl?: string | null;
  summary: string;
};

const COACH_PROFILE_IMAGES: Record<string, unknown> = {
  Marcus: require('../../assets/marcus-coach.png'),
  Serena: require('../../assets/serena-coach.png'),
};


function getEmailVerificationStatusLabel(sessionEmailVerified: boolean) {
  return sessionEmailVerified ? 'Email verified' : 'Email not verified';
}

export default function ProfileScreen() {
  const { accent, accentSoft, accentBorder, accentStrongBorder, setTheme, id: activeThemeId } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const { isEmailVerified, session, signOut } = useAuth();
  const { isPro, isLoading: proLoading } = usePro();
  const { level, xp } = useGamification();
  const { achievements, stats } = useAchievements();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shareAchievement, setShareAchievement] = useState<UserAchievement | null>(null);
  const [wearableMetrics, setWearableMetrics] = useState<WearableMetrics | null>(null);
  const [wearableConnected, setWearableConnected] = useState(false);
  const [connectingWearable, setConnectingWearable] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState('');
  const [deleteReason, setDeleteReason] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [statsEditorVisible, setStatsEditorVisible] = useState(false);
  const [statsDraft, setStatsDraft] = useState<UserProfile | null>(null);
  const [regenPromptVisible, setRegenPromptVisible] = useState(false);
  const [regenTargets, setRegenTargets] = useState<{ dailyCalorieTarget: number; dailyProtein: number; dailyCarbs: number; dailyFat: number } | null>(null);
  const [titlePickerVisible, setTitlePickerVisible] = useState(false);
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const [selectedCoachVoiceId, setSelectedCoachVoiceIdState] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  // Notification settings
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);
  const [notifPermission, setNotifPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [schedulingNotifs, setSchedulingNotifs] = useState(false);
  // Weight log
  const [waitlistLoadingKey, setWaitlistLoadingKey] = useState<string | null>(null);
  const [waitlistedFeatures, setWaitlistedFeatures] = useState<string[]>([]);
  const [progressPhotos, setProgressPhotos] = useState<ProgressPhotos>({
    front: null,
    side: null,
    rear: null,
  });
  const [goalPreview, setGoalPreview] = useState<GoalPreviewResult | null>(null);
  const [goalPreviewLoading, setGoalPreviewLoading] = useState(false);
  const [coachBioLoading, setCoachBioLoading] = useState(false);
  const [notifSectionExpanded, setNotifSectionExpanded] = useState(false);
  const [privacySectionExpanded, setPrivacySectionExpanded] = useState(false);
  const [themeSectionExpanded, setThemeSectionExpanded] = useState(false);
  // Admin / Dev tools
  const [adminEnabled, setAdminEnabledState] = useState(false);
  const [proPreview, setProPreviewState] = useState(false);
  const [adminTapCount, setAdminTapCount] = useState(0);
  const [coachBioDraft, setCoachBioDraft] = useState('');
  const [calSettings, setCalSettings] = useState<CalendarSettings>({ googleApiKey: '', googleCalendarId: '' });
  const [calSaving, setCalSaving] = useState(false);
  const shareCardRef = React.useRef<ViewShot>(null);

  // Reload profile every time this screen comes into focus so the share card
  // always reflects the most current display name (including edits made on
  // other screens or sessions).
  useFocusEffect(
    useCallback(() => {
      const loadProfile = async () => {
        // 1. Load local cache immediately for fast render
        const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
        const cached: UserProfile | null = raw ? (JSON.parse(raw) as UserProfile) : null;
        if (cached) setProfile(cached);
        if (cached?.coachBio) setCoachBioDraft(cached.coachBio);
        getCalendarSettings().then(setCalSettings).catch(() => null);

        // 2. Hydrate the full profile from Supabase so personalization survives device changes
        if (session?.user?.id) {
          const hydrated = await hydrateProfileFromSupabase(session.user.id);
          if (hydrated) {
            setProfile(hydrated);
            setCoachBioDraft(hydrated.coachBio ?? '');
          }
        }
      };
      loadProfile().catch(() => null);
      getSelectedCoachVoiceId().then(setSelectedCoachVoiceIdState).catch(() => null);
      AsyncStorage.getItem(PROGRESS_PHOTOS_STORAGE_KEY)
        .then((raw) => {
          if (!raw) return;
          const saved = JSON.parse(raw) as ProgressPhotos;
          setProgressPhotos({
            front: saved.front ?? null,
            side: saved.side ?? null,
            rear: saved.rear ?? null,
            updatedAt: saved.updatedAt,
          });
        })
        .catch(() => null);
      AsyncStorage.getItem(GOAL_PREVIEW_STORAGE_KEY)
        .then((raw) => {
          if (!raw) return;
          setGoalPreview(JSON.parse(raw) as GoalPreviewResult);
        })
        .catch(() => null);
    }, [session?.user?.id]),
  );

  // Load notification prefs + admin flags on mount
  useEffect(() => {
    const loadDevSettings = async () => {
      const [prefs, admin, proP, waitlistResponse] = await Promise.all([
        getNotifPrefs(),
        isAdminEnabled(),
        isProPreview(),
        session?.user?.id
          ? supabase.from('feature_waitlist').select('feature_key').eq('user_id', session.user.id)
          : Promise.resolve({ data: [], error: null }),
      ]);
      setNotifPrefs(prefs);
      setAdminEnabledState(admin);
      setProPreviewState(proP);
      setWaitlistedFeatures((waitlistResponse.data ?? []).map((row) => row.feature_key));
      // Check current permission status
      try {
        const ExpoNotifications = await import('expo-notifications');
        const { status } = await ExpoNotifications.getPermissionsAsync();
        setNotifPermission(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'unknown');
      } catch {
        setNotifPermission('unknown');
      }
    };
    loadDevSettings().catch(() => null);
  }, [session?.user?.id]);

  const persistProfile = async (nextProfile: UserProfile) => {
    const computed = getOrComputeMacroTargets(nextProfile);
    const normalizedProfile: UserProfile = {
      ...nextProfile,
      dailyCalorieTarget: computed.dailyCalorieTarget,
      dailyProtein: computed.dailyProtein,
      dailyCarbs: computed.dailyCarbs,
      dailyFat: computed.dailyFat,
    };
    setProfile(normalizedProfile);
    try {
      await syncProfileToSupabase(session?.user?.id, normalizedProfile);
    } catch {
      Alert.alert(
        'Sync failed',
        'Your changes were saved on this device, but we could not sync them to your account yet. Try again in a moment.',
      );
      throw new Error('Profile sync failed');
    }
  };

  const waitlistedFeatureSet = useMemo(() => new Set(waitlistedFeatures), [waitlistedFeatures]);

  const handleNotifyMe = async (featureKey: string, featureName: string) => {
    if (!session?.user?.id) {
      Alert.alert('Log in required', 'Log in to join the waitlist for this feature.');
      return;
    }
    if (waitlistedFeatureSet.has(featureKey)) {
      Alert.alert('Already on the list', `We’ll let you know when ${featureName} is ready.`);
      return;
    }

    setWaitlistLoadingKey(featureKey);
    try {
      const { error } = await supabase
        .from('feature_waitlist')
        .upsert(
          {
            user_id: session.user.id,
            feature_key: featureKey,
            feature_name: featureName,
            source: 'profile_devices',
          },
          { onConflict: 'user_id,feature_key' },
        );
      if (error) throw error;
      setWaitlistedFeatures((current) => [...new Set([...current, featureKey])]);
      Alert.alert('You’re on the list', `We’ll notify you when ${featureName} is ready.`);
    } catch (error) {
      Alert.alert('Could not join waitlist', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setWaitlistLoadingKey(null);
    }
  };

  const openStatsEditor = async () => {
    await Haptics.selectionAsync();
    setStatsDraft({
      ...(profile ?? {
        displayName,
        username: usernameStr,
      foodAvoidances: '',
      foodPreferences: [],
      reasonWhy: [],
      reasonWhyDetail: '',
      goal: 'recomp',
      weightLbs: '',
      heightFt: '',
      age: '',
      goalWeightLbs: '',
      gender: 'male',
      experience: 'intermediate',
      wakeTime: '7:00 AM',
      sleepTime: '10:00 PM',
      workoutTime: '6:30 PM',
      workoutWindow: 'after_work',
      mealsPerDay: '3',
    }),
  });
    setStatsEditorVisible(true);
  };
  const workoutTimeMatchesPreset = WORKOUT_TIME_OPTIONS.includes((statsDraft?.workoutTime ?? '') as (typeof WORKOUT_TIME_OPTIONS)[number]);
  const workoutTimeSelection = workoutTimeMatchesPreset ? statsDraft?.workoutTime : CUSTOM_WORKOUT_TIME_OPTION;

  const handleShareToSocial = async (achievement: UserAchievement) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShareAchievement(achievement);
    // 200 ms gives React time to render the full 9:16 story card before capture
    setTimeout(async () => {
      try {
        const uri = await shareCardRef.current?.capture?.();
        if (uri && (await Sharing.isAvailableAsync())) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share Achievement' });
          return;
        }
      } catch {
        // fall back to text sharing
      }

      await Share.share({
        message: getAchievementShareMessage(achievement),
      });
    }, 200);
  };

  const handleShareToFeed = async (achievement: UserAchievement) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await addAchievementPostToFeed({
      achievement,
      author: displayName,
    });
    Alert.alert('Shared to Tribe', `${achievement.name} was posted to your feed.`);
  };

  const handleAchievementPress = (achievement: UserAchievement) => {
    if (!achievement.earned) return;

    Alert.alert(achievement.name, 'Share this achievement with your community or socials.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Post to Tribe', onPress: () => handleShareToFeed(achievement).catch(() => null) },
      { text: 'Share Social', onPress: () => handleShareToSocial(achievement).catch(() => null) },
    ]);
  };

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  const handleOpenSuggestions = async () => {
    await Haptics.selectionAsync();
    navigation.replace('Suggestions');
  };

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || !profile) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const oldDisplayName = profile.displayName?.trim();
    const emailPrefix = session?.user?.email?.split('@')[0] ?? '';
    const normalizedCurrentUsername = (profile.username ?? '').trim().toLowerCase();
    const autoUsernames = [
      (oldDisplayName ?? '').toLowerCase().replace(/\s+/g, ''),
      emailPrefix.trim().toLowerCase(),
      'athlete',
    ].filter(Boolean);
    const nextAutoUsername = trimmed.toLowerCase().replace(/\s+/g, '');
    const nextProfile: UserProfile = {
      ...profile,
      displayName: trimmed,
      username: autoUsernames.includes(normalizedCurrentUsername)
        ? nextAutoUsername
        : profile.username,
    };
    await persistProfile(nextProfile);
    await migratePostAuthors(
      [oldDisplayName ?? '', profile.username ?? '', emailPrefix],
      trimmed,
    ).catch(() => null);
    setEditingName(false);
  };

  const handleSelectTitle = async (titleId: string) => {
    if (!profile) return;
    await Haptics.selectionAsync();
    await persistProfile({ ...profile, selectedTitle: titleId });
    setTitlePickerVisible(false);
  };

  const handleSaveCoachBio = async () => {
    if (!profile?.isCoach) return;
    await Haptics.selectionAsync().catch(() => null);
    await persistProfile({ ...profile, coachBio: coachBioDraft.trim() });
    Alert.alert('Coach profile updated', 'Your public coach intro is live across the app.');
  };

  const handleGenerateCoachBio = async () => {
    if (!profile?.isCoach || coachBioLoading) return;
    setCoachBioLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 220,
          messages: [{
            role: 'user',
            content: `Write a short public coach bio for an APEX coach.

Coach title: ${activeTitle.label}
Coach voice: ${activeCoachVoice.label}
Coach goal specialty: ${profile.goal}
Experience level: ${profile.experience}
Active plan style: ${profile.activePlanId ?? 'power-build'}
Health/nutrition emphasis: ${profile.foodPreferences?.join(', ') || 'general performance nutrition'}

Return only the bio text. Keep it under 180 characters, confident, human, and trust-building.`,
          }],
        },
      });

      if (error) throw error;
      const nextBio = ((data?.content as Array<{ text?: string }> | undefined) ?? [])
        .map((item) => item.text ?? '')
        .join('')
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!nextBio) throw new Error('No coach bio returned.');
      setCoachBioDraft(nextBio);
    } catch {
      Alert.alert('Bio unavailable', 'Could not generate a coach intro right now. Try again in a moment.');
    } finally {
      setCoachBioLoading(false);
    }
  };

  const saveProgressPhotos = async (next: ProgressPhotos) => {
    setProgressPhotos(next);
    await AsyncStorage.setItem(PROGRESS_PHOTOS_STORAGE_KEY, JSON.stringify(next)).catch(() => null);
  };

  const handlePickProgressPhoto = async (slot: ProgressPhotoSlot) => {
    await Haptics.selectionAsync().catch(() => null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to save your progress photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      aspect: slot === 'side' ? [4, 5] : [3, 4],
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    const next: ProgressPhotos = {
      ...progressPhotos,
      [slot]: result.assets[0].uri,
      updatedAt: new Date().toISOString(),
    };
    await saveProgressPhotos(next);
  };

  const handleRemoveProgressPhoto = async (slot: ProgressPhotoSlot) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    const next: ProgressPhotos = {
      ...progressPhotos,
      [slot]: null,
      updatedAt: new Date().toISOString(),
    };
    await saveProgressPhotos(next);
  };

  const handleGenerateGoalPreview = async () => {
    if (!isPro && !proLoading) {
      await maybeShowPaywall(session?.user?.id).catch(() => null);
      navigation.navigate('Upgrade');
      return;
    }
    if (goalPreviewLoading) return;
    if (!progressPhotos.front && !progressPhotos.side && !progressPhotos.rear) {
      Alert.alert('Add progress photos first', 'Upload at least one front, side, or rear photo so the preview has a real starting point.');
      return;
    }

    setGoalPreviewLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('goal-preview', {
        body: {
          experience: profile?.experience,
          frontPhoto: progressPhotos.front,
          goal: profile?.goal,
          goalWeightLbs: profile?.goalWeightLbs,
          rearPhoto: progressPhotos.rear,
          sidePhoto: progressPhotos.side,
          voiceLabel: activeCoachVoice.label,
          weightLbs: profile?.weightLbs,
        },
      });

      if (error) throw error;
      const nextPreview: GoalPreviewResult = {
        focus: Array.isArray((data as { focus?: unknown }).focus) ? ((data as { focus?: string[] }).focus ?? []).slice(0, 3) : [],
        headline: String((data as { headline?: string }).headline ?? 'Goal Physique Preview'),
        imageUrl: (data as { image_url?: string | null }).image_url ?? null,
        summary: String((data as { summary?: string }).summary ?? 'Stay consistent, train hard, and keep your nutrition aligned.'),
      };
      setGoalPreview(nextPreview);
      await AsyncStorage.setItem(GOAL_PREVIEW_STORAGE_KEY, JSON.stringify(nextPreview)).catch(() => null);
    } catch {
      Alert.alert('Preview unavailable', 'Could not generate your goal preview right now. Try again in a moment.');
    } finally {
      setGoalPreviewLoading(false);
    }
  };

  const handleConnectWearable = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // HealthKit uses NitroModules which hard-crash in Expo Go
    if (Constants.executionEnvironment === 'storeClient') {
      Alert.alert(
        'Dev Build Required',
        'Apple Health uses HealthKit which is not available in Expo Go. Run `expo prebuild` and build with EAS or Xcode to connect.',
      );
      return;
    }

    setConnectingWearable(true);
    try {
      const granted = await requestWearablePermissions();
      if (!granted) {
        Alert.alert(
          'Health Access Needed',
          'Apple Health permission was denied or HealthKit is unavailable on this device. Enable it in Settings → Health → Data Access.',
        );
        return;
      }
      const metrics = await readWearableMetrics();
      setWearableMetrics(metrics);
      setWearableConnected(true);
    } catch {
      Alert.alert('Connection failed', 'Could not connect to HealthKit. Ensure you\'re running a dev build on a real device.');
    } finally {
      setConnectingWearable(false);
    }
  };

  const handleRecalculateTargets = async () => {
    if (!profile) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRecalculating(true);
    try {
      const targets = deriveMacroTargets({
        weightLbs: profile.weightLbs,
        heightFt: profile.heightFt,
        age: profile.age,
        gender: profile.gender,
        experience: profile.experience,
        goal: profile.goal,
        goalWeightLbs: profile.goalWeightLbs,
        weeklyLossRate: profile.weeklyLossRate || '1.5',
      });
      const updated: UserProfile = { ...profile, ...targets };
      await persistProfile(updated);
      Alert.alert(
        '✅ Targets Updated',
        `${targets.dailyCalorieTarget} kcal · ${targets.dailyProtein}g protein · ${targets.dailyCarbs}g carbs · ${targets.dailyFat}g fat`,
      );
    } catch {
      Alert.alert('Error', 'Could not recalculate targets. Make sure your weight, height, and age are set in your profile.');
    } finally {
      setRecalculating(false);
    }
  };

  const handleSaveStatsAndRecalculate = async () => {
    if (!statsDraft) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRecalculating(true);
    try {
      const targets = deriveMacroTargets({
        weightLbs: statsDraft.weightLbs,
        heightFt: statsDraft.heightFt,
        age: statsDraft.age,
        gender: statsDraft.gender,
        experience: statsDraft.experience,
        goal: statsDraft.goal,
        goalWeightLbs: statsDraft.goalWeightLbs,
        weeklyLossRate: statsDraft.weeklyLossRate || profile?.weeklyLossRate || '1.5',
      });

      const updated: UserProfile = { ...statsDraft, ...targets };
      await persistProfile(updated);
      if (notifPermission === 'granted') {
        await scheduleCoachNotifications({
          goal: updated.goal,
          displayName: updated.displayName,
          mealsPerDay: updated.mealsPerDay,
          prefs: notifPrefs,
          reasonWhy: updated.reasonWhy,
          reasonWhyDetail: updated.reasonWhyDetail,
          sleepTime: updated.sleepTime,
          wakeTime: updated.wakeTime,
          workoutTime: updated.workoutTime,
          workoutWindow: updated.workoutWindow,
        }).catch(() => null);
      }
      setStatsEditorVisible(false);
      // Show the regen-plan prompt after a short delay so the stats modal
      // finishes its close animation before the new one slides up
      setRegenTargets(targets);
      setTimeout(() => setRegenPromptVisible(true), 350);
    } catch {
      Alert.alert('Error', 'Please make sure weight, age, and height are filled out correctly.');
    } finally {
      setRecalculating(false);
    }
  };

  const handleRegenPlan = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    // Clear any existing AI plan so the Coach tab generates a fresh one
    await Promise.all([clearAIWorkout(), clearAIProgram()]).catch(() => null);
    // Mark profile as 'ai-generated' so Plans + Train pick it up
    if (profile) {
      await persistProfile({ ...profile, activePlanId: 'ai-generated' });
    }
    setRegenPromptVisible(false);
    // Navigate to the Plans tab where the user can trigger AI generation
    (navigation as any).navigate('Tabs', { screen: 'Plans' });
  };

  const handleDeleteAccount = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setDeleteReason(null);
    setDeleteFeedback('');
    setDeleteModalVisible(true);
  };

  const confirmDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      // Optionally log the feedback before deleting
      if (deleteReason || deleteFeedback.trim()) {
        supabase.from('cancellation_feedback').insert({
          user_id: session?.user?.id,
          reason: deleteReason,
          additional_feedback: deleteFeedback.trim() || null,
          created_at: new Date().toISOString(),
        }).then(() => null, () => null); // fire-and-forget — don't block deletion
      }
      const { error } = await supabase.functions.invoke('delete-account', {});
      if (error) {
        Alert.alert('Error', 'Account deletion failed. Try again or contact support.');
        return;
      }
      await AsyncStorage.clear().catch(() => null);
      await signOut();
    } catch {
      Alert.alert('Error', 'Could not connect to the server. Check your connection and try again.');
    } finally {
      setDeletingAccount(false);
      setDeleteModalVisible(false);
    }
  };

  // ── Notification handlers ──────────────────────────────────────────────────
  const handleToggleNotifPref = async (key: keyof NotifPrefs, value: boolean) => {
    const updated: NotifPrefs = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    await saveNotifPrefs(updated);
    // Re-schedule with updated preferences if permission is granted
    if (notifPermission === 'granted') {
      await scheduleCoachNotifications({
        goal: profile?.goal,
        displayName: profile?.displayName,
        mealsPerDay: profile?.mealsPerDay,
        prefs: updated,
        reasonWhy: profile?.reasonWhy,
        reasonWhyDetail: profile?.reasonWhyDetail,
        sleepTime: profile?.sleepTime,
        wakeTime: profile?.wakeTime,
        workoutTime: profile?.workoutTime,
        workoutWindow: profile?.workoutWindow,
      }).catch(() => null);
    }
  };

  const handleRequestNotifPermission = async () => {
    setSchedulingNotifs(true);
    try {
      const token = await registerForPushNotificationsAsync();
      if (token || notifPermission !== 'denied') {
        setNotifPermission('granted');
        await scheduleCoachNotifications({
          goal: profile?.goal,
          displayName: profile?.displayName,
          mealsPerDay: profile?.mealsPerDay,
          prefs: notifPrefs,
          reasonWhy: profile?.reasonWhy,
          reasonWhyDetail: profile?.reasonWhyDetail,
          sleepTime: profile?.sleepTime,
          wakeTime: profile?.wakeTime,
          workoutTime: profile?.workoutTime,
          workoutWindow: profile?.workoutWindow,
        });
        Alert.alert('✅ Notifications Enabled', 'Your AI Coach will send you daily motivation, check-ins, and weekly tips.');
      } else {
        setNotifPermission('denied');
        Alert.alert(
          'Permission Denied',
          'Please enable notifications in Settings → APEX Fitness → Notifications, then come back here.',
        );
      }
    } finally {
      setSchedulingNotifs(false);
    }
  };

  const handleRescheduleNotifs = async () => {
    setSchedulingNotifs(true);
    try {
      await scheduleCoachNotifications({
        goal: profile?.goal,
        displayName: profile?.displayName,
        mealsPerDay: profile?.mealsPerDay,
        prefs: notifPrefs,
        reasonWhy: profile?.reasonWhy,
        reasonWhyDetail: profile?.reasonWhyDetail,
        sleepTime: profile?.sleepTime,
        wakeTime: profile?.wakeTime,
        workoutTime: profile?.workoutTime,
        workoutWindow: profile?.workoutWindow,
      });
      Alert.alert('✅ Rescheduled', 'AI Coach notifications have been refreshed for the next 7 days.');
    } catch {
      Alert.alert('Error', 'Could not reschedule notifications. Make sure permissions are granted.');
    } finally {
      setSchedulingNotifs(false);
    }
  };

  // ── Admin / Developer tool handlers ───────────────────────────────────────
  // The 7-tap unlock is restricted to __DEV__ builds for launch safety
  // (RECONCILED_DECISIONS_V2 §6.4 + audit "Coach access not production-safe").
  // In production builds, dev tools remain accessible only via the
  // password-based Coach Mode unlock (env-driven secret), so an Apple
  // reviewer or curious user can't accidentally discover them.
  const handleAdminTap = () => {
    if (!__DEV__) return;
    const next = adminTapCount + 1;
    setAdminTapCount(next);
    if (next >= 7 && !adminEnabled) {
      setAdminTapCount(0);
      Alert.alert(
        '🔧 Developer Tools',
        'Enable developer mode? This unlocks Pro preview and testing tools.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setAdminTapCount(0) },
          {
            text: 'Enable Dev Tools',
            onPress: async () => {
              await setAdminEnabled(true);
              setAdminEnabledState(true);
              Alert.alert('Developer Tools Enabled', 'You can now toggle Pro Preview from the Developer section below.');
            },
          },
        ],
      );
    }
  };

  const handleToggleProPreview = async (value: boolean) => {
    await setProPreview(value);
    setProPreviewState(value);
    // Refresh usePro hook context — user may need to navigate away and back
    Alert.alert(
      value ? '✅ Pro Preview ON' : '🔓 Pro Preview OFF',
      value
        ? 'The app now behaves as if you have an active Pro subscription. Navigate to the home screen to see Pro features.'
        : 'The app now shows the free user experience.',
      [{ text: 'OK' }],
    );
  };

  const handleResetWWState = async () => {
    Alert.alert(
      '🔄 Factory Reset Demo State',
      'This signs you out, clears the stale local auth session, and wipes Walk & Water data so you can restart like a brand-new user.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const today = new Date().toISOString().slice(0, 10);
            const allKeys = await AsyncStorage.getAllKeys().catch(() => [] as string[]);
            const dynamicKeys = allKeys.filter(
              (key) =>
                key.startsWith('sb-') ||
                key.startsWith('apex.ww.water.') ||
                key.startsWith('apex.checklist.') ||
                key.startsWith('apex.walk.'),
            );
            await AsyncStorage.multiRemove([
              ...LOCAL_FACTORY_RESET_KEYS,
              ...dynamicKeys,
              `apex.ww.water.${today}`,
            ]).catch(() => null);
            await signOut().catch(() => null);
            Alert.alert('✅ Reset Complete', 'You can now relaunch and go through the WW quiz from the start.');
          },
        },
      ],
    );
  };

  const handleDisableAdminMode = async () => {
    Alert.alert(
      'Disable Developer Tools',
      'This will turn off admin mode and reset Pro Preview to OFF.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable',
          style: 'destructive',
          onPress: async () => {
            await clearAdminOverrides();
            setAdminEnabledState(false);
            setProPreviewState(false);
            Alert.alert('Developer Tools Disabled', 'The app has been reset to normal user mode.');
          },
        },
      ],
    );
  };

  const handleProfilePhoto = () => {
    Alert.alert('Profile Photo', 'Choose how you want to update your profile photo.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove Photo', style: 'destructive', onPress: () => handleRemovePhoto().catch(() => null) },
      { text: 'Upload Photo', onPress: () => handlePickPhoto().catch(() => null) },
    ]);
  };

  const handlePickPhoto = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to pick a profile image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]?.uri) {
      return;
    }

    const nextProfile: UserProfile = {
      ...(profile ?? {
        displayName,
        username: usernameStr,
        foodAvoidances: '',
        foodPreferences: [],
        goal: 'recomp',
        weightLbs: '',
        heightFt: '',
        experience: 'intermediate',
        age: '',
        goalWeightLbs: '',
        gender: 'other',
      }),
      avatarUrl: result.assets[0].uri,
    };

    try {
      await persistProfile(nextProfile);
    } catch {
      Alert.alert('Photo saved locally', 'Your profile image was updated on this device.');
    }
  };

  const handleRemovePhoto = async () => {
    await Haptics.selectionAsync();
    const nextProfile: UserProfile = {
      ...(profile ?? {
        displayName,
        username: usernameStr,
        goal: 'recomp',
        weightLbs: '',
        heightFt: '',
        experience: 'intermediate',
        age: '',
        goalWeightLbs: '',
        gender: 'other',
      }),
      avatarUrl: undefined,
    };

    try {
      await persistProfile(nextProfile);
    } catch {
      setProfile(nextProfile);
      await cacheProfileLocally(nextProfile);
    }
  };

  const displayName = profile?.displayName || session?.user?.email?.split('@')[0] || 'Athlete';
  const usernameStr = profile?.username || session?.user?.email?.split('@')[0] || 'athlete';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const xpInLevel = xp % 100;

  // Title badge — uses selected title if set, otherwise the highest earned one
  const earnedTitles = getEarnedTitles(stats);
  const earnedAchievements = useMemo(
    () => achievements.filter((achievement) => achievement.earned),
    [achievements],
  );

  // Collapsible achievements
  const [achOpen, setAchOpen] = useState(false);
  const achChevronAnim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(achChevronAnim, {
      toValue: achOpen ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [achOpen, achChevronAnim]);
  const achChevronRotate = achChevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const activeTitle: TitleDefinition = profile?.selectedTitle
    ? getTitleById(profile.selectedTitle)
    : (earnedTitles[earnedTitles.length - 1] ?? getTitleById(undefined));
  const coachVoiceOptions = useMemo(() => getCoachVoiceOptions(), []);
  const activeCoachVoice = useMemo(
    () => getCoachVoiceOptionById(selectedCoachVoiceId),
    [selectedCoachVoiceId],
  );

  const handleCoachVoicePress = async () => {
    await Haptics.selectionAsync();
    if (!isPro && !proLoading) {
      await maybeShowPaywall(session?.user?.id).catch(() => null);
      navigation.navigate('Upgrade');
      return;
    }
    setVoicePickerVisible(true);
  };

  const handleSelectCoachVoice = async (voiceId: string) => {
    await Haptics.selectionAsync();
    await setSelectedCoachVoiceId(voiceId);
    setSelectedCoachVoiceIdState(voiceId);
    setVoicePickerVisible(false);
  };

  const handleSelectTheme = async (themeId: ThemeId) => {
    await Haptics.selectionAsync();
    await setTheme(themeId);
    if (profile) {
      await persistProfile({ ...profile, themeId });
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header bar */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: accent }]}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>PROFILE</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <VerifyEmailBanner />
        {/* Identity card */}
        <View style={styles.identityCard}>
          <Pressable style={styles.avatarAction} onPress={() => handleProfilePhoto()}>
            <View style={[styles.avatarLarge, { backgroundColor: accent }]}>
              {profile?.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatarLargeImage} />
              ) : (
                <Text style={styles.avatarLargeText}>{initials}</Text>
              )}
            </View>
            <View style={[styles.avatarEditPill, { backgroundColor: accentSoft, borderColor: accentStrongBorder }]}>
              <Text style={[styles.avatarEditText, { color: accent }]}>{profile?.avatarUrl ? 'EDIT' : 'ADD'}</Text>
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            {/* Tappable display name — opens inline edit */}
            {editingName ? (
              <View style={styles.nameEditRow}>
                <TextInput
                  style={styles.nameEditInput}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => handleSaveName().catch(() => null)}
                  onBlur={() => handleSaveName().catch(() => null)}
                  maxLength={32}
                  placeholderTextColor={C.muted}
                />
              </View>
            ) : (
              <Pressable
                onPress={() => { setNameDraft(displayName); setEditingName(true); }}
                hitSlop={6}
              >
                <Text style={styles.displayName}>{displayName} <Text style={styles.editPencil}>✎</Text></Text>
              </Pressable>
            )}
            <Text style={styles.username}>@{usernameStr} · Level {level}</Text>
            <View style={styles.badgeRow}>
              {/* Streak — authentic count from workout history */}
              <View style={styles.badgePR}>
                <Text style={styles.badgePRText}>🔥 {stats.streak} Streak</Text>
              </View>
              {isPro ? (
                <View style={styles.badgePro}>
                  <Text style={styles.badgeProText}>APEX Pro</Text>
                </View>
              ) : null}
              {profile?.isCoach ? (
                <View style={styles.badgeCoach}>
                  <Text style={styles.badgeCoachText}>✓ Coach</Text>
                </View>
              ) : null}
              {/* Earnable title — tap to pick from unlocked titles */}
              <Pressable style={styles.badgeWin} onPress={() => setTitlePickerVisible(true)}>
                <Text style={[styles.badgeWinText, { color: accent }]}>{activeTitle.icon} {activeTitle.label}</Text>
              </Pressable>
            </View>
            <View style={[styles.emailStatusRow, !isEmailVerified ? styles.emailStatusRowUnverified : null]}>
              <Text style={styles.emailStatusLabel}>Account email</Text>
              <Text style={styles.emailStatusValue}>{session?.user?.email ?? 'No email on file'}</Text>
              <Text style={[styles.emailStatusPill, isEmailVerified ? styles.emailStatusPillVerified : styles.emailStatusPillPending]}>
                {getEmailVerificationStatusLabel(isEmailVerified)}
              </Text>
            </View>
          </View>
        </View>

        {/* XP bar */}
        <View style={styles.xpCard}>
          <View style={styles.xpRow}>
            <Text style={styles.xpLabel}>Level {level}</Text>
            <Text style={styles.xpLabel}>{xp} XP · +{100 - xpInLevel} to L{level + 1}</Text>
          </View>
          <View style={styles.xpTrack}>
            <View style={[styles.xpFill, { width: `${xpInLevel}%`, backgroundColor: accent }]} />
          </View>
        </View>

        {/* Stats grid */}
        <View style={styles.statGrid}>
            {[
            { val: String(stats.workoutCount), label: 'WORKOUTS', color: accent },
            { val: String(stats.streak), label: 'DAY STREAK', color: C.orange },
            { val: profile?.weightLbs ? `${profile.weightLbs}` : '–', label: 'LBS', color: C.blue },
            { val: String(level), label: 'LEVEL', color: C.text },
          ].map((item) => (
            <View key={item.label} style={styles.statCard}>
              <Text style={[styles.statVal, { color: item.color }]}>{item.val}</Text>
              <Text style={styles.statLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.zipCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.zipCardLabel}>ZIP / Postal Code</Text>
            <Text style={styles.zipCardValue}>{profile?.zipCode?.trim() ? profile.zipCode : 'Not set yet'}</Text>
            <Text style={styles.zipCardHint}>Used for grocery pricing and On the Go food recommendations.</Text>
          </View>
          <Pressable
            style={[styles.zipCardButton, { borderColor: accentStrongBorder, backgroundColor: accentSoft }]}
            onPress={() => {
              setStatsDraft(profile ? { ...profile } : null);
              setStatsEditorVisible(true);
            }}
          >
            <Text style={[styles.zipCardButtonText, { color: accent }]}>Edit ZIP</Text>
          </Pressable>
        </View>

        {/* Achievements — collapsible, earned only */}
        <Pressable
          style={[styles.achHeader, { backgroundColor: `${accent}14`, borderColor: `${accent}50`, borderLeftColor: accent }]}
          onPress={() => setAchOpen((o) => !o)}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.achHeaderTitle, { color: accent }]}>YOUR ACHIEVEMENTS</Text>
            <Text style={styles.achHeaderSub}>
              {earnedAchievements.length > 0
                ? `${earnedAchievements.length} unlocked — tap to ${achOpen ? 'collapse' : 'expand'}`
                : 'Complete milestones to unlock badges'}
            </Text>
          </View>
          <Animated.Text style={[styles.achChevron, { color: accent, transform: [{ rotate: achChevronRotate }] }]}>
            ˅
          </Animated.Text>
        </Pressable>

        {achOpen && (
          earnedAchievements.length === 0 ? (
            <View style={[styles.achEmptyCard, { borderColor: accentBorder }]}>
              <Text style={styles.achEmptyText}>No badges yet — log your first workout to earn one 🏆</Text>
            </View>
          ) : (
            <View style={styles.achGrid}>
              {earnedAchievements.map((a) => (
                <Pressable
                  key={a.id}
                  style={styles.achTile}
                  onPress={() => handleAchievementPress(a)}
                >
                  <Text style={styles.achIcon}>{a.icon}</Text>
                  <Text style={styles.achName}>{a.name}</Text>
                  <Text style={styles.achDesc}>{a.description}</Text>
                  <Text style={[styles.achProgress, { color: accent }]}>{a.progressLabel}</Text>
                  <Text style={[styles.achShare, { color: accent }]}>POST OR SHARE ↗</Text>
                </Pressable>
              ))}
            </View>
          )
        )}

        {/* Nutrition Targets */}
        <Text style={styles.sectionLabel}>Nutrition Targets</Text>
        {(() => {
          const t = getOrComputeMacroTargets(profile);
          const isComputed = !profile?.dailyCalorieTarget;
          return (
            <View style={styles.card}>
              <View style={styles.macroTargetRow}>
                <View style={styles.macroTargetCell}>
                  <Text style={styles.macroTargetNum}>{t.dailyCalorieTarget}</Text>
                  <Text style={styles.macroTargetLabel}>kcal</Text>
                </View>
                <View style={styles.macroTargetDivider} />
                <View style={styles.macroTargetCell}>
                  <Text style={[styles.macroTargetNum, { color: accent }]}>{t.dailyProtein}g</Text>
                  <Text style={styles.macroTargetLabel}>protein</Text>
                </View>
                <View style={styles.macroTargetDivider} />
                <View style={styles.macroTargetCell}>
                  <Text style={[styles.macroTargetNum, { color: C.blue }]}>{t.dailyCarbs}g</Text>
                  <Text style={styles.macroTargetLabel}>carbs</Text>
                </View>
                <View style={styles.macroTargetDivider} />
                <View style={styles.macroTargetCell}>
                  <Text style={[styles.macroTargetNum, { color: C.orange }]}>{t.dailyFat}g</Text>
                  <Text style={styles.macroTargetLabel}>fat</Text>
                </View>
              </View>
              {isComputed ? (
                <Text style={styles.macroTargetNote}>
                  ⚡ Estimated from your stats — tap below to save as your official targets
                </Text>
              ) : (
                <Text style={styles.macroTargetNote}>
                  ✅ Targets from your BMR assessment (Mifflin-St Jeor)
                </Text>
              )}
              <Text style={styles.macroTargetSubnote}>
                For your stats, most fat-loss targets should land well above crash-diet calories. If this looks off, edit your current stats and recalculate.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.statsEditBtn, pressed && { opacity: 0.78 }]}
                onPress={() => openStatsEditor().catch(() => null)}
              >
                <Text style={styles.statsEditBtnText}>Edit Current Stats</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.recalcBtn, { backgroundColor: accent }, pressed && { opacity: 0.75 }]}
                onPress={handleRecalculateTargets}
                disabled={recalculating}
              >
                {recalculating
                  ? <ActivityIndicator size="small" color={C.black} />
                  : <Text style={styles.recalcBtnText}>Recalculate from Current Stats</Text>
                }
              </Pressable>
            </View>
          );
        })()}

        <Text style={styles.sectionLabel}>Progress Photos</Text>
        <View style={styles.card}>
          <View style={styles.progressPhotoHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.voicePrefTitle}>Front · Side · Rear</Text>
              <Text style={styles.voicePrefSub}>
                Save monthly check-ins so you can compare real visual progress over time.
              </Text>
            </View>
            {progressPhotos.updatedAt ? (
              <Text style={styles.progressPhotoDate}>
                Updated {new Date(progressPhotos.updatedAt).toLocaleDateString()}
              </Text>
            ) : null}
          </View>
          <View style={styles.progressPhotoRow}>
            {([
              ['front', 'Front', '📸'],
              ['side', 'Side', '📐'],
              ['rear', 'Rear', '🏁'],
            ] as const).map(([slot, label, icon]) => (
              <View key={slot} style={styles.progressPhotoTile}>
                <Pressable
                  style={({ pressed }) => [styles.progressPhotoFrame, pressed && { opacity: 0.85 }]}
                  onPress={() => handlePickProgressPhoto(slot).catch(() => null)}
                >
                  {progressPhotos[slot] ? (
                    <Image source={{ uri: progressPhotos[slot] ?? undefined }} style={styles.progressPhotoImage} />
                  ) : (
                    <View style={styles.progressPhotoEmpty}>
                      <Text style={styles.progressPhotoEmptyIcon}>{icon}</Text>
                      <Text style={styles.progressPhotoEmptyText}>Upload {label.toLowerCase()}</Text>
                    </View>
                  )}
                </Pressable>
                <Text style={styles.progressPhotoLabel}>{label}</Text>
                {progressPhotos[slot] ? (
                  <Pressable onPress={() => handleRemoveProgressPhoto(slot).catch(() => null)}>
                    <Text style={styles.progressPhotoRemove}>Remove</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.progressPhotoHint}>Tap to add</Text>
                )}
              </View>
            ))}
          </View>

          <View style={styles.progressPhotoPreviewRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.progressPhotoPreviewTitle}>Goal Physique Preview</Text>
              <Text style={styles.progressPhotoPreviewBody}>
                {isPro
                  ? 'Generate a realistic projection card using your current check-ins, goal, and coach style.'
                  : 'Upgrade to Pro to unlock future AI physique previews from your progress photos.'}
              </Text>
            </View>
            {!isPro ? (
              <Pressable
                style={({ pressed }) => [
                  styles.progressPhotoUpgradeBtn,
                  { borderColor: accentBorder, backgroundColor: accentSoft },
                  pressed && { opacity: 0.82 },
                ]}
                onPress={async () => {
                  await maybeShowPaywall(session?.user?.id).catch(() => null);
                  navigation.navigate('Upgrade');
                }}
              >
                <Text style={[styles.progressPhotoUpgradeText, { color: accent }]}>PRO</Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.progressPhotoUpgradeBtn,
                  { borderColor: accentBorder, backgroundColor: accentSoft },
                  pressed && { opacity: 0.82 },
                ]}
                onPress={() => handleGenerateGoalPreview().catch(() => null)}
                disabled={goalPreviewLoading}
              >
                {goalPreviewLoading
                  ? <ActivityIndicator size="small" color={accent} />
                  : <Text style={[styles.progressPhotoUpgradeText, { color: accent }]}>Generate</Text>}
              </Pressable>
            )}
          </View>
          {goalPreview ? (
            <View style={styles.goalPreviewCard}>
              {goalPreview.imageUrl ? (
                <Image source={{ uri: goalPreview.imageUrl }} style={styles.goalPreviewImage} />
              ) : null}
              <Text style={styles.goalPreviewHeadline}>{goalPreview.headline}</Text>
              <Text style={styles.goalPreviewSummary}>{goalPreview.summary}</Text>
              {goalPreview.focus.map((item) => (
                <View key={item} style={styles.goalPreviewBulletRow}>
                  <Text style={styles.goalPreviewBullet}>•</Text>
                  <Text style={styles.goalPreviewBulletText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>Connected Devices</Text>
        <View style={styles.card}>
          {/* Apple HealthKit / wearable row */}
          <View style={[styles.deviceRow, styles.deviceRowBorder]}>
            <Text style={styles.deviceIcon}>❤️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.deviceName}>Apple Health</Text>
              {wearableConnected && wearableMetrics ? (
                <Text style={styles.deviceMeta}>
                  HR: {wearableMetrics.heartRateBpm ?? '–'} bpm · Steps: {wearableMetrics.stepsToday ?? '–'} · Readiness: {wearableMetrics.readinessScore ?? '–'}/100
                </Text>
              ) : null}
            </View>
            {wearableConnected ? (
              <Text style={[styles.deviceConnected, { color: accent }]}>CONNECTED</Text>
            ) : (
              <Pressable style={styles.connectBtn} onPress={handleConnectWearable} disabled={connectingWearable}>
                {connectingWearable
                  ? <ActivityIndicator size="small" color={accent} />
                  : <Text style={styles.connectBtnText}>Connect</Text>
                }
              </Pressable>
            )}
          </View>
          {/* Other devices (WHOOP, Garmin — no SDK integration yet) */}
          {DEVICES.map((device, i) => (
            <View
              key={device.name}
              style={[styles.deviceRow, i < DEVICES.length - 1 ? styles.deviceRowBorder : null]}
            >
              <Text style={styles.deviceIcon}>{device.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{device.name}</Text>
              </View>
              {device.connected ? (
                <Text style={[styles.deviceConnected, { color: accent }]}>CONNECTED</Text>
              ) : device.comingSoon ? (
                <Pressable
                  style={[
                    styles.connectBtn,
                    waitlistedFeatureSet.has(device.key) ? styles.connectBtnDisabled : null,
                  ]}
                  onPress={() => handleNotifyMe(device.key, device.name).catch(() => null)}
                  disabled={waitlistedFeatureSet.has(device.key) || waitlistLoadingKey === device.key}
                >
                  {waitlistLoadingKey === device.key ? (
                    <ActivityIndicator size="small" color={accent} />
                  ) : (
                    <Text style={styles.connectBtnText}>
                      {waitlistedFeatureSet.has(device.key) ? 'Notified' : 'Notify Me'}
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  style={styles.connectBtn}
                  onPress={() => Alert.alert('Coming soon', `${device.name} integration is in development.`)}
                >
                  <Text style={styles.connectBtnText}>Connect</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>App Color</Text>
        <View style={styles.settingsPanel}>
          <Pressable
            style={({ pressed }) => [styles.settingsPanelHeader, pressed && { opacity: 0.85 }]}
            onPress={() => setThemeSectionExpanded((current) => !current)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsPanelTitle}>Accent & visual feel</Text>
              <Text style={styles.settingsPanelSub}>
                Your current app color is {THEMES.find((theme) => theme.id === (profile?.themeId ?? activeThemeId))?.label ?? 'APEX Green'}.
              </Text>
            </View>
            <Text style={styles.settingsPanelChevron}>{themeSectionExpanded ? '−' : '+'}</Text>
          </Pressable>
          {themeSectionExpanded ? (
            <View style={styles.themePickerCard}>
              {THEMES.map((theme) => {
                const selected = (profile?.themeId ?? activeThemeId) === theme.id;
                return (
                  <Pressable
                    key={theme.id}
                    style={[styles.themeOptionCard, selected ? { borderColor: theme.accentStrongBorder, backgroundColor: theme.accentSoft } : null]}
                    onPress={() => handleSelectTheme(theme.id).catch(() => null)}
                  >
                    <View style={[styles.themeOptionSwatch, { backgroundColor: theme.accent, borderColor: theme.accentStrongBorder }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.themeOptionLabel, selected ? { color: theme.accent } : null]}>{theme.label}</Text>
                      <Text style={styles.themeOptionSub}>Tabs, highlights, and primary actions</Text>
                    </View>
                    {selected ? <Text style={[styles.themeOptionCheck, { color: theme.accent }]}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        {/* ── AI Coach Notifications ── */}
        <Text style={styles.sectionLabel}>AI Coach Notifications</Text>
        <View style={styles.settingsPanel}>
          <Pressable
            style={({ pressed }) => [styles.settingsPanelHeader, pressed && { opacity: 0.85 }]}
            onPress={() => setNotifSectionExpanded((current) => !current)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsPanelTitle}>Coach reminders & check-ins</Text>
              <Text style={styles.settingsPanelSub}>
                {notifPermission !== 'granted'
                  ? 'Turn on morning, midday, evening, and weekly coaching reminders.'
                  : 'Manage your coaching nudges without cluttering this screen.'}
              </Text>
            </View>
            <Text style={styles.settingsPanelChevron}>{notifSectionExpanded ? '−' : '+'}</Text>
          </Pressable>
          {notifSectionExpanded ? (
            notifPermission !== 'granted' ? (
              <View style={styles.notifPermCard}>
                <Text style={styles.notifPermTitle}>🔔 Enable AI Coach Reminders</Text>
                <Text style={styles.notifPermBody}>
                  Get personalised morning motivation, midday check-ins, and evening reminders based on your {profile?.goal ? { lose: 'fat loss', build: 'muscle building', recomp: 'body recomp', performance: 'performance' }[profile.goal] ?? 'fitness' : 'fitness'} goal.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.notifPermBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => handleRequestNotifPermission().catch(() => null)}
                  disabled={schedulingNotifs}
                >
                  {schedulingNotifs
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Text style={styles.notifPermBtnText}>Turn On Notifications</Text>}
                </Pressable>
              </View>
            ) : (
              <View style={styles.notifSettingsCard}>
                {[
                  { key: 'morning' as const, icon: '☀️', label: 'Morning Motivation', sub: '7:00 AM · Daily goal-based coaching' },
                  { key: 'midday' as const, icon: '🥗', label: 'Midday Check-in', sub: '12:30 PM · Nutrition & energy reminders' },
                  { key: 'evening' as const, icon: '🌙', label: 'Evening Reminder', sub: '7:00 PM · Workout & streak protection' },
                  { key: 'weeklyTip' as const, icon: '📅', label: 'Weekly Coaching Tip', sub: 'Monday 9:00 AM · Goal-specific strategies' },
                ].map(({ key, icon, label, sub }, i, arr) => (
                  <View key={key} style={[styles.notifRow, i < arr.length - 1 && styles.notifRowBorder]}>
                    <Text style={styles.notifRowIcon}>{icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifRowLabel}>{label}</Text>
                      <Text style={styles.notifRowSub}>{sub}</Text>
                    </View>
                    <Switch
                      value={notifPrefs[key]}
                      onValueChange={(v) => { handleToggleNotifPref(key, v).catch(() => null); }}
                      trackColor={{ false: '#333', true: 'rgba(0,255,135,0.4)' }}
                      thumbColor={notifPrefs[key] ? '#00ff87' : '#666'}
                    />
                  </View>
                ))}
                <Pressable
                  style={({ pressed }) => [styles.notifRescheduleBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => handleRescheduleNotifs().catch(() => null)}
                  disabled={schedulingNotifs}
                >
                  {schedulingNotifs
                    ? <ActivityIndicator size="small" color={accent} />
                    : <Text style={styles.notifRescheduleBtnText}>Refresh Schedule</Text>}
                </Pressable>
              </View>
            )
          ) : null}
        </View>

        {/* ── Privacy Settings ── */}
        <Text style={styles.sectionLabel}>Privacy</Text>
        <View style={styles.settingsPanel}>
          <Pressable
            style={({ pressed }) => [styles.settingsPanelHeader, pressed && { opacity: 0.85 }]}
            onPress={() => setPrivacySectionExpanded((current) => !current)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsPanelTitle}>Messages & friend requests</Text>
              <Text style={styles.settingsPanelSub}>
                Choose who can message you and who can send you friend requests.
              </Text>
            </View>
            <Text style={styles.settingsPanelChevron}>{privacySectionExpanded ? '−' : '+'}</Text>
          </Pressable>
          {privacySectionExpanded ? (
            <View style={styles.privacyCard}>
              {([
                {
                  key: 'privacyMessages' as const,
                  icon: '💬',
                  label: 'Who can message you',
                  sub: 'Control who can send you a direct message',
                },
                {
                  key: 'privacyFriendRequests' as const,
                  icon: '👥',
                  label: 'Who can add you as a friend',
                  sub: 'Control who can send you a friend request',
                },
              ] as const).map(({ key, icon, label, sub }, i, arr) => {
                const current = (profile?.[key] ?? 'everyone') as 'everyone' | 'friends' | 'nobody';
                const OPTIONS: Array<{ value: 'everyone' | 'friends' | 'nobody'; label: string }> = [
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'friends', label: 'Friends Only' },
                  { value: 'nobody', label: 'No One' },
                ];
                return (
                  <View key={key} style={[styles.privacyRow, i < arr.length - 1 && styles.privacyRowBorder]}>
                    <Text style={styles.privacyRowIcon}>{icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.privacyRowLabel}>{label}</Text>
                      <Text style={styles.privacyRowSub}>{sub}</Text>
                      <View style={styles.privacyOptionRow}>
                        {OPTIONS.map((opt) => {
                          const active = current === opt.value;
                          return (
                            <Pressable
                              key={opt.value}
                              style={[styles.privacyOptionBtn, active && styles.privacyOptionBtnActive]}
                              onPress={async () => {
                                await Haptics.selectionAsync().catch(() => null);
                                const next: UserProfile = { ...(profile ?? {}), [key]: opt.value } as UserProfile;
                                setProfile(next);
                                await syncProfileToSupabase(session?.user?.id, next);
                              }}
                            >
                              <Text style={[styles.privacyOptionText, active && styles.privacyOptionTextActive]}>
                                {opt.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>AI Coach Voice</Text>
        <Pressable
          style={({ pressed }) => [
            styles.voicePrefCard,
            { borderColor: accentBorder },
            pressed && { opacity: 0.85 },
          ]}
          onPress={() => handleCoachVoicePress().catch(() => null)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.voicePrefTitle}>Workout & Coach Voice</Text>
            <Text style={styles.voicePrefSub}>
              {isPro
                ? 'Choose the male or female coach voice you want to hear during AI coaching.'
                : 'Unlock Pro to choose your coach voice and switch it anytime.'}
            </Text>
          </View>
          <View style={[styles.voicePrefValueWrap, { borderColor: accentBorder, backgroundColor: accentSoft }]}>
            <Text style={[styles.voicePrefValue, { color: accent }]}>{isPro ? activeCoachVoice.label : 'PRO'}</Text>
          </View>
        </Pressable>



        {/* ── Developer Tools tap-target ──                                 */}
        {/* Production builds: tap-counter chip is hidden + handleAdminTap   */}
        {/* short-circuits in non-__DEV__ runtime. Coach unlock still works  */}
        {/* via the password flow above. See handleAdminTap for rationale.   */}
        <Pressable onPress={handleAdminTap} hitSlop={16}>
          <Text style={styles.versionText}>
            APEX Fitness · v1.0.0{adminEnabled ? ' 🔧' : ''}
          </Text>
          {__DEV__ && adminTapCount > 0 && adminTapCount < 7 ? (
            <Text style={styles.versionTapHint}>
              🔧 Tap {7 - adminTapCount} more time{7 - adminTapCount !== 1 ? 's' : ''} to unlock Dev Tools
            </Text>
          ) : null}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.coachAccessBtn, pressed && { opacity: 0.65 }]}
          onPress={() => navigation.navigate('CoachAccess')}
        >
          <Text style={styles.coachAccessBtnText}>Coach Access</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.75 }]}
          onPress={handleSignOut}
        >
          <Text style={[styles.signOutText, { color: accent }]}>Sign Out</Text>
        </Pressable>

        {/* Legal links — required for App Store */}
        <View style={styles.legalRow}>
          <Pressable
            onPress={() => Linking.openURL('https://apexfitness.app/privacy').catch(() => null)}
            style={({ pressed }) => [styles.legalBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.legalBtnText}>Privacy Policy</Text>
          </Pressable>
          <Text style={styles.legalDot}>·</Text>
          <Pressable
            onPress={() => Linking.openURL('https://apexfitness.app/terms').catch(() => null)}
            style={({ pressed }) => [styles.legalBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.legalBtnText}>Terms of Service</Text>
          </Pressable>
          <Text style={styles.legalDot}>·</Text>
          <Pressable
            onPress={() => Linking.openURL('https://apexfitness.app/support').catch(() => null)}
            style={({ pressed }) => [styles.legalBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.legalBtnText}>Support</Text>
          </Pressable>
        </View>

        {/* Danger zone */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Danger Zone</Text>
        <Pressable
          style={({ pressed }) => [styles.deleteAccountBtn, pressed && { opacity: 0.75 }]}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
        >
          {deletingAccount
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.deleteAccountText}>Delete Account</Text>
          }
        </Pressable>
      </ScrollView>

      {/* Hidden story card: off-screen, exact 9:16 size so ViewShot
          captures pixel-perfect story dimensions */}
      <View style={styles.hiddenCaptureWrap} pointerEvents="none">
        <ViewShot
          ref={shareCardRef}
          options={{ format: 'png', quality: 1, width: STORY_CARD_W, height: STORY_CARD_H }}
        >
          {shareAchievement ? (
            <AchievementShareCard
              achievement={shareAchievement}
              displayName={displayName}
              level={level}
              title={activeTitle?.label}
            />
          ) : (
            <View style={{ width: STORY_CARD_W, height: STORY_CARD_H }} />
          )}
        </ViewShot>
      </View>

      <Modal
        visible={statsEditorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStatsEditorVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={24}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setStatsEditorVisible(false)} />
        <View style={styles.modalCard}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>EDIT CURRENT STATS</Text>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.modalLabel}>Display Name</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.displayName ?? ''}
              onChangeText={(value) => setStatsDraft((current) => current ? { ...current, displayName: value } : current)}
              placeholder="Your name"
              placeholderTextColor={C.muted}
              maxLength={32}
            />

            <Text style={styles.modalLabel}>Current Weight (lbs)</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.weightLbs ?? ''}
              onChangeText={(value) => setStatsDraft((current) => current ? { ...current, weightLbs: value } : current)}
              keyboardType="numeric"
              placeholder="185"
              placeholderTextColor={C.muted}
            />

            <Text style={styles.modalLabel}>Age</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.age ?? ''}
              onChangeText={(value) => setStatsDraft((current) => current ? { ...current, age: value } : current)}
              keyboardType="numeric"
              placeholder="30"
              placeholderTextColor={C.muted}
            />

            <Text style={styles.modalLabel}>Height</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.heightFt ?? ''}
              onChangeText={(value) => setStatsDraft((current) => current ? { ...current, heightFt: value } : current)}
              placeholder={`5'10"`}
              placeholderTextColor={C.muted}
            />

            <Text style={styles.modalLabel}>Goal Weight (lbs)</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.goalWeightLbs ?? ''}
              onChangeText={(value) => setStatsDraft((current) => current ? { ...current, goalWeightLbs: value } : current)}
              keyboardType="numeric"
              placeholder="175"
              placeholderTextColor={C.muted}
            />

            <Text style={styles.modalLabel}>ZIP / Postal Code</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.zipCode ?? ''}
              onChangeText={(value) => setStatsDraft((current) => current ? { ...current, zipCode: value } : current)}
              keyboardType="numbers-and-punctuation"
              placeholder="e.g. 90210"
              placeholderTextColor={C.muted}
              maxLength={10}
              returnKeyType="done"
            />

            <Text style={styles.modalLabel}>Goal</Text>
            <View style={styles.optionRow}>
              {([
                ['lose', 'Lose Fat'],
                ['build', 'Build Muscle'],
                ['recomp', 'Recomp'],
                ['performance', 'Performance'],
              ] as const).map(([goalKey, label]) => (
                <Pressable
                  key={goalKey}
                  style={[
                    styles.optionChip,
                    statsDraft?.goal === goalKey ? styles.optionChipActive : null,
                  ]}
                  onPress={() => setStatsDraft((current) => current ? { ...current, goal: goalKey } : current)}
                >
                  <Text style={[styles.optionChipText, statsDraft?.goal === goalKey ? styles.optionChipTextActive : null]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.modalLabel}>Reason Why</Text>
            <Text style={styles.modalLabelSub}>What matters most right now?</Text>
            <View style={styles.optionRow}>
              {REASON_WHY_OPTIONS.map((item) => {
                const selected = statsDraft?.reasonWhy?.includes(item);
                return (
                  <Pressable
                    key={item}
                    style={[styles.optionChip, selected ? styles.optionChipActive : null]}
                    onPress={() =>
                      setStatsDraft((current) =>
                        current
                          ? {
                              ...current,
                              reasonWhy: current.reasonWhy?.includes(item)
                                ? current.reasonWhy.filter((value) => value !== item)
                                : [...(current.reasonWhy ?? []), item],
                            }
                          : current,
                      )
                    }
                  >
                    <Text style={[styles.optionChipText, selected ? styles.optionChipTextActive : null]}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modalLabel}>Reason In Your Own Words</Text>
            <TextInput
              style={[styles.modalInput, { minHeight: 90, textAlignVertical: 'top' }]}
              value={statsDraft?.reasonWhyDetail ?? ''}
              onChangeText={(value) => setStatsDraft((current) => current ? { ...current, reasonWhyDetail: value } : current)}
              placeholder="I want to look better for my wedding, feel more confident, and keep my energy up."
              placeholderTextColor={C.muted}
              multiline
            />

            <Text style={styles.modalLabel}>Wake Time</Text>
            <View style={styles.optionRow}>
              {WAKE_TIME_OPTIONS.map((time) => (
                <Pressable
                  key={time}
                  style={[styles.optionChip, statsDraft?.wakeTime === time ? styles.optionChipActive : null]}
                  onPress={() => setStatsDraft((current) => current ? { ...current, wakeTime: time } : current)}
                >
                  <Text style={[styles.optionChipText, statsDraft?.wakeTime === time ? styles.optionChipTextActive : null]}>{time}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.modalLabel}>Sleep Time</Text>
            <View style={styles.optionRow}>
              {SLEEP_TIME_OPTIONS.map((time) => (
                <Pressable
                  key={time}
                  style={[styles.optionChip, statsDraft?.sleepTime === time ? styles.optionChipActive : null]}
                  onPress={() => setStatsDraft((current) => current ? { ...current, sleepTime: time } : current)}
                >
                  <Text style={[styles.optionChipText, statsDraft?.sleepTime === time ? styles.optionChipTextActive : null]}>{time}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.modalLabel}>Workout Window</Text>
            {WORKOUT_WINDOW_OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                style={[styles.activityRow, statsDraft?.workoutWindow === option.key && { borderColor: accent, backgroundColor: accentSoft }]}
                onPress={() => setStatsDraft((current) => current ? { ...current, workoutWindow: option.key } : current)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionChipText, statsDraft?.workoutWindow === option.key && { color: accent }]}>{option.label}</Text>
                  <Text style={styles.modalLabelSub}>{option.sub}</Text>
                </View>
                {statsDraft?.workoutWindow === option.key ? <Text style={{ color: accent }}>✓</Text> : null}
              </Pressable>
            ))}

            <Text style={styles.modalLabel}>Workout Time</Text>
            <View style={styles.optionRow}>
              {WORKOUT_TIME_OPTIONS.map((time) => (
                <Pressable
                  key={time}
                  style={[styles.optionChip, workoutTimeSelection === time ? styles.optionChipActive : null]}
                  onPress={() => setStatsDraft((current) => current ? { ...current, workoutTime: time } : current)}
                >
                  <Text style={[styles.optionChipText, workoutTimeSelection === time ? styles.optionChipTextActive : null]}>{time}</Text>
                </Pressable>
              ))}
              <Pressable
                style={[styles.optionChip, workoutTimeSelection === CUSTOM_WORKOUT_TIME_OPTION ? styles.optionChipActive : null]}
                onPress={() =>
                  setStatsDraft((current) =>
                    current
                      ? {
                          ...current,
                          workoutTime: workoutTimeMatchesPreset ? '' : current.workoutTime,
                        }
                      : current,
                  )
                }
              >
                <Text style={[styles.optionChipText, workoutTimeSelection === CUSTOM_WORKOUT_TIME_OPTION ? styles.optionChipTextActive : null]}>
                  {CUSTOM_WORKOUT_TIME_OPTION}
                </Text>
              </Pressable>
            </View>
            {workoutTimeSelection === CUSTOM_WORKOUT_TIME_OPTION ? (
              <TextInput
                style={styles.modalInput}
                placeholder="Type your workout time (for example 4:45 AM)"
                placeholderTextColor={C.muted}
                value={statsDraft?.workoutTime ?? ''}
                onChangeText={(value) => setStatsDraft((current) => current ? { ...current, workoutTime: value } : current)}
              />
            ) : null}

            <Text style={styles.modalLabel}>Meals Per Day</Text>
            <View style={styles.optionRow}>
              {MEALS_PER_DAY_OPTIONS.map((count) => (
                <Pressable
                  key={count}
                  style={[styles.optionChip, statsDraft?.mealsPerDay === count ? styles.optionChipActive : null]}
                  onPress={() => setStatsDraft((current) => current ? { ...current, mealsPerDay: count } : current)}
                >
                  <Text style={[styles.optionChipText, statsDraft?.mealsPerDay === count ? styles.optionChipTextActive : null]}>{count} meals</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.modalLabel}>Food Preferences</Text>
            <View style={styles.optionRow}>
              {FOOD_PREFERENCES.map((item) => {
                const selected = statsDraft?.foodPreferences?.includes(item);
                return (
                  <Pressable
                    key={item}
                    style={[styles.optionChip, selected ? styles.optionChipActive : null]}
                    onPress={() =>
                      setStatsDraft((current) =>
                        current
                          ? {
                              ...current,
                              foodPreferences: current.foodPreferences?.includes(item)
                                ? current.foodPreferences.filter((value) => value !== item)
                                : [...(current.foodPreferences ?? []), item],
                            }
                          : current,
                      )
                    }
                  >
                    <Text style={[styles.optionChipText, selected ? styles.optionChipTextActive : null]}>
                      {item}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modalLabel}>Foods To Avoid</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.foodAvoidances ?? ''}
              onChangeText={(value) => setStatsDraft((current) => current ? { ...current, foodAvoidances: value } : current)}
              placeholder="Shellfish, mushrooms, spicy food..."
              placeholderTextColor={C.muted}
            />

            <Text style={styles.modalLabel}>Gender</Text>
            <View style={styles.optionRow}>
              {([
                ['male', 'Male'],
                ['female', 'Female'],
                ['other', 'Other'],
              ] as const).map(([genderKey, label]) => (
                <Pressable
                  key={genderKey}
                  style={[
                    styles.optionChip,
                    statsDraft?.gender === genderKey ? styles.optionChipActive : null,
                  ]}
                  onPress={() => setStatsDraft((current) => current ? { ...current, gender: genderKey } : current)}
                >
                  <Text style={[styles.optionChipText, statsDraft?.gender === genderKey ? styles.optionChipTextActive : null]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* ── Experience ── */}
            <Text style={styles.modalLabel}>Experience Level</Text>
            <View style={styles.optionRow}>
              {([
                ['beginner', 'Beginner'],
                ['intermediate', 'Intermediate'],
                ['advanced', 'Advanced'],
              ] as const).map(([expKey, label]) => (
                <Pressable
                  key={expKey}
                  style={[styles.optionChip, statsDraft?.experience === expKey ? styles.optionChipActive : null]}
                  onPress={() => setStatsDraft((c) => c ? { ...c, experience: expKey } : c)}
                >
                  <Text style={[styles.optionChipText, statsDraft?.experience === expKey ? styles.optionChipTextActive : null]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {/* ── GLP-1 / Peptides ── */}
            <Text style={styles.modalLabel}>GLP-1 / Peptides</Text>
            <Text style={styles.modalLabelSub}>e.g. Ozempic, Wegovy, Mounjaro, BPC-157</Text>
            <View style={styles.optionRow}>
              {([
                ['none', '❌ None'],
                ['glp1', '💉 GLP-1'],
                ['peptides', '🧬 Peptides'],
                ['both', '⚗️ Both'],
              ] as const).map(([key, label]) => (
                <Pressable
                  key={key}
                  style={[styles.optionChip, statsDraft?.glp1Status === key ? styles.optionChipActive : null]}
                  onPress={() => setStatsDraft((c) => c ? { ...c, glp1Status: key } : c)}
                >
                  <Text style={[styles.optionChipText, statsDraft?.glp1Status === key ? styles.optionChipTextActive : null]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {/* ── Equipment ── */}
            <Text style={styles.modalLabel}>Available Equipment</Text>
            <View style={styles.optionRow}>
              {['Full Gym', 'Dumbbells', 'Barbell & Plates', 'Resistance Bands', 'Pull-Up Bar', 'Kettlebells', 'Cables / Machines', 'Cardio Machines', 'Bodyweight Only', 'Home Gym', 'Smith Machine', 'TRX / Suspension'].map((item) => {
                const sel = statsDraft?.equipment?.includes(item) ?? false;
                return (
                  <Pressable
                    key={item}
                    style={[styles.optionChip, sel ? styles.optionChipActive : null]}
                    onPress={() =>
                      setStatsDraft((c) =>
                        c ? { ...c, equipment: sel ? c.equipment?.filter((e) => e !== item) : [...(c.equipment ?? []), item] } : c
                      )
                    }
                  >
                    <Text style={[styles.optionChipText, sel ? styles.optionChipTextActive : null]}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* ── Activity Level ── */}
            <Text style={styles.modalLabel}>Daily Activity Level</Text>
            <Text style={styles.modalLabelSub}>Outside of your workouts</Text>
            {([
              ['sedentary', '🪑 Sedentary', 'Desk job, little movement'],
              ['light', '🚶 Lightly Active', 'Light walking, standing'],
              ['moderate', '🏃 Moderately Active', 'Active job or daily walks'],
              ['active', '⚡ Active', 'Physical job or sports'],
              ['very_active', '🔥 Very Active', 'Athlete / manual labour'],
            ] as const).map(([key, label, sub]) => (
              <Pressable
                key={key}
                style={[styles.activityRow, statsDraft?.activityLevel === key && { borderColor: accent, backgroundColor: accentSoft }]}
                onPress={() => setStatsDraft((c) => c ? { ...c, activityLevel: key } : c)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionChipText, statsDraft?.activityLevel === key && { color: accent }]}>{label}</Text>
                  <Text style={styles.modalLabelSub}>{sub}</Text>
                </View>
                {statsDraft?.activityLevel === key ? <Text style={{ color: accent }}>✓</Text> : null}
              </Pressable>
            ))}

            {/* ── Health Conditions ── */}
            <Text style={styles.modalLabel}>Health Conditions</Text>
            <Text style={styles.modalLabelSub}>Used to personalise AI coaching and meal plans</Text>
            {HEALTH_CONDITIONS.map((cat) => (
              <View key={cat.label}>
                <Text style={styles.healthCatLabel}>{cat.icon} {cat.label}</Text>
                <View style={styles.optionRow}>
                  {cat.items.map((item) => {
                    const sel = statsDraft?.healthConditions?.includes(item) ?? false;
                    return (
                      <Pressable
                        key={item}
                        style={[styles.optionChip, sel ? styles.optionChipActive : null]}
                        onPress={() =>
                          setStatsDraft((c) =>
                            c ? { ...c, healthConditions: sel ? c.healthConditions?.filter((h) => h !== item) : [...(c.healthConditions ?? []), item] } : c
                          )
                        }
                      >
                        <Text style={[styles.optionChipText, sel ? styles.optionChipTextActive : null]}>{item}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            {/* ── Medications ── */}
            <Text style={styles.modalLabel}>Current Medications</Text>
            <Text style={styles.modalLabelSub}>Helps the AI coach avoid conflicting advice</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.medications ?? ''}
              onChangeText={(v) => setStatsDraft((c) => c ? { ...c, medications: v } : c)}
              placeholder="e.g. Metformin, Lisinopril..."
              placeholderTextColor={C.muted}
              multiline
            />

            {/* ── Surgeries ── */}
            <Text style={styles.modalLabel}>Past Surgeries / Injuries</Text>
            <TextInput
              style={styles.modalInput}
              value={statsDraft?.surgeries ?? ''}
              onChangeText={(v) => setStatsDraft((c) => c ? { ...c, surgeries: v } : c)}
              placeholder="e.g. ACL repair 2021, appendectomy..."
              placeholderTextColor={C.muted}
              multiline
            />

          </ScrollView>

          <View style={styles.modalActionRow}>
            <Pressable style={styles.modalGhostBtn} onPress={() => setStatsEditorVisible(false)}>
              <Text style={styles.modalGhostBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.modalPrimaryBtn, recalculating ? { opacity: 0.7 } : null]}
              onPress={() => handleSaveStatsAndRecalculate().catch(() => null)}
              disabled={recalculating}
            >
              {recalculating
                ? <ActivityIndicator size="small" color={C.black} />
                : <Text style={styles.modalPrimaryBtnText}>Save & Recalculate</Text>
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      </Modal>

      {/* ── Regenerate Plan Prompt ── */}
      <Modal
        visible={regenPromptVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRegenPromptVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setRegenPromptVisible(false)}>
          <Pressable style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom, 20) }]} onPress={() => {}}>
            <View style={styles.modalHandle} />

            {/* Icon + heading */}
            <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 10 }}>⚡</Text>
            <Text style={[styles.modalTitle, { textAlign: 'center', marginBottom: 6 }]}>STATS UPDATED</Text>
            <Text style={{ fontSize: 14, color: C.muted, fontFamily: 'DMSans_400Regular', textAlign: 'center', marginBottom: 20, lineHeight: 21 }}>
              Your stats have changed. Would you like to regenerate your entire plan so it reflects your new numbers?
            </Text>

            {/* New macro targets */}
            {regenTargets && (
              <View style={styles.regenMacroRow}>
                <View style={styles.regenMacroChip}>
                  <Text style={styles.regenMacroValue}>{regenTargets.dailyCalorieTarget}</Text>
                  <Text style={styles.regenMacroLabel}>KCAL</Text>
                </View>
                <View style={[styles.regenMacroChip, { borderColor: accent }]}>
                  <Text style={[styles.regenMacroValue, { color: accent }]}>{regenTargets.dailyProtein}g</Text>
                  <Text style={styles.regenMacroLabel}>PROTEIN</Text>
                </View>
                <View style={styles.regenMacroChip}>
                  <Text style={styles.regenMacroValue}>{regenTargets.dailyCarbs}g</Text>
                  <Text style={styles.regenMacroLabel}>CARBS</Text>
                </View>
                <View style={styles.regenMacroChip}>
                  <Text style={styles.regenMacroValue}>{regenTargets.dailyFat}g</Text>
                  <Text style={styles.regenMacroLabel}>FAT</Text>
                </View>
              </View>
            )}

            {/* Actions */}
            <Pressable
              style={[styles.modalPrimaryBtn, { marginBottom: 10 }]}
              onPress={() => handleRegenPlan().catch(() => null)}
            >
              <Text style={styles.modalPrimaryBtnText}>🔄 Regenerate My Plan</Text>
            </Pressable>
            <Pressable
              style={styles.modalGhostBtn}
              onPress={() => setRegenPromptVisible(false)}
            >
              <Text style={styles.modalGhostBtnText}>Keep Current Plan</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Title Picker Modal ── */}
      <Modal
        visible={titlePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTitlePickerVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setTitlePickerVisible(false)}>
          <Pressable style={styles.titlePickerCard} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>CHOOSE YOUR TITLE</Text>
            <Text style={styles.titlePickerSub}>Shown next to your streak on the leaderboard and profile</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {TITLE_DEFINITIONS.map((t) => {
                const earned = earnedTitles.some((e) => e.id === t.id);
                const isActive = activeTitle.id === t.id;
                return (
                  <Pressable
                    key={t.id}
                    style={[
                      styles.titleRow,
                      isActive ? styles.titleRowActive : null,
                      !earned ? styles.titleRowLocked : null,
                    ]}
                    onPress={() => {
                      if (earned) handleSelectTitle(t.id).catch(() => null);
                    }}
                  >
                    <Text style={styles.titleRowIcon}>{t.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.titleRowLabel, !earned ? styles.titleRowLabelLocked : null]}>
                        {t.label}
                      </Text>
                      <Text style={styles.titleRowDesc}>{t.description}</Text>
                    </View>
                    {isActive ? (
                      <Text style={styles.titleRowCheck}>✓</Text>
                    ) : !earned ? (
                      <Text style={styles.titleRowLock}>🔒</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={voicePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setVoicePickerVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setVoicePickerVisible(false)}>
          <Pressable style={styles.titlePickerCard} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>CHOOSE COACH VOICE</Text>
            <Text style={styles.titlePickerSub}>Used across AI Coach, workout coaching, and spoken guidance</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {coachVoiceOptions.map((voiceOption) => {
                const isActive = activeCoachVoice.id === voiceOption.id;
                return (
                  <Pressable
                    key={voiceOption.id}
                    style={[
                      styles.titleRow,
                      isActive ? [styles.titleRowActive, { borderColor: accent, backgroundColor: accentSoft }] : null,
                    ]}
                    onPress={() => handleSelectCoachVoice(voiceOption.id).catch(() => null)}
                  >
                    <Image
                      source={COACH_PROFILE_IMAGES[voiceOption.label] as any}
                      style={styles.titleRowAvatar}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.titleRowLabel}>{voiceOption.label}</Text>
                      <Text style={styles.titleRowDesc}>{voiceOption.subtitle}</Text>
                    </View>
                    {isActive ? <Text style={[styles.titleRowCheck, { color: accent }]}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Delete Account Feedback Modal ── */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <Pressable
            style={styles.deleteOverlay}
            onPress={() => setDeleteModalVisible(false)}
          >
            <Pressable style={styles.deleteSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.deleteHandle} />

              <Text style={styles.deleteTitle}>Sorry to see you go 😔</Text>
              <Text style={styles.deleteSub}>
                Before you go — what made you want to leave? Your feedback helps us improve for everyone.
              </Text>

              {/* Reason chips */}
              {[
                "It's too complicated",
                "I'm not using it enough",
                "Missing a feature I need",
                "Too expensive",
                "Found a better app",
                "Just taking a break",
              ].map((reason) => (
                <Pressable
                  key={reason}
                  style={[styles.deleteReasonChip, deleteReason === reason && styles.deleteReasonChipSelected]}
                  onPress={() => setDeleteReason(reason === deleteReason ? null : reason)}
                >
                  <Text style={[styles.deleteReasonText, deleteReason === reason && styles.deleteReasonTextSelected]}>
                    {reason}
                  </Text>
                </Pressable>
              ))}

              {/* Optional freeform */}
              <TextInput
                style={styles.deleteFeedbackInput}
                value={deleteFeedback}
                onChangeText={setDeleteFeedback}
                placeholder="Anything else you'd like us to know? (optional)"
                placeholderTextColor={C.muted}
                multiline
                maxLength={500}
              />

              {/* Actions */}
              <Pressable
                style={[styles.deleteStayBtn, { backgroundColor: accent }]}
                onPress={() => setDeleteModalVisible(false)}
              >
                <Text style={styles.deleteStayText}>Actually, I'll Stay 💪</Text>
              </Pressable>

              <Pressable
                style={[styles.deleteConfirmBtn, deletingAccount && { opacity: 0.5 }]}
                onPress={() => {
                  Alert.alert(
                    '⚠️ Permanently Delete Account',
                    'All your workout data, meals, and messages will be erased. This cannot be undone.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete Everything', style: 'destructive', onPress: confirmDeleteAccount },
                    ],
                  );
                }}
                disabled={deletingAccount}
              >
                <Text style={styles.deleteConfirmText}>
                  {deletingAccount ? 'Deleting…' : 'Delete My Account'}
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  // Delete account feedback modal
  deleteOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  deleteSheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(255,59,48,0.3)', padding: 20, paddingBottom: 36, gap: 10 },
  deleteHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 8 },
  deleteTitle: { fontSize: 20, color: C.text, fontFamily: 'DMSans_700Bold', textAlign: 'center' },
  deleteSub: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  deleteReasonChip: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  deleteReasonChipSelected: { borderColor: C.orange, backgroundColor: 'rgba(255,107,53,0.12)' },
  deleteReasonText: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular' },
  deleteReasonTextSelected: { color: C.orange, fontFamily: 'DMSans_500Medium' },
  deleteFeedbackInput: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 13, minHeight: 72, textAlignVertical: 'top', backgroundColor: C.dark },
  deleteStayBtn: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  deleteStayText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  deleteConfirmBtn: { paddingVertical: 12, alignItems: 'center' },
  deleteConfirmText: { color: 'rgba(255,59,48,0.8)', fontFamily: 'DMSans_400Regular', fontSize: 13 },
  screen: { flex: 1, backgroundColor: C.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: 'rgba(8,8,8,0.95)',
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 60 },
  backText: { color: C.green, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  headerTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    letterSpacing: 3,
    color: C.text,
  },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 40 },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    marginBottom: 10,
  },
  avatarAction: {
    alignItems: 'center',
    gap: 6,
  },
  avatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  avatarLargeImage: {
    width: '100%',
    height: '100%',
  },
  avatarLargeText: {
    color: '#000',
    fontFamily: 'DMSans_500Medium',
    fontSize: 24,
    fontWeight: '700',
  },
  avatarEditPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
  },
  avatarEditText: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
  },
  displayName: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 2,
    color: C.text,
  },
  username: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  badgePR: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(255,107,53,0.2)',
    borderWidth: 1,
    borderColor: C.orange,
  },
  badgePRText: { fontSize: 9, color: C.orange, fontFamily: 'SpaceMono_400Regular', fontWeight: '700' },
  badgePro: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.green,
  },
  badgeProText: { fontSize: 9, color: C.green, fontFamily: 'SpaceMono_400Regular', fontWeight: '700' },
  badgeCoach: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(255,107,53,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.45)',
  },
  badgeCoachText: { fontSize: 9, color: C.orange, fontFamily: 'SpaceMono_400Regular', fontWeight: '700' },
  badgeWin: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.green,
  },
  badgeWinText: { fontSize: 9, color: C.green, fontFamily: 'SpaceMono_400Regular', fontWeight: '700' },
  emailStatusRow: {
    alignItems: 'flex-start',
    borderColor: C.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  emailStatusRowUnverified: {
    borderColor: 'rgba(255,107,53,0.45)',
    backgroundColor: 'rgba(255,107,53,0.08)',
  },
  emailStatusLabel: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1,
  },
  emailStatusValue: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
  emailStatusPill: {
    borderRadius: 999,
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    marginTop: 4,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  emailStatusPillPending: {
    backgroundColor: 'rgba(255,107,53,0.16)',
    color: C.orange,
  },
  emailStatusPillVerified: {
    backgroundColor: 'rgba(74,222,128,0.16)',
    color: C.green,
  },
  xpCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  xpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  xpLabel: { fontSize: 10, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  xpTrack: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: 3, backgroundColor: C.green },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    width: '47%',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  statVal: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 36,
    lineHeight: 38,
    color: C.text,
  },
  statLabel: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  zipCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  zipCardLabel: {
    fontSize: 10,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  zipCardValue: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 18,
  },
  zipCardHint: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  zipCardButton: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  zipCardButtonText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
  },
  sectionLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 10,
    marginTop: 6,
  },
  achHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  achHeaderTitle: {
    fontSize: 12,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  achHeaderSub: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginTop: 2,
  },
  achChevron: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    paddingLeft: 8,
  },
  achEmptyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 14,
  },
  achEmptyText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    textAlign: 'center',
  },
  achGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16, marginTop: 8 },
  achTile: {
    width: '47%',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  achLocked: { opacity: 0.35 },
  achIcon: { fontSize: 26, marginBottom: 5 },
  achName: { fontSize: 12, color: C.text, fontFamily: 'DMSans_500Medium', fontWeight: '600' },
  achDesc: { fontSize: 10, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  achProgress: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', marginTop: 4 },
  achProgressEarned: { color: C.green },
  achShare: { fontSize: 9, color: C.green, fontFamily: 'SpaceMono_400Regular', marginTop: 4 },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  deviceRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  deviceIcon: { fontSize: 20 },
  deviceName: { flex: 1, fontSize: 14, color: C.text, fontFamily: 'DMSans_400Regular' },
  deviceConnected: {
    fontSize: 10,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
  },
  connectBtnDisabled: {
    opacity: 0.72,
  },
  deviceComingSoon: {
    fontSize: 10,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    opacity: 0.6,
  },
  connectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  connectBtnText: { fontSize: 12, color: C.text, fontFamily: 'DMSans_400Regular' },
  notifItem: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    padding: 13,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 13,
    marginBottom: 8,
  },
  notifUnread: { borderLeftWidth: 3, borderLeftColor: C.green },
  notifIcon: { fontSize: 20, marginTop: 1 },
  notifText: { fontSize: 13, lineHeight: 19, color: '#ccc', fontFamily: 'DMSans_400Regular' },
  notifTime: { fontSize: 10, color: C.muted, fontFamily: 'SpaceMono_400Regular', marginTop: 4 },
  voteBtn: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: C.card,
  },
  voteBtnText: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  coachAccessBtn: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  coachAccessBtnText: { color: C.muted, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  signOutBtn: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  signOutText: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  hiddenCaptureWrap: {
    position: 'absolute',
    left: -9999,
    top: -9999,
    opacity: 0,
  },
  deviceMeta: { fontSize: 10, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  progressPhotoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  progressPhotoDate: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    marginTop: 2,
  },
  progressPhotoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  progressPhotoTile: {
    flex: 1,
    alignItems: 'center',
  },
  progressPhotoFrame: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
    marginBottom: 8,
  },
  progressPhotoImage: {
    width: '100%',
    height: '100%',
  },
  progressPhotoEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 8,
  },
  progressPhotoEmptyIcon: {
    fontSize: 20,
  },
  progressPhotoEmptyText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 15,
  },
  progressPhotoLabel: {
    color: C.text,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 12,
  },
  progressPhotoHint: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    marginTop: 4,
  },
  progressPhotoRemove: {
    color: C.orange,
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    marginTop: 4,
  },
  progressPhotoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 14,
  },
  progressPhotoPreviewTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
    marginBottom: 2,
  },
  progressPhotoPreviewBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  progressPhotoUpgradeBtn: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  progressPhotoUpgradeText: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  goalPreviewCard: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    backgroundColor: 'rgba(0,255,135,0.08)',
    padding: 14,
    gap: 8,
  },
  goalPreviewImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 6,
  },
  goalPreviewHeadline: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 16,
  },
  goalPreviewSummary: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  goalPreviewBulletRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  goalPreviewBullet: {
    color: C.green,
    fontSize: 14,
    lineHeight: 18,
  },
  goalPreviewBulletText: {
    flex: 1,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
  },
  coachAiBtn: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  coachAiBtnText: {
    color: C.green,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 13,
  },
  deleteAccountBtn: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.5)',
    backgroundColor: 'rgba(239,68,68,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  deleteAccountText: { color: '#ef4444', fontFamily: 'DMSans_500Medium', fontSize: 15 },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  legalBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  legalBtnText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  legalDot: { color: C.muted, fontSize: 12, fontFamily: 'DMSans_400Regular' },

  // Nutrition targets card
  macroTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  macroTargetCell: { flex: 1, alignItems: 'center' },
  macroTargetNum: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: C.text,
  },
  macroTargetLabel: {
    fontSize: 10,
    fontFamily: 'DMSans_400Regular',
    color: C.muted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  macroTargetDivider: {
    width: 1,
    height: 32,
    backgroundColor: C.border,
  },
  macroTargetNote: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: C.muted,
    textAlign: 'center',
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  macroTargetSubnote: {
    fontSize: 11,
    fontFamily: 'DMSans_400Regular',
    color: C.muted,
    textAlign: 'center',
    lineHeight: 16,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  recalcBtn: {
    backgroundColor: C.green,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 4,
  },
  recalcBtnText: {
    color: C.black,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
  },
  statsEditBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: C.dark,
  },
  statsEditBtnText: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '88%',
  },
  modalScroll: {
    maxHeight: 460,
  },
  modalScrollContent: {
    paddingBottom: 8,
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
  modalLabel: {
    fontSize: 10,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 5,
    marginTop: 4,
  },
  modalLabelSub: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginTop: -4,
    marginBottom: 6,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    backgroundColor: C.dark,
  },
  healthCatLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'DMSans_500Medium',
    marginTop: 8,
    marginBottom: 4,
  },
  modalInput: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    marginBottom: 10,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
  },
  optionChipActive: {
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  optionChipText: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  optionChipTextActive: {
    color: C.green,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  modalGhostBtn: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostBtnText: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  modalPrimaryBtn: {
    flex: 2,
    minHeight: 48,
    backgroundColor: C.green,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryBtnText: {
    color: C.black,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
  },

  // ── Inline name editing ──────────────────────────────────────────
  nameEditRow: { marginBottom: 2 },
  nameEditInput: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 2,
    borderBottomWidth: 1,
    borderBottomColor: C.green,
    paddingVertical: 2,
    paddingHorizontal: 0,
    minWidth: 120,
  },
  editPencil: {
    fontSize: 13,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },

  // ── Notification dot ─────────────────────────────────────────────
  notifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.green,
    marginTop: 6,
    flexShrink: 0,
  },

  // ── Title picker modal ───────────────────────────────────────────
  titlePickerCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  titlePickerSub: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
  },
  titleRowActive: {
    borderColor: C.green,
    backgroundColor: C.greenSoft,
  },
  titleRowLocked: { opacity: 0.4 },
  titleRowIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  titleRowAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'transparent',
  },
  titleRowLabel: {
    fontSize: 15,
    color: C.text,
    fontFamily: 'DMSans_600SemiBold',
  },
  titleRowLabelLocked: { color: C.muted },
  titleRowDesc: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginTop: 1,
  },
  titleRowCheck: { fontSize: 16, color: C.green, fontFamily: 'DMSans_600SemiBold' },
  titleRowLock: { fontSize: 14 },

  // ── AI Coach Notification styles ──────────────────────────────────────────
  notifPermCard: {
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  notifPermTitle: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
  },
  notifPermBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12.5,
    lineHeight: 19,
  },
  notifPermBtn: {
    backgroundColor: C.green,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    minHeight: 42,
    justifyContent: 'center',
  },
  notifPermBtnText: {
    color: '#000',
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
  settingsPanel: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  settingsPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  settingsPanelTitle: {
    color: C.text,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    marginBottom: 2,
  },
  settingsPanelSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11.5,
    lineHeight: 17,
  },
  settingsPanelChevron: {
    color: C.green,
    fontFamily: 'DMSans_700Bold',
    fontSize: 18,
    lineHeight: 22,
  },
  notifSettingsCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  notifRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  notifRowIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  notifRowLabel: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13.5,
    marginBottom: 2,
  },
  notifRowSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
  },
  notifRescheduleBtn: {
    paddingVertical: 11,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  notifRescheduleBtnText: {
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
  versionText: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  versionTapHint: {
    color: C.orange,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 12,
    opacity: 0.85,
  },

  // ── Developer Tools styles ────────────────────────────────────────────────
  devCard: {
    backgroundColor: 'rgba(99,102,241,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.3)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  coachModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(168,85,247,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.3)',
    borderRadius: 12,
    padding: 12,
  },
  coachModeBtnIcon: { fontSize: 22 },
  coachModeBtnTitle: { fontSize: 14, color: '#F0F0F0', fontFamily: 'DMSans_700Bold' },
  coachModeBtnSub: { fontSize: 11, color: '#777777', fontFamily: 'DMSans_400Regular', marginTop: 1 },
  coachModeArrow: { fontSize: 16, color: 'rgba(168,85,247,0.8)' },
  devCardTitle: {
    color: '#818cf8',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  devRowLabel: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    marginBottom: 2,
  },
  devRowSub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11.5,
  },
  devDisableBtn: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  devDisableBtnText: {
    color: '#ef4444',
    fontFamily: 'DMSans_400Regular',
    fontSize: 12.5,
  },

  // ── Body Weight Tracking styles ───────────────────────────────────────────
  weighFreqBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  weighFreqIcon: { fontSize: 16 },
  weighFreqText: {
    fontSize: 13,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },
  weighLogBtn: {
    backgroundColor: C.green,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  weighLogBtnText: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
  },
  weighEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  weighEntryBorder: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  weighEntryIcon: { fontSize: 18, minWidth: 24 },
  weighEntryDate: {
    fontSize: 12.5,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
  },
  weighEntryNote: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginTop: 2,
  },
  weighEntryVal: {
    fontSize: 15,
    color: C.green,
    fontFamily: 'BebasNeue_400Regular',
    letterSpacing: 0.5,
  },
  emptyText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },

  // ── Privacy Settings styles ───────────────────────────────────────────────
  privacyCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 4,
    marginBottom: 16,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
  },
  privacyRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  privacyRowIcon: { fontSize: 20, marginTop: 1 },
  privacyRowLabel: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    marginBottom: 2,
  },
  privacyRowSub: {
    fontSize: 11.5,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    marginBottom: 10,
  },
  privacyOptionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  privacyOptionBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  privacyOptionBtnActive: {
    backgroundColor: 'rgba(0,255,135,0.12)',
    borderColor: C.green,
  },
  privacyOptionText: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
  },
  privacyOptionTextActive: {
    color: C.green,
  },
  themePickerCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 10,
    marginBottom: 16,
    gap: 8,
  },
  themeOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: C.dark,
  },
  themeOptionSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
  },
  themeOptionLabel: {
    fontSize: 13,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    marginBottom: 1,
  },
  themeOptionSub: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },
  themeOptionCheck: {
    fontSize: 16,
    fontFamily: 'DMSans_500Medium',
  },
  voicePrefCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  voicePrefTitle: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    marginBottom: 2,
  },
  voicePrefSub: {
    fontSize: 11.5,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 17,
  },
  voicePrefValueWrap: {
    borderWidth: 1,
    borderColor: C.greenBorder,
    backgroundColor: C.greenSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  voicePrefValue: {
    fontSize: 11,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
  },
  coachBioInput: {
    minHeight: 92,
    marginTop: 14,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
    color: C.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },

  // ── Regenerate Plan Prompt styles ─────────────────────────────────────────
  regenMacroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 22,
  },
  regenMacroChip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 10,
  },
  regenMacroValue: {
    fontSize: 18,
    fontFamily: 'BebasNeue_400Regular',
    color: C.text,
    letterSpacing: 0.5,
  },
  regenMacroLabel: {
    fontSize: 9,
    fontFamily: 'SpaceMono_400Regular',
    color: C.muted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
