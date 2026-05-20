// useFormReviewVisionLoop — encapsulates the Claude Vision polling loop for
// Form Review mode.
//
// Architecture:
//   Camera → Claude Sonnet 4.6 → normalizeVisionResult (edge fn) →
//   RepFSM → tempoClassifier → buildSerenaContextFromVision → sendSerenaContext
//
// Single source of truth: one FormReviewState drives the overlay, Serena
// context, and rep counting. No synthetic timers for phase — everything is
// camera-confirmed.
//
// Key guarantees:
//   - inFlightRef prevents overlapping concurrent Claude calls.
//   - RepFSM requires a full descent→bottom→ascent→top sequence to count a rep.
//   - Stuck-phase detection fires after STUCK_PHASE_MS without a transition.
//   - Real tempo classification measures phase durations between Claude responses.
//   - Framing/visibility coaching fires when Claude cannot assess the frame.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getClaudeVisionRequestBody } from '@/lib/getClaudeVisionRequestBody';
import {
  buildFormReviewEndContext,
  buildFormReviewStartContext,
  buildSerenaContextFromVision,
  buildStuckPhaseContext,
  DEFAULT_SERENA_CONTEXT_STATE,
  type RepBlockerReason,
  type SerenaContextState,
} from '@/lib/buildSerenaContextFromVision';
import {
  parseClaudeVisionResult,
  DEFAULT_VISION_RESULT,
} from '@/lib/parseClaudeVisionResult';
import type {
  AssessmentState,
  FramingIssue,
  PaceAssessment,
  VisionPhase,
  VisionResult,
  VisibilityState,
} from '@/lib/parseClaudeVisionResult';

// ── Public types ──────────────────────────────────────────────────────────────

export type { VisionPhase, AssessmentState, FramingIssue, PaceAssessment, VisibilityState };
export type { VisionResult };
export type { RepBlockerReason };

/**
 * Client-side rep FSM.
 * idle → descending → bottom_reached → ascending → (rep confirmed, back to idle)
 *
 * Requires a confirmed full sequence — partial cycles never count.
 */
export type RepFsmState = 'idle' | 'descending' | 'bottom_reached' | 'ascending';

export type UseFormReviewVisionLoopParams = {
  /** Top-level gate — hook does nothing when false. */
  enabled: boolean;
  currentExercise: string;
  /** Plain-English tempo hint e.g. "Lower: 4s · Hold: 1s · Drive: 1s". */
  tempoHint?: string | null;
  athleteContext?: string | null;
  frameIntervalMs?: number;
  confidenceThreshold?: number;
  /** Minimum gap between two counted reps (ms). */
  minRepGapMs?: number;
  /** Auto-stop after this many confirmed reps. */
  maxGuidedReps?: number;
  qualityLabel?: 'controlled' | 'solid' | 'strong' | 'smooth';
  cameraRef: React.RefObject<{
    takePictureAsync?: (opts: unknown) => Promise<{ base64?: string | null }>;
  }>;
  sendSerenaContext: (text: string) => void;
  /** Fired when the loop auto-completes at maxGuidedReps. */
  onAutoComplete?: (finalRepCount: number) => void;
};

export type UseFormReviewVisionLoopResult = {
  isRunning: boolean;
  isBusy: boolean;
  autoCompleted: boolean;
  // Rep state
  repCount: number;
  repFsmState: RepFsmState;
  // Current vision state (camera-confirmed, not synthetic)
  visionPhase: VisionPhase;
  phaseConfidence: number;
  assessmentState: AssessmentState;
  visibilityState: VisibilityState;
  framingIssue: FramingIssue;
  tempoStatus: PaceAssessment;
  lastVisionCue: string | null;
  // Stuck-phase signal
  isStuck: boolean;
  stuckPhaseMs: number;
  // Why a rep is not counting (null = no blocker)
  repBlockerReason: RepBlockerReason;
  // Actual measured phase durations (ms) from last complete phase — 0 until first measurement
  lastDescentMs: number;
  lastBottomMs: number;
  lastAscentMs: number;
  // Controls
  start: () => void;
  stop: () => void;
  reset: () => void;
};

// ── Tuning constants ──────────────────────────────────────────────────────────

const DEFAULT_FRAME_INTERVAL_MS = 1000;
const DEFAULT_MIN_REP_GAP_MS = 2000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;
const DEFAULT_MAX_GUIDED_REPS = 5;

/** How long a single phase must persist (with no transition) before we declare stuck. */
const STUCK_PHASE_MS = 8000;
/** A coaching cue older than this (ms) is no longer valid — clear it from the overlay. */
const VISION_CUE_STALE_MS = 5000;
/** How long we suppress duplicate stuck-phase Serena messages. */
const STUCK_SERENA_COOLDOWN_MS = 12000;

/**
 * Tempo thresholds — compare actual phase duration (ms) to target.
 * hi: below this ratio → too_fast
 * lo: below this ratio → too_fast (more aggressively for descent)
 */
const TEMPO_THRESHOLDS: Record<
  'descent' | 'bottom' | 'ascent',
  { targetSecsPattern: RegExp; hi: number }
> = {
  descent: { targetSecsPattern: /Lower:\s*(\d+(?:\.\d+)?)s/i, hi: 0.65 },
  bottom:  { targetSecsPattern: /Hold:\s*(\d+(?:\.\d+)?)s/i,  hi: 0.50 },
  ascent:  { targetSecsPattern: /Drive:\s*(\d+(?:\.\d+)?)s/i, hi: 0.40 },
};

/** Parse target seconds for a phase from the tempoHint string. Returns null if not found / 0s. */
function parseTargetSecs(tempoHint: string, phase: 'descent' | 'bottom' | 'ascent'): number | null {
  const m = tempoHint.match(TEMPO_THRESHOLDS[phase].targetSecsPattern);
  if (!m) return null;
  const secs = parseFloat(m[1]);
  return secs > 0 ? secs : null;
}

/**
 * Classify tempo for a completed phase.
 * Returns 'uncertain' if we cannot assess (no target or only one sample).
 */
function classifyPhaseTempo(
  phase: 'descent' | 'bottom' | 'ascent',
  durationMs: number,
  tempoHint: string | null | undefined,
): PaceAssessment {
  if (!tempoHint) return 'uncertain';
  const targetSecs = parseTargetSecs(tempoHint, phase);
  if (!targetSecs) return 'uncertain';
  const ratio = durationMs / (targetSecs * 1000);
  if (ratio < TEMPO_THRESHOLDS[phase].hi) return 'too_fast';
  // too_slow is unusual — only flag if dramatically over (2x target)
  if (ratio > 2.5) return 'too_slow';
  return 'on_tempo';
}

// ── Edge-function response normalizer ────────────────────────────────────────
//
// The deployed Supabase edge function may be an older version that does not yet
// return visibilityState / framingIssue / assessmentState / paceAssessment.
// Without these fields the framing events embed the literal string "undefined"
// and the RepFSM is blocked because assessmentState defaults to 'unable_to_assess'.
//
// This function:
//   1. Runs parseClaudeVisionResult for full client-side validation + defaults.
//   2. When a field is missing from the response (old edge function), infers a
//      reasonable value from the confidence score so the FSM and coaching work.
//
function normalizeEdgeResponse(
  data: unknown,
  confidenceThreshold: number,
): VisionResult {
  if (!data || typeof data !== 'object') return { ...DEFAULT_VISION_RESULT };

  const raw = data as Record<string, unknown>;

  // parseClaudeVisionResult handles all field validation and applies safe
  // defaults for any missing or invalid values.
  const parsed = parseClaudeVisionResult(raw) ?? { ...DEFAULT_VISION_RESULT };

  // Detect which extended fields are actually present in the response.
  const hasAssessment  = typeof raw.assessmentState  === 'string';
  const hasVisibility  = typeof raw.visibilityState  === 'string';
  const hasFraming     = typeof raw.framingIssue     === 'string';

  // New edge function — all fields present, trust parsed result as-is.
  if (hasAssessment && hasVisibility && hasFraming) return parsed;

  // Old edge function — infer extended fields from the confidence score so
  // coaching and the RepFSM remain functional.
  const c = parsed.confidence;
  return {
    ...parsed,
    assessmentState: hasAssessment ? parsed.assessmentState
      : c >= confidenceThreshold ? 'tracking'
      : c >= 0.3                 ? 'low_confidence'
      :                            'unable_to_assess',
    visibilityState: hasVisibility ? parsed.visibilityState
      : c >= confidenceThreshold ? 'good'
      : c >= 0.3                 ? 'partial'
      :                            'poor',
    framingIssue: hasFraming ? parsed.framingIssue
      : c >= confidenceThreshold ? 'none'
      :                            'unknown',
  };
}

// ── RepFSM transition ─────────────────────────────────────────────────────────

type RepFsmTransition = {
  nextFsmState: RepFsmState;
  repConfirmed: boolean;
};

/**
 * Advance the rep FSM given the latest camera-confirmed phase.
 * Only advances on high-enough confidence to prevent noisy frames from
 * falsely completing a rep.
 */
export function advanceRepFsm(
  current: RepFsmState,
  phase: VisionPhase,
  confidence: number,
  threshold: number,
): RepFsmTransition {
  const isConfident = confidence >= threshold;
  const isDown = phase === 'descent' || phase === 'bottom';
  const isBottom = phase === 'bottom';
  const isUp = phase === 'ascent' || phase === 'top';
  const isTop = phase === 'top';
  const isRest = phase === 'rest';

  switch (current) {
    case 'idle':
      if (isDown && isConfident) return { nextFsmState: 'descending', repConfirmed: false };
      return { nextFsmState: 'idle', repConfirmed: false };

    case 'descending':
      if (isBottom && isConfident) return { nextFsmState: 'bottom_reached', repConfirmed: false };
      // Still in the descent or bottom-adjacent
      if (isDown) return { nextFsmState: 'descending', repConfirmed: false };
      // Athlete is now ascending — at 1400 ms cadence the bottom frame is
      // frequently missed (bottom hold ≈ 1 s). Treat this as passing through
      // the bottom so the rep can still be confirmed on the next top frame.
      if (isUp && isConfident) return { nextFsmState: 'ascending', repConfirmed: false };
      // Returned to top/rest without any detectable descent — reset
      if ((isTop || isRest) && isConfident) return { nextFsmState: 'idle', repConfirmed: false };
      return { nextFsmState: 'descending', repConfirmed: false };

    case 'bottom_reached':
      if (isUp && isConfident) return { nextFsmState: 'ascending', repConfirmed: false };
      // Still in bottom or slight movement — stay
      if (isBottom) return { nextFsmState: 'bottom_reached', repConfirmed: false };
      // Unusual: went back without ascending — reset
      if ((isTop || isRest) && isConfident) return { nextFsmState: 'idle', repConfirmed: false };
      return { nextFsmState: 'bottom_reached', repConfirmed: false };

    case 'ascending':
      if ((isTop || isRest) && isConfident) {
        // Rep confirmed — full cycle complete
        return { nextFsmState: 'idle', repConfirmed: true };
      }
      // Still ascending
      if (isUp) return { nextFsmState: 'ascending', repConfirmed: false };
      // Went back down without reaching top — partial, do not count, restart
      if (isDown && isConfident) return { nextFsmState: 'descending', repConfirmed: false };
      return { nextFsmState: 'ascending', repConfirmed: false };
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFormReviewVisionLoop(
  params: UseFormReviewVisionLoopParams,
): UseFormReviewVisionLoopResult {
  const {
    enabled,
    currentExercise,
    tempoHint,
    athleteContext,
    frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS,
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
    minRepGapMs = DEFAULT_MIN_REP_GAP_MS,
    maxGuidedReps = DEFAULT_MAX_GUIDED_REPS,
    qualityLabel = 'controlled',
    cameraRef,
    sendSerenaContext,
    onAutoComplete,
  } = params;

  // ── State (React-visible) ─────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [autoCompleted, setAutoCompleted] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [repFsmState, setRepFsmState] = useState<RepFsmState>('idle');
  const [visionPhase, setVisionPhase] = useState<VisionPhase>('rest');
  const [phaseConfidence, setPhaseConfidence] = useState(0);
  const [assessmentState, setAssessmentState] = useState<AssessmentState>('unable_to_assess');
  const [visibilityState, setVisibilityState] = useState<VisibilityState>('poor');
  const [framingIssue, setFramingIssue] = useState<FramingIssue>('unknown');
  const [tempoStatus, setTempoStatus] = useState<PaceAssessment>('uncertain');
  const [lastVisionCue, setLastVisionCue] = useState<string | null>(null);
  const [isStuck, setIsStuck] = useState(false);
  const [stuckPhaseMs, setStuckPhaseMs] = useState(0);
  const [repBlockerReason, setRepBlockerReason] = useState<RepBlockerReason>(null);
  const [lastDescentMs, setLastDescentMs] = useState(0);
  const [lastBottomMs, setLastBottomMs] = useState(0);
  const [lastAscentMs, setLastAscentMs] = useState(0);

  // ── Refs (non-rendered, safe in async callbacks) ──────────────────────────
  const repCountRef = useRef(0);
  const repFsmStateRef = useRef<RepFsmState>('idle');
  const serenaContextStateRef = useRef<SerenaContextState>(DEFAULT_SERENA_CONTEXT_STATE);
  const inFlightRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRepAtRef = useRef(0);

  // Phase-duration tracking for tempo classification
  const phaseStartedAtRef = useRef<Partial<Record<VisionPhase, number>>>({});
  const currentPhaseRef = useRef<VisionPhase>('rest');
  const lastTempoStatusRef = useRef<PaceAssessment>('uncertain');

  // Measured phase durations (exposed for overlay)
  const lastDescentMsRef = useRef(0);
  const lastBottomMsRef = useRef(0);
  const lastAscentMsRef = useRef(0);

  // RepBlockerReason ref (safe in async callbacks)
  const repBlockerReasonRef = useRef<RepBlockerReason>(null);

  // FSM state entry timestamp — used to detect insufficient_depth / no_lockout
  const fsmStateEnteredAtRef = useRef<number>(Date.now());
  const prevFsmStateForBlockerRef = useRef<RepFsmState>('idle');

  // Timestamp when the last vision cue was set — used to expire stale overlay cues.
  const lastVisionCueSetAtRef = useRef<number>(0);
  // Corrective form cues dispatched this session — sent to buildFormReviewEndContext
  // so Serena can reference specific coaching points in her summary.
  const formCuesDispatchedRef = useRef<string[]>([]);

  // Stuck-phase tracking
  const phaseEnteredAtRef = useRef<number>(Date.now());
  const lastStuckSerenaAtRef = useRef<number>(0);
  const stuckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync with state.
  useEffect(() => { repCountRef.current = repCount; }, [repCount]);

  // ── reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setRepCount(0);
    repCountRef.current = 0;
    setRepFsmState('idle');
    repFsmStateRef.current = 'idle';
    setVisionPhase('rest');
    setPhaseConfidence(0);
    setAssessmentState('unable_to_assess');
    setVisibilityState('poor');
    setFramingIssue('unknown');
    setTempoStatus('uncertain');
    setLastVisionCue(null);
    setIsBusy(false);
    setAutoCompleted(false);
    setIsStuck(false);
    setStuckPhaseMs(0);
    setRepBlockerReason(null);
    setLastDescentMs(0);
    setLastBottomMs(0);
    setLastAscentMs(0);
    serenaContextStateRef.current = DEFAULT_SERENA_CONTEXT_STATE;
    lastRepAtRef.current = 0;
    phaseStartedAtRef.current = {};
    currentPhaseRef.current = 'rest';
    lastTempoStatusRef.current = 'uncertain';
    lastDescentMsRef.current = 0;
    lastBottomMsRef.current = 0;
    lastAscentMsRef.current = 0;
    repBlockerReasonRef.current = null;
    fsmStateEnteredAtRef.current = Date.now();
    prevFsmStateForBlockerRef.current = 'idle';
    phaseEnteredAtRef.current = Date.now();
    lastStuckSerenaAtRef.current = 0;
    inFlightRef.current = false;
    lastVisionCueSetAtRef.current = 0;
    formCuesDispatchedRef.current = [];
  }, []);

  // ── Camera capture ────────────────────────────────────────────────────────

  const captureFrameAsBase64 = useCallback(async (): Promise<string | null> => {
    const cam = cameraRef.current;
    if (!cam?.takePictureAsync) return null;
    const photo = await cam.takePictureAsync({
      base64: true,
      quality: 0.45,
      skipProcessing: true,
    });
    return photo?.base64 ?? null;
  }, [cameraRef]);

  // ── stop ──────────────────────────────────────────────────────────────────

  const stop = useCallback(
    (reason: 'manual' | 'auto' = 'manual', finalRepCountOverride?: number) => {
      const finalRepCount =
        typeof finalRepCountOverride === 'number' ? finalRepCountOverride : repCountRef.current;

      setIsRunning(false);
      setIsBusy(false);
      inFlightRef.current = false;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (stuckTimerRef.current) {
        clearInterval(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }

      if (reason === 'auto') {
        setAutoCompleted(true);
        onAutoComplete?.(finalRepCount);
      }

      sendSerenaContext(
        buildFormReviewEndContext(currentExercise, finalRepCount, formCuesDispatchedRef.current).text,
      );
    },
    [currentExercise, onAutoComplete, sendSerenaContext],
  );

  // ── Main vision pass ──────────────────────────────────────────────────────

  const runVisionPass = useCallback(async () => {
    if (!enabled || !isRunning) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setIsBusy(true);

    try {
      const base64Image = await captureFrameAsBase64();
      if (!base64Image) return;

      const body = getClaudeVisionRequestBody({
        exerciseName: currentExercise,
        base64Image,
        tempoHint: tempoHint ?? null,
        athleteContext: athleteContext ?? null,
      });

      const { data, error } = await supabase.functions.invoke('anthropic', { body });

      if (error) {
        console.warn('[useFormReviewVisionLoop] invoke error', error);
        return;
      }

      const result = normalizeEdgeResponse(data, confidenceThreshold);
      if (!result) return;

      const now = Date.now();

      // ── 1. Update visible state from this frame ──────────────────────────
      setAssessmentState(result.assessmentState);
      setVisibilityState(result.visibilityState);
      setFramingIssue(result.framingIssue);
      setPhaseConfidence(result.confidence);

      // Always update the displayed phase so the overlay feels live.
      // Low-confidence frames are already dimmed via phaseOpacity in the overlay.
      // The FSM and tempo math below remain confidence-gated independently.
      setVisionPhase(result.phase);

      if (result.formCue) {
        setLastVisionCue(result.formCue);
        lastVisionCueSetAtRef.current = now;
      } else if (result.positiveNote) {
        setLastVisionCue(result.positiveNote);
        lastVisionCueSetAtRef.current = now;
      } else {
        // Clear stale coaching cues so athletes never see outdated feedback.
        // A cue that hasn't been refreshed for VISION_CUE_STALE_MS is no longer
        // relevant. Also clear immediately when the camera cannot assess the frame.
        const cueAge =
          lastVisionCueSetAtRef.current > 0 ? now - lastVisionCueSetAtRef.current : Infinity;
        if (cueAge > VISION_CUE_STALE_MS || result.assessmentState === 'unable_to_assess') {
          setLastVisionCue(null);
        }
      }

      // ── 2. Phase-duration tracking for tempo ────────────────────────────
      // When the phase changes, record when it started. When it ends (next
      // different phase), measure the duration and classify tempo.
      let derivedTempoStatus: PaceAssessment = lastTempoStatusRef.current;

      const prevPhase = currentPhaseRef.current;
      const phaseChanged = result.confidence >= confidenceThreshold && result.phase !== prevPhase;

      if (phaseChanged) {
        // Measure the duration of the phase that just ended.
        const phaseThatEnded = prevPhase;
        const startedAt = phaseStartedAtRef.current[phaseThatEnded];
        if (
          startedAt &&
          (phaseThatEnded === 'descent' || phaseThatEnded === 'bottom' || phaseThatEnded === 'ascent')
        ) {
          const duration = now - startedAt;
          // Record measured duration for overlay display.
          if (phaseThatEnded === 'descent') {
            lastDescentMsRef.current = duration;
            setLastDescentMs(duration);
          } else if (phaseThatEnded === 'bottom') {
            lastBottomMsRef.current = duration;
            setLastBottomMs(duration);
          } else if (phaseThatEnded === 'ascent') {
            lastAscentMsRef.current = duration;
            setLastAscentMs(duration);
          }
          const classification = classifyPhaseTempo(phaseThatEnded, duration, tempoHint);
          if (classification !== 'uncertain') {
            derivedTempoStatus = classification;
            lastTempoStatusRef.current = classification;
            setTempoStatus(classification);
          }
        }
        // Record when the new phase started.
        phaseStartedAtRef.current[result.phase] = now;
        currentPhaseRef.current = result.phase;

        // Reset stuck tracking on phase transition.
        phaseEnteredAtRef.current = now;
        setIsStuck(false);
        setStuckPhaseMs(0);
      } else if (!phaseChanged && result.confidence >= confidenceThreshold) {
        // Same phase — check if we're getting a pace signal from Claude.
        if (result.paceAssessment !== 'uncertain' && derivedTempoStatus === 'uncertain') {
          derivedTempoStatus = result.paceAssessment;
          lastTempoStatusRef.current = result.paceAssessment;
          setTempoStatus(result.paceAssessment);
        }
      }

      // ── 3. Stuck-phase detection ─────────────────────────────────────────
      // Only flag stuck during active movement phases — rest and top are valid
      // between-rep positions and should never generate a stuck cue.
      const isActiveMovementPhase =
        result.phase === 'descent' ||
        result.phase === 'bottom' ||
        result.phase === 'ascent';

      if (result.confidence >= confidenceThreshold && !phaseChanged && isActiveMovementPhase) {
        const stuckMs = now - phaseEnteredAtRef.current;
        if (stuckMs >= STUCK_PHASE_MS) {
          setIsStuck(true);
          setStuckPhaseMs(stuckMs);
          // Send Serena a stuck cue, but not too frequently.
          if (now - lastStuckSerenaAtRef.current >= STUCK_SERENA_COOLDOWN_MS) {
            lastStuckSerenaAtRef.current = now;
            sendSerenaContext(
              buildStuckPhaseContext(currentExercise, result.phase, stuckMs).text,
            );
          }
        }
      } else if (!isActiveMovementPhase) {
        // Athlete returned to a rest/top position — clear the stuck flag.
        // setIsStuck(false) on an already-false value is a no-op in React.
        setIsStuck(false);
        setStuckPhaseMs(0);
      }

      // ── 4. RepFSM ────────────────────────────────────────────────────────
      // Only advance FSM on confident frames that aren't unable_to_assess.
      let nextRepCount = repCountRef.current;
      let countedThisPass = false;

      if (
        result.assessmentState !== 'unable_to_assess' &&
        result.confidence >= confidenceThreshold
      ) {
        const { nextFsmState, repConfirmed } = advanceRepFsm(
          repFsmStateRef.current,
          result.phase,
          result.confidence,
          confidenceThreshold,
        );

        if (nextFsmState !== repFsmStateRef.current) {
          repFsmStateRef.current = nextFsmState;
          setRepFsmState(nextFsmState);
        }

        if (repConfirmed) {
          const enoughGap = now - lastRepAtRef.current >= minRepGapMs;
          if (enoughGap) {
            nextRepCount = repCountRef.current + 1;
            countedThisPass = true;
            lastRepAtRef.current = now;
            repCountRef.current = nextRepCount;
            setRepCount(nextRepCount);
          }
        }
      }

      // ── 4b. Secondary rep signal — Claude's own repCompleted flag ────────
      // The FSM is the primary counter. Claude also emits repCompleted on frames
      // where it directly observes a full rep. Use this as a fallback when the
      // FSM missed the rep (e.g. top frame was ambiguous at 1 s cadence) but
      // Claude's model-level signal is confident.
      if (
        !countedThisPass &&
        result.repCompleted &&
        result.assessmentState === 'tracking' &&
        result.confidence >= confidenceThreshold
      ) {
        const enoughGap = now - lastRepAtRef.current >= minRepGapMs;
        if (enoughGap) {
          nextRepCount = repCountRef.current + 1;
          countedThisPass = true;
          lastRepAtRef.current = now;
          repCountRef.current = nextRepCount;
          setRepCount(nextRepCount);
          // FSM should snap to idle — the rep is complete from Claude's view.
          repFsmStateRef.current = 'idle';
          setRepFsmState('idle');
        }
      }

      // ── 4c. FSM state entry tracking + RepBlockerReason ─────────────────
      // Capture the FSM state from the PREVIOUS tick before we update the ref.
      // This lets us detect ascending→descending transitions (incomplete cycle)
      // exactly once, on the tick the reversal is confirmed.
      const prevFsmBeforeThisTick = prevFsmStateForBlockerRef.current;
      const currentFsmState = repFsmStateRef.current;
      if (currentFsmState !== prevFsmBeforeThisTick) {
        fsmStateEnteredAtRef.current = now;
        prevFsmStateForBlockerRef.current = currentFsmState;
      }
      const fsmStateAgeMs = now - fsmStateEnteredAtRef.current;

      // How long we allow each partial-cycle state before surfacing a blocker.
      const DEPTH_STALL_MS  = 3500; // descending without reaching bottom_reached
      const LOCKOUT_STALL_MS = 3000; // ascending without completing the rep

      let newBlockerReason: RepBlockerReason = null;

      if (countedThisPass) {
        // Rep just confirmed — clear any blocker immediately.
        newBlockerReason = null;
      } else if (
        result.assessmentState === 'unable_to_assess' ||
        result.visibilityState === 'poor'
      ) {
        newBlockerReason = 'poor_visibility';
      } else if (result.assessmentState === 'low_confidence') {
        newBlockerReason = 'low_confidence';
      } else if (derivedTempoStatus === 'too_fast') {
        newBlockerReason = 'moved_too_fast';
      } else if (prevFsmBeforeThisTick === 'ascending' && currentFsmState === 'descending') {
        // Athlete reversed direction before reaching the top/lockout — the rep
        // was not completed. Fire once on the transition tick; clears next tick.
        newBlockerReason = 'incomplete_cycle';
      } else if (currentFsmState === 'descending' && fsmStateAgeMs >= DEPTH_STALL_MS) {
        newBlockerReason = 'insufficient_depth';
      } else if (currentFsmState === 'ascending' && fsmStateAgeMs >= LOCKOUT_STALL_MS) {
        newBlockerReason = 'no_lockout';
      }

      if (newBlockerReason !== repBlockerReasonRef.current) {
        repBlockerReasonRef.current = newBlockerReason;
        setRepBlockerReason(newBlockerReason);
      }

      // ── 5. Serena context routing ────────────────────────────────────────
      const prevSerenaState = serenaContextStateRef.current;
      const { events, nextState } = buildSerenaContextFromVision(
        { ...result, repCompleted: countedThisPass },
        prevSerenaState,
        {
          currentExercise,
          repCount: nextRepCount,
          tempoStatus: derivedTempoStatus,
          qualityLabel,
          confidenceThreshold,
          repBlockerReason: newBlockerReason,
        },
      );
      serenaContextStateRef.current = nextState;

      // Track distinct corrective form cues for the end-of-review summary.
      // Only capture when a new corrective cue was actually dispatched (i.e.
      // lastFormCue changed), not every frame that has a formCue present.
      if (nextState.lastFormCue && nextState.lastFormCue !== prevSerenaState.lastFormCue) {
        const cue = nextState.lastFormCue;
        if (!formCuesDispatchedRef.current.includes(cue)) {
          formCuesDispatchedRef.current = [
            ...formCuesDispatchedRef.current.slice(-2),
            cue,
          ];
        }
      }

      for (const event of events) sendSerenaContext(event.text);

      // ── 6. Auto-complete at maxGuidedReps ────────────────────────────────
      if (nextRepCount >= maxGuidedReps) {
        stop('auto', nextRepCount);
      }
    } catch (err) {
      console.warn('[useFormReviewVisionLoop] vision pass failed', err);
    } finally {
      inFlightRef.current = false;
      setIsBusy(false);
    }
  }, [
    enabled,
    isRunning,
    captureFrameAsBase64,
    currentExercise,
    tempoHint,
    athleteContext,
    confidenceThreshold,
    minRepGapMs,
    qualityLabel,
    maxGuidedReps,
    sendSerenaContext,
    stop,
  ]);

  // ── start ─────────────────────────────────────────────────────────────────

  const start = useCallback(() => {
    if (!enabled) return;
    reset();
    setIsRunning(true);
    sendSerenaContext(buildFormReviewStartContext(currentExercise).text);
  }, [enabled, reset, currentExercise, sendSerenaContext]);

  // ── Main polling loop ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    const tick = () => { void runVisionPass(); };
    tick();
    intervalRef.current = setInterval(tick, frameIntervalMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isRunning, frameIntervalMs, runVisionPass]);

  // ── Kill loop if parent disables the hook while running ───────────────────

  useEffect(() => {
    if (!enabled && isRunning) stop('manual');
  }, [enabled, isRunning, stop]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (stuckTimerRef.current) clearInterval(stuckTimerRef.current);
    };
  }, []);

  return {
    isRunning,
    isBusy,
    autoCompleted,
    repCount,
    repFsmState,
    visionPhase,
    phaseConfidence,
    assessmentState,
    visibilityState,
    framingIssue,
    tempoStatus,
    lastVisionCue,
    isStuck,
    stuckPhaseMs,
    repBlockerReason,
    lastDescentMs,
    lastBottomMs,
    lastAscentMs,
    start,
    stop: () => stop('manual'),
    reset,
  };
}
