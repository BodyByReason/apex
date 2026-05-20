import { supabase } from '@/lib/supabase';
import type { CoachingSession, SessionScheduleSlot } from '@/lib/liveCoaching';

export type PersistedLiveCoachingSession = {
  id: string;
  zoom_meeting_id: string | null;
  zoom_meeting_uuid: string | null;
  zoom_join_url: string | null;
  zoom_start_url: string | null;
  scheduled_start: string | null;
  status: 'scheduled' | 'live' | 'completed' | 'canceled' | 'failed';
};

type ScheduleInput = {
  coachUserId: string;
  clientUserId: string;
  coachClientLinkId: string;
  bookedSessions: CoachingSession[];
  sessionSchedule: SessionScheduleSlot[];
};

export async function createScheduledLiveCoachingSessions({
  coachUserId,
  clientUserId,
  coachClientLinkId,
  bookedSessions,
  sessionSchedule,
}: ScheduleInput): Promise<{
  bookedSessions: CoachingSession[];
  sessionSchedule: SessionScheduleSlot[];
}> {
  const nextBookedSessions = [...bookedSessions];
  const nextSchedule = [...sessionSchedule];

  for (let index = 0; index < bookedSessions.length; index += 1) {
    const booked = bookedSessions[index];
    const scheduledStart = new Date(`${booked.date}T${booked.time}:00`).toISOString();

    const payload = {
      coach_user_id: coachUserId,
      client_user_id: clientUserId,
      coach_client_link_id: coachClientLinkId,
      zoom_meeting_id: booked.zoomMeetingId ?? null,
      zoom_meeting_uuid: booked.zoomMeetingUuid ?? null,
      zoom_join_url: booked.joinUrl ?? null,
      zoom_start_url: booked.startUrl ?? null,
      status: 'scheduled' as const,
      scheduled_start: scheduledStart,
      scheduled_via: 'custom_time' as const,
      metadata: {
        source: 'mobile_purchase_flow',
        sessionType: booked.type,
      },
    };

    const { data, error } = await supabase
      .from('live_coaching_sessions')
      .insert(payload)
      .select('id, zoom_meeting_id, zoom_meeting_uuid, zoom_join_url, zoom_start_url, scheduled_start, status')
      .single<PersistedLiveCoachingSession>();

    if (error) {
      throw error;
    }

    nextBookedSessions[index] = {
      ...booked,
      liveSessionId: data.id,
      joinUrl: data.zoom_join_url ?? booked.joinUrl,
      startUrl: data.zoom_start_url ?? booked.startUrl,
      zoomMeetingId: data.zoom_meeting_id ?? booked.zoomMeetingId,
      zoomMeetingUuid: data.zoom_meeting_uuid ?? booked.zoomMeetingUuid,
    };

    nextSchedule[index] = {
      ...nextSchedule[index],
      liveSessionId: data.id,
      joinUrl: data.zoom_join_url ?? nextSchedule[index]?.joinUrl,
      startUrl: data.zoom_start_url ?? nextSchedule[index]?.startUrl,
      zoomMeetingId: data.zoom_meeting_id ?? nextSchedule[index]?.zoomMeetingId,
      zoomMeetingUuid: data.zoom_meeting_uuid ?? nextSchedule[index]?.zoomMeetingUuid,
    };
  }

  return {
    bookedSessions: nextBookedSessions,
    sessionSchedule: nextSchedule,
  };
}

export async function completeLiveCoachingSession(sessionId: string) {
  const { data, error } = await supabase.rpc('complete_live_coaching_session', {
    p_session_id: sessionId,
  });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data[0] ?? null : data;
}
