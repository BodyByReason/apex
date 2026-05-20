import { supabase } from '@/lib/supabase';

export type TribeLiveSession = {
  id: string;
  coachId: string;
  coachName: string;
  coachAvatarUrl?: string;
  title: string;
  status: 'live' | 'ended';
  livekitRoomName: string;
  viewerCount: number;
  startedAt: string;
  endedAt?: string;
  videoUrl?: string;
};

export type TribeLiveComment = {
  id: string;
  sessionId: string;
  userId: string;
  authorName: string;
  authorAvatarUrl?: string;
  authorIsCoach: boolean;
  body: string;
  createdAt: string;
};

export type TribeLiveJoinRequest = {
  id: string;
  sessionId: string;
  userId: string;
  requesterName: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
};

type SessionRow = {
  id: string;
  coach_id: string;
  coach_name: string;
  coach_avatar_url: string | null;
  title: string;
  status: string;
  livekit_room_name: string;
  viewer_count: number;
  started_at: string;
  ended_at: string | null;
  video_url?: string | null;
};

type CommentRow = {
  id: string;
  session_id: string;
  user_id: string;
  author_name: string;
  author_avatar_url: string | null;
  author_is_coach: boolean;
  body: string;
  created_at: string;
};

type JoinRequestRow = {
  id: string;
  session_id: string;
  user_id: string;
  requester_name: string;
  status: string;
  created_at: string;
};

function rowToSession(row: SessionRow): TribeLiveSession {
  return {
    id: row.id,
    coachId: row.coach_id,
    coachName: row.coach_name,
    coachAvatarUrl: row.coach_avatar_url ?? undefined,
    title: row.title,
    status: row.status as TribeLiveSession['status'],
    livekitRoomName: row.livekit_room_name,
    viewerCount: row.viewer_count,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    videoUrl: row.video_url ?? undefined,
  };
}

function rowToComment(row: CommentRow): TribeLiveComment {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    authorName: row.author_name,
    authorAvatarUrl: row.author_avatar_url ?? undefined,
    authorIsCoach: row.author_is_coach,
    body: row.body,
    createdAt: row.created_at,
  };
}

function rowToJoinRequest(row: JoinRequestRow): TribeLiveJoinRequest {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    requesterName: row.requester_name,
    status: row.status as TribeLiveJoinRequest['status'],
    createdAt: row.created_at,
  };
}

export async function fetchActiveSession(): Promise<TribeLiveSession | null> {
  const { data, error } = await supabase
    .from('tribe_live_sessions')
    .select('*')
    .eq('status', 'live')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToSession(data as SessionRow);
}

export async function fetchLatestEndedSessionWithRecording(): Promise<TribeLiveSession | null> {
  const { data, error } = await supabase
    .from('tribe_live_sessions')
    .select('*')
    .eq('status', 'ended')
    .not('video_url', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToSession(data as SessionRow);
}

export async function fetchEvergreenReplaySession(): Promise<TribeLiveSession | null> {
  const { data, error } = await supabase
    .from('tribe_live_sessions')
    .select('*')
    .eq('status', 'ended')
    .not('video_url', 'is', null)
    .order('ended_at', { ascending: true })
    .limit(10);
  if (error || !data || data.length === 0) return null;

  const sessions = (data as SessionRow[]).map(rowToSession);
  const preferred = sessions.find((session) =>
    /day 3|group workout|finale|live workout/i.test(session.title || ''),
  );
  return preferred ?? sessions[0] ?? null;
}

export async function createLiveSession(params: {
  coachId: string;
  coachName: string;
  coachAvatarUrl?: string;
  title: string;
}): Promise<TribeLiveSession> {
  const roomName = `tribe-live-${params.coachId}-${Date.now()}`;
  const { data, error } = await supabase
    .from('tribe_live_sessions')
    .insert({
      coach_id: params.coachId,
      coach_name: params.coachName,
      coach_avatar_url: params.coachAvatarUrl ?? null,
      title: params.title,
      status: 'live',
      livekit_room_name: roomName,
      viewer_count: 0,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to create session');
  return rowToSession(data as SessionRow);
}

export async function endLiveSession(sessionId: string): Promise<void> {
  await supabase
    .from('tribe_live_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function incrementViewerCount(sessionId: string, delta: 1 | -1): Promise<void> {
  await supabase.rpc('increment_viewer_count', { session_id: sessionId, delta });
}

export async function fetchComments(sessionId: string): Promise<TribeLiveComment[]> {
  const { data, error } = await supabase
    .from('tribe_live_comments')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error || !data) return [];
  return (data as CommentRow[]).map(rowToComment);
}

export async function postComment(params: {
  sessionId: string;
  userId: string;
  authorName: string;
  authorAvatarUrl?: string;
  authorIsCoach: boolean;
  body: string;
}): Promise<void> {
  await supabase.from('tribe_live_comments').insert({
    session_id: params.sessionId,
    user_id: params.userId,
    author_name: params.authorName,
    author_avatar_url: params.authorAvatarUrl ?? null,
    author_is_coach: params.authorIsCoach,
    body: params.body,
  });
}

export async function fetchJoinRequests(sessionId: string): Promise<TribeLiveJoinRequest[]> {
  const { data, error } = await supabase
    .from('tribe_live_join_requests')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as JoinRequestRow[]).map(rowToJoinRequest);
}

export async function sendJoinRequest(params: {
  sessionId: string;
  userId: string;
  requesterName: string;
}): Promise<void> {
  await supabase.from('tribe_live_join_requests').upsert({
    session_id: params.sessionId,
    user_id: params.userId,
    requester_name: params.requesterName,
    status: 'pending',
  });
}

export async function updateJoinRequestStatus(
  requestId: string,
  status: 'approved' | 'denied',
): Promise<void> {
  await supabase
    .from('tribe_live_join_requests')
    .update({ status })
    .eq('id', requestId);
}

export async function fetchMyJoinRequest(
  sessionId: string,
  userId: string,
): Promise<TribeLiveJoinRequest | null> {
  const { data, error } = await supabase
    .from('tribe_live_join_requests')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToJoinRequest(data as JoinRequestRow);
}

export async function startEgress(params: {
  roomName: string;
  sessionId: string;
}): Promise<{ egressId: string; videoUrl: string }> {
  const { data, error } = await supabase.functions.invoke('tribe-live-egress', {
    body: { action: 'start', roomName: params.roomName, sessionId: params.sessionId },
  });
  if (error) throw new Error(error.message);
  if (!data?.egressId) throw new Error('Egress did not start');
  await supabase
    .from('tribe_live_sessions')
    .update({ egress_id: data.egressId, video_url: data.videoUrl })
    .eq('id', params.sessionId);
  return { egressId: data.egressId as string, videoUrl: data.videoUrl as string };
}

export async function stopEgress(egressId: string): Promise<void> {
  await supabase.functions.invoke('tribe-live-egress', {
    body: { action: 'stop', egressId },
  });
}

export async function fetchLiveToken(params: {
  roomName: string;
  participantIdentity: string;
  participantName: string;
  canPublish: boolean;
}): Promise<{ token: string; livekitUrl: string }> {
  const { data, error } = await supabase.functions.invoke('tribe-live-token', {
    body: {
      roomName: params.roomName,
      participantIdentity: params.participantIdentity,
      participantName: params.participantName,
      canPublish: params.canPublish,
      canPublishData: true,
    },
  });
  if (error) throw new Error(error.message);
  if (!data?.token || !data?.livekitUrl) throw new Error('Invalid token response');
  return { token: data.token as string, livekitUrl: data.livekitUrl as string };
}
