/**
 * WalkTrackerScreen
 *
 * Features:
 * - Live tracking: distance (miles), time, calories, pace
 * - Calories predicted from MET even when screen is off
 * - All-time records, AI suggestion, walking badges (pre-walk)
 * - Post-walk celebration modal with animated confetti
 * - 9:16 story card captured with ViewShot → share to Instagram, TikTok,
 *   Facebook, and any other app via the native share sheet
 * - Post to in-app Tribe feed
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { WALK_LOCATION_TASK, WALK_LIVE_POINTS_KEY } from '@/tasks/walkLocationTask';
import MapView, { Marker, Polyline } from 'react-native-maps';
import ViewShot from 'react-native-view-shot';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { apexColors as C } from '@/theme/colors';
import { env } from '@/lib/env';
import { getSelectedCoachVoice } from '@/lib/coachVoice';
import { speakWithElevenLabs } from '@/lib/elevenlabs';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import {
  checkWalkStreakMilestone,
  estimateCalories,
  getCompletedWalks,
  getWalkAllTimeRecords,
  getWalkStreak,
  getWalkSuggestion,
  saveCompletedWalk,
  type CompletedWalk,
  type WalkAllTimeRecords,
} from '@/lib/walkRecords';
import { addTextPostToFeed } from '@/lib/tribeFeed';
import { appendInAppNotification } from '@/lib/inAppNotifications';
import { supabase } from '@/lib/supabase';
import { isWalkWaterModeEnabled, recordWWActivityToday } from '@/lib/walkWaterMode';

// ─── Screen / card dimensions ─────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_W = Math.min(330, SCREEN_WIDTH - 32);
const CARD_H = Math.round(CARD_W * (16 / 9)); // 9:16 portrait story ratio

// ─── Confetti ─────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = [
  '#00FF87', '#FF6B35', '#A855F7', '#3B82F6',
  '#FFD700', '#FF1493', '#00BFFF',
];

const PARTICLE_COUNT = 26;

// Generate stable configs once at module-init time
const PARTICLE_CFG = Array.from({ length: PARTICLE_COUNT }, () => ({
  xPct: Math.random(),                     // 0–1 of screen width
  color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  delay: Math.floor(Math.random() * 900),
  duration: 1400 + Math.floor(Math.random() * 700),
  size: 7 + Math.floor(Math.random() * 7),
  isRect: Math.random() > 0.45,
  drift: (Math.random() - 0.5) * 90,
}));

function ConfettiRain({ visible }: { visible: boolean }) {
  const anims = useRef(
    PARTICLE_CFG.map(() => ({
      y:       new Animated.Value(-30),
      opacity: new Animated.Value(0),
      rotate:  new Animated.Value(0),
    })),
  ).current;

  useEffect(() => {
    if (!visible) {
      anims.forEach((a) => { a.y.setValue(-30); a.opacity.setValue(0); a.rotate.setValue(0); });
      return;
    }

    // Reset before starting
    anims.forEach((a) => { a.y.setValue(-30); a.opacity.setValue(0); a.rotate.setValue(0); });

    const all = Animated.parallel(
      PARTICLE_CFG.map((cfg, i) =>
        Animated.sequence([
          Animated.delay(cfg.delay),
          Animated.parallel([
            Animated.timing(anims[i].y, {
              toValue: SCREEN_HEIGHT + 60,
              duration: cfg.duration,
              useNativeDriver: true,
              easing: Easing.linear,
            }),
            Animated.sequence([
              Animated.timing(anims[i].opacity, { toValue: 1,   duration: 120, useNativeDriver: true }),
              Animated.timing(anims[i].opacity, { toValue: 1,   duration: cfg.duration - 240, useNativeDriver: true }),
              Animated.timing(anims[i].opacity, { toValue: 0,   duration: 120, useNativeDriver: true }),
            ]),
            Animated.timing(anims[i].rotate, {
              toValue: 1,
              duration: cfg.duration,
              useNativeDriver: true,
              easing: Easing.linear,
            }),
          ]),
        ]),
      ),
    );

    all.start(() => {
      // Second lighter burst after 400ms
      anims.forEach((a) => { a.y.setValue(-30); a.rotate.setValue(0); a.opacity.setValue(0); });
      Animated.parallel(
        PARTICLE_CFG.map((cfg, i) =>
          Animated.sequence([
            Animated.delay(cfg.delay * 0.6 + 400),
            Animated.parallel([
              Animated.timing(anims[i].y, {
                toValue: SCREEN_HEIGHT + 60,
                duration: cfg.duration * 1.15,
                useNativeDriver: true,
                easing: Easing.linear,
              }),
              Animated.sequence([
                Animated.timing(anims[i].opacity, { toValue: 0.7, duration: 100, useNativeDriver: true }),
                Animated.timing(anims[i].opacity, { toValue: 0.7, duration: cfg.duration * 1.15 - 200, useNativeDriver: true }),
                Animated.timing(anims[i].opacity, { toValue: 0,   duration: 100, useNativeDriver: true }),
              ]),
              Animated.timing(anims[i].rotate, {
                toValue: 2,
                duration: cfg.duration * 1.15,
                useNativeDriver: true,
                easing: Easing.linear,
              }),
            ]),
          ]),
        ),
      ).start();
    });

    return () => all.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {PARTICLE_CFG.map((cfg, i) => {
        const rotateInterp = anims[i].rotate.interpolate({
          inputRange: [0, 2], outputRange: ['0deg', '1080deg'],
        });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              top: 0,
              left: cfg.xPct * SCREEN_WIDTH,
              width: cfg.size,
              height: cfg.isRect ? cfg.size * 2 : cfg.size,
              backgroundColor: cfg.color,
              borderRadius: cfg.isRect ? 2 : cfg.size / 2,
              opacity: anims[i].opacity,
              transform: [
                { translateY: anims[i].y },
                { translateX: cfg.drift },
                { rotate: rotateInterp },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

// ─── Story card (9:16, captured by ViewShot) ──────────────────────────────────

function StoryCard({
  walk,
  badges,
  streakMessage,
  isWW = false,
}: {
  walk: CompletedWalk | null;
  badges: string[];
  streakMessage: string | null;
  isWW?: boolean;
}) {
  if (!walk) return null;
  const distMi = (walk.distanceKm * 0.621371).toFixed(2);
  const steps  = Math.round(walk.distanceKm * 1312);
  const paceSec = walk.distanceKm > 0 ? walk.durationSeconds / (walk.distanceKm * 0.621371) : 0;
  const paceMin = Math.floor(paceSec / 60);
  const paceSecs = Math.round(paceSec % 60);
  const paceStr = walk.distanceKm > 0 ? `${paceMin}:${String(paceSecs).padStart(2, '0')}` : '--';
  const wwBlue = '#0EA5E9';
  const wwTeal = '#06B6D4';
  const accent = isWW ? wwBlue : C.orange;

  return (
    <View style={[sc.card, isWW && { backgroundColor: '#050A14' }]}>
      {/* Map route — fills top ~45% of card */}
      {walk.mapSnapshotUri ? (
        <View style={sc.mapWrap}>
          <Image source={{ uri: walk.mapSnapshotUri }} style={sc.mapImg} resizeMode="cover" />
          {/* Branding overlay on map */}
          <View style={sc.mapOverlay}>
            <Text style={[sc.brandText, { color: isWW ? wwBlue : C.green }]}>
              {isWW ? '💧 WALK + WATER' : '⚡ APEX FITNESS'}
            </Text>
          </View>
        </View>
      ) : (
        <View style={sc.topBrand}>
          <View style={[sc.brandGlow, isWW && { backgroundColor: 'rgba(14,165,233,0.25)' }]} />
          <Text style={[sc.brandText, isWW && { color: wwBlue }]}>
            {isWW ? '💧 WALK + WATER' : '⚡ APEX FITNESS'}
          </Text>
        </View>
      )}

      {/* Main content */}
      <View style={sc.main}>
        {!walk.mapSnapshotUri && <Text style={sc.emoji}>🎉</Text>}
        <Text style={[sc.title, walk.mapSnapshotUri && { fontSize: CARD_W * 0.09, marginBottom: 2 }]}>
          WALK COMPLETE
        </Text>

        {/* Stats — 4 boxes when map present, 3 without */}
        <View style={sc.statsRow}>
          <View style={sc.statBox}>
            <Text style={sc.statVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{distMi}</Text>
            <Text style={sc.statUnit}>mi</Text>
            <Text style={sc.statLbl}>DISTANCE</Text>
          </View>
          <View style={sc.statBox}>
            <Text style={sc.statVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatDuration(walk.durationSeconds)}</Text>
            <Text style={sc.statLbl}>TIME</Text>
          </View>
          <View style={sc.statBox}>
            <Text style={[sc.statVal, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{walk.caloriesBurned}</Text>
            <Text style={sc.statUnit}>kcal</Text>
            <Text style={sc.statLbl}>CALORIES</Text>
          </View>
          <View style={sc.statBox}>
            <Text style={[sc.statVal, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{paceStr}</Text>
            <Text style={sc.statUnit}>/mi</Text>
            <Text style={sc.statLbl}>PACE</Text>
          </View>
        </View>

        {/* Steps pill */}
        <View style={[sc.pill, { backgroundColor: isWW ? 'rgba(14,165,233,0.12)' : 'rgba(255,255,255,0.07)', borderColor: isWW ? 'rgba(14,165,233,0.3)' : 'rgba(255,255,255,0.15)' }]}>
          <Text style={[sc.pillText, { color: isWW ? wwTeal : C.text }]}>👟 {steps.toLocaleString()} steps</Text>
        </View>

        {/* Badge */}
        {badges.length > 0 && (
          <View style={[sc.pill, isWW && { backgroundColor: 'rgba(14,165,233,0.15)', borderColor: 'rgba(14,165,233,0.3)' }]}>
            <Text style={[sc.pillText, isWW && { color: wwBlue }]}>🏅 {badges[0]} — Badge Earned</Text>
          </View>
        )}

        {/* Streak milestone */}
        {streakMessage && (
          <View style={[sc.pill, isWW ? { backgroundColor: 'rgba(6,182,212,0.12)', borderColor: 'rgba(6,182,212,0.3)' } : sc.pillOrange]}>
            <Text style={[sc.pillText, { color: isWW ? wwTeal : C.orange }]}>🔥 {streakMessage}</Text>
          </View>
        )}
      </View>

      {/* Bottom branding */}
      <View style={sc.bottomBrand}>
        <View style={sc.divider} />
        <Text style={sc.brandSub}>Tracked with APEX</Text>
      </View>
    </View>
  );
}

const sc = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: '#080808',
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'space-between',
    paddingVertical: 26,
    paddingHorizontal: 20,
  },
  topBrand: { alignItems: 'center' },
  brandGlow: {
    position: 'absolute',
    width: CARD_W * 0.65,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,255,135,0.18)',
    // blur-like spread via shadow
    shadowColor: '#00ff87',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  brandText: { color: C.green, fontFamily: 'BebasNeue_400Regular', fontSize: 15, letterSpacing: 4 },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emoji: { fontSize: CARD_W * 0.14 },
  title: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: CARD_W * 0.13,
    letterSpacing: 3,
    textAlign: 'center',
    lineHeight: CARD_W * 0.145,
  },
  statsRow: { flexDirection: 'row', gap: 7, marginTop: 4, width: '100%' },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 9,
    alignItems: 'center',
  },
  statVal: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: CARD_W * 0.082 },
  statUnit: { color: '#777', fontFamily: 'SpaceMono_400Regular', fontSize: 8, marginTop: -2 },
  statLbl: { color: '#777', fontFamily: 'SpaceMono_400Regular', fontSize: 7.5, letterSpacing: 0.8, marginTop: 3 },
  pill: {
    backgroundColor: 'rgba(0,255,135,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.3)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillOrange: { backgroundColor: 'rgba(255,107,53,0.12)', borderColor: 'rgba(255,107,53,0.3)' },
  pillText: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 11 },
  bottomBrand: { alignItems: 'center', gap: 7 },
  divider: { width: 28, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  brandSub: { color: '#aaa', fontFamily: 'DMSans_400Regular', fontSize: 9.5, letterSpacing: 0.4 },
  // Negative margins break the map out of the card's paddingVertical/paddingHorizontal
  // so it sits flush with the card edges. overflow:hidden on sc.card clips it cleanly.
  mapWrap: { marginTop: -26, marginHorizontal: -20, height: CARD_H * 0.44, overflow: 'hidden' },
  mapImg: { width: CARD_W, height: CARD_H * 0.44 },
  mapOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: '#050A14',
    alignItems: 'center',
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Point = { latitude: number; longitude: number };

function distanceBetween(a: Point, b: Point) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) *
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude));
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtPace(distKm: number, seconds: number) {
  // Pace in min/mi
  const distMi = distKm * 0.621371;
  if (distMi < 0.03) return '--';
  const minPerMi = seconds / 60 / distMi;
  const m = Math.floor(minPerMi);
  const s = Math.round((minPerMi - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Walking badge definitions
const WALK_BADGE_DEFS: Array<{
  id: string;
  icon: string;
  name: string;
  description: string;
  metric: 'walkCount' | 'totalDistanceKm';
  target: number;
}> = [
  { id: 'first-steps',  icon: '👟', name: 'First Steps',  description: 'Complete your first walk',   metric: 'walkCount',       target: 1  },
  { id: 'mover',        icon: '🚶', name: 'Mover',        description: 'Complete 5 walks',           metric: 'walkCount',       target: 5  },
  { id: 'road-regular', icon: '🛤️', name: 'Road Regular', description: 'Complete 20 walks',          metric: 'walkCount',       target: 20 },
  { id: '5k-finisher',  icon: '🏅', name: '5K Finisher',  description: 'Walk 5 km total',            metric: 'totalDistanceKm', target: 5  },
  { id: 'half-century', icon: '🌍', name: 'Half Century', description: 'Walk 50 km total',           metric: 'totalDistanceKm', target: 50 },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function WalkTrackerScreen() {
  const navigation   = useNavigation<any>();
  const insets       = useSafeAreaInsets();
  const { t }        = useTranslation();
  const { session }  = useAuth();
  const { accent: themeAccent, accentSoft: themeAccentSoft, accentBorder: themeAccentBorder } = useTheme();
  const [isWW, setIsWW] = useState(false);
  useEffect(() => { isWalkWaterModeEnabled().then(setIsWW).catch(() => null); }, []);
  const activeBadgeDefs = useMemo(
    () => WALK_BADGE_DEFS.map((b) => (b.id === 'mover' && isWW ? { ...b, target: 3, description: 'Complete 3 walks' } : b)),
    [isWW],
  );
  const accent      = isWW ? '#0EA5E9' : themeAccent;
  const accentSoft  = isWW ? 'rgba(14,165,233,0.10)' : themeAccentSoft;
  const accentBorder = isWW ? 'rgba(14,165,233,0.25)' : themeAccentBorder;
  const hiColor     = isWW ? '#0EA5E9' : C.green;
  const hiColorSoft = isWW ? 'rgba(14,165,233,0.12)' : 'rgba(0,255,136,0.06)';
  const hiBorder    = isWW ? 'rgba(14,165,233,0.25)' : 'rgba(0,255,136,0.22)';
  const calColor    = isWW ? '#06B6D4' : C.orange;

  // ── tracking state ──
  const [isTracking,       setIsTracking]       = useState(false);
  const [points,           setPoints]           = useState<Point[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsedSeconds,   setElapsedSeconds]   = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Store the timestamp when tracking started — used to estimate calories
  // even when the timer was paused (screen off won't pause JS timer on iOS
  // background, but this acts as a fallback ground-truth).
  const startTimeRef = useRef<number>(0);

  // ── user weight + display name ──
  const [weightKg, setWeightKg] = useState(70);
  const [profileDisplayName, setProfileDisplayName] = useState('');

  // ── pre-walk data ──
  const [records,    setRecords]    = useState<WalkAllTimeRecords | null>(null);
  const [walkStreak, setWalkStreak] = useState(0);
  const [suggestion, setSuggestion] = useState('');
  const [coachVoiceName, setCoachVoiceName] = useState('Coach');
  const [coachSpeaking, setCoachSpeaking] = useState(false);

  // ── post-walk state ──
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [savedWalk,      setSavedWalk]      = useState<CompletedWalk | null>(null);
  const [newBadges,      setNewBadges]      = useState<string[]>([]);
  const [streakMsg,      setStreakMsg]      = useState<string | null>(null);
  const [isNewRecord,    setIsNewRecord]    = useState(false);
  const [posting,        setPosting]        = useState(false);
  const [sharing,        setSharing]        = useState(false);

  // ── recent walks (pre-walk screen) + past-walk sharing ──
  const [recentWalks,      setRecentWalks]      = useState<CompletedWalk[]>([]);
  const [pastShareWalk, setPastShareWalk] = useState<CompletedWalk | null>(null);
  const pastShareRef = useRef<ViewShot>(null);
  const mapRef = useRef<MapView>(null);
  const isSnapshottingRef = useRef(false);
  const [isSnapshotting, setIsSnapshotting] = useState(false);

  // ── celebration spring animation ──
  const celebScale   = useRef(new Animated.Value(0.7)).current;
  const celebOpacity = useRef(new Animated.Value(0)).current;

  // ── ViewShot ref for story card capture ──
  const storyCardRef = useRef<ViewShot>(null);

  // ─── Load profile + records on mount ────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [raw, rec, sug, streak, allWalks] = await Promise.all([
        AsyncStorage.getItem(PROFILE_STORAGE_KEY),
        getWalkAllTimeRecords(),
        getWalkSuggestion(),
        getWalkStreak(),
        getCompletedWalks(),
      ]);

      let cached: UserProfile | null = null;
      if (raw) {
        try {
          const p = JSON.parse(raw) as UserProfile;
          cached = p;
          const lbs = parseFloat(p.weightLbs);
          if (!isNaN(lbs) && lbs > 0) setWeightKg(lbs / 2.205);
          if (p.displayName) setProfileDisplayName(p.displayName);
        } catch { /* use default 70 kg */ }
      }

      // Refresh display name from Supabase so share content uses current name
      const userId = session?.user?.id;
      if (userId) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('display_name, username')
            .eq('user_id', userId)
            .single();
          const remoteName =
            (data as { display_name?: string | null; username?: string | null } | null)
              ?.display_name ?? null;
          if (remoteName) {
            setProfileDisplayName(remoteName);
            const merged: UserProfile = { ...(cached ?? ({} as UserProfile)), displayName: remoteName };
            await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(merged)).catch(() => null);
          }
        } catch { /* ignore */ }
      }

      setRecords(rec);
      setSuggestion(sug);
      setWalkStreak(streak);
      setRecentWalks(allWalks.slice(0, 5));
      getSelectedCoachVoice().then((voice) => setCoachVoiceName(voice.label)).catch(() => null);
    };
    load().catch(() => {});
  }, []);

  // ── Celebration spring when modal opens ──
  useEffect(() => {
    if (summaryVisible) {
      celebScale.setValue(0.7);
      celebOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(celebScale, { toValue: 1, useNativeDriver: true, tension: 55, friction: 7 }),
        Animated.timing(celebOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [summaryVisible, celebScale, celebOpacity]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      Location.hasStartedLocationUpdatesAsync(WALK_LOCATION_TASK)
        .then((running) => { if (running) Location.stopLocationUpdatesAsync(WALK_LOCATION_TASK).catch(() => null); })
        .catch(() => null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Computed values ─────────────────────────────────────────────────────
  const totalDistanceKm = useMemo(
    () => points.slice(1).reduce((s, pt, i) => s + distanceBetween(points[i], pt), 0),
    [points],
  );

  // Use wall-clock time for calorie estimate so it stays accurate
  // even if the screen turns off (React Native JS timer on iOS continues
  // when AppState is active; we seed from startTimeRef as ground truth).
  const caloriesBurned = useMemo(
    () => estimateCalories(elapsedSeconds, weightKg),
    [elapsedSeconds, weightKg],
  );

  const distanceMi = totalDistanceKm * 0.621371;

  const region = useMemo(() => {
    const fallback = { latitude: 33.4484, latitudeDelta: 0.01, longitude: -112.074, longitudeDelta: 0.01 };
    if (!points.length) return fallback;
    const l = points[points.length - 1];
    return { ...fallback, latitude: l.latitude, longitude: l.longitude };
  }, [points]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleStart = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Foreground permission — required before anything else
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location needed', 'Allow location access to track your walk on the map.');
      return;
    }

    // Background permission — keeps tracking alive when the screen locks.
    // Only request if not already determined to avoid a second dialog on users
    // who already chose "While Using App" — they see a settings-redirect instead.
    const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
    if (bgStatus === 'undetermined') {
      await Location.requestBackgroundPermissionsAsync();
    } else if (bgStatus !== 'granted') {
      Alert.alert(
        'Background location needed',
        'To track your walk when the screen locks, go to Settings → APEX → Location and select "Always".',
      );
      return;
    }

    // Snapshot the starting point at high accuracy
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const initialPoint = { latitude: current.coords.latitude, longitude: current.coords.longitude };
    await AsyncStorage.setItem(WALK_LIVE_POINTS_KEY, JSON.stringify([initialPoint]));
    setPoints([initialPoint]);
    setElapsedSeconds(0);
    startTimeRef.current = Date.now();

    // Start the background location task — fires even when screen is off
    await Location.startLocationUpdatesAsync(WALK_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      distanceInterval: 1,      // record every 1 metre moved
      timeInterval: 2000,       // at most every 2 seconds
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Walk in progress',
        notificationBody: 'APEX is tracking your walk.',
        notificationColor: '#00FF88',
      },
    });

    // Poll AsyncStorage every 2 s to update the map polyline while on screen
    pollRef.current = setInterval(async () => {
      try {
        const raw = await AsyncStorage.getItem(WALK_LIVE_POINTS_KEY);
        if (raw) setPoints(JSON.parse(raw));
      } catch { /* ignore */ }
    }, 2000);

    // Wall-clock timer — accurate even when screen is off.
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    setIsTracking(true);
  };

  const handleStop = async () => {
    // Hide markers/user-dot so they don't appear in the share card snapshot,
    // then wait one frame for the MapView to re-render before capturing.
    let mapSnapshotUri: string | undefined;
    if (mapRef.current && points.length > 1) {
      try {
        isSnapshottingRef.current = true;
        setIsSnapshotting(true);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        mapSnapshotUri = await (mapRef.current as any).takeSnapshot({
          format: 'png', quality: 0.92, result: 'file',
        });
      } catch { /* snapshot is optional — proceed without it */ }
      isSnapshottingRef.current = false;
      setIsSnapshotting(false);
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(WALK_LOCATION_TASK);
      if (isRunning) await Location.stopLocationUpdatesAsync(WALK_LOCATION_TASK);
    } catch { /* ignore */ }

    // Flush the final points from AsyncStorage — these include any points
    // recorded while the screen was off that the poll interval missed.
    let finalPoints = points;
    try {
      const raw = await AsyncStorage.getItem(WALK_LIVE_POINTS_KEY);
      if (raw) finalPoints = JSON.parse(raw) as typeof points;
      await AsyncStorage.removeItem(WALK_LIVE_POINTS_KEY);
    } catch { /* ignore */ }
    setPoints(finalPoints);
    const finalDistanceKm = finalPoints.slice(1).reduce(
      (s, pt, i) => s + distanceBetween(finalPoints[i], pt), 0,
    );

    setIsTracking(false);

    // Use wall-clock elapsed time for the final calorie count
    const finalSeconds = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const finalCalories = estimateCalories(finalSeconds, weightKg);

    const finalizeWalk = async () => {
      const walk = await saveCompletedWalk({
        date: Date.now(),
        distanceKm: finalDistanceKm,
        durationSeconds: finalSeconds,
        caloriesBurned: finalCalories,
        mapSnapshotUri,
      });
      setSavedWalk(walk);

      // Count this walk as an active day for the WW streak badge.
      if (isWW) { recordWWActivityToday().catch(() => null); }

      const [newRec, newSug, newStreak, allWalks] = await Promise.all([
        getWalkAllTimeRecords(),
        getWalkSuggestion(),
        getWalkStreak(),
        getCompletedWalks(),
      ]);
      const milestoneMsg = await checkWalkStreakMilestone(newStreak);

      setRecords(newRec);
      setSuggestion(newSug);
      setWalkStreak(newStreak);
      setRecentWalks(allWalks.slice(0, 5));

      // Detect newly earned walk badges
      const totalWalks = allWalks.length;
      const totalDist  = allWalks.reduce((s, w) => s + w.distanceKm, 0);
      const earned: string[] = [];
      for (const badge of activeBadgeDefs) {
        const prev = badge.metric === 'walkCount' ? totalWalks - 1 : totalDist - walk.distanceKm;
        const curr = badge.metric === 'walkCount' ? totalWalks : totalDist;
        if (prev < badge.target && curr >= badge.target) {
          earned.push(`${badge.icon} ${badge.name}`);
          await appendInAppNotification({
            icon: badge.icon,
            text: `Walking badge unlocked: "${badge.name}" — ${badge.description}`,
            createdAt: Date.now(),
            read: false,
          });
        }
      }
      setNewBadges(earned);

      if (milestoneMsg) {
        setStreakMsg(milestoneMsg);
        await appendInAppNotification({
          icon: '🔥',
          text: milestoneMsg,
          createdAt: Date.now(),
          read: false,
        });
      } else {
        setStreakMsg(null);
      }

      const prevBest = records?.bestDistanceKm ?? 0;
      setIsNewRecord(walk.distanceKm > prevBest && (records?.totalWalks ?? 0) > 0);
      setSummaryVisible(true);
    };

    if (finalDistanceKm < 0.01 && finalSeconds < 30) {
      Alert.alert(
        'Save this short walk?',
        'This walk was very short. Do you still want to save it and open the completion screen?',
        [
          {
            text: 'Discard',
            style: 'cancel',
            onPress: () => {
              setPoints([]);
              setElapsedSeconds(0);
            },
          },
          {
            text: 'Save Walk',
            onPress: () => {
              finalizeWalk().catch(() => {
                Alert.alert('Error', 'Could not save this walk. Try again.');
              });
            },
          },
        ],
      );
      return;
    }

    await finalizeWalk();
  };

  const handleShareStory = async () => {
    if (!storyCardRef.current) return;
    setSharing(true);
    try {
      const uri = await storyCardRef.current.capture!();
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: 'Share your walk story',
        });
      } else {
        Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
      }
    } catch {
      Alert.alert('Share failed', 'Could not capture the story card. Try again.');
    } finally {
      setSharing(false);
    }
  };

  const handleShareToTribe = async () => {
    if (!savedWalk) return;
    setPosting(true);
    try {
      const author = profileDisplayName || session?.user?.email?.split('@')[0] || 'Walker';
      const mi     = (savedWalk.distanceKm * 0.621371).toFixed(2);
      const badgeStr = newBadges.length > 0 ? ` Unlocked: ${newBadges.join(', ')}.` : '';
      const body = `🚶 Just finished a ${mi} mi walk in ${formatDuration(savedWalk.durationSeconds)} — burned ~${savedWalk.caloriesBurned} cal.${badgeStr} #APEX`;

      if (isWW && session?.user?.id) {
        await supabase.from('ww_chat_messages').insert({
          user_id:      session.user.id,
          display_name: author,
          body,
        });
      } else {
        await addTextPostToFeed({ author, body, badgeType: 'win' });
      }
      Alert.alert('Posted!', 'Your walk has been shared to the Community feed.');
    } catch {
      Alert.alert('Error', 'Could not post to Community. Try again.');
    } finally {
      setPosting(false);
    }
  };

  const handleDone = () => {
    setSummaryVisible(false);
    setPoints([]);
    setElapsedSeconds(0);
    setSavedWalk(null);
    setNewBadges([]);
    setStreakMsg(null);
    setIsNewRecord(false);
  };

  // ── Past-walk sharing ─────────────────────────────────────────────────────

  const handleOpenPastShare = (walk: CompletedWalk) => {
    // Set the walk so the hidden ViewShot can render it, then show action sheet
    setPastShareWalk(walk);
    // Small delay so the hidden StoryCard re-renders before possible capture
    setTimeout(() => {
      Alert.alert(
        'Share Walk',
        `${new Date(walk.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${(walk.distanceKm * 0.621371).toFixed(2)} mi`,
        [
          {
            text: '📸  Share to Social',
            onPress: () => {
              // capture and share
              pastShareRef.current?.capture?.()
                .then(async (uri) => {
                  const canShare = await Sharing.isAvailableAsync();
                  if (canShare) {
                    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your walk' });
                  }
                })
                .catch(() => Alert.alert('Share failed', 'Could not capture story card.'));
            },
          },
          {
            text: '📣  Post to Community',
            onPress: async () => {
              try {
                const author = profileDisplayName || session?.user?.email?.split('@')[0] || 'Walker';
                const mi = (walk.distanceKm * 0.621371).toFixed(2);
                const dateStr = new Date(walk.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                const body = `🚶 Walk from ${dateStr} — ${mi} mi in ${formatDuration(walk.durationSeconds)}, burned ~${walk.caloriesBurned} cal. #APEX`;

                if (isWW && session?.user?.id) {
                  await supabase.from('ww_chat_messages').insert({
                    user_id:      session.user.id,
                    display_name: author,
                    body,
                  });
                } else {
                  await addTextPostToFeed({ author, body, badgeType: 'win' });
                }
                Alert.alert('Posted!', 'Your walk has been shared to the Community feed.');
              } catch {
                Alert.alert('Error', 'Could not post to Community.');
              }
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    }, 80);
  };

  const handleSpeakSuggestion = async () => {
    if (!suggestion || coachSpeaking) return;
    setCoachSpeaking(true);
    await speakWithElevenLabs(suggestion, env.elevenLabsApiKey).catch(() => null);
    setCoachSpeaking(false);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: accent }]}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('walkTracker.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      {isTracking ? (
        /* ════════════════════════════════════════
           LIVE TRACKING
        ════════════════════════════════════════ */
        <>
          <MapView ref={mapRef} style={styles.map} region={region} showsUserLocation={!isSnapshotting}>
            {points.length > 0 && !isSnapshotting && <Marker coordinate={points[0]} />}
            {points.length > 1 && (
              <Polyline coordinates={points} strokeColor={accent} strokeWidth={6} />
            )}
          </MapView>

          <View style={styles.livePanel}>
            <View style={styles.metricGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricVal}>{distanceMi.toFixed(2)}</Text>
                <Text style={styles.metricUnit}>mi</Text>
                <Text style={styles.metricLbl}>DISTANCE</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricVal}>{formatDuration(elapsedSeconds)}</Text>
                <Text style={styles.metricLbl}>TIME</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={[styles.metricVal, { color: calColor }]}>{caloriesBurned}</Text>
                <Text style={styles.metricUnit}>kcal</Text>
                <Text style={styles.metricLbl}>CALORIES</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricVal}>{fmtPace(totalDistanceKm, elapsedSeconds)}</Text>
                <Text style={styles.metricUnit}>min/mi</Text>
                <Text style={styles.metricLbl}>PACE</Text>
              </View>
            </View>

            <Text style={styles.statusText}>{t('walkTracker.statusTracking')}</Text>

            <Pressable style={[styles.primaryBtn, styles.stopBtn, { backgroundColor: accent, borderColor: isWW ? accentBorder : undefined }]} onPress={handleStop}>
              <Text style={[styles.primaryText, styles.stopText, { color: isWW ? '#000' : undefined }]}>{t('walkTracker.stop')}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        /* ════════════════════════════════════════
           PRE-WALK START PAGE
        ════════════════════════════════════════ */
        <ScrollView
          style={styles.preScroll}
          contentContainerStyle={styles.preContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Walk streak banner */}
          {walkStreak >= 2 && (
            <View style={[styles.streakBanner, isWW && { backgroundColor: 'rgba(14,165,233,0.08)', borderColor: 'rgba(14,165,233,0.2)' }]}>
              <Text style={styles.streakBannerEmoji}>🔥</Text>
              <Text style={[styles.streakBannerText, isWW && { color: accent }]}>
                {walkStreak}-day walking streak — keep it going!
              </Text>
            </View>
          )}

          {/* AI Coach suggestion */}
          {suggestion.length > 0 && (
            <View style={[styles.suggestionCard, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
              <Text style={styles.suggestionIcon}>🤖</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.suggestionTitle, { color: accent }]}>{isWW ? 'WALK + WATER COACH' : `${coachVoiceName.toUpperCase()} · AI COACH`}</Text>
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </View>
              {!isWW && (
                <Pressable style={[styles.suggestionHearBtn, { borderColor: accent }]} onPress={handleSpeakSuggestion}>
                  <Text style={[styles.suggestionHearText, { color: accent }]}>{coachSpeaking ? '⏹' : '🔊'}</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* All-time records */}
          {records && records.totalWalks > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ALL-TIME RECORDS</Text>
              <View style={styles.recordRow}>
                <View style={styles.recordCard}>
                  <Text style={styles.recordVal}>
                    {(records.bestDistanceKm * 0.621371).toFixed(2)}
                  </Text>
                  <Text style={styles.recordUnit}>mi</Text>
                  <Text style={styles.recordLbl}>BEST WALK</Text>
                </View>
                <View style={styles.recordCard}>
                  <Text style={styles.recordVal}>{records.totalWalks}</Text>
                  <Text style={styles.recordLbl}>TOTAL WALKS</Text>
                </View>
                <View style={styles.recordCard}>
                  <Text style={[styles.recordVal, { color: calColor }]}>{records.mostCalories}</Text>
                  <Text style={styles.recordUnit}>kcal</Text>
                  <Text style={styles.recordLbl}>BEST BURN</Text>
                </View>
              </View>
              <View style={[styles.recordRow, { marginTop: 8 }]}>
                <View style={[styles.recordCard, { flex: 2 }]}>
                  <Text style={styles.recordVal}>
                    {(records.totalDistanceKm * 0.621371).toFixed(1)}
                  </Text>
                  <Text style={styles.recordUnit}>mi</Text>
                  <Text style={styles.recordLbl}>TOTAL DISTANCE</Text>
                </View>
                <View style={[styles.recordCard, { flex: 2 }]}>
                  <Text style={styles.recordVal}>{formatDuration(records.longestDurationSeconds)}</Text>
                  <Text style={styles.recordLbl}>LONGEST WALK</Text>
                </View>
              </View>
            </View>
          )}

          <Pressable style={[styles.primaryBtn, { backgroundColor: accent }]} onPress={handleStart}>
            <Text style={styles.primaryText}>{t('walkTracker.start')}</Text>
          </Pressable>

          {/* Walking badges */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>WALKING BADGES</Text>
            {(isWW ? activeBadgeDefs.filter((b) => b.id === 'first-steps' || b.id === 'mover') : activeBadgeDefs).map((badge) => {
              const progress =
                badge.metric === 'walkCount'
                  ? (records?.totalWalks ?? 0)
                  : (records?.totalDistanceKm ?? 0);
              const earned = progress >= badge.target;
              return (
                <View key={badge.id} style={[styles.badgeRow, earned && (isWW ? { borderColor: 'rgba(14,165,233,0.35)', backgroundColor: 'rgba(14,165,233,0.05)' } : styles.badgeRowEarned)]}>
                  <Text style={styles.badgeIcon}>{earned ? badge.icon : '🔒'}</Text>
                  <View style={styles.badgeInfo}>
                    <Text style={[styles.badgeName, earned && { color: hiColor }]}>
                      {badge.name}
                    </Text>
                    <Text style={styles.badgeDesc}>{badge.description}</Text>
                  </View>
                  {earned ? (
                    <Text style={[styles.badgeEarned, { color: hiColor }]}>EARNED</Text>
                  ) : (
                    <Text style={styles.badgeProgress}>
                      {badge.metric === 'totalDistanceKm'
                        ? `${Math.min(progress, badge.target).toFixed(1)}/${badge.target}`
                        : `${Math.min(progress, badge.target)}/${badge.target}`}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* ── Recent Walks ── */}
          {recentWalks.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>RECENT WALKS</Text>
              {recentWalks.map((walk) => {
                const mi = (walk.distanceKm * 0.621371).toFixed(2);
                const dateStr = new Date(walk.date).toLocaleDateString(undefined, {
                  weekday: 'short', month: 'short', day: 'numeric',
                });
                return (
                  <View key={walk.id} style={styles.recentWalkRow}>
                    <View style={styles.recentWalkInfo}>
                      <Text style={styles.recentWalkDate}>{dateStr}</Text>
                      <Text style={styles.recentWalkStats}>
                        {mi} mi · {formatDuration(walk.durationSeconds)} · {walk.caloriesBurned} kcal
                      </Text>
                    </View>
                    <Pressable
                      style={[styles.recentShareBtn, isWW && { backgroundColor: 'rgba(14,165,233,0.08)', borderColor: 'rgba(14,165,233,0.2)' }]}
                      onPress={() => handleOpenPastShare(walk)}
                    >
                      <Text style={[styles.recentShareBtnText, isWW && { color: accent }]}>Share</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ height: 28 }} />
        </ScrollView>
      )}

      {/* ════════════════════════════════════════
          POST-WALK CELEBRATION MODAL
      ════════════════════════════════════════ */}
      <Modal
        visible={summaryVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleDone}
      >
        <View style={[styles.modalRoot, { paddingTop: insets.top + 16 }]}>
          {/* Confetti rains over everything */}
          <ConfettiRain visible={summaryVisible} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.modalContent}
          >
            {/* Animated celebration header */}
            <Animated.View
              style={[
                styles.celebHeader,
                { opacity: celebOpacity, transform: [{ scale: celebScale }] },
              ]}
            >
              <Text style={styles.celebEmoji}>🎉</Text>
              <Text style={styles.celebTitle}>WALK COMPLETE!</Text>
              {isNewRecord && (
                <View style={styles.prBadge}>
                  <Text style={styles.prBadgeText}>🏆 NEW PERSONAL RECORD</Text>
                </View>
              )}
            </Animated.View>

            {/* Stat summary */}
            {savedWalk && (
              <View style={styles.summaryGrid}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryVal}>
                    {(savedWalk.distanceKm * 0.621371).toFixed(2)}
                  </Text>
                  <Text style={styles.summaryUnit}>mi</Text>
                  <Text style={styles.summaryLbl}>DISTANCE</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryVal}>{formatDuration(savedWalk.durationSeconds)}</Text>
                  <Text style={styles.summaryLbl}>DURATION</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={[styles.summaryVal, { color: calColor }]}>
                    {savedWalk.caloriesBurned}
                  </Text>
                  <Text style={styles.summaryUnit}>kcal</Text>
                  <Text style={styles.summaryLbl}>CALORIES</Text>
                </View>
              </View>
            )}

            {/* Streak milestone */}
            {streakMsg && (
              <View style={[styles.streakMilestoneBanner, isWW && { backgroundColor: 'rgba(14,165,233,0.08)', borderColor: accentBorder }]}>
                <Text style={[styles.streakMilestoneText, isWW && { color: accent }]}>🔥 {streakMsg}</Text>
              </View>
            )}

            {/* Newly earned badges */}
            {newBadges.length > 0 && (
              <View style={[styles.newBadgesCard, isWW && { backgroundColor: 'rgba(14,165,233,0.06)', borderColor: 'rgba(14,165,233,0.3)' }]}>
                <Text style={[styles.newBadgesTitle, isWW && { color: accent }]}>BADGES UNLOCKED</Text>
                {newBadges.map((b) => (
                  <Text key={b} style={styles.newBadgeItem}>{b}</Text>
                ))}
              </View>
            )}

            {/* ── Story card preview (captured by ViewShot) ── */}
            <Text style={styles.storyPreviewLabel}>STORY PREVIEW</Text>
            <View style={styles.storyPreviewWrap}>
              <ViewShot
                ref={storyCardRef}
                options={{ format: 'png', quality: 1.0, result: 'tmpfile' }}
              >
                <StoryCard walk={savedWalk} badges={newBadges} streakMessage={streakMsg} isWW={isWW} />
              </ViewShot>
            </View>

            {/* ── Platform share buttons ── */}
            <Text style={styles.shareLabel}>SHARE TO</Text>
            <View style={styles.platformGrid}>
              {[
                { label: 'Instagram', emoji: '📸', color: '#C13584' },
                { label: 'TikTok',    emoji: '🎵', color: '#69C9D0' },
                { label: 'Facebook',  emoji: '👥', color: '#1877F2' },
                { label: 'More',      emoji: '📤', color: C.muted   },
              ].map((p) => (
                <Pressable
                  key={p.label}
                  style={[styles.platformBtn, { borderColor: p.color + '55' }]}
                  onPress={handleShareStory}
                  disabled={sharing}
                >
                  <Text style={styles.platformEmoji}>{p.emoji}</Text>
                  <Text style={[styles.platformLabel, { color: p.color }]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[styles.tribeBtn, { backgroundColor: accent }, posting && { opacity: 0.6 }]}
              onPress={handleShareToTribe}
              disabled={posting}
            >
              <Text style={styles.tribeBtnText}>
                {posting ? 'Posting…' : '📣  Post to Community'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.doneBtn, isWW
                ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(14,165,233,0.3)' }
                : { backgroundColor: accent }
              ]}
              onPress={handleDone}
            >
              <Text style={[styles.doneBtnText, isWW && { color: '#6B8BA4' }]}>Done</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* Hidden ViewShot for past-walk story card capture (off-screen) */}
      <View style={styles.hiddenCapture} pointerEvents="none">
        <ViewShot ref={pastShareRef} options={{ format: 'png', quality: 1 }}>
          <StoryCard walk={pastShareWalk} badges={[]} streakMessage={null} isWW={isWW} />
        </ViewShot>
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
  backBtn:     { paddingVertical: 6, paddingHorizontal: 4, minWidth: 60 },
  backText:    { color: C.green, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  headerTitle: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 22, letterSpacing: 3 },

  map: { flex: 1 },

  // ── Live panel ──
  livePanel: { padding: 16, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.black },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  metricCard: {
    width: '48%',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
  },
  metricVal:  { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 30 },
  metricUnit: { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 10, marginTop: -2 },
  metricLbl:  { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 9, marginTop: 4, letterSpacing: 1 },
  statusText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, marginBottom: 14 },

  // ── Buttons ──
  primaryBtn: {
    minHeight: 52, borderRadius: 14, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 15 },
  stopBtn:     { backgroundColor: C.orangeSoft, borderWidth: 1, borderColor: C.orangeBorder },
  stopText:    { color: C.orange },

  // ── Pre-walk scroll ──
  preScroll:   { flex: 1 },
  preContent:  { padding: 16, gap: 14 },

  streakBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,122,0,0.10)', borderWidth: 1, borderColor: C.orangeBorder,
    borderRadius: 12, padding: 12, gap: 10,
  },
  streakBannerEmoji: { fontSize: 22 },
  streakBannerText:  { color: C.orange, fontFamily: 'DMSans_500Medium', fontSize: 13, flex: 1 },

  suggestionCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: 'rgba(0,255,136,0.06)', borderWidth: 1, borderColor: 'rgba(0,255,136,0.22)',
    borderRadius: 14, padding: 14, gap: 12,
  },
  suggestionIcon:  { fontSize: 22, marginTop: 1 },
  suggestionTitle: { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 1.5, marginBottom: 4 },
  suggestionText:  { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20 },
  suggestionHearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionHearText: { fontSize: 15, fontFamily: 'DMSans_700Bold' },

  section:     { gap: 8 },
  sectionTitle: { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 2, marginBottom: 2 },

  recordRow:  { flexDirection: 'row', gap: 8 },
  recordCard: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12 },
  recordVal:  { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 26 },
  recordUnit: { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 10, marginTop: -2 },
  recordLbl:  { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 9, letterSpacing: 1, marginTop: 4 },

  badgeRow:       {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12, gap: 12,
  },
  badgeRowEarned: { borderColor: 'rgba(0,255,136,0.35)', backgroundColor: 'rgba(0,255,136,0.05)' },
  badgeIcon:      { fontSize: 24, width: 30, textAlign: 'center' },
  badgeInfo:      { flex: 1 },
  badgeName:      { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  badgeNameEarned:{ color: C.green },
  badgeDesc:      { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 12, marginTop: 1 },
  badgeEarned:    { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 1 },
  badgeProgress:  { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 11 },

  // ── Post-walk modal ──
  modalRoot:    { flex: 1, backgroundColor: C.black },
  modalContent: { padding: 20, gap: 14, paddingBottom: 40 },

  celebHeader:  { alignItems: 'center', gap: 6, marginBottom: 4 },
  celebEmoji:   { fontSize: 52 },
  celebTitle:   { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 36, letterSpacing: 4, textAlign: 'center' },
  prBadge:      {
    backgroundColor: 'rgba(255,215,0,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.45)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginTop: 4,
  },
  prBadgeText: { color: '#FFD700', fontFamily: 'DMSans_500Medium', fontSize: 13, letterSpacing: 0.3 },

  summaryGrid: { flexDirection: 'row', gap: 10 },
  summaryCard: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, padding: 14, alignItems: 'center',
  },
  summaryVal:  { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 28 },
  summaryUnit: { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 10, marginTop: -2 },
  summaryLbl:  { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 9, letterSpacing: 1, marginTop: 4 },

  streakMilestoneBanner: {
    backgroundColor: 'rgba(255,122,0,0.12)', borderWidth: 1, borderColor: C.orangeBorder,
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  streakMilestoneText: { color: C.orange, fontFamily: 'DMSans_500Medium', fontSize: 14, textAlign: 'center' },

  newBadgesCard: {
    backgroundColor: 'rgba(0,255,136,0.06)', borderWidth: 1, borderColor: 'rgba(0,255,136,0.3)',
    borderRadius: 14, padding: 16, gap: 8,
  },
  newBadgesTitle: { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 2, marginBottom: 2 },
  newBadgeItem:   { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 15 },

  // Story card preview
  storyPreviewLabel: {
    color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 2,
  },
  storyPreviewWrap: { alignItems: 'center' },

  // Platform share grid
  shareLabel: { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 2 },
  platformGrid: { flexDirection: 'row', gap: 8 },
  platformBtn: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    gap: 5,
    minHeight: 64,
    justifyContent: 'center',
  },
  platformEmoji: { fontSize: 22 },
  platformLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10 },

  tribeBtn: {
    minHeight: 52, borderRadius: 14, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
  },
  tribeBtnText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 15 },

  doneBtn:    { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  doneBtnText: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 15 },

  // Off-screen hidden capture wrapper
  hiddenCapture: { position: 'absolute', left: -9999, top: -9999, opacity: 0 },

  // Recent walks list
  recentWalkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  recentWalkInfo: { flex: 1 },
  recentWalkDate: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    marginBottom: 3,
  },
  recentWalkStats: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  recentShareBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
  },
  recentShareBtnText: {
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
});
