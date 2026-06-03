/**
 * CoachModeScreen
 *
 * Private screen for the coach (Joshua) to manage clients,
 * view the booking calendar, and track gift fulfilment.
 * Accessible via Profile → Coach Mode (admin only).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Video, ResizeMode } from 'expo-av';

import { Asset } from 'expo-asset';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { isAdminEnabled } from '@/lib/adminMode';
import { getCoachFormReviewClips, type FormReviewClip } from '@/lib/formReview';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { createCoachInvite, getCoachClients as loadCoachClients, getCoachInvites, updateCoachClientLink, type CoachInvite } from '@/lib/coachInvites';
import { scheduleCoachCheckInReminder, scheduleCoachSessionReminder, sendCoachBusinessNotification } from '@/lib/notifications';
import { approveDemoAsset, archiveDemoAsset, getCoachDemoAssets, getDemoAssetsForExercise, normalizeDemoExerciseName, type DemoAsset } from '@/lib/demoAssets';
import { env } from '@/lib/env';
import { buildDemoPrompt, pollJobStatus, submitImageToVideo, submitReferenceImage } from '@/lib/falVideoGen';
import { getCoachVoiceOptions } from '@/lib/coachVoice';
import { getAllProgramExerciseNames, getDemoVideoExercises } from '@/lib/plans';
import {
  getCoachShakeOrders,
  updateShakeOrderFulfillmentStatus,
  type ShakeOrder,
  type ShakeOrderFulfillmentStatus,
} from '@/lib/shakeOrders';
import { isWalkWaterModeEnabled, setWalkWaterModeEnabled, WALK_WATER_MODE_EVENT } from '@/lib/walkWaterMode';

import { apexColors as C } from '@/theme/colors';
import {
  type ClientProfile,
  type CoachClient,
  type GiftStatus,
  type SessionAttendanceRecord,
  type SessionType,
  DURATION_OPTIONS,
  SESSION_PACKAGES,
  formatSessionDate,
  getDaysUntil,
  openZoomSessionForCoach,
} from '@/lib/liveCoaching';

type AssistantCoachPlan = {
  summary: string;
  workoutAdjustments: string[];
  mealPlanAdjustments: string[];
  groceryUpdates: string[];
  scheduleGuidance: string[];
  suggestedSchedule?: Array<{ date: string; time: string; type: SessionType }>;
};

const BUILT_IN_STUDIO_REFERENCES: Partial<Record<'Marcus' | 'Serena', number>> = {
  Marcus: require('../../assets/marcus-reference.png'),
  Serena: require('../../assets/serena-reference.png'),
};

const COACH_DEMO_CLIENTS_KEY = '@apex_coach_demo_clients';

async function getLocalCoachDemoClients(): Promise<CoachClient[]> {
  try {
    const raw = await AsyncStorage.getItem(COACH_DEMO_CLIENTS_KEY);
    return raw ? (JSON.parse(raw) as CoachClient[]) : [];
  } catch {
    return [];
  }
}

async function saveLocalCoachDemoClients(clients: CoachClient[]): Promise<void> {
  await AsyncStorage.setItem(COACH_DEMO_CLIENTS_KEY, JSON.stringify(clients));
}

function mergeCoachClients(remoteClients: CoachClient[], localDemoClients: CoachClient[]): CoachClient[] {
  const merged = new Map<string, CoachClient>();
  remoteClients.forEach((client) => merged.set(client.id, client));
  localDemoClients.forEach((client) => {
    if (!merged.has(client.id)) {
      merged.set(client.id, client);
    }
  });
  return Array.from(merged.values());
}

type FitCallRow = {
  id: string;        // booking UUID — used as thread key when user_id is null
  user_id: string | null;
  client_name: string;
  client_phone: string;
  challenge: string;
  session_date: string;
  session_time: string;
  created_at: string;
  status: string;
  goal?: string | null;
  diet_habits?: string | null;
};

async function loadFitCallClients(): Promise<{ clients: CoachClient[]; rows: FitCallRow[] }> {
  const { data } = await supabase
    .from('coaching_fit_calls')
    .select('id, user_id, client_name, client_phone, challenge, session_date, session_time, created_at, status, goal, diet_habits')
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as FitCallRow[];
  const clients: CoachClient[] = rows.map((row) => ({
    // Fall back to booking UUID when user_id is null so the thread still surfaces
    id: row.user_id ?? row.id,
    name: row.client_name,
    email: row.client_phone,
    packageId: '1x' as const,
    durationId: 'weekly' as const,
    startDate: row.session_date,
    sessionType: '1on1' as const,
    totalSessions: 1,
    completedSessions: 0,
    bonus: { extraSessionsTotal: 0, extraSessionsUsed: 0, extraSessionType: '1on1' as const, gifts: [] },
    notes: [
      'WW DM Booking',
      `${row.session_date} ${row.session_time}`,
      row.challenge,
      `📞 ${row.client_phone}`,
      row.goal       ? `🎯 ${row.goal}`        : null,
      row.diet_habits ? `🥗 ${row.diet_habits}` : null,
    ].filter(Boolean).join(' · '),
  }));
  return { clients, rows };
}

type WWParticipant = { client: CoachClient; lastActiveAt: string };

async function loadWWParticipants(): Promise<WWParticipant[]> {
  const { data } = await supabase
    .from('ww_daily_stats')
    .select('user_id, display_name, steps, streak, updated_at')
    .order('updated_at', { ascending: false });
  if (!data) return [];

  type StatRow = { user_id: string; display_name: string | null; steps: number; streak: number; updated_at: string };
  const byUser = new Map<string, { name: string; steps: number; streak: number; lastActiveAt: string }>();

  for (const row of data as StatRow[]) {
    if (!row.user_id) continue;
    const existing = byUser.get(row.user_id);
    if (existing) {
      existing.steps += row.steps;
      existing.streak = Math.max(existing.streak, row.streak);
    } else {
      byUser.set(row.user_id, {
        name: row.display_name?.trim() || 'Anonymous',
        steps: row.steps,
        streak: row.streak,
        lastActiveAt: row.updated_at,
      });
    }
  }

  return Array.from(byUser.entries()).map(([userId, info]) => ({
    lastActiveAt: info.lastActiveAt,
    client: {
      id: userId,
      name: info.name,
      email: '',
      packageId: '1x' as const,
      durationId: 'weekly' as const,
      startDate: new Date().toISOString().slice(0, 10),
      sessionType: '1on1' as const,
      totalSessions: 0,
      completedSessions: 0,
      bonus: { extraSessionsTotal: 0, extraSessionsUsed: 0, extraSessionType: '1on1' as const, gifts: [] },
      notes: `WW Participant · 👟 ${info.steps.toLocaleString()} steps · ${info.streak}d streak`,
    },
  }));
}

async function loadBundledReferenceBase64(source: number) {
  const asset = Asset.fromModule(source);
  if (!asset.localUri) {
    await asset.downloadAsync();
  }

  const readableUri = asset.localUri ?? asset.uri;
  if (!readableUri) {
    throw new Error('Could not resolve the bundled coach reference.');
  }

  return FileSystem.readAsStringAsync(readableUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

function parseAssistantCoachPlan(raw: string): AssistantCoachPlan | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<AssistantCoachPlan>;
    return {
      summary: parsed.summary?.trim() || 'No summary returned.',
      workoutAdjustments: Array.isArray(parsed.workoutAdjustments) ? parsed.workoutAdjustments.filter(Boolean) : [],
      mealPlanAdjustments: Array.isArray(parsed.mealPlanAdjustments) ? parsed.mealPlanAdjustments.filter(Boolean) : [],
      groceryUpdates: Array.isArray(parsed.groceryUpdates) ? parsed.groceryUpdates.filter(Boolean) : [],
      scheduleGuidance: Array.isArray(parsed.scheduleGuidance) ? parsed.scheduleGuidance.filter(Boolean) : [],
      suggestedSchedule: Array.isArray(parsed.suggestedSchedule)
        ? parsed.suggestedSchedule
          .filter((slot) => slot && typeof slot.date === 'string' && typeof slot.time === 'string')
          .map((slot) => ({
            date: slot.date,
            time: slot.time,
            type: slot.type ?? '1on1',
          }))
        : undefined,
    };
  } catch {
    return null;
  }
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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

const GIFT_STATUS_COLORS: Record<GiftStatus, string> = {
  pending: C.muted,
  processing: C.orange,
  shipped: C.blue,
  delivered: C.green,
};

const GIFT_STATUS_LABELS: Record<GiftStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  '1on1': '1-on-1',
  group: 'Group',
  mobility: 'Mobility',
};

// ─── Components ───────────────────────────────────────────────────────────────

/** Read-only monthly calendar that marks today + any session days. */
function CoachCalendarGrid({
  sessionDates,
  onDayPress,
}: {
  sessionDates: string[];        // 'YYYY-MM-DD'
  onDayPress?: (dateStr: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = React.useState(now.getFullYear());
  const [month, setMonth] = React.useState(now.getMonth());

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const cells = getCalendarDays(year, month);
  const sessionSet = new Set(sessionDates);

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  return (
    <View style={styles.coachCal}>
      {/* Month navigation */}
      <View style={styles.coachCalHeader}>
        <Pressable onPress={prevMonth} hitSlop={12} style={styles.coachCalNavBtn}>
          <Text style={styles.coachCalNavText}>‹</Text>
        </Pressable>
        <Text style={styles.coachCalMonthLabel}>{MONTH_NAMES[month]} {year}</Text>
        <Pressable onPress={nextMonth} hitSlop={12} style={styles.coachCalNavBtn}>
          <Text style={styles.coachCalNavText}>›</Text>
        </Pressable>
      </View>

      {/* Day-of-week headers */}
      <View style={styles.coachCalDayRow}>
        {DAY_LABELS.map((d) => (
          <Text key={d} style={styles.coachCalDayLabel}>{d}</Text>
        ))}
      </View>

      {/* Date grid */}
      <View style={styles.coachCalGrid}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={`empty-${i}`} style={styles.coachCalCell} />;
          const isToday = cell.dateStr === todayStr;
          const hasSession = sessionSet.has(cell.dateStr);
          return (
            <Pressable
              key={cell.dateStr}
              style={[
                styles.coachCalCell,
                isToday ? styles.coachCalCellToday : null,
                hasSession ? styles.coachCalCellSession : null,
              ]}
              onPress={() => hasSession && onDayPress?.(cell.dateStr)}
              hitSlop={2}
            >
              <Text style={[
                styles.coachCalCellText,
                isToday ? styles.coachCalCellTextToday : null,
                hasSession ? styles.coachCalCellTextSession : null,
              ]}>
                {cell.day}
              </Text>
              {hasSession ? <View style={styles.coachCalSessionDot} /> : null}
            </Pressable>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.coachCalLegend}>
        <View style={styles.coachCalLegendItem}>
          <View style={[styles.coachCalLegendDot, { backgroundColor: C.green }]} />
          <Text style={styles.coachCalLegendText}>Today</Text>
        </View>
        <View style={styles.coachCalLegendItem}>
          <View style={[styles.coachCalLegendDot, { backgroundColor: C.orange }]} />
          <Text style={styles.coachCalLegendText}>Live Session</Text>
        </View>
      </View>
    </View>
  );
}

function SectionLabel({ children, style }: { children: string; style?: object }) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

function ClientCard({
  client,
  onMessage,
  onPress,
}: {
  client: CoachClient;
  onMessage: (c: CoachClient) => void;
  onPress: (c: CoachClient) => void;
}) {
  const pkg = SESSION_PACKAGES.find((p) => p.id === client.packageId);
  const dur = DURATION_OPTIONS.find((d) => d.id === client.durationId);
  const sessionsLeft = client.totalSessions - client.completedSessions;
  const daysUntilNext = client.nextSession
    ? getDaysUntil(client.nextSession.split('T')[0])
    : null;

  return (
    <Pressable style={styles.clientCard} onPress={() => onPress(client)}>
      <View style={styles.clientAvatar}>
        <Text style={styles.clientAvatarText}>
          {client.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.clientName}>{client.name}</Text>
        <Text style={styles.clientMeta}>
          {pkg?.label} · {dur?.label} · {SESSION_TYPE_LABELS[client.sessionType]}
        </Text>
        {client.nextSession ? (
          <Text style={styles.clientNext}>
            Next: {formatSessionDate(client.nextSession.split('T')[0], client.nextSession.split('T')[1].slice(0, 5))}
            {daysUntilNext !== null ? ` (in ${daysUntilNext}d)` : ''}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={styles.sessionsPill}>{client.completedSessions}/{client.totalSessions}</Text>
        <Pressable
          style={styles.msgChip}
          onPress={(e) => { e.stopPropagation(); onMessage(client); }}
          hitSlop={6}
        >
          <Text style={styles.msgChipText}>💬</Text>
        </Pressable>
        {sessionsLeft <= 2 ? (
          <View style={styles.renewBadge}>
            <Text style={styles.renewBadgeText}>RENEW</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function GiftRow({
  clientName,
  gift,
  onUpdateStatus,
}: {
  clientName: string;
  gift: CoachClient['bonus']['gifts'][number];
  onUpdateStatus: (giftId: string, status: GiftStatus) => void;
}) {
  const statusColor = GIFT_STATUS_COLORS[gift.status];
  const NEXT_STATUS: Record<GiftStatus, GiftStatus> = {
    pending: 'processing',
    processing: 'shipped',
    shipped: 'delivered',
    delivered: 'delivered',
  };

  return (
    <View style={styles.giftRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.giftName}>{gift.name}</Text>
        <Text style={styles.giftClient}>{clientName}</Text>
        {gift.trackingNumber ? (
          <Text style={styles.giftTracking}>📦 {gift.trackingNumber}</Text>
        ) : null}
      </View>
      <Pressable
        style={[styles.giftStatusBtn, { borderColor: statusColor }]}
        onPress={() => {
          if (gift.status !== 'delivered') {
            onUpdateStatus(gift.id, NEXT_STATUS[gift.status]);
          }
        }}
      >
        <Text style={[styles.giftStatusText, { color: statusColor }]}>
          {GIFT_STATUS_LABELS[gift.status]}
        </Text>
      </Pressable>
    </View>
  );
}

function ShakeOrderRow({
  order,
  onUpdateStatus,
}: {
  order: ShakeOrder;
  onUpdateStatus: (orderId: string, status: ShakeOrderFulfillmentStatus) => void;
}) {
  const NEXT_STATUS: Record<ShakeOrderFulfillmentStatus, ShakeOrderFulfillmentStatus> = {
    pending: 'ordered',
    ordered: 'shipped',
    shipped: 'completed',
    completed: 'completed',
    cancelled: 'cancelled',
  };

  const STATUS_COLORS: Record<ShakeOrderFulfillmentStatus, string> = {
    pending: C.orange,
    ordered: C.blue,
    shipped: C.green,
    completed: C.purple,
    cancelled: C.muted,
  };

  return (
    <View style={styles.shakeOrderRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.giftName}>{order.fullName}</Text>
        <Text style={styles.giftClient}>
          {order.flavor === 'vanilla' ? 'Vanilla' : 'Chocolate'} · ${order.amountTotal.toFixed(2)}
        </Text>
        <Text style={styles.shippingAddr}>
          📍 {order.shippingLine1}
          {order.shippingLine2 ? `, ${order.shippingLine2}` : ''}
          {`\n${order.shippingCity}, ${order.shippingState} ${order.shippingPostalCode} · ${order.shippingCountry}`}
        </Text>
        {order.email ? <Text style={styles.giftTracking}>✉️ {order.email}</Text> : null}
        {order.phone ? <Text style={styles.giftTracking}>☎️ {order.phone}</Text> : null}
      </View>
      <Pressable
        style={[styles.giftStatusBtn, { borderColor: STATUS_COLORS[order.fulfillmentStatus] }]}
        onPress={() => {
          if (order.fulfillmentStatus !== 'completed' && order.fulfillmentStatus !== 'cancelled') {
            onUpdateStatus(order.id, NEXT_STATUS[order.fulfillmentStatus]);
          }
        }}
      >
        <Text style={[styles.giftStatusText, { color: STATUS_COLORS[order.fulfillmentStatus] }]}>
          {order.fulfillmentStatus.toUpperCase()}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Coach Message Modal ──────────────────────────────────────────────────────

type ChatMessage = {
  id: string;
  sender_role: 'coach' | 'client';
  content: string;
  sent_at: string;
};

type CoachInboxThread = {
  client: CoachClient;
  latestMessage: string;
  latestSentAt: string;
  latestSenderRole: 'coach' | 'client';
  messageCount: number;
};

type GroupRoster = {
  id: string;
  date: string;
  time: string;
  clients: CoachClient[];
};

function CoachMessageModal({
  client,
  coachUserId,
  visible,
  onClose,
}: {
  client: CoachClient | null;
  coachUserId?: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);

  // Load messages when modal opens
  useEffect(() => {
    if (!visible || !client) return;
    const load = async () => {
      const { data } = await supabase
        .from('coach_messages')
        .select('id, sender_role, content, sent_at')
        .eq('user_id', client.id)
        .order('sent_at', { ascending: true })
        .limit(100);
      if (data) setMessages(data as ChatMessage[]);
    };
    load().catch(() => null);
  }, [visible, client]);

  const handleSend = async () => {
    if (!text.trim() || !client) return;
    const optimistic: ChatMessage = {
      id: Date.now().toString(),
      sender_role: 'coach',
      content: text.trim(),
      sent_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setText('');
    setSending(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await supabase.from('coach_messages').insert({
        user_id: client.id,
        coach_id: coachUserId ?? null,
        sender_role: 'coach',
        content: optimistic.content,
        sent_at: optimistic.sent_at,
      });
    } catch {
      /* fire-and-forget for demo clients without real user_id */
    } finally {
      setSending(false);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  if (!client) return null;

  const initials = client.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // Parse booking context from notes when this is a WW DM Booking thread.
  // Format: "WW DM Booking · <datetime> · <challenge> · 📞 <phone>[· 🎯 <goal>][· 🥗 <dietHabits>]"
  // Parts beyond index 3 use emoji prefixes so they are position-independent
  // and backward-compatible with older bookings that don't have these fields.
  const bookingInfo = (() => {
    if (!client.notes?.startsWith('WW DM Booking')) return null;
    const parts = client.notes.split(' · ');
    const rawDateTime = parts[1] ?? '';
    const challenge = parts[2] ?? '';
    const phone = (parts[3] ?? '').replace('📞 ', '');
    const goal = parts.find((p) => p.startsWith('🎯 '))?.slice(2).trim() ?? '';
    const dietHabits = parts.find((p) => p.startsWith('🥗 '))?.slice(2).trim() ?? '';
    const dt = rawDateTime ? new Date(rawDateTime.replace(' ', 'T')) : null;
    const dateStr = dt && !isNaN(dt.getTime())
      ? dt.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
      : rawDateTime;
    const timeStr = dt && !isNaN(dt.getTime())
      ? dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';
    return { date: dateStr, time: timeStr, challenge, phone, goal, dietHabits };
  })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.msgOverlay}>
          <View style={styles.msgModal}>
            {/* Header */}
            <View style={styles.msgHeader}>
              <View style={styles.msgAvatar}>
                <Text style={styles.msgAvatarText}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.msgClientName}>{client.name}</Text>
                <Text style={styles.msgClientEmail}>{client.email}</Text>
              </View>
              <Pressable onPress={onClose} style={styles.msgCloseBtn}>
                <Text style={styles.msgCloseTxt}>✕</Text>
              </Pressable>
            </View>

            {/* Messages */}
            <FlatList
              ref={flatRef}
              data={messages}
              keyExtractor={(m) => m.id}
              style={styles.msgList}
              contentContainerStyle={styles.msgListContent}
              onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
              ListHeaderComponent={
                bookingInfo ? (
                  <View style={{
                    backgroundColor: 'rgba(0,255,135,0.06)',
                    borderWidth: 1,
                    borderColor: 'rgba(0,255,135,0.2)',
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 12,
                  }}>
                    <Text style={{ fontSize: 9, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.2, marginBottom: 10 }}>
                      📅 FIT CALL BOOKING
                    </Text>
                    {[
                      { label: 'Date',       value: bookingInfo.date },
                      bookingInfo.time      ? { label: 'Time',      value: bookingInfo.time }      : null,
                      bookingInfo.phone     ? { label: 'Phone',     value: bookingInfo.phone }     : null,
                      bookingInfo.challenge ? { label: 'Challenge', value: bookingInfo.challenge } : null,
                      bookingInfo.goal      ? { label: 'Goal',      value: bookingInfo.goal }      : null,
                      bookingInfo.dietHabits ? { label: 'Diet & Movement', value: bookingInfo.dietHabits } : null,
                    ].filter(Boolean).map((row) => (
                      <View key={row!.label} style={{ flexDirection: 'row', gap: 10, marginBottom: 5 }}>
                        <Text style={{ fontSize: 12, color: C.muted, fontFamily: 'DMSans_500Medium', width: 44 }}>{row!.label}</Text>
                        <Text style={{ fontSize: 12, color: C.text, fontFamily: 'DMSans_400Regular', flex: 1 }}>{row!.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.msgEmpty}>
                  <Text style={styles.msgEmptyTxt}>
                    {bookingInfo
                      ? 'No messages yet.\nSend your client a note to confirm.'
                      : 'No messages yet.\nSend your client a note below.'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const isCoach = item.sender_role === 'coach';
                return (
                  <View
                    style={[
                      styles.msgBubbleWrap,
                      isCoach ? styles.msgBubbleWrapRight : styles.msgBubbleWrapLeft,
                    ]}
                  >
                    <View
                      style={[
                        styles.msgBubble,
                        isCoach ? styles.msgBubbleCoach : styles.msgBubbleClient,
                      ]}
                    >
                      <Text
                        style={[
                          styles.msgBubbleText,
                          isCoach ? styles.msgBubbleTextCoach : styles.msgBubbleTextClient,
                        ]}
                      >
                        {item.content}
                      </Text>
                    </View>
                    <Text style={[styles.msgTime, isCoach ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
                      {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                );
              }}
            />

            {/* Input row */}
            <View style={styles.msgInputRow}>
              <TextInput
                style={styles.msgInput}
                value={text}
                onChangeText={setText}
                placeholder="Message your client..."
                placeholderTextColor={C.muted}
                multiline
                maxLength={1000}
                returnKeyType="default"
              />
              <Pressable
                style={[styles.msgSendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
                onPress={handleSend}
                disabled={!text.trim() || sending}
              >
                <Text style={styles.msgSendTxt}>↑</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InboxThreadCard({
  thread,
  onOpen,
}: {
  thread: CoachInboxThread;
  onOpen: (client: CoachClient) => void;
}) {
  const initials = thread.client.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Pressable style={styles.clientCard} onPress={() => onOpen(thread.client)}>
      <View style={styles.clientAvatar}>
        <Text style={styles.clientAvatarText}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.clientName}>{thread.client.name}</Text>
        <Text style={styles.clientMeta}>
          {thread.latestSenderRole === 'client' ? 'Client' : 'Coach'} · {new Date(thread.latestSentAt).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
        <Text style={styles.inboxPreview} numberOfLines={2}>
          {thread.latestMessage}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <View style={styles.inboxCountBadge}>
          <Text style={styles.inboxCountText}>{thread.messageCount}</Text>
        </View>
        {thread.latestSenderRole === 'client' ? (
          <View style={styles.inboxNeedsReplyBadge}>
            <Text style={styles.inboxNeedsReplyText}>Reply</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function GroupRosterModal({
  roster,
  visible,
  onClose,
  onMarkAttendance,
}: {
  roster: GroupRoster | null;
  visible: boolean;
  onClose: () => void;
  onMarkAttendance: (client: CoachClient, status: SessionAttendanceRecord['status']) => void;
}) {
  if (!roster) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modal, { maxHeight: '82%' }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.clientModalName}>GROUP ROSTER</Text>
          <Text style={styles.clientModalEmail}>{formatSessionDate(roster.date, roster.time)}</Text>
          <ScrollView style={{ marginTop: 16 }} showsVerticalScrollIndicator={false}>
            {roster.clients.map((client) => {
              const record = client.sessionAttendance?.find((item) => item.date === roster.date && item.time === roster.time);
              return (
                <View key={client.id} style={styles.groupRosterRow}>
                  <View style={styles.clientAvatar}>
                    <Text style={styles.clientAvatarText}>
                      {client.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientName}>{client.name}</Text>
                    <Text style={styles.clientMeta}>
                      {record ? `Marked ${record.status}` : 'Attendance not marked yet'}
                    </Text>
                  </View>
                  <Pressable style={styles.attendanceBtn} onPress={() => onMarkAttendance(client, 'present')}>
                    <Text style={styles.attendanceBtnText}>Present</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.attendanceBtn, styles.attendanceBtnGhost]}
                    onPress={() => onMarkAttendance(client, 'absent')}
                  >
                    <Text style={[styles.attendanceBtnText, { color: C.orange }]}>Absent</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.modalBtnRow}>
            <Pressable style={[styles.btnPrimary, { flex: 1 }]} onPress={onClose}>
              <Text style={styles.btnPrimaryText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AssistantCoachModal({
  client,
  coachUserId,
  visible,
  onClose,
  notes,
  sessionSchedule,
  recentWorkouts,
  recentMeals,
  onApplyNotes,
  onApplySchedule,
}: {
  client: CoachClient | null;
  coachUserId?: string;
  visible: boolean;
  onClose: () => void;
  notes: string;
  sessionSchedule: Array<{ date: string; time: string; type: SessionType }>;
  recentWorkouts: Array<{ workout_type: string; workout_date: string; calories_burned: number; duration_minutes: number }>;
  recentMeals: Array<{ meal_name: string; calories: number; protein_grams: number; consumed_at: string }>;
  onApplyNotes: (nextNotes: string) => void;
  onApplySchedule: (nextSchedule: Array<{ date: string; time: string; type: SessionType }>) => void;
}) {
  const [request, setRequest] = useState("Tighten this client's training, nutrition, grocery priorities, and coaching schedule for the next 2 weeks.");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<AssistantCoachPlan | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(false);
    setPlan(null);
  }, [visible, client?.id]);

  const handleGenerate = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const cp = client.clientProfile;
      const workoutBlock = recentWorkouts.length
        ? recentWorkouts
          .map((w) => `- ${w.workout_date}: ${w.workout_type}, ${w.duration_minutes} min, ${w.calories_burned} cal`)
          .join('\n')
        : '- No recent workouts logged yet';
      const mealBlock = recentMeals.length
        ? recentMeals
          .slice(0, 6)
          .map((m) => `- ${m.meal_name}: ${m.calories} cal, ${m.protein_grams}g protein (${new Date(m.consumed_at).toLocaleDateString()})`)
          .join('\n')
        : '- No recent meals logged yet';
      const scheduleBlock = sessionSchedule.length
        ? sessionSchedule.map((slot) => `- ${slot.date} ${slot.time} (${slot.type})`).join('\n')
        : '- No weekly schedule set';

      const prompt = `You are the assistant AI coach for a fitness business. Give the human coach clear, practical next-step recommendations for this client.

CLIENT
- Name: ${client.name}
- Package: ${client.packageId}
- Duration: ${client.durationId}
- Session type: ${client.sessionType}
- Completed sessions: ${client.completedSessions}/${client.totalSessions}
- Coach notes: ${notes || 'None yet'}

PROFILE
- Goal: ${cp?.goal ?? 'unknown'}
- Experience: ${cp?.experience ?? 'unknown'}
- Active plan: ${cp?.activePlan ?? 'unknown'}
- Current weight: ${cp?.currentWeightLbs ?? 'unknown'}
- Goal weight: ${cp?.goalWeightLbs ?? 'unknown'}
- Calories: ${cp?.dailyCalories ?? 'unknown'}
- Protein: ${cp?.dailyProtein ?? 'unknown'}
- Equipment: ${cp?.equipment ?? 'unknown'}
- Health conditions: ${cp?.healthConditions ?? 'none'}
- Medications: ${cp?.medications ?? 'none'}

RECENT WORKOUTS
${workoutBlock}

RECENT MEALS
${mealBlock}

CURRENT SESSION SCHEDULE
${scheduleBlock}

COACH REQUEST
${request.trim()}

Respond with ONLY valid JSON:
{
  "summary":"short coach-facing summary",
  "workoutAdjustments":["..."],
  "mealPlanAdjustments":["..."],
  "groceryUpdates":["..."],
  "scheduleGuidance":["..."],
  "suggestedSchedule":[{"date":"YYYY-MM-DD","time":"HH:MM","type":"1on1"}]
}

Rules:
- Keep it practical and concise.
- Suggested schedule is optional.
- Do not invent medical claims.
- Optimize for actions a human coach can immediately apply.`;

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 1600,
          messages: [{ role: 'user', content: prompt }],
          system: 'You are an operations-minded assistant coach helping a live fitness coach manage a client. Output JSON only.',
        },
      });

      if (error) throw error;

      const raw =
        Array.isArray(data?.content)
          ? (data.content as Array<{ text?: string }>).map((block) => block.text ?? '').join('')
          : typeof data?.content === 'string'
            ? data.content
            : '';

      const parsed = parseAssistantCoachPlan(raw);
      if (!parsed) throw new Error('Bad assistant coach output');
      setPlan(parsed);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      Alert.alert('Assistant coach unavailable', error?.message ?? 'Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const buildNotesFromPlan = () => {
    if (!plan) return notes;
    const sections = [
      `Assistant AI Coach · ${new Date().toLocaleString()}`,
      plan.summary,
      plan.workoutAdjustments.length ? `Workout:\n- ${plan.workoutAdjustments.join('\n- ')}` : null,
      plan.mealPlanAdjustments.length ? `Nutrition:\n- ${plan.mealPlanAdjustments.join('\n- ')}` : null,
      plan.groceryUpdates.length ? `Grocery:\n- ${plan.groceryUpdates.join('\n- ')}` : null,
      plan.scheduleGuidance.length ? `Schedule:\n- ${plan.scheduleGuidance.join('\n- ')}` : null,
    ].filter(Boolean).join('\n\n');

    return notes.trim() ? `${notes.trim()}\n\n${sections}` : sections;
  };

  const renderList = (title: string, items: string[]) => {
    if (!items.length) return null;
    return (
      <View style={styles.assistantSection}>
        <Text style={styles.assistantSectionTitle}>{title}</Text>
        {items.map((item, index) => (
          <Text key={`${title}-${index}`} style={styles.assistantBullet}>• {item}</Text>
        ))}
      </View>
    );
  };

  const sendPlanToClient = async () => {
    if (!client || !plan) return;
    const content = [
      plan.summary,
      plan.workoutAdjustments[0] ? `Workout focus: ${plan.workoutAdjustments[0]}` : null,
      plan.mealPlanAdjustments[0] ? `Nutrition focus: ${plan.mealPlanAdjustments[0]}` : null,
      plan.scheduleGuidance[0] ? `Schedule note: ${plan.scheduleGuidance[0]}` : null,
    ].filter(Boolean).join('\n');

    try {
      await supabase.from('coach_messages').insert({
        user_id: client.id,
        coach_id: coachUserId ?? null,
        sender_role: 'coach',
        content,
        sent_at: new Date().toISOString(),
      });
      Alert.alert('Sent to client', 'The assistant summary was added to the client message thread.');
    } catch (error: any) {
      Alert.alert('Could not send message', error?.message ?? 'Please try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modal, { maxHeight: '90%' }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.clientModalName}>ASSISTANT AI COACH</Text>
          <Text style={styles.clientModalEmail}>
            Build next-step coaching guidance for {client?.name ?? 'this client'} and apply it directly.
          </Text>

          <SectionLabel style={{ marginTop: 18 }}>Coach Request</SectionLabel>
          <TextInput
            style={[styles.input, { minHeight: 92, textAlignVertical: 'top' }]}
            value={request}
            onChangeText={setRequest}
            placeholder="What should the assistant help you change?"
            placeholderTextColor={C.muted}
            multiline
          />

          <Pressable
            style={[styles.btnPrimary, loading ? { opacity: 0.7 } : null]}
            onPress={handleGenerate}
            disabled={loading}
          >
            <Text style={styles.btnPrimaryText}>{loading ? 'Thinking…' : 'Generate Coach Plan'}</Text>
          </Pressable>

          <ScrollView style={{ flex: 1, marginTop: 16 }} showsVerticalScrollIndicator={false}>
            {plan ? (
              <>
                <View style={styles.assistantSummaryCard}>
                  <Text style={styles.assistantSummaryLabel}>SUMMARY</Text>
                  <Text style={styles.assistantSummaryText}>{plan.summary}</Text>
                </View>
                {renderList('Workout Adjustments', plan.workoutAdjustments)}
                {renderList('Meal Plan Adjustments', plan.mealPlanAdjustments)}
                {renderList('Grocery Updates', plan.groceryUpdates)}
                {renderList('Schedule Guidance', plan.scheduleGuidance)}
                {plan.suggestedSchedule?.length ? (
                  <View style={styles.assistantSection}>
                    <Text style={styles.assistantSectionTitle}>Suggested Session Schedule</Text>
                    {plan.suggestedSchedule.map((slot, index) => (
                      <Text key={`${slot.date}-${slot.time}-${index}`} style={styles.assistantBullet}>
                        • {slot.date} at {slot.time} ({SESSION_TYPE_LABELS[slot.type]})
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🧠</Text>
                <Text style={styles.emptyTitle}>Ready to help</Text>
                <Text style={styles.emptyBody}>Generate a coach plan to get practical workout, nutrition, grocery, and schedule suggestions for this client.</Text>
              </View>
            )}
            <View style={{ height: 20 }} />
          </ScrollView>

          <View style={styles.modalBtnRow}>
            <Pressable style={styles.btnGhost} onPress={onClose}>
              <Text style={styles.btnGhostText}>Close</Text>
            </Pressable>
            <Pressable
              style={[styles.btnGhost, !plan && { opacity: 0.4 }]}
              disabled={!plan}
              onPress={() => {
                if (!plan?.suggestedSchedule?.length) return;
                onApplySchedule(plan.suggestedSchedule);
                Alert.alert('Schedule updated', "The assistant's suggested session schedule has been applied. Save changes when you're ready.");
              }}
            >
              <Text style={styles.btnGhostText}>Apply Schedule</Text>
            </Pressable>
            <Pressable
              style={[styles.btnGhost, !plan && { opacity: 0.4 }]}
              disabled={!plan}
              onPress={() => {
                sendPlanToClient().catch(() => null);
              }}
            >
              <Text style={styles.btnGhostText}>Message Client</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 1 }, !plan && { opacity: 0.4 }]}
              disabled={!plan}
              onPress={() => {
                onApplyNotes(buildNotesFromPlan());
                Alert.alert('Notes updated', "The assistant plan has been added to the coach notes. Save changes when you're ready.");
              }}
            >
              <Text style={styles.btnPrimaryText}>Apply To Notes</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Client Detail Modal ──────────────────────────────────────────────────────

type DetailTab = 'overview' | 'training' | 'nutrition' | 'grocery';

function groceryListForProfile(p: ClientProfile | undefined): { cat: string; items: string[] }[] {
  const isLoss = p?.goal?.toLowerCase().includes('fat') || p?.goal?.toLowerCase().includes('loss');
  const protein = p?.dailyProtein ?? 160;
  return [
    {
      cat: '🥩 Protein',
      items: protein >= 180
        ? ['Chicken breast (4 lbs)', 'Ground turkey (2 lbs)', '96% lean beef (1 lb)', 'Eggs (2 dozen)', 'Greek yoghurt (32 oz)', 'Cottage cheese (24 oz)', 'Salmon fillets (4×6 oz)', 'Tuna (4 cans)']
        : ['Chicken breast (3 lbs)', 'Eggs (1 dozen)', 'Greek yoghurt (24 oz)', 'Salmon (2 fillets)', 'Tuna (3 cans)', 'Shrimp (1 lb)'],
    },
    {
      cat: '🥦 Vegetables',
      items: ['Broccoli (2 heads)', 'Spinach (5 oz bag)', 'Bell peppers (4)', 'Zucchini (2)', 'Asparagus (1 bunch)', 'Cherry tomatoes', 'Cucumber (2)', 'Mixed greens (5 oz)'],
    },
    {
      cat: '🍠 Carbs & Grains',
      items: isLoss
        ? ['Brown rice (2 lb bag)', 'Sweet potatoes (3)', 'Oats (42 oz)', 'Quinoa (1 lb)', 'Whole wheat wraps (pack)']
        : ['White rice (5 lb bag)', 'Sweet potatoes (4)', 'Oats (42 oz)', 'Whole grain bread', 'Quinoa (1 lb)', 'Pasta (1 lb)', 'Corn tortillas'],
    },
    {
      cat: '🥑 Healthy Fats',
      items: ['Avocados (4)', 'Olive oil (16 oz)', 'Natural peanut butter (16 oz)', 'Almonds (1 lb bag)', 'Walnuts (8 oz)'],
    },
    {
      cat: '🍎 Fruit',
      items: ['Bananas (bunch)', 'Blueberries (pint)', 'Apples (4)', 'Oranges (4)'],
    },
    {
      cat: '🥛 Dairy / Alternatives',
      items: ['Almond milk (half gallon)', 'Shredded mozzarella (8 oz)', 'Parmesan (4 oz)'],
    },
    {
      cat: '🧴 Pantry',
      items: ['Whey protein powder', 'Creatine monohydrate', 'Sea salt', 'Black pepper', 'Garlic powder', 'Cumin', 'Hot sauce', 'Low sodium soy sauce'],
    },
  ];
}

function ClientDetailModal({
  client,
  coachUserId,
  visible,
  onClose,
  onSave,
}: {
  client: CoachClient | null;
  coachUserId?: string;
  visible: boolean;
  onClose: () => void;
  onSave: (updated: CoachClient) => void;
}) {
  const { accent, accentSoft, accentBorder } = useTheme();
  const insets = useSafeAreaInsets();
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [notes, setNotes] = useState(client?.notes ?? '');
  const [nextSession, setNextSession] = useState(client?.nextSession ?? '');
  const [sessionSchedule, setSessionSchedule] = useState(client?.sessionSchedule ?? []);
  const [recentWorkouts, setRecentWorkouts] = useState<Array<{ workout_type: string; workout_date: string; calories_burned: number; duration_minutes: number }>>([]);
  const [recentMeals, setRecentMeals] = useState<Array<{ meal_name: string; calories: number; protein_grams: number; consumed_at: string }>>([]);

  React.useEffect(() => {
    if (client && visible) {
      setNotes(client.notes ?? '');
      setNextSession(client.nextSession ?? '');
      setSessionSchedule(client.sessionSchedule ?? []);
      setDetailTab('overview');
    }
  }, [client?.id, visible]);

  // Load Supabase data for real clients (non-demo)
  React.useEffect(() => {
    if (!client || client.id.startsWith('client-demo')) return;
    supabase.from('workouts').select('workout_type,workout_date,calories_burned,duration_minutes')
      .eq('user_id', client.id).order('workout_date', { ascending: false }).limit(7)
      .then(({ data }) => setRecentWorkouts((data as any) ?? []), () => null);
    supabase.from('nutrition_entries').select('meal_name,calories,protein_grams,consumed_at')
      .eq('user_id', client.id).order('consumed_at', { ascending: false }).limit(10)
      .then(({ data }) => setRecentMeals((data as any) ?? []), () => null);
  }, [client?.id]);

  if (!client) return null;

  const cp = client.clientProfile;
  const pkg = SESSION_PACKAGES.find((p) => p.id === client.packageId);
  const dur = DURATION_OPTIONS.find((d) => d.id === client.durationId);
  const extrasLeft = client.bonus.extraSessionsTotal - client.bonus.extraSessionsUsed;
  const pct = Math.round((client.completedSessions / Math.max(client.totalSessions, 1)) * 100);
  const sortedSchedule = [...sessionSchedule].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const nextScheduledSlot = sortedSchedule[0];
  const nextScheduledDateTime = nextScheduledSlot ? `${nextScheduledSlot.date}T${nextScheduledSlot.time}:00` : null;
  const nextSessionDisplay = nextScheduledSlot
    ? formatSessionDate(nextScheduledSlot.date, nextScheduledSlot.time)
    : (client.nextSession
      ? formatSessionDate(client.nextSession.split('T')[0], client.nextSession.split('T')[1]?.slice(0, 5) ?? '00:00')
      : null);
  const grocery = groceryListForProfile(cp);
  const latestWorkout = recentWorkouts[0];
  const handleScheduleCheckIn = async () => {
    const remindAt = new Date();
    remindAt.setDate(remindAt.getDate() + 1);
    remindAt.setHours(9, 0, 0, 0);
    const ok = await scheduleCoachCheckInReminder({
      clientName: client.name,
      remindAt,
      context: `Review ${client.name}'s recent workouts, nutrition, and session notes before you check in.`,
    });
    Alert.alert(
      ok ? 'Check-in scheduled' : 'Could not schedule reminder',
      ok
        ? `We'll remind you tomorrow at ${remindAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to check in with ${client.name}.`
        : 'Notification permissions may be off, or the reminder time is no longer valid.',
    );
  };

  const DETAIL_TABS: { key: DetailTab; label: string }[] = [
    { key: 'overview', label: '📹 Live' },
    { key: 'training', label: '🏋️ Training' },
    { key: 'nutrition', label: '🥗 Nutrition' },
    { key: 'grocery', label: '🛒 Grocery' },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={[styles.ldScreen, { paddingTop: insets.top }]}>

          {/* ── Command-center header ── */}
          <View style={styles.ldHeader}>
            <Pressable style={styles.ldBackBtn} onPress={onClose} hitSlop={12}>
              <Text style={styles.ldBackBtnText}>←</Text>
            </Pressable>
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={styles.ldHeaderName} numberOfLines={1}>{client.name}</Text>
              <Text style={styles.ldHeaderEmail} numberOfLines={1}>{client.email}</Text>
            </View>
            <View style={styles.ldProgressBadge}>
              <Text style={styles.ldProgressBadgeLabel}>PROGRESS</Text>
              <Text style={[styles.ldProgressBadgeValue, { color: accent }]}>{pct}%</Text>
            </View>
          </View>

          {/* Tab row */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.detailTabScroll} contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingRight: 16 }}>
            {DETAIL_TABS.map((t) => (
              <Pressable
                key={t.key}
                style={[styles.detailTabBtn, detailTab === t.key && [styles.detailTabBtnActive, { backgroundColor: `${accent}12`, borderColor: accent }]]}
                onPress={() => setDetailTab(t.key)}
              >
                <Text style={[styles.detailTabText, detailTab === t.key && [styles.detailTabTextActive, { color: accent }]]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>

            {/* ── LIVE DASHBOARD TAB ── */}
            {detailTab === 'overview' && (
              <>
                {/* Stat row */}
                <View style={styles.ldStatRow}>
                  <View style={styles.ldStatCell}>
                    <Text style={styles.ldStatValue}>{pct}%</Text>
                    <Text style={styles.ldStatLabel}>DONE</Text>
                  </View>
                  <View style={styles.ldStatCell}>
                    <Text style={styles.ldStatValue}>{client.completedSessions}/{client.totalSessions}</Text>
                    <Text style={styles.ldStatLabel}>SESSIONS</Text>
                  </View>
                  <View style={styles.ldStatCell}>
                    <Text style={styles.ldStatValue} numberOfLines={1}>{pkg?.label ?? '—'}</Text>
                    <Text style={styles.ldStatLabel}>PACKAGE</Text>
                  </View>
                  <View style={styles.ldStatCell}>
                    <Text style={styles.ldStatValue} numberOfLines={1}>{dur?.label ?? '—'}</Text>
                    <Text style={styles.ldStatLabel}>DURATION</Text>
                  </View>
                </View>

                {/* Progress bar */}
                <View style={[styles.progressTrack, { marginBottom: 4 }]}>
                  <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: accent }]} />
                </View>
                <Text style={[styles.progressLabel, { marginBottom: 20 }]}>
                  {client.totalSessions - client.completedSessions} sessions remaining
                  {client.bonus.extraSessionsTotal > 0 ? `  ·  🎁 ${extrasLeft} bonus left` : ''}
                </Text>

                {/* Hero: Next Session + Start Live */}
                <View style={styles.ldHeroCard}>
                  <View style={styles.ldLiveStatusRow}>
                    <View style={styles.ldLiveDot} />
                    <Text style={styles.ldLiveStatusText}>LIVE SESSION</Text>
                    {client.liveCoachingCount ? (
                      <View style={styles.ldSessionCountChip}>
                        <Text style={styles.ldSessionCountText}>{client.liveCoachingCount} sessions done</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.ldHeroSessionTime}>
                    {nextSessionDisplay ?? 'No session scheduled yet'}
                  </Text>
                  <Pressable
                    style={[styles.ldStartLiveBtn, !nextScheduledSlot && { opacity: 0.4 }]}
                    disabled={!nextScheduledSlot}
                    onPress={() => {
                      if (!nextScheduledSlot) return;
                      openZoomSessionForCoach(nextScheduledSlot.startUrl, nextScheduledSlot.joinUrl).catch(() => {
                        Alert.alert('Join link unavailable', 'We could not open the coach live session link on this device.');
                      });
                    }}
                  >
                    <Text style={styles.ldStartLiveBtnText}>📹  Start Live</Text>
                  </Pressable>
                  <Pressable
                    style={styles.ldRemindBtn}
                    onPress={() => {
                      if (!nextScheduledSlot) {
                        Alert.alert('No session scheduled', 'Add a session slot below or ask the client to schedule their next workout.');
                        return;
                      }
                      scheduleCoachSessionReminder({
                        clientName: client.name,
                        date: nextScheduledSlot.date,
                        time: nextScheduledSlot.time,
                        minutesBefore: 30,
                      }).then((ok) => {
                        Alert.alert(
                          ok ? 'Reminder scheduled' : 'Could not schedule reminder',
                          ok
                            ? `We'll remind you 30 minutes before ${client.name}'s session.`
                            : 'Notification permissions may be off, or the reminder time is already in the past.',
                        );
                      }).catch(() => null);
                    }}
                  >
                    <Text style={styles.ldRemindBtnText}>Set 30-min Reminder</Text>
                  </Pressable>
                </View>

                {/* Workout snapshot */}
                {cp ? (
                  <>
                    <Text style={styles.ldSectionHeading}>Workout Snapshot</Text>
                    <View style={styles.clientInfoGrid}>
                      <View style={styles.clientInfoCell}>
                        <Text style={styles.clientInfoLabel}>GOAL</Text>
                        <Text style={styles.clientInfoValue}>{cp.goal}</Text>
                      </View>
                      <View style={styles.clientInfoCell}>
                        <Text style={styles.clientInfoLabel}>ACTIVE PLAN</Text>
                        <Text style={styles.clientInfoValue}>{cp.activePlan ?? '—'}</Text>
                      </View>
                      <View style={styles.clientInfoCell}>
                        <Text style={styles.clientInfoLabel}>EQUIPMENT</Text>
                        <Text style={styles.clientInfoValue}>{cp.equipment ?? '—'}</Text>
                      </View>
                      <View style={styles.clientInfoCell}>
                        <Text style={styles.clientInfoLabel}>LEVEL</Text>
                        <Text style={styles.clientInfoValue}>{cp.experience}</Text>
                      </View>
                    </View>
                    {latestWorkout ? (
                      <View style={[styles.recentRow, { marginBottom: 12 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.recentTitle}>{latestWorkout.workout_type}</Text>
                          <Text style={styles.recentMeta}>
                            Last logged {latestWorkout.workout_date} · {latestWorkout.duration_minutes}m · {latestWorkout.calories_burned} cal
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <Text style={[styles.emptyTabText, { textAlign: 'left', paddingVertical: 8 }]}>No recent workout logged yet.</Text>
                    )}
                    <View style={[styles.coachQuickNavRow, { marginBottom: 20 }]}>
                      <Pressable
                        style={[styles.coachQuickNavBtn, { backgroundColor: accentSoft, borderColor: accentBorder }]}
                        onPress={() => setDetailTab('training')}
                      >
                        <Text style={[styles.coachQuickNavText, { color: accent }]}>🏋️ Training</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.coachQuickNavBtn, { backgroundColor: accentSoft, borderColor: accentBorder }]}
                        onPress={() => setDetailTab('nutrition')}
                      >
                        <Text style={[styles.coachQuickNavText, { color: accent }]}>🥗 Nutrition</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <Text style={styles.emptyTabText}>No training profile yet. Add profile data to the client record.</Text>
                )}

                {/* Schedule controls */}
                <Text style={styles.ldSectionHeading}>Schedule</Text>
                {sessionSchedule.length === 0 ? (
                  <Text style={[styles.emptyTabText, { textAlign: 'left', paddingVertical: 8 }]}>No session slots yet.</Text>
                ) : (
                  sessionSchedule.map((slot, index) => (
                    <View key={`${slot.date}-${slot.time}-${index}`} style={styles.scheduleEditRow}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginBottom: 0 }]}
                        value={slot.date}
                        onChangeText={(value) =>
                          setSessionSchedule((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, date: value } : item))
                        }
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={C.subtle}
                      />
                      <TextInput
                        style={[styles.input, { width: 92, marginBottom: 0 }]}
                        value={slot.time}
                        onChangeText={(value) =>
                          setSessionSchedule((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, time: value } : item))
                        }
                        placeholder="09:00"
                        placeholderTextColor={C.subtle}
                      />
                      <Pressable
                        style={styles.scheduleRemoveBtn}
                        onPress={() => setSessionSchedule((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <Text style={styles.scheduleRemoveText}>Remove</Text>
                      </Pressable>
                    </View>
                  ))
                )}
                <Pressable
                  style={[styles.linkCoachBtn, { backgroundColor: accentSoft, borderColor: accentBorder, marginBottom: 20 }]}
                  onPress={() => setSessionSchedule((prev) => [...prev, { date: new Date().toISOString().slice(0, 10), time: '09:00', type: client.sessionType }])}
                >
                  <Text style={[styles.linkCoachBtnText, { color: accent }]}>+ Add Session Slot</Text>
                </Pressable>

                {/* Coach notes */}
                <Text style={styles.ldSectionHeading}>Coach Notes</Text>
                <TextInput
                  style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Training notes, injuries, goals..."
                  placeholderTextColor={C.subtle}
                  multiline
                />
                <View style={[styles.coachQuickNavRow, { marginBottom: 20 }]}>
                  <Pressable
                    style={[styles.coachQuickNavBtn, { backgroundColor: accentSoft, borderColor: accentBorder }]}
                    onPress={() => setAssistantVisible(true)}
                  >
                    <Text style={[styles.coachQuickNavText, { color: accent }]}>🤖 AI Coach</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.coachQuickNavBtn, { borderColor: C.border, backgroundColor: C.card }]}
                    onPress={() => { handleScheduleCheckIn().catch(() => null); }}
                  >
                    <Text style={[styles.coachQuickNavText, { color: C.text }]}>🔔 Check-in Reminder</Text>
                  </Pressable>
                </View>

                {/* Gifts */}
                {client.bonus.gifts.length > 0 && (
                  <>
                    <Text style={styles.ldSectionHeading}>Gift Tracker</Text>
                    {client.bonus.gifts.map((gift) => (
                      <View key={gift.id} style={styles.giftRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.giftName}>{gift.name}</Text>
                          {gift.trackingNumber ? <Text style={styles.giftTracking}>📦 {gift.trackingNumber}</Text> : null}
                        </View>
                        <View style={[styles.giftStatusBtn, { borderColor: GIFT_STATUS_COLORS[gift.status] }]}>
                          <Text style={[styles.giftStatusText, { color: GIFT_STATUS_COLORS[gift.status] }]}>{GIFT_STATUS_LABELS[gift.status]}</Text>
                        </View>
                      </View>
                    ))}
                    {client.bonus.shippingAddress ? <Text style={styles.shippingAddr}>📍 {client.bonus.shippingAddress}</Text> : null}
                  </>
                )}
                <View style={{ height: 8 }} />
              </>
            )}

            {/* ── TRAINING TAB ── */}
            {detailTab === 'training' && (
              <>
                {cp ? (
                  <>
                    {/* Goal + plan stats */}
                    <View style={styles.clientInfoGrid}>
                      <View style={styles.clientInfoCell}>
                        <Text style={styles.clientInfoLabel}>GOAL</Text>
                        <Text style={styles.clientInfoValue}>{cp.goal}</Text>
                      </View>
                      <View style={styles.clientInfoCell}>
                        <Text style={styles.clientInfoLabel}>LEVEL</Text>
                        <Text style={styles.clientInfoValue}>{cp.experience}</Text>
                      </View>
                      <View style={styles.clientInfoCell}>
                        <Text style={styles.clientInfoLabel}>ACTIVE PLAN</Text>
                        <Text style={styles.clientInfoValue}>{cp.activePlan ?? '—'}</Text>
                      </View>
                      <View style={styles.clientInfoCell}>
                        <Text style={styles.clientInfoLabel}>EQUIPMENT</Text>
                        <Text style={styles.clientInfoValue}>{cp.equipment ?? '—'}</Text>
                      </View>
                    </View>

                    {/* Body stats */}
                    <SectionLabel>Body Stats</SectionLabel>
                    <View style={styles.clientInfoGrid}>
                      {cp.currentWeightLbs !== undefined && (
                        <View style={styles.clientInfoCell}>
                          <Text style={styles.clientInfoLabel}>CURRENT</Text>
                          <Text style={styles.clientInfoValue}>{cp.currentWeightLbs} lbs</Text>
                        </View>
                      )}
                      {cp.goalWeightLbs !== undefined && (
                        <View style={styles.clientInfoCell}>
                          <Text style={styles.clientInfoLabel}>GOAL WEIGHT</Text>
                          <Text style={[styles.clientInfoValue, { color: C.green }]}>{cp.goalWeightLbs} lbs</Text>
                        </View>
                      )}
                      {cp.currentWeightLbs !== undefined && cp.goalWeightLbs !== undefined && (
                        <View style={styles.clientInfoCell}>
                          <Text style={styles.clientInfoLabel}>TO GOAL</Text>
                          <Text style={[styles.clientInfoValue, { color: C.orange }]}>
                            {Math.abs(cp.currentWeightLbs - cp.goalWeightLbs)} lbs
                          </Text>
                        </View>
                      )}
                      {cp.age !== undefined && (
                        <View style={styles.clientInfoCell}>
                          <Text style={styles.clientInfoLabel}>AGE</Text>
                          <Text style={styles.clientInfoValue}>{cp.age}</Text>
                        </View>
                      )}
                    </View>

                    {/* Health flags */}
                    {(cp.healthConditions || cp.medications) && (
                      <>
                        <SectionLabel>⚠️ Health Flags</SectionLabel>
                        {cp.healthConditions && cp.healthConditions !== 'None' && (
                          <View style={styles.healthFlagCard}>
                            <Text style={styles.healthFlagLabel}>CONDITIONS</Text>
                            <Text style={styles.healthFlagText}>{cp.healthConditions}</Text>
                          </View>
                        )}
                        {cp.medications && cp.medications !== 'None' && (
                          <View style={styles.healthFlagCard}>
                            <Text style={styles.healthFlagLabel}>MEDICATIONS</Text>
                            <Text style={styles.healthFlagText}>{cp.medications}</Text>
                          </View>
                        )}
                      </>
                    )}

                    {/* Recent workouts from Supabase (real clients) */}
                    {recentWorkouts.length > 0 && (
                      <>
                        <SectionLabel>Recent Workouts</SectionLabel>
                        {recentWorkouts.map((w, i) => (
                          <View key={i} style={styles.recentRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.recentTitle}>{w.workout_type}</Text>
                              <Text style={styles.recentMeta}>{w.workout_date} · {w.duration_minutes}m · {w.calories_burned} cal</Text>
                            </View>
                          </View>
                        ))}
                      </>
                    )}
                    {recentWorkouts.length === 0 && !client.id.startsWith('client-demo') && (
                      <Text style={styles.emptyTabText}>No workouts logged yet in APEX.</Text>
                    )}
                    {client.id.startsWith('client-demo') && (
                      <View style={styles.demoNote}>
                        <Text style={styles.demoNoteText}>📊 Live workout data syncs when the client links their APEX account.</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={styles.emptyTabText}>No training profile yet. Add profile data to the client record.</Text>
                )}
                <View style={{ height: 20 }} />
              </>
            )}

            {/* ── NUTRITION TAB ── */}
            {detailTab === 'nutrition' && (
              <>
                {cp ? (
                  <>
                    {/* Daily targets */}
                    <SectionLabel>Daily Targets</SectionLabel>
                    <View style={styles.macroGrid}>
                      <View style={styles.macroCell}>
                        <Text style={styles.macroValue}>{cp.dailyCalories ?? '—'}</Text>
                        <Text style={styles.macroLabel}>CALORIES</Text>
                      </View>
                      <View style={[styles.macroCell, { borderColor: C.green }]}>
                        <Text style={[styles.macroValue, { color: C.green }]}>{cp.dailyProtein ?? '—'}g</Text>
                        <Text style={styles.macroLabel}>PROTEIN</Text>
                      </View>
                      {cp.dailyCalories && cp.dailyProtein ? (
                        <>
                          <View style={styles.macroCell}>
                            <Text style={styles.macroValue}>{Math.round((cp.dailyCalories - cp.dailyProtein * 4) * 0.45 / 4)}g</Text>
                            <Text style={styles.macroLabel}>CARBS</Text>
                          </View>
                          <View style={styles.macroCell}>
                            <Text style={styles.macroValue}>{Math.round((cp.dailyCalories - cp.dailyProtein * 4) * 0.35 / 9)}g</Text>
                            <Text style={styles.macroLabel}>FAT</Text>
                          </View>
                        </>
                      ) : null}
                    </View>

                    {/* Meal plan overview */}
                    <SectionLabel>Suggested Meal Structure</SectionLabel>
                    {[
                      { meal: 'Meal 1 — Morning', desc: `${Math.round((cp.dailyProtein ?? 160) * 0.28)}g protein · complex carbs + fruit` },
                      { meal: 'Meal 2 — Mid-Morning', desc: `${Math.round((cp.dailyProtein ?? 160) * 0.18)}g protein · light snack` },
                      { meal: 'Meal 3 — Lunch', desc: `${Math.round((cp.dailyProtein ?? 160) * 0.28)}g protein · veggies + rice/potato` },
                      { meal: 'Meal 4 — Pre-Workout', desc: `${Math.round((cp.dailyProtein ?? 160) * 0.12)}g protein · fast carbs` },
                      { meal: 'Meal 5 — Post-Workout / Dinner', desc: `${Math.round((cp.dailyProtein ?? 160) * 0.24)}g protein · greens + lean protein` },
                    ].map((m) => (
                      <View key={m.meal} style={styles.mealPlanRow}>
                        <Text style={styles.mealPlanTitle}>{m.meal}</Text>
                        <Text style={styles.mealPlanDesc}>{m.desc}</Text>
                      </View>
                    ))}

                    {/* Recent logged meals (real clients) */}
                    {recentMeals.length > 0 && (
                      <>
                        <SectionLabel>Recently Logged</SectionLabel>
                        {recentMeals.map((m, i) => (
                          <View key={i} style={styles.recentRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.recentTitle}>{m.meal_name}</Text>
                              <Text style={styles.recentMeta}>{m.calories} cal · {m.protein_grams}g protein</Text>
                            </View>
                          </View>
                        ))}
                      </>
                    )}
                    {client.id.startsWith('client-demo') && (
                      <View style={styles.demoNote}>
                        <Text style={styles.demoNoteText}>📊 Real meal logs sync when the client links their APEX account.</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={styles.emptyTabText}>No nutrition profile yet.</Text>
                )}
                <View style={{ height: 20 }} />
              </>
            )}

            {/* ── GROCERY TAB ── */}
            {detailTab === 'grocery' && (
              <>
                <View style={styles.groceryHeader}>
                  <Text style={styles.groceryHeaderTitle}>Weekly Grocery List</Text>
                  <Text style={styles.groceryHeaderSub}>
                    {cp ? `Based on ${cp.dailyCalories ?? '~2000'} cal · ${cp.dailyProtein ?? '~160'}g protein target` : 'Standard macro split'}
                  </Text>
                </View>
                {grocery.map((section) => (
                  <View key={section.cat} style={styles.grocerySection}>
                    <Text style={styles.groceryCat}>{section.cat}</Text>
                    {section.items.map((item) => (
                      <View key={item} style={styles.groceryItemRow}>
                        <View style={styles.groceryBullet} />
                        <Text style={styles.groceryItem}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ))}
                <View style={{ height: 20 }} />
              </>
            )}

          </ScrollView>

          {/* Footer — Save visible on Live tab, plain close on other tabs */}
          <View style={[styles.ldFooter, { paddingBottom: insets.bottom + 8 }]}>
            {detailTab === 'overview' ? (
              <Pressable
                style={styles.ldSaveBtn}
                onPress={() => {
                  const fallbackNextSession = sortedSchedule[0]
                    ? `${sortedSchedule[0].date}T${sortedSchedule[0].time}:00`
                    : undefined;
                  onSave({
                    ...client,
                    notes,
                    nextSession: nextSession || fallbackNextSession,
                    sessionSchedule: sortedSchedule,
                  });
                  onClose();
                }}
              >
                <Text style={styles.ldSaveBtnText}>Save Changes</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.ldSaveBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }]} onPress={onClose}>
                <Text style={[styles.ldSaveBtnText, { color: C.text }]}>Close</Text>
              </Pressable>
            )}
          </View>

        </View>
      </KeyboardAvoidingView>
      <AssistantCoachModal
        visible={assistantVisible}
        client={client}
        coachUserId={coachUserId}
        notes={notes}
        sessionSchedule={sessionSchedule}
        recentWorkouts={recentWorkouts}
        recentMeals={recentMeals}
        onClose={() => setAssistantVisible(false)}
        onApplyNotes={setNotes}
        onApplySchedule={setSessionSchedule}
      />
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type CoachTab = 'clients' | 'inbox' | 'calendar' | 'gifts' | 'studio' | 'settings';

type DemoReferenceCandidate = {
  id: string;
  prompt: string;
  imageBase64?: string;
  mimeType?: string;
};

function mapStudioAssetRow(assetRow: any): DemoAsset | null {
  if (!assetRow) return null;
  return {
    id: assetRow.id,
    coachLabel: assetRow.coach_label,
    exerciseName: assetRow.exercise_name,
    assetKind: assetRow.asset_kind,
    status: assetRow.status,
    prompt: assetRow.prompt ?? null,
    imageUrl: assetRow.image_url ?? null,
    videoUrl: assetRow.video_url ?? null,
    requestId: assetRow.request_id ?? null,
    metadata: assetRow.metadata ?? {},
    createdAt: assetRow.created_at,
    updatedAt: assetRow.updated_at,
  };
}

export default function CoachModeScreen() {
  const { session } = useAuth();
  const { accent, accentSoft, accentBorder } = useTheme();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const coachOptions = getCoachVoiceOptions();
  const [tab, setTab] = useState<CoachTab>('clients');
  const [clients, setClients] = useState<CoachClient[]>([]);
  const [inboxThreads, setInboxThreads] = useState<CoachInboxThread[]>([]);
  const [invites, setInvites] = useState<CoachInvite[]>([]);
  const [selectedClient, setSelectedClient] = useState<CoachClient | null>(null);
  const [selectedRoster, setSelectedRoster] = useState<GroupRoster | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [rosterVisible, setRosterVisible] = useState(false);
  const [msgClient, setMsgClient] = useState<CoachClient | null>(null);
  const [msgVisible, setMsgVisible] = useState(false);
  const [studioCoach, setStudioCoach] = useState<'Marcus' | 'Serena'>('Marcus');
  const [studioExercise, setStudioExercise] = useState('Bench Press');
  const [studioLoading, setStudioLoading] = useState(false);
  const [studioRenderLoading, setStudioRenderLoading] = useState(false);
  const [studioEquipment, setStudioEquipment] = useState('Barbell');
  const [studioPosition, setStudioPosition] = useState('');
  const [directGenLoading, setDirectGenLoading] = useState(false);
  const [directGenStatus, setDirectGenStatus] = useState<string | null>(null);
  const [directGenVideoUrl, setDirectGenVideoUrl] = useState<string | null>(null);
  const [directGenAssetId, setDirectGenAssetId] = useState<string | null>(null);
  const [directGenAssetStatus, setDirectGenAssetStatus] = useState<DemoAsset['status'] | null>(null);
  const [directGenPrompt, setDirectGenPrompt] = useState('');
  // Reference image stage
  const [directRefImageUrl, setDirectRefImageUrl] = useState<string | null>(null);
  const [directRefAssetId, setDirectRefAssetId] = useState<string | null>(null);
  const [directRefApproved, setDirectRefApproved] = useState(false);
  const directPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [studioCandidates, setStudioCandidates] = useState<DemoReferenceCandidate[]>([]);
  const [studioWarning, setStudioWarning] = useState<string | null>(null);
  const [approvedReferences, setApprovedReferences] = useState<DemoAsset[]>([]);
  const [pendingVideos, setPendingVideos] = useState<DemoAsset[]>([]);
  const [approvedVideos, setApprovedVideos] = useState<DemoAsset[]>([]);
  const [missingDemoExercises, setMissingDemoExercises] = useState<string[]>([]);
  const [wwMode, setWwMode] = useState(false);
  const [formReviewClips, setFormReviewClips] = useState<FormReviewClip[]>([]);
  const [selectedFormReviewClip, setSelectedFormReviewClip] = useState<FormReviewClip | null>(null);
  const [shakeOrders, setShakeOrders] = useState<ShakeOrder[]>([]);

  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        // ── Admin guard ────────────────────────────────────────────────────────
        const adminOk = await isAdminEnabled();
        if (!adminOk) {
          navigation.goBack();
          return;
        }
        isWalkWaterModeEnabled().then(setWwMode).catch(() => null);
        const [loadedClients, loadedInvites, localDemoClients, fitCalls, wwParticipants] = await Promise.all([
          loadCoachClients().catch(() => []),
          getCoachInvites().catch(() => []),
          getLocalCoachDemoClients(),
          loadFitCallClients().catch(() => ({ clients: [], rows: [] })),
          loadWWParticipants().catch(() => []),
        ]);
        const mergedClients = mergeCoachClients(loadedClients, localDemoClients);
        // Merge WW DM bookers then WW participants — coach_client_links take precedence
        const allClients = mergeCoachClients(
          mergeCoachClients(mergedClients, fitCalls.clients),
          wwParticipants.map((p) => p.client),
        );
        setClients(allClients);
        setInvites(loadedInvites);
        if (session?.user?.id) {
          const clips = await getCoachFormReviewClips(session.user.id).catch(() => []);
          setFormReviewClips(clips);
        }
        const orders = await getCoachShakeOrders().catch(() => []);
        setShakeOrders(orders);

        const { data } = await supabase
          .from('coach_messages')
          .select('id, user_id, sender_role, content, sent_at')
          .eq('coach_id', session?.user?.id ?? '')
          .order('sent_at', { ascending: false })
          .limit(250);

        const grouped = new Map<string, CoachInboxThread>();
        (data ?? []).forEach((row: any) => {
          const client = allClients.find((item) => item.id === row.user_id);
          if (!client) return;
          const existing = grouped.get(row.user_id);
          if (!existing) {
            grouped.set(row.user_id, {
              client,
              latestMessage: row.content,
              latestSentAt: row.sent_at,
              latestSenderRole: row.sender_role,
              messageCount: 1,
            });
            return;
          }
          existing.messageCount += 1;
        });
        // Surface WW DM bookers who have no messages yet
        for (const row of fitCalls.rows) {
          const threadKey = row.user_id ?? row.id;
          if (!grouped.has(threadKey)) {
            const client = allClients.find((c) => c.id === threadKey);
            if (client) {
              grouped.set(threadKey, {
                client,
                latestMessage: `📅 Booked ${row.session_date} at ${row.session_time} · ${row.challenge}`,
                latestSentAt: row.created_at,
                latestSenderRole: 'client',
                messageCount: 0,
              });
            }
          }
        }
        // Surface all WW challenge participants who have no thread yet
        for (const { client, lastActiveAt } of wwParticipants) {
          if (!grouped.has(client.id)) {
            grouped.set(client.id, {
              client,
              latestMessage: client.notes ?? '👟 WW Challenge Participant',
              latestSentAt: lastActiveAt,
              latestSenderRole: 'client',
              messageCount: 0,
            });
          }
        }
        setInboxThreads(
          Array.from(grouped.values()).sort((a, b) => b.latestSentAt.localeCompare(a.latestSentAt)),
        );
      };
      load().catch(() => null);
    }, [navigation, session?.user?.id]),
  );

  useEffect(() => {
    if (!session?.user?.id) return;

    const channel = supabase
      .channel(`coach-client-links-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'form_review_clips',
          filter: `coach_user_id=eq.${session.user.id}`,
        },
        async () => {
          const clips = await getCoachFormReviewClips(session.user.id).catch(() => formReviewClips);
          setFormReviewClips(clips);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shake_orders',
        },
        async () => {
          const orders = await getCoachShakeOrders().catch(() => shakeOrders);
          setShakeOrders(orders);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'coach_client_links',
          filter: `coach_user_id=eq.${session.user.id}`,
        },
        async (payload) => {
          const row = payload.new as { client_user_id?: string; status?: string; package_id?: string | null } | null;
          if (!row?.client_user_id) return;
          if (row.status !== 'active') return;

          const [remoteClients, localDemoClients] = await Promise.all([
            loadCoachClients().catch(() => []),
            getLocalCoachDemoClients(),
          ]);
          const mergedClients = mergeCoachClients(remoteClients, localDemoClients);
          const client = mergedClients.find((item) => item.id === row.client_user_id);
          const clientName = client?.name ?? 'A new client';
          const packageLabel = SESSION_PACKAGES.find((pkg) => pkg.id === row.package_id)?.label ?? 'live coaching';

          await sendCoachBusinessNotification(
            'New live coaching client',
            `${clientName} just booked ${packageLabel}. Reach out and lock in their first session.`,
          ).catch(() => null);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'coach_messages',
          filter: `coach_id=eq.${session.user.id}`,
        },
        async () => {
          const [loadedClients, localDemoClients, dataResult, fitCalls, wwParticipants] = await Promise.all([
            loadCoachClients().catch(() => clients),
            getLocalCoachDemoClients(),
            supabase
              .from('coach_messages')
              .select('id, user_id, sender_role, content, sent_at')
              .eq('coach_id', session.user.id)
              .order('sent_at', { ascending: false })
              .limit(250),
            loadFitCallClients().catch(() => ({ clients: [], rows: [] })),
            loadWWParticipants().catch(() => []),
          ]);
          const mergedClients = mergeCoachClients(loadedClients, localDemoClients);
          const allClients = mergeCoachClients(
            mergeCoachClients(mergedClients, fitCalls.clients),
            wwParticipants.map((p) => p.client),
          );
          setClients(allClients);
          const grouped = new Map<string, CoachInboxThread>();
          (dataResult.data ?? []).forEach((row: any) => {
            const client = allClients.find((item) => item.id === row.user_id);
            if (!client) return;
            const existing = grouped.get(row.user_id);
            if (!existing) {
              grouped.set(row.user_id, {
                client,
                latestMessage: row.content,
                latestSentAt: row.sent_at,
                latestSenderRole: row.sender_role,
                messageCount: 1,
              });
              return;
            }
            existing.messageCount += 1;
          });
          for (const row of fitCalls.rows) {
            const threadKey = row.user_id ?? row.id;
            if (!grouped.has(threadKey)) {
              const client = allClients.find((c) => c.id === threadKey);
              if (client) {
                grouped.set(threadKey, {
                  client,
                  latestMessage: `📅 Booked ${row.session_date} at ${row.session_time} · ${row.challenge}`,
                  latestSentAt: row.created_at,
                  latestSenderRole: 'client',
                  messageCount: 0,
                });
              }
            }
          }
          for (const { client, lastActiveAt } of wwParticipants) {
            if (!grouped.has(client.id)) {
              grouped.set(client.id, {
                client,
                latestMessage: client.notes ?? '👟 WW Challenge Participant',
                latestSentAt: lastActiveAt,
                latestSenderRole: 'client',
                messageCount: 0,
              });
            }
          }
          setInboxThreads(Array.from(grouped.values()).sort((a, b) => b.latestSentAt.localeCompare(a.latestSentAt)));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(() => null);
    };
  }, [session?.user?.id]);

  const handleSaveClient = async (updated: CoachClient) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = clients.map((c) => (c.id === updated.id ? updated : c));
    setClients(next);
    await updateCoachClientLink(updated.id, {
      nextSession: updated.nextSession ?? null,
      notes: updated.notes ?? null,
      bonus: updated.bonus,
      status: updated.totalSessions > 0 ? 'active' : 'linked',
      sessionSchedule: updated.sessionSchedule ?? [],
      recurrencePreference: updated.recurrencePreference ?? null,
    }).catch(() => null);
  };

  const handleUpdateGift = async (clientId: string, giftId: string, status: GiftStatus) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = clients.map((c) => {
      if (c.id !== clientId) return c;
      return {
        ...c,
        bonus: {
          ...c.bonus,
          gifts: c.bonus.gifts.map((g) => (g.id === giftId ? { ...g, status } : g)),
        },
      };
    });
    setClients(next);
    const updatedClient = next.find((c) => c.id === clientId);
    if (updatedClient) {
      await updateCoachClientLink(clientId, {
        bonus: updatedClient.bonus,
        status: updatedClient.totalSessions > 0 ? 'active' : 'linked',
      }).catch(() => null);
    }
  };

  const handleUpdateShakeOrder = async (
    orderId: string,
    fulfillmentStatus: ShakeOrderFulfillmentStatus,
  ) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = await updateShakeOrderFulfillmentStatus(orderId, fulfillmentStatus).catch(() => null);
    if (!updated) return;
    setShakeOrders((prev) => prev.map((order) => (order.id === orderId ? updated : order)));
  };

  const handleMarkAttendance = async (
    client: CoachClient,
    status: SessionAttendanceRecord['status'],
    rosterDate?: string,
    rosterTime?: string,
  ) => {
    const date = rosterDate ?? selectedRoster?.date;
    const time = rosterTime ?? selectedRoster?.time;
    if (!date || !time) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const existing = client.sessionAttendance ?? [];
    const withoutCurrent = existing.filter((item) => !(item.date === date && item.time === time));
    const nextAttendance: SessionAttendanceRecord[] = [
      ...withoutCurrent,
      { date, time, status, markedAt: new Date().toISOString() },
    ];
    const wasAlreadyPresent = existing.some((item) => item.date === date && item.time === time && item.status === 'present');
    const nextCompletedSessions =
      status === 'present' && !wasAlreadyPresent
        ? Math.min(client.totalSessions, client.completedSessions + 1)
        : status === 'absent' && wasAlreadyPresent
          ? Math.max(0, client.completedSessions - 1)
          : client.completedSessions;

    const updated: CoachClient = {
      ...client,
      completedSessions: nextCompletedSessions,
      sessionAttendance: nextAttendance,
    };

    setClients((prev) => prev.map((item) => (item.id === client.id ? updated : item)));
    await updateCoachClientLink(client.id, {
      sessionAttendance: nextAttendance,
      completedSessions: nextCompletedSessions,
      status: updated.totalSessions > 0 ? 'active' : 'linked',
    }).catch(() => null);
  };

  const handleCreateInvite = async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const invite = await createCoachInvite();
      setInvites((prev) => [invite, ...prev]);
      await Share.share({
        message: `Join my APEX coaching roster with invite code ${invite.code}. Open APEX → Live Coach → Redeem Invite Code.`,
      }).catch(() => null);
      Alert.alert('Invite Ready', `Code: ${invite.code}\n\nShare this code with your client. It expires on ${new Date(invite.expiresAt).toLocaleString()}.`);
    } catch (error: any) {
      Alert.alert('Could not create invite', error?.message ?? 'Please try again.');
    }
  };

  const handleCreateDemoClient = useCallback(async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const sessionStart = new Date(Date.now() + 30 * 60 * 1000);
      sessionStart.setSeconds(0, 0);
      const sessionDate = sessionStart.toISOString().slice(0, 10);
      const sessionTime = `${String(sessionStart.getHours()).padStart(2, '0')}:${String(sessionStart.getMinutes()).padStart(2, '0')}`;

      const { data } = await supabase.functions.invoke('zoom-session', {
        body: {
          agenda: 'Coach Mode demo live coaching session',
          durationMinutes: 60,
          hostUserId: env.zoomHostUserId || 'joshua.saunders575@icloud.com',
          startTime: new Date(`${sessionDate}T${sessionTime}:00`).toISOString(),
          topic: `Coach Demo · ${sessionDate} ${sessionTime}`,
        },
      });

      const meeting = data as {
        join_url?: string | null;
        meeting_id?: string | null;
        meeting_uuid?: string | null;
        start_url?: string | null;
      } | null;

      const nextSessionIso = `${sessionDate}T${sessionTime}:00`;
      const demoClient: CoachClient = {
        id: `client-demo-live-${Date.now()}`,
        name: 'Demo Live Client',
        email: 'demo-live@apex.app',
        packageId: '1x',
        durationId: '3month',
        startDate: new Date().toISOString().slice(0, 10),
        nextSession: nextSessionIso,
        sessionType: '1on1',
        totalSessions: 12,
        completedSessions: 0,
        notes: 'Demo client for testing the coach live session workflow.',
        recurrencePreference: 'change_next_week',
        liveCoachingCount: 0,
        bonus: {
          extraSessionsTotal: 3,
          extraSessionsUsed: 0,
          extraSessionType: '1on1',
          gifts: [
            { id: 'gift-demo-1', name: 'Foam Roller or Massage Gun', status: 'pending' },
            { id: 'gift-demo-2', name: 'Water Bottle', status: 'pending' },
            { id: 'gift-demo-3', name: 'Hat', status: 'pending' },
          ],
        },
        sessionSchedule: [
          {
            date: sessionDate,
            time: sessionTime,
            type: '1on1',
            joinUrl: meeting?.join_url?.trim() || undefined,
            startUrl: meeting?.start_url?.trim() || undefined,
            zoomMeetingId: meeting?.meeting_id?.trim() || undefined,
            zoomMeetingUuid: meeting?.meeting_uuid?.trim() || undefined,
          },
        ],
        sessionAttendance: [],
        clientProfile: {
          goal: 'Build Muscle',
          experience: 'Intermediate',
          currentWeightLbs: 178,
          goalWeightLbs: 190,
          dailyCalories: 2850,
          dailyProtein: 190,
          activePlan: 'Metabolic Reset Program',
          equipment: 'Full Gym',
          age: 31,
        },
      };

      const existingDemoClients = await getLocalCoachDemoClients();
      const nextDemoClients = mergeCoachClients([demoClient], existingDemoClients);
      await saveLocalCoachDemoClients(nextDemoClients);
      setClients((prev) => mergeCoachClients(prev, [demoClient]));

      Alert.alert(
        'Demo client created',
        `Demo Live Client is ready with a live session at ${formatSessionDate(sessionDate, sessionTime)}.`,
      );
    } catch (error: any) {
      Alert.alert('Could not create demo client', error?.message ?? 'Please try again.');
    }
  }, []);

  const loadStudioAssets = useCallback(async (coachLabel: string, exerciseName: string) => {
    const [references, videos] = await Promise.all([
      getDemoAssetsForExercise(coachLabel, exerciseName, 'reference').catch(() => []),
      getDemoAssetsForExercise(coachLabel, exerciseName, 'video').catch(() => []),
    ]);
    setApprovedReferences(references.filter((asset) => asset.status === 'approved'));
    setPendingVideos(videos.filter((asset) => asset.status === 'candidate' && Boolean(asset.videoUrl)));
    setApprovedVideos(videos.filter((asset) => asset.status === 'approved'));
  }, []);

  useEffect(() => {
    loadStudioAssets(studioCoach, studioExercise).catch(() => null);
  }, [loadStudioAssets, studioCoach, studioExercise]);

  const loadMissingDemoExercises = useCallback(async (coachLabel: 'Marcus' | 'Serena') => {
    const programExercises = getDemoVideoExercises();

    const coachVideos = await getCoachDemoAssets(coachLabel, 'video').catch(() => []);
    const approvedVideoNames = new Set(
      coachVideos
        .filter((asset) => asset.status === 'approved' && asset.videoUrl)
        .map((asset) => normalizeDemoExerciseName(asset.exerciseName)),
    );

    const nextMissing = programExercises.filter(
      (exerciseName) => !approvedVideoNames.has(normalizeDemoExerciseName(exerciseName)),
    );

    setMissingDemoExercises(nextMissing);
    if (nextMissing.length > 0 && approvedVideoNames.has(normalizeDemoExerciseName(studioExercise))) {
      setStudioExercise(nextMissing[0]);
    }
    if (!studioExercise.trim() && nextMissing.length > 0) {
      setStudioExercise(nextMissing[0]);
    }
  }, [session?.user?.id, studioExercise]);

  useEffect(() => {
    loadMissingDemoExercises(studioCoach).catch(() => null);
  }, [loadMissingDemoExercises, studioCoach]);

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const handleGenerateStudioCandidates = async () => {
    if (!studioExercise.trim()) {
      Alert.alert('Add an exercise', 'Type the exercise you want to build demo references for first.');
      return;
    }

    setStudioLoading(true);
    setStudioWarning(null);
    try {
      let sourceImageBase64: string | undefined;
      const builtInSource = BUILT_IN_STUDIO_REFERENCES[studioCoach];
      if (builtInSource) {
        sourceImageBase64 = await loadBundledReferenceBase64(builtInSource);
      }

      const { data, error } = await supabase.functions.invoke('demo-reference-studio', {
        body: {
          action: 'generate_candidates',
          coachLabel: studioCoach,
          exerciseName: studioExercise.trim(),
          sourceImageBase64,
        },
      });

      if (error) throw error;
      const payload = (data as { candidates?: DemoReferenceCandidate[]; warning?: string }) ?? {};
      const nextCandidates = payload.candidates ?? [];
      setStudioCandidates(nextCandidates);
      setStudioWarning(payload.warning ?? null);

      if (nextCandidates.length === 0) {
        Alert.alert(
          'Reference prompts ready',
          payload.warning ?? 'Image generation is not fully connected yet, so we returned polished prompts instead. Once the image provider is available, this screen will generate actual coach image candidates.',
        );
      }
    } catch (error: any) {
      Alert.alert('Could not build references', error?.message ?? 'Please try again in a moment.');
    } finally {
      setStudioLoading(false);
    }
  };

  const handleApproveStudioCandidate = async (candidate: DemoReferenceCandidate) => {
    if (!candidate.imageBase64) {
      Alert.alert('No image returned', 'This candidate only has a prompt right now. Add OPENAI_API_KEY to the edge function secrets to generate real stills.');
      return;
    }

    setStudioLoading(true);
    try {
      const approvedAsset = await saveReferenceCandidate(candidate.imageBase64, candidate.prompt, {
        source: 'coach-studio',
        approvedAt: new Date().toISOString(),
        referenceVariant: 'base',
      });
      if (!approvedAsset) throw new Error('Could not save the approved reference.');
      await buildWideReferenceAndRender(approvedAsset);
    } catch (error: any) {
      Alert.alert('Could not save reference', error?.message ?? 'Please try again.');
    } finally {
      setStudioLoading(false);
    }
  };

  const saveReferenceCandidate = useCallback(async (
    imageBase64: string,
    prompt: string,
    metadata: Record<string, unknown>,
  ) => {
    const { data, error } = await supabase.functions.invoke('demo-reference-studio', {
      body: {
        action: 'approve_candidate',
        coachLabel: studioCoach,
        exerciseName: studioExercise.trim(),
        imageBase64,
        prompt,
        metadata,
      },
    });
    if (error) throw error;
    await loadStudioAssets(studioCoach, studioExercise.trim());
    return mapStudioAssetRow((data as { asset?: any })?.asset);
  }, [loadStudioAssets, studioCoach, studioExercise]);

  const buildWideReference = useCallback(async (referenceAsset: DemoAsset) => {
    if (!referenceAsset.imageUrl) return referenceAsset;
    if (referenceAsset.metadata?.referenceVariant === 'wide') {
      return referenceAsset;
    }

    const { data, error } = await supabase.functions.invoke('demo-reference-studio', {
      body: {
        action: 'generate_wide_reference',
        coachLabel: studioCoach,
        exerciseName: studioExercise.trim(),
        sourceImageUrl: referenceAsset.imageUrl,
      },
    });

    if (error) throw error;
    const payload = (data as { candidate?: DemoReferenceCandidate | null; warning?: string }) ?? {};
    if (!payload.candidate?.imageBase64) {
      if (payload.warning) {
        setStudioWarning(payload.warning);
      }
      return referenceAsset;
    }

    const wideReference = await saveReferenceCandidate(
      payload.candidate.imageBase64,
      payload.candidate.prompt,
      {
        source: 'coach-studio-wide-reference',
        approvedAt: new Date().toISOString(),
        referenceVariant: 'wide',
        sourceReferenceId: referenceAsset.id,
      },
    );
    return wideReference ?? referenceAsset;
  }, [saveReferenceCandidate, studioCoach, studioExercise]);

  const handleRenderStudioVideo = async (referenceAsset: DemoAsset) => {
    if (!referenceAsset.imageUrl || !studioExercise.trim()) {
      Alert.alert('Missing reference', 'Save a reference image for this exercise before rendering a video.');
      return;
    }

    setStudioRenderLoading(true);
    setStudioWarning(null);
    try {
      const invokeRender = async (videoRequestId?: string | null) => {
        const response = await supabase.functions.invoke('workout-demo', {
          body: {
            coachPersona: studioCoach,
            exerciseName: studioExercise.trim(),
            exerciseSets: '4 x 8 @ 80%',
            planTitle: 'Coach Demo Studio',
            referenceImageUrl: referenceAsset.imageUrl,
            videoRequestId: videoRequestId ?? null,
          },
        });
        return response;
      };

      let { data, error } = await invokeRender();
      if (error) throw error;

      let payload = (data as {
        video_request_id?: string | null;
        video_status?: 'ready' | 'queued' | 'not_configured' | 'failed';
        video_url?: string | null;
      }) ?? {};

      let attempts = 0;
      while (payload.video_status === 'queued' && !payload.video_url && attempts < 18) {
        attempts += 1;
        await wait(8000);
        const next = await invokeRender(payload.video_request_id ?? null);
        if (next.error) throw next.error;
        payload = (next.data as typeof payload) ?? payload;
      }

      if (payload.video_url) {
        await supabase.functions.invoke('demo-reference-studio', {
          body: {
            action: 'save_video',
            coachLabel: studioCoach,
            exerciseName: studioExercise.trim(),
            videoUrl: payload.video_url,
            status: 'candidate',
            prompt: `Approved ${studioCoach} ${studioExercise.trim()} demo video`,
            metadata: {
              source: 'coach-studio',
              referenceImageUrl: referenceAsset.imageUrl,
              requestId: payload.video_request_id ?? null,
            },
          },
        });
        await loadStudioAssets(studioCoach, studioExercise.trim());
        await loadMissingDemoExercises(studioCoach);
        Alert.alert('Video ready for review', 'Your demo video was rendered and saved in Demo Studio. Approve it there and it will be used across Train.');
        return;
      }

      if (payload.video_status === 'queued') {
        Alert.alert('Render still running', 'The video job is still rendering. Open Train → AI Demo in a bit, or render again here to keep polling.');
        return;
      }

      Alert.alert('Render unavailable', 'The video render did not complete. Try again in a moment.');
    } catch (error: any) {
      Alert.alert('Could not render video', error?.message ?? 'Please try again.');
    } finally {
      setStudioRenderLoading(false);
    }
  };

  const buildWideReferenceAndRender = useCallback(async (referenceAsset: DemoAsset) => {
    const renderReference = await buildWideReference(referenceAsset);
    await handleRenderStudioVideo(renderReference);
  }, [buildWideReference]);

  const EQUIPMENT_OPTIONS = ['Barbell', 'Dumbbells', 'Kettlebell', 'Cable', 'Machine', 'Bodyweight'];

  useEffect(() => {
    const gender = studioCoach === 'Serena' ? 'female' : 'male';
    setDirectGenPrompt(buildDemoPrompt(studioExercise.trim() || '[Exercise]', studioEquipment, gender));
  }, [studioExercise, studioEquipment, studioCoach]);

  const runPollLoop = (falRequest: import('@/lib/falVideoGen').VideoGenRequest, onResult: (result: import('@/lib/falVideoGen').VideoGenResult) => void) => {
    directPollTimer.current = setInterval(async () => {
      try {
        const result = await pollJobStatus(falRequest);
        if (result.status === 'queued') { setDirectGenStatus('Queued...'); return; }
        if (result.status === 'in_progress') { setDirectGenStatus('Generating...'); return; }
        clearInterval(directPollTimer.current!); directPollTimer.current = null;
        setDirectGenLoading(false);
        onResult(result);
      } catch (e: any) {
        clearInterval(directPollTimer.current!); directPollTimer.current = null;
        setDirectGenLoading(false); Alert.alert('Polling error', e?.message ?? 'Unknown error');
      }
    }, 4000);
  };

  // Step 1: generate reference image from base photo + prompt
  const handleGenerateReferenceImage = async () => {
    if (!studioExercise.trim()) { Alert.alert('Missing info', 'Enter an exercise name.'); return; }
    if (!env.falApiKey) { Alert.alert('fal.ai key missing', 'Set EXPO_PUBLIC_FAL_KEY in .env and restart.'); return; }
    const baseUrl = studioCoach === 'Marcus' ? env.demoRefMarcusUrl : env.demoRefSerenaUrl;
    if (!baseUrl) { Alert.alert('Reference URL missing', `Set EXPO_PUBLIC_DEMO_REF_${studioCoach.toUpperCase()}_URL in .env and restart.`); return; }

    if (directPollTimer.current) { clearInterval(directPollTimer.current); directPollTimer.current = null; }
    setDirectGenLoading(true);
    setDirectGenStatus('Submitting...');
    setDirectRefImageUrl(null);
    setDirectRefAssetId(null);
    setDirectRefApproved(false);
    setDirectGenVideoUrl(null);
    setDirectGenAssetId(null);
    setDirectGenAssetStatus(null);

    const prompt = directGenPrompt.trim() || buildDemoPrompt(studioExercise.trim(), studioEquipment, studioCoach === 'Serena' ? 'female' : 'male');
    try {
      const falRequest = await submitReferenceImage({ imageUrl: baseUrl, prompt });
      setDirectGenStatus('Generating reference image...');
      runPollLoop(falRequest, async (result) => {
        if (result.imageUrl) {
          setDirectRefImageUrl(result.imageUrl);
          setDirectGenStatus(null);
          const { data } = await supabase.from('demo_assets').insert({
            coach_label: studioCoach, exercise_name: studioExercise.trim(),
            asset_kind: 'reference', status: 'candidate', prompt,
            image_url: result.imageUrl, request_id: falRequest.requestId,
            metadata: { source: 'direct-ref-image', model: 'flux-dev-i2i' },
          }).select('id').single();
          if (data) setDirectRefAssetId(data.id);
        } else {
          Alert.alert('No image returned', result.error ?? 'fal.ai did not return an image.');
        }
      });
    } catch (e: any) {
      setDirectGenLoading(false); setDirectGenStatus(null);
      Alert.alert('Submit failed', e?.message ?? 'Could not start image generation.');
    }
  };

  // Step 2: animate the approved reference image into a video
  const handleAnimateToVideo = async () => {
    if (!directRefImageUrl) { Alert.alert('No reference image', 'Generate and approve a reference image first.'); return; }
    const prompt = directGenPrompt.trim() || buildDemoPrompt(studioExercise.trim(), studioEquipment, studioCoach === 'Serena' ? 'female' : 'male');

    if (directPollTimer.current) { clearInterval(directPollTimer.current); directPollTimer.current = null; }
    setDirectGenLoading(true);
    setDirectGenStatus('Submitting video job...');
    setDirectGenVideoUrl(null);
    setDirectGenAssetId(null);
    setDirectGenAssetStatus(null);

    try {
      const falRequest = await submitImageToVideo({ imageUrl: directRefImageUrl, prompt });
      setDirectGenStatus('Generating video...');
      runPollLoop(falRequest, async (result) => {
        if (result.videoUrl) {
          setDirectGenVideoUrl(result.videoUrl);
          setDirectGenStatus('Done');
          const { data } = await supabase.from('demo_assets').insert({
            coach_label: studioCoach, exercise_name: studioExercise.trim(),
            asset_kind: 'video', status: 'candidate', prompt,
            video_url: result.videoUrl, request_id: falRequest.requestId,
            metadata: { aspect_ratio: '16:9', duration_seconds: 10, model: 'kling-v1.6-pro', source: 'direct-ref' },
          }).select('id').single();
          if (data) { setDirectGenAssetId(data.id); setDirectGenAssetStatus('candidate'); }
        } else {
          Alert.alert('Generation failed', result.error ?? 'fal.ai returned an error.');
        }
      });
    } catch (e: any) {
      setDirectGenLoading(false); setDirectGenStatus(null);
      Alert.alert('Submit failed', e?.message ?? 'Could not start video generation.');
    }
  };

  const handleImportImageForAnimation = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Permission required', 'Allow photo library access to import images.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, allowsEditing: false });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setDirectGenLoading(true);
    setDirectGenStatus('Uploading image...');

    try {
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const fileName = `direct-import/${studioCoach.toLowerCase()}-${Date.now()}.${ext}`;
      const fileBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const bytes = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));

      const { error } = await supabase.storage.from('coach-assets').upload(fileName, bytes, { contentType, upsert: true });
      if (error) throw new Error(error.message);

      const { data: urlData } = supabase.storage.from('coach-assets').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      setDirectRefImageUrl(publicUrl);
      setDirectRefApproved(true);
      setDirectGenVideoUrl(null);
      setDirectGenAssetId(null);
      setDirectGenAssetStatus(null);
      setDirectGenStatus(null);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Could not upload image.');
    } finally {
      setDirectGenLoading(false);
    }
  };

  const handleImportApprovedReference = async () => {
    if (!studioExercise.trim()) {
      Alert.alert('Add an exercise', 'Type the exercise name first so we save the reference to the right lift.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access so we can import your approved reference image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      base64: true,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]?.base64) return;

    setStudioLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('demo-reference-studio', {
        body: {
          action: 'approve_candidate',
          coachLabel: studioCoach,
          exerciseName: studioExercise.trim(),
          imageBase64: result.assets[0].base64,
          prompt: `Imported approved ${studioCoach} ${studioExercise.trim()} reference`,
          metadata: {
            source: 'coach-studio-import',
            approvedAt: new Date().toISOString(),
          },
        },
      });
      if (error) throw error;
      await loadStudioAssets(studioCoach, studioExercise.trim());
      const approvedAsset = mapStudioAssetRow((data as { asset?: any }).asset);

      Alert.alert('Reference imported', "Saved to Demo Studio. We'll start the video render next.");
      if (approvedAsset) {
        await buildWideReferenceAndRender(approvedAsset);
      }
    } catch (error: any) {
      Alert.alert('Could not import reference', error?.message ?? 'Please try again.');
    } finally {
      setStudioLoading(false);
    }
  };

  const handleUseBuiltInReference = async () => {
    if (!studioExercise.trim()) {
      Alert.alert('Add an exercise', 'Type the exercise name first so we save the reference to the right lift.');
      return;
    }

    const source = BUILT_IN_STUDIO_REFERENCES[studioCoach];
    if (!source) {
      Alert.alert('No built-in reference', `There is no bundled reference image for ${studioCoach} yet.`);
      return;
    }

    setStudioLoading(true);
    try {
      const imageBase64 = await loadBundledReferenceBase64(source);

      const { data, error } = await supabase.functions.invoke('demo-reference-studio', {
        body: {
          action: 'approve_candidate',
          coachLabel: studioCoach,
          exerciseName: studioExercise.trim(),
          imageBase64,
          prompt: `Bundled approved ${studioCoach} ${studioExercise.trim()} reference`,
          metadata: {
            source: 'coach-studio-bundled-reference',
            approvedAt: new Date().toISOString(),
          },
        },
      });
      if (error) throw error;
      await loadStudioAssets(studioCoach, studioExercise.trim());
      const approvedAsset = mapStudioAssetRow((data as { asset?: any }).asset);

      Alert.alert('Standard reference ready', `${studioCoach}'s bundled reference was saved to Demo Studio. Starting the video render now.`);
      if (approvedAsset) {
        await buildWideReferenceAndRender(approvedAsset);
      }
    } catch (error: any) {
      Alert.alert('Could not use standard reference', error?.message ?? 'Please try again.');
    } finally {
      setStudioLoading(false);
    }
  };

  const handleApproveStudioVideo = async (asset: DemoAsset) => {
    try {
      await approveDemoAsset(asset.id);
      await loadStudioAssets(studioCoach, studioExercise.trim());
      await loadMissingDemoExercises(studioCoach);
      Alert.alert('Demo approved', `${asset.exerciseName} is now live for ${studioCoach} across Train.`);
    } catch (error: any) {
      Alert.alert('Could not approve video', error?.message ?? 'Please try again.');
    }
  };

  // Collect all upcoming sessions across clients, sorted by date
  const upcomingSessions = clients
    .flatMap((client) => {
      const schedule = client.sessionSchedule?.length
        ? client.sessionSchedule.map((slot) => ({ client, dateStr: `${slot.date}T${slot.time}:00` }))
        : client.nextSession
          ? [{ client, dateStr: client.nextSession }]
          : [];
      return schedule;
    })
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  const groupRosters: GroupRoster[] = clients
    .filter((client) => client.sessionType === 'group')
    .flatMap((client) => (client.sessionSchedule ?? []).map((slot) => ({
      id: `${slot.date}-${slot.time}`,
      date: slot.date,
      time: slot.time,
      client,
    })))
    .reduce<GroupRoster[]>((acc, entry) => {
      const existing = acc.find((item) => item.id === entry.id);
      if (existing) {
        existing.clients.push(entry.client);
        return acc;
      }
      acc.push({
        id: entry.id,
        date: entry.date,
        time: entry.time,
        clients: [entry.client],
      });
      return acc;
    }, [])
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  // Collect all pending/processing/shipped gifts
  const pendingGifts = clients.flatMap((c) =>
    c.bonus.gifts
      .filter((g) => g.status !== 'delivered')
      .map((g) => ({ clientId: c.id, clientName: c.name, gift: g })),
  );
  const pendingShakeOrders = shakeOrders.filter(
    (order) => order.fulfillmentStatus !== 'completed' && order.fulfillmentStatus !== 'cancelled',
  );

  const TABS: { key: CoachTab; label: string }[] = [
    { key: 'clients', label: 'Clients' },
    { key: 'inbox', label: `Inbox${inboxThreads.length ? ` (${inboxThreads.length})` : ''}` },
    { key: 'calendar', label: 'Calendar' },
    {
      key: 'gifts',
      label: `Gifts${pendingGifts.length + pendingShakeOrders.length ? ` (${pendingGifts.length + pendingShakeOrders.length})` : ''}`,
    },
    { key: 'studio', label: 'Demo Studio' },
    { key: 'settings', label: '⚙️ Settings' },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: accent }]}>← Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>COACH MODE</Text>
          <Text style={styles.headerSub}>{clients.length} active clients</Text>
        </View>
        <Pressable
          style={styles.inboxBtn}
          onPress={() => (navigation as any).navigate('CoachInbox')}
          hitSlop={8}
        >
          <Text style={styles.inboxBtnText}>📬 Inbox</Text>
        </Pressable>
        <View style={styles.coachBadge}>
          <Text style={styles.coachBadgeText}>👨‍💼 COACH</Text>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
        style={styles.tabScroll}
      >
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tabBtn, tab === t.key ? [styles.tabBtnActive, { backgroundColor: accent, borderColor: accent }] : null]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabBtnText, tab === t.key ? styles.tabBtnTextActive : null]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Clients tab ── */}
        {tab === 'clients' ? (
          <>
            <Pressable
              style={[styles.goLiveCard, { borderColor: C.orange }]}
              onPress={() => (navigation as any).navigate('GoLiveTribe')}
            >
              <View style={styles.goLiveDot} />
              <View style={styles.goLiveCopy}>
                <Text style={styles.goLiveText}>Start 3-Day Finale Live Workout</Text>
                <Text style={styles.goLiveSubtext}>Press this to start the WW group workout live session for members.</Text>
              </View>
              <Text style={styles.goLiveArrow}>→</Text>
            </Pressable>

            <View style={[styles.inviteCard, { borderColor: accentBorder }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteTitle}>Invite a Client</Text>
                <Text style={styles.inviteBody}>
                  Generate a code, send it to your client, and they'll appear here as soon as they redeem it in Live Coach.
                </Text>
                {invites[0] ? (
                  <Text style={[styles.inviteMeta, { color: accent }]}>
                    Latest code: <Text style={styles.inviteCode}>{invites[0].code}</Text> · {invites[0].status.toUpperCase()}
                  </Text>
                ) : null}
              </View>
              <Pressable style={[styles.inviteBtn, { backgroundColor: accent }]} onPress={handleCreateInvite}>
                <Text style={styles.inviteBtnText}>New Code</Text>
              </Pressable>
            </View>
            <SectionLabel>{`Active Clients · ${clients.length}`}</SectionLabel>
            <SectionLabel style={{ marginTop: 20 }}>{`Form Review Queue · ${formReviewClips.length}`}</SectionLabel>
            {formReviewClips.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🎥</Text>
                <Text style={styles.emptyTitle}>No form review clips yet</Text>
                <Text style={styles.emptyBody}>When athletes send a 10–15 second form video, it will land here with their name and timestamp.</Text>
              </View>
            ) : (
              formReviewClips.slice(0, 10).map((clip) => {
                const clipClient = clients.find((client) => client.id === clip.userId);
                const clipName = clipClient?.name ?? 'APEX User';
                return (
                  <Pressable
                    key={clip.id}
                    style={styles.groupRosterCard}
                    onPress={() => setSelectedFormReviewClip(clip)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clientName}>{clipName}</Text>
                      <Text style={styles.clientMeta}>{clip.exerciseName}</Text>
                      <Text style={styles.shippingAddr}>{new Date(clip.submittedAt).toLocaleString()}</Text>
                    </View>
                    <Text style={styles.joinBtnText}>PLAY</Text>
                  </Pressable>
                );
              })
            )}
            {clients.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>👥</Text>
                <Text style={styles.emptyTitle}>No clients yet</Text>
                <Text style={styles.emptyBody}>Clients will appear here once they redeem your invite code. If they later book live coaching, their package and sessions will fill in automatically.</Text>
                <Pressable
                  style={[styles.emptyStateBtn, { borderColor: accent, backgroundColor: `${accent}12` }]}
                  onPress={() => {
                    handleCreateDemoClient().catch(() => null);
                  }}
                >
                  <Text style={[styles.emptyStateBtnText, { color: accent }]}>🧪 Create Demo Client</Text>
                </Pressable>
              </View>
            ) : (
              clients.map((c) => (
                <ClientCard
                  key={c.id}
                  client={c}
                  onMessage={(cl) => {
                    setMsgClient(cl);
                    setMsgVisible(true);
                  }}
                  onPress={(cl) => {
                    setSelectedClient(cl);
                    setDetailVisible(true);
                  }}
                />
              ))
            )}
          </>
        ) : null}

        {/* ── Inbox tab ── */}
        {tab === 'inbox' ? (
          <>
            <View style={styles.infoCard}>
              <Text style={styles.infoCardText}>
                This is your unified coach inbox. Every client note, booking confirmation, and system handoff lands here so you can reply fast without opening every profile one by one.
              </Text>
            </View>
            <SectionLabel>{`Active Threads · ${inboxThreads.length}`}</SectionLabel>
            {inboxThreads.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyTitle}>Inbox is clear</Text>
                <Text style={styles.emptyBody}>When clients message you or buy live coaching, their latest thread will show up here.</Text>
              </View>
            ) : (
              inboxThreads.map((thread) => (
                <InboxThreadCard
                  key={thread.client.id}
                  thread={thread}
                  onOpen={(client) => {
                    setMsgClient(client);
                    setMsgVisible(true);
                  }}
                />
              ))
            )}
          </>
        ) : null}

        {/* ── Calendar tab ── */}
        {tab === 'calendar' ? (
          <>
            {/* Monthly calendar grid */}
            <CoachCalendarGrid
              sessionDates={upcomingSessions.map(({ dateStr }) => dateStr.split('T')[0])}
              onDayPress={(dateStr) => {
                const match = upcomingSessions.find(({ dateStr: d }) => d.split('T')[0] === dateStr);
                if (match) {
                  Alert.alert(
                    match.client.name,
                    `${formatSessionDate(dateStr, match.dateStr.split('T')[1]?.slice(0, 5) ?? '00:00')}\n${SESSION_TYPE_LABELS[match.client.sessionType]}`,
                    [{ text: 'OK' }],
                  );
                }
              }}
            />

            <SectionLabel style={{ marginTop: 20 }}>Upcoming Sessions</SectionLabel>
            {upcomingSessions.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>📅</Text>
                <Text style={styles.emptyTitle}>No sessions booked</Text>
                <Text style={styles.emptyBody}>Sessions booked by clients appear here.</Text>
              </View>
            ) : (
              upcomingSessions.map(({ client, dateStr }) => {
                const [date, timeFull] = dateStr.split('T');
                const time = (timeFull ?? '00:00').slice(0, 5);
                const daysUntil = getDaysUntil(date);
                return (
                  <View key={client.id} style={styles.calRow}>
                    <View style={[styles.calDayBadge, daysUntil === 0 ? { backgroundColor: C.orange } : { backgroundColor: accentSoft, borderColor: accentBorder }]}>
                      <Text style={styles.calDayText}>
                        {daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TMW' : `${daysUntil}d`}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.calClientName}>{client.name}</Text>
                      <Text style={styles.calSessionInfo}>
                        {formatSessionDate(date, time)} · {SESSION_TYPE_LABELS[client.sessionType]}
                      </Text>
                    </View>
                    <Pressable
                      style={[styles.joinBtn, { backgroundColor: accent }]}
                      onPress={() => {
                        setSelectedClient(client);
                        setDetailVisible(true);
                      }}
                    >
                      <Text style={styles.joinBtnText}>LIVE</Text>
                    </Pressable>
                    <Pressable
                      style={styles.reminderBtn}
                      onPress={() => {
                        scheduleCoachSessionReminder({
                          clientName: client.name,
                          date,
                          time,
                          minutesBefore: 30,
                        }).then((ok) => {
                          Alert.alert(
                            ok ? 'Reminder scheduled' : 'Could not schedule reminder',
                            ok
                              ? `We'll remind you 30 minutes before ${client.name}'s session.`
                              : 'Notification permissions may be off, or the reminder time is already in the past.',
                          );
                        }).catch(() => null);
                      }}
                    >
                      <Text style={styles.reminderBtnText}>REMIND</Text>
                    </Pressable>
                  </View>
                );
              })
            )}

            {/* Rebook reminder */}
            <SectionLabel style={{ marginTop: 20 }}>Session Recurrence</SectionLabel>
            <View style={styles.infoCard}>
              <Text style={styles.infoCardText}>
                💡 After each session, clients get an automated prompt to confirm the same time next week or reschedule. You can also update their next session from the client card.
              </Text>
            </View>

            <SectionLabel style={{ marginTop: 20 }}>Group Coaching Rosters</SectionLabel>
            {groupRosters.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>👥</Text>
                <Text style={styles.emptyTitle}>No group rosters yet</Text>
                <Text style={styles.emptyBody}>Once clients book group coaching, their shared session slots will appear here with attendance controls.</Text>
              </View>
            ) : (
              groupRosters.map((roster) => {
                const presentCount = roster.clients.filter((client) =>
                  client.sessionAttendance?.some((item) => item.date === roster.date && item.time === roster.time && item.status === 'present'),
                ).length;
                return (
                  <Pressable
                    key={roster.id}
                    style={styles.groupRosterCard}
                    onPress={() => {
                      setSelectedRoster(roster);
                      setRosterVisible(true);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clientName}>{formatSessionDate(roster.date, roster.time)}</Text>
                      <Text style={styles.clientMeta}>{roster.clients.length} athletes · {presentCount} present marked</Text>
                    </View>
                    <View style={styles.inboxCountBadge}>
                      <Text style={styles.inboxCountText}>{roster.clients.length}</Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </>
        ) : null}

        {/* ── Gifts tab ── */}
        {tab === 'gifts' ? (
          <>
            <SectionLabel>{`Shake Orders · ${pendingShakeOrders.length}`}</SectionLabel>
            {shakeOrders.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🥤</Text>
                <Text style={styles.emptyTitle}>No shake orders yet</Text>
                <Text style={styles.emptyBody}>New shake orders will appear here with flavor and shipping details.</Text>
              </View>
            ) : (
              <>
                {pendingShakeOrders.length > 0 ? (
                  pendingShakeOrders.map((order) => (
                    <ShakeOrderRow
                      key={order.id}
                      order={order}
                      onUpdateStatus={handleUpdateShakeOrder}
                    />
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyIcon}>✅</Text>
                    <Text style={styles.emptyTitle}>All shake orders handled</Text>
                    <Text style={styles.emptyBody}>Nothing waiting on manual fulfillment right now.</Text>
                  </View>
                )}

                <SectionLabel style={{ marginTop: 20 }}>All Shake Orders</SectionLabel>
                {shakeOrders.map((order) => (
                  <ShakeOrderRow
                    key={`all-${order.id}`}
                    order={order}
                    onUpdateStatus={handleUpdateShakeOrder}
                  />
                ))}
              </>
            )}

            <SectionLabel>{`Pending Gift Fulfilment · ${pendingGifts.length}`}</SectionLabel>
            {pendingGifts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🎁</Text>
                <Text style={styles.emptyTitle}>All gifts delivered!</Text>
                <Text style={styles.emptyBody}>Nothing pending right now.</Text>
              </View>
            ) : (
              pendingGifts.map(({ clientId, clientName, gift }) => (
                <GiftRow
                  key={`${clientId}-${gift.id}`}
                  clientName={clientName}
                  gift={gift}
                  onUpdateStatus={(giftId, status) => handleUpdateGift(clientId, giftId, status)}
                />
              ))
            )}

            <SectionLabel style={{ marginTop: 20 }}>All Gifts By Client</SectionLabel>
            {clients
              .filter((c) => c.bonus.gifts.length > 0)
              .map((c) => (
                <View key={c.id} style={styles.clientGiftSection}>
                  <Text style={styles.clientGiftName}>{c.name}</Text>
                  {c.bonus.shippingAddress ? (
                    <Text style={styles.shippingAddr}>📍 {c.bonus.shippingAddress}</Text>
                  ) : (
                    <Text style={[styles.shippingAddr, { color: C.orange }]}>⚠️ No shipping address yet</Text>
                  )}
                  {c.bonus.gifts.map((gift) => (
                    <GiftRow
                      key={gift.id}
                      clientName={c.name}
                      gift={gift}
                      onUpdateStatus={(giftId, status) => handleUpdateGift(c.id, giftId, status)}
                    />
                  ))}
                </View>
              ))}
          </>
        ) : null}

        {tab === 'studio' ? (
          <>
            {/* ── COACH TOGGLE ── */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
              {coachOptions.map((coach) => {
                const active = coach.label === studioCoach;
                return (
                  <Pressable
                    key={coach.id}
                    style={[
                      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5 },
                      active
                        ? { borderColor: '#A855F7', backgroundColor: '#A855F712' }
                        : { borderColor: C.border, backgroundColor: C.surface2 },
                    ]}
                    onPress={() => setStudioCoach(coach.label as 'Marcus' | 'Serena')}
                  >
                    <Image source={coach.avatar} style={{ width: 36, height: 36, borderRadius: 18 }} />
                    <Text style={[styles.clientName, { color: active ? '#A855F7' : C.text }]}>{coach.label}</Text>
                    {active ? <Text style={{ marginLeft: 'auto', color: '#A855F7', fontSize: 16 }}>●</Text> : null}
                  </Pressable>
                );
              })}
            </View>

            {/* ── MISSING COVERAGE QUICK-SELECT ── */}
            {missingDemoExercises.length > 0 ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={styles.sectionLabel}>NEEDS COVERAGE · {missingDemoExercises.length}</Text>
                  {missingDemoExercises.length > 0 ? (
                    <Pressable onPress={() => setStudioExercise(missingDemoExercises[0])}>
                      <Text style={[styles.clientMeta, { color: '#A855F7' }]}>Next →</Text>
                    </Pressable>
                  ) : null}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8, marginBottom: 16 }}>
                  {missingDemoExercises.slice(0, 20).map((exerciseName) => {
                    const active = normalizeDemoExerciseName(exerciseName) === normalizeDemoExerciseName(studioExercise);
                    return (
                      <Pressable
                        key={exerciseName}
                        style={[
                          styles.detailTabBtn,
                          active ? { backgroundColor: '#A855F712', borderColor: '#A855F7' } : null,
                        ]}
                        onPress={() => setStudioExercise(exerciseName)}
                      >
                        <Text style={[styles.detailTabText, active ? { color: '#A855F7', fontFamily: 'DMSans_700Bold' } : null]}>{exerciseName}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}

            {/* ── EXERCISE ── */}
            <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>EXERCISE</Text>
            <TextInput
              value={studioExercise}
              onChangeText={setStudioExercise}
              placeholder="e.g. Air Bike, Bench Press, Squat"
              placeholderTextColor={C.muted}
              style={[styles.input, { marginBottom: 16 }]}
            />

            {/* ── EQUIPMENT ── */}
            <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>EQUIPMENT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8, marginBottom: 20 }}>
              {EQUIPMENT_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  style={[
                    styles.detailTabBtn,
                    studioEquipment === opt ? { backgroundColor: '#A855F712', borderColor: '#A855F7' } : null,
                  ]}
                  onPress={() => setStudioEquipment(opt)}
                >
                  <Text style={[styles.detailTabText, studioEquipment === opt ? { color: '#A855F7', fontFamily: 'DMSans_700Bold' } : null]}>{opt}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* ── PROMPT ── */}
            <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>PROMPT (EDITABLE)</Text>
            <TextInput
              value={directGenPrompt}
              onChangeText={setDirectGenPrompt}
              multiline
              style={[styles.input, { minHeight: 72, textAlignVertical: 'top', marginBottom: 20, fontStyle: 'italic', fontSize: 13 }]}
              placeholderTextColor={C.muted}
            />

            {/* ── REFERENCE SOURCE ── */}
            {BUILT_IN_STUDIO_REFERENCES[studioCoach] ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, padding: 10, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border }}>
                <Image source={BUILT_IN_STUDIO_REFERENCES[studioCoach]} style={{ width: 56, height: 56, borderRadius: 8 }} resizeMode="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.clientName, { fontSize: 13 }]}>{studioCoach} Reference Photo</Text>
                  <Text style={styles.clientMeta}>Wide-shot source used for Step 1</Text>
                </View>
              </View>
            ) : null}

            {/* ── ACTIONS: Step 1 ── */}
            {!directRefApproved ? (
              <View style={{ gap: 10, marginBottom: 24 }}>
                <Pressable
                  style={[styles.inviteBtn, { backgroundColor: '#A855F7', opacity: directGenLoading && !directRefImageUrl ? 0.6 : 1 }]}
                  onPress={handleGenerateReferenceImage}
                  disabled={directGenLoading}
                >
                  {directGenLoading && !directRefImageUrl
                    ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator color="#fff" size="small" /><Text style={styles.inviteBtnText}>{directGenStatus ?? 'Generating...'}</Text></View>
                    : <Text style={styles.inviteBtnText}>Step 1 — Generate Reference Image</Text>}
                </Pressable>
                <Pressable
                  style={[styles.btnGhost, { borderColor: '#A855F7', backgroundColor: '#A855F708', opacity: directGenLoading ? 0.6 : 1 }]}
                  onPress={handleImportImageForAnimation}
                  disabled={directGenLoading}
                >
                  {directGenLoading && directGenStatus === 'Uploading image...'
                    ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator color="#A855F7" size="small" /><Text style={[styles.btnGhostText, { color: '#A855F7' }]}>Uploading...</Text></View>
                    : <Text style={[styles.btnGhostText, { color: '#A855F7' }]}>or Import from Photos</Text>}
                </Pressable>
              </View>
            ) : null}

            {/* ── STEP 1 RESULT — approve or discard ── */}
            {directRefImageUrl && !directRefApproved ? (
              <View style={[styles.studioCandidateCard, { marginBottom: 20 }]}>
                <Image
                  source={{ uri: directRefImageUrl }}
                  style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#000', marginBottom: 12 }}
                  resizeMode="cover"
                />
                <Text style={[styles.clientName, { marginBottom: 4 }]}>{studioExercise} · {studioEquipment}</Text>
                <Text style={[styles.clientMeta, { marginBottom: 14 }]}>Does this look right? Approve to animate, or discard and generate again.</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable style={[styles.inviteBtn, { flex: 1, backgroundColor: '#A855F7' }]} onPress={() => setDirectRefApproved(true)}>
                    <Text style={styles.inviteBtnText}>✓ Looks Good</Text>
                  </Pressable>
                  <Pressable style={[styles.inviteBtn, { flex: 1, backgroundColor: C.surface3 }]} onPress={() => { setDirectRefImageUrl(null); setDirectRefAssetId(null); }}>
                    <Text style={[styles.inviteBtnText, { color: C.muted }]}>✕ Try Again</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* ── STEP 2 — animate ── */}
            {directRefApproved && !directGenVideoUrl ? (
              <View style={[styles.studioCandidateCard, { marginBottom: 20 }]}>
                {directRefImageUrl ? (
                  <Image
                    source={{ uri: directRefImageUrl }}
                    style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#000', marginBottom: 12 }}
                    resizeMode="cover"
                  />
                ) : null}
                <Text style={[styles.clientName, { marginBottom: 4 }]}>Reference approved</Text>
                <Text style={[styles.clientMeta, { marginBottom: 14 }]}>Grok will animate this into a 16:9 720p 10-second video.</Text>
                <Pressable
                  style={[styles.inviteBtn, { backgroundColor: '#A855F7', opacity: directGenLoading ? 0.6 : 1 }]}
                  onPress={handleAnimateToVideo}
                  disabled={directGenLoading}
                >
                  {directGenLoading
                    ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator color="#fff" size="small" /><Text style={styles.inviteBtnText}>{directGenStatus ?? 'Animating...'}</Text></View>
                    : <Text style={styles.inviteBtnText}>Step 2 — Animate to Video</Text>}
                </Pressable>
              </View>
            ) : null}

            {/* ── STEP 2 RESULT — video review ── */}
            {directGenVideoUrl ? (
              <View style={[styles.studioCandidateCard, { marginBottom: 20 }]}>
                <Video
                  source={{ uri: directGenVideoUrl }}
                  style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#000', marginBottom: 12 }}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  isLooping
                  shouldPlay
                />
                <Text style={[styles.clientName, { marginBottom: 4 }]}>{studioCoach} — {studioExercise}</Text>
                <Text style={[styles.clientMeta, { marginBottom: 14 }]}>{studioEquipment} · 16:9 · 720p · 10s</Text>
                {directGenAssetStatus !== 'approved' && directGenAssetStatus !== 'archived' ? (
                  <View style={{ gap: 10 }}>
                    <Pressable
                      style={[styles.inviteBtn, { backgroundColor: '#22C55E' }]}
                      onPress={async () => { if (directGenAssetId) { await approveDemoAsset(directGenAssetId); setDirectGenAssetStatus('approved'); } }}
                    >
                      <Text style={styles.inviteBtnText}>✓ Save to Demo Library</Text>
                    </Pressable>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Pressable
                        style={[styles.btnGhost, { flex: 1, borderColor: C.border }]}
                        onPress={() => { setDirectRefImageUrl(null); setDirectRefAssetId(null); setDirectRefApproved(false); setDirectGenVideoUrl(null); setDirectGenAssetId(null); setDirectGenAssetStatus(null); setDirectGenStatus(null); }}
                      >
                        <Text style={[styles.btnGhostText, { color: C.text }]}>↺ New Video</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.btnGhost, { flex: 1, borderColor: C.border }]}
                        onPress={async () => { if (directGenAssetId) { await archiveDemoAsset(directGenAssetId); setDirectGenAssetStatus('archived'); } }}
                      >
                        <Text style={[styles.btnGhostText, { color: C.muted }]}>✕ Archive</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    <Text style={[styles.clientMeta, { color: directGenAssetStatus === 'approved' ? '#22C55E' : C.muted, fontFamily: 'DMSans_700Bold' }]}>
                      {directGenAssetStatus === 'approved' ? '✓ Saved to demo library' : 'Archived'}
                    </Text>
                    <Pressable
                      style={[styles.btnGhost, { borderColor: C.border }]}
                      onPress={() => { setDirectRefImageUrl(null); setDirectRefAssetId(null); setDirectRefApproved(false); setDirectGenVideoUrl(null); setDirectGenAssetId(null); setDirectGenAssetStatus(null); setDirectGenStatus(null); }}
                    >
                      <Text style={[styles.btnGhostText, { color: C.text }]}>↺ Make Another</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}

            {/* ── APPROVED VIDEOS LIBRARY ── */}
            {approvedVideos.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { marginBottom: 12, marginTop: 8 }]}>DEMO LIBRARY · {approvedVideos.length}</Text>
                {approvedVideos.map((asset) => (
                  <Pressable
                    key={asset.id}
                    style={[styles.studioSavedRow, { marginBottom: 8 }]}
                    onPress={() => asset.videoUrl ? Linking.openURL(asset.videoUrl).catch(() => null) : null}
                  >
                    <View style={[styles.studioSavedThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A855F712', borderColor: '#A855F740', borderWidth: 1 }]}>
                      <Text style={{ color: '#A855F7', fontSize: 18 }}>▶</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clientName}>{asset.exerciseName}</Text>
                      <Text style={styles.clientMeta}>{asset.coachLabel} · {new Date(asset.createdAt).toLocaleDateString()}</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {/* ── Settings tab ── */}
        {tab === 'settings' ? (
          <>
            <Text style={styles.sectionLabel}>APP EDITION</Text>
            <View style={styles.settingsRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsRowTitle}>Walk &amp; Water Challenge</Text>
                <Text style={styles.settingsRowSub}>
                  {wwMode ? 'Active — app shows W&W edition' : 'Off — app shows standard APEX'}
                </Text>
              </View>
              <Switch
                value={wwMode}
                onValueChange={async (val) => {
                  await setWalkWaterModeEnabled(val);
                  setWwMode(val);
                  DeviceEventEmitter.emit(WALK_WATER_MODE_EVENT, val);
                }}
                trackColor={{ false: C.border, true: '#0EA5E9' }}
                thumbColor={wwMode ? '#fff' : C.muted}
              />
            </View>
            {wwMode && (
              <View style={styles.settingsInfoCard}>
                <Text style={styles.settingsInfoText}>
                  💧 Walk &amp; Water mode is ON. Users who open the app will see the challenge edition with its own quiz, dashboard, and community tab. Toggle off to revert to standard APEX.
                </Text>
              </View>
            )}
            {wwMode && (
              <Pressable
                style={styles.wwResetBtn}
                onPress={async () => {
                  await AsyncStorage.multiRemove([
                    'apex._edition.walkWaterQuiz',
                    'apex._edition.walkWaterPlan',
                    'apex._edition.wwUpgraded',
                    'apex.ww.groupWorkoutDone',
                    'apex.ww.groupWorkoutDoneAt',
                  ]);
                  // Also clear any water log keys for the last 60 days
                  const keys = await AsyncStorage.getAllKeys();
                  const waterKeys = keys.filter(k => k.startsWith('apex.ww.water.'));
                  if (waterKeys.length) await AsyncStorage.multiRemove(waterKeys);
                  alert('✅ Reset complete — you\'re a new user again. Reload the app.');
                }}
              >
                <Text style={styles.wwResetBtnText}>🔄 Reset to New User</Text>
              </Pressable>
            )}
          </>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>

      <ClientDetailModal
        visible={detailVisible}
        client={selectedClient}
        coachUserId={session?.user?.id}
        onClose={() => setDetailVisible(false)}
        onSave={handleSaveClient}
      />
      <CoachMessageModal
        visible={msgVisible}
        client={msgClient}
        coachUserId={session?.user?.id}
        onClose={() => setMsgVisible(false)}
      />
      <GroupRosterModal
        visible={rosterVisible}
        roster={selectedRoster}
        onClose={() => setRosterVisible(false)}
        onMarkAttendance={(client, status) => {
          handleMarkAttendance(client, status).catch(() => null);
        }}
      />
      <Modal
        visible={!!selectedFormReviewClip}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedFormReviewClip(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedFormReviewClip(null)} />
          <View style={[styles.modalCard, { paddingBottom: 20 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>FORM REVIEW CLIP</Text>
            <Text style={styles.voicePrefSub}>
              {(clients.find((client) => client.id === selectedFormReviewClip?.userId)?.name ?? 'APEX User')} · {selectedFormReviewClip?.exerciseName}
            </Text>
            {selectedFormReviewClip?.videoUrl ? (
              <Video
                source={{ uri: selectedFormReviewClip.videoUrl }}
                style={{ width: '100%', aspectRatio: 9 / 16, borderRadius: 18, marginTop: 14, backgroundColor: C.black }}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
              />
            ) : null}
            <Pressable style={[styles.ldSaveBtn, { marginTop: 18 }]} onPress={() => setSelectedFormReviewClip(null)}>
              <Text style={styles.ldSaveBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { paddingRight: 8 },
  backText: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  headerTitle: { fontSize: 18, color: C.text, fontFamily: 'DMSans_700Bold' },
  headerSub: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  inboxBtn: { backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  inboxBtnText: { fontSize: 11, color: C.green, fontFamily: 'DMSans_700Bold' },
  coachBadge: { backgroundColor: 'rgba(168,85,247,0.18)', borderWidth: 1, borderColor: C.purple, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  coachBadgeText: { color: C.purple, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 0.5 },
  tabScroll: { marginBottom: 4, flexGrow: 0 },
  tabRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingRight: 24, gap: 8 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabBtnActive: { backgroundColor: C.green, borderColor: C.green },
  tabBtnText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_500Medium' },
  tabBtnTextActive: { color: '#000' },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 32 },
  sectionLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: C.muted, fontFamily: 'SpaceMono_400Regular', marginBottom: 10, marginTop: 6 },
  goLiveCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1A0A00', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  goLiveCopy: { flex: 1, gap: 4 },
  goLiveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.orange },
  goLiveText: { color: C.orange, fontSize: 15, fontFamily: 'DMSans_700Bold' },
  goLiveSubtext: { color: 'rgba(255,184,77,0.78)', fontSize: 12, lineHeight: 16, fontFamily: 'DMSans_500Medium' },
  goLiveArrow: { color: C.orange, fontSize: 18, fontWeight: '700' },
  inviteCard: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 16, padding: 14, marginBottom: 14 },
  inviteTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 4 },
  inviteBody: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 18 },
  inviteMeta: { fontSize: 11, color: C.green, fontFamily: 'DMSans_500Medium', marginTop: 8 },
  inviteCode: { fontFamily: 'SpaceMono_400Regular', color: C.text },
  inviteBtn: { backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  inviteBtnText: { color: '#000', fontSize: 12, fontFamily: 'DMSans_700Bold' },
  // Client card
  clientCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  clientAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  clientAvatarText: { color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 14 },
  clientName: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  clientMeta: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  clientNext: { fontSize: 11, color: C.green, fontFamily: 'DMSans_400Regular', marginTop: 3 },
  inboxPreview: { fontSize: 12, color: C.text, fontFamily: 'DMSans_400Regular', marginTop: 6, lineHeight: 18 },
  inboxCountBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxCountText: { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 10 },
  inboxNeedsReplyBadge: {
    backgroundColor: 'rgba(255,107,53,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.45)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  inboxNeedsReplyText: { color: C.orange, fontFamily: 'SpaceMono_400Regular', fontSize: 9, letterSpacing: 0.4 },
  sessionsPill: { fontSize: 12, color: C.text, fontFamily: 'SpaceMono_400Regular' },
  renewBadge: { backgroundColor: C.orangeSoft, borderWidth: 1, borderColor: C.orangeBorder, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  renewBadgeText: { fontSize: 9, color: C.orange, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5 },
  // Coach Calendar Grid
  coachCal: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginBottom: 16 },
  coachCalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  coachCalNavBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: C.dark, borderRadius: 8 },
  coachCalNavText: { fontSize: 20, color: C.text, fontFamily: 'DMSans_500Medium', lineHeight: 24 },
  coachCalMonthLabel: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  coachCalDayRow: { flexDirection: 'row', marginBottom: 4 },
  coachCalDayLabel: { flex: 1, textAlign: 'center', fontSize: 10, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5, paddingVertical: 4 },
  coachCalGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  coachCalCell: { width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  coachCalCellToday: { backgroundColor: 'rgba(0,255,136,0.15)', borderRadius: 8, borderWidth: 1, borderColor: C.green },
  coachCalCellSession: { backgroundColor: 'rgba(255,107,53,0.15)', borderRadius: 8, borderWidth: 1, borderColor: C.orange },
  coachCalCellText: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium' },
  coachCalCellTextToday: { color: C.green, fontFamily: 'DMSans_700Bold' },
  coachCalCellTextSession: { color: C.orange, fontFamily: 'DMSans_700Bold' },
  coachCalSessionDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.orange, marginTop: 1 },
  coachCalLegend: { flexDirection: 'row', gap: 16, marginTop: 12, justifyContent: 'center' },
  coachCalLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coachCalLegendDot: { width: 8, height: 8, borderRadius: 4 },
  coachCalLegendText: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular' },
  // Calendar session list
  calRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  calDayBadge: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, alignItems: 'center', justifyContent: 'center' },
  calDayText: { fontSize: 12, color: C.green, fontFamily: 'DMSans_700Bold' },
  calClientName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold' },
  calSessionInfo: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  joinBtn: { backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  joinBtnText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 12 },
  reminderBtn: {
    backgroundColor: C.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.orangeBorder,
  },
  reminderBtnText: { color: C.orange, fontFamily: 'DMSans_700Bold', fontSize: 11 },
  groupRosterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  groupRosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  attendanceBtn: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  attendanceBtnGhost: {
    backgroundColor: C.orangeSoft,
    borderColor: C.orangeBorder,
  },
  attendanceBtnText: {
    color: C.green,
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
  },
  // Gifts
  giftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  shakeOrderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  giftName: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium' },
  giftClient: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  giftTracking: { fontSize: 11, color: C.blue, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  giftStatusBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  giftStatusText: { fontSize: 11, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.3 },
  clientGiftSection: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, marginBottom: 14 },
  clientGiftName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 4 },
  shippingAddr: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginBottom: 8 },
  // Info card
  infoCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginBottom: 14 },
  infoCardText: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 20 },
  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold' },
  emptyBody: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', textAlign: 'center', paddingHorizontal: 20 },
  emptyStateBtn: { marginTop: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  emptyStateBtnText: { fontSize: 13, fontFamily: 'DMSans_700Bold' },
  // Msg chip on client card
  msgChip: { backgroundColor: 'rgba(99,102,241,0.18)', borderWidth: 1, borderColor: C.purple, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  msgChipText: { fontSize: 13 },
  // Coach message modal
  msgOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.75)' },
  msgModal: { backgroundColor: C.dark, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', flex: 1, marginTop: 80 },
  msgHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  msgAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  msgAvatarText: { color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 13 },
  msgClientName: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  msgClientEmail: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  msgCloseBtn: { padding: 6 },
  msgCloseTxt: { color: C.muted, fontSize: 16 },
  msgList: { flex: 1 },
  msgListContent: { padding: 14, gap: 4 },
  msgEmpty: { alignItems: 'center', paddingVertical: 40 },
  msgEmptyTxt: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 22 },
  msgBubbleWrap: { marginVertical: 3 },
  msgBubbleWrapRight: { alignItems: 'flex-end' },
  msgBubbleWrapLeft: { alignItems: 'flex-start' },
  msgBubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  msgBubbleCoach: { backgroundColor: C.green, borderBottomRightRadius: 4 },
  msgBubbleClient: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  msgBubbleText: { fontSize: 14, lineHeight: 20 },
  msgBubbleTextCoach: { color: '#000', fontFamily: 'DMSans_500Medium' },
  msgBubbleTextClient: { color: C.text, fontFamily: 'DMSans_400Regular' },
  msgTime: { fontSize: 10, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2, marginHorizontal: 4 },
  msgInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: C.border },
  msgInput: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, maxHeight: 100 },
  msgSendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  msgSendTxt: { color: '#000', fontSize: 18, fontFamily: 'DMSans_700Bold', marginTop: -2 },
  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  modal: { backgroundColor: C.dark, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '90%' },
  modalHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  clientModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  clientModalName: { fontSize: 18, color: C.text, fontFamily: 'DMSans_700Bold' },
  clientModalEmail: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  planSummaryRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  planSummaryChip: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, alignItems: 'center' },
  planSummaryChipLabel: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1, textTransform: 'uppercase' },
  planSummaryChipValue: { fontSize: 13, color: C.text, fontFamily: 'DMSans_700Bold', marginTop: 2 },
  progressTrack: { height: 5, backgroundColor: C.border, borderRadius: 3, marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: C.green, borderRadius: 3 },
  progressLabel: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginBottom: 14 },
  bonusRow: { backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 10, padding: 12, marginBottom: 14 },
  bonusText: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },
  liveCoachControlCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 16, padding: 14, marginBottom: 14 },
  liveCoachControlHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  liveCoachControlTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 3 },
  liveCoachControlBody: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 19 },
  liveCoachCountBadge: { minWidth: 56, borderRadius: 12, borderWidth: 1, borderColor: C.greenBorder, backgroundColor: C.greenSoft, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  liveCoachCountValue: { fontSize: 16, color: C.green, fontFamily: 'DMSans_700Bold' },
  liveCoachCountLabel: { fontSize: 9, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.8, marginTop: 2 },
  liveCoachButtonRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  liveCoachPrimaryBtn: { flex: 1.2, borderRadius: 12, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', paddingVertical: 13 },
  liveCoachPrimaryBtnText: { color: '#000', fontSize: 14, fontFamily: 'DMSans_700Bold' },
  liveCoachSecondaryBtn: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: C.blue, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, backgroundColor: 'rgba(56, 134, 255, 0.06)' },
  liveCoachSecondaryBtnText: { color: C.blue, fontSize: 13, fontFamily: 'DMSans_500Medium' },
  liveCoachControlHint: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 18 },
  coachQuickNavRow: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 14 },
  coachQuickNavBtn: { flex: 1, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 10 },
  coachQuickNavText: { fontSize: 13, fontFamily: 'DMSans_700Bold' },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, marginBottom: 14 },
  scheduleEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  scheduleRemoveBtn: { paddingHorizontal: 10, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: C.orangeBorder, backgroundColor: C.orangeSoft },
  scheduleRemoveText: { color: C.orange, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  linkCoachBtn: { backgroundColor: C.greenSoft, borderRadius: 10, borderWidth: 1, borderColor: C.greenBorder, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', marginBottom: 14 },
  linkCoachBtnText: { color: C.green, fontFamily: 'DMSans_700Bold', fontSize: 13 },
  modalBtnRow: { flexDirection: 'row', gap: 10, paddingTop: 10 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  btnGhostText: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  btnPrimary: { backgroundColor: C.green, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimaryText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 14 },

  // ── Detail tabs ────────────────────────────────────────────────────────────
  detailTabScroll: { marginBottom: 14 },
  detailTabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  detailTabBtnActive: { backgroundColor: 'rgba(0,255,135,0.12)', borderColor: C.green },
  studioCoachRow: { gap: 10 },
  studioCoachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  studioCoachAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  studioCandidateCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  studioCandidateImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    marginBottom: 10,
    backgroundColor: C.dark,
    resizeMode: 'cover',
  },
  studioBuiltInReferenceImage: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    marginBottom: 10,
    backgroundColor: C.dark,
  },
  studioCandidatePromptOnly: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  studioCandidatePromptOnlyText: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 12,
  },
  studioSavedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  studioSavedThumb: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: C.dark,
  },
  detailTabText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_500Medium' },
  detailTabTextActive: { color: C.green },

  // ── Client info grid (training tab) ────────────────────────────────────────
  clientInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  clientInfoCell: { width: '47%', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10 },
  clientInfoLabel: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1, marginBottom: 3 },
  clientInfoValue: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold' },

  // ── Health flag card ───────────────────────────────────────────────────────
  healthFlagCard: { backgroundColor: 'rgba(255,107,53,0.08)', borderWidth: 1, borderColor: 'rgba(255,107,53,0.25)', borderRadius: 10, padding: 12, marginBottom: 8 },
  healthFlagLabel: { fontSize: 9, color: C.orange, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1, marginBottom: 4 },
  healthFlagText: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular' },

  // ── Macro grid (nutrition tab) ─────────────────────────────────────────────
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  macroCell: { flex: 1, minWidth: '22%', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, alignItems: 'center' },
  macroValue: { fontSize: 18, color: C.text, fontFamily: 'BebasNeue_400Regular', letterSpacing: 1 },
  macroLabel: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1, marginTop: 2 },

  // ── Meal plan rows ─────────────────────────────────────────────────────────
  mealPlanRow: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, marginBottom: 8 },
  mealPlanTitle: { fontSize: 13, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 3 },
  mealPlanDesc: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },

  // ── Recent activity rows ───────────────────────────────────────────────────
  recentRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, marginBottom: 8 },
  recentTitle: { fontSize: 13, color: C.text, fontFamily: 'DMSans_500Medium', marginBottom: 2 },
  recentMeta: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular' },

  // ── Grocery list ──────────────────────────────────────────────────────────
  groceryHeader: { backgroundColor: 'rgba(0,255,135,0.06)', borderWidth: 1, borderColor: C.greenBorder, borderRadius: 12, padding: 14, marginBottom: 14 },
  groceryHeaderTitle: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 3 },
  groceryHeaderSub: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  grocerySection: { marginBottom: 14 },
  groceryCat: { fontSize: 13, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 8 },
  groceryItemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.border },
  groceryBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  groceryItem: { fontSize: 13, color: C.text, fontFamily: 'DMSans_400Regular', flex: 1 },
  assistantSummaryCard: {
    backgroundColor: 'rgba(0,255,135,0.08)',
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  assistantSummaryLabel: {
    fontSize: 9,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 1,
    marginBottom: 6,
  },
  assistantSummaryText: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    lineHeight: 21,
  },
  assistantSection: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  assistantSectionTitle: {
    fontSize: 13,
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    marginBottom: 8,
  },
  assistantBullet: {
    fontSize: 13,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 20,
    marginBottom: 4,
  },

  // ── Demo / empty states ────────────────────────────────────────────────────
  demoNote: { backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)', borderRadius: 10, padding: 12, marginTop: 8 },
  demoNoteText: { fontSize: 12, color: C.blue, fontFamily: 'DMSans_400Regular' },
  emptyTabText: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular', textAlign: 'center', paddingVertical: 20 },

  // ── Live Dashboard (full-screen client command center) ─────────────────────
  ldScreen: { flex: 1, backgroundColor: C.black },
  ldHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  ldBackBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  ldBackBtnText: { color: C.text, fontSize: 18, fontFamily: 'DMSans_500Medium', lineHeight: 22 },
  ldHeaderName: { fontSize: 17, color: C.text, fontFamily: 'DMSans_700Bold' },
  ldHeaderEmail: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  ldProgressBadge: { alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  ldProgressBadgeLabel: { fontSize: 8, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1 },
  ldProgressBadgeValue: { fontSize: 15, color: C.green, fontFamily: 'DMSans_700Bold', marginTop: 1 },

  ldStatRow: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 10 },
  ldStatCell: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, alignItems: 'center' },
  ldStatValue: { fontSize: 14, color: C.text, fontFamily: 'DMSans_700Bold', textAlign: 'center' },
  ldStatLabel: { fontSize: 8, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.8, marginTop: 3, textAlign: 'center' },

  ldHeroCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 18, padding: 18, marginBottom: 20 },
  ldLiveStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  ldLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  ldLiveStatusText: { fontSize: 10, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.2 },
  ldSessionCountChip: { marginLeft: 'auto' as any, backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  ldSessionCountText: { fontSize: 10, color: C.green, fontFamily: 'DMSans_500Medium' },
  ldHeroSessionTime: { fontSize: 20, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 16, lineHeight: 26 },
  ldStartLiveBtn: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  ldStartLiveBtnText: { color: '#000', fontSize: 16, fontFamily: 'DMSans_700Bold', letterSpacing: 0.3 },
  ldRemindBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  ldRemindBtnText: { color: C.muted, fontSize: 13, fontFamily: 'DMSans_500Medium' },

  ldSectionHeading: { fontSize: 11, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 },

  ldFooter: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  ldSaveBtn: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ldSaveBtnText: { color: '#000', fontSize: 15, fontFamily: 'DMSans_700Bold' },

  settingsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, padding: 16, marginBottom: 10,
  },
  settingsRowTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  settingsRowSub: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 2 },
  settingsInfoCard: {
    backgroundColor: 'rgba(14,165,233,0.08)', borderWidth: 1, borderColor: 'rgba(14,165,233,0.2)',
    borderRadius: 12, padding: 14, marginBottom: 10,
  },
  settingsInfoText: { fontSize: 13, color: '#0EA5E9', fontFamily: 'DMSans_400Regular', lineHeight: 20 },

  wwResetBtn: {
    backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 10,
  },
  wwResetBtnText: { fontSize: 13, color: '#EF4444', fontFamily: 'DMSans_700Bold', fontWeight: '700' },
});
