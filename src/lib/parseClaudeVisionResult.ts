// parseClaudeVisionResult — defensive parser for Claude vision responses.
// Accepts: parsed JSON objects, raw JSON strings, Anthropic message envelopes,
// or any unknown shape. Returns a validated VisionResult or null on failure.
//
// Extended schema adds framing/visibility/assessment/paceAssessment fields
// so the Form Review overlay and Serena can react to camera conditions.

export type VisionPhase = 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';
export type VisionSeverity = 'tip' | 'fix' | 'critical' | null;

// ── Extended schema types ─────────────────────────────────────────────────────

/** Overall athlete body visibility in frame. */
export type VisibilityState = 'good' | 'partial' | 'poor';

/**
 * Specific framing problem detected, or 'none' when framing is acceptable.
 * 'unknown' means something is wrong but Claude could not classify it.
 */
export type FramingIssue =
  | 'none'
  | 'too_close'
  | 'too_far'
  | 'body_cut_off'
  | 'angle_unclear'
  | 'lighting_poor'
  | 'motion_blur'
  | 'unknown';

/**
 * Whether Claude believes it can reliably assess this frame.
 * 'tracking'         — full confidence, phase/rep data is trustworthy.
 * 'low_confidence'   — partial data; use with caution, show uncertainty UI.
 * 'unable_to_assess' — cannot determine anything; ignore phase/rep data.
 */
export type AssessmentState = 'tracking' | 'low_confidence' | 'unable_to_assess';

/**
 * Pace of the current movement relative to the tempo hint.
 * 'uncertain' when Claude cannot assess from the current frame.
 */
export type PaceAssessment = 'on_tempo' | 'too_fast' | 'too_slow' | 'uncertain';

export type VisionResult = {
  // Core movement data
  phase: VisionPhase;
  confidence: number;
  repCompleted: boolean;
  formCue: string | null;
  severity: VisionSeverity;
  positiveNote: string | null;
  // Extended visibility / assessment data
  visibilityState: VisibilityState;
  framingIssue: FramingIssue;
  assessmentState: AssessmentState;
  paceAssessment: PaceAssessment;
};

// ── Safe defaults for missing or partial frames ───────────────────────────────

export const DEFAULT_VISION_RESULT: VisionResult = {
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

// ── Validators ────────────────────────────────────────────────────────────────

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

function isVisionPhase(value: unknown): value is VisionPhase {
  return typeof value === 'string' && VALID_PHASES.includes(value as VisionPhase);
}

function isVisionSeverity(value: unknown): value is Exclude<VisionSeverity, null> {
  return typeof value === 'string' && (VALID_SEVERITIES as readonly string[]).includes(value);
}

function isVisibilityState(value: unknown): value is VisibilityState {
  return typeof value === 'string' && VALID_VISIBILITY.includes(value as VisibilityState);
}

function isFramingIssue(value: unknown): value is FramingIssue {
  return typeof value === 'string' && VALID_FRAMING.includes(value as FramingIssue);
}

function isAssessmentState(value: unknown): value is AssessmentState {
  return typeof value === 'string' && VALID_ASSESSMENT.includes(value as AssessmentState);
}

function isPaceAssessment(value: unknown): value is PaceAssessment {
  return typeof value === 'string' && VALID_PACE.includes(value as PaceAssessment);
}

function clampConfidence(value: unknown): number {
  const num =
    typeof value === 'number' ? value
    : typeof value === 'string' ? Number(value)
    : NaN;
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
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
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
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const parsed = tryParseJson<Record<string, unknown>>(
      trimmed.slice(firstBrace, lastBrace + 1),
    );
    if (isObject(parsed)) return parsed;
  }
  return null;
}

function extractCandidateObject(raw: unknown): Record<string, unknown> | null {
  if (isObject(raw)) {
    if (
      isVisionPhase(raw.phase) || 'repCompleted' in raw ||
      'formCue' in raw || 'positiveNote' in raw || 'assessmentState' in raw
    ) return raw;
    if (Array.isArray(raw.content)) {
      for (const item of raw.content) {
        if (!isObject(item)) continue;
        if (typeof item.text === 'string') {
          const parsed = extractJsonObjectFromString(item.text);
          if (parsed) return parsed;
        }
        if (isObject(item.input)) return item.input;
      }
    }
    if (typeof raw.text === 'string') {
      const parsed = extractJsonObjectFromString(raw.text);
      if (parsed) return parsed;
    }
    if (isObject(raw.result)) return raw.result;
    if (isObject(raw.output)) return raw.output;
    if (isObject(raw.data)) return raw.data;
  }
  if (typeof raw === 'string') return extractJsonObjectFromString(raw);
  return null;
}

/**
 * Parse and validate a Claude Vision API response into a typed VisionResult.
 * Returns null if the response is missing or fundamentally malformed.
 * Consistency rules enforced:
 *   - formCue null  → severity null
 *   - formCue present → positiveNote null (corrective cue wins)
 *   - unable_to_assess → clears repCompleted, resets to safe defaults
 */
export function parseClaudeVisionResult(raw: unknown): VisionResult | null {
  const candidate = extractCandidateObject(raw);
  if (!candidate) return null;

  const phase = isVisionPhase(candidate.phase) ? candidate.phase : 'rest';
  const confidence = clampConfidence(candidate.confidence);
  const repCompleted = normalizeBoolean(candidate.repCompleted);
  const formCue = cleanNullableString(candidate.formCue);
  const positiveNote = cleanNullableString(candidate.positiveNote);
  let severity: VisionSeverity = isVisionSeverity(candidate.severity) ? candidate.severity : null;
  if (!formCue) severity = null;

  const visibilityState = isVisibilityState(candidate.visibilityState)
    ? candidate.visibilityState : 'poor';
  const framingIssue = isFramingIssue(candidate.framingIssue)
    ? candidate.framingIssue : 'unknown';
  const assessmentState = isAssessmentState(candidate.assessmentState)
    ? candidate.assessmentState : 'unable_to_assess';
  const paceAssessment = isPaceAssessment(candidate.paceAssessment)
    ? candidate.paceAssessment : 'uncertain';

  return {
    phase,
    confidence,
    // If Claude can't assess, never count a rep from this frame.
    repCompleted: assessmentState === 'unable_to_assess' ? false : repCompleted,
    formCue,
    severity,
    positiveNote: formCue ? null : positiveNote,
    visibilityState,
    framingIssue,
    assessmentState,
    paceAssessment,
  };
}

/** Stricter variant — rejects frames with invalid phase or out-of-range confidence. */
export function parseClaudeVisionResultStrict(raw: unknown): VisionResult | null {
  const parsed = parseClaudeVisionResult(raw);
  if (!parsed) return null;
  if (!VALID_PHASES.includes(parsed.phase)) return null;
  if (parsed.confidence < 0 || parsed.confidence > 1) return null;
  return parsed;
}
