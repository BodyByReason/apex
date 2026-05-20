/**
 * liveCoaching.ts
 *
 * Data types and AsyncStorage helpers for the Live Coaching feature.
 * Designed to map 1-to-1 with a future Supabase schema.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { env } from '@/lib/env';

// ─── Fit Call ─────────────────────────────────────────────────────────────────

export type FitCallStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';

export type FitCallBooking = {
  id: string;
  clientName: string;
  clientPhone: string;
  challenge: string;
  sessionDate: string;  // YYYY-MM-DD
  sessionTime: string;  // HH:MM
  status: FitCallStatus;
  createdAt: string;
};

export const FIT_CALL_STORAGE_KEY = '@apex_fit_call_booking';

export async function saveFitCallBookingLocally(booking: FitCallBooking): Promise<void> {
  await AsyncStorage.setItem(FIT_CALL_STORAGE_KEY, JSON.stringify(booking));
}

export async function loadFitCallBooking(): Promise<FitCallBooking | null> {
  try {
    const raw = await AsyncStorage.getItem(FIT_CALL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FitCallBooking) : null;
  } catch {
    return null;
  }
}

/**
 * Format a fit call slot for display.
 * Input: "14:30" → "2:30 PM"
 */
export function formatFitCallTime(time: string | undefined | null): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return time;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Format a fit call date for display.
 * Input: "2024-01-15" → "Mon, Jan 15"
 */
export function formatFitCallDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T12:00:00`);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

export const COACHING_PLAN_KEY = '@apex_coaching_plan';
export const COACHING_SESSIONS_KEY = '@apex_coaching_sessions';
export const COACHING_BONUS_KEY = '@apex_coaching_bonus';
export const COACH_CLIENTS_KEY = '@apex_coach_clients';

// ─── Pricing ──────────────────────────────────────────────────────────────────

export const SESSION_PACKAGES = [
  { id: '1x', sessionType: '1on1', sessionsPerWeek: 1, weeklyPrice: 125, label: '1 Session / Week' },
  { id: '2x', sessionType: '1on1', sessionsPerWeek: 2, weeklyPrice: 225, label: '2 Sessions / Week' },
  { id: '3x', sessionType: '1on1', sessionsPerWeek: 3, weeklyPrice: 300, label: '3 Sessions / Week' },
  { id: 'group-dropin', sessionType: 'group', sessionsPerWeek: 1, weeklyPrice: 50, label: 'Group Coaching Drop-In' },
] as const;

export type PackageId = typeof SESSION_PACKAGES[number]['id'];

export const DURATION_OPTIONS = [
  {
    id: 'weekly',
    label: 'Weekly',
    subtitle: 'Pay as you go',
    weeks: 1,
    savingsAmount: 0,
    bonuses: [] as string[],
    giftItems: [] as string[],
  },
  {
    id: '3month',
    label: '3 Months',
    subtitle: 'Best value',
    weeks: 12,
    savingsAmount: 500,
    bonuses: [
      '3× Extra Group Workouts (convertible to 1-on-1)',
      '3× Extra 1-on-1 or Foam Rolling / Mobility / Stretching session',
    ],
    giftItems: ['Foam Roller or Massage Gun', 'Water Bottle', 'Hat'],
  },
  {
    id: '12month',
    label: '12 Months',
    subtitle: 'Ultimate commitment',
    weeks: 48,
    savingsAmount: 1500,
    bonuses: [
      '12× Extra Group Workouts (convertible to 1-on-1)',
      '12× Extra 1-on-1 or Foam Rolling / Mobility / Stretching session',
    ],
    giftItems: [
      'Foam Roller or Massage Gun',
      'Water Bottle',
      'Hat',
      'Mindset & Identity Notebook',
      '30-day Supply of Supplements',
    ],
  },
] as const;

export type DurationId = typeof DURATION_OPTIONS[number]['id'];

export const GROUP_DURATION_OPTIONS = [
  {
    id: 'weekly',
    label: 'Weekly',
    subtitle: '$50 drop-in access',
    weeks: 1,
    savingsAmount: 0,
    bonuses: [
      'Weekly live group coaching room access',
    ],
    giftItems: [] as string[],
  },
  {
    id: '3month',
    label: '3 Months',
    subtitle: 'Stay in the room and save',
    weeks: 12,
    savingsAmount: 120,
    bonuses: [
      'Priority hot-seat opportunities',
      'Monthly group challenge pack',
      'Replay vault access while active',
    ],
    giftItems: [] as string[],
  },
  {
    id: '12month',
    label: 'Annual',
    subtitle: 'Best long-term rate',
    weeks: 48,
    savingsAmount: 600,
    bonuses: [
      'VIP hot-seat priority',
      'Quarterly performance review week',
      'Replay vault + annual challenge bundle',
    ],
    giftItems: [] as string[],
  },
] as const;

export function getPackageById(packageId: PackageId) {
  return SESSION_PACKAGES.find((p) => p.id === packageId) ?? null;
}

export function getDurationOptionsForSessionType(sessionType: SessionType) {
  return sessionType === 'group' ? GROUP_DURATION_OPTIONS : DURATION_OPTIONS;
}

export function getDurationOptionForPackage(packageId: PackageId, durationId: DurationId) {
  const pkg = getPackageById(packageId);
  const options = getDurationOptionsForSessionType(pkg?.sessionType ?? '1on1');
  return options.find((d) => d.id === durationId) ?? null;
}

export function calcPrice(packageId: PackageId, durationId: DurationId): number {
  const pkg = getPackageById(packageId)!;
  const dur = getDurationOptionForPackage(packageId, durationId)!;
  const gross = pkg.weeklyPrice * dur.weeks;
  return gross - dur.savingsAmount;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionType = '1on1' | 'group' | 'mobility';
export type SessionStatus = 'upcoming' | 'completed' | 'cancelled' | 'rescheduled';
export type RecurrencePreference = 'monthly_fixed' | 'change_next_week' | 'schedule_later';
export type SessionScheduleSlot = {
  date: string;
  time: string;
  type: SessionType;
  joinUrl?: string;
  startUrl?: string;
  liveSessionId?: string;
  zoomMeetingId?: string;
  zoomMeetingUuid?: string;
};

export type SessionAttendanceRecord = {
  date: string;
  time: string;
  status: 'present' | 'absent';
  markedAt: string;
};

export type CoachingSession = {
  id: string;
  date: string;       // ISO date string YYYY-MM-DD
  time: string;       // "HH:MM"
  type: SessionType;
  status: SessionStatus;
  notes?: string;
  joinUrl?: string;   // Daily.co or Zoom link
  startUrl?: string;
  liveSessionId?: string;
  zoomMeetingId?: string;
  zoomMeetingUuid?: string;
};

export type GiftStatus = 'pending' | 'processing' | 'shipped' | 'delivered';

export type GiftItem = {
  id: string;
  name: string;
  status: GiftStatus;
  trackingNumber?: string;
  shippedAt?: string;
  deliveredAt?: string;
};

export type BonusTracker = {
  extraSessionsTotal: number;       // e.g. 3 for 3-month plan
  extraSessionsUsed: number;
  extraSessionType: '1on1' | 'group' | 'mobility';   // user's preference
  gifts: GiftItem[];
  shippingAddress?: string;
};

export type ActiveCoachingPlan = {
  id: string;
  packageId: PackageId;
  durationId: DurationId;
  sessionType?: SessionType;
  startDate: string;    // ISO date
  endDate: string;      // ISO date
  totalPaid: number;
  status: 'active' | 'paused' | 'cancelled' | 'completed';
  nextSessionDate?: string;
  nextSessionTime?: string;
  bookingRecurrence: 'weekly' | 'custom';
  recurrencePreference?: RecurrencePreference;
  /** Free-trial flag: first 2 weeks are $0, then regular pricing */
  isTrial?: boolean;
  /** ISO date when the free trial period ends */
  trialEndsDate?: string;
};

// Coach-side: client record
export type ClientProfile = {
  goal: string;
  experience: string;
  currentWeightLbs?: number;
  goalWeightLbs?: number;
  heightIn?: number;
  age?: number;
  dailyCalories?: number;
  dailyProtein?: number;
  activePlan?: string;
  healthConditions?: string;
  equipment?: string;
  medications?: string;
};

export type CoachClient = {
  id: string;
  name: string;
  email: string;
  packageId: PackageId;
  durationId: DurationId;
  startDate: string;
  nextSession?: string;  // ISO datetime
  sessionType: SessionType;
  totalSessions: number;
  completedSessions: number;
  bonus: BonusTracker;
  notes?: string;
  clientProfile?: ClientProfile;
  recurrencePreference?: RecurrencePreference;
  sessionSchedule?: SessionScheduleSlot[];
  sessionAttendance?: SessionAttendanceRecord[];
  liveCoachingCount?: number;
  lastLiveSessionAt?: string;
};

function dedupeUrls(urls: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return urls
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url))
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function parseZoomMeetingParts(rawUrl?: string) {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl.trim());
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const meetingId = pathParts[pathParts.length - 1] ?? '';
    const pwd = parsed.searchParams.get('pwd') ?? undefined;
    const zak = parsed.searchParams.get('zak') ?? undefined;

    if (!meetingId) return null;

    return {
      meetingId,
      pwd,
      zak,
    };
  } catch {
    return null;
  }
}

function buildZoomNativeJoinUrl(rawUrl?: string) {
  const parts = parseZoomMeetingParts(rawUrl);
  if (!parts?.meetingId) return null;

  const query = [
    `confno=${encodeURIComponent(parts.meetingId)}`,
    parts.pwd ? `pwd=${encodeURIComponent(parts.pwd)}` : null,
  ].filter(Boolean).join('&');

  return `zoomus://zoom.us/join?${query}`;
}

function buildZoomNativeStartUrl(startUrl?: string, joinUrl?: string) {
  const startParts = parseZoomMeetingParts(startUrl);
  const fallbackParts = parseZoomMeetingParts(joinUrl);
  const meetingId = startParts?.meetingId ?? fallbackParts?.meetingId;
  const pwd = startParts?.pwd ?? fallbackParts?.pwd;
  const zak = startParts?.zak;

  if (!meetingId) return null;

  const query = [
    `confno=${encodeURIComponent(meetingId)}`,
    zak ? `zak=${encodeURIComponent(zak)}` : null,
    pwd ? `pwd=${encodeURIComponent(pwd)}` : null,
  ].filter(Boolean).join('&');

  return `zoomus://zoom.us/start?${query}`;
}

export function getSessionJoinUrl(joinUrl?: string) {
  return joinUrl?.trim() || env.zoomJoinUrl || 'https://zoom.us/join';
}

export function getCoachSessionUrl(startUrl?: string, joinUrl?: string) {
  return startUrl?.trim() || getSessionJoinUrl(joinUrl);
}

export function getPreferredSessionJoinUrls(joinUrl?: string) {
  return dedupeUrls([
    buildZoomNativeJoinUrl(joinUrl),
    getSessionJoinUrl(joinUrl),
  ]);
}

export function getPreferredCoachSessionUrls(startUrl?: string, joinUrl?: string) {
  return dedupeUrls([
    getCoachSessionUrl(startUrl, joinUrl),
    buildZoomNativeStartUrl(startUrl, joinUrl),
    buildZoomNativeJoinUrl(joinUrl),
  ]);
}

async function openUrlSequence(urls: string[]) {
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Could not open Zoom link.');
}

export async function openZoomSessionForClient(joinUrl?: string) {
  return openUrlSequence(getPreferredSessionJoinUrls(joinUrl));
}

export async function openZoomSessionForCoach(startUrl?: string, joinUrl?: string) {
  return openUrlSequence(getPreferredCoachSessionUrls(startUrl, joinUrl));
}

export function getCoachSchedulingUrl() {
  return env.coachSchedulingUrl || 'https://calendly.com/';
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

export async function getActivePlan(): Promise<ActiveCoachingPlan | null> {
  const raw = await AsyncStorage.getItem(COACHING_PLAN_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as ActiveCoachingPlan) : null;
}

export async function saveActivePlan(plan: ActiveCoachingPlan): Promise<void> {
  await AsyncStorage.setItem(COACHING_PLAN_KEY, JSON.stringify(plan));
}

export async function clearActivePlan(): Promise<void> {
  await AsyncStorage.removeItem(COACHING_PLAN_KEY);
}

export async function getSessions(): Promise<CoachingSession[]> {
  const raw = await AsyncStorage.getItem(COACHING_SESSIONS_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as CoachingSession[]) : [];
}

export async function addSession(session: CoachingSession): Promise<void> {
  const existing = await getSessions();
  await AsyncStorage.setItem(COACHING_SESSIONS_KEY, JSON.stringify([...existing, session]));
}

export async function updateSession(id: string, updates: Partial<CoachingSession>): Promise<void> {
  const existing = await getSessions();
  const updated = existing.map((s) => (s.id === id ? { ...s, ...updates } : s));
  await AsyncStorage.setItem(COACHING_SESSIONS_KEY, JSON.stringify(updated));
}

export async function getBonusTracker(): Promise<BonusTracker | null> {
  const raw = await AsyncStorage.getItem(COACHING_BONUS_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as BonusTracker) : null;
}

export async function saveBonusTracker(bonus: BonusTracker): Promise<void> {
  await AsyncStorage.setItem(COACHING_BONUS_KEY, JSON.stringify(bonus));
}

// Coach-side
export async function getCoachClients(): Promise<CoachClient[]> {
  const raw = await AsyncStorage.getItem(COACH_CLIENTS_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as CoachClient[]) : [];
}

export async function saveCoachClients(clients: CoachClient[]): Promise<void> {
  await AsyncStorage.setItem(COACH_CLIENTS_KEY, JSON.stringify(clients));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDuration(durationId: DurationId): string {
  const d = DURATION_OPTIONS.find((o) => o.id === durationId) ?? GROUP_DURATION_OPTIONS.find((o) => o.id === durationId);
  if (!d) return '';
  if (durationId === 'weekly') return 'per week';
  return `every ${d.weeks} weeks`;
}

export function buildBonusTrackerFromPlan(
  packageId: PackageId,
  durationId: DurationId,
  sessionType: SessionType = '1on1',
): BonusTracker | null {
  const dur = getDurationOptionsForSessionType(sessionType).find((d) => d.id === durationId);
  if (!dur || durationId === 'weekly') return null;
  if (sessionType === 'group') {
    return {
      extraSessionsTotal: 0,
      extraSessionsUsed: 0,
      extraSessionType: 'group',
      gifts: [],
    };
  }
  const extraCount = durationId === '3month' ? 3 : 12;
  return {
    extraSessionsTotal: extraCount,
    extraSessionsUsed: 0,
    extraSessionType: '1on1',
    gifts: dur.giftItems.map((name, i) => ({
      id: `gift-${i}`,
      name,
      status: 'pending',
    })),
  };
}

export function getDaysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((target.getTime() - now.getTime()) / 86400000));
}

export function formatSessionDate(dateStr: string, timeStr: string): string {
  const d = new Date(`${dateStr}T${timeStr}`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function buildRecurringSessions(input: {
  durationWeeks: number;
  recurrencePreference: RecurrencePreference;
  selectedSlots: Array<{ date: string; time: string; type?: SessionType }>;
}): CoachingSession[] {
  const { durationWeeks, recurrencePreference, selectedSlots } = input;
  const baseSlots = [...selectedSlots]
    .filter((slot) => slot.date && slot.time)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  const weeksToGenerate =
    recurrencePreference === 'monthly_fixed'
      ? Math.min(durationWeeks, 4)
      : 1;

  const sessions: CoachingSession[] = [];
  baseSlots.forEach((slot, slotIndex) => {
    for (let week = 0; week < weeksToGenerate; week += 1) {
      const sessionDate = new Date(`${slot.date}T12:00:00`);
      sessionDate.setDate(sessionDate.getDate() + week * 7);
      sessions.push({
        id: `session-${slotIndex}-${week}-${Date.now()}`,
        date: sessionDate.toISOString().slice(0, 10),
        time: slot.time,
        type: slot.type ?? '1on1',
        status: 'upcoming',
      });
    }
  });

  return sessions.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}
