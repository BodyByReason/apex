/**
 * formReview.test.ts
 *
 * Unit tests for the three pure-logic modules that power Form Review:
 *   1. advanceRepFsm        — rep-counting state machine
 *   2. parseClaudeVisionResult — defensive Claude Vision response parser
 *   3. buildSerenaContextFromVision — event emitter / throttler for Serena
 */

import { advanceRepFsm } from '../hooks/useFormReviewVisionLoop';
import {
  parseClaudeVisionResult,
  parseClaudeVisionResultStrict,
} from '../lib/parseClaudeVisionResult';
import {
  buildSerenaContextFromVision,
  buildFormReviewStartContext,
  buildFormReviewEndContext,
  buildStuckPhaseContext,
  DEFAULT_SERENA_CONTEXT_STATE,
  type SerenaContextState,
} from '../lib/buildSerenaContextFromVision';
import type { VisionResult } from '../lib/parseClaudeVisionResult';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const HIGH = 0.9; // confidence above default threshold (0.65)
const LOW  = 0.4; // confidence below threshold

/** Minimal valid VisionResult for testing Serena context events. */
function makeVision(overrides: Partial<VisionResult> = {}): VisionResult {
  return {
    phase: 'top',
    confidence: HIGH,
    repCompleted: false,
    formCue: null,
    severity: null,
    positiveNote: null,
    visibilityState: 'good',
    framingIssue: 'none',
    assessmentState: 'tracking',
    paceAssessment: 'on_tempo',
    ...overrides,
  };
}

/** Fresh state with timestamps far in the past so cooldowns don't block. */
function coldState(): SerenaContextState {
  return {
    ...DEFAULT_SERENA_CONTEXT_STATE,
    lastFormCueAt:     0,
    lastPositiveCueAt: 0,
    lastTempoCueAt:    0,
    lastFramingCueAt:  0,
    lastUncertainCueAt:0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. advanceRepFsm
// ─────────────────────────────────────────────────────────────────────────────

describe('advanceRepFsm', () => {
  const T = 0.7; // threshold

  describe('idle state', () => {
    it('stays idle on confident top frame', () => {
      const { nextFsmState, repConfirmed } = advanceRepFsm('idle', 'top', HIGH, T);
      expect(nextFsmState).toBe('idle');
      expect(repConfirmed).toBe(false);
    });

    it('stays idle when descent is low-confidence', () => {
      const { nextFsmState } = advanceRepFsm('idle', 'descent', LOW, T);
      expect(nextFsmState).toBe('idle');
    });

    it('transitions to descending on confident descent', () => {
      const { nextFsmState, repConfirmed } = advanceRepFsm('idle', 'descent', HIGH, T);
      expect(nextFsmState).toBe('descending');
      expect(repConfirmed).toBe(false);
    });

    it('transitions to descending on confident bottom (fast descent)', () => {
      const { nextFsmState } = advanceRepFsm('idle', 'bottom', HIGH, T);
      expect(nextFsmState).toBe('descending');
    });
  });

  describe('descending state', () => {
    it('advances to bottom_reached on confident bottom frame', () => {
      const { nextFsmState } = advanceRepFsm('descending', 'bottom', HIGH, T);
      expect(nextFsmState).toBe('bottom_reached');
    });

    it('stays descending when bottom frame is low-confidence', () => {
      const { nextFsmState } = advanceRepFsm('descending', 'bottom', LOW, T);
      expect(nextFsmState).toBe('descending');
    });

    it('skips directly to ascending when bottom frame is missed (cadence shortcut)', () => {
      // At 1 s cadence the bottom frame is often missed — FSM must still advance.
      const { nextFsmState, repConfirmed } = advanceRepFsm('descending', 'ascent', HIGH, T);
      expect(nextFsmState).toBe('ascending');
      expect(repConfirmed).toBe(false);
    });

    it('shortcuts to ascending when top frame seen mid-descent (cadence shortcut)', () => {
      // 'top' is treated as isUp=true, so the FSM shortcircuits to ascending
      // rather than resetting — this lets the rep complete on the very next top frame.
      const { nextFsmState } = advanceRepFsm('descending', 'top', HIGH, T);
      expect(nextFsmState).toBe('ascending');
    });

    it('stays descending on ambiguous rest frame at low confidence', () => {
      const { nextFsmState } = advanceRepFsm('descending', 'rest', LOW, T);
      expect(nextFsmState).toBe('descending');
    });
  });

  describe('bottom_reached state', () => {
    it('advances to ascending on confident ascent', () => {
      const { nextFsmState } = advanceRepFsm('bottom_reached', 'ascent', HIGH, T);
      expect(nextFsmState).toBe('ascending');
    });

    it('stays at bottom_reached on bottom frame', () => {
      const { nextFsmState } = advanceRepFsm('bottom_reached', 'bottom', HIGH, T);
      expect(nextFsmState).toBe('bottom_reached');
    });

    it('shortcuts to ascending when top frame seen at bottom_reached (cadence shortcut)', () => {
      // 'top' is isUp=true, so FSM advances to ascending rather than resetting —
      // same bottom-miss shortcut used in the descending state.
      const { nextFsmState } = advanceRepFsm('bottom_reached', 'top', HIGH, T);
      expect(nextFsmState).toBe('ascending');
    });
  });

  describe('ascending state', () => {
    it('confirms rep and returns to idle on confident top frame', () => {
      const { nextFsmState, repConfirmed } = advanceRepFsm('ascending', 'top', HIGH, T);
      expect(nextFsmState).toBe('idle');
      expect(repConfirmed).toBe(true);
    });

    it('confirms rep and returns to idle on confident rest frame', () => {
      const { nextFsmState, repConfirmed } = advanceRepFsm('ascending', 'rest', HIGH, T);
      expect(nextFsmState).toBe('idle');
      expect(repConfirmed).toBe(true);
    });

    it('does NOT confirm rep when top confidence is too low', () => {
      const { nextFsmState, repConfirmed } = advanceRepFsm('ascending', 'top', LOW, T);
      expect(nextFsmState).toBe('ascending');
      expect(repConfirmed).toBe(false);
    });

    it('restarts descent without counting when going back down', () => {
      const { nextFsmState, repConfirmed } = advanceRepFsm('ascending', 'descent', HIGH, T);
      expect(nextFsmState).toBe('descending');
      expect(repConfirmed).toBe(false);
    });

    it('stays ascending on low-confidence descent frame', () => {
      const { nextFsmState } = advanceRepFsm('ascending', 'descent', LOW, T);
      expect(nextFsmState).toBe('ascending');
    });
  });

  describe('full rep cycle', () => {
    it('counts exactly one rep through a complete idle→descent→bottom→ascent→idle cycle', () => {
      let state = advanceRepFsm('idle',          'descent', HIGH, T);
      expect(state.nextFsmState).toBe('descending');
      state = advanceRepFsm(state.nextFsmState, 'bottom',  HIGH, T);
      expect(state.nextFsmState).toBe('bottom_reached');
      state = advanceRepFsm(state.nextFsmState, 'ascent',  HIGH, T);
      expect(state.nextFsmState).toBe('ascending');
      state = advanceRepFsm(state.nextFsmState, 'top',     HIGH, T);
      expect(state.nextFsmState).toBe('idle');
      expect(state.repConfirmed).toBe(true);
    });

    it('counts a rep even when the bottom frame is missed (1s cadence)', () => {
      let state = advanceRepFsm('idle',          'descent', HIGH, T);
      // No bottom frame — athlete is already ascending
      state = advanceRepFsm(state.nextFsmState, 'ascent',  HIGH, T);
      expect(state.nextFsmState).toBe('ascending');
      state = advanceRepFsm(state.nextFsmState, 'top',     HIGH, T);
      expect(state.repConfirmed).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parseClaudeVisionResult
// ─────────────────────────────────────────────────────────────────────────────

describe('parseClaudeVisionResult', () => {
  describe('valid plain object', () => {
    it('parses a fully populated object', () => {
      const result = parseClaudeVisionResult({
        phase: 'descent',
        confidence: 0.85,
        repCompleted: false,
        formCue: 'Keep chest up',
        severity: 'tip',
        positiveNote: null,
        visibilityState: 'good',
        framingIssue: 'none',
        assessmentState: 'tracking',
        paceAssessment: 'on_tempo',
      });
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('descent');
      expect(result!.confidence).toBeCloseTo(0.85);
      expect(result!.formCue).toBe('Keep chest up');
      expect(result!.severity).toBe('tip');
      expect(result!.assessmentState).toBe('tracking');
    });

    it('nulls severity when formCue is absent', () => {
      const result = parseClaudeVisionResult({
        phase: 'top', confidence: 0.9, repCompleted: false,
        formCue: null, severity: 'fix', positiveNote: 'Great form',
        visibilityState: 'good', framingIssue: 'none',
        assessmentState: 'tracking', paceAssessment: 'on_tempo',
      });
      expect(result!.severity).toBeNull();
      expect(result!.positiveNote).toBe('Great form');
    });

    it('clears positiveNote when formCue is present (corrective wins)', () => {
      const result = parseClaudeVisionResult({
        phase: 'bottom', confidence: 0.8, repCompleted: false,
        formCue: 'Drive knees out', severity: 'fix',
        positiveNote: 'Good depth',
        visibilityState: 'good', framingIssue: 'none',
        assessmentState: 'tracking', paceAssessment: 'on_tempo',
      });
      expect(result!.formCue).toBe('Drive knees out');
      expect(result!.positiveNote).toBeNull();
    });

    it('never marks repCompleted when assessmentState is unable_to_assess', () => {
      const result = parseClaudeVisionResult({
        phase: 'top', confidence: 0.9, repCompleted: true,
        formCue: null, severity: null, positiveNote: null,
        visibilityState: 'poor', framingIssue: 'too_close',
        assessmentState: 'unable_to_assess', paceAssessment: 'uncertain',
      });
      expect(result!.repCompleted).toBe(false);
    });

    it('clamps confidence to [0, 1]', () => {
      const over = parseClaudeVisionResult({ phase: 'top', confidence: 1.5, repCompleted: false, formCue: null, severity: null, positiveNote: null, visibilityState: 'good', framingIssue: 'none', assessmentState: 'tracking', paceAssessment: 'on_tempo' });
      expect(over!.confidence).toBe(1);
      const under = parseClaudeVisionResult({ phase: 'top', confidence: -0.3, repCompleted: false, formCue: null, severity: null, positiveNote: null, visibilityState: 'good', framingIssue: 'none', assessmentState: 'tracking', paceAssessment: 'on_tempo' });
      expect(under!.confidence).toBe(0);
    });
  });

  describe('JSON string input', () => {
    it('parses a raw JSON string', () => {
      const json = JSON.stringify({
        phase: 'ascent', confidence: 0.75, repCompleted: false,
        formCue: null, severity: null, positiveNote: 'Smooth drive',
        visibilityState: 'good', framingIssue: 'none',
        assessmentState: 'tracking', paceAssessment: 'on_tempo',
      });
      const result = parseClaudeVisionResult(json);
      expect(result!.phase).toBe('ascent');
      expect(result!.positiveNote).toBe('Smooth drive');
    });

    it('extracts JSON embedded in prose text', () => {
      const text = 'Here is my analysis: {"phase":"bottom","confidence":0.8,"repCompleted":false,"formCue":null,"severity":null,"positiveNote":null,"visibilityState":"good","framingIssue":"none","assessmentState":"tracking","paceAssessment":"on_tempo"}';
      const result = parseClaudeVisionResult(text);
      expect(result!.phase).toBe('bottom');
    });
  });

  describe('Anthropic message envelope', () => {
    it('unwraps a content-block envelope', () => {
      const envelope = {
        content: [
          {
            type: 'tool_use',
            input: {
              phase: 'top', confidence: 0.92, repCompleted: true,
              formCue: null, severity: null, positiveNote: null,
              visibilityState: 'good', framingIssue: 'none',
              assessmentState: 'tracking', paceAssessment: 'on_tempo',
            },
          },
        ],
      };
      const result = parseClaudeVisionResult(envelope);
      expect(result!.phase).toBe('top');
      expect(result!.repCompleted).toBe(true);
    });
  });

  describe('invalid / missing inputs', () => {
    it('returns null for null input', () => {
      expect(parseClaudeVisionResult(null)).toBeNull();
    });

    it('returns null for an empty object', () => {
      expect(parseClaudeVisionResult({})).toBeNull();
    });

    it('returns null for a plain string with no JSON', () => {
      expect(parseClaudeVisionResult('no json here')).toBeNull();
    });

    it('falls back to safe defaults for unknown enum values', () => {
      const result = parseClaudeVisionResult({
        phase: 'UNKNOWN_PHASE', confidence: 0.9,
        repCompleted: false, formCue: null, severity: null, positiveNote: null,
        visibilityState: 'UNKNOWN', framingIssue: 'UNKNOWN',
        assessmentState: 'UNKNOWN', paceAssessment: 'UNKNOWN',
      });
      expect(result!.phase).toBe('rest');
      expect(result!.visibilityState).toBe('poor');
      expect(result!.framingIssue).toBe('unknown');
      expect(result!.assessmentState).toBe('unable_to_assess');
      expect(result!.paceAssessment).toBe('uncertain');
    });
  });

  describe('parseClaudeVisionResultStrict', () => {
    it('returns null for completely unparseable input', () => {
      // parseClaudeVisionResult normalises unknown enum values to safe defaults,
      // so strict can only reject inputs that make the base parser return null.
      expect(parseClaudeVisionResultStrict(null)).toBeNull();
      expect(parseClaudeVisionResultStrict('not json')).toBeNull();
      expect(parseClaudeVisionResultStrict({})).toBeNull();
    });

    it('returns a result for valid data', () => {
      const base = { phase: 'descent', confidence: 0.8, repCompleted: false, formCue: null, severity: null, positiveNote: null, visibilityState: 'good', framingIssue: 'none', assessmentState: 'tracking', paceAssessment: 'on_tempo' };
      expect(parseClaudeVisionResultStrict(base)).not.toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. buildSerenaContextFromVision
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSerenaContextFromVision', () => {
  const opts = {
    currentExercise: 'Squat',
    repCount: 1,
    tempoStatus: 'on_tempo' as const,
  };

  describe('confidence gating', () => {
    it('emits no movement events when confidence is below threshold', () => {
      const vision = makeVision({ confidence: 0.3, repCompleted: true });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      expect(events.filter(e => e.type === 'REP')).toHaveLength(0);
    });

    it('emits events when confidence is at or above threshold', () => {
      const vision = makeVision({ confidence: 0.65, repCompleted: true });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      expect(events.some(e => e.type === 'REP')).toBe(true);
    });
  });

  describe('REP events', () => {
    it('emits a REP event when repCompleted is true', () => {
      const vision = makeVision({ repCompleted: true });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      const rep = events.find(e => e.type === 'REP');
      expect(rep).toBeDefined();
      expect(rep!.text).toContain('count=1');
      expect(rep!.text).toContain('exercise="Squat"');
    });

    it('does NOT emit REP when repCompleted is false', () => {
      const vision = makeVision({ repCompleted: false });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      expect(events.filter(e => e.type === 'REP')).toHaveLength(0);
    });
  });

  describe('FORM events', () => {
    it('emits a corrective FORM event for a tip cue', () => {
      const vision = makeVision({ formCue: 'Keep chest up', severity: 'tip' });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      const form = events.find(e => e.type === 'FORM');
      expect(form).toBeDefined();
      expect(form!.text).toContain('severity="tip"');
      expect(form!.text).toContain('cue="Keep chest up"');
    });

    it('emits a positive FORM event when only positiveNote is present', () => {
      const vision = makeVision({ positiveNote: 'Great depth' });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      const form = events.find(e => e.type === 'FORM');
      expect(form).toBeDefined();
      expect(form!.text).toContain('severity="positive"');
      expect(form!.text).toContain('cue="Great depth"');
    });

    it('deduplicates identical corrective cues within cooldown window', () => {
      const vision = makeVision({ formCue: 'Brace your core', severity: 'fix' });
      const state = coldState();
      const first = buildSerenaContextFromVision(vision, state, opts);
      // Immediately after — same cue, timestamps haven't moved past cooldown
      const second = buildSerenaContextFromVision(vision, first.nextState, opts);
      const formEvents = second.events.filter(e => e.type === 'FORM');
      expect(formEvents).toHaveLength(0);
    });

    it('re-emits a cue after the cooldown has expired', () => {
      const vision = makeVision({ formCue: 'Brace your core', severity: 'fix' });
      const warmState: SerenaContextState = {
        ...coldState(),
        lastFormCue: 'Brace your core',
        lastFormCueAt: Date.now() - 10_000, // well past 2500ms default
      };
      const { events } = buildSerenaContextFromVision(vision, warmState, opts);
      expect(events.some(e => e.type === 'FORM')).toBe(true);
    });
  });

  describe('TEMPO events', () => {
    it('emits a TEMPO event when tempo is too_fast', () => {
      const vision = makeVision();
      const { events } = buildSerenaContextFromVision(vision, coldState(), {
        ...opts,
        tempoStatus: 'too_fast',
      });
      const tempo = events.find(e => e.type === 'TEMPO');
      expect(tempo).toBeDefined();
      expect(tempo!.text).toContain('status="too_fast"');
    });

    it('does NOT emit TEMPO for on_tempo when no change', () => {
      const warmState: SerenaContextState = {
        ...coldState(),
        lastTempoStatus: 'on_tempo',
        lastTempoCueAt: Date.now(),
      };
      const vision = makeVision();
      const { events } = buildSerenaContextFromVision(vision, warmState, {
        ...opts,
        tempoStatus: 'on_tempo',
      });
      expect(events.filter(e => e.type === 'TEMPO')).toHaveLength(0);
    });

    it('emits TEMPO on_tempo recovery after cooldown when status changes', () => {
      const warmState: SerenaContextState = {
        ...coldState(),
        lastTempoStatus: 'too_fast',
        lastTempoCueAt: Date.now() - 10_000,
      };
      const vision = makeVision();
      const { events } = buildSerenaContextFromVision(vision, warmState, {
        ...opts,
        tempoStatus: 'on_tempo',
      });
      const tempo = events.find(e => e.type === 'TEMPO');
      expect(tempo).toBeDefined();
      expect(tempo!.text).toContain('on_tempo');
    });
  });

  describe('FRAMING events', () => {
    it('emits a FRAMING event when visibility is poor', () => {
      const vision = makeVision({
        visibilityState: 'poor',
        framingIssue: 'too_close',
        assessmentState: 'unable_to_assess',
        confidence: 0.1,
      });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      const framing = events.find(e => e.type === 'FRAMING');
      expect(framing).toBeDefined();
      expect(framing!.text).toContain('issue="too_close"');
    });

    it('suppresses all movement events when unable_to_assess', () => {
      const vision = makeVision({
        visibilityState: 'poor',
        framingIssue: 'too_close',
        assessmentState: 'unable_to_assess',
        repCompleted: true,
        confidence: 0.9,
      });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      expect(events.filter(e => e.type === 'REP')).toHaveLength(0);
      expect(events.filter(e => e.type === 'FORM')).toHaveLength(0);
    });
  });

  describe('VISION_UNCERTAIN events', () => {
    it('emits VISION_UNCERTAIN when assessmentState is low_confidence', () => {
      const vision = makeVision({
        assessmentState: 'low_confidence',
        visibilityState: 'partial',
        confidence: 0.7,
      });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      expect(events.some(e => e.type === 'VISION_UNCERTAIN')).toBe(true);
    });

    it('does NOT emit VISION_UNCERTAIN when tracking', () => {
      const vision = makeVision({ assessmentState: 'tracking', confidence: 0.9 });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      expect(events.filter(e => e.type === 'VISION_UNCERTAIN')).toHaveLength(0);
    });

    it('throttles VISION_UNCERTAIN — does not repeat within cooldown window', () => {
      const vision = makeVision({ assessmentState: 'low_confidence', confidence: 0.7 });
      const state = coldState();
      const first = buildSerenaContextFromVision(vision, state, opts);
      expect(first.events.some(e => e.type === 'VISION_UNCERTAIN')).toBe(true);
      // Immediate second frame — cooldown (10 s) not expired
      const second = buildSerenaContextFromVision(vision, first.nextState, opts);
      expect(second.events.filter(e => e.type === 'VISION_UNCERTAIN')).toHaveLength(0);
    });
  });

  describe('FORM event instruction field', () => {
    it('includes instruction= in corrective FORM events', () => {
      const vision = makeVision({ formCue: 'Chest up', severity: 'fix' });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      const form = events.find(e => e.type === 'FORM');
      expect(form).toBeDefined();
      expect(form!.text).toContain('instruction=');
    });

    it('includes a safety instruction for critical severity', () => {
      const vision = makeVision({ formCue: 'Back rounding', severity: 'critical' });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      const form = events.find(e => e.type === 'FORM');
      expect(form!.text).toContain('safety correction');
    });

    it('includes instruction= in positive FORM events', () => {
      const vision = makeVision({ positiveNote: 'Great depth' });
      const { events } = buildSerenaContextFromVision(vision, coldState(), opts);
      const form = events.find(e => e.type === 'FORM');
      expect(form).toBeDefined();
      expect(form!.text).toContain('instruction=');
    });
  });

  describe('TEMPO event instruction field', () => {
    it('includes instruction= in too_fast TEMPO events', () => {
      const vision = makeVision();
      const { events } = buildSerenaContextFromVision(vision, coldState(), {
        ...opts,
        tempoStatus: 'too_fast',
      });
      const tempo = events.find(e => e.type === 'TEMPO');
      expect(tempo).toBeDefined();
      expect(tempo!.text).toContain('instruction=');
      expect(tempo!.text).toContain('slow');
    });

    it('includes instruction= in on_tempo recovery TEMPO events', () => {
      const warmState: SerenaContextState = {
        ...coldState(),
        lastTempoStatus: 'too_fast',
        lastTempoCueAt: Date.now() - 10_000,
      };
      const vision = makeVision();
      const { events } = buildSerenaContextFromVision(vision, warmState, {
        ...opts,
        tempoStatus: 'on_tempo',
      });
      const tempo = events.find(e => e.type === 'TEMPO');
      expect(tempo).toBeDefined();
      expect(tempo!.text).toContain('instruction=');
    });
  });

  describe('COUNTABILITY for incomplete_cycle', () => {
    it('emits COUNTABILITY when repBlockerReason is incomplete_cycle', () => {
      const vision = makeVision();
      const { events } = buildSerenaContextFromVision(vision, coldState(), {
        ...opts,
        repBlockerReason: 'incomplete_cycle',
      });
      const countability = events.find(e => e.type === 'COUNTABILITY');
      expect(countability).toBeDefined();
      expect(countability!.text).toContain('reason="incomplete_cycle"');
      expect(countability!.text).toContain('instruction=');
    });
  });

  describe('nextState management', () => {
    it('updates lastFormCue in nextState', () => {
      const vision = makeVision({ formCue: 'Neutral spine', severity: 'tip' });
      const { nextState } = buildSerenaContextFromVision(vision, coldState(), opts);
      expect(nextState.lastFormCue).toBe('Neutral spine');
    });

    it('clears lastFramingIssue when visibility recovers to good', () => {
      const goodVision = makeVision({
        visibilityState: 'good',
        framingIssue: 'none',
        assessmentState: 'tracking',
      });
      const poorState: SerenaContextState = { ...coldState(), lastFramingIssue: 'too_close' };
      const { nextState } = buildSerenaContextFromVision(goodVision, poorState, opts);
      expect(nextState.lastFramingIssue).toBe('none');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Lifecycle helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('lifecycle helpers', () => {
  describe('buildFormReviewStartContext', () => {
    it('returns a FORM_REVIEW_START event with the exercise name', () => {
      const event = buildFormReviewStartContext('Romanian Deadlift');
      expect(event.type).toBe('FORM_REVIEW_START');
      expect(event.text).toContain('exercise="Romanian Deadlift"');
      expect(event.text).toContain('FORM_REVIEW_START');
    });

    it('sanitizes double-quotes in exercise names', () => {
      const event = buildFormReviewStartContext('Exercise "with quotes"');
      expect(event.text).not.toContain('"with quotes"');
      expect(event.text).toContain("'with quotes'");
    });
  });

  describe('buildFormReviewEndContext', () => {
    it('returns a FORM_REVIEW_END event with rep count', () => {
      const event = buildFormReviewEndContext('Squat', 4);
      expect(event.type).toBe('FORM_REVIEW_END');
      expect(event.text).toContain('confirmed_reps=4');
      expect(event.text).toContain('4 confirmed reps');
    });

    it('uses singular "rep" for exactly 1 rep', () => {
      const event = buildFormReviewEndContext('Squat', 1);
      expect(event.text).toContain('1 confirmed rep.');
      expect(event.text).not.toContain('1 confirmed reps');
    });
  });

  describe('buildStuckPhaseContext', () => {
    it('returns a STUCK event with duration in seconds', () => {
      const event = buildStuckPhaseContext('Squat', 'bottom', 7500);
      expect(event.type).toBe('STUCK');
      expect(event.text).toContain('duration_secs=8');
      expect(event.text).toContain('phase="bottom"');
    });
  });

  describe('buildFormReviewEndContext with topCues', () => {
    it('includes top cues in the END event text when provided', () => {
      const event = buildFormReviewEndContext('Squat', 3, ['chest up', 'knees out']);
      expect(event.type).toBe('FORM_REVIEW_END');
      expect(event.text).toContain("'chest up'");
      expect(event.text).toContain("'knees out'");
      expect(event.text).toContain('confirmed_reps=3');
    });

    it('uses generic summary instruction when no top cues provided', () => {
      const event = buildFormReviewEndContext('Squat', 2);
      expect(event.text).toContain('Summarize');
      // The cue-list section is only injected when cues are present
      expect(event.text).not.toContain('Coaching cues you gave');
    });

    it('caps top cues at 3 even when more are passed', () => {
      const cues = ['a', 'b', 'c', 'd', 'e'];
      const event = buildFormReviewEndContext('Squat', 5, cues);
      // Only first 3 should appear
      expect(event.text).toContain("'a'");
      expect(event.text).toContain("'b'");
      expect(event.text).toContain("'c'");
      expect(event.text).not.toContain("'d'");
    });
  });
});
