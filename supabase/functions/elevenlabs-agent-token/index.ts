const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type TokenRequest = {
  agentId: string;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      { headers: corsHeaders, status: 405 },
    );
  }

  const elevenLabsApiKey = Deno.env.get('ELEVENLABS_API_KEY')?.trim();
  if (!elevenLabsApiKey) {
    return new Response(
      JSON.stringify({ error: 'ELEVENLABS_API_KEY is not configured.' }),
      { headers: corsHeaders, status: 500 },
    );
  }

  let body: TokenRequest;
  try {
    body = (await request.json()) as TokenRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      { headers: corsHeaders, status: 400 },
    );
  }

  if (!body.agentId?.trim()) {
    return new Response(
      JSON.stringify({ error: 'agentId is required.' }),
      { headers: corsHeaders, status: 400 },
    );
  }

  // Fetch a LiveKit conversation token for WebRTC transport.
  // This is the correct path for React Native: the WebSocket (signed URL) path
  // requires browser AudioContext which doesn't exist in React Native's Hermes
  // runtime. The WebRTC path via LiveKit uses native audio I/O and works fine.
  const response = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(body.agentId)}`,
    {
      method: 'GET',
      headers: {
        'xi-api-key': elevenLabsApiKey,
      },
    },
  );

  const text = await response.text();
  console.log('[elevenlabs-agent-token] ElevenLabs response', response.status, text.slice(0, 300));

  if (!response.ok) {
    return new Response(
      JSON.stringify({ error: `ElevenLabs token request failed: ${response.status}: ${text}` }),
      { headers: corsHeaders, status: 200 },
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  // ElevenLabs returns { token: "livekit_jwt..." }
  const conversationToken = typeof payload.token === 'string' ? payload.token : '';
  if (!conversationToken) {
    return new Response(
      JSON.stringify({ error: 'ElevenLabs returned an empty conversation token.', raw: text }),
      { headers: corsHeaders, status: 200 },
    );
  }

  return new Response(
    JSON.stringify({ conversationToken }),
    { headers: corsHeaders, status: 200 },
  );
});
