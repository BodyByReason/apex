/**
 * LiveCoachScreen
 *
 * Client-facing live coaching hub:
 *   • No active plan → Purchase flow (package → duration → calendar booking → confirm)
 *   • Active plan    → Dashboard (next session, session history, bonus tracker, chat)
 *
 * Pro-gated. Only accessible to APEX Pro members.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { useNavigation } from '@react-navigation/native';
import {
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { maybeShowPaywall } from '@/lib/revenuecat';
import { useAuth } from '@/contexts/AuthContext';
import { isAdminEnabled } from '@/lib/adminMode';
import { getLinkedCoach, redeemCoachInvite, upsertCoachClientLink, updateCoachClientLink, type LinkedCoach } from '@/lib/coachInvites';
import { usePro } from '@/hooks/usePro';
import { apexColors as C } from '@/theme/colors';
import { useTheme } from '@/contexts/ThemeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type AIWorkout,
  type AIWorkoutExercise,
  getAIWorkout,
  saveAIWorkout,
  getAIProgram,
} from '@/lib/aiWorkout';
import { getPlanById, getSuggestedPlanId, type WorkoutProgramDay } from '@/lib/plans';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { loadCachedProfile } from '@/lib/profileSync';
import { queueCoachBusinessNotification, sendCoachBusinessNotification } from '@/lib/notifications';
import {
  fetchBusyTimes,
  fetchFitCallSlots,
  bookFitCall,
  getCalendarSettings,
  groupSessionLocalTime24,
  groupSessionLocalTimeStr,
  isSlotAvailable,
  isWednesdayDate,
  type BusyPeriod,
} from '@/lib/calendarIntegration';
import {
  type ActiveCoachingPlan,
  type BonusTracker,
  type CoachingSession,
  type DurationId,
  type PackageId,
  type RecurrencePreference,
  type SessionScheduleSlot,
  DURATION_OPTIONS,
  SESSION_PACKAGES,
  buildBonusTrackerFromPlan,
  buildRecurringSessions,
  calcPrice,
  formatSessionDate,
  formatFitCallDate,
  formatFitCallTime,
  saveFitCallBookingLocally,
  getActivePlan,
  getBonusTracker,
  getDurationOptionForPackage,
  getDurationOptionsForSessionType,
  getDaysUntil,
  getPackageById,
  openZoomSessionForClient,
  getSessionJoinUrl,
  getSessions,
  saveActivePlan,
  saveBonusTracker,
  addSession,
} from '@/lib/liveCoaching';
import { createScheduledLiveCoachingSessions } from '@/lib/liveCoachingSessions';
import { env } from '@/lib/env';
import { getSelectedCoachVoice, type CoachVoiceOption } from '@/lib/coachVoice';
import { resetDMFlowForTesting } from '@/lib/coachDM';

// ─── Calendar helpers ─────────────────────────────────────────────────────────

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const TIME_SLOTS = [
  '06:00', '07:00', '07:30', '08:00', '09:00', '10:00',
  '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
  '17:00', '18:00', '19:00', '20:00',
];

function getCalendarDays(year: number, month: number): Array<{ day: number; dateStr: string } | null> {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number; dateStr: string } | null> = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d,
      dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    });
  }
  return cells;
}

function isPastDate(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr) < today;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children, style }: { children: string; style?: object }) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

function PackageCard({
  pkg,
  selected,
  onSelect,
  accentColor,
  recommended = false,
}: {
  pkg: typeof SESSION_PACKAGES[number];
  selected: boolean;
  onSelect: () => void;
  accentColor?: string;
  recommended?: boolean;
}) {
  const ac = accentColor ?? C.green;
  return (
    <Pressable
      style={[
        styles.packageCard,
        selected ? { borderColor: ac, backgroundColor: `${ac}10` } : null,
        recommended && !selected ? { borderColor: `${ac}50` } : null,
      ]}
      onPress={onSelect}
    >
      <View style={styles.packageCardLeft}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.packageCardLabel, selected ? { color: ac } : null]}>
            {pkg.label}
          </Text>
          {recommended ? (
            <View style={[styles.recPill, { backgroundColor: `${ac}20`, borderColor: `${ac}50` }]}>
              <Text style={[styles.recPillText, { color: ac }]}>RECOMMENDED</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.packageCardSub}>{pkg.sessionsPerWeek} session{pkg.sessionsPerWeek > 1 ? 's' : ''} per week</Text>
      </View>
      <Text style={[styles.packageCardPrice, selected ? { color: ac } : null]}>
        ${pkg.weeklyPrice}<Text style={styles.packageCardPriceSub}>/wk</Text>
      </Text>
      {selected ? (
        <View style={[styles.packageCheckmark, { backgroundColor: ac }]}>
          <Text style={{ color: '#000', fontSize: 12 }}>✓</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function DurationCard({
  dur,
  weeklyPrice,
  selected,
  onSelect,
}: {
  dur: {
    id: DurationId;
    label: string;
    subtitle: string;
    weeks: number;
    savingsAmount: number;
    bonuses: readonly string[];
    giftItems: readonly string[];
  };
  weeklyPrice: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const total = weeklyPrice * dur.weeks - dur.savingsAmount;
  return (
    <Pressable
      style={[styles.durationCard, selected ? styles.durationCardSelected : null]}
      onPress={onSelect}
    >
      <View style={styles.durationCardTop}>
        <View>
          <Text style={[styles.durationCardLabel, selected ? { color: C.green } : null]}>
            {dur.label}
          </Text>
          <Text style={styles.durationCardSubtitle}>{dur.subtitle}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {dur.id === 'weekly' ? (
            <Text style={[styles.durationCardPrice, selected ? { color: C.green } : null]}>
              ${weeklyPrice}<Text style={styles.packageCardPriceSub}>/wk</Text>
            </Text>
          ) : (
            <>
              <Text style={[styles.durationCardPrice, selected ? { color: C.green } : null]}>
                ${total.toLocaleString()}
              </Text>
              {dur.savingsAmount > 0 ? (
                <View style={styles.savingsBadge}>
                  <Text style={styles.savingsBadgeText}>SAVE ${dur.savingsAmount.toLocaleString()}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>

      {dur.bonuses.length > 0 ? (
        <View style={styles.durationBonuses}>
          {dur.bonuses.map((b) => (
            <Text key={b} style={styles.durationBonus}>✦ {b}</Text>
          ))}
          <Text style={styles.durationGiftHeader}>🎁 Free Starter Pack:</Text>
          {dur.giftItems.map((g) => (
            <Text key={g} style={styles.durationGiftItem}>  · {g}</Text>
          ))}
        </View>
      ) : null}

      {selected ? <View style={[styles.packageCheckmark, { position: 'absolute', top: 12, right: 12 }]}><Text style={{ color: '#000', fontSize: 12 }}>✓</Text></View> : null}
    </Pressable>
  );
}

// ─── Mini Calendar ────────────────────────────────────────────────────────────

function MiniCalendar({
  selectedDate,
  onSelectDate,
  disableDate,
}: {
  selectedDate: string | null;
  onSelectDate: (d: string) => void;
  /** Optional extra predicate — return true to disable a date cell */
  disableDate?: (dateStr: string) => boolean;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const cells = getCalendarDays(year, month);
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  return (
    <View style={styles.calendar}>
      {/* Month nav */}
      <View style={styles.calHeader}>
        <Pressable style={styles.calNavBtn} onPress={prevMonth}>
          <Text style={styles.calNavText}>‹</Text>
        </Pressable>
        <Text style={styles.calMonthLabel}>{MONTH_NAMES[month]} {year}</Text>
        <Pressable style={styles.calNavBtn} onPress={nextMonth}>
          <Text style={styles.calNavText}>›</Text>
        </Pressable>
      </View>
      {/* Day headers */}
      <View style={styles.calDayRow}>
        {DAY_LABELS.map((d) => (
          <Text key={d} style={styles.calDayLabel}>{d}</Text>
        ))}
      </View>
      {/* Date grid */}
      <View style={styles.calGrid}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={`empty-${i}`} style={styles.calCell} />;
          const isPast = isPastDate(cell.dateStr);
          const isExtraDisabled = disableDate?.(cell.dateStr) ?? false;
          const isDisabled = isPast || isExtraDisabled;
          const isToday = cell.dateStr === todayStr;
          const isSelected = cell.dateStr === selectedDate;
          return (
            <Pressable
              key={cell.dateStr}
              style={[
                styles.calCell,
                isToday ? styles.calCellToday : null,
                isSelected ? styles.calCellSelected : null,
                isDisabled ? styles.calCellPast : null,
              ]}
              onPress={() => { if (!isDisabled) onSelectDate(cell.dateStr); }}
              disabled={isDisabled}
            >
              <Text style={[
                styles.calCellText,
                isSelected ? styles.calCellTextSelected : null,
                isDisabled ? styles.calCellTextPast : null,
                isToday && !isSelected ? { color: C.green } : null,
              ]}>
                {cell.day}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function GroupCoachingExplainer() {
  return (
    <View style={styles.groupExplainerCard}>
      <Text style={styles.groupExplainerEyebrow}>GROUP COACHING</Text>
      <Text style={styles.groupExplainerTitle}>What It Actually Feels Like</Text>
      <Text style={styles.groupExplainerBody}>
        Join a live coaching room where your coach leads the session, answers questions, calls out key adjustments, and keeps everyone moving with structure and momentum.
      </Text>
      <View style={styles.groupExplainerGrid}>
        {[
          { title: 'In The Room', body: 'Live coaching, Q&A, hot-seat feedback, and weekly momentum with other members.' },
          { title: 'Best For', body: 'People who want real coaching and accountability without paying for a private call every week.' },
          { title: 'What You Leave With', body: 'Clear next steps for training, nutrition, and mindset — plus a stronger feeling of community.' },
        ].map((item) => (
          <View key={item.title} style={styles.groupExplainerCell}>
            <Text style={styles.groupExplainerCellTitle}>{item.title}</Text>
            <Text style={styles.groupExplainerCellBody}>{item.body}</Text>
          </View>
        ))}
      </View>
      <View style={styles.groupExplainerBullets}>
        {[
          'Drop in for $50 or commit longer for savings and bonus access',
          'Shared energy, real accountability, and coach access every week',
          'Great bridge between self-guided Pro and full private coaching',
        ].map((line) => (
          <Text key={line} style={styles.groupExplainerBullet}>• {line}</Text>
        ))}
      </View>
    </View>
  );
}

// ─── Coaching Options Overview (shown before purchase flow) ───────────────────

function CollapsibleCoachSection({
  eyebrow,
  eyebrowColor,
  title,
  body,
  cells,
  bullets,
  borderColor,
  accentColor,
}: {
  eyebrow: string;
  eyebrowColor: string;
  title: string;
  body: string;
  cells: Array<{ title: string; body: string }>;
  bullets: string[];
  borderColor: string;
  accentColor: string;
}) {
  const [open, setOpen] = React.useState(false);
  const chevAnim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(chevAnim, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [open, chevAnim]);
  const chevRotate = chevAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={[styles.groupExplainerCard, { borderColor }]}>
      {/* Tappable header */}
      <Pressable
        style={styles.coachSectionHeader}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null); setOpen((o) => !o); }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.groupExplainerEyebrow, { color: eyebrowColor }]}>{eyebrow}</Text>
          <Text style={styles.groupExplainerTitle}>{title}</Text>
        </View>
        <Animated.Text style={[styles.coachSectionChevron, { color: accentColor, transform: [{ rotate: chevRotate }] }]}>
          ˅
        </Animated.Text>
      </Pressable>

      {/* Collapsible body */}
      {open && (
        <>
          <Text style={[styles.groupExplainerBody, { marginTop: 8 }]}>{body}</Text>
          <View style={styles.groupExplainerGrid}>
            {cells.map((item) => (
              <View key={item.title} style={styles.groupExplainerCell}>
                <Text style={styles.groupExplainerCellTitle}>{item.title}</Text>
                <Text style={styles.groupExplainerCellBody}>{item.body}</Text>
              </View>
            ))}
          </View>
          <View style={styles.groupExplainerBullets}>
            {bullets.map((line) => (
              <Text key={line} style={styles.groupExplainerBullet}>• {line}</Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function CoachingOptionsOverview({ accent }: { accent: string }) {
  return (
    <View style={{ gap: 10, marginBottom: 4 }}>
      <CollapsibleCoachSection
        eyebrow="PRIVATE COACHING"
        eyebrowColor={C.orange}
        title="What 1-on-1 Actually Delivers"
        body="Real eyes on your form, nutrition, and programming — your coach knows your numbers, your schedule, and your blockers. In your session, your coach is with you while you work."
        cells={[
          { title: 'In Your Sessions', body: 'Form reviews, live workout guidance, program adjustments, and weekly check-ins tailored to your exact data and goals.' },
          { title: 'Best For', body: 'People ready to commit, who want a dedicated coach who knows their training history inside out.' },
          { title: 'What You Leave With', body: 'A program built around you — not a template. Updated every week based on your real results.' },
        ]}
        bullets={[
          'Your coach has your full APEX data — workouts, nutrition, weight trends',
          'Plan adjusted between sessions based on your numbers',
        ]}
        borderColor={C.orangeBorder}
        accentColor={accent}
      />

      <CollapsibleCoachSection
        eyebrow="GROUP COACHING"
        eyebrowColor={C.blue}
        title={`Every Wednesday at ${groupSessionLocalTimeStr()}`}
        body="Join the live coaching room — your coach leads the session, answers questions, calls out key adjustments, and keeps everyone moving with structure and momentum."
        cells={[
          { title: 'In The Room', body: 'Live coaching, Q&A, hot-seat feedback, and weekly momentum with other members.' },
          { title: 'Best For', body: 'People who want real coaching and accountability without paying for a private call every week.' },
          { title: 'What You Leave With', body: 'Clear next steps for training, nutrition, and mindset — plus a stronger feeling of community.' },
        ]}
        bullets={[
          'Shared energy, real accountability, and coach access every week',
          'Great bridge between self-guided Pro and full private coaching',
        ]}
        borderColor={`${C.blue}40`}
        accentColor={accent}
      />
    </View>
  );
}

// ─── Session History Card ─────────────────────────────────────────────────────

function SessionHistoryCard({ session }: { session: CoachingSession }) {
  const statusColors: Record<string, string> = {
    upcoming: C.green, completed: C.muted, cancelled: C.orange, rescheduled: C.blue,
  };
  const typeLabels: Record<string, string> = {
    '1on1': '1-on-1', group: 'Group', mobility: 'Mobility',
  };
  return (
    <View style={styles.sessionHistoryCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sessionHistoryDate}>{formatSessionDate(session.date, session.time)}</Text>
        <Text style={styles.sessionHistoryMeta}>{typeLabels[session.type] ?? session.type}</Text>
      </View>
      <View style={[styles.sessionStatusDot, { backgroundColor: statusColors[session.status] ?? C.muted }]}>
        <Text style={styles.sessionStatusText}>{session.status.toUpperCase()}</Text>
      </View>
    </View>
  );
}

// ─── Bonus Tracker Card ───────────────────────────────────────────────────────

function BonusTrackerCard({ bonus }: { bonus: BonusTracker }) {
  const extrasLeft = bonus.extraSessionsTotal - bonus.extraSessionsUsed;
  const GIFT_COLOR: Record<string, string> = { pending: C.muted, processing: C.orange, shipped: C.blue, delivered: C.green };

  return (
    <View style={styles.bonusCard}>
      <Text style={styles.bonusCardTitle}>🎁 Your Bonus Tracker</Text>
      {bonus.extraSessionsTotal > 0 ? (
        <View style={styles.bonusSessionRow}>
          <Text style={styles.bonusSessionText}>Extra sessions: </Text>
          <Text style={[styles.bonusSessionCount, extrasLeft > 0 ? { color: C.green } : { color: C.muted }]}>
            {extrasLeft} of {bonus.extraSessionsTotal} remaining
          </Text>
        </View>
      ) : null}
      {bonus.gifts.length > 0 ? (
        <View style={{ marginTop: 10, gap: 8 }}>
          {bonus.gifts.map((gift) => (
            <View key={gift.id} style={styles.bonusGiftRow}>
              <Text style={styles.bonusGiftName}>{gift.name}</Text>
              <View style={[styles.bonusGiftBadge, { borderColor: GIFT_COLOR[gift.status] }]}>
                <Text style={[styles.bonusGiftStatus, { color: GIFT_COLOR[gift.status] }]}>
                  {gift.status.toUpperCase()}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {!bonus.shippingAddress ? (
        <View style={styles.addressWarning}>
          <Text style={styles.addressWarningText}>⚠️ Add your shipping address to receive gifts. Contact your coach via chat.</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Payment Step ─────────────────────────────────────────────────────────────

function PaymentStep({
  totalPrice,
  durationId,
  onBack,
  onPay,
}: {
  totalPrice: number;
  durationId: DurationId;
  onBack: () => void;
  onPay: () => void;
}) {
  const { accent } = useTheme();
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [name, setName] = useState('');
  const [processing, setProcessing] = useState(false);

  const formatCardNumber = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };

  const formatExpiry = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  };

  const isValid = cardNumber.replace(/\s/g, '').length === 16
    && expiry.length === 5
    && cvv.length >= 3
    && name.trim().length > 1;

  const handlePay = async () => {
    if (!isValid) return;
    setProcessing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Simulate secure payment processing
    await new Promise((r) => setTimeout(r, 1200));
    setProcessing(false);
    onPay();
  };

  const priceLabel = durationId === 'weekly'
    ? `$${totalPrice}/wk`
    : `$${totalPrice.toLocaleString()} total`;

  return (
    <>
      <Text style={styles.stepTitle}>Secure Payment</Text>
      <Text style={styles.stepSubtitle}>Your card info is encrypted and never stored on device.</Text>

      <View style={styles.paymentForm}>
        {/* Card number */}
        <Text style={styles.paymentFieldLabel}>Card Number</Text>
        <TextInput
          style={styles.paymentInput}
          value={cardNumber}
          onChangeText={(v) => setCardNumber(formatCardNumber(v))}
          placeholder="1234 5678 9012 3456"
          placeholderTextColor={C.muted}
          keyboardType="number-pad"
          maxLength={19}
        />

        {/* Name */}
        <Text style={styles.paymentFieldLabel}>Cardholder Name</Text>
        <TextInput
          style={styles.paymentInput}
          value={name}
          onChangeText={setName}
          placeholder="Full name on card"
          placeholderTextColor={C.muted}
          autoCapitalize="words"
        />

        {/* Expiry + CVV row */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.paymentFieldLabel}>Expiry</Text>
            <TextInput
              style={styles.paymentInput}
              value={expiry}
              onChangeText={(v) => setExpiry(formatExpiry(v))}
              placeholder="MM/YY"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              maxLength={5}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.paymentFieldLabel}>CVV</Text>
            <TextInput
              style={styles.paymentInput}
              value={cvv}
              onChangeText={(v) => setCvv(v.replace(/\D/g, '').slice(0, 4))}
              placeholder="123"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
            />
          </View>
        </View>

        {/* Security badge */}
        <View style={styles.paymentSecureBadge}>
          <Text style={styles.paymentSecureText}>🔒  256-bit SSL · Powered by Stripe</Text>
        </View>
      </View>

      <View style={[styles.btnRow, { marginTop: 8 }]}>
        <Pressable style={styles.btnGhost} onPress={onBack} disabled={processing}>
          <Text style={styles.btnGhostText}>← Back</Text>
        </Pressable>
        <Pressable
          style={[styles.btnPrimary, { flex: 1, backgroundColor: accent }, !isValid ? styles.btnDisabled : null]}
          onPress={handlePay}
          disabled={!isValid || processing}
        >
          <Text style={styles.btnPrimaryText}>
            {processing ? 'Processing...' : `Pay ${priceLabel} 🎉`}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

// ─── Fit Call Booking Modal ───────────────────────────────────────────────────

type FitCallStep = 'date' | 'time' | 'info' | 'success';

function getNext14Weekdays(): Array<{ label: string; dateStr: string }> {
  const results: Array<{ label: string; dateStr: string }> = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() + 1); // skip today
  while (results.length < 14) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      results.push({ label: formatFitCallDate(dateStr), dateStr });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return results;
}

function FitCallBookingModal({
  visible,
  onClose,
  userId,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
}) {
  const { accent } = useTheme();
  const [step, setStep] = useState<FitCallStep>('date');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsFallback, setSlotsFallback] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [challenge, setChallenge] = useState('');
  const [booking, setBooking] = useState(false);
  const [confirmedDate, setConfirmedDate] = useState('');
  const [confirmedTime, setConfirmedTime] = useState('');
  const [confirmedPhone, setConfirmedPhone] = useState('');

  const weekdays = React.useMemo(() => getNext14Weekdays(), []);

  const reset = () => {
    setStep('date');
    setSelectedDate(null);
    setSlots([]);
    setSlotsFallback(false);
    setSelectedTime(null);
    setClientName('');
    setClientPhone('');
    setChallenge('');
    setBooking(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSelectDate = async (dateStr: string) => {
    setSelectedDate(dateStr);
    setSlotsLoading(true);
    setSlotsFallback(false);
    setStep('time');
    try {
      const result = await fetchFitCallSlots(dateStr, env.supabaseUrl, env.supabaseAnonKey);
      console.log('[FitCall] slots result:', JSON.stringify(result));
      setSlots(result.slots);
      setSlotsFallback(result.caldavError !== null);
    } catch (e) {
      console.log('[FitCall] fetch error:', e);
      setSlots([]);
      setSlotsFallback(false);
    } finally {
      setSlotsLoading(false);
    }
  };

  const handleSelectTime = (time: string) => {
    setSelectedTime(time);
    setStep('info');
  };

  const handleConfirmBooking = async () => {
    if (!selectedDate || !selectedTime || !clientName.trim() || !clientPhone.trim()) return;
    setBooking(true);
    try {
      const result = await bookFitCall({
        userId,
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        challenge: challenge.trim(),
        date: selectedDate,
        time: selectedTime,
        supabaseUrl: env.supabaseUrl,
        supabaseAnonKey: env.supabaseAnonKey,
      });
      if (result.ok) {
        await saveFitCallBookingLocally({
          id: result.bookingId ?? `local-${Date.now()}`,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          challenge: challenge.trim(),
          sessionDate: selectedDate,
          sessionTime: selectedTime,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }).catch(() => null);
        setConfirmedDate(selectedDate);
        setConfirmedTime(selectedTime);
        setConfirmedPhone(clientPhone.trim());
        setStep('success');
      } else {
        Alert.alert('Booking failed', result.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      Alert.alert('Booking failed', 'Could not complete the booking. Please try again.');
    } finally {
      setBooking(false);
    }
  };

  const handleAddToCalendar = async () => {
    try {
      const [year, month, day] = confirmedDate.split('-').map(Number);
      const [hour, minute] = confirmedTime.split(':').map(Number);
      const pad = (n: number) => String(n).padStart(2, '0');
      const fmt = (y: number, mo: number, d: number, h: number, m: number) =>
        `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(m)}00`;
      const endTotalMin = hour * 60 + minute + 15;
      const start = fmt(year, month, day, hour, minute);
      const end = fmt(year, month, day, Math.floor(endTotalMin / 60) % 24, endTotalMin % 60);
      const title = encodeURIComponent('APEX Fit Call with Josh');
      const details = encodeURIComponent(`Josh will call you at ${confirmedPhone}. Free 15-min strategy call.`);
      const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`;
      await Linking.openURL(url);
    } catch (err) {
      console.error('[AddToCalendar]', err);
      Alert.alert('Could not open calendar', 'Please add the event manually.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
      <Pressable style={styles.exitOverlay} onPress={handleClose}>
        <Pressable style={styles.fitCallSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.exitHandle} />

          {/* ── Step: date ── */}
          {step === 'date' ? (
            <>
              <Text style={styles.fitCallTitle}>Pick a Date</Text>
              <Text style={styles.fitCallSub}>Choose one of the next 14 weekdays for your free 15-min call.</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 360 }}>
                {weekdays.map((item) => (
                  <Pressable
                    key={item.dateStr}
                    style={styles.fitCallDateRow}
                    onPress={() => handleSelectDate(item.dateStr)}
                  >
                    <Text style={styles.fitCallDateLabel}>{item.label}</Text>
                    <Text style={[styles.fitCallChevron, { color: accent }]}>›</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable style={[styles.skipBtn, { marginTop: 8 }]} onPress={handleClose}>
                <Text style={styles.skipBtnText}>Cancel</Text>
              </Pressable>
            </>
          ) : null}

          {/* ── Step: time ── */}
          {step === 'time' ? (
            <>
              <Text style={styles.fitCallTitle}>Pick a Time</Text>
              {selectedDate ? (
                <Text style={styles.fitCallSub}>{formatFitCallDate(selectedDate)}</Text>
              ) : null}
              {slotsLoading ? (
                <View style={styles.fitCallLoadingWrap}>
                  <Text style={styles.fitCallLoadingText}>Checking availability…</Text>
                </View>
              ) : slots.length === 0 ? (
                <View style={styles.fitCallLoadingWrap}>
                  <Text style={styles.fitCallLoadingText}>No availability on this day — try another date.</Text>
                  <Pressable style={[styles.btnGhost, { marginTop: 14 }]} onPress={() => setStep('date')}>
                    <Text style={styles.btnGhostText}>← Back</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {slotsFallback ? (
                    <Text style={styles.fitCallFallbackNote}>
                      ⚠️ Calendar sync unavailable — showing all open slots
                    </Text>
                  ) : null}
                  <View style={styles.fitCallSlotGrid}>
                    {slots.map((slot) => (
                      <Pressable
                        key={slot}
                        style={[
                          styles.fitCallSlot,
                          selectedTime === slot ? { backgroundColor: accent, borderColor: accent } : null,
                        ]}
                        onPress={() => handleSelectTime(slot)}
                      >
                        <Text style={[styles.fitCallSlotText, selectedTime === slot ? { color: '#000', fontFamily: 'DMSans_700Bold' } : null]}>
                          {formatFitCallTime(slot)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable style={[styles.btnGhost, { marginTop: 14 }]} onPress={() => setStep('date')}>
                    <Text style={styles.btnGhostText}>← Back</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : null}

          {/* ── Step: info ── */}
          {step === 'info' ? (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.fitCallTitle}>Your Info</Text>
              {selectedDate && selectedTime ? (
                <Text style={styles.fitCallSub}>
                  {formatFitCallDate(selectedDate)} at {formatFitCallTime(selectedTime)}
                </Text>
              ) : null}

              <Text style={styles.fitCallFieldLabel}>Your name</Text>
              <TextInput
                style={styles.fitCallInput}
                value={clientName}
                onChangeText={setClientName}
                placeholder="Full name"
                placeholderTextColor={C.muted}
                autoCapitalize="words"
              />

              <Text style={styles.fitCallFieldLabel}>Your phone number</Text>
              <TextInput
                style={styles.fitCallInput}
                value={clientPhone}
                onChangeText={setClientPhone}
                placeholder="(555) 555-5555"
                placeholderTextColor={C.muted}
                keyboardType="phone-pad"
              />

              <Text style={styles.fitCallFieldLabel}>What's your #1 challenge?</Text>
              <TextInput
                style={[styles.fitCallInput, styles.fitCallInputMulti]}
                value={challenge}
                onChangeText={setChallenge}
                placeholder="e.g. I can't seem to break my plateau..."
                placeholderTextColor={C.muted}
                multiline
                numberOfLines={3}
              />

              <View style={[styles.btnRow, { marginTop: 14 }]}>
                <Pressable style={styles.btnGhost} onPress={() => setStep('time')}>
                  <Text style={styles.btnGhostText}>← Back</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btnPrimary,
                    { flex: 1, backgroundColor: accent },
                    (!clientName.trim() || !clientPhone.trim() || booking) ? styles.btnDisabled : null,
                  ]}
                  onPress={handleConfirmBooking}
                  disabled={!clientName.trim() || !clientPhone.trim() || booking}
                >
                  <Text style={styles.btnPrimaryText}>{booking ? 'Booking…' : 'Confirm Booking'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : null}

          {/* ── Step: success ── */}
          {step === 'success' ? (
            <View style={styles.fitCallSuccessWrap}>
              <Text style={styles.fitCallSuccessEmoji}>✅</Text>
              <Text style={styles.fitCallSuccessTitle}>You're booked!</Text>
              <Text style={styles.fitCallSuccessBody}>
                Josh will call you at {confirmedPhone} on {formatFitCallDate(confirmedDate)} at {formatFitCallTime(confirmedTime)}.
              </Text>
              <Pressable
                style={[styles.btnPrimary, { backgroundColor: accent, marginTop: 16, alignSelf: 'stretch' }]}
                onPress={handleClose}
              >
                <Text style={styles.btnPrimaryText}>Done</Text>
              </Pressable>
              <Pressable
                style={[styles.fitCallCalendarBtn]}
                onPress={handleAddToCalendar}
              >
                <Text style={styles.fitCallCalendarBtnText}>📅  Add to your calendar</Text>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Purchase Flow ────────────────────────────────────────────────────────────

type PurchaseStep = 'package' | 'duration' | 'calendar' | 'confirm' | 'payment';
type CoachingTrack = '1on1' | 'group';
const RECURRENCE_OPTIONS: Array<{ id: RecurrencePreference; label: string; body: string }> = [
  {
    id: 'monthly_fixed',
    label: 'Keep this time for the rest of the month',
    body: 'We will lock these same session days and times for the next 4 weeks.',
  },
  {
    id: 'change_next_week',
    label: 'Change it for next week',
    body: 'We will book this week now, then you can adjust next week with your coach.',
  },
  {
    id: 'schedule_later',
    label: "Don't know my schedule yet",
    body: 'We will hold this week only and let you reschedule the rest later.',
  },
];

function getPackageRecommendation(profile: UserProfile | null): { packageId: PackageId; text: string } | null {
  if (!profile) return null;
  const goal = profile.goal ?? 'recomp';
  const exp = profile.experience ?? 'intermediate';

  if (exp === 'beginner') {
    return { packageId: '1x', text: 'As a beginner, 1 session/week lets you build great habits without overwhelm — your coach corrects form early before patterns set in.' };
  }
  if (goal === 'lose') {
    return { packageId: '1x', text: 'For fat loss, weekly check-ins are most effective — your coach adjusts nutrition and cardio based on your real week-to-week data.' };
  }
  if (goal === 'build') {
    return { packageId: '2x', text: 'For muscle building, 2 sessions/week gives you the programming density and progressive overload feedback that compounds fastest.' };
  }
  if (exp === 'advanced') {
    return { packageId: '2x', text: 'Advanced athletes benefit most from 2 sessions/week — the detail level in your programming requires closer coach attention.' };
  }
  return { packageId: '1x', text: 'Starting with 1 session/week is the most effective entry point — your coach will dial in your plan and you can always upgrade.' };
}

function PurchaseFlow({
  onComplete,
  insideScroll = false,
  userId = '',
}: {
  onComplete: (
    plan: ActiveCoachingPlan,
    bonus: BonusTracker | null,
    bookedSessions: CoachingSession[],
    sessionSchedule: SessionScheduleSlot[],
  ) => void;
  insideScroll?: boolean;
  userId?: string;
}) {
  const navigation = useNavigation<any>();
  const { accent, accentSoft, accentBorder } = useTheme();
  const [step, setStep] = useState<PurchaseStep>('package');
  const [coachingTrack, setCoachingTrack] = useState<CoachingTrack>('1on1');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeCoachVoice, setActiveCoachVoice] = useState<CoachVoiceOption | null>(null);
  React.useEffect(() => { loadCachedProfile().then(setUserProfile).catch(() => null); }, []);
  React.useEffect(() => { getSelectedCoachVoice().then(setActiveCoachVoice).catch(() => null); }, []);
  const [selectedPackage, setSelectedPackage] = useState<PackageId>('1x');
  const [selectedDuration, setSelectedDuration] = useState<DurationId>('weekly');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<Array<{ date: string; time: string }>>([]);
  const [recurrenceVisible, setRecurrenceVisible] = useState(false);
  const [recurrencePreference, setRecurrencePreference] = useState<RecurrencePreference>('monthly_fixed');
  const [showExitOffer, setShowExitOffer] = useState(false);
  // Calendar availability (1-on-1)
  const [busyPeriods, setBusyPeriods] = useState<BusyPeriod[]>([]);
  const [calCheckLoading, setCalCheckLoading] = useState(false);

  const handleTrialAccept = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    const trialEnd = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const trialEndsDate = trialEnd.toISOString().split('T')[0];
    const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const plan: ActiveCoachingPlan = {
      id: `trial-${Date.now()}`,
      packageId: '1x',
      durationId: '3month',
      sessionType: '1on1',
      startDate,
      endDate,
      totalPaid: 0,
      status: 'active',
      bookingRecurrence: 'weekly',
      isTrial: true,
      trialEndsDate,
    };
    const sessionSchedule = [{ date: trialEndsDate, time: '10:00', type: '1on1' as const }];
    const bookedSessions = buildRecurringSessions({
      durationWeeks: 4,
      recurrencePreference: 'monthly_fixed',
      selectedSlots: sessionSchedule,
    });
    setShowExitOffer(false);
    onComplete(plan, null, bookedSessions, sessionSchedule);
  };

  const availablePackages = SESSION_PACKAGES.filter((item) => item.sessionType === coachingTrack);
  const durationOptions = getDurationOptionsForSessionType(coachingTrack);
  const pkg = getPackageById(selectedPackage) ?? availablePackages[0];
  const dur = getDurationOptionForPackage(pkg.id, selectedDuration) ?? durationOptions[0];
  const totalPrice = calcPrice(selectedPackage, selectedDuration);

  React.useEffect(() => {
    const nextPackage = availablePackages[0];
    if (!nextPackage) return;
    if (nextPackage.id !== selectedPackage && !availablePackages.some((item) => item.id === selectedPackage)) {
      setSelectedPackage(nextPackage.id);
    }
  }, [availablePackages, selectedPackage]);

  const handleConfirm = async () => {
    if (!selectedSlots.length) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const startDate = new Date().toISOString().split('T')[0];
    const endMs = new Date().getTime() + dur.weeks * 7 * 24 * 60 * 60 * 1000;
    const endDate = new Date(endMs).toISOString().split('T')[0];
    const bookedSessions = buildRecurringSessions({
      durationWeeks: dur.weeks,
      recurrencePreference,
      selectedSlots: selectedSlots.map((slot) => ({ ...slot, type: coachingTrack })),
    });
    const firstSession = bookedSessions[0];

    const plan: ActiveCoachingPlan = {
      id: `plan-${Date.now()}`,
      packageId: selectedPackage,
      durationId: selectedDuration,
      sessionType: coachingTrack,
      startDate,
      endDate,
      totalPaid: totalPrice,
      status: 'active',
      nextSessionDate: firstSession?.date,
      nextSessionTime: firstSession?.time,
      bookingRecurrence: recurrencePreference === 'monthly_fixed' ? 'weekly' : 'custom',
      recurrencePreference,
    };
    const bonus = buildBonusTrackerFromPlan(selectedPackage, selectedDuration, coachingTrack);
    onComplete(
      plan,
      bonus,
      bookedSessions,
      selectedSlots.map((slot) => ({ ...slot, type: coachingTrack })),
    );
  };

  const FlowContainer = insideScroll ? View : ScrollView;
  const flowContainerProps = insideScroll
    ? { style: styles.content }
    : { style: styles.scroll, contentContainerStyle: styles.content, showsVerticalScrollIndicator: false };

  return (
    <FlowContainer {...(flowContainerProps as any)}>
      {/* Step indicator */}
      <View style={styles.stepRow}>
        {(['package', 'duration', 'calendar', 'confirm', 'payment'] as PurchaseStep[]).map((s, i) => (
          <React.Fragment key={s}>
            <View style={[
              styles.stepDot,
              step === s ? { backgroundColor: accent, borderColor: accent } : null,
              step > s ? { backgroundColor: `${accent}80`, borderColor: `${accent}80` } : null,
            ]}>
              <Text style={[styles.stepDotText, step === s || step > s ? { color: '#000' } : null]}>{i + 1}</Text>
            </View>
            {i < 4 ? <View style={[styles.stepLine, step > s ? { backgroundColor: `${accent}80` } : null]} /> : null}
          </React.Fragment>
        ))}
      </View>

      {/* ── Step 1: Package ── */}
      {step === 'package' ? (
        <>
          {/* ── Josh profile card + fit call CTA ── */}
          <View style={styles.fitCallProfileCard}>
            <View style={styles.fitCallProfileHeader}>
              <Image
                source={require('../../assets/josh-coach.png')}
                style={styles.fitCallAvatar}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.fitCallProfileName}>Joshua Saunders</Text>
                <Text style={styles.fitCallProfileTitle}>APEX Head Coach · Swoldier Nation</Text>
              </View>
            </View>
            <Text style={styles.fitCallProfileBio}>
              Combat Vet — deployed 5 times, earned 5 air medals. Former Classic Physique competitor. 8+ years of coaching real people to real results. Certified in Personal Training, Strength & Conditioning, Corrective Exercise, & Nutrition Coaching. Message me below.
            </Text>
            <View style={styles.fitCallSocialRow}>
              <Pressable
                style={styles.fitCallSocialBtn}
                onPress={() => Linking.openURL('https://www.tiktok.com/@bodybyreasonbbr').catch(() => null)}
              >
                <Text style={styles.fitCallSocialText}>🎵 @BodyByReasonBBR</Text>
              </Pressable>
              <Pressable
                style={styles.fitCallSocialBtn}
                onPress={() => Linking.openURL('https://instagram.com/BodyByReason').catch(() => null)}
              >
                <Text style={styles.fitCallSocialText}>📸 @BodyByReason</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            style={[styles.fitCallCTA, { backgroundColor: accent }]}
            onPress={() => navigation.navigate('FormReview', { exerciseName: 'General Form Check', hasLiveCoach: true })}
          >
            <Text style={styles.fitCallCTAText}>Send Form Video to Coach Josh</Text>
          </Pressable>

        </>
      ) : null}

      {/* ── Step 2: Duration ── */}
          {step === 'duration' ? (
        <>
          <Text style={styles.stepTitle}>Choose Your Commitment</Text>
          <Text style={styles.stepSubtitle}>
            {coachingTrack === 'group'
              ? 'Stay close to the coaching room, save over time, and unlock group-only bonuses.'
              : 'Longer commitments unlock big savings and bonus gifts.'}
          </Text>
          {coachingTrack === 'group' ? (
            <View style={styles.groupCommitCard}>
              <Text style={styles.groupCommitTitle}>Why commit to the room?</Text>
              <Text style={styles.groupCommitBody}>
                Weekly keeps you flexible. Three months helps you build momentum. Annual gives you the deepest savings and turns group coaching into part of your lifestyle instead of a one-off burst.
              </Text>
            </View>
          ) : null}
          {durationOptions.map((d) => (
            <DurationCard
              key={d.id}
              dur={d}
              weeklyPrice={pkg.weeklyPrice}
              selected={selectedDuration === d.id}
              onSelect={() => setSelectedDuration(d.id)}
            />
          ))}
          <View style={styles.btnRow}>
            <Pressable style={styles.btnGhost} onPress={() => setStep('package')}>
              <Text style={styles.btnGhostText}>← Back</Text>
            </Pressable>
            <Pressable style={[styles.btnPrimary, { flex: 1, backgroundColor: accent }]} onPress={() => setStep('calendar')}>
              <Text style={styles.btnPrimaryText}>Continue →</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* ── Step 3: Calendar ── */}
      {step === 'calendar' ? (
        <>
          <Text style={styles.stepTitle}>
            {coachingTrack === 'group' ? 'Choose Your Wednesday' : 'Book Your Sessions'}
          </Text>
          <Text style={styles.stepSubtitle}>
            {coachingTrack === 'group'
              ? `Group sessions run every Wednesday at ${groupSessionLocalTimeStr()}. Pick your first Wednesday to join.`
              : `Pick ${pkg.sessionsPerWeek} session${pkg.sessionsPerWeek > 1 ? 's' : ''} for this week. Times shown in your local timezone.`}
          </Text>

          {/* Group track: Wednesday-only calendar + auto-set time */}
          {coachingTrack === 'group' ? (
            <>
              <MiniCalendar
                selectedDate={selectedDate}
                onSelectDate={(d) => {
                  if (!isWednesdayDate(d)) {
                    Alert.alert('Wednesdays Only', 'Group sessions run every Wednesday. Please select a Wednesday.');
                    return;
                  }
                  const localTime = groupSessionLocalTime24();
                  setSelectedDate(d);
                  setSelectedTime(localTime);
                  // Auto-add the slot
                  setSelectedSlots([{ date: d, time: localTime }]);
                }}
                disableDate={(d) => !isWednesdayDate(d)}
              />
              {selectedDate ? (
                <View style={styles.confirmCard}>
                  <Text style={styles.confirmLabel}>Group Session Booked</Text>
                  <Text style={styles.confirmValue}>
                    {formatSessionDate(selectedDate, selectedTime ?? groupSessionLocalTime24())} · {groupSessionLocalTimeStr()}
                  </Text>
                  <Text style={[styles.confirmLabel, { marginTop: 4 }]}>Sessions repeat every Wednesday at this time.</Text>
                </View>
              ) : null}
            </>
          ) : (
            /* 1-on-1 track: full calendar with availability check */
            <>
              <MiniCalendar
                selectedDate={selectedDate}
                onSelectDate={async (d) => {
                  setSelectedDate(d);
                  setSelectedTime(null);
                  setCalCheckLoading(true);
                  try {
                    const calSettings = await getCalendarSettings();
                    if (calSettings.googleApiKey && calSettings.googleCalendarId) {
                      const busy = await fetchBusyTimes(d, calSettings.googleApiKey, calSettings.googleCalendarId);
                      setBusyPeriods(busy);
                    } else {
                      setBusyPeriods([]);
                    }
                  } catch {
                    setBusyPeriods([]);
                  } finally {
                    setCalCheckLoading(false);
                  }
                }}
              />
              {selectedDate ? (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
                    {calCheckLoading ? 'Checking availability…' : 'Select a Time (Your Local Timezone)'}
                  </Text>
                  <View style={styles.timeGrid}>
                    {TIME_SLOTS.map((t) => {
                      const available = isSlotAvailable(t, selectedDate, busyPeriods);
                      return (
                        <Pressable
                          key={t}
                          style={[
                            styles.timeSlot,
                            selectedTime === t ? styles.timeSlotSelected : null,
                            !available ? { opacity: 0.3 } : null,
                          ]}
                          onPress={() => available ? setSelectedTime(t) : Alert.alert('Unavailable', 'That time is already booked. Please choose another.')}
                        >
                          <Text style={[styles.timeSlotText, selectedTime === t ? styles.timeSlotTextSelected : null]}>
                            {t}
                          </Text>
                          {!available ? <Text style={{ fontSize: 8, color: C.muted, textAlign: 'center' }}>booked</Text> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable
                    style={[
                      styles.btnPrimary,
                      { marginTop: 14, backgroundColor: accent },
                      (!selectedDate || !selectedTime || selectedSlots.length >= pkg.sessionsPerWeek) ? styles.btnDisabled : null,
                    ]}
                    onPress={() => {
                      if (!selectedDate || !selectedTime) return;
                      const slotKey = `${selectedDate}-${selectedTime}`;
                      if (selectedSlots.some((slot) => `${slot.date}-${slot.time}` === slotKey)) {
                        Alert.alert('Already added', 'That slot is already in your weekly schedule.');
                        return;
                      }
                      setSelectedSlots((prev) => [...prev, { date: selectedDate, time: selectedTime }].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)));
                      setSelectedDate(null);
                      setSelectedTime(null);
                    }}
                    disabled={!selectedDate || !selectedTime || selectedSlots.length >= pkg.sessionsPerWeek}
                  >
                    <Text style={styles.btnPrimaryText}>
                      {selectedSlots.length >= pkg.sessionsPerWeek ? '✓ Sessions selected' : 'Add This Session'}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </>
          )}
          <View style={styles.confirmCard}>
            <Text style={styles.confirmLabel}>Selected This Week</Text>
            {selectedSlots.length === 0 ? (
              <Text style={styles.confirmValue}>No sessions selected yet.</Text>
            ) : (
              selectedSlots.map((slot) => (
                <View key={`${slot.date}-${slot.time}`} style={styles.confirmRow}>
                  <Text style={styles.confirmValue}>{formatSessionDate(slot.date, slot.time)}</Text>
                  <Pressable onPress={() => setSelectedSlots((prev) => prev.filter((item) => !(item.date === slot.date && item.time === slot.time)))}>
                    <Text style={[styles.confirmLabel, { color: C.orange }]}>Remove</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>
          <View style={[styles.btnRow, { marginTop: 20 }]}>
            <Pressable style={styles.btnGhost} onPress={() => setStep('duration')}>
              <Text style={styles.btnGhostText}>← Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 1, backgroundColor: accent }, selectedSlots.length !== pkg.sessionsPerWeek ? styles.btnDisabled : null]}
              onPress={() => { if (selectedSlots.length === pkg.sessionsPerWeek) setRecurrenceVisible(true); }}
              disabled={selectedSlots.length !== pkg.sessionsPerWeek}
            >
              <Text style={styles.btnPrimaryText}>Continue →</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* ── Step 4: Confirm ── */}
      {step === 'confirm' ? (
        <>
          <Text style={styles.stepTitle}>Confirm & Book</Text>
          <View style={styles.confirmCard}>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Package</Text>
              <Text style={styles.confirmValue}>{pkg.label}</Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Coaching Type</Text>
              <Text style={styles.confirmValue}>{coachingTrack === 'group' ? 'Group Coaching' : '1-on-1 Coaching'}</Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Duration</Text>
              <Text style={styles.confirmValue}>{dur.label}</Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Recurrence</Text>
              <Text style={styles.confirmValue}>{RECURRENCE_OPTIONS.find((option) => option.id === recurrencePreference)?.label ?? 'Custom'}</Text>
            </View>
            {selectedSlots.map((slot, index) => (
              <View key={`${slot.date}-${slot.time}`} style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>{index === 0 ? 'Booked Sessions' : ''}</Text>
                <Text style={styles.confirmValue}>{formatSessionDate(slot.date, slot.time)}</Text>
              </View>
            ))}
            {dur.savingsAmount > 0 ? (
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Savings</Text>
                <Text style={[styles.confirmValue, { color: C.green }]}>-${dur.savingsAmount.toLocaleString()}</Text>
              </View>
            ) : null}
            <View style={[styles.confirmRow, { borderTopWidth: 1, borderTopColor: C.border, marginTop: 8, paddingTop: 8 }]}>
              <Text style={[styles.confirmLabel, { color: C.text, fontFamily: 'DMSans_700Bold' }]}>Total</Text>
              <Text style={[styles.confirmValue, { color: accent, fontSize: 18, fontFamily: 'DMSans_700Bold' }]}>
                {dur.id === 'weekly' ? `$${totalPrice}/wk` : `$${totalPrice.toLocaleString()}`}
              </Text>
            </View>
          </View>

          {dur.bonuses.length > 0 ? (
          <View style={styles.bonusPreviewCard}>
            <Text style={styles.bonusPreviewTitle}>🎁 Included Bonuses</Text>
            {dur.bonuses.map((b) => (
              <Text key={b} style={styles.bonusPreviewItem}>✦ {b}</Text>
            ))}
            {dur.giftItems.length ? (
              <>
                <Text style={[styles.bonusPreviewTitle, { marginTop: 10 }]}>Free Starter Pack:</Text>
                {dur.giftItems.map((g) => (
                  <Text key={g} style={styles.bonusPreviewItem}>  · {g}</Text>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

          <View style={[styles.btnRow, { marginTop: 8 }]}>
            <Pressable style={styles.btnGhost} onPress={() => setStep('calendar')}>
              <Text style={styles.btnGhostText}>← Back</Text>
            </Pressable>
            <Pressable style={[styles.btnPrimary, { flex: 1, backgroundColor: accent }]} onPress={() => setStep('payment')}>
              <Text style={styles.btnPrimaryText}>Proceed to Payment →</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* ── Step 5: Payment ── */}
      {step === 'payment' ? (
        <PaymentStep
          totalPrice={totalPrice}
          durationId={selectedDuration}
          onBack={() => setStep('confirm')}
          onPay={handleConfirm}
        />
      ) : null}

      <View style={{ height: 40 }} />

      {/* ── Exit / Free Trial Offer Modal ── */}
      <Modal visible={showExitOffer} transparent animationType="slide" onRequestClose={() => setShowExitOffer(false)}>
        <Pressable style={styles.exitOverlay} onPress={() => setShowExitOffer(false)}>
          <Pressable style={styles.exitSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.exitHandle} />

            {/* Offer header */}
            <Text style={styles.exitEmoji}>🎁</Text>
            <Text style={styles.exitTitle}>Wait — Try It Free First</Text>
            <Text style={styles.exitSub}>
              Not ready to commit? We get it. Start with 2 weeks of live 1-on-1 coaching, completely free. No credit card required upfront.
            </Text>

            {/* Terms cards */}
            {[
              { icon: '⏱', heading: '2 Weeks Free', body: 'Full 1-on-1 access with your dedicated coach. Zero cost.' },
              { icon: '🔓', heading: 'Cancel Anytime', body: 'If it\'s not for you, cancel before your free trial ends — no questions asked.' },
              { icon: '💰', heading: '30-Day Refund Guarantee', body: "After the free trial, if you're not happy in the first 30 days, we'll refund you in full." },
            ].map((item) => (
              <View key={item.icon} style={styles.exitTermCard}>
                <Text style={styles.exitTermIcon}>{item.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exitTermHeading}>{item.heading}</Text>
                  <Text style={styles.exitTermBody}>{item.body}</Text>
                </View>
              </View>
            ))}

            {/* CTAs */}
            <Pressable
              style={({ pressed }) => [styles.btnPrimary, { marginTop: 8, backgroundColor: accent }, pressed && { opacity: 0.85 }]}
              onPress={handleTrialAccept}
            >
              <Text style={styles.btnPrimaryText}>🚀 Start My Free 2 Weeks</Text>
            </Pressable>
            <Pressable
              style={[styles.skipBtn, { marginTop: 4 }]}
              onPress={() => {
                setShowExitOffer(false);
                navigation.goBack();
              }}
            >
              <Text style={styles.skipBtnText}>No thanks, I'll skip coaching</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={recurrenceVisible} transparent animationType="fade" onRequestClose={() => setRecurrenceVisible(false)}>
        <Pressable style={styles.exitOverlay} onPress={() => setRecurrenceVisible(false)}>
          <Pressable style={styles.exitSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.exitHandle} />
            <Text style={styles.exitTitle}>How should we handle next week?</Text>
            <Text style={styles.exitSub}>Choose how you want these session times handled after this week.</Text>
            {RECURRENCE_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                style={[styles.durationCard, recurrencePreference === option.id ? styles.durationCardSelected : null]}
                onPress={() => setRecurrencePreference(option.id)}
              >
                <Text style={[styles.durationCardLabel, recurrencePreference === option.id ? { color: accent } : null]}>{option.label}</Text>
                <Text style={styles.durationCardSubtitle}>{option.body}</Text>
              </Pressable>
            ))}
            <View style={styles.btnRow}>
              <Pressable style={styles.btnGhost} onPress={() => setRecurrenceVisible(false)}>
                <Text style={styles.btnGhostText}>← Back</Text>
              </Pressable>
              <Pressable style={[styles.btnPrimary, { flex: 1, backgroundColor: accent }]} onPress={() => {
                setRecurrenceVisible(false);
                setStep('confirm');
              }}>
                <Text style={styles.btnPrimaryText}>Use This Schedule</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </FlowContainer>
  );
}

// ─── Coach Chat Modal ─────────────────────────────────────────────────────────

type ChatMessage = {
  id: string;
  sender: 'coach' | 'client';
  text: string;
  created_at: string;
  /** Local URI for media attachment */
  mediaUri?: string;
  /** Type of attached media */
  mediaType?: 'image' | 'video' | 'audio';
  /** Duration in seconds for audio messages */
  audioDuration?: number;
};

function AudioPlayButton({ uri }: { uri: string }) {
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const toggle = async () => {
    if (playing) {
      await soundRef.current?.pauseAsync().catch(() => null);
      setPlaying(false);
    } else {
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri }, {}, (status) => {
          if ('didJustFinish' in status && status.didJustFinish) {
            setPlaying(false);
            soundRef.current = null;
          }
        });
        soundRef.current = sound;
      }
      await soundRef.current.playAsync().catch(() => null);
      setPlaying(true);
    }
  };

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => null); }, []);

  return (
    <Pressable style={styles.audioPlayBtn} onPress={toggle}>
      <Text style={styles.audioPlayIcon}>{playing ? '⏸' : '▶'}</Text>
      <View style={styles.audioWaveform}>
        {Array.from({ length: 18 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.audioBar,
              { height: 4 + Math.sin(i * 0.8) * 10 + Math.abs(Math.sin(i * 1.3)) * 6 },
              playing && { backgroundColor: C.green },
            ]}
          />
        ))}
      </View>
      <Text style={styles.audioLabel}>Voice</Text>
    </Pressable>
  );
}

const chatStorageKey = (userId: string) => `apex.liveCoach.chat.${userId}`;

function CoachChatModal({
  visible,
  userId,
  coachId,
  onClose,
}: {
  visible: boolean;
  userId: string;
  coachId?: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const flatRef = useRef<FlatList>(null);

  // ── Load persisted messages from AsyncStorage ─────────────────────────────
  useEffect(() => {
    if (!visible || !userId) return;
    const loadMessages = async () => {
      try {
        // Primary: AsyncStorage (always available, survives app restarts)
        const raw = await AsyncStorage.getItem(chatStorageKey(userId));
        if (raw) {
          const stored = JSON.parse(raw) as ChatMessage[];
          setMessages(stored);
          setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
          return;
        }
        // Fallback: try Supabase for legacy messages
        const { data } = await supabase
          .from('coach_messages')
          .select('id, sender_role, content, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: true })
          .limit(100);
        if (data?.length) {
          const remote = data.map((row: any) => ({
            id: row.id,
            sender: row.sender_role === 'coach' ? 'coach' : 'client',
            text: row.content,
            created_at: row.created_at,
          })) as ChatMessage[];
          setMessages(remote);
          // Back-fill local storage so next open is instant
          await AsyncStorage.setItem(chatStorageKey(userId), JSON.stringify(remote));
        }
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
      } catch {
        // ignore
      }
    };
    loadMessages();
  }, [visible, userId]);

  // ── Persist updated message list to AsyncStorage ──────────────────────────
  const persistMessages = async (updated: ChatMessage[]) => {
    try {
      await AsyncStorage.setItem(chatStorageKey(userId), JSON.stringify(updated));
    } catch { /* ignore */ }
  };

  const pushMessage = (msg: ChatMessage) => {
    setMessages((prev) => {
      const updated = [...prev, msg];
      persistMessages(updated);
      return updated;
    });
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');
    const optimistic: ChatMessage = { id: `opt-${Date.now()}`, sender: 'client', text, created_at: new Date().toISOString() };
    pushMessage(optimistic);
    // Best-effort sync to Supabase — doesn't block UX
    supabase.from('coach_messages').insert({
      user_id: userId,
      coach_id: coachId ?? null,
      sender_role: 'user',
      content: text,
    }).then(() => null, () => null);
    setSending(false);
  };

  const handlePickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to send photos and videos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const isVideo = asset.type === 'video';
    const msg: ChatMessage = {
      id: `media-${Date.now()}`,
      sender: 'client',
      text: isVideo ? '📹 Video' : '📷 Photo',
      mediaUri: asset.uri,
      mediaType: isVideo ? 'video' : 'image',
      created_at: new Date().toISOString(),
    };
    pushMessage(msg);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    // In production: upload to Supabase Storage and save URL in DB
  };

  const handleCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take photos and videos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const isVideo = asset.type === 'video';
    const msg: ChatMessage = {
      id: `cam-${Date.now()}`,
      sender: 'client',
      text: isVideo ? '📹 Video' : '📷 Photo',
      mediaUri: asset.uri,
      mediaType: isVideo ? 'video' : 'image',
      created_at: new Date().toISOString(),
    };
    pushMessage(msg);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Allow microphone access to send voice memos.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecording(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    } catch {
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      setRecording(null);
      setIsRecording(false);
      if (!uri) return;
      const msg: ChatMessage = {
        id: `audio-${Date.now()}`,
        sender: 'client',
        text: '🎙️ Voice memo',
        mediaUri: uri,
        mediaType: 'audio',
        created_at: new Date().toISOString(),
      };
      pushMessage(msg);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
    } catch {
      setIsRecording(false);
      setRecording(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={styles.chatOverlay} onPress={onClose}>
          <View style={styles.chatModal}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatHeaderTitle}>💬 Message Coach</Text>
              <Pressable onPress={onClose} hitSlop={12}>
                <Text style={{ color: C.muted, fontSize: 20 }}>✕</Text>
              </Pressable>
            </View>

            <FlatList
              ref={flatRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={{ padding: 16, gap: 10 }}
              ListEmptyComponent={
                <Text style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>
                  No messages yet. Send a message to your coach!
                </Text>
              }
              renderItem={({ item: m }) => {
                const isClient = m.sender === 'client';
                return (
                  <View style={[styles.chatBubbleWrap, isClient ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                    <View style={[styles.chatBubble, isClient ? styles.chatBubbleClient : styles.chatBubbleCoach]}>
                      {m.mediaType === 'image' && m.mediaUri ? (
                        <Image source={{ uri: m.mediaUri }} style={styles.chatMediaImage} resizeMode="cover" />
                      ) : m.mediaType === 'video' && m.mediaUri ? (
                        <View style={styles.chatVideoThumb}>
                          <Image source={{ uri: m.mediaUri }} style={styles.chatMediaImage} resizeMode="cover" />
                          <View style={styles.chatVideoPlay}><Text style={{ fontSize: 20 }}>▶</Text></View>
                        </View>
                      ) : m.mediaType === 'audio' && m.mediaUri ? (
                        <AudioPlayButton uri={m.mediaUri} />
                      ) : null}
                      {m.text && !['📷 Photo', '📹 Video', '🎙️ Voice memo'].includes(m.text) ? (
                        <Text style={[styles.chatBubbleText, isClient ? { color: '#000' } : null]}>{m.text}</Text>
                      ) : m.text && m.mediaType ? (
                        <Text style={[styles.chatBubbleText, { fontSize: 11, opacity: 0.6 }, isClient ? { color: '#000' } : null]}>{m.text}</Text>
                      ) : (
                        <Text style={[styles.chatBubbleText, isClient ? { color: '#000' } : null]}>{m.text}</Text>
                      )}
                    </View>
                  </View>
                );
              }}
            />

            {/* Input row with media + voice buttons */}
            <View style={[styles.chatInputRow, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              {/* Photo/video picker */}
              <Pressable style={styles.chatMediaBtn} onPress={handlePickImage} hitSlop={8}>
                <Text style={styles.chatMediaBtnIcon}>🖼</Text>
              </Pressable>
              {/* Camera */}
              <Pressable style={styles.chatMediaBtn} onPress={handleCamera} hitSlop={8}>
                <Text style={styles.chatMediaBtnIcon}>📷</Text>
              </Pressable>
              {/* Voice memo — hold to record, tap again to stop */}
              <Pressable
                style={[styles.chatMediaBtn, isRecording && styles.chatMediaBtnActive]}
                onPress={isRecording ? stopRecording : startRecording}
                hitSlop={8}
              >
                <Text style={styles.chatMediaBtnIcon}>{isRecording ? '⏹' : '🎙'}</Text>
              </Pressable>

              <TextInput
                style={[styles.chatInput, { flex: 1 }]}
                value={input}
                onChangeText={setInput}
                placeholder={isRecording ? 'Recording… tap ⏹ to send' : 'Message your coach...'}
                placeholderTextColor={C.muted}
                onSubmitEditing={handleSend}
                returnKeyType="send"
                editable={!isRecording}
              />
              <Pressable
                style={[styles.chatSendBtn, (!input.trim() || sending) ? styles.chatSendBtnDisabled : null]}
                onPress={handleSend}
                disabled={!input.trim() || sending}
              >
                <Text style={styles.chatSendIcon}>↑</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Active Plan Dashboard ────────────────────────────────────────────────────

// ─── Workout Plan Panel ───────────────────────────────────────────────────────

/**
 * WorkoutPlanPanel
 *
 * Shown inside the Live Coaching dashboard so coaches can see and edit the
 * client's current AI workout plan during a live 1-on-1 session.
 * Loads from AsyncStorage (same source as TrainScreen) and lets the coach
 * update sets & reps inline, saving changes back immediately.
 */
/** Maps a JS .getDay() (0=Sun) to a 0-based Mon-Sun schedule index */
function todayPlanIndex(): number {
  const jsDay = new Date().getDay(); // 0=Sun, 1=Mon … 6=Sat
  return jsDay === 0 ? 6 : jsDay - 1;
}

/** Converts a WorkoutProgramDay into a lightweight AIWorkout shape for display */
function planDayToWorkout(day: WorkoutProgramDay, planTitle: string): AIWorkout {
  return {
    name: day.name,
    duration: day.exercises.length * 8, // rough estimate
    focus: day.meta,
    coachNote: `From your ${planTitle} program`,
    generatedAt: new Date().toISOString(),
    exercises: day.exercises.map((ex) => ({
      name: ex.name,
      sets: parseInt(ex.sets.split(' x ')[0] ?? '3', 10) || 3,
      reps: ex.sets.split(' x ')[1]?.split(' ')[0] ?? '8-10',
      rest: '90s',
    })),
  };
}

function WorkoutPlanPanel({ editable = false }: { editable?: boolean }) {
  const [workout, setWorkout] = useState<AIWorkout | null>(null);
  const [programName, setProgramName] = useState<string | null>(null);
  const [isAiWorkout, setIsAiWorkout] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editSets, setEditSets] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [aiWorkout, aiProgram] = await Promise.all([getAIWorkout(), getAIProgram()]);

      // ── Case 1: A specific workout was pushed from AI Coach today ────────────
      if (aiWorkout) {
        setWorkout(aiWorkout);
        setIsAiWorkout(true);
        setProgramName(aiProgram?.title ?? null);
        return;
      }

      // ── Load user profile to resolve active plan ──────────────────────────────
      const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY).catch(() => null);
      const profile: UserProfile = raw ? JSON.parse(raw) : {};

      const planId = profile.activePlanId;

      // ── Case 2: AI-generated program is active (from Plans / AI Coach) ────────
      // No day-specific workout was pushed yet — show program summary card.
      if (planId === 'ai-generated' && aiProgram) {
        setWorkout({
          name: `${aiProgram.icon ?? '🤖'} ${aiProgram.title}`,
          duration: 60,
          focus: aiProgram.focus ?? aiProgram.subtitle,
          coachNote: aiProgram.coachNote ?? 'Go to AI Coach and ask for today\'s workout to see your full exercise list.',
          generatedAt: aiProgram.generatedAt,
          exercises: [],
        });
        setProgramName(`${aiProgram.durationWeeks}wk · ${aiProgram.daysPerWeek}x/wk · ${aiProgram.level}`);
        setIsAiWorkout(true);
        return;
      }

      // ── Case 3: Static named plan (or fallback suggestion) ────────────────────
      // Resolve plan ID: use profile value, or auto-suggest based on goal/experience.
      const resolvedId = (planId && planId !== 'ai-generated')
        ? planId
        : getSuggestedPlanId(profile.goal ?? 'recomp', profile.experience ?? 'intermediate');

      const plan = getPlanById(resolvedId as Parameters<typeof getPlanById>[0]);
      const todayDay = plan.schedule[todayPlanIndex()] ?? plan.schedule[0];
      if (todayDay) {
        setWorkout(planDayToWorkout(todayDay, plan.title));
        setProgramName(plan.title);
        setIsAiWorkout(false);
      }
    };
    load().catch(() => null);
  }, []);

  const openEdit = (idx: number) => {
    if (!workout) return;
    const ex = workout.exercises[idx];
    setEditSets(String(ex.sets));
    setEditReps(ex.reps);
    setEditWeight(ex.weight ?? '');
    setEditingIdx(idx);
  };

  const saveEdit = async () => {
    if (editingIdx === null || !workout) return;
    setSaving(true);
    const updated: AIWorkout = {
      ...workout,
      exercises: workout.exercises.map((ex, i) =>
        i === editingIdx
          ? { ...ex, sets: parseInt(editSets, 10) || ex.sets, reps: editReps || ex.reps, weight: editWeight || ex.weight }
          : ex
      ),
    };
    await saveAIWorkout(updated).catch(() => null);
    setWorkout(updated);
    setEditingIdx(null);
    setSaving(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
  };

  if (!workout) {
    return (
      <View style={wStyles.emptyCard}>
        <Text style={wStyles.emptyIcon}>📋</Text>
        <Text style={wStyles.emptyTitle}>No Active Workout Plan</Text>
        <Text style={wStyles.emptySub}>
          The client hasn't set a training plan yet. Ask them to choose one on the Plans tab or have the AI Coach build a custom program.
        </Text>
      </View>
    );
  }

  return (
    <View style={wStyles.panel}>
      {/* Panel header */}
      <Pressable
        style={wStyles.panelHeader}
        onPress={() => setExpanded((e) => !e)}
      >
        <View style={{ flex: 1 }}>
          <Text style={wStyles.panelEyebrow}>
            CLIENT'S WORKOUT PLAN{isAiWorkout ? '  ·  🤖 AI GENERATED' : '  ·  TODAY'}
          </Text>
          <Text style={wStyles.panelTitle}>{workout.name}</Text>
          {programName ? <Text style={wStyles.panelProgram}>{programName}</Text> : null}
        </View>
        <View style={wStyles.panelMeta}>
          {workout.duration > 0 && <Text style={wStyles.panelMetaItem}>⏱ {workout.duration}m</Text>}
          {workout.exercises.length > 0 && <Text style={wStyles.panelMetaItem}>🏋️ {workout.exercises.length} ex</Text>}
          <Text style={[wStyles.panelChevron, expanded && wStyles.panelChevronOpen]}>›</Text>
        </View>
      </Pressable>

      {expanded ? (
        <View style={wStyles.exerciseList}>
          {workout.coachNote ? (
            <View style={wStyles.coachNoteRow}>
              <Text style={wStyles.coachNoteText}>💡 {workout.coachNote}</Text>
            </View>
          ) : null}

          {workout.exercises.length === 0 && (
            <Text style={[wStyles.exerciseDetail, { textAlign: 'center', paddingVertical: 8, color: '#666' }]}>
              Your full workout is ready — head to the Train tab to start today's session.
            </Text>
          )}

          {workout.exercises.map((ex, idx) => (
            <View key={idx} style={wStyles.exerciseRow}>
              {/* Exercise name + details */}
              <View style={{ flex: 1 }}>
                <Text style={wStyles.exerciseName}>{ex.name}</Text>
                <Text style={wStyles.exerciseDetail}>
                  {ex.sets} sets × {ex.reps} reps
                  {ex.weight ? `  ·  ${ex.weight}` : ''}
                  {ex.rest ? `  ·  ${ex.rest} rest` : ''}
                </Text>
              </View>
              {/* Edit button */}
              {editable ? (
                <Pressable
                  style={wStyles.editBtn}
                  onPress={() => openEdit(idx)}
                >
                  <Text style={wStyles.editBtnText}>Edit</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* Inline edit modal */}
      {editable ? (
        <Modal
          visible={editingIdx !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingIdx(null)}
        >
          <Pressable style={wStyles.editOverlay} onPress={() => setEditingIdx(null)}>
            <Pressable style={wStyles.editSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={wStyles.editTitle}>
                Edit: {editingIdx !== null ? workout.exercises[editingIdx]?.name : ''}
              </Text>

              <View style={wStyles.editRow}>
                <View style={wStyles.editField}>
                  <Text style={wStyles.editLabel}>SETS</Text>
                  <TextInput
                    style={wStyles.editInput}
                    value={editSets}
                    onChangeText={setEditSets}
                    keyboardType="number-pad"
                    selectTextOnFocus
                    placeholderTextColor={C.muted}
                  />
                </View>
                <View style={wStyles.editField}>
                  <Text style={wStyles.editLabel}>REPS</Text>
                  <TextInput
                    style={wStyles.editInput}
                    value={editReps}
                    onChangeText={setEditReps}
                    selectTextOnFocus
                    placeholder="8-12"
                    placeholderTextColor={C.muted}
                  />
                </View>
                <View style={wStyles.editField}>
                  <Text style={wStyles.editLabel}>WEIGHT</Text>
                  <TextInput
                    style={wStyles.editInput}
                    value={editWeight}
                    onChangeText={setEditWeight}
                    selectTextOnFocus
                    placeholder="moderate"
                    placeholderTextColor={C.muted}
                  />
                </View>
              </View>

              <View style={wStyles.editActions}>
                <Pressable style={wStyles.editCancel} onPress={() => setEditingIdx(null)}>
                  <Text style={wStyles.editCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[wStyles.editSave, saving && { opacity: 0.6 }]}
                  onPress={saveEdit}
                  disabled={saving}
                >
                  <Text style={wStyles.editSaveText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const wStyles = StyleSheet.create({
  emptyCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  emptyIcon: { fontSize: 32 },
  emptyTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  emptySub: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', textAlign: 'center', lineHeight: 19 },
  panel: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.25)',
    overflow: 'hidden',
    marginBottom: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  panelEyebrow: { fontSize: 9, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.5, marginBottom: 2 },
  panelTitle: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold' },
  panelProgram: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  panelMeta: { alignItems: 'flex-end', gap: 4 },
  panelMetaItem: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular' },
  panelChevron: { color: C.muted, fontSize: 20, transform: [{ rotate: '90deg' }] },
  panelChevronOpen: { transform: [{ rotate: '-90deg' }] },
  exerciseList: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  coachNoteRow: {
    backgroundColor: 'rgba(0,255,136,0.06)',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    marginBottom: 4,
  },
  coachNoteText: { fontSize: 12, color: C.green, fontFamily: 'DMSans_400Regular', lineHeight: 17 },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  exerciseName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 2 },
  exerciseDetail: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  editBtn: {
    borderWidth: 1,
    borderColor: C.green,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  editBtnText: { fontSize: 12, color: C.green, fontFamily: 'DMSans_500Medium' },
  // Edit modal
  editOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  editSheet: {
    width: '100%',
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.3)',
    padding: 20,
    gap: 16,
  },
  editTitle: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold' },
  editRow: { flexDirection: 'row', gap: 10 },
  editField: { flex: 1, gap: 6 },
  editLabel: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1 },
  editInput: {
    backgroundColor: C.dark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    textAlign: 'center',
  },
  editActions: { flexDirection: 'row', gap: 10 },
  editCancel: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  editCancelText: { color: C.muted, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  editSave: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: C.green,
    alignItems: 'center',
  },
  editSaveText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 14 },
});

// ─── Session Calendar Modal ───────────────────────────────────────────────────

/**
 * Read-only calendar popup.
 * Shows current month (or the session's month if different) with:
 *  • today  → green ring
 *  • session date → orange ring
 * User can navigate months with ‹ › arrows.
 */
function SessionCalendarModal({
  visible,
  sessionDate,
  sessionTime,
  onClose,
}: {
  visible: boolean;
  sessionDate: string;   // 'YYYY-MM-DD'
  sessionTime: string;   // 'HH:MM'
  onClose: () => void;
}) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Default to the session's month so the user immediately sees the session
  const sessionParts = sessionDate.split('-').map(Number);
  const [year, setYear] = React.useState(sessionParts[0] ?? now.getFullYear());
  const [month, setMonth] = React.useState((sessionParts[1] ?? now.getMonth() + 1) - 1);

  // Reset to session month every time the modal opens
  React.useEffect(() => {
    if (visible) {
      const parts = sessionDate.split('-').map(Number);
      setYear(parts[0] ?? now.getFullYear());
      setMonth((parts[1] ?? now.getMonth() + 1) - 1);
    }
  }, [visible, sessionDate]);

  const cells = getCalendarDays(year, month);

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const sessionPretty = formatSessionDate(sessionDate, sessionTime);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scOverlay} onPress={onClose}>
        <Pressable style={styles.scSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.scHandle} />

          {/* Title */}
          <Text style={styles.scTitle}>📅 Upcoming Session</Text>
          <Text style={styles.scSessionDate}>{sessionPretty}</Text>

          {/* Month navigation */}
          <View style={styles.scCalHeader}>
            <Pressable onPress={prevMonth} hitSlop={12} style={styles.scCalNavBtn}>
              <Text style={styles.scCalNavText}>‹</Text>
            </Pressable>
            <Text style={styles.scCalMonthLabel}>{MONTH_NAMES[month]} {year}</Text>
            <Pressable onPress={nextMonth} hitSlop={12} style={styles.scCalNavBtn}>
              <Text style={styles.scCalNavText}>›</Text>
            </Pressable>
          </View>

          {/* Day-of-week headers */}
          <View style={styles.scDayRow}>
            {DAY_LABELS.map((d) => (
              <Text key={d} style={styles.scDayLabel}>{d}</Text>
            ))}
          </View>

          {/* Date grid */}
          <View style={styles.scGrid}>
            {cells.map((cell, i) => {
              if (!cell) return <View key={`e-${i}`} style={styles.scCell} />;
              const isToday = cell.dateStr === todayStr;
              const isSession = cell.dateStr === sessionDate;
              return (
                <View
                  key={cell.dateStr}
                  style={[
                    styles.scCell,
                    isToday ? styles.scCellToday : null,
                    isSession ? styles.scCellSession : null,
                  ]}
                >
                  <Text style={[
                    styles.scCellText,
                    isToday ? styles.scCellTextToday : null,
                    isSession ? styles.scCellTextSession : null,
                  ]}>
                    {cell.day}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Legend */}
          <View style={styles.scLegend}>
            <View style={styles.scLegendItem}>
              <View style={[styles.scLegendDot, { backgroundColor: C.green }]} />
              <Text style={styles.scLegendText}>Today</Text>
            </View>
            <View style={styles.scLegendItem}>
              <View style={[styles.scLegendDot, { backgroundColor: C.orange }]} />
              <Text style={styles.scLegendText}>Your Session</Text>
            </View>
          </View>

          <Pressable style={styles.scCloseBtn} onPress={onClose}>
            <Text style={styles.scCloseBtnText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Active Plan Dashboard ────────────────────────────────────────────────────

function ActivePlanDashboard({
  plan,
  bonus,
  sessions,
  userId,
  coachId,
  onScheduleSameTimeNextWeek,
  onScheduleCustomNextSession,
}: {
  plan: ActiveCoachingPlan;
  bonus: BonusTracker | null;
  sessions: CoachingSession[];
  userId: string;
  coachId?: string | null;
  onScheduleSameTimeNextWeek: () => void;
  onScheduleCustomNextSession: () => void;
}) {
  const pkg = getPackageById(plan.packageId);
  const dur = getDurationOptionForPackage(plan.packageId, plan.durationId);
  const daysLeft = getDaysUntil(plan.endDate);
  const daysToNext = plan.nextSessionDate ? getDaysUntil(plan.nextSessionDate) : null;
  const upcomingSessions = sessions
    .filter((s) => s.status === 'upcoming')
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const [chatVisible, setChatVisible] = useState(false);
  const [calVisible, setCalVisible] = useState(false);
  const nextUpcomingSession = sessions
    .filter((item) => item.status === 'upcoming')
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0];
  const handleJoinSession = useCallback(async () => {
    try {
      await openZoomSessionForClient(nextUpcomingSession?.joinUrl);
    } catch {
      const fallbackUrl = getSessionJoinUrl(nextUpcomingSession?.joinUrl);
      const supported = await Linking.canOpenURL(fallbackUrl).catch(() => false);
      if (!supported) {
        Alert.alert('Join link unavailable', 'We could not open the session link on this device.');
        return;
      }
      await Linking.openURL(fallbackUrl);
    }
  }, [nextUpcomingSession?.joinUrl]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Next session hero */}
      {plan.nextSessionDate && plan.nextSessionTime ? (
        <>
          <View style={styles.nextSessionHero}>
            <View style={{ flex: 1 }}>
              <Text style={styles.nextSessionEyebrow}>NEXT SESSION</Text>
              {/* Tapping the date opens the session calendar popup */}
              <Pressable onPress={() => setCalVisible(true)} hitSlop={6}>
                <Text style={[styles.nextSessionDate, { textDecorationLine: 'underline', textDecorationColor: C.green }]}>
                  {formatSessionDate(plan.nextSessionDate, plan.nextSessionTime)}
                </Text>
              </Pressable>
              {daysToNext !== null ? (
                <Text style={styles.nextSessionCountdown}>
                  {daysToNext === 0 ? '🔥 Today!' : daysToNext === 1 ? '⏰ Tomorrow' : `In ${daysToNext} days`}
                </Text>
              ) : null}
              <Text style={styles.nextSessionTapHint}>Tap date to view calendar</Text>
            </View>
            <Pressable
              style={styles.joinSessionBtn}
              onPress={() => handleJoinSession().catch(() => null)}
            >
              <Text style={styles.joinSessionBtnText}>JOIN</Text>
              <Text style={styles.joinSessionBtnSub}>📹</Text>
            </Pressable>
          </View>
          <SessionCalendarModal
            visible={calVisible}
            sessionDate={plan.nextSessionDate}
            sessionTime={plan.nextSessionTime}
            onClose={() => setCalVisible(false)}
          />
          <View style={styles.manageRow}>
            <Pressable
              style={[styles.manageBtn, { borderColor: C.blue }]}
              onPress={onScheduleSameTimeNextWeek}
            >
              <Text style={[styles.manageBtnText, { color: C.blue }]}>Same Time Next Week</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.msgCoachBtn, { marginTop: 12 }]}
            onPress={onScheduleCustomNextSession}
          >
            <Text style={styles.msgCoachIcon}>🗓️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.msgCoachTitle}>Pick a New Time & Day</Text>
              <Text style={styles.msgCoachSub}>Open your coach chat to reschedule the next live session.</Text>
            </View>
            <Text style={{ color: C.green, fontSize: 18 }}>›</Text>
          </Pressable>
        </>
      ) : null}

      {/* Plan status */}
      <View style={styles.planStatusRow}>
        <Pressable
          style={styles.planStatusChip}
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setChatVisible(true);
          }}
        >
          <Text style={styles.planStatusLabel}>PACKAGE</Text>
          <Text style={styles.planStatusValue}>{pkg?.label}</Text>
          <Text style={styles.planStatusHint}>Tap to upgrade</Text>
        </Pressable>
        <View style={styles.planStatusChip}>
          <Text style={styles.planStatusLabel}>PLAN</Text>
          <Text style={styles.planStatusValue}>{dur?.label}</Text>
        </View>
        <View style={styles.planStatusChip}>
          <Text style={styles.planStatusLabel}>DAYS LEFT</Text>
          <Text style={[styles.planStatusValue, daysLeft <= 14 ? { color: C.orange } : null]}>{daysLeft}</Text>
        </View>
      </View>

      {/* Workout plan viewer */}
      <SectionLabel>Today's Workout</SectionLabel>
      <WorkoutPlanPanel editable={false} />

      {/* Bonus tracker */}
      {bonus ? <BonusTrackerCard bonus={bonus} /> : null}

      {/* Upcoming sessions */}
      {upcomingSessions.length > 0 ? (
        <>
          <SectionLabel>Upcoming Sessions</SectionLabel>
          {upcomingSessions.map((s) => <SessionHistoryCard key={s.id} session={s} />)}
        </>
      ) : null}

      <Pressable
        style={styles.msgCoachBtn}
        onPress={async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setChatVisible(true);
        }}
      >
        <Text style={styles.msgCoachIcon}>💬</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.msgCoachTitle}>Message Your Coach</Text>
          <Text style={styles.msgCoachSub}>Ask questions, share updates, get support</Text>
        </View>
        <Text style={{ color: C.green, fontSize: 18 }}>›</Text>
      </Pressable>

      {/* Actions */}
      <SectionLabel style={{ marginTop: 16 }}>Manage Plan</SectionLabel>
      <View style={styles.manageRow}>
        <Pressable
          style={[styles.manageBtn, { borderColor: C.blue }]}
          onPress={() => setChatVisible(true)}
        >
          <Text style={[styles.manageBtnText, { color: C.blue }]}>Reschedule</Text>
        </Pressable>
      </View>

      <View style={{ height: 40 }} />

      <CoachChatModal
        visible={chatVisible}
        userId={userId}
        coachId={coachId}
        onClose={() => setChatVisible(false)}
      />
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LiveCoachScreen({ embedded = false }: { embedded?: boolean }) {
  const { accent, accentSoft, accentBorder, accentStrongBorder } = useTheme();
  const { isEmailVerified, resendVerificationEmail, session, userEmail } = useAuth();
  const { isPro, isLoading: proLoading } = usePro();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [activePlan, setActivePlan] = useState<ActiveCoachingPlan | null>(null);
  const [bonus, setBonus] = useState<BonusTracker | null>(null);
  const [sessions, setSessions] = useState<CoachingSession[]>([]);
  const [linkedCoach, setLinkedCoach] = useState<LinkedCoach | null>(null);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mainChatVisible, setMainChatVisible] = useState(false);
  const [adminModeEnabled, setAdminModeEnabled] = useState(false);
  const [upcomingCall, setUpcomingCall] = useState<{
    id: string;
    session_date: string;
    session_time: string;
    status: string;
  } | null>(null);
  const [confirmingCall, setConfirmingCall] = useState(false);
  const syncActivePlanFromSessions = useCallback(async (nextSessions: CoachingSession[]) => {
    const nextUpcomingSession = nextSessions
      .filter((item) => item.status === 'upcoming')
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0];

    setSessions(nextSessions);
    await AsyncStorage.setItem('@apex_coaching_sessions', JSON.stringify(nextSessions)).catch(() => null);

    setActivePlan((prev) => {
      if (!prev) return prev;
      const nextPlan = {
        ...prev,
        nextSessionDate: nextUpcomingSession?.date,
        nextSessionTime: nextUpcomingSession?.time,
      };
      saveActivePlan(nextPlan).catch(() => null);
      return nextPlan;
    });

    if (session?.user?.id) {
      const completedCount = nextSessions.filter((item) => item.status === 'completed').length;
      const sessionSchedule = nextSessions
        .filter((item) => item.status === 'upcoming')
        .map((item) => ({
          date: item.date,
          time: item.time,
          type: item.type,
          joinUrl: item.joinUrl,
          startUrl: item.startUrl,
          liveSessionId: item.liveSessionId,
          zoomMeetingId: item.zoomMeetingId,
          zoomMeetingUuid: item.zoomMeetingUuid,
        }));

      updateCoachClientLink(session.user.id, {
        completedSessions: completedCount,
        nextSession: nextUpcomingSession ? `${nextUpcomingSession.date}T${nextUpcomingSession.time}:00` : null,
        sessionSchedule,
      }).catch(() => null);
    }
  }, [session?.user?.id]);

  const promptVerifyEmail = useCallback(() => {
    Alert.alert(
      'Verify email before live coaching',
      'Please verify your email before booking live coaching or linking coach access.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Resend Email',
          onPress: async () => {
            const error = await resendVerificationEmail(userEmail ?? undefined);
            if (error) {
              Alert.alert('Could not resend email', error);
              return;
            }
            Alert.alert('Verification sent', `We sent a verification email to ${userEmail ?? 'your inbox'}.`);
          },
        },
      ],
    );
  }, [resendVerificationEmail, userEmail]);

  // Load on mount
  React.useEffect(() => {
    const load = async () => {
      const [plan, b, sesh, coach] = await Promise.all([
        getActivePlan(),
        getBonusTracker(),
        getSessions(),
        getLinkedCoach().catch(() => null),
      ]);
      const adminEnabled = await isAdminEnabled().catch(() => false);
      setActivePlan(plan);
      setBonus(b);
      setSessions(sesh);
      setLinkedCoach(coach);
      setAdminModeEnabled(adminEnabled);
      setLoaded(true);
    };
    load().catch(() => setLoaded(true));
  }, []);

  // Fetch this user's most recent upcoming fit call
  React.useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    supabase
      .from('coaching_fit_calls')
      .select('id, session_date, session_time, status')
      .eq('user_id', userId)
      .in('status', ['pending', 'confirmed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setUpcomingCall(data); })
      .catch(() => null);
  }, [session?.user?.id]);

  const handleConfirmCall = useCallback(async () => {
    if (!upcomingCall) return;
    setConfirmingCall(true);
    const { error } = await supabase
      .from('coaching_fit_calls')
      .update({ status: 'confirmed' })
      .eq('id', upcomingCall.id);
    if (!error) {
      setUpcomingCall((prev) => prev ? { ...prev, status: 'confirmed' } : prev);
      const clientDisplay = session?.user?.email ?? 'A client';
      sendCoachBusinessNotification(
        '✅ Fit Call Confirmed',
        `${clientDisplay} confirmed their call for ${formatFitCallDate(upcomingCall.session_date)} at ${formatFitCallTime(upcomingCall.session_time)}.`,
      ).catch(() => null);
    }
    setConfirmingCall(false);
  }, [upcomingCall, session?.user?.email]);

  const handleResetForTesting = useCallback(async () => {
    Alert.alert(
      'Reset DM Flow',
      'This will delete the booked call, cancel reminder notifications, and clear the conversation so you can run through the flow again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const { bookingId } = await resetDMFlowForTesting();
            if (bookingId) {
              await supabase.from('coaching_fit_calls').delete().eq('id', bookingId).catch(() => null);
            }
            if (upcomingCall?.id) {
              await supabase.from('coaching_fit_calls').delete().eq('id', upcomingCall.id).catch(() => null);
            }
            setUpcomingCall(null);
          },
        },
      ],
    );
  }, [upcomingCall]);

  const provisionZoomSessions = useCallback(async (
    bookedSessions: CoachingSession[],
    sessionSchedule: SessionScheduleSlot[],
  ) => {
    const nextSessions = await Promise.all(bookedSessions.map(async (sessionItem, index) => {
      try {
        const { data } = await supabase.functions.invoke('zoom-session', {
          body: {
            agenda: `${sessionItem.type === 'group' ? 'Group' : '1-on-1'} coaching session in APEX`,
            durationMinutes: sessionItem.type === 'group' ? 75 : 60,
            hostUserId: env.zoomHostUserId || 'joshua.saunders575@icloud.com',
            startTime: new Date(`${sessionItem.date}T${sessionItem.time}:00`).toISOString(),
            topic: `${sessionItem.type === 'group' ? 'Group' : '1-on-1'} · ${sessionItem.date} ${sessionItem.time}`,
          },
        });

        const meeting = data as {
          join_url?: string | null;
          meeting_id?: string | null;
          meeting_uuid?: string | null;
          start_url?: string | null;
        } | null;

        const joinUrl = meeting?.join_url?.trim() || sessionItem.joinUrl;
        const startUrl = meeting?.start_url?.trim() || sessionItem.startUrl;
        const zoomMeetingId = meeting?.meeting_id?.trim() || sessionItem.zoomMeetingId;
        const zoomMeetingUuid = meeting?.meeting_uuid?.trim() || sessionItem.zoomMeetingUuid;

        if (joinUrl || startUrl || zoomMeetingId || zoomMeetingUuid) {
          sessionSchedule[index] = {
            ...sessionSchedule[index],
            joinUrl,
            startUrl,
            zoomMeetingId,
            zoomMeetingUuid,
          };
          return {
            ...sessionItem,
            joinUrl,
            startUrl,
            zoomMeetingId,
            zoomMeetingUuid,
          };
        }
        return sessionItem;
      } catch {
        return sessionItem;
      }
    }));

    return nextSessions;
  }, []);

  const handleScheduleSameTimeNextWeek = useCallback(async () => {
    if (!activePlan || !session?.user?.id || !linkedCoach?.coachUserId) {
      Alert.alert('Missing session details', 'We need an active plan and linked coach before scheduling the next live session.');
      return;
    }

    const nextUpcomingSession = sessions
      .filter((item) => item.status === 'upcoming')
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0];

    const baseSession = nextUpcomingSession ?? sessions
      .slice()
      .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`))[0];

    if (!baseSession) {
      Alert.alert('No session found', 'We could not find a session to copy forward.');
      return;
    }

    try {
      const nextDate = new Date(`${baseSession.date}T12:00:00`);
      nextDate.setDate(nextDate.getDate() + 7);
      const nextDateStr = nextDate.toISOString().slice(0, 10);

      const newSession: CoachingSession = {
        id: `session-next-${Date.now()}`,
        date: nextDateStr,
        time: baseSession.time,
        type: baseSession.type,
        status: 'upcoming',
      };

      const sessionSchedule: SessionScheduleSlot[] = [{
        date: newSession.date,
        time: newSession.time,
        type: newSession.type,
      }];

      const hydratedBookedSessions = await provisionZoomSessions([newSession], sessionSchedule);
      const hydratedSchedule = sessionSchedule.map((slot, index) => ({
        ...slot,
        joinUrl: hydratedBookedSessions[index]?.joinUrl ?? slot.joinUrl,
        startUrl: hydratedBookedSessions[index]?.startUrl ?? slot.startUrl,
        zoomMeetingId: hydratedBookedSessions[index]?.zoomMeetingId ?? slot.zoomMeetingId,
        zoomMeetingUuid: hydratedBookedSessions[index]?.zoomMeetingUuid ?? slot.zoomMeetingUuid,
      }));

      const coachClientLinkId = await upsertCoachClientLink({
        coachUserId: linkedCoach.coachUserId,
        clientUserId: session.user.id,
        packageId: activePlan.packageId,
        durationId: activePlan.durationId,
        sessionType: activePlan.sessionType ?? newSession.type,
        startDate: activePlan.startDate,
        nextSession: `${newSession.date}T${newSession.time}:00`,
        totalSessions: sessions.length + 1,
        completedSessions: sessions.filter((item) => item.status === 'completed').length,
        bonus,
        status: 'active',
        recurrencePreference: activePlan.recurrencePreference,
        sessionSchedule: hydratedSchedule,
      }).catch(() => null);

      let persistedSessions = hydratedBookedSessions;

      if (coachClientLinkId) {
        const persisted = await createScheduledLiveCoachingSessions({
          coachUserId: linkedCoach.coachUserId,
          clientUserId: session.user.id,
          coachClientLinkId,
          bookedSessions: hydratedBookedSessions,
          sessionSchedule: hydratedSchedule,
        });
        persistedSessions = persisted.bookedSessions;
      }

      if (sessions.some((item) => item.status === 'upcoming' && item.date === persistedSessions[0].date && item.time === persistedSessions[0].time)) {
        Alert.alert(
          'Session already scheduled',
          `You already have a live coaching session on ${formatSessionDate(persistedSessions[0].date, persistedSessions[0].time)}.`,
        );
        return;
      }

      const nextSessions = [...sessions, persistedSessions[0]].sort((a, b) =>
        `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
      );

      await addSession(persistedSessions[0]);
      await syncActivePlanFromSessions(nextSessions);

      Alert.alert(
        'Next session scheduled',
        `Your next live coaching session is set for ${formatSessionDate(persistedSessions[0].date, persistedSessions[0].time)}.`,
      );
    } catch (error: any) {
      Alert.alert('Could not schedule next session', error?.message ?? 'Please try again or use Reschedule.');
    }
  }, [activePlan, bonus, linkedCoach?.coachUserId, provisionZoomSessions, session?.user?.id, sessions, syncActivePlanFromSessions]);

  const handleScheduleCustomNextSession = useCallback(() => {
    setMainChatVisible(true);
  }, []);

  const handlePurchaseComplete = async (
    plan: ActiveCoachingPlan,
    bonusTracker: BonusTracker | null,
    bookedSessions: CoachingSession[],
    sessionSchedule: SessionScheduleSlot[],
    overrideCoach?: LinkedCoach | null,
  ) => {
    if (!isEmailVerified) {
      promptVerifyEmail();
      return;
    }
    const activeLinkedCoach = overrideCoach ?? linkedCoach;
    let hydratedBookedSessions = await provisionZoomSessions([...bookedSessions], [...sessionSchedule]);
    let hydratedSchedule = sessionSchedule.map((slot, index) => ({
      ...slot,
      joinUrl: hydratedBookedSessions[index]?.joinUrl ?? slot.joinUrl,
      startUrl: hydratedBookedSessions[index]?.startUrl ?? slot.startUrl,
      zoomMeetingId: hydratedBookedSessions[index]?.zoomMeetingId ?? slot.zoomMeetingId,
      zoomMeetingUuid: hydratedBookedSessions[index]?.zoomMeetingUuid ?? slot.zoomMeetingUuid,
    }));
    let firstSession = hydratedBookedSessions[0];
    if (session?.user?.id && activeLinkedCoach?.coachUserId) {
      const profile = await loadCachedProfile().catch(() => null);
      const pkg = getPackageById(plan.packageId);
      const dur = getDurationOptionForPackage(plan.packageId, plan.durationId);
      const coachClientLinkId = await upsertCoachClientLink({
        coachUserId: activeLinkedCoach.coachUserId,
        clientUserId: session.user.id,
        packageId: plan.packageId,
        durationId: plan.durationId,
        sessionType: plan.sessionType ?? firstSession.type,
        startDate: plan.startDate,
        nextSession: firstSession ? `${firstSession.date}T${firstSession.time}:00` : undefined,
        totalSessions: (pkg?.sessionsPerWeek ?? 0) * (dur?.weeks ?? 0),
        completedSessions: 0,
        bonus: bonusTracker,
        status: 'active',
        notes: profile?.displayName ? `${profile.displayName} booked live coaching in APEX.` : 'Client booked live coaching in APEX.',
        recurrencePreference: plan.recurrencePreference,
        sessionSchedule: hydratedSchedule,
      }).catch((error) => {
        console.error('Failed to sync live coaching link', error);
        return null;
      });

      if (coachClientLinkId) {
        try {
          const persisted = await createScheduledLiveCoachingSessions({
            coachUserId: activeLinkedCoach.coachUserId,
            clientUserId: session.user.id,
            coachClientLinkId,
            bookedSessions: hydratedBookedSessions,
            sessionSchedule: hydratedSchedule,
          });
          hydratedBookedSessions = persisted.bookedSessions;
          hydratedSchedule = persisted.sessionSchedule;
          firstSession = hydratedBookedSessions[0];
        } catch (error) {
          console.error('Failed to persist live coaching sessions', error);
        }
      }

      supabase.from('coach_messages').insert({
        user_id: session.user.id,
        coach_id: activeLinkedCoach.coachUserId,
        sender_role: 'user',
        content: `${profile?.displayName ?? 'A client'} just purchased ${pkg?.label ?? 'live coaching'} (${dur?.label ?? 'custom duration'}) and booked ${bookedSessions.length} ${plan.sessionType === 'group' ? 'group spot' : 'session'}${bookedSessions.length > 1 ? 's' : ''}. Please reach out to confirm the plan and schedule.`,
      }).then(() => null, () => null);

      queueCoachBusinessNotification({
        body: `${profile?.displayName ?? 'A client'} purchased ${pkg?.label ?? 'live coaching'} (${dur?.label ?? 'custom duration'}) and booked ${bookedSessions.length} ${plan.sessionType === 'group' ? 'group spot' : 'session'}${bookedSessions.length > 1 ? 's' : ''}.`,
        clientUserId: session.user.id,
        coachUserId: activeLinkedCoach.coachUserId,
        emailBody: `${profile?.displayName ?? 'A client'} just purchased ${pkg?.label ?? 'live coaching'} in APEX. Open Coach Mode to confirm the plan, review the booked schedule, and send the first message right away.`,
        smsBody: `${profile?.displayName ?? 'A client'} just bought ${pkg?.label ?? 'live coaching'} in APEX. Open Coach Mode and follow up now.`,
        title: 'New live coaching purchase',
      }).catch(() => null);

      supabase.functions.invoke('coach-dispatch', {
        body: {
          body: `${profile?.displayName ?? 'A client'} purchased ${pkg?.label ?? 'live coaching'} and booked ${hydratedBookedSessions.length} ${plan.sessionType === 'group' ? 'group slot' : 'session'}${hydratedBookedSessions.length > 1 ? 's' : ''}.`,
          emailBody: `${profile?.displayName ?? 'A client'} just purchased ${pkg?.label ?? 'live coaching'} in APEX. Open Coach Mode to confirm the plan, review the booked schedule, and send the first message right away.`,
          smsBody: `${profile?.displayName ?? 'A client'} just bought ${pkg?.label ?? 'live coaching'} in APEX. Open Coach Mode and follow up now.`,
          title: 'New live coaching purchase',
        },
      }).then(() => null, () => null);
    }

    await saveActivePlan(plan);
    if (bonusTracker) await saveBonusTracker(bonusTracker);
    await AsyncStorage.setItem('@apex_coaching_sessions', JSON.stringify(hydratedBookedSessions)).catch(() => null);
    setActivePlan(plan);
    setBonus(bonusTracker);
    setSessions(hydratedBookedSessions);

    Alert.alert(
      '🎉 Booking Confirmed!',
      `${hydratedBookedSessions.length} ${plan.sessionType === 'group' ? 'group session slot' : 'session'}${hydratedBookedSessions.length > 1 ? 's are' : ' is'} booked. Your coach will reach out via chat within 24 hours!`,
      );
  };

  const handleCreateLiveCoachingDemo = useCallback(async () => {
    if (!session?.user?.id) {
      Alert.alert('Sign in required', 'Please sign in before creating a live coaching demo.');
      return;
    }

    if (!isEmailVerified) {
      promptVerifyEmail();
      return;
    }

    try {
      let coach = linkedCoach;

      if (!coach) {
        const { data, error } = await supabase
          .from('profiles')
          .select('user_id, display_name, username, avatar_url, coach_bio, is_coach, selected_title')
          .or('is_coach.eq.true,display_name.ilike.%josh%,username.ilike.%josh%')
          .order('is_coach', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        coach = data?.user_id
          ? {
              coachUserId: data.user_id,
              displayName: data.display_name || data.username || 'Coach Josh',
              username: data.username ?? null,
              avatarUrl: data.avatar_url ?? null,
              bio: data.coach_bio ?? null,
              isCoach: data.is_coach ?? true,
              selectedTitle: data.selected_title ?? null,
            }
          : {
              coachUserId: '',
              displayName: 'Coach Josh',
              username: 'coachjosh',
              avatarUrl: null,
              bio: 'Demo coach profile for live coaching preview.',
              isCoach: true,
              selectedTitle: 'APEX Head Coach',
            };
        setLinkedCoach(coach);
      }

      const now = new Date();
      const sessionStart = new Date(now.getTime() + 30 * 60 * 1000);
      sessionStart.setSeconds(0, 0);
      const sessionDate = sessionStart.toISOString().slice(0, 10);
      const sessionTime = `${String(sessionStart.getHours()).padStart(2, '0')}:${String(sessionStart.getMinutes()).padStart(2, '0')}`;
      const endDate = new Date(now.getTime() + 12 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const plan: ActiveCoachingPlan = {
        id: `demo-plan-${Date.now()}`,
        packageId: '1x',
        durationId: '3month',
        sessionType: '1on1',
        startDate: now.toISOString().slice(0, 10),
        endDate,
        totalPaid: calcPrice('1x', '3month'),
        status: 'active',
        nextSessionDate: sessionDate,
        nextSessionTime: sessionTime,
        bookingRecurrence: 'weekly',
        recurrencePreference: 'change_next_week',
      };

      const bookedSessions: CoachingSession[] = [
        {
          id: `demo-session-${Date.now()}`,
          date: sessionDate,
          time: sessionTime,
          type: '1on1',
          status: 'upcoming',
          notes: 'Demo live coaching workout session.',
        },
      ];

      const sessionSchedule: SessionScheduleSlot[] = [
        {
          date: sessionDate,
          time: sessionTime,
          type: '1on1',
        },
      ];

      const bonusTracker = buildBonusTrackerFromPlan('1x', '3month', '1on1');

      await handlePurchaseComplete(
        plan,
        bonusTracker,
        bookedSessions,
        sessionSchedule,
        coach,
      );

      if (!coach.coachUserId) {
        Alert.alert(
          'Demo created',
          'The live coaching demo was created locally with a real Zoom session link. Coach syncing was skipped because no coach profile row was available yet.',
        );
      }
    } catch (error: any) {
      Alert.alert('Could not create demo', error?.message ?? 'Please try again.');
    }
  }, [handlePurchaseComplete, isEmailVerified, linkedCoach, promptVerifyEmail, session?.user?.id]);

  const handleRedeemInvite = async () => {
    if (!isEmailVerified) {
      promptVerifyEmail();
      return;
    }
    if (!inviteCode.trim()) return;
    try {
      setInviteLoading(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const coach = await redeemCoachInvite(inviteCode.trim());
      setLinkedCoach(coach);
      setInviteVisible(false);
      setInviteCode('');
      Alert.alert('Coach Linked', `You're now connected to ${coach.displayName}. If you book live coaching, they'll see you immediately in Coach Mode.`);
    } catch (error: any) {
      Alert.alert('Could not redeem code', error?.message ?? 'Please double-check the invite code and try again.');
    } finally {
      setInviteLoading(false);
    }
  };

  if (!loaded) {
    return (
      <View style={[styles.screen, !embedded ? { paddingTop: insets.top } : null, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: C.muted, fontFamily: 'DMSans_400Regular' }}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, !embedded ? { paddingTop: insets.top } : null]}>
      {/* Header — hidden when embedded inside CoachScreen tab */}
      {!embedded ? (
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={[styles.backText, { color: accent }]}>← Back</Text>
          </Pressable>
          <Text style={styles.headerTitle}>LIVE COACHING</Text>
          {activePlan ? (
            <View style={[styles.activeBadge, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
              <Text style={[styles.activeBadgeText, { color: accent }]}>ACTIVE</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {activePlan ? (
        <ActivePlanDashboard
          plan={activePlan}
          bonus={bonus}
          sessions={sessions}
          userId={session?.user?.id ?? ''}
          coachId={linkedCoach?.coachUserId}
          onScheduleSameTimeNextWeek={handleScheduleSameTimeNextWeek}
          onScheduleCustomNextSession={handleScheduleCustomNextSession}
        />
      ) : (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <View style={[styles.content, { paddingBottom: 0 }]}>
            <View style={[styles.linkCoachCard, { borderColor: accentBorder, backgroundColor: accentSoft }]}>
              <Text style={[styles.linkCoachTitle, { color: accent }]}>
                {linkedCoach ? `Connected Coach: ${linkedCoach.displayName}` : 'Coach support is being connected'}
              </Text>
              <Text style={styles.linkCoachBody}>
                {linkedCoach
                  ? "You're already in Apex 1-on-1. Use this space to message your coach, review your session schedule, and send support requests."
                  : 'If your coach gave you an invite code, redeem it here so they can see your progress, message you, and manage your active support.'}
              </Text>
              <Pressable style={[styles.linkCoachBtn, { backgroundColor: accentSoft, borderColor: accentBorder }]} onPress={() => setInviteVisible(true)}>
                <Text style={[styles.linkCoachBtnText, { color: accent }]}>{linkedCoach ? 'Redeem a Different Code' : 'Redeem Coach Invite'}</Text>
              </Pressable>
            </View>
            {linkedCoach ? (
              <View style={styles.coachIntroCard}>
                <Text style={styles.coachIntroEyebrow}>GET TO KNOW YOUR COACH</Text>
                <View style={styles.coachIntroHeader}>
                  <View style={styles.coachIntroAvatar}>
                    {linkedCoach.avatarUrl ? (
                      <Image source={{ uri: linkedCoach.avatarUrl }} style={styles.coachIntroAvatarImage} />
                    ) : (
                      <Text style={styles.coachIntroAvatarText}>
                        {linkedCoach.displayName
                          .split(' ')
                          .map((part) => part[0] ?? '')
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.coachIntroNameRow}>
                      <Text style={styles.coachIntroName}>{linkedCoach.displayName}</Text>
                      {linkedCoach.isCoach !== false ? (
                        <View style={styles.coachIntroBadge}>
                          <Text style={styles.coachIntroBadgeText}>Coach</Text>
                        </View>
                      ) : null}
                    </View>
                    {linkedCoach.selectedTitle ? (
                      <Text style={styles.coachIntroMeta}>{linkedCoach.selectedTitle}</Text>
                    ) : null}
                    {linkedCoach.username ? (
                      <Text style={styles.coachIntroMeta}>@{linkedCoach.username}</Text>
                    ) : null}
                  </View>
                </View>
                <Text style={styles.coachIntroBody}>
                  {linkedCoach.bio?.trim()
                    ? linkedCoach.bio
                    : 'Your coach can review your progress, adjust your training, update your nutrition plan, and keep your live schedule dialed in.'}
                </Text>
              </View>
            ) : null}
            {linkedCoach ? (
              <Pressable
                style={styles.msgCoachBtn}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setMainChatVisible(true);
                }}
              >
                <Text style={styles.msgCoachIcon}>💬</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msgCoachTitle}>Message Your Coach</Text>
                <Text style={styles.msgCoachSub}>Ask questions, share updates, get support</Text>
              </View>
              <Text style={{ color: C.green, fontSize: 18 }}>›</Text>
              </Pressable>
            ) : null}
            <View style={styles.coachIntroCard}>
              <Text style={styles.coachIntroEyebrow}>ACTIVE APEX SUPPORT</Text>
              <Text style={styles.coachIntroBody}>
                Apex clients should not go back through the WW booking funnel. If you need to reschedule, send a form video, or ask for plan changes, message your coach directly from here.
              </Text>
            </View>
            <Pressable
              style={[styles.fitCallCTA, { backgroundColor: accent, marginTop: 8 }]}
              onPress={() => navigation.navigate('FormReview', { exerciseName: 'Workout Form', hasLiveCoach: true })}
            >
              <Text style={styles.fitCallCTAText}>🎥 Send Form Video to Coach Josh</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {session?.user?.id ? (
        <CoachChatModal
          visible={mainChatVisible}
          userId={session.user.id}
          coachId={linkedCoach?.coachUserId}
          onClose={() => setMainChatVisible(false)}
        />
      ) : null}

      <Modal visible={inviteVisible} transparent animationType="slide" onRequestClose={() => setInviteVisible(false)}>
        <Pressable style={styles.exitOverlay} onPress={() => setInviteVisible(false)}>
          <Pressable style={styles.exitSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.exitHandle} />
            <Text style={styles.exitTitle}>Redeem Coach Invite</Text>
            <Text style={styles.exitSub}>
              Enter the code your coach shared with you. Once redeemed, they’ll be able to see you in Coach Mode and manage your Apex support.
            </Text>
            <TextInput
              style={styles.inviteInput}
              value={inviteCode}
              onChangeText={(text) => setInviteCode(text.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ENTER CODE"
              placeholderTextColor={C.muted}
            />
            <View style={styles.btnRow}>
              <Pressable style={styles.btnGhost} onPress={() => setInviteVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.btnPrimary, { flex: 1 }, (!inviteCode.trim() || inviteLoading) ? styles.btnDisabled : null]}
                onPress={handleRedeemInvite}
                disabled={!inviteCode.trim() || inviteLoading}
              >
                <Text style={styles.btnPrimaryText}>{inviteLoading ? 'Linking…' : 'Link Coach →'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Upcoming Call card
  upcomingCallCard: {
    marginHorizontal: 14,
    marginBottom: 16,
    marginTop: 4,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },
  upcomingCallHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  upcomingCallAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  upcomingCallTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: C.text,
    marginBottom: 2,
  },
  upcomingCallDateTime: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: C.muted,
  },
  upcomingCallBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  upcomingCallBadgePending: {
    backgroundColor: 'rgba(255,196,0,0.1)',
    borderColor: 'rgba(255,196,0,0.35)',
  },
  upcomingCallBadgeConfirmed: {
    backgroundColor: C.greenSoft,
    borderColor: C.greenBorder,
  },
  upcomingCallBadgeText: {
    fontSize: 10,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 0.5,
  },
  upcomingCallBadgeTextPending: { color: '#FFC400' },
  upcomingCallBadgeTextConfirmed: { color: C.green },
  upcomingCallBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  upcomingCallBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  upcomingCallBtnConfirm: {
    backgroundColor: C.green,
    borderColor: C.green,
  },
  upcomingCallBtnConfirmText: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: '#000',
  },
  upcomingCallBtnReschedule: {
    backgroundColor: 'transparent',
    borderColor: C.border,
  },
  upcomingCallBtnRescheduleText: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: C.text,
  },
  upcomingCallResetBtn: {
    marginTop: 10,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,60,60,0.3)',
    backgroundColor: 'rgba(255,60,60,0.06)',
  },
  upcomingCallResetBtnText: {
    fontSize: 11,
    fontFamily: 'SpaceMono_400Regular',
    color: 'rgba(255,100,100,0.8)',
    letterSpacing: 0.3,
  },
  screen: { flex: 1, backgroundColor: C.black },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { paddingRight: 8 },
  backText: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  headerTitle: { flex: 1, fontSize: 18, color: C.text, fontFamily: 'DMSans_700Bold' },
  activeBadge: { backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  activeBadgeText: { fontSize: 10, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5 },
  sectionLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: C.muted, fontFamily: 'SpaceMono_400Regular', marginBottom: 10, marginTop: 6 },
  // Step indicator
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, justifyContent: 'center', gap: 0 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: C.green, borderColor: C.green },
  stepDotDone: { backgroundColor: C.greenDim, borderColor: C.greenDim },
  stepDotText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_700Bold' },
  stepLine: { flex: 1, height: 2, backgroundColor: C.border, maxWidth: 40 },
  stepLineDone: { backgroundColor: C.greenDim },
  stepTitle: { fontSize: 22, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 6 },
  stepSubtitle: { fontSize: 14, color: C.muted, fontFamily: 'DMSans_400Regular', marginBottom: 20, lineHeight: 20 },
  trackToggleRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  trackToggleCard: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
  },
  trackToggleCardActive: { borderColor: C.green, backgroundColor: C.greenSoft },
  trackToggleTitle: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 4 },
  trackToggleBody: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 17 },
  groupExplainerCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 0,
  },
  coachSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coachSectionChevron: {
    fontSize: 20,
    lineHeight: 24,
    paddingLeft: 4,
  },
  groupExplainerEyebrow: {
    fontSize: 10,
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  groupExplainerTitle: {
    fontSize: 18,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginBottom: 6,
  },
  groupExplainerBody: {
    fontSize: 13,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 20,
    marginBottom: 14,
  },
  groupExplainerGrid: { gap: 10, marginBottom: 12 },
  groupExplainerCell: {
    backgroundColor: 'rgba(255,107,53,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.18)',
    borderRadius: 12,
    padding: 12,
  },
  groupExplainerCellTitle: {
    fontSize: 12,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginBottom: 4,
  },
  groupExplainerCellBody: {
    fontSize: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
  },
  groupExplainerBullets: { gap: 6 },
  groupExplainerBullet: {
    fontSize: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
  },
  groupCommitCard: {
    backgroundColor: 'rgba(0,255,136,0.06)',
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  groupCommitTitle: {
    fontSize: 13,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginBottom: 5,
  },
  groupCommitBody: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
  },
  // Package cards
  recBanner: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  recBannerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  recBannerAvatar: { width: 24, height: 24, borderRadius: 12, borderWidth: 1 },
  recBannerAvatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recBannerAvatarFallbackText: { fontSize: 11, fontFamily: 'SpaceMono_700Bold' },
  recBannerLabel: { fontSize: 10, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.2 },
  recBannerText: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 19 },
  recPill: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  recPillText: { fontSize: 9, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.8 },
  packageCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, padding: 16, marginBottom: 10 },
  packageCardSelected: { borderColor: C.green, backgroundColor: C.greenSoft },
  packageCardLeft: { flex: 1 },
  packageCardLabel: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold' },
  packageCardSub: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  packageCardPrice: { fontSize: 24, color: C.text, fontFamily: 'DMSans_700Bold' },
  packageCardPriceSub: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular' },
  packageCheckmark: { position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  // Duration cards
  durationCard: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, padding: 16, marginBottom: 12 },
  durationCardSelected: { borderColor: C.green, backgroundColor: C.greenSoft },
  durationCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  durationCardLabel: { fontSize: 18, color: C.text, fontFamily: 'DMSans_700Bold' },
  durationCardSubtitle: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  durationCardPrice: { fontSize: 22, color: C.text, fontFamily: 'DMSans_700Bold' },
  savingsBadge: { backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  savingsBadgeText: { fontSize: 10, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5 },
  durationBonuses: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border, gap: 4 },
  durationBonus: { fontSize: 12, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 18 },
  durationGiftHeader: { fontSize: 12, color: C.orange, fontFamily: 'DMSans_500Medium', marginTop: 6 },
  durationGiftItem: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  // Calendar
  calendar: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
  calNavText: { color: C.text, fontSize: 20, fontFamily: 'DMSans_700Bold' },
  calMonthLabel: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  calDayRow: { flexDirection: 'row', marginBottom: 8 },
  calDayLabel: { flex: 1, textAlign: 'center', fontSize: 11, color: C.muted, fontFamily: 'DMSans_500Medium' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calCellToday: { borderWidth: 1, borderColor: C.greenBorder, borderRadius: 20 },
  calCellSelected: { backgroundColor: C.green, borderRadius: 20 },
  calCellPast: { opacity: 0.3 },
  calCellText: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  calCellTextSelected: { color: '#000', fontFamily: 'DMSans_700Bold' },
  calCellTextPast: { color: C.muted },
  // Time slots
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeSlot: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  timeSlotSelected: { backgroundColor: C.green, borderColor: C.green },
  timeSlotText: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  timeSlotTextSelected: { color: '#000', fontFamily: 'DMSans_700Bold' },
  // Confirm
  confirmCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 16, marginBottom: 14 },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  confirmLabel: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular' },
  confirmValue: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium' },
  bonusPreviewCard: { backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 14, padding: 14, marginBottom: 14, gap: 4 },
  bonusPreviewTitle: { fontSize: 13, color: C.green, fontFamily: 'DMSans_700Bold' },
  bonusPreviewItem: { fontSize: 12, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 18 },
  paymentNote: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  paymentNoteText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 18 },
  // Active plan dashboard
  nextSessionHero: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1.5, borderColor: C.green, borderRadius: 16, padding: 16, marginBottom: 14, gap: 12 },
  nextSessionEyebrow: { fontSize: 10, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  nextSessionDate: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 2 },
  nextSessionCountdown: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular' },
  nextSessionTapHint: { fontSize: 11, color: C.green, fontFamily: 'DMSans_400Regular', marginTop: 4, opacity: 0.7 },
  joinSessionBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  joinSessionBtnText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 11 },
  joinSessionBtnSub: { fontSize: 14 },
  planStatusRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  planStatusChip: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, alignItems: 'center' },
  planStatusLabel: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1, textTransform: 'uppercase' },
  planStatusValue: { fontSize: 13, color: C.text, fontFamily: 'DMSans_700Bold', marginTop: 3 },
  planStatusHint: { fontSize: 10, color: C.green, fontFamily: 'DMSans_400Regular', marginTop: 5, opacity: 0.8 },
  // Bonus tracker card
  bonusCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginBottom: 14 },
  bonusCardTitle: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 8 },
  bonusSessionRow: { flexDirection: 'row', alignItems: 'center' },
  bonusSessionText: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular' },
  bonusSessionCount: { fontSize: 13, fontFamily: 'DMSans_700Bold' },
  bonusGiftRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bonusGiftName: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular', flex: 1 },
  bonusGiftBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  bonusGiftStatus: { fontSize: 10, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.3 },
  addressWarning: { marginTop: 10, backgroundColor: C.orangeSoft, borderWidth: 1, borderColor: C.orangeBorder, borderRadius: 8, padding: 10 },
  addressWarningText: { fontSize: 12, color: C.orange, fontFamily: 'DMSans_400Regular', lineHeight: 18 },
  // Session history
  sessionHistoryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  sessionHistoryDate: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium' },
  sessionHistoryMeta: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  sessionStatusDot: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  sessionStatusText: { fontSize: 9, color: '#000', fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5 },
  // Session Calendar Modal
  scOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  scSheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(0,255,136,0.25)', padding: 20, paddingBottom: 36 },
  scHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  scTitle: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold', textAlign: 'center', marginBottom: 4 },
  scSessionDate: { fontSize: 13, color: C.green, fontFamily: 'DMSans_500Medium', textAlign: 'center', marginBottom: 16 },
  scCalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  scCalNavBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: C.dark, borderRadius: 8 },
  scCalNavText: { fontSize: 20, color: C.text, fontFamily: 'DMSans_500Medium', lineHeight: 24 },
  scCalMonthLabel: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  scDayRow: { flexDirection: 'row', marginBottom: 4 },
  scDayLabel: { flex: 1, textAlign: 'center', fontSize: 10, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5, paddingVertical: 4 },
  scGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  scCell: { width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 3 },
  scCellToday: { backgroundColor: 'rgba(0,255,136,0.15)', borderRadius: 8, borderWidth: 1.5, borderColor: C.green },
  scCellSession: { backgroundColor: 'rgba(255,107,53,0.18)', borderRadius: 8, borderWidth: 1.5, borderColor: C.orange },
  scCellText: { fontSize: 14, color: C.text, fontFamily: 'DMSans_500Medium' },
  scCellTextToday: { color: C.green, fontFamily: 'DMSans_700Bold' },
  scCellTextSession: { color: C.orange, fontFamily: 'DMSans_700Bold' },
  scLegend: { flexDirection: 'row', gap: 20, marginTop: 14, justifyContent: 'center' },
  scLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scLegendDot: { width: 10, height: 10, borderRadius: 5 },
  scLegendText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  scCloseBtn: { marginTop: 20, backgroundColor: C.dark, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingVertical: 14, alignItems: 'center' },
  scCloseBtnText: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  // Manage
  manageRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  manageBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  manageBtnText: { fontSize: 13, fontFamily: 'DMSans_500Medium' },
  // Pro gate
  proGate: { alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20 },
  proGateIcon: { fontSize: 48 },
  proGateTitle: { fontSize: 22, color: C.text, fontFamily: 'DMSans_700Bold', textAlign: 'center' },
  proGateBody: { fontSize: 14, color: C.muted, fontFamily: 'DMSans_400Regular', textAlign: 'center', lineHeight: 22 },
  proGateBtn: { minWidth: 172, paddingHorizontal: 22, marginTop: 2 },
  linkCoachCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 16, padding: 16, marginBottom: 14, gap: 8 },
  linkCoachTitle: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold' },
  linkCoachBody: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 19 },
  linkCoachBtn: { alignSelf: 'flex-start', backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  linkCoachBtnText: { fontSize: 12, color: C.green, fontFamily: 'DMSans_700Bold' },
  coachIntroCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginBottom: 14, gap: 12 },
  coachIntroEyebrow: { fontSize: 10, color: C.orange, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.2 },
  coachIntroHeader: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  coachIntroAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: C.greenBorder,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coachIntroAvatarImage: { width: '100%', height: '100%' },
  coachIntroAvatarText: { color: C.green, fontFamily: 'DMSans_700Bold', fontSize: 18 },
  coachIntroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  coachIntroName: { fontSize: 18, color: C.text, fontFamily: 'DMSans_700Bold' },
  coachIntroBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.45)',
    backgroundColor: 'rgba(255,107,53,0.12)',
  },
  coachIntroBadgeText: { color: C.orange, fontFamily: 'SpaceMono_400Regular', fontSize: 10 },
  coachIntroMeta: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  coachIntroBody: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 20 },
  // Buttons
  btnRow: { flexDirection: 'row', gap: 10 },
  btnPrimary: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  btnPrimaryText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  btnGhostText: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },
  // Payment form
  paymentForm: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginBottom: 16, gap: 4 },
  paymentFieldLabel: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_500Medium', marginTop: 10, marginBottom: 4, letterSpacing: 0.5, textTransform: 'uppercase' },
  paymentInput: { backgroundColor: C.dark, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 15 },
  paymentSecureBadge: { marginTop: 12, alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border },
  paymentSecureText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  // Message coach
  msgCoachBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 16, padding: 16, marginBottom: 14 },
  msgCoachIcon: { fontSize: 24 },
  msgCoachTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  msgCoachSub: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  // Chat modal
  chatOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  chatModal: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%', flex: 0.8 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  chatHeaderTitle: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold' },
  chatBubbleWrap: { marginBottom: 4 },
  chatBubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  chatBubbleClient: { backgroundColor: C.green, borderBottomRightRadius: 4 },
  chatBubbleCoach: { backgroundColor: C.dark, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  chatBubbleText: { fontSize: 14, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 20 },
  chatInputRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: C.border },
  chatInput: { flex: 1, backgroundColor: C.dark, borderWidth: 1, borderColor: C.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  chatSendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  chatSendBtnDisabled: { opacity: 0.4 },
  chatSendIcon: { color: '#000', fontSize: 18, fontFamily: 'DMSans_700Bold' },
  // Media chat attachments
  chatMediaBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  chatMediaBtnActive: { backgroundColor: 'rgba(239,68,68,0.2)', borderColor: '#EF4444' },
  chatMediaBtnIcon: { fontSize: 16 },
  chatMediaImage: { width: 200, height: 140, borderRadius: 10, marginBottom: 4 },
  chatVideoThumb: { position: 'relative', width: 200, height: 140, borderRadius: 10, marginBottom: 4, overflow: 'hidden' },
  chatVideoPlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  // Audio playback
  audioPlayBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 2 },
  audioPlayIcon: { fontSize: 18, color: C.text },
  audioWaveform: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 28 },
  audioBar: { width: 3, borderRadius: 2, backgroundColor: C.border },
  audioLabel: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular' },
  // Skip / ghost text button
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipBtnText: { color: C.muted, fontSize: 13, fontFamily: 'DMSans_400Regular' },
  // Exit / free trial offer modal
  exitOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  exitSheet: {
    backgroundColor: C.black,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(0,255,136,0.3)',
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
  exitHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 8 },
  exitEmoji: { fontSize: 40, textAlign: 'center' },
  exitTitle: { fontSize: 26, color: C.text, fontFamily: 'BebasNeue_400Regular', letterSpacing: 1, textAlign: 'center' },
  exitSub: { fontSize: 14, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 21, textAlign: 'center' },
  inviteInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, color: C.text, fontFamily: 'SpaceMono_400Regular', fontSize: 18, letterSpacing: 2, textAlign: 'center' },
  exitTermCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  exitTermIcon: { fontSize: 24, lineHeight: 28 },
  exitTermHeading: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 2 },
  exitTermBody: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 18 },
  // Fit call profile card
  fitCallProfileCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    gap: 12,
  },
  fitCallProfileHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fitCallAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: C.greenBorder,
  },
  fitCallProfileName: { fontSize: 17, color: C.text, fontFamily: 'DMSans_700Bold' },
  fitCallProfileTitle: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2, lineHeight: 17 },
  fitCallProfileBio: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 20 },
  fitCallSocialRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  fitCallSocialBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.green,
    backgroundColor: `${C.green}18`,
  },
  fitCallSocialText: { fontSize: 13, color: C.green, fontFamily: 'DMSans_600SemiBold' },
  // Fit call CTA button
  fitCallCTA: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  fitCallCTAText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  // Fit call booking modal sheet
  fitCallSheet: {
    backgroundColor: C.black,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(0,255,136,0.3)',
    padding: 24,
    paddingBottom: 44,
    gap: 10,
  },
  fitCallTitle: { fontSize: 22, color: C.text, fontFamily: 'DMSans_700Bold' },
  fitCallSub: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 19, marginBottom: 4 },
  fitCallDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  fitCallDateLabel: { fontSize: 15, color: C.text, fontFamily: 'DMSans_500Medium' },
  fitCallChevron: { fontSize: 20, color: C.green },
  fitCallLoadingWrap: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  fitCallLoadingText: { fontSize: 14, color: C.muted, fontFamily: 'DMSans_400Regular', textAlign: 'center', lineHeight: 21 },
  fitCallFallbackNote: { fontSize: 12, color: '#b8860b', fontFamily: 'DMSans_400Regular', textAlign: 'center', marginBottom: 12, paddingHorizontal: 8 },
  fitCallSlotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  fitCallSlot: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  fitCallSlotText: { fontSize: 14, color: C.text, fontFamily: 'DMSans_400Regular' },
  fitCallFieldLabel: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 4,
  },
  fitCallInput: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
  },
  fitCallInputMulti: { minHeight: 80, textAlignVertical: 'top' },
  // Success view
  fitCallSuccessWrap: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  fitCallCalendarBtn: { alignSelf: 'stretch', borderWidth: 1.5, borderColor: '#3a3a3a', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  fitCallCalendarBtnText: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 15 },
  fitCallSuccessEmoji: { fontSize: 52, textAlign: 'center' },
  fitCallSuccessTitle: { fontSize: 26, color: '#FFFFFF', fontFamily: 'DMSans_700Bold', textAlign: 'center' },
  fitCallSuccessBody: { fontSize: 14, color: '#CCCCCC', fontFamily: 'DMSans_400Regular', textAlign: 'center', lineHeight: 22 },
});
