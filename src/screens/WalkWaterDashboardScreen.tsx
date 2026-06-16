/**
 * WalkWaterDashboardScreen
 *
 * Home dashboard for the Walk & Water Challenge Edition.
 * Shows daily step progress, water intake, challenge streak,
 * AI coach nudge, and quick-action buttons.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '@/contexts/AuthContext';
import { useHealth } from '@/hooks/useHealth';
import ConnectStepsModal from '@/components/ConnectStepsModal';
import {
  addWaterOz,
  getChallengeCompletedAt,
  getGroupWorkoutCompletionTime,
  getGroupWorkoutDone,
  getLastCompletedChallengeDays,
  getWalkWaterPlan,
  getWalkWaterStreak,
  getWaterOzToday,
  isWWUpgraded,
  setChallengeCompletedAt,
  setWalkWaterModeEnabled,
  WALK_WATER_UPGRADE_EVENT,
  type WalkWaterPlan,
} from '@/lib/walkWaterMode';
import { isAdminEnabled } from '@/lib/adminMode';
import { setApexAccessPreviewEnabled } from '@/lib/apexAccess';
import type { WalkWaterStackParamList } from '@/navigation/WalkWaterNavigator';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black: '#050A14',
  dark: '#080F1A',
  card: '#0D1B2A',
  border: '#1A2E45',
  blue: '#0EA5E9',
  teal: '#06B6D4',
  blueSoft: 'rgba(14,165,233,0.08)',
  blueBorder: 'rgba(14,165,233,0.2)',
  tealSoft: 'rgba(6,182,212,0.08)',
  text: '#F0F8FF',
  muted: '#6B8BA4',
  accent: '#38BDF8',
};

// Group workout starts at 4 pm Arizona (MST, no DST) = 23:00 UTC = 7 pm Eastern (EDT).
// Format in the device's local timezone so every user sees their correct local time.
function formatEventLocalTime(): string {
  const d = new Date();
  d.setUTCHours(23, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatCountdownClock(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
}

function buildBubbleWindow(challengeDays: number, currentDay: number): number[] {
  const displayDays = Math.max(challengeDays, currentDay);
  if (displayDays <= 7) {
    return Array.from({ length: displayDays }, (_, i) => i + 1);
  }
  const start = Math.max(1, Math.min(currentDay - 3, displayDays - 6));
  return Array.from({ length: 7 }, (_, i) => start + i).filter((day) => day <= displayDays);
}

// ─── Ring component ───────────────────────────────────────────────────────────

function ProgressRing({
  progress,
  size,
  strokeWidth,
  color,
  bg,
}: {
  progress: number;           // 0–1
  size: number;
  strokeWidth: number;
  color: string;
  bg: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(1, progress) * circ;

  return (
    <View style={{ width: size, height: size }}>
      {/* SVG approximation via border/arc isn't available in RN without a library;
          we use an Animated border approach instead */}
      <View
        style={{
          width: size, height: size, borderRadius: size / 2,
          borderWidth: strokeWidth, borderColor: bg,
          position: 'absolute',
        }}
      />
      {/* Filled arc approximated by rotating two half-covers */}
      <View
        style={{
          width: size, height: size, borderRadius: size / 2,
          borderWidth: strokeWidth, borderColor: color,
          borderBottomColor: progress >= 0.5 ? color : 'transparent',
          borderLeftColor: progress >= 0.25 ? color : 'transparent',
          borderTopColor: progress >= 0.75 ? color : 'transparent',
          borderRightColor: progress >= 1 ? color : 'transparent',
          position: 'absolute',
          transform: [{ rotate: `${-90 + progress * 360}deg` }],
        }}
      />
    </View>
  );
}

// ─── WalkWaterDashboardScreen ─────────────────────────────────────────────────

export default function WalkWaterDashboardScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<WalkWaterStackParamList>>();

  const { steps, refresh: refreshHealth } = useHealth();

  const [plan, setPlan] = useState<WalkWaterPlan | null>(null);
  const [waterOz, setWaterOz] = useState(0);
  const [streak, setStreak] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isUpgraded, setIsUpgraded] = useState(false);
  const [groupWorkoutDone, setGroupWorkoutDoneState] = useState(false);
  const [completionTime, setCompletionTime] = useState<number | null>(null);
  const [challengeCompletedAt, setChallengeCompletedAtState] = useState<number | null>(null);
  const [offerMsRemaining, setOfferMsRemaining] = useState(0);
  const [completedChallengeDays, setCompletedChallengeDays] = useState<number | null>(null);
  const [connectModalVisible, setConnectModalVisible] = useState(false);

  const displayName = (session?.user?.user_metadata?.display_name as string | undefined) ?? 'Champion';
  const firstName = displayName.split(' ')[0];

  const load = useCallback(async () => {
    const [p, oz, done, ct, lastCompletedDays, completedAt] = await Promise.all([
      getWalkWaterPlan(),        // self-heals startDate if needed
      getWaterOzToday(),
      getGroupWorkoutDone(),
      getGroupWorkoutCompletionTime(),
      getLastCompletedChallengeDays(),
      getChallengeCompletedAt(),
    ]);
    // Must run after getWalkWaterPlan() so the self-healed startDate is in
    // AsyncStorage before getWalkWaterStreak() reads it.
    const s = await getWalkWaterStreak();
    setPlan(p);
    setWaterOz(oz);
    setStreak(s);
    setGroupWorkoutDoneState(done);
    setCompletionTime(ct);
    setCompletedChallengeDays(lastCompletedDays);
    setChallengeCompletedAtState(completedAt);
  }, []);

  useEffect(() => {
    isAdminEnabled().then(setIsAdmin).catch(() => null);
    isWWUpgraded().then(setIsUpgraded).catch(() => null);
    const sub = DeviceEventEmitter.addListener(WALK_WATER_UPGRADE_EVENT, () => setIsUpgraded(true));
    return () => sub.remove();
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshHealth()]);
    setRefreshing(false);
  }, [load, refreshHealth]);

  // Offer window countdown (48 h from group workout completion or challenge completion)
  useEffect(() => {
    const anchor = completionTime ?? challengeCompletedAt;
    if (!anchor) return;
    const tick = setInterval(() => {
      const end = anchor + 48 * 60 * 60 * 1000;
      setOfferMsRemaining(Math.max(0, end - Date.now()));
    }, 1000);
    return () => clearInterval(tick);
  }, [completionTime, challengeCompletedAt]);

  // Record the exact moment the challenge first completes so the replay-window
  // anchor survives across days (activeChallengeComplete is time-based for 3-day
  // and reverts to false the next day, but challengeCompletedAt persists).
  useEffect(() => {
    if (activeChallengeComplete && challengeCompletedAt === null) {
      const ts = Date.now();
      setChallengeCompletedAt(ts).catch(() => null);
      setChallengeCompletedAtState(ts);
    }
  }, [activeChallengeComplete, challengeCompletedAt]);

  const handleAdminToggle = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await setApexAccessPreviewEnabled(true);
    await setWalkWaterModeEnabled(false);
  }, []);

  const handleAddWater = useCallback(async (oz: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = await addWaterOz(oz);
    setWaterOz(next);
  }, []);

  const handleConnectSteps = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConnectModalVisible(true);
  }, []);

  const handleConnectModalGrant = useCallback(async () => {
    if (Platform.OS === 'android') {
      const { requestAndroidHealthPermission } = await import('@/hooks/useHealth');
      const granted = await requestAndroidHealthPermission();
      if (granted) {
        await refreshHealth();
      } else {
        Linking.openURL(
          'intent:#Intent;action=androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE;package=com.google.android.apps.healthdata;end',
        ).catch(() =>
          Linking.openURL('market://details?id=com.google.android.apps.healthdata').catch(() => null),
        );
      }
    } else {
      await refreshHealth();
    }
  }, [refreshHealth]);

  const stepGoal = plan?.dailyStepGoal ?? 8000;
  const waterGoalOz = plan?.dailyWaterGoalOz ?? 64;
  const stepPct = Math.min(1, steps / stepGoal);
  const waterPct = Math.min(1, waterOz / waterGoalOz);
  const waterGlasses = Math.round(waterOz / 8);
  const waterGlassGoal = Math.round(waterGoalOz / 8);
  // Arizona time = UTC-7, no DST
  const azNow = new Date(Date.now() - 7 * 60 * 60 * 1000);
  const azDayOfWeek = azNow.getUTCDay(); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  const azHour = azNow.getUTCHours();

  // For 3-day challenges: day is determined by AZ day-of-week (Tue=1,Wed=2,Thu<17=3)
  const is3Day = plan?.challengeDays === 3;
  const threeDayCurrentDay: number | null = is3Day
    ? (azDayOfWeek === 2 ? 1 : azDayOfWeek === 3 ? 2 : azDayOfWeek === 4 && azHour < 17 ? 3 : null)
    : null;
  const is3DayOffCycle = is3Day && threeDayCurrentDay === null;

  // Days until next Tuesday in AZ time
  const daysUntilTuesday = is3DayOffCycle
    ? (() => {
        const daysUntil = (2 - azDayOfWeek + 7) % 7 || 7;
        const hoursUntil = daysUntil * 24 - azHour;
        return hoursUntil < 24 ? 'Tomorrow' : `${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
      })()
    : null;

  const challengeComplete = plan
    ? (is3Day ? azDayOfWeek === 4 && azHour >= 17 : streak >= plan.challengeDays)
    : false;
  const currentDay = plan
    ? (is3Day ? (threeDayCurrentDay ?? plan.challengeDays) : Math.min(streak + 1, plan.challengeDays))
    : 1;
  const isFinalDay = is3DayOffCycle ? false : (plan ? currentDay === plan.challengeDays : false);

  const activeCurrentDay        = currentDay;
  const activeIsFinalDay        = isFinalDay;
  const activeGroupWorkoutDone  = groupWorkoutDone;
  const activeChallengeComplete = challengeComplete;
  const activeFinalePhase       = null as null | 'pre' | 'live' | 'post';
  const activeOfferMs           = offerMsRemaining;
  const trophyChallengeDays = completedChallengeDays
    ?? ((isUpgraded && plan && plan.challengeDays > 3 && streak < plan.challengeDays) ? 3 : plan?.challengeDays ?? 3);

  // Real event phase for Day 3 — 4 pm AZ (MST = UTC-7) = 23:00 UTC; ends 5 pm AZ = 00:00 UTC
  const realEventPhase: 'pre' | 'live' | 'post' | null = (() => {
    if (!plan || !isFinalDay) return null;
    const day3 = new Date(plan.startDate);
    day3.setDate(day3.getDate() + plan.challengeDays - 1);
    const start = new Date(`${day3.toISOString().slice(0, 10)}T23:00:00Z`).getTime();
    const end = start + 60 * 60 * 1000;
    const now = Date.now();
    if (now < start) return 'pre';
    if (now <= end) return 'live';
    return 'post';
  })();
  const activeEventPhase = activeFinalePhase ?? realEventPhase;
  const finalDayLiveStartsInMs = (() => {
    if (!plan || !activeIsFinalDay) return null;
    const eventDay = new Date(plan.startDate);
    eventDay.setDate(eventDay.getDate() + plan.challengeDays - 1);
    const start = new Date(`${eventDay.toISOString().slice(0, 10)}T23:00:00Z`).getTime();
    return Math.max(0, start - Date.now());
  })();

  // ── Banner state machine (RECONCILED_DECISIONS_V2 §1.1, §1.3) ────────────────
  // Replay window: 48h after group workout completion. After expiry, the
  // "Missed It" state transitions into "Don't Stop Now" so the user is always
  // pushed somewhere actionable instead of seeing a stale "watch the replay"
  // CTA pointing at expired content.
  //
  // For users who completed the challenge but skipped the live group workout
  // entirely, we still need the replay window to expire — fall back to the
  // challenge-end timestamp so Don't Stop Now eventually fires.
  const REPLAY_WINDOW_MS = 48 * 60 * 60 * 1000;
  const challengeEndTimestamp = (() => {
    if (!plan) return null;
    const start = new Date(plan.startDate).getTime();
    if (Number.isNaN(start)) return null;
    return start + plan.challengeDays * 86400000;
  })();
  // Anchor order: group-workout time → challenge completion timestamp → challenge-end date.
  // challengeCompletedAt is recorded the moment activeChallengeComplete first becomes true,
  // so the 48-h window stays correct even on days when the time-based check is no longer true
  // (e.g. the day after a 3-day challenge ends).
  const replayAnchor = completionTime ?? challengeCompletedAt ?? challengeEndTimestamp;
  const replayWindowOpen = replayAnchor != null && Date.now() < replayAnchor + REPLAY_WINDOW_MS;
  const replayWindowExpired = replayAnchor != null && !replayWindowOpen;

  // hasEverCompleted: true if the challenge is currently complete, was recorded as
  // complete (challengeCompletedAt), OR we are simply past the challenge-end date.
  // The third check is the robust fallback — it needs no real-time observation so
  // users who don't open the app during the exact completion window still get it.
  const isPastChallengeEnd = challengeEndTimestamp != null && Date.now() >= challengeEndTimestamp;
  const hasEverCompleted = activeChallengeComplete || challengeCompletedAt != null || isPastChallengeEnd;
  const isOfferExpired = hasEverCompleted && replayWindowExpired;

  // Missed it: past the event, workout not done, AND still inside the 48h
  // replay window. Once the window expires, Don't Stop Now takes over.
  const showMissedIt = (
    !activeGroupWorkoutDone && !isUpgraded && !isOfferExpired && (
      activeCurrentDay >= 4 || (activeIsFinalDay && activeEventPhase === 'post')
    )
  );

  function formatOfferCountdown(ms: number): string {
    if (ms <= 0) return 'Offer expired';
    return `${formatCountdownClock(ms)} remaining`;
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={WW.blue} />}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}, {firstName} 👋</Text>
          <Pressable
            onLongPress={handleAdminToggle}
            delayLongPress={2000}
          >
            <Text style={styles.headerSub}>Walk + Water Challenge</Text>
          </Pressable>
        </View>
        {plan && (
          <View style={styles.streakBadge}>
            <Text style={styles.streakFire}>🔥</Text>
            <Text style={styles.streakCount}>{streak}</Text>
          </View>
        )}
      </View>

      {/* ── "Missed it?" banner — Day 3 Post or Day 4+ without group workout ── */}
      {showMissedIt && (
        <Pressable
          style={styles.missedItBanner}
          onPress={() => (navigation as any).navigate('Finale', undefined)}
        >
          <View style={styles.completeBannerLeft}>
            <Text style={styles.missedItEyebrow}>DAY 3 · MISSED IT?</Text>
            <Text style={styles.missedItTitle}>Watch the Recording 📹</Text>
            <Text style={styles.missedItSub}>You missed the live workout. Watch the replay and complete it to unlock your reward →</Text>
          </View>
          <Text style={styles.missedItArrow}>→</Text>
        </Pressable>
      )}

      {/* ── Day 3 Live banner ── */}
      {activeIsFinalDay && !activeGroupWorkoutDone && !isUpgraded && activeEventPhase === 'live' && (
        <Pressable
          style={styles.liveBanner}
          onPress={() => (navigation as any).navigate('Finale', { devPhase: 'live' })}
        >
          <View style={styles.completeBannerLeft}>
            <Text style={styles.liveEyebrow}>🔴 LIVE NOW</Text>
            <Text style={styles.liveTitle}>Coach Josh's group workout is happening right now</Text>
            <Text style={styles.liveSub}>Tap the red banner to join live and comment with the group →</Text>
          </View>
          <Text style={styles.liveArrow}>→</Text>
        </Pressable>
      )}

      {/* ── Day 3 Pre banner ── */}
      {activeIsFinalDay && !activeGroupWorkoutDone && !isUpgraded && activeEventPhase !== 'live' && activeEventPhase !== 'post' && (
        <Pressable
          style={styles.finaleBanner}
          onPress={() => (navigation as any).navigate('Finale', undefined)}
        >
          <View style={styles.completeBannerLeft}>
            <Text style={styles.finaleEyebrow}>🏋️ FINAL DAY</Text>
            <Text style={styles.finaleTitle}>Group Workout at {formatEventLocalTime()}</Text>
            <Text style={styles.finaleSub}>
              {finalDayLiveStartsInMs != null ? `Starts in ${formatCountdownClock(finalDayLiveStartsInMs)} →` : 'Complete it to unlock your reward →'}
            </Text>
          </View>
          <Text style={styles.finaleArrow}>→</Text>
        </Pressable>
      )}

      {/* ── Challenge complete banner — offer still active ── */}
      {/* Gated on the persisted groupWorkoutDone flag (not the Thursday-only      */}
      {/* challengeComplete clock) so the reward banner stays up for the full 48h  */}
      {/* offer window instead of vanishing at midnight on finale day. The flag    */}
      {/* only flips after the Day-3 finale unlock, so this can't fire early.      */}
      {activeGroupWorkoutDone && !isUpgraded && !isOfferExpired && (
        <Pressable
          style={styles.completeBanner}
          onPress={() => (navigation as any).navigate('ChallengeComplete')}
        >
          <View style={styles.completeBannerLeft}>
            <Text style={styles.completeBannerEyebrow}>🏆 CHALLENGE COMPLETE</Text>
            <Text style={styles.completeBannerTitle}>You finished. Claim your reward.</Text>
            <Text style={styles.completeBannerSub}>Offer ends in {formatOfferCountdown(activeOfferMs)}</Text>
          </View>
          <Text style={styles.completeBannerArrow}>→</Text>
        </Pressable>
      )}

      {/* ── Don't Stop Now banner — replay window closed, never upgraded ── */}
      {/* Per RECONCILED_DECISIONS_V2 §2: this is a momentum banner, not an */}
      {/* expired-offer banner. Tapping opens WW re-quiz with no gender step  */}
      {/* and all durations unlocked (re-quiz handles auth-skipped path).     */}
      {isOfferExpired && !isUpgraded && (
        <Pressable
          style={styles.newChallengeBanner}
          onPress={() => (navigation as any).navigate('WalkWaterQuiz', { mode: 'requiz' })}
        >
          <View style={styles.completeBannerLeft}>
            <Text style={styles.newChallengeEyebrow}>KEEP THE STREAK ALIVE</Text>
            <Text style={styles.newChallengeTitle}>Don't Stop Now.</Text>
            <Text style={styles.newChallengeSub}>Your habit is just getting started — jump into the next challenge.</Text>
          </View>
          <Text style={styles.newChallengeArrow}>→</Text>
        </Pressable>
      )}

      {/* ── Challenge complete banner — upgraded users, post-challenge ── */}
      {/* Shows when past challenge end OR in 3-day off-cycle window        */}
      {/* (off-cycle = Fri–Mon, when startDate points to next Tuesday and   */}
      {/* isPastChallengeEnd would be false despite challenge being done).  */}
      {isUpgraded && (isPastChallengeEnd || is3DayOffCycle) && (
        <View style={styles.completeBanner}>
          <View style={styles.completeBannerLeft}>
            <Text style={styles.completeBannerEyebrow}>🏆 CHALLENGE COMPLETE</Text>
            <Text style={styles.completeBannerTitle}>
              {trophyChallengeDays}-Day Challenge Complete
            </Text>
            <Text style={styles.completeBannerSub}>
              You walked the habit into existence. Now let's build on it.
            </Text>
          </View>
        </View>
      )}

      {/* ── Progress cards ── */}
      <View style={styles.statsRow}>
        {/* Steps */}
        <View style={[styles.statCard, styles.stepsCard]}>
          <Text style={styles.statEyebrow}>TODAY'S STEPS</Text>
          <Text style={styles.statValue}>{steps.toLocaleString()}</Text>
          <Text style={styles.statGoal}>Goal: {stepGoal.toLocaleString()}</Text>
          <View style={styles.statTrack}>
            <View style={[styles.statFill, { width: `${Math.round(stepPct * 100)}%`, backgroundColor: WW.blue }]} />
          </View>
          <Text style={[styles.statPct, { color: WW.blue }]}>{Math.round(stepPct * 100)}%</Text>
          <Pressable
            style={styles.statCta}
            onPress={() => (navigation as any).navigate('Walk')}
          >
            <Text style={styles.statCtaText}>Start Walk →</Text>
          </Pressable>
          {steps === 0 && (
            <Pressable
              style={[styles.statCta, { marginTop: 6, borderColor: `${WW.blue}44` }]}
              onPress={handleConnectSteps}
            >
              <Text style={styles.statCtaText}>Connect Steps +</Text>
            </Pressable>
          )}
        </View>

        {/* Water */}
        <View style={[styles.statCard, styles.waterCard]}>
          <Text style={styles.statEyebrow}>TODAY'S WATER</Text>
          <Text style={[styles.statValue, { color: WW.teal }]}>{waterGlasses}</Text>
          <Text style={styles.statGoal}>Goal: {waterGlassGoal} glasses</Text>
          <View style={styles.statTrack}>
            <View style={[styles.statFill, { width: `${Math.round(waterPct * 100)}%`, backgroundColor: WW.teal }]} />
          </View>
          <Text style={[styles.statPct, { color: WW.teal }]}>{Math.round(waterPct * 100)}%</Text>
          <Pressable
            style={[styles.statCta, { borderColor: `${WW.teal}44` }]}
            onPress={() => (navigation as any).navigate('Water')}
          >
            <Text style={[styles.statCtaText, { color: WW.teal }]}>Log Water →</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Quick water log ── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>QUICK ADD WATER</Text>
        <View style={styles.waterBtnsRow}>
          {[8, 12, 16, 20].map((oz) => (
            <Pressable key={oz} style={styles.waterBtn} onPress={() => handleAddWater(oz)}>
              <Text style={styles.waterBtnOz}>{oz} oz</Text>
              <Text style={styles.waterBtnSub}>+1 {oz <= 8 ? 'glass' : 'large'}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── AI Coach nudge ── */}
      <View style={styles.coachCard}>
        <View style={styles.coachHeader}>
          <Text style={styles.coachAvatar}>🤖</Text>
          <View>
            <Text style={styles.coachLabel}>AI WALK + WATER COACH</Text>
            <Text style={styles.coachName}>Daily check-in</Text>
          </View>
        </View>
        <Text style={styles.coachMessage}>
          {(() => {
            // Finished the group workout — congratulate and point at the reward
            // banner above. Takes priority over the "join live" copy so a finisher
            // is never told to tap a red banner that's already hidden (the live
            // banner requires !groupWorkoutDone).
            if (activeGroupWorkoutDone && !isUpgraded && !isOfferExpired) {
              return `You crushed the group workout, ${firstName}. 🏆 Your challenge-finisher reward is unlocked — tap the banner above to claim it before the offer expires.`;
            }
            if (activeCurrentDay >= 4) {
              const timeLeft = formatOfferCountdown(activeOfferMs);
              return `You completed the challenge — now it's time to keep the momentum. Your challenge-finisher price is only available for ${timeLeft}. Don't let it slip.`;
            }
            if (activeIsFinalDay && activeEventPhase === 'live') {
              return `The live workout is happening now. Tap the red banner above to join Coach Josh live and comment with the group while you train.`;
            }
            if (activeIsFinalDay) {
              return `This is Day ${activeCurrentDay} — your last day. Finish strong. Hit your steps, drink your water, and join the group workout tonight at ${formatEventLocalTime()}.`;
            }
            if (activeCurrentDay === 2) {
              return waterGlasses < waterGlassGoal / 2
                ? `Day 2. You showed up yesterday — that's the hardest part. You're at ${waterGlasses} glasses, drink one now and keep going.`
                : steps < stepGoal * 0.5
                ? `Day 2. You showed up yesterday — that's the hardest part. Stay consistent: get those steps in today.`
                : `Day 2. You showed up yesterday and you're showing up today. Steps + water — you're on it.`;
            }
            if (waterGlasses < waterGlassGoal / 2) {
              return `You're at ${waterGlasses} glasses — drink one now. Hydration is half the challenge.`;
            }
            if (steps < stepGoal * 0.5) {
              return `You're at ${Math.round(stepPct * 100)}% of your step goal. A 20-minute walk handles it.`;
            }
            return `You're on track today. Keep the momentum — finish your water and hit that step goal.`;
          })()}
        </Text>
        <Pressable
          style={styles.coachCta}
          onPress={() => (navigation as any).navigate('Coach')}
        >
          <Text style={styles.coachCtaText}>Chat with Coach →</Text>
        </Pressable>
      </View>

      {/* ── Challenge progress card ── */}
      {plan && !isUpgraded && (() => {
        const currentDay = activeCurrentDay;
        const bubbleWindow = buildBubbleWindow(plan.challengeDays, currentDay);
        const windowStart = bubbleWindow[0];
        const windowEnd = bubbleWindow[bubbleWindow.length - 1];
        const goalEmojis: Record<string, string> = {
          'Lean out': '🔥', 'More energy': '⚡',
          'Build confidence': '💪', 'Build a lasting habit': '💪',
          'Feel better every day': '✨', 'Feel better daily': '✨',
        };
        const goalEmoji = goalEmojis[plan.goalLabel] ?? '🎯';

        // 3-day off-cycle: show countdown to next Tuesday
        if (is3DayOffCycle) {
          return (
            <View style={styles.progressCard}>
              <View style={styles.progressTopRow}>
                <Text style={styles.progressEyebrow}>YOUR CHALLENGE</Text>
              </View>
              <View style={{ alignItems: 'center', paddingVertical: 12, gap: 4 }}>
                <Text style={{ fontSize: 28 }}>⏳</Text>
                <Text style={[styles.progressDayLabel, { textAlign: 'center' }]}>
                  Next 3-Day Challenge
                </Text>
                <Text style={{ fontSize: 13, color: '#6B8BA4', textAlign: 'center' }}>
                  Starts Tuesday · {daysUntilTuesday} away
                </Text>
              </View>
              <View style={styles.progressDivider} />
              <View style={styles.progressGoalRow}>
                <Text style={styles.progressGoalKey}>YOUR GOAL</Text>
                <Text style={styles.progressGoalValue}>{goalEmoji}  {plan.goalLabel}</Text>
              </View>
            </View>
          );
        }

        return (
          <View style={styles.progressCard}>
            <View style={styles.progressTopRow}>
              <Text style={styles.progressEyebrow}>YOUR CHALLENGE</Text>
              {plan.challengeDays > 7 ? (
                <Text style={styles.progressWindowLabel}>Days {windowStart}-{windowEnd}</Text>
              ) : null}
            </View>
            <View style={styles.progressRow}>
              <View style={styles.progressDots}>
                {bubbleWindow.map((day) => {
                  const completed = day < currentDay;
                  const current = day === currentDay;
                  const isBonusDay = day > 3;
                  return (
                    <View
                      key={day}
                      style={[
                        styles.progressBubble,
                        isBonusDay && styles.progressBubbleBonus,
                        completed && styles.progressBubbleCompleted,
                        completed && isBonusDay && styles.progressBubbleBonusCompleted,
                        current && styles.progressBubbleCurrent,
                        current && isBonusDay && styles.progressBubbleBonusCurrent,
                      ]}
                    >
                      <Text
                        style={[
                          styles.progressBubbleText,
                          (completed || current) && styles.progressBubbleTextActive,
                          isBonusDay && styles.progressBubbleTextBonus,
                          (completed || current) && isBonusDay && styles.progressBubbleTextBonusActive,
                        ]}
                      >
                        {day}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.progressDayLabel}>Day {currentDay} of {plan.challengeDays}</Text>
            </View>
            <View style={styles.progressDivider} />
            <View style={styles.progressGoalRow}>
              <Text style={styles.progressGoalKey}>YOUR GOAL</Text>
              <Text style={styles.progressGoalValue}>{goalEmoji}  {plan.goalLabel}</Text>
            </View>
          </View>
        );
      })()}

      {/* ── APEX content (post-upgrade) ── */}
      {isUpgraded && (
        <>
          {/* Next-challenge countdown card (replaces trophy — trophy moved to top banner) */}
          {plan && (isPastChallengeEnd || is3DayOffCycle) && (() => {
            const goalEmojis: Record<string, string> = {
              'Lean out': '🔥', 'More energy': '⚡',
              'Build confidence': '💪', 'Build a lasting habit': '💪',
              'Feel better every day': '✨', 'Feel better daily': '✨',
            };
            const goalEmoji = goalEmojis[plan.goalLabel] ?? '🎯';
            return (
              <Pressable
                style={styles.progressCard}
                onPress={() => (navigation as any).navigate('WalkWaterQuiz', { mode: 'requiz' })}
              >
                <View style={styles.progressTopRow}>
                  <Text style={styles.progressEyebrow}>YOUR CHALLENGE</Text>
                </View>
                <View style={{ alignItems: 'center', paddingVertical: 12, gap: 4 }}>
                  <Text style={{ fontSize: 28 }}>⏳</Text>
                  <Text style={[styles.progressDayLabel, { textAlign: 'center' }]}>
                    {is3DayOffCycle ? 'Next 3-Day Challenge' : 'Start Your Next Challenge'}
                  </Text>
                  <Text style={{ fontSize: 13, color: '#6B8BA4', textAlign: 'center' }}>
                    {is3DayOffCycle && daysUntilTuesday
                      ? `Starts Tuesday · ${daysUntilTuesday} away`
                      : 'Tap to set your next goal →'}
                  </Text>
                </View>
                <View style={styles.progressDivider} />
                <View style={styles.progressGoalRow}>
                  <Text style={styles.progressGoalKey}>YOUR GOAL</Text>
                  <Text style={styles.progressGoalValue}>{goalEmoji}  {plan.goalLabel}</Text>
                </View>
              </Pressable>
            );
          })()}

          {/* Unlocked feature cards */}
          <Text style={styles.apexSectionLabel}>WHAT'S UNLOCKED</Text>
          <View style={styles.apexCardRow}>
            <Pressable
              style={[styles.apexCard, styles.apexCardTrain]}
              onPress={() => (navigation as any).navigate('Train')}
            >
              <Text style={styles.apexCardEmoji}>💪</Text>
              <Text style={styles.apexCardTitle}>Train</Text>
              <Text style={styles.apexCardSub}>Bodyweight & strength plans</Text>
              <Text style={styles.apexCardArrow}>→</Text>
            </Pressable>
            <Pressable
              style={[styles.apexCard, styles.apexCardFuel]}
              onPress={() => (navigation as any).navigate('Fuel')}
            >
              <Text style={styles.apexCardEmoji}>🥗</Text>
              <Text style={styles.apexCardTitle}>Fuel</Text>
              <Text style={styles.apexCardSub}>Meal plans built for your goal</Text>
              <Text style={[styles.apexCardArrow, { color: WW.teal }]}>→</Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.communityCard}
            onPress={() => (navigation as any).navigate('Community')}
          >
            <View style={styles.communityLeft}>
              <Text style={styles.communityEyebrow}>COMMUNITY</Text>
              <Text style={styles.communityTitle}>You're still not doing this alone.</Text>
              <Text style={styles.communitySub}>Keep posting wins, checking in with the group, and staying accountable as you build on the habit.</Text>
            </View>
            <Text style={styles.communityArrow}>→</Text>
          </Pressable>
        </>
      )}

      {/* ── Community card ── */}
      {!isUpgraded && (
        <Pressable
          style={styles.communityCard}
          onPress={() => (navigation as any).navigate('Community')}
        >
          <View style={styles.communityLeft}>
            <Text style={styles.communityEyebrow}>COMMUNITY</Text>
            <Text style={styles.communityTitle}>You're not doing this alone.</Text>
            <Text style={styles.communitySub}>Others are on the challenge with you — post your walk, stay accountable.</Text>
          </View>
          <Text style={styles.communityArrow}>→</Text>
        </Pressable>
      )}

    </ScrollView>

    <ConnectStepsModal
      visible={connectModalVisible}
      onClose={() => setConnectModalVisible(false)}
      onConnect={async () => {
        setConnectModalVisible(false);
        await handleConnectModalGrant();
      }}
    />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WW.black },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },

  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  greeting: { fontSize: 22, color: WW.text, fontWeight: '800', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: WW.muted, marginTop: 3, fontWeight: '500' },
  streakBadge: {
    backgroundColor: 'rgba(255,107,53,0.15)', borderWidth: 1, borderColor: 'rgba(255,107,53,0.3)',
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center',
  },
  streakFire: { fontSize: 14 },
  streakCount: { fontSize: 18, color: '#FF6B35', fontWeight: '900', lineHeight: 20 },

  finaleBanner: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(239,68,68,0.35)',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  finaleEyebrow: { fontSize: 9, color: '#EF4444', fontWeight: '700', letterSpacing: 1.2 },
  finaleTitle:   { fontSize: 16, color: WW.text, fontWeight: '800', letterSpacing: -0.2, marginTop: 2 },
  finaleSub:     { fontSize: 12, color: WW.muted, fontWeight: '500', marginTop: 2 },
  finaleArrow:   { fontSize: 20, color: '#EF4444', fontWeight: '700', marginLeft: 12 },

  completeBanner: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(245,158,11,0.35)',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  completeBannerLeft: { flex: 1, gap: 3 },
  completeBannerEyebrow: { fontSize: 9, color: '#F59E0B', fontWeight: '700', letterSpacing: 1.2 },
  completeBannerTitle: { fontSize: 16, color: WW.text, fontWeight: '800', letterSpacing: -0.2 },
  completeBannerSub: { fontSize: 12, color: WW.muted, fontWeight: '500' },
  completeBannerArrow: { fontSize: 20, color: '#F59E0B', fontWeight: '700', marginLeft: 12 },

  newChallengeBanner: {
    backgroundColor: WW.blueSoft,
    borderWidth: 1.5,
    borderColor: WW.blueBorder,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  newChallengeEyebrow: { fontSize: 9, color: WW.blue, fontWeight: '700', letterSpacing: 1.2 },
  newChallengeTitle:   { fontSize: 16, color: WW.text, fontWeight: '800', letterSpacing: -0.2, marginTop: 2 },
  newChallengeSub:     { fontSize: 12, color: WW.muted, fontWeight: '500', marginTop: 2 },
  newChallengeArrow:   { fontSize: 20, color: WW.blue, fontWeight: '700', marginLeft: 12 },

  missedItBanner: {
    backgroundColor: 'rgba(14,165,233,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(14,165,233,0.35)',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  missedItEyebrow: { fontSize: 9, color: WW.blue, fontWeight: '700', letterSpacing: 1.2 },
  missedItTitle:   { fontSize: 16, color: WW.text, fontWeight: '800', letterSpacing: -0.2, marginTop: 2 },
  missedItSub:     { fontSize: 12, color: WW.muted, fontWeight: '500', marginTop: 2 },
  missedItArrow:   { fontSize: 20, color: WW.blue, fontWeight: '700', marginLeft: 12 },

  liveBanner: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1.5,
    borderColor: 'rgba(239,68,68,0.45)',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveEyebrow: { fontSize: 9, color: '#EF4444', fontWeight: '700', letterSpacing: 1.2 },
  liveTitle:   { fontSize: 16, color: WW.text, fontWeight: '800', letterSpacing: -0.2, marginTop: 2 },
  liveSub:     { fontSize: 12, color: WW.muted, fontWeight: '500', marginTop: 2 },
  liveArrow:   { fontSize: 20, color: '#EF4444', fontWeight: '700', marginLeft: 12 },

  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1, backgroundColor: WW.card, borderWidth: 1, borderRadius: 16, padding: 16, gap: 4,
  },
  stepsCard: { borderColor: WW.blueBorder },
  waterCard: { borderColor: 'rgba(6,182,212,0.2)' },
  statEyebrow: { fontSize: 8, color: WW.muted, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  statValue: { fontSize: 26, color: WW.blue, fontWeight: '900', letterSpacing: -0.5 },
  statGoal: { fontSize: 10, color: WW.muted, marginTop: 1 },
  statTrack: { height: 4, backgroundColor: WW.border, borderRadius: 2, overflow: 'hidden', marginTop: 8, marginBottom: 2 },
  statFill: { height: '100%', borderRadius: 2 },
  statPct: { fontSize: 11, fontWeight: '700' },
  statCta: {
    borderWidth: 1, borderColor: WW.blueBorder, borderRadius: 8,
    paddingVertical: 7, alignItems: 'center', marginTop: 6,
  },
  statCtaText: { fontSize: 11, color: WW.blue, fontWeight: '700' },

  section: { gap: 10 },
  sectionLabel: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.2 },

  waterBtnsRow: { flexDirection: 'row', gap: 8 },
  waterBtn: {
    flex: 1, backgroundColor: WW.card, borderWidth: 1, borderColor: 'rgba(6,182,212,0.2)',
    borderRadius: 12, padding: 12, alignItems: 'center', gap: 2,
  },
  waterBtnOz: { fontSize: 14, color: WW.teal, fontWeight: '800' },
  waterBtnSub: { fontSize: 9, color: WW.muted, fontWeight: '600' },

  coachCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 16, padding: 16,
  },
  coachHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  coachAvatar: { fontSize: 28 },
  coachLabel: { fontSize: 8, color: WW.blue, fontWeight: '700', letterSpacing: 1.2 },
  coachName: { fontSize: 14, color: WW.text, fontWeight: '700', marginTop: 1 },
  coachMessage: { fontSize: 14, color: WW.text, lineHeight: 21, fontWeight: '400', marginBottom: 12 },
  coachCta: {
    backgroundColor: WW.blueSoft, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 10, paddingVertical: 10, alignItems: 'center',
  },
  coachCtaText: { fontSize: 13, color: WW.blue, fontWeight: '700' },

  trophyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)', borderRadius: 16, padding: 16,
  },
  trophyEmoji: { fontSize: 32 },
  trophyText: { flex: 1, gap: 3 },
  trophyTitle: { fontSize: 15, color: WW.text, fontWeight: '800' },
  trophydSub: { fontSize: 12, color: WW.muted, fontWeight: '500', lineHeight: 17 },

  apexSectionLabel: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.5 },
  apexCardRow: { flexDirection: 'row', gap: 10 },
  apexCard: {
    flex: 1, borderWidth: 1, borderRadius: 16, padding: 16, gap: 4,
  },
  apexCardTrain: {
    backgroundColor: WW.blueSoft, borderColor: WW.blueBorder,
  },
  apexCardFuel: {
    backgroundColor: WW.tealSoft, borderColor: 'rgba(6,182,212,0.2)',
  },
  apexCardEmoji: { fontSize: 24, marginBottom: 4 },
  apexCardTitle: { fontSize: 16, color: WW.text, fontWeight: '800' },
  apexCardSub: { fontSize: 11, color: WW.muted, fontWeight: '500' },
  apexCardArrow: { fontSize: 18, color: WW.blue, fontWeight: '700', marginTop: 8 },

  progressCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 16, padding: 16, gap: 12,
  },
  progressTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressEyebrow: { fontSize: 8, color: WW.blue, fontWeight: '700', letterSpacing: 1.5 },
  progressWindowLabel: { fontSize: 10, color: WW.muted, fontWeight: '600' },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressDots: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', flex: 1, marginRight: 12 },
  progressBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBubbleCompleted: {
    backgroundColor: WW.accent,
    borderColor: WW.accent,
  },
  progressBubbleCurrent: {
    backgroundColor: WW.blue,
    borderColor: WW.blue,
    transform: [{ scale: 1.08 }],
  },
  progressBubbleBonus: {
    borderColor: 'rgba(245,158,11,0.35)',
    backgroundColor: 'rgba(245,158,11,0.08)',
  },
  progressBubbleBonusCompleted: {
    backgroundColor: '#FBBF24',
    borderColor: '#FBBF24',
  },
  progressBubbleBonusCurrent: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
    transform: [{ scale: 1.08 }],
  },
  progressBubbleText: { fontSize: 11, color: WW.muted, fontWeight: '800' },
  progressBubbleTextActive: { color: '#04101D' },
  progressBubbleTextBonus: { color: '#FBBF24' },
  progressBubbleTextBonusActive: { color: '#1A1204' },
  progressDayLabel: { fontSize: 13, color: WW.text, fontWeight: '700' },
  progressDivider: { height: 1, backgroundColor: WW.border },
  progressGoalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressGoalKey: { fontSize: 8, color: WW.muted, fontWeight: '700', letterSpacing: 1.2 },
  progressGoalValue: { fontSize: 13, color: WW.text, fontWeight: '700' },

  communityCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: WW.card, borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)',
    borderRadius: 16, padding: 16, gap: 12,
  },
  communityLeft: { flex: 1, gap: 4 },
  communityEyebrow: { fontSize: 8, color: WW.teal, fontWeight: '700', letterSpacing: 1.5 },
  communityTitle: { fontSize: 15, color: WW.text, fontWeight: '800' },
  communitySub: { fontSize: 12, color: WW.muted, fontWeight: '400', lineHeight: 17 },
  communityArrow: { fontSize: 20, color: WW.teal, fontWeight: '700' },
});
