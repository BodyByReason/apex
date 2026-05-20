/**
 * WalkWaterFinaleScreen — Day 3 Group Workout Finale
 *
 * Shows on the final day of the challenge. Contains:
 * - Live countdown / Join Live / Watch Recording based on event time
 * - Full workout plan (warm-up, 3-round workout, stretch)
 * - Top-3 leaderboard preview
 * - Mark Complete button (unlocks after 20 min on screen)
 * - Completing this sets groupWorkoutDone → unlocks the upgrade offer
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Audio, ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';

import { useAuth } from '@/contexts/AuthContext';
import { getWalkWaterPlan, getWalkWaterStreak, getWaterOzToday, setGroupWorkoutDone } from '@/lib/walkWaterMode';
import { fetchActiveSession, fetchEvergreenReplaySession } from '@/lib/tribeLive';
import { fetchLeaderboard, upsertMyStats, type LeaderboardEntry } from '@/lib/wwLeaderboard';
import { getDailyWalkTotals } from '@/lib/walkRecords';
import { useHealth } from '@/hooks/useHealth';
import { supabase } from '@/lib/supabase';
import { scheduleWorkoutUnlockNotification, cancelWorkoutUnlockNotification, cancelWalkWaterNotifications } from '@/lib/notifications';
import type { WalkWaterStackParamList } from '@/navigation/WalkWaterNavigator';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black:      '#050A14',
  dark:       '#080F1A',
  card:       '#0D1B2A',
  border:     '#1A2E45',
  blue:       '#0EA5E9',
  teal:       '#06B6D4',
  amber:      '#F59E0B',
  amberSoft:  'rgba(245,158,11,0.08)',
  amberBorder:'rgba(245,158,11,0.3)',
  blueSoft:   'rgba(14,165,233,0.08)',
  blueBorder: 'rgba(14,165,233,0.2)',
  text:       '#F0F8FF',
  muted:      '#6B8BA4',
};

// ─── Workout content ──────────────────────────────────────────────────────────

const WARM_UP = [
  { name: 'Arm Circles',             detail: '15 each side' },
  { name: 'Standing Russian Twist',  detail: '15 each side' },
  { name: 'Leg Swing',               detail: '15 each side' },
  { name: 'Toe Touch, Sky Touch',    detail: '15 reps'      },
];

const WORKOUT = [
  { name: 'Neutral Grip Shoulder Press', detail: '10 reps' },
  { name: 'DB Deadlift',                 detail: '10 reps' },
  { name: 'Hammer Curl',                 detail: '10 reps' },
  { name: 'Overhead Tricep Extension',   detail: '10 reps' },
  { name: 'Arm / DB Swing',             detail: '20 reps' },
];

const STRETCH = [
  { name: 'Snow Angels',      detail: 'Hold & breathe' },
  { name: 'Knees Into Chest', detail: 'Hold & breathe' },
  { name: 'Abs Stretch',      detail: 'Hold & breathe' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

// ─── Event time helpers ───────────────────────────────────────────────────────

// Returns 7:00pm EDT (23:00 UTC) on the given date string (YYYY-MM-DD)
function getEventTime(dayThreeDateStr: string): Date {
  const d = new Date(`${dayThreeDateStr}T23:00:00Z`);
  return d;
}

type EventPhase = 'pre' | 'live' | 'post';

function getEventPhase(eventTime: Date): EventPhase {
  const now = Date.now();
  const start = eventTime.getTime();
  const end = start + 1 * 60 * 60 * 1000; // 1-hour live window (7–8pm EST)
  if (now < start) return 'pre';
  if (now <= end) return 'live';
  return 'post';
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00:00';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── MARK_COMPLETE_DELAY ──────────────────────────────────────────────────────

const COMPLETE_DELAY_MS = 20 * 60 * 1000; // 20 minutes

// ─── VideoWithProcessingFallback ─────────────────────────────────────────────

type VideoFallbackProps = {
  uri: string;
  style: object;
  onPlaybackStatusUpdate: (status: AVPlaybackStatus) => void;
};

function VideoWithProcessingFallback({ uri, style, onPlaybackStatusUpdate }: VideoFallbackProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }]}>
        <Text style={{ color: '#6B8BA4', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 }}>
          Recording is still being processed.{'\n'}Check back in a few minutes.
        </Text>
      </View>
    );
  }

  return (
    <Video
      source={{ uri }}
      style={style}
      resizeMode={ResizeMode.CONTAIN}
      useNativeControls
      shouldPlay
      onError={() => setFailed(true)}
      onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
        if (!status.isLoaded && status.error) {
          setFailed(true);
          return;
        }
        onPlaybackStatusUpdate(status);
      }}
    />
  );
}

// ─── WalkWaterFinaleScreen ────────────────────────────────────────────────────

export default function WalkWaterFinaleScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<WalkWaterStackParamList>>();
  const route = useRoute<RouteProp<WalkWaterStackParamList, 'Finale'>>();

  const [phase, setPhase] = useState<EventPhase>('pre');
  const [countdown, setCountdown] = useState('');
  const [eventTime, setEventTime] = useState<Date | null>(null);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(false);
  const [elapsed, setElapsed] = useState(0);           // ms on screen
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [planStepGoal, setPlanStepGoal] = useState(8000);
  const [planChallengeDays, setPlanChallengeDays] = useState(3);
  const [waterGlasses, setWaterGlasses] = useState(0);
  const [streak, setStreak] = useState(0);
  const [recordingVisible, setRecordingVisible] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingTitle, setRecordingTitle] = useState('Coach Josh Live Group Workout');
  const [loadingRecording, setLoadingRecording] = useState(false);
  const [recordingWatchedMs, setRecordingWatchedMs] = useState(0);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [evergreenReady, setEvergreenReady] = useState(false);
  const recordingWatchCreditRef = useRef(0);
  const lastPlaybackPositionRef = useRef<number | null>(null);
  const lastPlaybackTickRef = useRef<number | null>(null);

  const elapsedRef = useRef(0);
  const entryTime = useRef(Date.now());
  const displayName = (session?.user?.user_metadata?.display_name as string | undefined) ?? 'You';
  const firstName = displayName.split(' ')[0];
  const { steps: healthSteps } = useHealth();

  // Compute event time from plan start date
  useEffect(() => {
    (async () => {
      const [plan, currentStreak, waterOz] = await Promise.all([
        getWalkWaterPlan(),
        getWalkWaterStreak(),
        getWaterOzToday(),
      ]);
      if (!plan) return;
      const day3 = new Date(plan.startDate);
      day3.setDate(day3.getDate() + 2); // day 1 = start, day 3 = start + 2
      const iso = day3.toISOString().slice(0, 10);
      setEventTime(getEventTime(iso));
      setPlanStepGoal(plan.dailyStepGoal);
      setPlanChallengeDays(plan.challengeDays);
      setWaterGlasses(Math.round(waterOz / 8));
      setStreak(currentStreak);
    })();
  }, []);

  useEffect(() => {
    fetchEvergreenReplaySession()
      .then((session) => {
        if (session?.videoUrl) {
          setRecordingUrl(session.videoUrl);
          setRecordingTitle(session.title || 'Coach Josh Live Group Workout');
        }
      })
      .finally(() => setEvergreenReady(true));
  }, []);

  // Clock tick — updates countdown + phase, and elapsed timer
  useEffect(() => {
    const tick = setInterval(() => {
      if (eventTime) {
        const p = getEventPhase(eventTime);
        setPhase(p);
        if (p === 'pre') {
          setCountdown(formatCountdown(eventTime.getTime() - Date.now()));
        }
      }
      elapsedRef.current = Date.now() - entryTime.current;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(tick);
  }, [eventTime]);

  // Check for active LiveKit session when phase is live
  const checkLiveSession = useCallback(async () => {
    setCheckingSession(true);
    try {
      const session = await fetchActiveSession();
      setLiveSessionId(session?.id ?? null);
    } catch {
      setLiveSessionId(null);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    if (phase !== 'live' || planChallengeDays > 3) return;

    checkLiveSession();

    const ch = supabase
      .channel('finale-live-watcher')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tribe_live_sessions' }, () => {
        checkLiveSession();
      })
      .subscribe();

    const poll = setInterval(checkLiveSession, 30_000);

    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
    };
  }, [phase, planChallengeDays, checkLiveSession]);

  // Auto-navigate to live stream as soon as a session is available
  useEffect(() => {
    if (activePhase === 'live' && liveSessionId && planChallengeDays <= 3) {
      navigation.navigate('TribeLiveViewer', { sessionId: liveSessionId });
    }
  }, [activePhase, liveSessionId, navigation, planChallengeDays]);

  // Auto-unlock after 20 min — no tap required
  useEffect(() => {
    if (!alreadyDone && elapsed >= COMPLETE_DELAY_MS) {
      setGroupWorkoutDone()
        .then(() => {
          setAlreadyDone(true);
          cancelWorkoutUnlockNotification();
        })
        .catch(() => null);
    }
  }, [elapsed, alreadyDone]);

  const handleMarkComplete = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await setGroupWorkoutDone();
    setAlreadyDone(true);
    // Navigate back to home so the upgrade banner appears
    navigation.navigate('WalkWaterTabs');
  }, [completing, navigation]);

  const openReplayModal = useCallback((nextUrl?: string | null, nextTitle?: string) => {
    const urlToOpen = nextUrl ?? recordingUrl;
    if (!urlToOpen) return;
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false }).catch(() => null);
    recordingWatchCreditRef.current = 0;
    lastPlaybackPositionRef.current = null;
    lastPlaybackTickRef.current = null;
    setRecordingWatchedMs(0);
    setRecordingDurationMs(0);
    if (nextUrl) setRecordingUrl(nextUrl);
    if (nextTitle) setRecordingTitle(nextTitle);
    setRecordingVisible(true);
  }, [recordingUrl]);

  const handleJoinLive = useCallback(() => {
    if (planChallengeDays > 3 && recordingUrl) {
      openReplayModal();
      return;
    }
    if (liveSessionId) {
      // Challenge is complete — cancel daily reminders and fire the reward notification
      cancelWalkWaterNotifications().catch(() => null);
      scheduleWorkoutUnlockNotification().catch(() => null);
      navigation.navigate('TribeLiveViewer', { sessionId: liveSessionId });
    }
  }, [liveSessionId, navigation, planChallengeDays, recordingUrl, openReplayModal]);

  const handleWatchRecording = useCallback(async () => {
    if (recordingUrl) {
      openReplayModal();
      return;
    }
    setLoadingRecording(true);
    try {
      const evergreen = await fetchEvergreenReplaySession();
      if (evergreen?.videoUrl) {
        openReplayModal(evergreen.videoUrl, evergreen.title || 'Coach Josh Live Group Workout');
      }
    } finally {
      setLoadingRecording(false);
    }
  }, [recordingUrl, openReplayModal]);

  const devPhase = route.params?.devPhase ?? null;
  const activePhase: EventPhase = devPhase ?? phase;

  const canComplete = alreadyDone || (activePhase === 'post' ? recordingWatchedMs >= COMPLETE_DELAY_MS : elapsed >= COMPLETE_DELAY_MS);

  const [leaderboard, setLeaderboard] = useState<Array<{ name: string; steps: number; water: number; streak: number }>>([]);

  useEffect(() => {
    if (waterGlasses === 0 && streak === 0) return;
    (async () => {
      const walkTotals = await getDailyWalkTotals().catch(() => ({ steps: 0 }));
      const actualSteps = Math.max(healthSteps, walkTotals.steps);
      await upsertMyStats(actualSteps, waterGlasses, streak, displayName).catch(() => null);
      const entries = await fetchLeaderboard().catch(() => [] as LeaderboardEntry[]);
      setLeaderboard(
        entries.slice(0, 3).map((e) => ({
          name: e.isMe ? `${e.username} · You` : e.username,
          steps: e.steps,
          water: e.waterGlasses,
          streak: e.streak,
        })),
      );
    })();
  }, [waterGlasses, streak, healthSteps]);

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Back ── */}
      <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      {/* ── Header ── */}
      <View style={styles.headerBlock}>
        {activePhase === 'live' ? (
          <>
            <View style={styles.liveHeaderRow}>
              <View style={styles.livePulse} />
              <Text style={styles.liveHeaderEyebrow}>LIVE NOW</Text>
            </View>
            <Text style={styles.title}>Coach Josh is{'\n'}live right now 🔴</Text>
            <Text style={styles.subtitle}>Join below, train with the group, and comment live.</Text>
          </>
        ) : activePhase === 'post' ? (
          <>
            <Text style={styles.eyebrow}>DAY 3 · MISSED IT?</Text>
            <Text style={styles.title}>Watch the{'\n'}Recording 📹</Text>
            <Text style={styles.subtitle}>Complete the workout below to unlock your reward.</Text>
          </>
        ) : (
          <>
            <Text style={styles.eyebrow}>DAY 3 · FINAL DAY</Text>
            <Text style={styles.title}>Group Workout{'\n'}Finale 🏆</Text>
            <Text style={styles.subtitle}>Complete this workout to unlock your reward.</Text>
          </>
        )}
      </View>

      {/* ── Event status card ── */}
      <View style={[
        styles.eventCard,
        activePhase === 'live' ? styles.eventCardLive : activePhase === 'post' ? styles.eventCardPost : styles.eventCardPre,
      ]}>
        {activePhase === 'pre' && (
          <>
            <Text style={styles.eventEyebrow}>STARTS IN</Text>
            <Text style={styles.eventCountdown}>{countdown || '—'}</Text>
            <Text style={styles.eventTime}>Today at {eventTime ? eventTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '—'}</Text>
            <Text style={styles.eventNote}>Tune in live inside the app — no Zoom, no Facebook needed.</Text>
          </>
        )}

        {activePhase === 'live' && (
          <>
            <View style={styles.liveRow}>
              <View style={styles.livePulse} />
              <Text style={styles.liveLabel}>LIVE NOW</Text>
            </View>
            <Text style={styles.eventTime}>Coach Josh's group workout is happening right now</Text>
            {planChallengeDays > 3 ? (
              recordingUrl ? (
                <Pressable style={styles.joinBtn} onPress={handleJoinLive}>
                  <Text style={styles.joinBtnText}>Join Live Workout →</Text>
                </Pressable>
              ) : evergreenReady ? (
                <Text style={styles.eventNote}>The live replay is being prepared. Check back in a moment.</Text>
              ) : (
                <ActivityIndicator color={WW.amber} style={{ marginTop: 12 }} />
              )
            ) : checkingSession ? (
              <ActivityIndicator color={WW.amber} style={{ marginTop: 12 }} />
            ) : liveSessionId ? (
              <Pressable style={styles.joinBtn} onPress={handleJoinLive}>
                <Text style={styles.joinBtnText}>Join Coach Josh Live →</Text>
              </Pressable>
            ) : (
              <Text style={styles.eventNote}>Coach Josh is getting the room ready. Check back in a moment.</Text>
            )}
          </>
        )}

        {activePhase === 'post' && (
          <>
            <Text style={styles.eventEyebrow}>MISSED IT?</Text>
            <Text style={styles.eventTime}>Watch the recording and complete the workout</Text>
            <Pressable style={styles.recordingBtn} onPress={handleWatchRecording}>
              <Text style={styles.recordingBtnText}>{loadingRecording ? 'Loading recording…' : '▶  Watch Recording'}</Text>
            </Pressable>
            <Text style={styles.eventNote}>
              {recordingWatchedMs > 0
                ? `${formatCountdown(COMPLETE_DELAY_MS - recordingWatchedMs)} left before “I Completed the Workout” unlocks.`
                : 'Watch 20 minutes of the replay to unlock the completion button.'}
            </Text>
          </>
        )}
      </View>

      {/* ── Warm-Up ── */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>🔥 Warm-Up</Text>
        {WARM_UP.map((ex) => (
          <View key={ex.name} style={styles.exerciseRow}>
            <Text style={styles.exerciseName}>{ex.name}</Text>
            <Text style={styles.exerciseDetail}>{ex.detail}</Text>
          </View>
        ))}
      </View>

      {/* ── Workout ── */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>💪 Workout</Text>
        <View style={styles.roundBadgeRow}>
          <View style={styles.roundBadge}><Text style={styles.roundBadgeText}>3 ROUNDS</Text></View>
          <View style={styles.roundBadge}><Text style={styles.roundBadgeText}>45 SEC REST</Text></View>
        </View>
        {WORKOUT.map((ex) => (
          <View key={ex.name} style={styles.exerciseRow}>
            <Text style={styles.exerciseName}>{ex.name}</Text>
            <Text style={styles.exerciseDetail}>{ex.detail}</Text>
          </View>
        ))}
      </View>

      {/* ── Stretch ── */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>🧘 Stretch</Text>
        <Text style={styles.stretchNote}>Stretch walkthrough included in the live session.</Text>
        {STRETCH.map((ex) => (
          <View key={ex.name} style={styles.exerciseRow}>
            <Text style={styles.exerciseName}>{ex.name}</Text>
            <Text style={styles.exerciseDetail}>{ex.detail}</Text>
          </View>
        ))}
      </View>

      {/* ── Leaderboard preview ── */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>🏆 Leaderboard</Text>
        <Text style={styles.leaderboardSub}>Winner announced live — who's going to take it?</Text>
        {leaderboard.map((entry, i) => (
          <View key={entry.name} style={styles.leaderRow}>
            <Text style={styles.leaderMedal}>{MEDALS[i]}</Text>
            <View style={styles.leaderInfo}>
              <Text style={styles.leaderName}>{entry.name}</Text>
              <Text style={styles.leaderStats}>
                {entry.steps.toLocaleString()} steps · {entry.water} glasses · {entry.streak}d streak
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── Mark Complete ── */}
      <View style={styles.completeBlock}>
        {!alreadyDone && !canComplete && (
          <Text style={styles.completeHint}>
            Complete the workout to unlock your reward.{'\n'}
            {activePhase === 'post' ? 'Button unlocks after 20 minutes of replay watch time.' : 'Button available after 20 minutes.'}
          </Text>
        )}
        {!alreadyDone && canComplete && (
          <Pressable
            style={[styles.completeBtn, completing && { opacity: 0.6 }]}
            onPress={handleMarkComplete}
            disabled={completing}
          >
            <Text style={styles.completeBtnText}>
              {completing ? 'Unlocking…' : 'I Completed the Workout ✓'}
            </Text>
          </Pressable>
        )}
        {alreadyDone && (
          <View style={styles.completeDone}>
            <Text style={styles.completeDoneText}>✅  Workout complete — your reward is unlocked!</Text>
          </View>
        )}
      </View>

      <Modal
        visible={recordingVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setRecordingVisible(false)}
      >
        <ScrollView
          style={[styles.recordingModal, { paddingTop: insets.top }]}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.recordingModalInner}>
            <View style={styles.recordingHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.recordingEyebrow}>DAY 3 REPLAY</Text>
                <Text style={styles.recordingTitle}>{recordingTitle}</Text>
              </View>
              <Pressable style={styles.recordingCloseBtn} onPress={() => setRecordingVisible(false)}>
                <Text style={styles.recordingCloseText}>Done</Text>
              </Pressable>
            </View>

            {recordingUrl ? (
              <VideoWithProcessingFallback
                uri={recordingUrl}
                style={styles.recordingVideo}
                onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                  if (!status.isLoaded) return;
                  setRecordingDurationMs(status.durationMillis ?? 0);
                  const now = Date.now();
                  const position = status.positionMillis ?? 0;
                  const lastPosition = lastPlaybackPositionRef.current;
                  const lastTick = lastPlaybackTickRef.current;

                  if (status.isPlaying && !status.isBuffering && lastPosition != null && lastTick != null) {
                    const wallDelta = Math.max(0, now - lastTick);
                    const positionDelta = position - lastPosition;

                    // Only credit plausible forward playback. Large jumps are
                    // treated as scrubs and do not count toward the unlock timer.
                    if (positionDelta > 0 && positionDelta <= wallDelta + 1500) {
                      const credit = Math.min(wallDelta, positionDelta);
                      const nextCredit = Math.min(COMPLETE_DELAY_MS, recordingWatchCreditRef.current + credit);
                      if (nextCredit !== recordingWatchCreditRef.current) {
                        recordingWatchCreditRef.current = nextCredit;
                        setRecordingWatchedMs(nextCredit);
                      }
                    }
                  }

                  lastPlaybackPositionRef.current = position;
                  lastPlaybackTickRef.current = now;
                }}
              />
            ) : (
              <View style={styles.recordingUnavailable}>
                <Text style={styles.recordingUnavailableText}>Recording not available yet.</Text>
              </View>
            )}

            <View style={styles.recordingProgressCard}>
              <Text style={styles.recordingProgressLabel}>Replay watch progress</Text>
              <Text style={styles.recordingProgressValue}>
                {formatCountdown(recordingWatchedMs)} / {formatCountdown(COMPLETE_DELAY_MS)}
              </Text>
              <Text style={styles.recordingProgressSub}>
                Once you watch 20 minutes, the completion button on this screen unlocks.
              </Text>
              {recordingDurationMs > 0 ? (
                <Text style={styles.recordingMetaText}>
                  Full recording length: {formatCountdown(recordingDurationMs)}
                </Text>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: WW.black },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 16 },

  backBtn:  { paddingVertical: 4, alignSelf: 'flex-start' },
  backText: { fontSize: 14, color: WW.muted, fontWeight: '600' },

  devBar:          { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  devLabel:        { fontSize: 9, color: WW.muted, fontWeight: '800', letterSpacing: 1.4, marginRight: 4 },
  devPill:         { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'transparent' },
  devPillActive:   { backgroundColor: WW.amber, borderColor: WW.amber },
  devPillText:     { fontSize: 11, color: WW.muted, fontWeight: '700' },
  devPillTextActive: { color: WW.black },

  liveHeaderRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  liveHeaderEyebrow:{ fontSize: 9, color: '#EF4444', fontWeight: '800', letterSpacing: 1.8 },

  headerBlock: { gap: 6, marginTop: 8 },
  eyebrow:     { fontSize: 9, color: WW.amber, fontWeight: '800', letterSpacing: 1.8 },
  title:       { fontSize: 28, color: WW.text, fontWeight: '900', letterSpacing: -0.5, lineHeight: 34 },
  subtitle:    { fontSize: 13, color: WW.muted, fontWeight: '500' },

  // Event card variants
  eventCard: {
    borderRadius: 16, padding: 18, borderWidth: 1.5, gap: 8,
  },
  eventCardPre:  { backgroundColor: WW.amberSoft,              borderColor: WW.amberBorder },
  eventCardLive: { backgroundColor: 'rgba(239,68,68,0.08)',     borderColor: 'rgba(239,68,68,0.35)' },
  eventCardPost: { backgroundColor: 'rgba(14,165,233,0.06)',    borderColor: WW.blueBorder },

  eventEyebrow:  { fontSize: 9, color: WW.amber, fontWeight: '800', letterSpacing: 1.5 },
  eventCountdown:{ fontSize: 40, color: WW.amber, fontWeight: '900', letterSpacing: -1 },
  eventTime:     { fontSize: 14, color: WW.text, fontWeight: '700' },
  eventNote:     { fontSize: 12, color: WW.muted, fontWeight: '500', lineHeight: 18 },

  liveRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  livePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
  liveLabel: { fontSize: 11, color: '#EF4444', fontWeight: '800', letterSpacing: 1.5 },

  joinBtn: {
    backgroundColor: '#EF4444', borderRadius: 12,
    paddingVertical: 13, alignItems: 'center', marginTop: 4,
  },
  joinBtnText: { fontSize: 15, color: '#fff', fontWeight: '800' },

  recordingBtn: {
    backgroundColor: WW.blueSoft, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4,
  },
  recordingBtnText: { fontSize: 14, color: WW.blue, fontWeight: '700' },
  recordingModal: { flex: 1, backgroundColor: WW.black },
  recordingModalInner: { paddingHorizontal: 16, gap: 16 },
  recordingHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  recordingEyebrow: { fontSize: 9, color: WW.blue, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4 },
  recordingTitle: { fontSize: 18, color: WW.text, fontWeight: '800' },
  recordingCloseBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  recordingCloseText: { color: WW.blue, fontWeight: '700', fontSize: 14 },
  recordingVideo: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000', borderRadius: 16, overflow: 'hidden' },
  recordingUnavailable: {
    width: '100%',
    aspectRatio: 9 / 16,
    borderRadius: 16,
    backgroundColor: WW.card,
    borderWidth: 1,
    borderColor: WW.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingUnavailableText: { color: WW.muted, fontSize: 14, fontWeight: '600' },
  recordingProgressCard: {
    backgroundColor: WW.card,
    borderWidth: 1,
    borderColor: WW.blueBorder,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  recordingProgressLabel: { fontSize: 10, color: WW.muted, fontWeight: '700', letterSpacing: 1.2 },
  recordingProgressValue: { fontSize: 22, color: WW.blue, fontWeight: '900', letterSpacing: -0.4 },
  recordingProgressSub: { fontSize: 12, color: WW.muted, lineHeight: 18 },
  recordingMetaText: { fontSize: 12, color: WW.text, fontWeight: '600', marginTop: 4 },

  sectionCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 16, padding: 16, gap: 10,
  },
  sectionTitle: { fontSize: 15, color: WW.text, fontWeight: '800', marginBottom: 2 },

  roundBadgeRow: { flexDirection: 'row', gap: 8 },
  roundBadge: {
    backgroundColor: 'rgba(14,165,233,0.1)', borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  roundBadgeText: { fontSize: 9, color: WW.blue, fontWeight: '800', letterSpacing: 1.2 },

  exerciseRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: WW.border,
  },
  exerciseName:   { fontSize: 14, color: WW.text, fontWeight: '600', flex: 1 },
  exerciseDetail: { fontSize: 12, color: WW.muted, fontWeight: '600' },
  stretchNote:    { fontSize: 12, color: WW.muted, fontWeight: '500', fontStyle: 'italic' },

  stretchVideoBtn: {
    backgroundColor: 'rgba(6,182,212,0.08)', borderWidth: 1,
    borderColor: 'rgba(6,182,212,0.25)', borderRadius: 10,
    paddingVertical: 10, alignItems: 'center', marginTop: 4,
  },
  stretchVideoBtnText: { fontSize: 13, color: '#06B6D4', fontWeight: '700' },

  leaderboardSub: { fontSize: 12, color: WW.muted, marginBottom: 4 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: WW.border,
  },
  leaderMedal: { fontSize: 22 },
  leaderInfo:  { flex: 1 },
  leaderName:  { fontSize: 14, color: WW.text, fontWeight: '700' },
  leaderStats: { fontSize: 11, color: WW.muted, marginTop: 2 },

  completeBlock: { alignItems: 'center', gap: 12, paddingTop: 8 },
  completeHint:  { fontSize: 13, color: WW.muted, textAlign: 'center', lineHeight: 20 },
  completeBtn: {
    backgroundColor: WW.amber, borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center', width: '100%',
  },
  completeBtnText: { fontSize: 16, color: '#000', fontWeight: '900' },
  completeDone: {
    backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, width: '100%', alignItems: 'center',
  },
  completeDoneText: { fontSize: 14, color: '#22C55E', fontWeight: '700' },
});
