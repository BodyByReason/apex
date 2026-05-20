// SerenaProtoScreen — live AI coaching prototype.
// Voice: ElevenLabs useConversation via LiveKit WebRTC (same as Talk to Serena).
// Vision (Normal set): Gemini 2.0 Flash via gemini-vision edge function, 400 ms cadence.
//   Frame → gemini-vision → phase/cue JSON → serena.sendContext() → Serena speaks.
// Vision (Form Review): useFormReviewVisionLoop hook — Claude Sonnet 4.6 via anthropic
//   edge function, 1000 ms cadence. Manages its own camera capture cycle, Serena
//   context events, and auto-completion at maxGuidedReps. Fully decoupled from inVision.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { supabase } from '@/lib/supabase';
import { useFormReviewVisionLoop } from '@/hooks/useFormReviewVisionLoop';
import { useSerenaLiveSession } from '@/hooks/useSerenaLiveSession';
import { FormReviewTempoOverlay } from '@/components/FormReviewTempoOverlay';
import { TempoAssistCard } from '@/components/TempoAssistCard';
import type { WorkoutProgramDay } from '@/lib/plans';
// MainStackParamList no longer exposes 'SerenaProto' (route removed at launch
// per RECONCILED_DECISIONS_V2 §5.3). The route param type for this dead-code
// screen is declared inline below.
import { PROFILE_STORAGE_KEY } from '@/screens/GoalSetupScreen';

const SERENA_AVATAR = require('../../assets/serena-coach.png');

// ── Vision / rep-counting tuning knobs ──────────────────────────────────────
// Frame cadence — Gemini Flash (~300ms) fits well inside 400ms.
// isAnalyzingRef drops ticks that fire while a call is still in flight.
const FRAME_INTERVAL_MS = 400;
// Fastest plausible rep — guards against double-counting at high cadence.
const MIN_REP_MS = 600;
// Confidence threshold: frames at or above this bypass smoothing entirely
// and transition the FSM immediately. Below it, the 2-frame window votes.
const HIGH_CONFIDENCE = 0.82;
// How long the same form cue is suppressed after being spoken (anti-nag).
const CUE_THROTTLE_MS = 6000;
// Minimum gap between any two cues (non-critical).
const CUE_COOLDOWN_MS = 2000;
// Critical cues can interrupt sooner.
const CRITICAL_COOLDOWN_MS = 800;

type VisionCue = {
  phase: 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';
  /** Model certainty about the phase (0.0 – 1.0). */
  confidence: number;
  /** ≤ 5-word spoken coaching cue. Null when form is fine (Claude) or always present (Gemini). */
  formCue: string | null;
  severity: 'positive' | 'tip' | 'fix' | 'critical' | null;
  // ── Claude-only fields (Form Review mode) ────────────────────────────────
  /** True when Claude detects a complete rep transition in this frame. */
  repCompleted?: boolean;
  /** Short praise phrase when form is excellent, e.g. "Perfect depth!". Null otherwise. */
  positiveNote?: string | null;
};

// ── Rep-counting state machine ───────────────────────────────────────────────
// Three-state FSM that persists the "seen descent" signal across noisy frames.
//
//   idle ──(down)──▶ lowering ──(up)──▶ rising ──(down)──▶ lowering
//                      │                  │
//                   (timeout)          (top/rest)
//                      ▼                  ▼
//                     idle              idle
//
// "down" = smoothed phase is descent | bottom
// "up"   = smoothed phase is ascent  | top
// A rep is counted on the lowering → rising transition (when debounce passes).

type RepState = 'idle' | 'lowering' | 'rising';

type PhaseFrame = { phase: VisionCue['phase']; confidence: number };

/**
 * Confidence-weighted smoothing over a 2-frame rolling window.
 *
 * Fast path: if the latest frame's confidence ≥ HIGH_CONFIDENCE, trust it
 * immediately — no smoothing lag at all. This is the common case for clear,
 * well-lit frames and cuts up to 400ms off the detection latency.
 *
 * Slow path: weight each candidate phase by its confidence score and pick
 * the winner. A single low-confidence bad frame loses to a confident prior.
 */
function smoothPhase(window: PhaseFrame[]): VisionCue['phase'] {
  if (window.length === 0) return 'rest';
  const latest = window[window.length - 1];
  // High-confidence read — act immediately, skip the vote.
  if (latest.confidence >= HIGH_CONFIDENCE) return latest.phase;
  // Confidence-weighted vote across the window.
  const scores = new Map<VisionCue['phase'], number>();
  for (const { phase, confidence } of window) {
    scores.set(phase, (scores.get(phase) ?? 0) + confidence);
  }
  let best = latest.phase;
  let bestScore = 0;
  for (const [phase, score] of scores) {
    if (score > bestScore) { best = phase; bestScore = score; }
  }
  return best;
}

/**
 * Pure state-machine transition — no side effects.
 * Returns the next state and whether a rep should be counted.
 */
function advanceRepState(
  state: RepState,
  smoothed: VisionCue['phase'],
  now: number,
  lastRepTime: number,
): { nextState: RepState; countRep: boolean } {
  const isDown = smoothed === 'descent' || smoothed === 'bottom';
  const isUp   = smoothed === 'ascent'  || smoothed === 'top';

  switch (state) {
    case 'idle':
      return { nextState: isDown ? 'lowering' : 'idle', countRep: false };

    case 'lowering':
      if (isUp) {
        // Count the rep only if enough time has passed (anti-double-count).
        const countRep = now - lastRepTime >= MIN_REP_MS;
        return { nextState: 'rising', countRep };
      }
      // Stay in lowering even if one frame looks like top/rest (noisy frame).
      // 3-frame smoothing handles sustained rest; we don't need an extra timeout.
      return { nextState: 'lowering', countRep: false };

    case 'rising':
      if (isDown) return { nextState: 'lowering', countRep: false };
      if (isUp || smoothed === 'rest') return { nextState: 'idle', countRep: false };
      return { nextState: 'rising', countRep: false };
  }
}

// ── Tempo Assist types and helpers ──────────────────────────────────────────

type PaceStatus = 'on_tempo' | 'slightly_fast' | 'too_fast';

type TempoProfile = {
  descent: number; // seconds — eccentric / lowering
  bottom:  number; // seconds — bottom pause
  ascent:  number; // seconds — concentric / drive up
  top:     number; // seconds — top pause / reset
};

/**
 * Maps exercise names to a 4-part tempo profile (descent-bottom-ascent-top).
 * Add new patterns here to extend exercise-aware tempo guidance.
 */
function getTargetTempoForExercise(name?: string): TempoProfile {
  const n = (name ?? '').toLowerCase();
  if (/rdl|romanian|stiff.leg|deadlift/.test(n))
    return { descent: 3, bottom: 1, ascent: 1, top: 1 };
  if (/row|press|curl|fly|raise|extension|pulldown|pull.?up/.test(n))
    return { descent: 3, bottom: 0, ascent: 1, top: 1 };
  // Default: squat pattern (back squat, goblet, front, split, lunge, etc.)
  return { descent: 4, bottom: 1, ascent: 1, top: 0 };
}

/** Human-readable label for each vision phase shown on the Tempo overlay. */
function getDisplayPhase(phase: VisionCue['phase']): string {
  switch (phase) {
    case 'descent': return 'Lowering';
    case 'bottom':  return 'Pause';
    case 'ascent':  return 'Drive up';
    case 'top':
    case 'rest':    return 'Reset';
  }
}

/**
 * Single source-of-truth for the plain-English tempo description shown under
 * the rail. Both the label and any Serena speech must derive from this — never
 * from a hardcoded string — so the two can never drift out of sync.
 *
 * Examples:
 *   { descent:4, bottom:1, ascent:1, top:0 } → "Lower: 4s · Hold: 1s · Drive: 1s"
 *   { descent:4, bottom:2, ascent:0, top:1 } → "Lower: 4s · Hold: 2s · Drive: fast · Squeeze: 1s"
 */
function getTempoDescription(target: TempoProfile): string {
  const parts: string[] = [];
  parts.push(`Lower: ${target.descent}s`);
  if (target.bottom > 0) parts.push(`Hold: ${target.bottom}s`);
  parts.push(target.ascent > 0 ? `Drive: ${target.ascent}s` : 'Drive: fast');
  if (target.top > 0) parts.push(`Squeeze: ${target.top}s`);
  return parts.join(' · ');
}

/**
 * Classifies a completed phase duration against the target tempo.
 *
 * The descent (eccentric) phase is the highest priority: slower eccentrics
 * produce better form-review accuracy and training stimulus. Thresholds:
 *   ≥ 70 % of target → on_tempo
 *   ≥ 45 % of target → slightly_fast
 *   <  45 % of target → too_fast
 *
 * The bottom pause uses slightly looser thresholds (60 % / 30 %) because
 * brief touch-and-go style is legitimate for some movements.
 * Ascent and top are not penalised — only flagged if extremely fast.
 */
function classifyTempo(
  phase: VisionCue['phase'],
  observedMs: number,
  target: TempoProfile,
): PaceStatus {
  const grade = (seconds: number, hi: number, lo: number): PaceStatus => {
    const targetMs = seconds * 1000;
    if (targetMs < 300) return 'on_tempo'; // target ≈ 0 s — don't penalise
    if (observedMs >= targetMs * hi) return 'on_tempo';
    if (observedMs >= targetMs * lo) return 'slightly_fast';
    return 'too_fast';
  };
  switch (phase) {
    case 'descent': return grade(target.descent, 0.70, 0.45);
    case 'bottom':  return grade(target.bottom,  0.60, 0.30);
    case 'ascent':  return grade(target.ascent,  0.50, 0.25);
    default:        return 'on_tempo';
  }
}

/**
 * Majority vote over a small rolling buffer — prevents the pace chip from
 * flickering between states on noisy Gemini phase labels.
 */
function smoothPaceStatus(buffer: PaceStatus[]): PaceStatus {
  if (buffer.length === 0) return 'on_tempo';
  const c = { on_tempo: 0, slightly_fast: 0, too_fast: 0 };
  for (const s of buffer) c[s]++;
  return (Object.entries(c) as [PaceStatus, number][])
    .sort((a, b) => b[1] - a[1])[0][0];
}

// ── Workout context helpers ──────────────────────────────────────────────────

function parseSetsString(s: string): { sets: number; reps: number } {
  const m = s.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (!m) return { sets: 3, reps: 10 };
  return { sets: parseInt(m[1], 10), reps: parseInt(m[2], 10) };
}

function buildWorkoutContext(program: WorkoutProgramDay): string {
  const lines = program.exercises.map((ex, i) => {
    const { sets, reps } = parseSetsString(ex.sets);
    return `${i + 1}. ${ex.name} — ${sets} sets × ${reps} reps`;
  });
  return [
    `Workout: ${program.name}`,
    ...lines,
    '',
    'FEATURE: The athlete can tap "Review my form" to enter Form Review mode.',
    'In Form Review mode you receive real-time vision events and must coach proactively.',
    'You will receive [FORM_REVIEW_START], [REP], [FORM], [TEMPO], [FRAMING], [COUNTABILITY],',
    '[STUCK_PHASE], and [FORM_REVIEW_END] events. React to each with short coaching cues.',
    'During Form Review: silence from the athlete is EXPECTED — they are moving.',
    'NEVER ask "Are you still there?" during Form Review.',
  ].join('\n');
}

// ── Route type ───────────────────────────────────────────────────────────────
// SerenaProto route was removed from MainNavigator at launch per
// RECONCILED_DECISIONS_V2 §5.3. This screen is no longer mounted, but the
// file is kept in-tree for fast revival. The type is therefore declared
// inline rather than via the (now-absent) MainStackParamList entry.
type SerenaProtoRoute = RouteProp<
  { SerenaProto: { todayProgram: WorkoutProgramDay; athleteId: string; workoutId?: string } | undefined },
  'SerenaProto'
>;

// ── Pulsing speaking dot ─────────────────────────────────────────────────────

function SpeakingDot({ active }: { active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scale, { toValue: 1.4, duration: 500, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.5, duration: 500, useNativeDriver: true }),
          ]),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      scale.setValue(1);
      opacity.setValue(0.5);
    }
    return () => loopRef.current?.stop();
  }, [active, scale, opacity]);

  return (
    <Animated.View
      style={[
        styles.speakingDot,
        { transform: [{ scale }], opacity, backgroundColor: active ? '#3DDC84' : '#2A3942' },
      ]}
    />
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function SerenaProtoScreen() {
  const navigation = useNavigation();
  const route = useRoute<SerenaProtoRoute>();
  const serena = useSerenaLiveSession();

  // Optional workout ID — passed from the navigation caller when a workout
  // session already exists in the DB. Used to persist Form Review reps.
  const workoutId = route.params?.workoutId ?? null;

  const [camPerm, requestCamPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Blocks re-entry — drops ticks that fire while a Gemini call is in flight.
  const isAnalyzingRef = useRef(false);
  // ── Rep-counting state machine refs ────────────────────────────────────────
  // FSM state: idle → lowering → rising → idle
  const repStateRef = useRef<RepState>('idle');
  // Rolling 2-frame window for confidence-weighted smoothing.
  const phaseWindowRef = useRef<PhaseFrame[]>([]);
  // Timestamp of the last counted rep (enforces MIN_REP_MS between counts).
  const lastRepTimeRef = useRef<number>(0);
  // Last cue spoken — throttles repeated / rapid-fire form cues.
  const lastCueRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });
  // ── Coaching orchestration ──────────────────────────────────────────────────
  // Imperative rep counter: incremented synchronously on FSM confirm, no React
  // batching lag. This is the source of truth — repCount state is downstream.
  const repCountRef = useRef(0);
  // Coalescing buffer: newest confirmed rep overwrites any unsent prior rep.
  // Serena always speaks the LATEST count, never a stale one.
  const pendingRepRef = useRef<{ count: number; formCue: string } | null>(null);
  // 80ms debounce timer — fires after rapid reps settle, sends latest count.
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Tempo Assist refs ──────────────────────────────────────────────────────
  // Tracks when the current smoothed phase began (measures actual duration).
  const phaseStartRef = useRef<{ phase: VisionCue['phase']; startTime: number } | null>(null);
  // Last smoothed phase — detects transitions so we can measure completed phases.
  const smoothedPhaseRef = useRef<VisionCue['phase']>('rest');
  // Rolling 3-status buffer for pace smoothing — prevents chip flickering.
  const paceBufferRef = useRef<PaceStatus[]>([]);
  // Timestamp when continuous "too fast" streak began (gates Serena tempo cues).
  const tooFastStartRef = useRef<number | null>(null);
  // Timestamp of the last Serena tempo cue — heavy throttle, max once per 12 s.
  const lastTempoCueSentRef = useRef<number>(0);
  // Ref mirror of serena so interval callbacks always read the latest values
  // without needing serena in the useEffect dep array (which would restart the
  // interval on every isSpeaking / transcript change).
  const serenaRef = useRef(serena);
  serenaRef.current = serena;

  // Brief green camera flash when a rep is confirmed — triggers from inside the
  // interval callback via .start() without touching React state.
  const repFlashAnim = useRef(new Animated.Value(0)).current;

  // Tracks previous Form Review rep count so we can detect increments.
  const prevFormReviewRepCountRef = useRef(0);

  // Vision mode is now purely local state — no backend required.
  const [inVision, setInVision] = useState(false);
  const [repCount, setRepCount] = useState(0);
  // Gates the Form Review hook — set true when the user enters Form Review mode.
  const [formReviewEnabled, setFormReviewEnabled] = useState(false);

  // ── DB persistence for Form Review reps ──────────────────────────────────
  // Writes guided reps to workout_exercise_logs when the review completes.
  // Silently skips if workoutId is unavailable (e.g. standalone session).
  const persistFormReviewReps = useCallback(
    async (exerciseName: string, reps: number) => {
      if (!workoutId || reps <= 0 || !exerciseName) return;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from('workout_exercise_logs').insert({
          workout_id: workoutId,
          user_id: user.id,
          exercise_name: exerciseName,
          set_number: 1,
          reps,
          completed_at: new Date().toISOString(),
          notes: 'form_review',
        });
      } catch (err) {
        // Non-fatal — the rep data is visible in the UI regardless.
        console.warn('[SerenaProto] Failed to persist form review reps', err);
      }
    },
    [workoutId],
  );

  // ── Form Review hook ──────────────────────────────────────────────────────
  // Decoupled from inVision — has its own camera capture cycle and Serena
  // context routing. The screen only needs to call start() / stop().
  const sendSerenaContext = useCallback(
    (text: string) => serenaRef.current.sendContext(text),
    [],
  );

  // Stable reference — prevents hook's stop/runVisionPass callbacks from
  // being recreated (and the polling interval from being restarted) on every render.
  const onFormReviewAutoComplete = useCallback(
    (finalRepCount: number) => {
      setFormReviewEnabled(false);
      void persistFormReviewReps(serenaRef.current.currentExercise || '', finalRepCount);
    },
    [persistFormReviewReps],
  );

  const {
    isRunning: isFormReview,
    repCount: formReviewRepCount,
    visionPhase: formReviewPhase,
    phaseConfidence: formReviewPhaseConfidence,
    assessmentState: formReviewAssessmentState,
    visibilityState: formReviewVisibilityState,
    framingIssue: formReviewFramingIssue,
    tempoStatus: formReviewTempoStatus,
    repFsmState: formReviewRepFsmState,
    lastVisionCue,
    isStuck: formReviewIsStuck,
    autoCompleted: formReviewAutoCompleted,
    repBlockerReason: formReviewRepBlockerReason,
    lastDescentMs: formReviewLastDescentMs,
    lastBottomMs: formReviewLastBottomMs,
    lastAscentMs: formReviewLastAscentMs,
    start: startFormReviewLoop,
    stop: stopFormReviewLoop,
  } = useFormReviewVisionLoop({
    enabled: formReviewEnabled,
    currentExercise: serena.currentExercise || '',
    tempoHint: getTempoDescription(getTargetTempoForExercise(serena.currentExercise)),
    cameraRef: cameraRef as React.RefObject<{ takePictureAsync?: (opts: unknown) => Promise<{ base64?: string | null }> }>,
    sendSerenaContext,
    maxGuidedReps: 5,
    onAutoComplete: onFormReviewAutoComplete,
  });

  // Always-current ref so the countdown interval never captures a stale closure.
  const startFormReviewLoopRef = useRef(startFormReviewLoop);
  startFormReviewLoopRef.current = startFormReviewLoop;

  // Ref for formReviewRepCount so onEndFormReview always reads the latest count.
  const formReviewRepCountRef = useRef(formReviewRepCount);
  formReviewRepCountRef.current = formReviewRepCount;

  // Dismiss review state on auto-complete (hook already stopped itself).
  useEffect(() => {
    if (formReviewAutoCompleted) setFormReviewEnabled(false);
  }, [formReviewAutoCompleted]);

  // Fire the rep flash animation whenever Form Review confirms a new rep.
  // Reuses repFlashAnim — Normal and Form Review modes are mutually exclusive.
  useEffect(() => {
    if (formReviewRepCount > prevFormReviewRepCountRef.current) {
      repFlashAnim.setValue(0.28);
      Animated.timing(repFlashAnim, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }).start();
    }
    prevFormReviewRepCountRef.current = formReviewRepCount;
  }, [formReviewRepCount, repFlashAnim]);

  // ── Form Review inactivity suppression ────────────────────────────────────
  // ElevenLabs agents fire an inactivity prompt ("Are you still there?") when
  // the user goes silent for ~8–10 s. During Form Review the athlete is moving
  // — silence is expected. Sending a keepalive sendContextualUpdate every 9 s
  // counts as activity and prevents the idle nudge from firing.
  useEffect(() => {
    if (!isFormReview) return;
    const id = setInterval(() => {
      sendSerenaContext(
        '[FORM_REVIEW_ACTIVE] Athlete is mid-review and actively moving. ' +
        'Do NOT ask if they are still there. Continue monitoring.',
      );
    }, 9000);
    return () => clearInterval(id);
  }, [isFormReview, sendSerenaContext]);

  // Tempo Assist display state — updated on each phase transition.
  const [paceStatus, setPaceStatus] = useState<PaceStatus>('on_tempo');
  const [currentPhaseLabel, setCurrentPhaseLabel] = useState('Reset');
  // Smoothed phase as a typed key — drives the TempoRail active segment.
  const [smoothedPhase, setSmoothedPhase] = useState<VisionCue['phase']>('rest');
  // Milliseconds elapsed in the current phase — updated every 100 ms for smooth countdown.
  const [phaseElapsedMs, setPhaseElapsedMs] = useState(0);

  // 3-2-1 countdown before vision mode activates.
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Connect on mount ───────────────────────────────────────────────────────
  // Problem: React Strict Mode fires mount → cleanup → remount in dev builds.
  // Both invocations call connect(), which starts an async token fetch. Both
  // fetches complete and both call startSession() → two WebRTC peer connections
  // (PC 0 and PC 1) → ElevenLabs detects a duplicate session and closes both
  // with code 1001 "Stream end encountered".
  //
  // Fix: AbortController. The cleanup aborts the controller immediately; connect()
  // checks signal.aborted after the token fetch (before startSession()). Since the
  // Strict Mode cleanup fires in < 1 ms and the network fetch takes ~100–500 ms,
  // the first call always sees aborted=true and bails. The remount gets a fresh
  // controller → one clean session.
  useEffect(() => {
    const controller = new AbortController();
    const program = route.params?.todayProgram;
    const workoutContext = program ? buildWorkoutContext(program) : 'General workout';
    const firstExercise = program?.exercises[0]?.name ?? 'Workout';

    // Read the athlete's real first name from the stored profile.
    // params.athleteId is a Supabase UUID — never use it as a display name.
    AsyncStorage.getItem(PROFILE_STORAGE_KEY)
      .then((raw) => {
        if (controller.signal.aborted) return;
        const displayName =
          raw
            ? (JSON.parse(raw) as { displayName?: string }).displayName ?? 'Athlete'
            : 'Athlete';
        const firstName = displayName.split(' ')[0] || 'Athlete';
        console.log('[SerenaProto] mount — connect() start', { firstName, firstExercise });
        void serena.connect(workoutContext, firstName, firstExercise, controller.signal);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        void serena.connect(workoutContext, 'Athlete', firstExercise, controller.signal);
      });

    return () => {
      console.log('[SerenaProto] cleanup — aborting signal, calling disconnect()');
      controller.abort();
      void serena.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Camera frame capture during vision mode ────────────────────────────────
  // Gemini 2.0 Flash pipeline at 1 fps:
  //   takePictureAsync (URI) → FileSystem.readAsStringAsync (base64) →
  //   gemini-vision edge function → { cue, phase, severity } →
  //   phase-based rep counting + serena.sendContext()
  //
  // isAnalyzingRef blocks re-entry so a slow Gemini call (~300–500 ms) never
  // queues frames — it simply drops the next tick and retries the one after.
  useEffect(() => {
    if (!inVision) {
      if (frameTimerRef.current) {
        clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    (async () => {
      if (!camPerm?.granted) {
        const res = await requestCamPerm();
        if (!res.granted || cancelled) return;
      }

      // Reset all trackers whenever a new set starts.
      repStateRef.current = 'idle';
      phaseWindowRef.current = [];
      lastRepTimeRef.current = 0;
      lastCueRef.current = { text: '', time: 0 };
      repCountRef.current = 0;
      pendingRepRef.current = null;
      if (coalesceTimerRef.current) {
        clearTimeout(coalesceTimerRef.current);
        coalesceTimerRef.current = null;
      }
      // Reset Tempo Assist trackers.
      phaseStartRef.current = null;
      smoothedPhaseRef.current = 'rest';
      paceBufferRef.current = [];
      tooFastStartRef.current = null;
      setPaceStatus('on_tempo');
      setCurrentPhaseLabel('Reset');
      isAnalyzingRef.current = false;

      frameTimerRef.current = setInterval(async () => {
        const cam = cameraRef.current;
        if (!cam || isAnalyzingRef.current) return;
        isAnalyzingRef.current = true;
        try {
          const photo = await cam.takePictureAsync({
            base64: false,
            quality: 0.25,
            skipProcessing: true,
          });
          if (!photo?.uri) return;

          const b64 = await FileSystem.readAsStringAsync(photo.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });

          const { data, error } = await supabase.functions.invoke('gemini-vision', {
            body: {
              imageBase64: b64,
              exerciseName: serenaRef.current.currentExercise || 'exercise',
            },
          });

          if (error || !data) {
            console.warn('[vision] gemini-vision call failed:', error ?? 'empty response');
            return;
          }

          const vision = data as VisionCue;
          console.log('[vision]', vision.phase, vision.confidence.toFixed(2), '→ FSM:', repStateRef.current);
          const now = Date.now();

          // ── 1. Phase smoothing ─────────────────────────────────────────────
          // 2-frame confidence-weighted window. High-confidence frames bypass
          // voting and transition the FSM immediately (zero smoothing lag).
          const window = [
            ...phaseWindowRef.current.slice(-1),
            { phase: vision.phase, confidence: vision.confidence },
          ];
          phaseWindowRef.current = window;
          const smoothed = smoothPhase(window);

          // ── 1b. Tempo phase-duration tracking ─────────────────────────────
          // Detect phase transitions. When a phase ends, measure how long it
          // lasted and classify it against the target tempo profile.
          const prevSmoothed = smoothedPhaseRef.current;
          if (prevSmoothed !== smoothed) {
            setCurrentPhaseLabel(getDisplayPhase(smoothed));
            setSmoothedPhase(smoothed);
            setPhaseElapsedMs(0);
            if (phaseStartRef.current && phaseStartRef.current.phase === prevSmoothed) {
              const duration = now - phaseStartRef.current.startTime;
              const target = getTargetTempoForExercise(serenaRef.current.currentExercise);
              const classification = classifyTempo(prevSmoothed, duration, target);
              const buf = [...paceBufferRef.current.slice(-2), classification];
              paceBufferRef.current = buf;
              const newStatus = smoothPaceStatus(buf);
              setPaceStatus(newStatus);

              // ── Serena tempo cues (very conservative) ──────────────────────
              // Only speak when too_fast has persisted ≥ 3 s, and never within
              // 12 s of the last tempo cue. Rep events still take priority.
              if (newStatus === 'too_fast') {
                if (!tooFastStartRef.current) tooFastStartRef.current = now;
                const streak = now - tooFastStartRef.current;
                if (
                  streak >= 3000 &&
                  now - lastTempoCueSentRef.current >= 12000 &&
                  !pendingRepRef.current
                ) {
                  lastTempoCueSentRef.current = now;
                  serenaRef.current.sendContext(
                    '[TEMPO] Athlete is moving too fast — form review is unreliable. ' +
                    'Say one short plain-language cue to slow down the lowering phase, ' +
                    'like "slow the lower" or "control the descent." ' +
                    'Never say tempo numbers.',
                  );
                }
              } else {
                tooFastStartRef.current = null;
                if (
                  newStatus === 'on_tempo' &&
                  repCountRef.current > 1 &&
                  now - lastTempoCueSentRef.current >= 15000 &&
                  !pendingRepRef.current
                ) {
                  lastTempoCueSentRef.current = now;
                  serenaRef.current.sendContext(
                    '[TEMPO] Athlete is holding a great training tempo. ' +
                    'Give brief positive reinforcement in plain language. ' +
                    'Never say tempo numbers.',
                  );
                }
              }
            }
            phaseStartRef.current = { phase: smoothed, startTime: now };
            smoothedPhaseRef.current = smoothed;
          }

          // ── 2. State machine ───────────────────────────────────────────────
          // The FSM persists the "seen descent" signal across noisy frames so
          // a single bad label can't erase the downward movement.
          const { nextState, countRep } = advanceRepState(
            repStateRef.current,
            smoothed,
            now,
            lastRepTimeRef.current,
          );
          repStateRef.current = nextState;

          // ── 3. Count rep ───────────────────────────────────────────────────
          // Increment imperatively — no React batching. UI updates immediately.
          // Coalesce rapid reps: newest count overwrites any unsent prior count
          // so Serena always jumps to the latest number, never speaks stale ones.
          if (countRep) {
            lastRepTimeRef.current = now;
            repCountRef.current += 1;
            const confirmedCount = repCountRef.current;
            setRepCount(confirmedCount);

            // Flash the camera green — instant pop then quick fade.
            repFlashAnim.setValue(0.28);
            Animated.timing(repFlashAnim, {
              toValue: 0,
              duration: 450,
              useNativeDriver: true,
            }).start();

            pendingRepRef.current = { count: confirmedCount, formCue: vision.formCue ?? '' };
            if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
            coalesceTimerRef.current = setTimeout(() => {
              const pending = pendingRepRef.current;
              if (!pending) return;
              pendingRepRef.current = null;
              serenaRef.current.sendContext(`[REP:${pending.count}] ${pending.formCue}`);
            }, 80);

          // ── 4. Throttled form cues ─────────────────────────────────────────
          // Skip while a rep is pending — rep count always wins.
          } else if (vision.severity === 'fix' || vision.severity === 'critical') {
            if (!pendingRepRef.current) {
              const cooldown = vision.severity === 'critical' ? CRITICAL_COOLDOWN_MS : CUE_COOLDOWN_MS;
              const last = lastCueRef.current;
              const isDuplicate = last.text === vision.formCue && now - last.time < CUE_THROTTLE_MS;
              const isTooSoon = now - last.time < cooldown;
              if (!isDuplicate && !isTooSoon && vision.formCue) {
                lastCueRef.current = { text: vision.formCue, time: now };
                serenaRef.current.sendContext(`[FORM:${vision.severity}] ${vision.formCue}`);
              }
            }

          // ── 5. Praise (Gemini positive signal) ────────────────────────────
          } else if (vision.severity === 'positive' && repCountRef.current > 0) {
            if (!pendingRepRef.current && now - lastCueRef.current.time > 5000) {
              lastCueRef.current = { text: 'praise', time: now };
              serenaRef.current.sendContext(`[PRAISE:${repCountRef.current}]`);
            }
          }
        } catch {
          // Ignore frame capture / network errors — next tick retries.
        } finally {
          isAnalyzingRef.current = false;
        }
      }, FRAME_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (frameTimerRef.current) {
        clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
    };
  }, [inVision, camPerm?.granted, requestCamPerm]);

  // ── 100 ms ticker — drives smooth countdown in TempoAssistCard ───────────
  useEffect(() => {
    if (!inVision) return;
    const id = setInterval(() => {
      if (phaseStartRef.current) {
        setPhaseElapsedMs(Date.now() - phaseStartRef.current.startTime);
      }
    }, 100);
    return () => clearInterval(id);
  }, [inVision]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
    };
  }, []);

  // ── Vision mode handlers ───────────────────────────────────────────────────

  const onStartSet = useCallback(() => {
    if (countdownRef.current || inVision) return;
    if (!camPerm?.granted) requestCamPerm();
    setCountdown(3);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          setInVision(true);
          setRepCount(0);
          serenaRef.current.sendContext(
            `[SYSTEM] Vision mode is now active. Camera is on. ` +
            `Each [REP:N] event is one confirmed rep — say the rep number out loud ("One!", "Two!"). ` +
            `NEVER say "set" when counting reps. Give a brief form cue between reps. Max 6 words.`,
          );
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [inVision, camPerm?.granted, requestCamPerm]);

  const onEndSet = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(null);
      return;
    }
    setInVision(false);
    serenaRef.current.sendContext(
      `[SYSTEM] Vision mode ended. Camera is off. ` +
      `Reps counted this set: ${repCountRef.current}. ` +
      `Briefly acknowledge the set and ask for RPE out of 10.`,
    );
  }, []);

  // ── Form Review handlers ───────────────────────────────────────────────────

  const onStartFormReview = useCallback(() => {
    if (countdownRef.current || inVision || isFormReview) return;
    if (!camPerm?.granted) requestCamPerm();
    setFormReviewEnabled(true);
    setCountdown(3);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          // Use ref so we always call the version created after enabled flipped true.
          startFormReviewLoopRef.current();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [inVision, isFormReview, camPerm?.granted, requestCamPerm]);

  const onEndFormReview = useCallback(() => {
    // Cancel during countdown — clean up without starting the loop.
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(null);
      setFormReviewEnabled(false);
      return;
    }
    const finalReps = formReviewRepCountRef.current;
    stopFormReviewLoop();
    setFormReviewEnabled(false);
    // Persist reps from a manually-ended review (auto-complete handles its own path).
    void persistFormReviewReps(serenaRef.current.currentExercise || '', finalReps);
  }, [stopFormReviewLoop, persistFormReviewReps]);

  const onEndWorkout = useCallback(() => {
    serenaRef.current.sendContext(
      '[SYSTEM] Workout ended by athlete. Give a short, warm sign-off.',
    );
    void serena.disconnect();
    setTimeout(() => navigation.goBack(), 1500);
  }, [serena, navigation]);

  const showCamera = inVision || isFormReview || countdown !== null;

  // ── Tempo Assist derived display values ────────────────────────────────────
  // Single source of truth: everything — the numeric badge, the description
  // line, and any Serena speech — is derived from tempoTarget, never hardcoded.
  const tempoTarget = getTargetTempoForExercise(serena.currentExercise);
  const tempoDisplay = `${tempoTarget.descent}-${tempoTarget.bottom}-${tempoTarget.ascent}-${tempoTarget.top}`;
  const tempoDescription = getTempoDescription(tempoTarget);
  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backText}>✕</Text>
        </Pressable>
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerTitle}>Serena · Live</Text>
          {isFormReview && (
            <View style={styles.formReviewPill}>
              <Text style={styles.formReviewPillText}>FORM REVIEW</Text>
            </View>
          )}
        </View>
        <View style={[styles.connBadge, { backgroundColor: serena.connected ? '#13452B' : '#2A1A1A' }]}>
          <View style={[styles.connDot, { backgroundColor: serena.connected ? '#3DDC84' : serena.connecting ? '#FFB17A' : '#FF5A5F' }]} />
          <Text style={[styles.connText, { color: serena.connected ? '#3DDC84' : serena.connecting ? '#FFB17A' : '#FF5A5F' }]}>
            {serena.connected ? 'LIVE' : serena.connecting ? 'CONNECTING' : 'OFFLINE'}
          </Text>
        </View>
      </View>

      {showCamera ? (
        <>
          {/* Camera fills all available space — flex:1 stretches to push exercise strip down */}
          <View style={styles.cameraWrap}>
            {camPerm?.granted ? (
              <CameraView
                ref={(r) => { cameraRef.current = r; }}
                style={StyleSheet.absoluteFill}
                facing="front"
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.permPlaceholder]}>
                <Text style={styles.permText}>Camera permission needed</Text>
                <Pressable style={styles.grantBtn} onPress={requestCamPerm}>
                  <Text style={styles.grantBtnText}>Grant access</Text>
                </Pressable>
              </View>
            )}

            {/* 3-2-1 countdown overlay */}
            {countdown !== null && (
              <View pointerEvents="none" style={styles.countdownOverlay}>
                <Text style={styles.countdownNumber}>{countdown}</Text>
                <Text style={styles.countdownSub}>Get into position</Text>
              </View>
            )}

            {/* ── Normal set chrome (Gemini vision) ───────────────────── */}
            {inVision && (
              <>
                {/* Rep flash — full-camera green pop on every confirmed rep */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: '#3DDC84', opacity: repFlashAnim },
                  ]}
                />

                <View style={styles.watchingBadge}>
                  <View style={styles.watchingDot} />
                  <Text style={styles.watchingText}>SERENA IS WATCHING</Text>
                </View>

                {repCount > 0 && (
                  <View style={styles.repOverlay}>
                    <Text style={styles.repNumber}>{repCount}</Text>
                    <Text style={styles.repLabel}>REPS</Text>
                  </View>
                )}

                <View style={styles.visionPill}>
                  <Text style={styles.visionPillText}>VISION</Text>
                </View>

                <View style={styles.tempoOverlay}>
                  <TempoAssistCard
                    activePhase={smoothedPhase}
                    phaseElapsedMs={phaseElapsedMs}
                    tempoTarget={tempoTarget}
                    paceStatus={paceStatus}
                    tempoDisplay={tempoDisplay}
                    tempoDescription={tempoDescription}
                    lastCue={null}
                    repCount={repCount}
                  />
                </View>
              </>
            )}

            {/* ── Form Review chrome (Claude Vision) ──────────────────── */}
            {isFormReview && (
              <>
                {/* Rep flash — same green pop as Normal mode, fires on every confirmed rep */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: '#3DDC84', opacity: repFlashAnim, zIndex: 10 },
                  ]}
                />

                <View style={styles.watchingBadge}>
                  <View style={[styles.watchingDot, { backgroundColor: '#60C8FF' }]} />
                  <Text style={styles.watchingText}>FORM REVIEW · CLAUDE VISION</Text>
                </View>

                <FormReviewTempoOverlay
                  activePhase={formReviewPhase}
                  phaseConfidence={formReviewPhaseConfidence}
                  assessmentState={formReviewAssessmentState}
                  visibilityState={formReviewVisibilityState}
                  framingIssue={formReviewFramingIssue}
                  tempoStatus={formReviewTempoStatus}
                  repCount={formReviewRepCount}
                  repFsmState={formReviewRepFsmState}
                  maxReps={5}
                  lastVisionCue={lastVisionCue}
                  isStuck={formReviewIsStuck}
                  visible={isFormReview}
                  repBlockerReason={formReviewRepBlockerReason}
                  lastDescentMs={formReviewLastDescentMs}
                  lastBottomMs={formReviewLastBottomMs}
                  lastAscentMs={formReviewLastAscentMs}
                />
              </>
            )}
          </View>

          {/* Compact exercise strip — sits directly above the action buttons */}
          <View style={styles.cameraExerciseStrip}>
            <Text style={styles.exerciseEyebrow}>CURRENT EXERCISE</Text>
            <Text style={styles.exerciseName}>{serena.currentExercise || 'Workout'}</Text>
            <Text style={styles.exerciseMeta}>
              {serena.currentExercise ? `Set ${serena.setNumber}` : 'Get into position'}
            </Text>
          </View>
        </>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Serena card ── */}
          <View style={styles.serenaCard}>
            {/* Conversation mode — avatar + transcript */}
            <View style={styles.conversationArea}>
              <View style={styles.avatarRow}>
                <Image source={SERENA_AVATAR} style={styles.avatar} />
                <View style={styles.avatarMeta}>
                  <View style={styles.nameRow}>
                    <SpeakingDot active={serena.isSpeaking} />
                    <Text style={styles.coachName}>Serena</Text>
                    <Text style={styles.speakingLabel}>
                      {serena.isSpeaking ? ' · Speaking' : ' · Listening'}
                    </Text>
                  </View>
                  <View style={styles.modePill}>
                    <Text style={styles.modePillText}>CONVERSATION</Text>
                  </View>
                </View>
              </View>

              <View style={styles.transcriptBox}>
                <Text style={styles.transcriptText} numberOfLines={4}>
                  {serena.transcript || 'Just talk — log sets, ask for a form tip, or say "start set."'}
                </Text>
              </View>

              <Text style={styles.visionHint}>Tap Start Set to switch on camera vision</Text>
            </View>
          </View>

          {/* ── Exercise card ── */}
          <View style={styles.exerciseCard}>
            <Text style={styles.exerciseEyebrow}>CURRENT EXERCISE</Text>
            <Text style={styles.exerciseName}>{serena.currentExercise || 'Workout'}</Text>
            <Text style={styles.exerciseMeta}>
              {serena.currentExercise
                ? `Set ${serena.setNumber}`
                : 'Tell Serena your exercise, sets, reps, and weight'}
            </Text>
            {/* Form Review entry — only visible when exercise known, camera off, no active review */}
            {serena.currentExercise && !inVision && !isFormReview && countdown === null && (
              <Pressable style={styles.reviewBtn} onPress={onStartFormReview}>
                <Text style={styles.reviewBtnIcon}>◉</Text>
                <Text style={styles.reviewBtnText}>Review my form</Text>
              </Pressable>
            )}
          </View>

          {/* ── Logged sets ── */}
          {serena.loggedSets.length > 0 && (
            <View style={styles.logsCard}>
              <Text style={styles.logsTitle}>LOGGED SETS</Text>
              {serena.loggedSets.map((s, i) => (
                <View key={i} style={[styles.logRow, i < serena.loggedSets.length - 1 && styles.logRowBorder]}>
                  <Text style={styles.logIndex}>Set {i + 1}</Text>
                  <Text style={styles.logExercise}>{s.exercise}</Text>
                  <View style={styles.logStats}>
                    <Text style={styles.logStat}>{s.reps} reps</Text>
                    {s.weight > 0 && <Text style={styles.logStatMuted}>{s.weight} lbs</Text>}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── Error ── */}
          {serena.lastError && (
            <Text style={styles.error}>{serena.lastError}</Text>
          )}
        </ScrollView>
      )}

      {/* ── Action buttons ── */}
      <View style={styles.btnRow}>
        {isFormReview ? (
          <Pressable style={[styles.btn, styles.btnEndReview]} onPress={onEndFormReview}>
            <Text style={styles.btnText}>End Review</Text>
          </Pressable>
        ) : inVision ? (
          <Pressable style={[styles.btn, styles.btnEndSet]} onPress={onEndSet}>
            <Text style={styles.btnText}>End Set</Text>
          </Pressable>
        ) : countdown !== null ? (
          <Pressable
            style={[styles.btn, styles.btnCancel]}
            onPress={formReviewEnabled ? onEndFormReview : onEndSet}
          >
            <Text style={styles.btnText}>Cancel  {countdown}</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.btn, styles.btnStartSet]} onPress={onStartSet}>
            <Text style={styles.btnText}>Start Set</Text>
          </Pressable>
        )}
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={onEndWorkout}>
          <Text style={styles.btnGhostText}>End Workout</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0F12',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 10,
    gap: 10,
  },
  headerTitleCol: {
    flex: 1,
    gap: 3,
  },
  formReviewPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(96,200,255,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(96,200,255,0.35)',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  formReviewPillText: {
    color: '#60C8FF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1A2228',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: '#8FA1AB', fontSize: 14, fontWeight: '700' },
  headerTitle: {
    flex: 1,
    color: '#F2F4F5',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  connBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  connText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },

  serenaCard: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#11181D',
  },

  conversationArea: {
    padding: 18,
    gap: 14,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: '#3DDC84',
  },
  avatarMeta: { flex: 1, gap: 6 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  speakingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  coachName: {
    color: '#F2F4F5',
    fontSize: 18,
    fontWeight: '800',
  },
  speakingLabel: {
    color: '#8FA1AB',
    fontSize: 13,
    fontWeight: '500',
  },
  modePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#1B2A33',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  modePillText: {
    color: '#A6B5BD',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  transcriptBox: {
    backgroundColor: '#0B0F12',
    borderRadius: 12,
    padding: 14,
    minHeight: 68,
  },
  transcriptText: {
    color: '#C8D6DC',
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
  },
  visionHint: {
    color: '#4A5D66',
    fontSize: 12,
    textAlign: 'center',
  },

  cameraContainer: {
    aspectRatio: 3 / 4,
    width: '100%',
    backgroundColor: '#000',
  },

  // Camera-mode full-height layout — replaces cameraContainer when showCamera is true.
  // flex:1 fills all space between the header and the compact exercise strip.
  cameraWrap: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
  },

  // Compact exercise info shown below the camera, right above the action buttons.
  cameraExerciseStrip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 2,
  },
  permPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101418',
    gap: 12,
  },
  permText: { color: '#8FA1AB', fontSize: 14 },
  grantBtn: {
    backgroundColor: '#3DDC84',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  grantBtnText: { color: '#0B0F12', fontWeight: '700', fontSize: 13 },

  watchingBadge: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11,15,18,0.75)',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  watchingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3DDC84',
  },
  watchingText: {
    color: '#E6F4EC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  repOverlay: {
    position: 'absolute',
    // Positioned near the top of the camera frame, below the "SERENA IS
    // WATCHING" badge (~46 px). This keeps the large rep number visible
    // and clear of the Tempo Assist card at the bottom.
    top: 52,
    alignSelf: 'center',
    alignItems: 'center',
  },
  repNumber: {
    color: '#3DDC84',
    fontSize: 72,
    fontWeight: '900',
    lineHeight: 76,
  },
  repLabel: {
    color: '#3DDC84',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: -4,
  },
  visionPill: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: '#13452B',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  visionPillText: {
    color: '#3DDC84',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },

  // ── Tempo Assist card (lifted glass panel) ───────────────────────────────
  // Lifted off the bottom edge so the full rail clears the athlete's hips/bar.
  // Dark glass with border and shadow gives it depth over a busy camera feed.
  tempoOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(4,8,12,0.88)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 12,
    gap: 9,
    // Depth shadow so the card reads clearly over any camera content.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 14,
  },
  tempoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tempoHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tempoOverlayLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  tempoOverlayTarget: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  tempoChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  tempoChipText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  tempoDescription: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 11,
    letterSpacing: 0.2,
    textAlign: 'center',
  },

  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    marginTop: 10,
    backgroundColor: 'rgba(96,200,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(96,200,255,0.28)',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  reviewBtnIcon: {
    color: '#60C8FF',
    fontSize: 13,
    fontWeight: '700',
  },
  reviewBtnText: {
    color: '#60C8FF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  exerciseCard: {
    backgroundColor: '#11181D',
    borderRadius: 16,
    padding: 18,
    gap: 4,
  },
  exerciseEyebrow: {
    color: '#3DDC84',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  exerciseName: {
    color: '#F2F4F5',
    fontSize: 24,
    fontWeight: '800',
  },
  exerciseMeta: {
    color: '#8FA1AB',
    fontSize: 14,
  },

  logsCard: {
    backgroundColor: '#11181D',
    borderRadius: 16,
    padding: 18,
    gap: 0,
  },
  logsTitle: {
    color: '#4A5D66',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  logRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1A2228',
  },
  logIndex: {
    color: '#4A5D66',
    fontSize: 12,
    fontWeight: '700',
    width: 40,
  },
  logExercise: {
    flex: 1,
    color: '#C8D6DC',
    fontSize: 13,
    fontWeight: '600',
  },
  logStats: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  logStat: {
    color: '#F2F4F5',
    fontSize: 13,
    fontWeight: '700',
  },
  logStatMuted: {
    color: '#8FA1AB',
    fontSize: 12,
  },

  error: {
    color: '#FFB17A',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
  },

  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  countdownNumber: {
    fontSize: 112,
    fontWeight: '900',
    color: '#FFFFFF',
    lineHeight: 116,
  },
  countdownSub: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 0.5,
  },

  btnRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnStartSet: { backgroundColor: '#3DDC84' },
  btnEndSet: { backgroundColor: '#FF8A3D' },
  btnEndReview: { backgroundColor: '#60C8FF' },
  btnCancel: { backgroundColor: '#2A3942' },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1A2228',
  },
  btnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0B0F12',
    letterSpacing: 0.3,
  },
  btnGhostText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#8FA1AB',
  },
});
