// gemini-vision — single-frame vision analysis for real-time rep counting and form cues.
// Used by SerenaProtoScreen (and optionally ActiveWorkoutPanel) for 1-fps camera analysis.
//
// Gemini 2.0 Flash is used instead of Claude Haiku because its vision latency
// (~250–500 ms) fits inside the 1000 ms capture interval, whereas Claude Haiku
// (~800–1500 ms) causes isAnalyzingRef to block most frames.
//
// Required Supabase secret: GEMINI_API_KEY

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

type GeminiVisionRequest = {
  /** Base64-encoded JPEG frame — no data URI prefix. */
  imageBase64: string;
  /** Name of the exercise being performed, e.g. "Back Squat". */
  exerciseName: string;
};

type GeminiVisionResponse = {
  /** Movement phase — drives the client-side FSM rep counter. */
  phase: 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';
  /** Model certainty about the phase label (0.0 – 1.0). */
  confidence: number;
  /** ≤ 5-word spoken coaching cue. */
  formCue: string;
  /** Form quality signal. */
  severity: 'positive' | 'tip' | 'fix' | 'critical';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST.' }), {
      headers: corsHeaders,
      status: 405,
    });
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured.' }), {
      headers: corsHeaders,
      status: 500,
    });
  }

  let body: GeminiVisionRequest;
  try {
    body = (await request.json()) as GeminiVisionRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  if (!body.imageBase64) {
    return new Response(JSON.stringify({ error: 'imageBase64 is required.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  const systemInstruction = `Analyze this ${body.exerciseName || 'exercise'} frame. Reply with ONLY compact JSON, no spaces, no markdown:
{"phase":"top|descent|bottom|ascent|rest","confidence":0.0-1.0,"formCue":"<5 words max>","severity":"positive|tip|fix|critical"}

phase: top=standing/start, descent=moving down, bottom=lowest point, ascent=driving up, rest=stationary between reps
confidence: your certainty about the phase label (0.0=unsure 1.0=certain)
formCue: single most important coaching cue for this frame, spoken aloud
severity: positive=great form, tip=minor cue, fix=needs correction, critical=safety concern`;

  const geminiPayload = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: body.imageBase64,
            },
          },
          { text: 'Analyze this frame.' },
        ],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    generationConfig: {
      maxOutputTokens: 60,
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  const geminiResponse = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiPayload),
  });

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text();
    return new Response(JSON.stringify({ error: `Gemini error: ${errText}` }), {
      headers: corsHeaders,
      status: geminiResponse.status,
    });
  }

  const geminiData = await geminiResponse.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Parse the JSON response — Gemini with responseMimeType=application/json
  // returns clean JSON, but we extract it defensively just in case.
  let parsed: GeminiVisionResponse;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText) as GeminiVisionResponse;
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to parse Gemini response.', raw: rawText }), {
      headers: corsHeaders,
      status: 500,
    });
  }

  return new Response(JSON.stringify(parsed), { headers: corsHeaders, status: 200 });
});
