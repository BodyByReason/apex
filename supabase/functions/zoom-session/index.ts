const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type ZoomSessionBody = {
  agenda?: string;
  durationMinutes?: number;
  hostUserId?: string;
  startTime: string;
  topic: string;
};

async function getZoomAccessToken() {
  const accountId = Deno.env.get('ZOOM_ACCOUNT_ID');
  const clientId = Deno.env.get('ZOOM_CLIENT_ID');
  const clientSecret = Deno.env.get('ZOOM_CLIENT_SECRET');
  if (!accountId || !clientId || !clientSecret) {
    return null;
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Zoom auth failed: ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token?: string };
  return data.access_token ?? null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      headers: corsHeaders,
      status: 405,
    });
  }

  let body: ZoomSessionBody;
  try {
    body = (await request.json()) as ZoomSessionBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  if (!body.topic?.trim() || !body.startTime?.trim()) {
    return new Response(JSON.stringify({ error: 'topic and startTime are required.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  const fallbackJoinUrl = Deno.env.get('ZOOM_JOIN_URL') || 'https://zoom.us/join';
  const zoomHostUserId =
    body.hostUserId?.trim() ||
    Deno.env.get('ZOOM_HOST_USER_ID')?.trim() ||
    Deno.env.get('ZOOM_HOST_EMAIL')?.trim();

  try {
    const token = await getZoomAccessToken();
    if (!token) {
      return new Response(JSON.stringify({
        configured: false,
        join_url: fallbackJoinUrl,
        start_url: fallbackJoinUrl,
      }), { headers: corsHeaders, status: 200 });
    }

    if (!zoomHostUserId) {
      throw new Error('Zoom host user is not configured. Set hostUserId in the request or ZOOM_HOST_USER_ID/ZOOM_HOST_EMAIL as a secret.');
    }

    const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(zoomHostUserId)}/meetings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: body.topic.trim(),
        agenda: body.agenda?.trim() || body.topic.trim(),
        default_password: false,
        duration: Math.max(15, body.durationMinutes ?? 60),
        settings: {
          join_before_host: false,
          participant_video: true,
          waiting_room: true,
        },
        start_time: body.startTime,
        type: 2,
      }),
    });

    if (!response.ok) {
      throw new Error(`Zoom meeting creation failed: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      id?: number | string;
      join_url?: string;
      start_url?: string;
      uuid?: string;
    };
    return new Response(JSON.stringify({
      configured: true,
      meeting_id: data.id ? String(data.id) : null,
      meeting_uuid: data.uuid ?? null,
      join_url: data.join_url ?? fallbackJoinUrl,
      start_url: data.start_url ?? data.join_url ?? fallbackJoinUrl,
    }), { headers: corsHeaders, status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({
      configured: false,
      error: error instanceof Error ? error.message : String(error),
      join_url: fallbackJoinUrl,
      start_url: fallbackJoinUrl,
    }), { headers: corsHeaders, status: 200 });
  }
});
