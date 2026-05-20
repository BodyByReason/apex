/**
 * ChallengeCompleteScreen
 *
 * Shown when streak >= plan.challengeDays.
 * Celebrates the user's completion and presents the $7.99
 * challenge-finisher upgrade offer with a 48-hour countdown.
 *
 * On purchase → setWalkWaterModeEnabled(false) → App.tsx flips
 * to MainNavigator → full APEX unlocked.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '@/contexts/AuthContext';
import {
  getWwUpgradeOfferingInfo,
  purchasePackageByType,
  purchaseWwUpgrade,
  type WwUpgradeCohort,
} from '@/lib/revenuecat';
import {
  getWalkWaterPlan,
  getWalkWaterStreak,
  isWWUpgraded,
  type WWGender,
} from '@/lib/walkWaterMode';
import { isAdminEnabled } from '@/lib/adminMode';
import {
  loadConversation,
  STRONGHER_FUEL_PDF_URL,
  STRONGHER_STRENGTH_PDF_URL,
} from '@/lib/coachDM';
import type { WalkWaterStackParamList } from '@/navigation/WalkWaterNavigator';

const PROFILE_STORAGE_KEY = 'apex.user.profile';

// ─── Constants ────────────────────────────────────────────────────────────────

const OFFER_EXPIRY_KEY = 'apex.ww.challengeOfferExpiry';
const OFFER_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours
const FULL_PRICE = '$19.99';
const CHALLENGE_PRICE_FALLBACK = '$7.99';
const LONG_CHALLENGE_PRICE = '$9.99';

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
  tealBorder: 'rgba(6,182,212,0.2)',
  text: '#F0F8FF',
  muted: '#6B8BA4',
  accent: '#38BDF8',
  gold: '#F59E0B',
  goldSoft: 'rgba(245,158,11,0.1)',
  goldBorder: 'rgba(245,158,11,0.25)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function getChallengeCompletionPrice(challengeDays: number): string {
  return challengeDays <= 3 ? CHALLENGE_PRICE_FALLBACK : LONG_CHALLENGE_PRICE;
}

function getChallengeCompletionSaveLabel(challengeDays: number): string {
  return challengeDays <= 3 ? 'SAVE 60%' : 'SAVE 50%';
}

// ─── ChallengeCompleteScreen ──────────────────────────────────────────────────

export default function ChallengeCompleteScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<WalkWaterStackParamList>>();

  const [streak, setStreak] = useState(0);
  const [challengeDays, setChallengeDays] = useState(3);
  const [stepGoal, setStepGoal] = useState(8000);
  const [waterGlassGoal, setWaterGlassGoal] = useState(8);
  const [expiryMs, setExpiryMs] = useState<number | null>(null);
  const [countdown, setCountdown] = useState('');
  const [offerExpired, setOfferExpired] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [gender, setGender] = useState<WWGender>('female');
  const [resourcesSent, setResourcesSent] = useState(false);
  const [localFirstName, setLocalFirstName] = useState<string | null>(null);
  const [isUpgraded, setIsUpgraded] = useState(false);
  const [offerUnavailable, setOfferUnavailable] = useState(false);
  const [adminEnabled, setAdminEnabled] = useState(false);

  const upgradeCohort: WwUpgradeCohort = 'challenge_finisher';
  const challengePrice = getChallengeCompletionPrice(challengeDays);
  const challengeSaveLabel = getChallengeCompletionSaveLabel(challengeDays);

  // RevenueCat determines whether the discounted offer is available, while the
  // displayed completion price follows product rules tied to challenge length.
  useEffect(() => {
    let cancelled = false;
    getWwUpgradeOfferingInfo(session?.user?.id, upgradeCohort)
      .then((info) => {
        if (cancelled) return;
        if (!info.available) {
          setOfferUnavailable(true);
        } else {
          setOfferUnavailable(false);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const sessionDisplayName =
    (session?.user?.user_metadata?.display_name as string | undefined) ?? '';
  const firstName = localFirstName ?? (sessionDisplayName ? sessionDisplayName.split(' ')[0] : 'Champion');

  // Entrance animations
  const heroScale = useRef(new Animated.Value(0.85)).current;
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(heroScale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }),
        Animated.timing(heroOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      Animated.timing(contentOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
  }, []);

  // Load plan data + gender + upgrade status + real offer price
  useEffect(() => {
    getWalkWaterPlan().then((plan) => {
      if (!plan) return;
      setChallengeDays(plan.challengeDays);
      setStepGoal(plan.dailyStepGoal);
      setWaterGlassGoal(Math.round(plan.dailyWaterGoalOz / 8));
    }).catch(() => null);

    getWalkWaterStreak().then(setStreak).catch(() => null);

    isWWUpgraded().then(setIsUpgraded).catch(() => null);
    isAdminEnabled().then(setAdminEnabled).catch(() => null);

    AsyncStorage.getItem(PROFILE_STORAGE_KEY).then((raw) => {
      if (!raw) return;
      const profile = JSON.parse(raw) as { gender?: WWGender; displayName?: string };
      if (profile.gender) setGender(profile.gender);
      if (profile.displayName) setLocalFirstName(profile.displayName.split(' ')[0]);
    }).catch(() => null);

    loadConversation().then((dm) => {
      if (dm?.collected?.resourcesSent) setResourcesSent(true);
    }).catch(() => null);
  }, []);

  const handleOpenPdf = useCallback((type: 'fuel' | 'strength') => {
    const url = type === 'fuel' ? STRONGHER_FUEL_PDF_URL : STRONGHER_STRENGTH_PDF_URL;
    const title = type === 'fuel' ? 'StrongHER Daily Fuel Blueprint' : 'StrongHER Daily Strength Program';
    navigation.navigate('PDFViewer', { url, title });
  }, [navigation]);

  // Init or load the 48-hr offer expiry
  useEffect(() => {
    AsyncStorage.getItem(OFFER_EXPIRY_KEY).then(async (raw) => {
      let expiry = raw ? Number(raw) : null;
      if (!expiry) {
        expiry = Date.now() + OFFER_DURATION_MS;
        await AsyncStorage.setItem(OFFER_EXPIRY_KEY, String(expiry));
      }
      setExpiryMs(expiry);
    }).catch(() => null);
  }, []);

  // Countdown tick
  useEffect(() => {
    if (expiryMs === null) return;
    const tick = () => {
      const remaining = expiryMs - Date.now();
      if (remaining <= 0) {
        setOfferExpired(true);
        setCountdown('00:00:00');
      } else {
        setCountdown(formatCountdown(remaining));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiryMs]);

  const handlePurchase = useCallback(async () => {
    setPurchasing(true);
    setPurchaseError(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await purchaseWwUpgrade(session?.user?.id, upgradeCohort);

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.navigate('ApexUnlock');
    } else {
      setPurchasing(false);
      if (result.error) {
        setPurchaseError(result.error);
      }
    }
  }, [session?.user?.id, navigation]);

  const handleMaybeLater = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    navigation.goBack();
  }, [navigation]);

  const handleTestPurchase = useCallback(async () => {
    setPurchasing(true);
    setPurchaseError(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await purchasePackageByType('monthly', session?.user?.id);

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.navigate('ApexUnlock');
    } else {
      setPurchasing(false);
      setPurchaseError(result.error ?? 'Test purchase failed.');
    }
  }, [navigation, session?.user?.id]);

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero ── */}
      <Animated.View
        style={[styles.hero, { opacity: heroOpacity, transform: [{ scale: heroScale }] }]}
      >
        <View style={styles.badgeRing}>
          <Text style={styles.badgeEmoji}>🏆</Text>
        </View>
        <Text style={styles.eyebrow}>CHALLENGE COMPLETE</Text>
        <Text style={styles.heroTitle}>You did it,{'\n'}{firstName}.</Text>
        <Text style={styles.heroSub}>
          {challengeDays} days of walking + hydrating.{'\n'}That's a habit now.
        </Text>
      </Animated.View>

      {/* ── Stats ── */}
      <Animated.View style={[styles.statsCard, { opacity: contentOpacity }]}>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{streak}</Text>
            <Text style={styles.statLabel}>DAYS{'\n'}COMPLETED</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: WW.blue }]}>
              {stepGoal.toLocaleString()}
            </Text>
            <Text style={styles.statLabel}>DAILY STEP{'\n'}GOAL</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: WW.teal }]}>{waterGlassGoal}</Text>
            <Text style={styles.statLabel}>GLASSES{'\n'}PER DAY</Text>
          </View>
        </View>
      </Animated.View>

      {/* ── Bonus gifts ── */}
      <Animated.View style={[styles.giftsCard, { opacity: contentOpacity }]}>
        <Text style={styles.giftsEyebrow}>🎁 YOUR BONUS GIFTS</Text>
        <Text style={styles.giftsTitle}>You earned these for finishing.</Text>

        {/* Female who already got PDFs in DM, or male → show social links */}
        {(gender !== 'female' || resourcesSent) ? (
          <>
            <Pressable
              style={styles.giftRow}
              onPress={() => Linking.openURL('https://www.tiktok.com/@bodybyreasonbbr').catch(() => null)}
            >
              <View style={styles.giftIcon}>
                <Text style={styles.giftEmoji}>🎵</Text>
              </View>
              <View style={styles.giftInfo}>
                <Text style={styles.giftName}>TikTok @BodyByReasonBBR</Text>
                <Text style={styles.giftSub}>Workouts, meals & motivation daily</Text>
              </View>
              <Text style={styles.giftArrow}>↗</Text>
            </Pressable>

            <View style={styles.giftDivider} />

            <Pressable
              style={styles.giftRow}
              onPress={() => Linking.openURL('https://instagram.com/BodyByReason').catch(() => null)}
            >
              <View style={styles.giftIcon}>
                <Text style={styles.giftEmoji}>📸</Text>
              </View>
              <View style={styles.giftInfo}>
                <Text style={styles.giftName}>Instagram @BodyByReason</Text>
                <Text style={styles.giftSub}>Behind the scenes & client results</Text>
              </View>
              <Text style={styles.giftArrow}>↗</Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* Female who hasn't gotten PDFs yet → offer them here */}
            <Pressable
              style={styles.giftRow}
              onPress={() => handleOpenPdf('fuel')}
            >
              <View style={styles.giftIcon}>
                <Text style={styles.giftEmoji}>🥗</Text>
              </View>
              <View style={styles.giftInfo}>
                <Text style={styles.giftName}>StrongHER Daily Fuel Blueprint</Text>
                <Text style={styles.giftSub}>Your specific macros + nutrition guide</Text>
              </View>
              <Text style={styles.giftArrow}>↓</Text>
            </Pressable>

            <View style={styles.giftDivider} />

            <Pressable
              style={styles.giftRow}
              onPress={() => handleOpenPdf('strength')}
            >
              <View style={styles.giftIcon}>
                <Text style={styles.giftEmoji}>💪</Text>
              </View>
              <View style={styles.giftInfo}>
                <Text style={styles.giftName}>StrongHER Daily Strength Program</Text>
                <Text style={styles.giftSub}>Workout plan to build on your walks</Text>
              </View>
              <Text style={styles.giftArrow}>↓</Text>
            </Pressable>
          </>
        )}
      </Animated.View>

      {/* ── Upgrade offer ── */}
      <Animated.View style={{ opacity: contentOpacity }}>
        <Text style={styles.offerEyebrow}>WHAT COMES NEXT</Text>
        <View style={styles.offerCard}>
          <Text style={styles.offerTitle}>You built the habit.{'\n'}Now build the body.</Text>
          <Text style={styles.offerSub}>
            Most people stop after a challenge. You don't have to.
          </Text>

          {/* Features */}
          <View style={styles.features}>
            {[
              { icon: '🏃', text: 'Go 7, 14, or 21 days — longer challenges build habits that actually stick.' },
              { icon: '💪', text: 'Bodyweight, dumbbell, and resistance workouts added to your routine — no gym required.' },
              { icon: '🥗', text: 'Stop guessing what to eat with simple meals built for your goal + your A.I. food scanner. Snap a photo, skip the logging.' },
            ].map((f) => (
              <View key={f.icon} style={styles.featureRow}>
                <Text style={styles.featureIcon}>{f.icon}</Text>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          {/* Price block */}
          <View style={styles.priceBlock}>
            {!offerExpired ? (
              <>
                <View style={styles.priceRow}>
                  <View>
                    <Text style={styles.priceFull}>{FULL_PRICE}/mo</Text>
                    <Text style={styles.priceChallenge}>{challengePrice}<Text style={styles.pricePerMonth}>/mo</Text></Text>
                  </View>
                  <View style={styles.savePill}>
                    <Text style={styles.savePillText}>{challengeSaveLabel}</Text>
                  </View>
                </View>
                <View style={styles.countdownRow}>
                  <Text style={styles.countdownLabel}>Challenge finisher offer expires in</Text>
                  <Text style={styles.countdownTimer}>{countdown}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.priceRow}>
                  <View>
                    <Text style={styles.priceFull}>{FULL_PRICE}/mo</Text>
                    <Text style={styles.priceChallenge}>{challengePrice}<Text style={styles.pricePerMonth}>/mo</Text></Text>
                  </View>
                </View>
                <Text style={styles.expiredNote} numberOfLines={0}>Challenge finisher rate — you earned it</Text>
              </>
            )}
          </View>

          {/* CTA */}
          {purchaseError ? (
            <Text style={styles.errorText}>{purchaseError}</Text>
          ) : null}

          <Pressable
            style={[styles.btnPrimary, purchasing && styles.btnDisabled]}
            onPress={handlePurchase}
            disabled={purchasing}
          >
            {purchasing ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.btnPrimaryText}>
                Unlock APEX — {challengePrice}/mo →
              </Text>
            )}
          </Pressable>

          <Text style={styles.legalText}>
            Billed monthly. Cancel anytime from your App Store settings.
          </Text>
          <View style={styles.legalLinks}>
            <Text
              style={styles.legalLink}
              onPress={() => Linking.openURL('https://apexai.coach/privacy-policy').catch(() => null)}
            >
              Privacy Policy
            </Text>
            <Text style={styles.legalSep}> · </Text>
            <Text
              style={styles.legalLink}
              onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/').catch(() => null)}
            >
              Terms of Use
            </Text>
          </View>
        </View>

        {/* Maybe later */}
        <Pressable style={styles.laterBtn} onPress={handleMaybeLater}>
          <Text style={styles.laterText}>
            {offerExpired ? 'Go back' : "Maybe later — I'll decide before the offer expires"}
          </Text>
        </Pressable>
      </Animated.View>

    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WW.black },
  content: { paddingHorizontal: 20, paddingTop: 24, gap: 20 },

  // Hero
  hero: { alignItems: 'center', paddingVertical: 8 },
  badgeRing: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: WW.goldSoft, borderWidth: 2, borderColor: WW.goldBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  badgeEmoji: { fontSize: 44 },
  eyebrow: { fontSize: 10, color: WW.gold, fontWeight: '700', letterSpacing: 2, marginBottom: 12 },
  heroTitle: {
    fontSize: 38, color: WW.text, fontWeight: '900', letterSpacing: -0.8,
    textAlign: 'center', lineHeight: 44, marginBottom: 12,
  },
  heroSub: {
    fontSize: 15, color: WW.muted, textAlign: 'center', lineHeight: 22, fontWeight: '500',
  },

  // Stats
  statsCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 18, padding: 20,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 6 },
  statValue: { fontSize: 28, color: WW.gold, fontWeight: '900', letterSpacing: -0.5 },
  statLabel: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1, textAlign: 'center' },
  statDivider: { width: 1, height: 44, backgroundColor: WW.border },

  // Offer
  offerEyebrow: {
    fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.5,
    marginBottom: 10, marginLeft: 2,
  },
  offerCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 20, padding: 20, gap: 16,
  },
  offerTitle: {
    fontSize: 24, color: WW.text, fontWeight: '900', letterSpacing: -0.4, lineHeight: 30,
  },
  offerSub: { fontSize: 14, color: WW.muted, lineHeight: 21 },

  features: { gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  featureIcon: { fontSize: 16, width: 22 },
  featureText: { fontSize: 13, color: WW.text, fontWeight: '500', flex: 1, lineHeight: 19 },

  // Price block
  priceBlock: {
    backgroundColor: 'rgba(14,165,233,0.06)', borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 14, padding: 16, gap: 10,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceFull: { fontSize: 13, color: WW.muted, textDecorationLine: 'line-through', fontWeight: '600' },
  priceChallenge: { fontSize: 32, color: WW.blue, fontWeight: '900', letterSpacing: -0.8 },
  pricePerMonth: { fontSize: 14, color: WW.muted, fontWeight: '600' },
  savePill: {
    backgroundColor: 'rgba(6,182,212,0.15)', borderWidth: 1, borderColor: WW.tealBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  savePillText: { fontSize: 11, color: WW.teal, fontWeight: '800', letterSpacing: 0.5 },
  countdownRow: { gap: 3 },
  countdownLabel: { fontSize: 11, color: WW.muted, fontWeight: '500' },
  countdownTimer: { fontSize: 22, color: WW.accent, fontWeight: '900', letterSpacing: 2 },
  expiredNote: { fontSize: 12, color: WW.muted, fontWeight: '500' },

  errorText: { fontSize: 13, color: '#EF4444', fontWeight: '500', textAlign: 'center' },

  btnPrimary: {
    backgroundColor: WW.blue, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center',
  },
  btnPrimaryText: { fontSize: 16, color: '#000', fontWeight: '800', letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.5 },

  legalText: {
    fontSize: 11, color: WW.muted, textAlign: 'center', lineHeight: 16,
  },
  legalLinks: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4,
  },
  legalLink: {
    fontSize: 11, color: WW.accent, textDecorationLine: 'underline',
  },
  legalSep: {
    fontSize: 11, color: WW.muted,
  },

  laterBtn: { paddingVertical: 16, alignItems: 'center' },
  laterText: { fontSize: 13, color: WW.muted, fontWeight: '500', textAlign: 'center' },

  // Gifts
  giftsCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 18, padding: 18, gap: 14,
  },
  giftsEyebrow: { fontSize: 9, color: WW.gold, fontWeight: '800', letterSpacing: 1.5 },
  giftsTitle:   { fontSize: 16, color: WW.text, fontWeight: '800', marginTop: -4 },
  giftRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  giftIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: WW.goldSoft, alignItems: 'center', justifyContent: 'center',
  },
  giftEmoji:  { fontSize: 20 },
  giftInfo:   { flex: 1 },
  giftName:   { fontSize: 13, color: WW.text, fontWeight: '700' },
  giftSub:    { fontSize: 11, color: WW.muted, marginTop: 2 },
  giftArrow:  { fontSize: 18, color: WW.gold, fontWeight: '700' },
  giftDivider:{ height: 1, backgroundColor: WW.border },

  unavailableBlock: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 14,
    padding: 14,
  },
  unavailableText: {
    fontSize: 13,
    color: WW.gold,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
  },
  testPurchaseBtn: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    backgroundColor: 'rgba(245,158,11,0.12)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  testPurchaseBtnText: {
    fontSize: 14,
    color: WW.gold,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  newChallengeBlock: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'center',
    gap: 8,
  },
  newChallengeBtn: {
    backgroundColor: 'rgba(14,165,233,0.12)',
    borderWidth: 1.5,
    borderColor: WW.blueBorder,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
  },
  newChallengeBtnText: {
    fontSize: 15,
    color: WW.blue,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  newChallengeSub: {
    fontSize: 12,
    color: WW.muted,
    fontWeight: '500',
  },
});
