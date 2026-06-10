import {
  BebasNeue_400Regular,
} from '@expo-google-fonts/bebas-neue';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { ActivityIndicator, Alert, DeviceEventEmitter, StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';

import { AchievementCelebration } from '@/components/AchievementCelebration';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { GamificationProvider } from '@/contexts/GamificationContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider, useTheme as useApexTheme } from '@/contexts/ThemeContext';
import '@/lib/i18n';
import { applyApexAccessState, claimApexAccessLink, ensureApexProfileFromWalkWater, getMyApexAccess, isApexAccessPreviewEnabled, isApexQuizDone, markApexQuizDone } from '@/lib/apexAccess';
import {
  getNotifPrefs,
  maybeRescheduleCoachNotifications,
  registerForPushNotificationsAsync,
  savePushTokenToDb,
} from '@/lib/notifications';
import { useCoachMessageListener } from '@/hooks/useCoachMessageListener';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { initializeRevenueCat, maybeShowPaywall } from '@/lib/revenuecat';
import { initSentry } from '@/lib/sentry';
import { hydrateProfileFromSupabase } from '@/lib/profileSync';
import AuthNavigator from '@/navigation/AuthNavigator';
import MainNavigator from '@/navigation/MainNavigator';
import WalkWaterNavigator from '@/navigation/WalkWaterNavigator';
import GoalSetupScreen from '@/screens/GoalSetupScreen';
import ResetPasswordScreen from '@/screens/ResetPasswordScreen';
import { isWalkWaterModeEnabled, WALK_WATER_MODE_EVENT } from '@/lib/walkWaterMode';
import { AppProviders } from '@/providers/AppProviders';
import { colors, buildDarkTheme } from '@/theme';
import * as Sentry from '@sentry/react-native';

initSentry();
export const navigationRef = createNavigationContainerRef<any>();

function BootSplash() {
  const theme = useApexTheme();

  return (
    <View style={styles.bootScreen}>
      <View style={[styles.bootOrb, { borderColor: `${theme.accent}33` }]}>
        <View style={[styles.bootOrbInner, { backgroundColor: `${theme.accent}14`, borderColor: `${theme.accent}55` }]} />
      </View>
      <Text style={[styles.bootBrand, { color: theme.accent }]}>APEX</Text>
      <Text style={styles.bootHeadline}>Building your next move.</Text>
      <Text style={styles.bootSubcopy}>Loading your coach, plan, and progress.</Text>
      <View style={styles.bootLoadingRow}>
        <ActivityIndicator color={theme.accent} size="small" />
        <Text style={styles.bootLoadingText}>Getting everything ready</Text>
      </View>
    </View>
  );
}

function RootNavigator() {
  const { clearPendingAppLink, initializing, passwordResetMode, pendingAppLink, session } = useAuth();
  const { setTheme } = useApexTheme();
  const userId = session?.user?.id ?? null;
  const [profileBootstrapped, setProfileBootstrapped] = React.useState(false);
  const [profileReady, setProfileReady] = React.useState(false);
  const [walkWaterMode, setWalkWaterMode] = React.useState(true);
  const [walkWaterModeReady, setWalkWaterModeReady] = React.useState(false);
  const [guestApexSetupComplete, setGuestApexSetupComplete] = React.useState(false);
  const [apexAccessAllowed, setApexAccessAllowed] = React.useState(false);
  const [apexAccessReady, setApexAccessReady] = React.useState(false);
  // Apex 101 quiz gate: force the quiz the first time a WW user switches into
  // Apex (preview path), then never again. apexPreview = arrived via long-press.
  const [apexPreview, setApexPreview] = React.useState(false);
  const [apexQuizDone, setApexQuizDoneState] = React.useState(true);
  const [apexQuizReady, setApexQuizReady] = React.useState(false);

  // Hydrate walk-water mode flag on mount and listen for changes from admin panel
  useEffect(() => {
    Promise.all([
      isWalkWaterModeEnabled(),
      isApexAccessPreviewEnabled().catch(() => false),
    ])
      .then(([enabled, previewEnabled]) => {
        setWalkWaterMode(enabled && !previewEnabled);
        setGuestApexSetupComplete(false);
        setWalkWaterModeReady(true);
      })
      .catch(() => { setWalkWaterModeReady(true); });
    const sub = DeviceEventEmitter.addListener(WALK_WATER_MODE_EVENT, (enabled: boolean) => {
      setWalkWaterMode(enabled);
      setGuestApexSetupComplete(false);

      if (!enabled) {
        // Switching into Apex: re-gate the quiz so we show the splash (not a
        // flash of the dashboard) until the bootstrap effect reloads the flags.
        setApexQuizReady(false);
        setApexAccessAllowed(true);
        setApexAccessReady(true);
      } else {
        setApexAccessAllowed(false);
        setApexAccessReady(true);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (pendingAppLink?.type !== 'coach_access') return;
    if (!navigationRef.isReady()) return;
    navigationRef.navigate('CoachAccess');
    clearPendingAppLink();
  }, [clearPendingAppLink, pendingAppLink]);

  useEffect(() => {
    let mounted = true;

    const resolveAccess = async () => {
      if (!userId) {
        if (mounted) {
          setApexAccessAllowed(false);
          setApexAccessReady(true);
        }
        return;
      }

      try {
        if (pendingAppLink?.type === 'apex_client_migration' || pendingAppLink?.type === 'apex_ww_upgrade') {
          if (!pendingAppLink.token) {
            throw new Error('Missing Apex access token.');
          }

          const claimedAccess = await claimApexAccessLink(pendingAppLink.token);
          if (claimedAccess.originFlow === 'ww_upgrade') {
            const migratedProfile = await ensureApexProfileFromWalkWater(userId, session?.user?.email ?? null);
            if (mounted && migratedProfile) {
              setProfileReady(true);
              setProfileBootstrapped(true);
            }
          }
        }

        const backendAccess = await getMyApexAccess(userId);
        await applyApexAccessState(backendAccess);

        if (backendAccess.appAccess === 'apex' && backendAccess.originFlow === 'ww_upgrade') {
          const migratedProfile = await ensureApexProfileFromWalkWater(userId, session?.user?.email ?? null);
          if (mounted && migratedProfile) {
            setProfileReady(true);
            setProfileBootstrapped(true);
          }
        }

        if (!mounted) return;
        setApexAccessAllowed(backendAccess.appAccess === 'apex');
      } catch (error) {
        if (mounted) {
          Alert.alert(
            'Could not open Apex access link',
            error instanceof Error ? error.message : 'This link may be invalid or expired.',
          );
          setApexAccessAllowed(false);
        }
      } finally {
        clearPendingAppLink();
        if (mounted) {
          setApexAccessReady(true);
        }
      }
    };

    setApexAccessReady(false);
    resolveAccess().catch(() => {
      if (mounted) {
        setApexAccessAllowed(false);
        setApexAccessReady(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, [clearPendingAppLink, pendingAppLink, session?.user?.email, userId]);

  // Listen for new coach messages and fire local push notifications
  useCoachMessageListener(userId);

  // Save push token to DB once user is logged in, so coaches can push to this device
  useEffect(() => {
    if (!userId) return;
    registerForPushNotificationsAsync()
      .then((token) => { if (token) savePushTokenToDb(userId, token).catch(() => null); })
      .catch(() => null);
  }, [userId]);

  useEffect(() => {
    initializeRevenueCat(session?.user.id).catch(() => null);
  }, [session?.user.id]);

  useEffect(() => {
    let mounted = true;

    const bootstrapProfile = async () => {
      if (!userId || !apexAccessAllowed) {
        if (mounted) {
          setProfileReady(false);
          setProfileBootstrapped(true);
          setApexQuizReady(true);
        }
        return;
      }

      const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY).catch(() => null);
      let hydratedProfile: UserProfile | null = raw ? (JSON.parse(raw) as UserProfile) : null;

      if (!hydratedProfile) {
        hydratedProfile = await hydrateProfileFromSupabase(userId).catch(() => null);
      }

      // Apex 101 quiz gate: only force the quiz for WW users who switched in via
      // the long-press preview, and only until they complete it once.
      const [preview, quizDone] = await Promise.all([
        isApexAccessPreviewEnabled().catch(() => false),
        isApexQuizDone(userId).catch(() => false),
      ]);

      if (!mounted) return;
      setProfileReady(!!hydratedProfile);
      setApexPreview(preview);
      setApexQuizDoneState(quizDone);
      setApexQuizReady(true);
      setProfileBootstrapped(true);
    };

    setProfileBootstrapped(false);
    setApexQuizReady(false);
    bootstrapProfile();

    return () => {
      mounted = false;
    };
  }, [userId, apexAccessAllowed]);

  useEffect(() => {
    if (!userId) return;
    hydrateProfileFromSupabase(userId)
      .then(async (profile) => {
        if (!profile?.themeId) return;
        // Only apply Supabase theme when no local preference is stored —
        // this handles fresh installs on a new device without overwriting
        // the user's current theme choice on existing installs.
        const localTheme = await AsyncStorage.getItem('apex.theme').catch(() => null);
        if (!localTheme) {
          setTheme(profile.themeId).catch(() => null);
        }
      })
      .catch(() => null);
  }, [setTheme, userId]);

  // Auto-paywall on session load disabled for launch (RECONCILED_DECISIONS_V2 §6.3).
  // Apex 1-on-1 users have already paid outside the app and should never see a
  // consumer-style paywall. WW users go through the challenge-finisher offer
  // post-completion (ChallengeCompleteScreen) instead. Users who explicitly
  // navigate to the Upgrade screen still see live RevenueCat offerings there.
  // useEffect(() => {
  //   if (!session?.user?.id) return;
  //   maybeShowPaywall(session.user.id).catch(() => null);
  // }, [session?.user.id]);

  if (initializing || !apexAccessReady || !walkWaterModeReady || (session && apexAccessAllowed && (!profileBootstrapped || !apexQuizReady))) {
    return <BootSplash />;
  }

  if (passwordResetMode) {
    return <ResetPasswordScreen key="password-reset" />;
  }

  // Show the Apex quiz when (a) a genuine new Apex user has no profile yet, OR
  // (b) a WW user switched into Apex via the long-press preview and hasn't taken
  // the Apex quiz yet. Completing it once marks it done so future WW↔Apex
  // switches go straight to the dashboard.
  if (session && apexAccessAllowed && (!profileReady || (apexPreview && !apexQuizDone))) {
    return (
      <GoalSetupScreen
        onComplete={() => {
          setProfileReady(true);
          if (apexPreview) {
            setApexQuizDoneState(true);
            markApexQuizDone(userId).catch(() => null);
          }
        }}
      />
    );
  }

  if (session) {
    return (
      <>
        {apexAccessAllowed ? <MainNavigator /> : <WalkWaterNavigator key="ww-authenticated" />}
        <AchievementCelebration />
      </>
    );
  }

  if (walkWaterMode) {
    return <WalkWaterNavigator key="ww-guest" startAtQuiz />;
  }

  if (!guestApexSetupComplete) {
    return <GoalSetupScreen onComplete={() => setGuestApexSetupComplete(true)} />;
  }

  return <AuthNavigator />;
}

export default Sentry.wrap(function App() {
  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    SpaceMono_400Regular,
  });

  // Register for push notifications and reschedule AI Coach cadence on launch
  useEffect(() => {
    const initNotifications = async () => {
      await registerForPushNotificationsAsync().catch(() => null);
      // Load profile so notifications are personalised from the very first launch
      const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY).catch(() => null);
      const profile = raw ? (JSON.parse(raw) as UserProfile) : null;
      const prefs = await getNotifPrefs().catch(() => undefined);
      await maybeRescheduleCoachNotifications({
        goal: profile?.goal,
        displayName: profile?.displayName,
        prefs,
      }).catch(() => null);
    };
    initNotifications();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  function ThemedNavigation() {
    const theme = useApexTheme();
    const navigationTheme = React.useMemo(() => buildDarkTheme(theme.accent), [theme.accent]);

    return (
      <NavigationContainer ref={navigationRef} theme={navigationTheme}>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    );
  }

  return (
    <AppProviders>
      <LanguageProvider>
        <ThemeProvider>
          <AuthProvider>
            <GamificationProvider>
              <ThemedNavigation />
            </GamificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </LanguageProvider>
    </AppProviders>
  );
});

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: 28,
  },
  bootOrb: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  bootOrbInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
  },
  bootBrand: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 46,
    letterSpacing: 6,
    lineHeight: 50,
  },
  bootHeadline: {
    color: colors.textPrimary,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: 1.5,
    marginTop: 8,
    textAlign: 'center',
  },
  bootSubcopy: {
    color: colors.textSecondary,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 8,
  },
  bootLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bootLoadingText: {
    color: colors.textSecondary,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    letterSpacing: 0.2,
  },
});
