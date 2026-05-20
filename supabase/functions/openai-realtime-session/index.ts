const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type OpenAIRealtimeRequest = {
  instructions?: string;
  metadata?: Record<string, unknown>;
  sessionConfig?: Record<string, unknown>;
  tools?: unknown[];
};

const DEFAULT_MODEL = Deno.env.get('OPENAI_REALTIME_MODEL')?.trim() || 'gpt-realtime-mini';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
      status: 200,
    });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      {
        headers: corsHeaders,
        status: 405,
      },
    );
  }

  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')?.trim();
  if (!openaiApiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY is not configured.' }),
      {
        headers: corsHeaders,
        status: 500,
      },
    );
  }

  let body: OpenAIRealtimeRequest;
  try {
    body = (await request.json()) as OpenAIRealtimeRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      {
        headers: corsHeaders,
        status: 400,
      },
    );
  }

  // Use /v1/realtime/sessions — the correct WebRTC session endpoint.
  // This endpoint takes a flat JSON body (no "session" wrapper) and accepts
  // "voice" as a top-level field. The older /v1/realtime/client_secrets endpoint
  // uses a { session: { type: "realtime", ... } } wrapper and rejects "voice".
  const sessionCfg = (body.sessionConfig ?? {}) as Record<string, unknown>;
  const audioOutput = ((sessionCfg.audio as Record<string, unknown> | undefined)?.output) as Record<string, unknown> | undefined;
  const voice = audioOutput?.voice ? String(audioOutput.voice) : undefined;

  const sessionPayload: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    instructions: body.instructions ?? 'You are a helpful workout coach.',
    tool_choice: typeof sessionCfg.tool_choice === 'string' ? String(sessionCfg.tool_choice) : 'auto',
    tools: Array.isArray(body.tools) ? body.tools : [],
  };
  if (voice) sessionPayload.voice = voice;

  console.log('[openai-realtime-session] sending payload:', JSON.stringify(sessionPayload));

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sessionPayload),
  });

  const text = await response.text();
  console.log('[openai-realtime-session] OpenAI response', response.status, text.slice(0, 500));

  if (!response.ok) {
    // Return 200 so the Supabase SDK passes the body back to the client — the
    // generic "non-2xx" wrapper swallows the real error message otherwise.
    return new Response(
      JSON.stringify({ clientSecret: '', openaiError: `${response.status}: ${text}` }),
      { headers: corsHeaders, status: 200 },
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const clientSecret =
    typeof payload.value === 'string'
      ? payload.value
      : typeof (payload.client_secret as Record<string, unknown> | undefined)?.value === 'string'
        ? String((payload.client_secret as Record<string, unknown>).value)
        : '';

  return new Response(
    JSON.stringify({
      clientSecret,
      model: DEFAULT_MODEL,
      session: payload.session ?? null,
    }),
    {
      headers: corsHeaders,
      status: 200,
    },
  );
});
