const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type GoalPreviewBody = {
  experience?: string;
  frontPhoto?: string | null;
  goal?: string;
  goalWeightLbs?: string;
  rearPhoto?: string | null;
  sidePhoto?: string | null;
  voiceLabel?: string;
  weightLbs?: string;
};

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

  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicApiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured.' }), {
      headers: corsHeaders,
      status: 500,
    });
  }

  let body: GoalPreviewBody;
  try {
    body = (await request.json()) as GoalPreviewBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  const prompt = `Create a short, motivating but realistic physique projection for an APEX user.

Current weight: ${body.weightLbs || 'unknown'}
Goal weight: ${body.goalWeightLbs || 'unknown'}
Goal: ${body.goal || 'recomp'}
Experience: ${body.experience || 'intermediate'}
Chosen coach voice: ${body.voiceLabel || 'Marcus'}
Has front photo: ${body.frontPhoto ? 'yes' : 'no'}
Has side photo: ${body.sidePhoto ? 'yes' : 'no'}
Has rear photo: ${body.rearPhoto ? 'yes' : 'no'}

Return ONLY valid JSON:
{"headline":"...","summary":"...","focus":["...","...","..."],"imagePrompt":"..."}

Rules:
- headline under 12 words
- summary under 45 words
- focus array exactly 3 bullets
- imagePrompt should describe a realistic fitness transformation preview image with the same person, not fantasy or extreme bodybuilding
- keep it honest and achievable`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': anthropicApiKey,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return new Response(text, { headers: corsHeaders, status: response.status });
  }

  let parsed: { headline?: string; summary?: string; focus?: string[]; imagePrompt?: string } = {};
  try {
    const data = JSON.parse(text) as { content?: Array<{ text?: string }> };
    const raw = data.content?.map((item) => item.text ?? '').join('') ?? '';
    parsed = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ error: 'Could not parse preview payload.' }), {
      headers: corsHeaders,
      status: 500,
    });
  }

  const previewWebhook = Deno.env.get('GOAL_PREVIEW_WEBHOOK_URL');
  let image_url: string | null = null;
  if (previewWebhook) {
    try {
      const webhookResponse = await fetch(previewWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagePrompt: parsed.imagePrompt,
          input: body,
        }),
      });
      const webhookData = (await webhookResponse.json()) as { image_url?: string };
      image_url = webhookData.image_url ?? null;
    } catch {
      image_url = null;
    }
  }

  return new Response(JSON.stringify({ ...parsed, image_url }), {
    headers: corsHeaders,
    status: 200,
  });
});
