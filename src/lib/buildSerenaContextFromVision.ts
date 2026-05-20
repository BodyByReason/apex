// buildSerenaContextFromVision — converts Claude Vision JSON into tiny, throttled
// event strings for serena.sendContext(). Keeps coaching specific, timely, and
// non-spammy by tracking last-sent state externally (caller owns the ref).
//
// Extended to include framing/visibility, stuck-phase coaching triggers,
// VISION_UNCERTAIN for low-confidence frames, and COUNTABILITY for rep-blocking
// conditions (why a rep didn't count).

import type {
  VisionResult,
  AssessmentState,
  FramingIssue,
  PaceAssessment,
  VisibilityState,
} from './parseClaudeVisionResult';

export type { VisionResult };
export type { VisionPhase, VisionSeverity, AssessmentState, FramingIssue, PaceAssessment, VisibilityState } from './parseClaudeVisionResult';

export type TempoStatus = PaceAssessment; // re-export under legacy name for compatibility

// ── RepBlockerReason ──────────────────────────────────────────────────────────
// Why the current rep is not counting. Used in COUNTABILITY events and in the
// overlay's hint strip so the athlete is never left guessing.

export type RepBlockerReason =
  | 'insufficient_depth'  // descending but bottom not confirmed
  | 'no_lockout'          // ascending but top not confirmed — did not stand fully tall
  | 'moved_too_fast'      // tempo too fast to assess cleanly
  | 'poor_visibility'     // camera cannot see the athlete
  | 'low_confidence'      // partial view — coaching with caution
  | 'incomplete_cycle'    // went back down before completing the rep
  | 'unknown'             // camera-confirmed but blocker cannot be determined
  | null;                 // null = no blocker (tracking cleanly or rep just counted)

export type SerenaContextOptions = {
  currentExercise: string;
  repCount: number;
  tempoStatus: PaceAssessment;
  /** Qualitative rep label — spoken as part of the REP event. Defaults to 'controlled'. */
  qualityLabel?: 'controlled' | 'solid' | 'strong' | 'smooth';
  /** Frames below this confidence are dropped entirely. Defaults to 0.65. */
  confidenceThreshold?: number;
  formCueCooldownMs?: number;
  positiveCueCooldownMs?: number;
  tempoCueCooldownMs?: number;
  framingCueCooldownMs?: number;
  /** Why the current rep is not (yet) counting. Drives COUNTABILITY events. */
  repBlockerReason?: RepBlockerReason;
};

export type SerenaContextEvent =
  | { type: 'FORM_REVIEW_START'; text: string }
  | { type: 'REP'; text: string }
  | { type: 'FORM'; text: string }
  | { type: 'TEMPO'; text: string }
  | { type: 'FRAMING'; text: string }
  | { type: 'VISION_UNCERTAIN'; text: string }
  | { type: 'COUNTABILITY'; text: string }
  | { type: 'STUCK'; text: string }
  | { type: 'FORM_REVIEW_END'; text: string };

export type SerenaContextState = {
  lastFormCue: string | null;
  lastFormCueAt: number;
  lastPositiveCue: string | null;
  lastPositiveCueAt: number;
  lastTempoStatus: PaceAssessment | null;
  lastTempoCueAt: number;
  lastFramingIssue: FramingIssue | null;
  lastFramingCueAt: number;
  lastAssessmentState: AssessmentState | null;
  lastUncertainCueAt: number;
  lastCountabilityReason: RepBlockerReason;
  lastCountabilityCueAt: number;
};

export const DEFAULT_SERENA_CONTEXT_STATE: SerenaContextState = {
  lastFormCue: null,
  lastFormCueAt: 0,
  lastPositiveCue: null,
  lastPositiveCueAt: 0,
  lastTempoStatus: null,
  lastTempoCueAt: 0,
  lastFramingIssue: null,
  lastFramingCueAt: 0,
  lastAssessmentState: null,
  lastUncertainCueAt: 0,
  lastCountabilityReason: null,
  lastCountabilityCueAt: 0,
};

const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;
const DEFAULT_FORM_CUE_COOLDOWN_MS = 2500;
const DEFAULT_POSITIVE_CUE_COOLDOWN_MS = 4000;
const DEFAULT_TEMPO_CUE_COOLDOWN_MS = 8000;
const DEFAULT_FRAMING_CUE_COOLDOWN_MS = 7000;
const DEFAULT_UNCERTAIN_CUE_COOLDOWN_MS = 10000;
const DEFAULT_COUNTABILITY_CUE_COOLDOWN_MS = 5000;

function sanitizeQuoted(value: string): string {
  return value.replace(/"/g, "'").trim();
}

function isMeaningfulString(value: string | null | undefined): value is string {
  return !!value && value.trim().length > 0;
}

// ── Framing coaching text ─────────────────────────────────────────────────────

function framingCoachingText(issue: FramingIssue, visibility: VisibilityState): string {
  switch (issue) {
    case 'too_close':
      return 'step back from the camera so your full body is in frame';
    case 'too_far':
      return 'step closer to the camera so I can read your form';
    case 'body_cut_off':
      return 'adjust the camera angle so your full body is visible in frame';
    case 'angle_unclear':
      return 'rotate or reposition the camera for a clearer side or front view';
    case 'lighting_poor':
      return 'move to better lighting so I can see your position clearly';
    case 'motion_blur':
      return 'hold your position for a moment so I can get a clear read';
    case 'none':
    case 'unknown':
    default:
      return visibility === 'poor'
        ? 'adjust the camera so I can see your full body clearly'
        : 'step back slightly and make sure your full body is in frame';
  }
}

// ── Countability coaching text ────────────────────────────────────────────────
// Short coaching instructions sent as COUNTABILITY events so Serena can explain
// in her own words why a rep did not count.

function countabilityCoachingText(reason: NonNullable<RepBlockerReason>): string {
  switch (reason) {
    case 'insufficient_depth':
      return "Tell the athlete in one sentence to go lower — I did not see a confirmed bottom position. Example: 'Go a little lower so I can count that one.'";
    case 'no_lockout':
      return "Tell the athlete in one sentence to stand fully tall at the top. Example: 'Finish by standing all the way up — I need to see the lockout.'";
    case 'moved_too_fast':
      return "Tell the athlete in one sentence that the movement was too fast to assess. Example: 'Slow that down a bit — I couldn't judge the form at that speed.'";
    case 'poor_visibility':
      return "Tell the athlete in one sentence to adjust the camera. Example: 'I can't see your full body — step back or reposition the camera.'";
    case 'low_confidence':
      return "Tell the athlete in one short reassuring phrase that your view is partial and they should keep moving. Example: 'Keep going — I'm still getting a read on you.'";
    case 'incomplete_cycle':
      return "Tell the athlete in one sentence to complete the full rep before starting the next. Example: 'Finish one rep all the way through before starting the next.'";
    case 'unknown':
      return "Tell the athlete in one short, reassuring phrase that you are still calibrating and they should keep moving. Example: 'Keep going — still getting a read on you.'";
  }
}

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

/** One-shot context sent when Form Review mode starts. */
export function buildFormReviewStartContext(currentExercise: string): SerenaContextEvent {
  return {
    type: 'FORM_REVIEW_START',
    text:
      `[FORM_REVIEW_START] exercise="${sanitizeQuoted(currentExercise)}" ` +
      `mode="guided tempo form review" ` +
      `instruction="You are now in Form Review mode. Coach proactively — do NOT wait for the athlete to speak. ` +
      `You will receive structured vision events. React to each with short, natural coaching (1–2 sentences max). ` +
      `Silence from the athlete is EXPECTED — they are moving. ` +
      `NEVER ask 'Are you still there?' or check in on silence during this mode. ` +
      `If framing is poor, instruct the athlete to fix their position before starting. ` +
      `Guide the athlete through 3–5 slow, deliberate reps."`,
  };
}

/** One-shot context sent when Form Review mode ends.
 * @param topCues - Up to 3 corrective cues dispatched during the review.
 *   When provided, Serena can reference specific coaching points instead of
 *   giving a generic summary. */
export function buildFormReviewEndContext(
  currentExercise: string,
  repCount: number,
  topCues?: string[],
): SerenaContextEvent {
  const cues = topCues?.filter(Boolean).slice(0, 3) ?? [];
  const cueSummary =
    cues.length > 0
      ? ` Coaching cues you gave: ${cues.map((c) => `'${c}'`).join(', ')}.`
      : '';
  const summaryInstruction =
    cues.length > 0
      ? `Reference those specific cues in your summary (1–2 sentences).`
      : `Summarize the athlete's form in one or two short coaching points.`;
  return {
    type: 'FORM_REVIEW_END',
    text:
      `[FORM_REVIEW_END] exercise="${sanitizeQuoted(currentExercise)}" ` +
      `confirmed_reps=${repCount}${cueSummary} ` +
      `instruction="Form Review is complete.${cueSummary} ` +
      `${summaryInstruction} ` +
      `Acknowledge the ${repCount} confirmed rep${repCount !== 1 ? 's' : ''}. ` +
      `Ask if they want another review set or to return to normal pace."`,
  };
}

/** Sent when the system detects the athlete is stuck in a phase too long. */
export function buildStuckPhaseContext(
  currentExercise: string,
  phase: string,
  stuckMs: number,
): SerenaContextEvent {
  const secs = Math.round(stuckMs / 1000);
  return {
    type: 'STUCK',
    text:
      `[STUCK_PHASE] exercise="${sanitizeQuoted(currentExercise)}" ` +
      `phase="${phase}" duration_secs=${secs} ` +
      `instruction="The athlete appears stuck in the ${phase} phase for ${secs}s. ` +
      `Say one short, natural cue to prompt them to continue the movement or reset their position."`,
  };
}

// ── Per-frame mapper ──────────────────────────────────────────────────────────

/**
 * Convert a single Claude Vision result into zero or more sendContext() payloads.
 *
 * Priority order for events emitted in a single frame:
 *   FRAMING (if visibility is poor and issue changed) >
 *   COUNTABILITY (if a rep-blocking condition is active, throttled) >
 *   REP (no throttle — each rep is unique) >
 *   FORM corrective (throttled, deduplicated) >
 *   FORM positive (throttled, deduplicated) >
 *   TEMPO (change-gated + cooldown)
 *
 * Returns `events` to send and `nextState` to store in the caller's ref.
 */
export function buildSerenaContextFromVision(
  vision: VisionResult,
  state: SerenaContextState,
  options: SerenaContextOptions,
): { events: SerenaContextEvent[]; nextState: SerenaContextState } {
  const now = Date.now();
  const events: SerenaContextEvent[] = [];
  const nextState: SerenaContextState = { ...state };

  const currentExercise = sanitizeQuoted(options.currentExercise);
  const repCount = options.repCount;
  const tempoStatus = options.tempoStatus;
  const qualityLabel = options.qualityLabel ?? 'controlled';

  const confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const formCueCooldownMs = options.formCueCooldownMs ?? DEFAULT_FORM_CUE_COOLDOWN_MS;
  const positiveCueCooldownMs = options.positiveCueCooldownMs ?? DEFAULT_POSITIVE_CUE_COOLDOWN_MS;
  const tempoCueCooldownMs = options.tempoCueCooldownMs ?? DEFAULT_TEMPO_CUE_COOLDOWN_MS;
  const framingCueCooldownMs = options.framingCueCooldownMs ?? DEFAULT_FRAMING_CUE_COOLDOWN_MS;

  if (!vision || typeof vision.confidence !== 'number') {
    return { events, nextState };
  }

  // ── FRAMING / VISIBILITY ──────────────────────────────────────────────────
  const visibilityState = vision.visibilityState ?? 'poor';
  const framingIssue    = vision.framingIssue    ?? 'unknown';
  const assessmentState = vision.assessmentState ?? 'unable_to_assess';

  const needsFramingCoach =
    visibilityState !== 'good' || assessmentState === 'unable_to_assess';
  const framingIssueChanged = framingIssue !== nextState.lastFramingIssue;
  const framingCooled = now - nextState.lastFramingCueAt >= framingCueCooldownMs;

  if (needsFramingCoach && (framingIssueChanged || framingCooled)) {
    const coachingText = framingCoachingText(framingIssue, visibilityState);
    nextState.lastFramingIssue = framingIssue;
    nextState.lastFramingCueAt = now;
    nextState.lastAssessmentState = assessmentState;
    events.push({
      type: 'FRAMING',
      text:
        `[FRAMING] exercise="${currentExercise}" ` +
        `visibility="${visibilityState}" ` +
        `issue="${framingIssue}" ` +
        `assessmentState="${assessmentState}" ` +
        `instruction="Tell the athlete in one short sentence to ${coachingText}."`,
    });
    if (assessmentState === 'unable_to_assess') {
      return { events, nextState };
    }
  }

  // ── Below confidence threshold: skip movement events ─────────────────────
  if (vision.confidence < confidenceThreshold) {
    return { events, nextState };
  }

  // ── VISION_UNCERTAIN — low-confidence coaching signal ────────────────────
  if (assessmentState === 'low_confidence') {
    const uncertainCooled =
      now - nextState.lastUncertainCueAt >= DEFAULT_UNCERTAIN_CUE_COOLDOWN_MS;
    if (uncertainCooled) {
      nextState.lastUncertainCueAt = now;
      events.push({
        type: 'VISION_UNCERTAIN',
        text:
          `[VISION_UNCERTAIN] exercise="${currentExercise}" ` +
          `confidence=${Math.round((vision.confidence ?? 0) * 100)}% ` +
          `instruction="Camera confidence is low — continue coaching but avoid ` +
          `specific form corrections until you have a clearer view. ` +
          `A short reassuring cue is fine."`,
      });
    }
  }

  // ── COUNTABILITY — why the current rep is not counting ───────────────────
  // Fires when there is an active rep-blocking condition. Throttled and
  // deduplicated so Serena speaks naturally rather than spamming the same cue.
  // Cleared when the blocker resolves (repBlockerReason becomes null) or a rep
  // is counted (caller sets repBlockerReason to null).
  const repBlockerReason = options.repBlockerReason ?? null;
  if (repBlockerReason !== null) {
    const reasonChanged = repBlockerReason !== nextState.lastCountabilityReason;
    const countabilityCooled =
      now - nextState.lastCountabilityCueAt >= DEFAULT_COUNTABILITY_CUE_COOLDOWN_MS;
    if (reasonChanged || countabilityCooled) {
      nextState.lastCountabilityReason = repBlockerReason;
      nextState.lastCountabilityCueAt = now;
      events.push({
        type: 'COUNTABILITY',
        text:
          `[COUNTABILITY] exercise="${currentExercise}" reason="${repBlockerReason}" ` +
          `instruction="${countabilityCoachingText(repBlockerReason)}"`,
      });
    }
  } else if (nextState.lastCountabilityReason !== null) {
    // Blocker resolved — clear tracking state so next blocker is fresh.
    nextState.lastCountabilityReason = null;
  }

  // ── Clear framing issue once visibility recovers ──────────────────────────
  if (vision.visibilityState === 'good' && nextState.lastFramingIssue !== 'none') {
    nextState.lastFramingIssue = 'none';
    nextState.lastAssessmentState = 'tracking';
  }

  // ── REP ───────────────────────────────────────────────────────────────────
  if (vision.repCompleted) {
    events.push({
      type: 'REP',
      text:
        `[REP] count=${repCount} completed=true ` +
        `exercise="${currentExercise}" quality="${qualityLabel}" ` +
        `instruction="Call out rep number ${repCount} with brief praise. ` +
        `Say the rep number — NEVER say 'set'. ` +
        `Example: '${repCount}! Nice control.' or 'That's ${repCount}!' ` +
        `Keep it under 6 words."`,
    });
  }

  // ── FORM (corrective > positive, never both in one frame) ─────────────────
  const hasCorrectiveCue =
    isMeaningfulString(vision.formCue) &&
    (vision.severity === 'tip' || vision.severity === 'fix' || vision.severity === 'critical');

  if (hasCorrectiveCue) {
    const cue = sanitizeQuoted(vision.formCue!);
    const isNew = cue !== nextState.lastFormCue;
    const cooled = now - nextState.lastFormCueAt >= formCueCooldownMs;
    if (isNew || cooled) {
      nextState.lastFormCue = cue;
      nextState.lastFormCueAt = now;
      const correctiveInstruction =
        vision.severity === 'critical'
          ? `This is a safety correction — state it clearly and directly in one sentence, under 8 words.`
          : `Deliver this as a natural coaching cue in one sentence, under 8 words. Do not read it verbatim.`;
      events.push({
        type: 'FORM',
        text:
          `[FORM] exercise="${currentExercise}" severity="${vision.severity}" cue="${cue}" ` +
          `instruction="${correctiveInstruction}"`,
      });
    }
  } else if (isMeaningfulString(vision.positiveNote)) {
    const note = sanitizeQuoted(vision.positiveNote);
    const isNew = note !== nextState.lastPositiveCue;
    const cooled = now - nextState.lastPositiveCueAt >= positiveCueCooldownMs;
    if (isNew || cooled) {
      nextState.lastPositiveCue = note;
      nextState.lastPositiveCueAt = now;
      events.push({
        type: 'FORM',
        text:
          `[FORM] exercise="${currentExercise}" severity="positive" cue="${note}" ` +
          `instruction="Give brief, genuine praise in your natural voice, under 6 words."`,
      });
    }
  }

  // ── TEMPO ─────────────────────────────────────────────────────────────────
  const tempoIsProblem = tempoStatus === 'too_fast' || tempoStatus === 'too_slow';
  const tempoChanged = tempoStatus !== nextState.lastTempoStatus;
  const tempoCooled = now - nextState.lastTempoCueAt >= tempoCueCooldownMs;
  if (tempoIsProblem && (tempoChanged || tempoCooled)) {
    nextState.lastTempoStatus = tempoStatus;
    nextState.lastTempoCueAt = now;
    const focus =
      tempoStatus === 'too_fast'
        ? 'slow the lowering phase — control the eccentric'
        : 'speed up slightly — movement has stalled';
    const tempoInstruction =
      tempoStatus === 'too_fast'
        ? `Say one short cue to slow down, under 7 words. Example: 'Slow the lower' or 'Control that descent.'`
        : `Say one short cue to maintain momentum, under 7 words.`;
    events.push({
      type: 'TEMPO',
      text:
        `[TEMPO] exercise="${currentExercise}" status="${tempoStatus}" focus="${focus}" ` +
        `instruction="${tempoInstruction}"`,
    });
  } else if (!tempoIsProblem && tempoChanged && tempoStatus === 'on_tempo') {
    if (now - nextState.lastTempoCueAt >= tempoCueCooldownMs) {
      nextState.lastTempoStatus = tempoStatus;
      nextState.lastTempoCueAt = now;
      events.push({
        type: 'TEMPO',
        text:
          `[TEMPO] exercise="${currentExercise}" status="on_tempo" focus="good pace for clean review" ` +
          `instruction="Give brief encouraging feedback on the pace, under 6 words."`,
      });
    }
  }

  return { events, nextState };
}
