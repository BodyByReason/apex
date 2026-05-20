import React, { useEffect, useState } from 'react';

import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getRevenueCatOfferingSummary } from '@/lib/revenuecat';
import { usePro } from '@/hooks/usePro';
import { useTheme } from '@/contexts/ThemeContext';
import {
  SESSION_PACKAGES,
  DURATION_OPTIONS,
  getActivePlan,
  saveActivePlan,
  calcPrice,
  getDurationOptionForPackage,
  getPackageById,
  type ActiveCoachingPlan,
  type PackageId,
  type DurationId,
} from '@/lib/liveCoaching';
import { apexColors as C } from '@/theme/colors';
import { buildProTrialHeadline, PRO_ANNUAL_FALLBACK_LABEL, PRO_MONTHLY_LABEL } from '@/lib/subscription';

const DOWNGRADE_REASONS = [
  { id: 'price', label: 'Too expensive' },
  { id: 'features', label: "Features I need aren't there yet" },
  { id: 'not_using', label: "Not using it enough" },
  { id: 'bugs', label: 'Bugs or technical issues' },
  { id: 'temporary', label: 'Just taking a break' },
  { id: 'other', label: 'Other reason' },
];

function FeatureRow({
  free,
  premium,
  premiumAccent,
  premiumBorder,
  premiumSoft,
  title,
}: {
  free: string;
  premium: string;
  premiumAccent: string;
  premiumBorder: string;
  premiumSoft: string;
  title: string;
}) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureTitle}>{title}</Text>
      <View style={styles.featureColumns}>
        <View style={styles.featureCell}>
          <Text style={styles.featureTier}>FREE</Text>
          <Text style={styles.featureValue}>{free}</Text>
        </View>
        <View style={[styles.featureCell, styles.featureCellPremium, { borderColor: premiumBorder, backgroundColor: premiumSoft }]}>
          <Text style={[styles.featureTier, { color: premiumAccent }]}>PREMIUM</Text>
          <Text style={styles.featureValue}>{premium}</Text>
        </View>
      </View>
    </View>
  );
}

function PlanCard({
  accent,
  bullets,
  price,
  subtitle,
  title,
}: {
  accent: string;
  bullets: string[];
  price: string;
  subtitle: string;
  title: string;
}) {
  return (
    <View style={[styles.planCard, { borderColor: accent }]}>
      <Text style={[styles.planTitle, { color: accent }]}>{title}</Text>
      <Text style={styles.planPrice}>{price}</Text>
      <Text style={styles.planSubtitle}>{subtitle}</Text>
      {bullets.map((bullet) => (
        <Text key={bullet} style={styles.planBullet}>
          • {bullet}
        </Text>
      ))}
    </View>
  );
}

export default function UpgradeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { isPro } = usePro();
  const { accent, accentBorder, accentSoft, accentStrongBorder } = useTheme();
  const [showDowngradeModal, setShowDowngradeModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [downgradeSubmitted, setDowngradeSubmitted] = useState(false);
  const [proMonthlyLabel, setProMonthlyLabel] = useState(PRO_MONTHLY_LABEL);
  const [proAnnualLabel, setProAnnualLabel] = useState(PRO_ANNUAL_FALLBACK_LABEL);

  // Live Coaching plan state
  const [activeLivePlan, setActiveLivePlan] = useState<ActiveCoachingPlan | null>(null);
  const [showLivePifModal, setShowLivePifModal] = useState(false);
  const [showLiveDowngradeModal, setShowLiveDowngradeModal] = useState(false);
  const [selectedPifDuration, setSelectedPifDuration] = useState<'3month' | '12month' | null>(null);
  const [selectedDowngradePkg, setSelectedDowngradePkg] = useState<PackageId | null>(null);

  useEffect(() => {
    getActivePlan()
      .then((plan) => setActiveLivePlan(plan))
      .catch(() => setActiveLivePlan(null));
  }, []);

  useEffect(() => {
    getRevenueCatOfferingSummary()
      .then((summary) => {
        setProMonthlyLabel(summary.monthlyLabel);
        setProAnnualLabel(summary.annualLabel);
      })
      .catch(() => null);
  }, []);

  const handleDowngradeConfirm = async () => {
    if (!selectedReason) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    // In production: send feedback to backend here
    setDowngradeSubmitted(true);
  };

  const handleLivePifConfirm = async () => {
    if (!selectedPifDuration || !activeLivePlan) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const updated: ActiveCoachingPlan = {
      ...activeLivePlan,
      durationId: selectedPifDuration,
    };
    await saveActivePlan(updated).catch(() => null);
    setActiveLivePlan(updated);
    setShowLivePifModal(false);
    setSelectedPifDuration(null);
    Alert.alert('Plan Updated', `You're now on the ${selectedPifDuration === '3month' ? '3-Month' : '12-Month'} Pay-in-Full plan. Enjoy your savings and bonuses!`);
  };

  const handleLiveDowngradeConfirm = async () => {
    if (!selectedDowngradePkg || !activeLivePlan) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const pkg = SESSION_PACKAGES.find((p) => p.id === selectedDowngradePkg);
    const updated: ActiveCoachingPlan = {
      ...activeLivePlan,
      packageId: selectedDowngradePkg,
    };
    await saveActivePlan(updated).catch(() => null);
    setActiveLivePlan(updated);
    setShowLiveDowngradeModal(false);
    setSelectedDowngradePkg(null);
    Alert.alert('Coaching Plan Changed', `Switched to ${pkg?.label ?? selectedDowngradePkg}. Your new rate applies from the next billing cycle.`);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>YOUR PLAN</Text>
        <View style={{ width: 54 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Pro status hero (shown when user IS on Pro) ── */}
        {isPro ? (
          <View style={[styles.proStatusCard, { borderColor: accentStrongBorder, backgroundColor: accentSoft }]}>
            <View style={[styles.proStatusBadge, { backgroundColor: accent }]}>
              <Text style={styles.proStatusBadgeText}>✦ APEX PRO · ACTIVE</Text>
            </View>
            <Text style={styles.proStatusTitle}>You're on Pro 🎉</Text>
            <Text style={styles.proStatusBody}>
              You have full access to AI coaching, premium programs, AI meal plans, live coaching, and all Pro features.
            </Text>
            <View style={styles.proPerksRow}>
              {['AI Coach', 'Meal Plans', 'Live Coaching', 'Premium Programs', 'Priority Support'].map((perk) => (
                <View key={perk} style={[styles.proPerkChip, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
                  <Text style={[styles.proPerkText, { color: accent }]}>✓ {perk}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={[styles.hero, { borderColor: accentStrongBorder, backgroundColor: accentSoft }]}>
            <Text style={[styles.heroEyebrow, { color: accent }]}>FREE OR PRO</Text>
            <Text style={styles.heroTitle}>KEEP THE BASICS FREE. UNLOCK THE SMART STUFF WITH PRO.</Text>
            <Text style={styles.heroBody}>
              Free gives you manual tracking, workouts, food logging, and the Tribe. Pro starts with a {buildProTrialHeadline().toLowerCase()}, then moves into {proMonthlyLabel}, with {proAnnualLabel} when you want the best long-term rate.
            </Text>
          </View>
        )}

        <View style={styles.planGrid}>
          {/* Free tier — highlighted if not Pro */}
          <Pressable
            style={[styles.planCard, !isPro ? styles.planCardActive : null, { borderColor: !isPro ? C.text : C.border }]}
            onPress={() => {
              if (isPro) {
                setShowDowngradeModal(true);
                setDowngradeSubmitted(false);
                setSelectedReason(null);
                setOtherText('');
              }
            }}
            disabled={!isPro}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text style={[styles.planTitle, { color: C.text }]}>Free</Text>
              {!isPro ? <View style={styles.activePlanBadge}><Text style={styles.activePlanBadgeText}>YOUR PLAN</Text></View> : null}
            </View>
            <Text style={styles.planPrice}>$0</Text>
            <Text style={styles.planSubtitle}>Best if you want to track everything yourself</Text>
            {['Track workouts and meals', 'Use community features and achievements', 'Basic progress and goal setup'].map((b) => (
              <Text key={b} style={styles.planBullet}>• {b}</Text>
            ))}
            {isPro ? <Text style={styles.planActionHint}>Tap to downgrade to Free →</Text> : null}
          </Pressable>

          {/* Pro tier */}
          <View
            style={[styles.planCard, isPro ? [styles.planCardActivePro, { backgroundColor: accentSoft }] : null, { borderColor: accent }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text style={[styles.planTitle, { color: accent }]}>APEX Pro</Text>
              {isPro ? <View style={[styles.activePlanBadge, { backgroundColor: accentSoft, borderColor: accentBorder }]}><Text style={[styles.activePlanBadgeText, { color: accent }]}>✦ YOUR PLAN</Text></View> : null}
            </View>
            <Text style={styles.planPrice}>{buildProTrialHeadline()} → {proMonthlyLabel}</Text>
            <Text style={styles.planSubtitle}>Best if you want the app to coach and build for you</Text>
            {[
              `${proAnnualLabel} for the best long-term value`,
              'AI Coach that knows your goals and progress',
              'AI workouts, meal plans, and premium programs',
              'Live coaching options and premium support',
            ].map((b) => (
              <Text key={b} style={styles.planBullet}>• {b}</Text>
            ))}
          </View>

          {/* Live Coaching card — only visible to Pro users */}
          {isPro ? (
            activeLivePlan ? (
              <Pressable
                style={[styles.planCard, { borderColor: C.orange, borderWidth: 1.5 }]}
                onPress={() => navigation.navigate('Coach', { openLiveCoach: true })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text style={[styles.planTitle, { color: C.orange }]}>Live Coaching</Text>
                  <View style={[styles.activePlanBadge, { backgroundColor: 'rgba(255,107,53,0.12)', borderColor: C.orangeBorder }]}>
                    <Text style={[styles.activePlanBadgeText, { color: C.orange }]}>✦ ACTIVE</Text>
                  </View>
                </View>
                {(() => {
                  const pkg = getPackageById(activeLivePlan.packageId);
                  const dur = getDurationOptionForPackage(activeLivePlan.packageId, activeLivePlan.durationId);
                  const weeklyRate = pkg?.weeklyPrice ?? 0;
                  return (
                    <>
                      <Text style={styles.planPrice}>{pkg?.label ?? activeLivePlan.packageId}</Text>
                      <Text style={styles.planSubtitle}>
                        {dur?.label ?? activeLivePlan.durationId} · ${weeklyRate}/wk
                      </Text>
                      <Text style={styles.planBullet}>• {pkg?.sessionType === 'group' ? 'Live group coaching access' : 'Real 1-on-1 coach sessions'}</Text>
                      <Text style={styles.planBullet}>• Accountability, check-ins & programming</Text>
                      {dur?.bonuses?.map((b) => (
                        <Text key={b} style={[styles.planBullet, { color: accent }]}>✓ {b}</Text>
                      ))}

                      {/* PIF upgrade — only if currently on weekly */}
                      {activeLivePlan.durationId === 'weekly' ? (
                        <Pressable
                          style={[styles.liveActionBtn, { borderColor: accentStrongBorder, backgroundColor: accentSoft }]}
                          onPress={() => { setSelectedPifDuration(null); setShowLivePifModal(true); }}
                        >
                          <Text style={[styles.liveActionBtnText, { color: accent }]}>💰 Pay in Full &amp; Save →</Text>
                        </Pressable>
                      ) : null}

                      {/* Downgrade frequency — only if 2x or 3x */}
                      {(activeLivePlan.packageId === '2x' || activeLivePlan.packageId === '3x') ? (
                        <Pressable
                          style={[styles.liveActionBtn, { borderColor: C.border, marginTop: 8 }]}
                          onPress={() => { setSelectedDowngradePkg(null); setShowLiveDowngradeModal(true); }}
                        >
                          <Text style={styles.liveActionBtnText}>Reduce frequency →</Text>
                        </Pressable>
                      ) : null}
                    </>
                  );
                })()}
                <Text style={[styles.planActionHint, { color: C.orange }]}>Tap to manage live coaching →</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => navigation.navigate('Coach', { openLiveCoach: true })}>
                <PlanCard
                  accent={C.orange}
                  title="Live Coaching"
                  price="Custom"
                  subtitle="1-on-1 or group support"
                  bullets={[
                    'Real coach sessions',
                    'Accountability, check-ins, and programming',
                    'Best for athletes who want hands-on guidance',
                  ]}
                />
              </Pressable>
            )
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>WHAT CHANGES WHEN YOU UPGRADE</Text>
        <View style={styles.featureCard}>
          <FeatureRow title="Coach" free="Manual tracking and basic guidance" premium="Personalized AI Coach across workouts, nutrition, and recovery" premiumAccent={accent} premiumBorder={accentStrongBorder} premiumSoft={accentSoft} />
          <FeatureRow title="Workouts" free="Manual logging and program browsing" premium="AI-built plans, AI workouts, and voice coaching" premiumAccent={accent} premiumBorder={accentStrongBorder} premiumSoft={accentSoft} />
          <FeatureRow title="Nutrition" free="Food logging, barcode scan, and meal templates" premium="AI meal plans, updates, and smarter nutrition support" premiumAccent={accent} premiumBorder={accentStrongBorder} premiumSoft={accentSoft} />
          <FeatureRow title="Support" free="Tribe, voting, and self-guided progress" premium="Live coaching, premium help, and deeper accountability" premiumAccent={accent} premiumBorder={accentStrongBorder} premiumSoft={accentSoft} />
        </View>

        {/* CTA — different based on Pro state */}
        {isPro ? (
          <View style={[styles.manageCard, { borderColor: accentStrongBorder, backgroundColor: accentSoft }]}>
            <Text style={[styles.manageTitle, { color: accent }]}>MANAGE YOUR SUBSCRIPTION</Text>
            <Text style={styles.manageBody}>
              Manage billing, change your plan, or pause your subscription in your device's subscription settings.
            </Text>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: accent }]}
              onPress={() => Alert.alert('Manage Plan', 'Go to Settings → Apple ID → Subscriptions to manage your APEX Pro subscription.')}
            >
              <Text style={styles.primaryBtnText}>Manage in App Store →</Text>
            </Pressable>
            <Pressable
              style={[styles.downgradeBtn, { marginTop: 12 }]}
              onPress={() => { setShowDowngradeModal(true); setDowngradeSubmitted(false); setSelectedReason(null); setOtherText(''); }}
            >
              <Text style={styles.downgradeBtnText}>Downgrade to Free</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Live Coaching: Pay in Full modal ── */}
      <Modal visible={showLivePifModal} transparent animationType="slide" onRequestClose={() => setShowLivePifModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowLivePifModal(false)}>
          <View style={styles.downgradeModal}>
            <View style={styles.modalHandle} />
            <Text style={styles.downgradeModalTitle}>Pay In Full &amp; Save</Text>
            <Text style={styles.downgradeModalBody}>
              Commit to a longer plan and save — plus unlock bonus sessions and gift items.
            </Text>
            <View style={{ gap: 10, marginVertical: 14 }}>
              {(['3month', '12month'] as const).map((durId) => {
                const dur = getDurationOptionForPackage(activeLivePlan?.packageId ?? '1x', durId)!;
                const price = activeLivePlan ? calcPrice(activeLivePlan.packageId, durId) : 0;
                const weeklyEquiv = activeLivePlan ? Math.round(price / dur.weeks) : 0;
                const isSelected = selectedPifDuration === durId;
                return (
                  <Pressable
                    key={durId}
                    style={[styles.reasonChip, isSelected ? [styles.reasonChipSelected, { borderColor: accentStrongBorder, backgroundColor: accentSoft }] : null]}
                    onPress={() => setSelectedPifDuration(durId)}
                  >
                    <View style={[styles.reasonRadio, isSelected ? [styles.reasonRadioSelected, { borderColor: accent, backgroundColor: accent }] : null]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.reasonLabel, isSelected ? { color: C.text } : null]}>
                        {dur.label} — ${price.toLocaleString()} total
                      </Text>
                      <Text style={{ fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 }}>
                        ${weeklyEquiv}/wk · Save ${dur.savingsAmount.toLocaleString()}
                      </Text>
                      {dur.bonuses.map((b) => (
                        <Text key={b} style={{ fontSize: 11, color: accent, fontFamily: 'DMSans_400Regular', marginTop: 1 }}>✓ {b}</Text>
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: accent }, !selectedPifDuration ? { opacity: 0.4 } : null]}
              onPress={() => handleLivePifConfirm().catch(() => null)}
              disabled={!selectedPifDuration}
            >
              <Text style={styles.primaryBtnText}>Confirm Pay In Full →</Text>
            </Pressable>
            <Pressable style={[styles.downgradeBtn, { marginTop: 10 }]} onPress={() => setShowLivePifModal(false)}>
              <Text style={styles.downgradeBtnText}>Keep weekly plan</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── Live Coaching: Reduce frequency modal ── */}
      <Modal visible={showLiveDowngradeModal} transparent animationType="slide" onRequestClose={() => setShowLiveDowngradeModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowLiveDowngradeModal(false)}>
          <View style={styles.downgradeModal}>
            <View style={styles.modalHandle} />
            <Text style={styles.downgradeModalTitle}>Reduce Frequency</Text>
            <Text style={styles.downgradeModalBody}>
              Switch to fewer sessions per week. Your new rate applies from the next billing cycle.
            </Text>
            <View style={{ gap: 10, marginVertical: 14 }}>
              {SESSION_PACKAGES
                .filter((pkg) => {
                  const currentIdx = SESSION_PACKAGES.findIndex((p) => p.id === activeLivePlan?.packageId);
                  const thisIdx = SESSION_PACKAGES.findIndex((p) => p.id === pkg.id);
                  return thisIdx < currentIdx;
                })
                .map((pkg) => {
                  const isSelected = selectedDowngradePkg === pkg.id;
                  return (
                    <Pressable
                      key={pkg.id}
                    style={[styles.reasonChip, isSelected ? [styles.reasonChipSelected, { borderColor: accentStrongBorder, backgroundColor: accentSoft }] : null]}
                    onPress={() => setSelectedDowngradePkg(pkg.id)}
                  >
                      <View style={[styles.reasonRadio, isSelected ? [styles.reasonRadioSelected, { borderColor: accent, backgroundColor: accent }] : null]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.reasonLabel, isSelected ? { color: C.text } : null]}>
                          {pkg.label}
                        </Text>
                        <Text style={{ fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 }}>
                          ${pkg.weeklyPrice}/week
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
            </View>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: accent }, !selectedDowngradePkg ? { opacity: 0.4 } : null]}
              onPress={() => handleLiveDowngradeConfirm().catch(() => null)}
              disabled={!selectedDowngradePkg}
            >
              <Text style={styles.primaryBtnText}>Confirm Change →</Text>
            </Pressable>
            <Pressable style={[styles.downgradeBtn, { marginTop: 10 }]} onPress={() => setShowLiveDowngradeModal(false)}>
              <Text style={styles.downgradeBtnText}>Keep current plan</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── Downgrade feedback modal ── */}
      <Modal visible={showDowngradeModal} transparent animationType="slide" onRequestClose={() => setShowDowngradeModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowDowngradeModal(false)}>
          <View style={styles.downgradeModal}>
            <View style={styles.modalHandle} />

            {downgradeSubmitted ? (
              // Confirmation screen
              <View style={{ alignItems: 'center', paddingVertical: 24, gap: 14 }}>
                <Text style={{ fontSize: 40 }}>😢</Text>
                <Text style={styles.downgradeModalTitle}>We're sorry to see you go</Text>
                <Text style={styles.downgradeModalBody}>
                  Your feedback means a lot. To complete your downgrade, go to{'\n'}
                  <Text style={{ color: C.text }}>Settings → Apple ID → Subscriptions</Text>{'\n'}
                  and cancel APEX Pro there.
                </Text>
                <Pressable
                  style={[styles.primaryBtn, { width: '100%', backgroundColor: accent }]}
                  onPress={() => setShowDowngradeModal(false)}
                >
                  <Text style={styles.primaryBtnText}>Got it</Text>
                </Pressable>
              </View>
            ) : (
              // Reason picker
              <>
                <Text style={styles.downgradeModalTitle}>Before you go…</Text>
                <Text style={styles.downgradeModalBody}>
                  Help us improve APEX. Why are you considering downgrading?
                </Text>

                <View style={{ gap: 8, marginVertical: 14 }}>
                  {DOWNGRADE_REASONS.map((reason) => (
                    <Pressable
                      key={reason.id}
                      style={[styles.reasonChip, selectedReason === reason.id ? [styles.reasonChipSelected, { borderColor: accentStrongBorder, backgroundColor: accentSoft }] : null]}
                      onPress={() => setSelectedReason(reason.id)}
                    >
                      <View style={[styles.reasonRadio, selectedReason === reason.id ? [styles.reasonRadioSelected, { borderColor: accent, backgroundColor: accent }] : null]} />
                      <Text style={[styles.reasonLabel, selectedReason === reason.id ? { color: C.text } : null]}>
                        {reason.label}
                      </Text>
                    </Pressable>
                  ))}
                  {selectedReason === 'other' ? (
                    <TextInput
                      style={styles.reasonInput}
                      value={otherText}
                      onChangeText={setOtherText}
                      placeholder="Tell us more…"
                      placeholderTextColor={C.muted}
                      multiline
                    />
                  ) : null}
                </View>

                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: accent }, !selectedReason ? { opacity: 0.4 } : null]}
                  onPress={handleDowngradeConfirm}
                  disabled={!selectedReason}
                >
                  <Text style={styles.primaryBtnText}>Submit & Continue</Text>
                </Pressable>
                <Pressable style={styles.downgradeBtn} onPress={() => setShowDowngradeModal(false)}>
                  <Text style={styles.downgradeBtnText}>Actually, keep Pro</Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

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
  backBtn: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 54 },
  backText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  headerTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 3,
  },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 40 },
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  heroEyebrow: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  heroTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 30,
    lineHeight: 31,
    letterSpacing: 1.4,
  },
  heroBody: {
    marginTop: 10,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
  planGrid: {
    gap: 10,
    marginBottom: 16,
  },
  planCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
  },
  planTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    letterSpacing: 1.2,
  },
  planPrice: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 20,
    marginTop: 4,
  },
  planSubtitle: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    marginTop: 2,
    marginBottom: 10,
  },
  planBullet: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 5,
  },
  planActionHint: {
    marginTop: 8,
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  sectionLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 10,
  },
  featureCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  featureRow: {
    marginBottom: 12,
  },
  featureTitle: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    marginBottom: 8,
  },
  featureColumns: {
    flexDirection: 'row',
    gap: 10,
  },
  featureCell: {
    flex: 1,
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
  },
  featureCellPremium: {},
  featureTier: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    marginBottom: 6,
  },
  featureValue: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  ctaCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 16,
    padding: 16,
  },
  ctaTitle: {
    color: C.orange,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    letterSpacing: 1.2,
  },
  ctaBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 14,
  },
  primaryBtn: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#000',
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
  },

  // ── Pro status hero ──
  proStatusCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 18,
    marginBottom: 14,
  },
  proStatusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  proStatusBadgeText: {
    color: '#000',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 1.2,
  },
  proStatusTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 32,
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  proStatusBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  proPerksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  proPerkChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  proPerkText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },

  // ── Plan card highlight states ──
  planCardActive: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  planCardActivePro: {
    backgroundColor: 'transparent',
    borderWidth: 2,
  },
  activePlanBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activePlanBadgeText: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 1,
  },

  // ── Manage subscription card ──
  manageCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  manageTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  manageBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 14,
  },

  // ── Downgrade button ──
  downgradeBtn: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downgradeBtnText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },

  // ── Downgrade modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  downgradeModal: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  downgradeModalTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 26,
    letterSpacing: 1.2,
    marginBottom: 6,
    textAlign: 'center',
  },
  downgradeModalBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 4,
  },

  // ── Reason picker ──
  reasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reasonChipSelected: {},
  reasonRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: C.border,
  },
  reasonRadioSelected: {},
  reasonLabel: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    flex: 1,
  },
  reasonInput: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },

  // ── Live Coaching inline action buttons ──
  liveActionBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  liveActionBtnText: {
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
});
