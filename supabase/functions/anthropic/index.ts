// anthropic — general-purpose Anthropic Messages API proxy.
// When the request contains an image content block (vision request), the response
// is extracted and normalized into a VisionResult before returning.
// All other requests receive the raw Anthropic JSON response unchanged.
//
// Required Supabase secret: ANTHROPIC_API_KEY

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

// ── Vision result types (mirrors parseClaudeVisionResult.ts on the client) ────

type VisionPhase = 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';
type VisionSeverity = 'tip' | 'fix' | 'critical' | null;
type VisibilityState = 'good' | 'partial' | 'poor';
type FramingIssue =
  | 'none' | 'too_close' | 'too_far' | 'body_cut_off'
  | 'angle_unclear' | 'lighting_poor' | 'motion_blur' | 'unknown';
type AssessmentState = 'tracking' | 'low_confidence' | 'unable_to_assess';
type PaceAssessment = 'on_tempo' | 'too_fast' | 'too_slow' | 'uncertain';

type VisionResult = {
  phase: VisionPhase;
  confidence: number;
  repCompleted: boolean;
  formCue: string | null;
  severity: VisionSeverity;
  positiveNote: string | null;
  visibilityState: VisibilityState;
  framingIssue: FramingIssue;
  assessmentState: AssessmentState;
  paceAssessment: PaceAssessment;
};

const SAFE_VISION_RESULT: VisionResult = {
  phase: 'rest',
  confidence: 0,
  repCompleted: false,
  formCue: null,
  severity: null,
  positiveNote: null,
  visibilityState: 'poor',
  framingIssue: 'unknown',
  assessmentState: 'unable_to_assess',
  paceAssessment: 'uncertain',
};

// ── Validators ─────────────────────────────────────────────────────────────────

const VALID_PHASES: VisionPhase[] = ['top', 'descent', 'bottom', 'ascent', 'rest'];
const VALID_SEVERITIES = ['tip', 'fix', 'critical'] as const;
const VALID_VISIBILITY: VisibilityState[] = ['good', 'partial', 'poor'];
const VALID_FRAMING: FramingIssue[] = [
  'none', 'too_close', 'too_far', 'body_cut_off',
  'angle_unclear', 'lighting_poor', 'motion_blur', 'unknown',
];
const VALID_ASSESSMENT: AssessmentState[] = ['tracking', 'low_confidence', 'unable_to_assess'];
const VALID_PACE: PaceAssessment[] = ['on_tempo', 'too_fast', 'too_slow', 'uncertain'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isVisionPhase(v: unknown): v is VisionPhase {
  return typeof v === 'string' && VALID_PHASES.includes(v as VisionPhase);
}
function isVisionSeverity(v: unknown): v is Exclude<VisionSeverity, null> {
  return typeof v === 'string' && (VALID_SEVERITIES as readonly string[]).includes(v);
}
function isVisibilityState(v: unknown): v is VisibilityState {
  return typeof v === 'string' && VALID_VISIBILITY.includes(v as VisibilityState);
}
function isFramingIssue(v: unknown): v is FramingIssue {
  return typeof v === 'string' && VALID_FRAMING.includes(v as FramingIssue);
}
function isAssessmentState(v: unknown): v is AssessmentState {
  return typeof v === 'string' && VALID_ASSESSMENT.includes(v as AssessmentState);
}
function isPaceAssessment(v: unknown): v is PaceAssessment {
  return typeof v === 'string' && VALID_PACE.includes(v as PaceAssessment);
}
function clampConfidence(value: unknown): number {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}
function cleanNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^"+|"+$/g, '');
  return trimmed.length > 0 ? trimmed : null;
}
function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1';
  }
  return false;
}
function tryParseJson<T = unknown>(input: string): T | null {
  try { return JSON.parse(input) as T; } catch { return null; }
}
function extractJsonObjectFromString(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  const direct = tryParseJson<Record<string, unknown>>(trimmed);
  if (isObject(direct)) return direct;
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const parsed = tryParseJson<Record<string, unknown>>(trimmed.slice(first, last + 1));
    if (isObject(parsed)) return parsed;
  }
  return null;
}

/** Extract a VisionResult-shaped object from a Claude message response. */
function normalizeVisionResult(anthropicJson: unknown): VisionResult {
  let candidate: Record<string, unknown> | null = null;

  if (isObject(anthropicJson)) {
    if (Array.isArray(anthropicJson.content)) {
      for (const item of anthropicJson.content) {
        if (!isObject(item)) continue;
        if (typeof item.text === 'string') {
          candidate = extractJsonObjectFromString(item.text);
          if (candidate) break;
        }
      }
    }
    if (!candidate && typeof anthropicJson.text === 'string') {
      candidate = extractJsonObjectFromString(anthropicJson.text);
    }
  }

  if (!candidate) return { ...SAFE_VISION_RESULT };

  const assessmentState = isAssessmentState(candidate.assessmentState)
    ? candidate.assessmentState : 'unable_to_assess';
  const phase = isVisionPhase(candidate.phase) ? candidate.phase : 'rest';
  const confidence = clampConfidence(candidate.confidence);
  const formCue = cleanNullableString(candidate.formCue);
  const positiveNote = cleanNullableString(candidate.positiveNote);
  let severity: VisionSeverity = isVisionSeverity(candidate.severity) ? candidate.severity : null;
  if (!formCue) severity = null;

  return {
    phase,
    confidence,
    // Safety: never count a rep when we can't assess this frame.
    repCompleted: assessmentState === 'unable_to_assess'
      ? false
      : normalizeBoolean(candidate.repCompleted),
    formCue,
    severity,
    positiveNote: formCue ? null : positiveNote,
    visibilityState: isVisibilityState(candidate.visibilityState)
      ? candidate.visibilityState : 'poor',
    framingIssue: isFramingIssue(candidate.framingIssue)
      ? candidate.framingIssue : 'unknown',
    assessmentState,
    paceAssessment: isPaceAssessment(candidate.paceAssessment)
      ? candidate.paceAssessment : 'uncertain',
  };
}

/** True when the request body contains an image content block — marks this as a vision call. */
function isVisionRequest(body: Record<string, unknown>): boolean {
  if (!Array.isArray(body.messages)) return false;
  for (const msg of body.messages) {
    if (!isObject(msg) || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (isObject(part) && part.type === 'image') return true;
    }
  }
  return false;
}

// ── Request handler ───────────────────────────────────────────────────────────

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      headers: corsHeaders, status: 405,
    });
  }

  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicApiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured.' }), {
      headers: corsHeaders, status: 500,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      headers: corsHeaders, status: 400,
    });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: '`messages` must be a non-empty array.' }), {
      headers: corsHeaders, status: 400,
    });
  }

  // vision_mode must be explicitly 'form_review' to route through normalizeVisionResult.
  // Food scan and lab upload also send image blocks but expect raw Anthropic passthrough.
  const vision = isVisionRequest(body) && body.vision_mode === 'form_review';

  const anthropicPayload = {
    max_tokens: (body.max_tokens as number | undefined) ?? DEFAULT_MAX_TOKENS,
    messages: body.messages,
    model: (body.model as string | undefined) ?? DEFAULT_MODEL,
    system: body.system,
    temperature: body.temperature,
    tool_choice: body.tool_choice,
    tools: body.tools,
    top_k: body.top_k,
    top_p: body.top_p,
  };

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': anthropicApiKey,
    },
    body: JSON.stringify(anthropicPayload),
  });

  // ── Vision path: normalize response into VisionResult ─────────────────────
  if (vision) {
    const anthropicJson = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Anthropic request failed', details: anthropicJson }),
        { headers: corsHeaders, status: anthropicResponse.status },
      );
    }

    const result = normalizeVisionResult(anthropicJson);
    return new Response(JSON.stringify(result), { headers: corsHeaders, status: 200 });
  }

  // ── General path: pass raw Anthropic response through unchanged ───────────
  const responseText = await anthropicResponse.text();
  return new Response(responseText, { headers: corsHeaders, status: anthropicResponse.status });
});
