// claude-vision — single-frame vision analysis for Form Review mode.
// Used by SerenaProtoScreen when isFormReview is true (deliberate rep technique check).
//
// Claude Sonnet 4.6 is used instead of Gemini because Form Review requires
// repCompleted signal and nuanced positive coaching notes — capabilities
// that justify the higher latency (~600–900 ms vs Gemini's ~300 ms).
// Form Review fires at 400 ms intervals but isAnalyzingRef gates overlapping calls,
// so occasional slower frames are acceptable.
//
// Required Supabase secret: ANTHROPIC_API_KEY

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

type ClaudeVisionRequest = {
  /** Base64-encoded JPEG frame — no data URI prefix. */
  imageBase64: string;
  /** Name of the exercise being performed, e.g. "Back Squat". */
  exerciseName: string;
};

type ClaudeVisionResponse = {
  /** Movement phase — drives the client-side FSM and overlay. */
  phase: 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';
  /** Model certainty about the phase label (0.0 – 1.0). */
  confidence: number;
  /**
   * True when Claude detects a complete rep transition in this frame.
   * Client uses this instead of FSM edge detection during Form Review.
   */
  repCompleted: boolean;
  /** ≤ 5-word spoken coaching cue, or null if form is fine. */
  formCue: string | null;
  /** Form quality signal — omits 'positive' (use positiveNote instead). */
  severity: 'tip' | 'fix' | 'critical' | null;
  /** Short praise phrase when form is excellent, e.g. "Perfect depth!". Null otherwise. */
  positiveNote: string | null;
};

const SYSTEM_PROMPT = `You are a real-time strength training form review vision assistant for the APEX app.

Your job is to analyze a single video frame of an athlete performing a strength exercise during a deliberate Form Review set.

## Your responsibilities

1. Identify the current movement phase: top (standing/start position), descent (lowering under control), bottom (lowest point / catch), ascent (driving upward), rest (stationary between reps).

2. Detect when a complete rep has just finished — set repCompleted: true only on the frame where the athlete returns to the top/standing position after completing a full range-of-motion cycle.

3. Evaluate visible form quality and generate a short, spoken coaching cue if needed.

4. Generate a positive note when form is genuinely excellent — not as filler praise.

## Movement phase definitions

- top: Athlete is at standing/lockout/start position, ready to begin or just completed a rep.
- descent: Athlete is actively lowering the load with control.
- bottom: Athlete is at the lowest point — below parallel for squats, chest near bar for rows, etc.
- ascent: Athlete is driving upward or pulling the load.
- rest: Athlete is stationary and not at the top position — pausing mid-rep, adjusting, or between sets.

## Rep completion rules

- Set repCompleted: true ONLY on the frame where the athlete arrives back at the top/lockout position after a full descent + ascent cycle.
- Do NOT set it true repeatedly for the same standing position.
- If uncertain, set false.

## Form cue rules

- formCue must be ≤ 5 words, spoken as a real coach would say it aloud.
- Only generate a cue when there is a specific, visible correction needed.
- Set formCue: null when form looks good.
- Never generate vague cues like "good job" or "keep going" — those belong in positiveNote.
- severity options: "tip" (minor cue), "fix" (needs correction), "critical" (safety concern).
- If formCue is null, severity must also be null.

## Positive note rules

- positiveNote is a short, genuine praise phrase (≤ 6 words) when form is excellent.
- Examples: "Perfect depth!", "Great bar path!", "Smooth tempo!"
- Set null unless form is genuinely worth praising.
- Do not combine formCue and positiveNote in the same response — if there's a correction, skip the praise.

## Output format

Return JSON with exactly this shape — no markdown, no explanation, no trailing text:
{"phase":"top","confidence":0.0,"repCompleted":false,"formCue":null,"severity":null,"positiveNote":null}`;

function buildUserPrompt(exerciseName: string): string {
  return `Exercise: ${exerciseName || 'strength exercise'}

Form Review mode is active.
The athlete is performing slow, deliberate reps for technique review.
Use the exercise context to interpret movement phase and visible form.

Return JSON only with exactly this shape:
{"phase":"top","confidence":0.0,"repCompleted":false,"formCue":null,"severity":null,"positiveNote":null}`;
}

const FALLBACK_RESPONSE: ClaudeVisionResponse = {
  phase: 'rest',
  confidence: 0,
  repCompleted: false,
  formCue: null,
  severity: null,
  positiveNote: null,
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

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured.' }), {
      headers: corsHeaders,
      status: 500,
    });
  }

  let body: ClaudeVisionRequest;
  try {
    body = (await request.json()) as ClaudeVisionRequest;
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

  const claudePayload = {
    model: CLAUDE_MODEL,
    max_tokens: 120,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: body.imageBase64,
            },
          },
          {
            type: 'text',
            text: buildUserPrompt(body.exerciseName),
          },
        ],
      },
    ],
  };

  const claudeResponse = await fetch(CLAUDE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(claudePayload),
  });

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text();
    return new Response(JSON.stringify({ error: `Claude API error: ${errText}` }), {
      headers: corsHeaders,
      status: claudeResponse.status,
    });
  }

  const claudeData = await claudeResponse.json() as {
    content?: Array<{ type: string; text?: string }>;
  };

  const rawText = claudeData?.content?.[0]?.text ?? '';

  // Extract the first JSON object from the response defensively.
  // Claude with max_tokens=120 and a tight prompt returns clean JSON,
  // but we parse defensively to avoid passing malformed data to Serena.
  let parsed: ClaudeVisionResponse;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response.');

    const candidate = JSON.parse(jsonMatch[0]) as Partial<ClaudeVisionResponse>;

    // Validate required fields — fall back to safe defaults for any that are missing or wrong type.
    const validPhases = ['top', 'descent', 'bottom', 'ascent', 'rest'] as const;
    const validSeverities = ['tip', 'fix', 'critical', null] as const;

    parsed = {
      phase: validPhases.includes(candidate.phase as typeof validPhases[number])
        ? (candidate.phase as ClaudeVisionResponse['phase'])
        : 'rest',
      confidence: typeof candidate.confidence === 'number'
        ? Math.max(0, Math.min(1, candidate.confidence))
        : 0,
      repCompleted: candidate.repCompleted === true,
      formCue: typeof candidate.formCue === 'string' ? candidate.formCue : null,
      severity: validSeverities.includes(candidate.severity as typeof validSeverities[number])
        ? (candidate.severity as ClaudeVisionResponse['severity'])
        : null,
      positiveNote: typeof candidate.positiveNote === 'string' ? candidate.positiveNote : null,
    };

    // Enforce consistency: if formCue is null, severity must be null too.
    if (parsed.formCue === null) parsed.severity = null;
    // Don't send both a correction and praise in the same frame.
    if (parsed.formCue !== null) parsed.positiveNote = null;
  } catch {
    // Malformed response — return safe fallback rather than passing garbage to Serena.
    return new Response(JSON.stringify(FALLBACK_RESPONSE), {
      headers: corsHeaders,
      status: 200,
    });
  }

  return new Response(JSON.stringify(parsed), { headers: corsHeaders, status: 200 });
});
