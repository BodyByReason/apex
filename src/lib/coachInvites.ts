import { supabase } from '@/lib/supabase';
import type {
  BonusTracker,
  CoachClient,
  DurationId,
  PackageId,
  RecurrencePreference,
  SessionAttendanceRecord,
  SessionScheduleSlot,
  SessionType,
} from '@/lib/liveCoaching';

export type CoachInvite = {
  id: string;
  code: string;
  status: 'active' | 'redeemed' | 'expired' | 'cancelled';
  expiresAt: string;
  redeemedByUserId?: string | null;
  redeemedAt?: string | null;
  createdAt: string;
};

export type LinkedCoach = {
  bio?: string | null;
  coachUserId: string;
  displayName: string;
  isCoach?: boolean;
  selectedTitle?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
};

type CoachClientRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  goal: string | null;
  experience: string | null;
  active_plan_id: string | null;
  weight_lbs: number | null;
  goal_weight_lbs: number | null;
  age: number | null;
  daily_calorie_target: number | null;
  daily_protein: number | null;
  health_conditions: string | null;
  medications: string | null;
  equipment: string | null;
  package_id: string | null;
  duration_id: string | null;
  session_type: string | null;
  start_date: string | null;
  next_session: string | null;
  total_sessions: number | null;
  completed_sessions: number | null;
  notes: string | null;
  bonus: BonusTracker | null;
  link_status: string | null;
  session_schedule: SessionScheduleSlot[] | null;
  session_attendance: SessionAttendanceRecord[] | null;
  recurrence_preference: RecurrencePreference | null;
  live_coaching_count?: number | null;
  last_live_session_at?: string | null;
};

function fallbackBonus(): BonusTracker {
  return {
    extraSessionsTotal: 0,
    extraSessionsUsed: 0,
    extraSessionType: '1on1',
    gifts: [],
  };
}

function titleCase(input?: string | null): string {
  if (!input) return '—';
  return input
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildCoachClient(row: CoachClientRow): CoachClient {
  const schedule = row.session_schedule ?? [];
  const fallbackNextSession = schedule[0] ? `${schedule[0].date}T${schedule[0].time}:00` : undefined;
  return {
    id: row.user_id,
    name: row.display_name || row.username || row.email || 'APEX Client',
    email: row.email || row.username || 'client@apex.app',
    packageId: (row.package_id as PackageId | null) ?? '1x',
    durationId: (row.duration_id as DurationId | null) ?? 'weekly',
    startDate: row.start_date ?? new Date().toISOString().split('T')[0],
    nextSession: row.next_session ?? fallbackNextSession,
    sessionType: (row.session_type as SessionType | null) ?? '1on1',
    totalSessions: row.total_sessions ?? 0,
    completedSessions: row.completed_sessions ?? 0,
    notes: row.notes ?? (row.link_status === 'linked' ? 'Invite redeemed. Waiting for the client to book their first live coaching package.' : undefined),
    bonus: row.bonus ?? fallbackBonus(),
    sessionSchedule: schedule,
    sessionAttendance: row.session_attendance ?? [],
    recurrencePreference: row.recurrence_preference ?? undefined,
    liveCoachingCount: row.live_coaching_count ?? 0,
    lastLiveSessionAt: row.last_live_session_at ?? undefined,
    clientProfile: {
      goal: titleCase(row.goal),
      experience: titleCase(row.experience),
      currentWeightLbs: row.weight_lbs ?? undefined,
      goalWeightLbs: row.goal_weight_lbs ?? undefined,
      age: row.age ?? undefined,
      dailyCalories: row.daily_calorie_target ?? undefined,
      dailyProtein: row.daily_protein ?? undefined,
      activePlan: titleCase(row.active_plan_id),
      healthConditions: row.health_conditions ?? undefined,
      equipment: row.equipment ?? undefined,
      medications: row.medications ?? undefined,
    },
  };
}

export async function createCoachInvite(expiresInHours = 168): Promise<CoachInvite> {
  const { data, error } = await supabase.rpc('create_coach_invite', { p_expires_in_hours: expiresInHours });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Could not create invite');
  return {
    id: row.id,
    code: row.code,
    status: 'active',
    expiresAt: row.expires_at,
    createdAt: new Date().toISOString(),
  };
}

export async function getCoachInvites(): Promise<CoachInvite[]> {
  const { data, error } = await supabase.rpc('get_my_coach_invites');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    code: row.code,
    status: row.status,
    expiresAt: row.expires_at,
    redeemedByUserId: row.redeemed_by_user_id,
    redeemedAt: row.redeemed_at,
    createdAt: row.created_at,
  }));
}

export async function redeemCoachInvite(code: string): Promise<LinkedCoach> {
  const { data, error } = await supabase.rpc('redeem_coach_invite', { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Could not redeem coach invite');
  return {
    coachUserId: row.coach_user_id,
    bio: row.coach_bio ?? null,
    displayName: row.coach_display_name,
    isCoach: row.coach_is_coach ?? true,
    selectedTitle: row.coach_selected_title ?? null,
    username: row.coach_username,
    avatarUrl: row.coach_avatar_url,
  };
}

export async function getLinkedCoach(): Promise<LinkedCoach | null> {
  const { data, error } = await supabase.rpc('get_my_linked_coach');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    coachUserId: row.coach_user_id,
    bio: row.coach_bio ?? null,
    displayName: row.coach_display_name,
    isCoach: row.coach_is_coach ?? true,
    selectedTitle: row.coach_selected_title ?? null,
    username: row.coach_username,
    avatarUrl: row.coach_avatar_url,
  };
}

export async function getCoachClients(): Promise<CoachClient[]> {
  const { data, error } = await supabase.rpc('get_my_coach_clients');
  if (error) throw error;
  return (data ?? []).map((row: CoachClientRow) => buildCoachClient(row));
}

export async function upsertCoachClientLink(input: {
  coachUserId: string;
  clientUserId: string;
  packageId?: PackageId;
  durationId?: DurationId;
  sessionType?: SessionType;
  startDate?: string;
  nextSession?: string;
  totalSessions?: number;
  completedSessions?: number;
  notes?: string | null;
  bonus?: BonusTracker | null;
  status?: 'linked' | 'active' | 'paused' | 'cancelled' | 'completed';
  sessionSchedule?: SessionScheduleSlot[];
  sessionAttendance?: SessionAttendanceRecord[];
  recurrencePreference?: RecurrencePreference;
}): Promise<string | null> {
  const payload = {
    coach_user_id: input.coachUserId,
    client_user_id: input.clientUserId,
    package_id: input.packageId ?? null,
    duration_id: input.durationId ?? null,
    session_type: input.sessionType ?? null,
    start_date: input.startDate ?? null,
    next_session: input.nextSession ?? null,
    total_sessions: input.totalSessions ?? 0,
    completed_sessions: input.completedSessions ?? 0,
    notes: input.notes ?? null,
    bonus: input.bonus ?? fallbackBonus(),
    status: input.status ?? 'linked',
    session_schedule: input.sessionSchedule ?? [],
    session_attendance: input.sessionAttendance ?? [],
    recurrence_preference: input.recurrencePreference ?? null,
  };

  const { data, error } = await supabase
    .from('coach_client_links')
    .upsert(payload, { onConflict: 'client_user_id' })
    .select('id')
    .single();

  if (error) throw error;
  return data?.id ?? null;
}

export async function updateCoachClientLink(clientUserId: string, updates: {
  nextSession?: string | null;
  notes?: string | null;
  bonus?: BonusTracker | null;
  completedSessions?: number | null;
  status?: 'linked' | 'active' | 'paused' | 'cancelled' | 'completed';
  sessionSchedule?: SessionScheduleSlot[];
  sessionAttendance?: SessionAttendanceRecord[];
  recurrencePreference?: RecurrencePreference | null;
}): Promise<void> {
  const payload: Record<string, unknown> = {};
  if ('nextSession' in updates) payload.next_session = updates.nextSession ?? null;
  if ('notes' in updates) payload.notes = updates.notes ?? null;
  if ('bonus' in updates && updates.bonus) payload.bonus = updates.bonus;
  if ('completedSessions' in updates) payload.completed_sessions = updates.completedSessions ?? 0;
  if ('status' in updates && updates.status) payload.status = updates.status;
  if ('sessionSchedule' in updates) payload.session_schedule = updates.sessionSchedule ?? [];
  if ('sessionAttendance' in updates) payload.session_attendance = updates.sessionAttendance ?? [];
  if ('recurrencePreference' in updates) payload.recurrence_preference = updates.recurrencePreference ?? null;

  const { error } = await supabase
    .from('coach_client_links')
    .update(payload)
    .eq('client_user_id', clientUserId);

  if (error) throw error;
}
