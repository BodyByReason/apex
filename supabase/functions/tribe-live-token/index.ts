import { AccessToken } from 'npm:livekit-server-sdk@2';

/*
  Run this SQL in Supabase dashboard before deploying:

  create table tribe_live_sessions (
    id uuid primary key default gen_random_uuid(),
    coach_id uuid references auth.users not null,
    coach_name text not null,
    coach_avatar_url text,
    title text not null,
    status text not null default 'live',
    livekit_room_name text not null,
    viewer_count int not null default 0,
    started_at timestamptz not null default now(),
    ended_at timestamptz
  );
  create table tribe_live_comments (
    id uuid primary key default gen_random_uuid(),
    session_id uuid references tribe_live_sessions not null,
    user_id uuid references auth.users not null,
    author_name text not null,
    author_avatar_url text,
    author_is_coach boolean not null default false,
    body text not null,
    created_at timestamptz not null default now()
  );
  create table tribe_live_join_requests (
    id uuid primary key default gen_random_uuid(),
    session_id uuid references tribe_live_sessions not null,
    user_id uuid references auth.users not null,
    requester_name text not null,
    status text not null default 'pending',
    created_at timestamptz not null default now(),
    unique(session_id, user_id)
  );
  alter publication supabase_realtime add table tribe_live_sessions;
  alter publication supabase_realtime add table tribe_live_comments;
  alter publication supabase_realtime add table tribe_live_join_requests;
  alter table tribe_live_sessions enable row level security;
  alter table tribe_live_comments enable row level security;
  alter table tribe_live_join_requests enable row level security;
  create policy "Anyone can view sessions" on tribe_live_sessions for select using (true);
  create policy "Coach can insert" on tribe_live_sessions for insert with check (auth.uid() = coach_id);
  create policy "Coach can update" on tribe_live_sessions for update using (auth.uid() = coach_id);
  create policy "Anyone can view comments" on tribe_live_comments for select using (true);
  create policy "Auth users can post" on tribe_live_comments for insert with check (auth.uid() = user_id);
  create policy "Anyone can view requests" on tribe_live_join_requests for select using (true);
  create policy "Auth users can request" on tribe_live_join_requests for insert with check (auth.uid() = user_id);
  create policy "Coach can update requests" on tribe_live_join_requests for update using (
    exists (select 1 from tribe_live_sessions where id = session_id and coach_id = auth.uid())
  );
  -- Set secrets: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
*/

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type TokenRequest = {
  roomName: string;
  participantIdentity: string;
  participantName: string;
  canPublish: boolean;
  canPublishData: boolean;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), { headers: corsHeaders, status: 405 });
  }

  const apiKey = Deno.env.get('LIVEKIT_API_KEY')?.trim();
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')?.trim();
  const livekitUrl = Deno.env.get('LIVEKIT_URL')?.trim();

  if (!apiKey || !apiSecret || !livekitUrl) {
    return new Response(JSON.stringify({ error: 'LiveKit env vars not configured.' }), { headers: corsHeaders, status: 500 });
  }

  let body: TokenRequest;
  try {
    body = (await request.json()) as TokenRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { headers: corsHeaders, status: 400 });
  }

  const { roomName, participantIdentity, participantName, canPublish, canPublishData } = body;
  if (!roomName || !participantIdentity) {
    return new Response(JSON.stringify({ error: 'roomName and participantIdentity are required.' }), { headers: corsHeaders, status: 400 });
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantName ?? participantIdentity,
    ttl: '4h',
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: canPublish ?? false,
    canSubscribe: true,
    canPublishData: canPublishData ?? true,
  });

  const token = await at.toJwt();

  return new Response(JSON.stringify({ token, livekitUrl }), { headers: corsHeaders, status: 200 });
});
