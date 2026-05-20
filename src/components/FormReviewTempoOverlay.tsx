// FormReviewTempoOverlay — full-camera overlay for Form Review mode.
//
// Camera-authentic: no synthetic countdowns or progress bars. All state derives
// directly from the Claude Vision result — phase, confidence, assessment quality,
// framing issues, stuck detection, and rep-blocker reasons.
//
// Display priority:
//   1. Framing / visibility error banner (when Claude cannot assess the frame)
//   2. Phase icon + title (tracking → opaque, low_confidence → dimmed)
//   3. Tempo chip + measured phase durations
//   4. Last vision cue (form correction or positive note)
//   5. Stuck-phase warning strip
//   6. Rep-blocker hint (why the rep is not counting)
//   7. Rep counter + phase progress dots (footer)

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { AssessmentState, FramingIssue, PaceAssessment, VisibilityState } from '@/lib/parseClaudeVisionResult';
import type { RepBlockerReason, RepFsmState } from '@/hooks/useFormReviewVisionLoop';

export type { AssessmentState, FramingIssue, PaceAssessment, VisibilityState };
export type { RepFsmState };

export type VisionPhase = 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';

export type FormReviewTempoOverlayProps = {
  activePhase: VisionPhase;
  phaseConfidence: number;
  assessmentState: AssessmentState;
  visibilityState: VisibilityState;
  framingIssue: FramingIssue;
  tempoStatus: PaceAssessment;
  repCount: number;
  repFsmState: RepFsmState;
  maxReps?: number;
  lastVisionCue?: string | null;
  isStuck?: boolean;
  visible: boolean;
  /** Why the current rep is not counting. Null when tracking cleanly. */
  repBlockerReason?: RepBlockerReason;
  /** Actual measured duration of the last completed descent (ms). 0 until first measurement. */
  lastDescentMs?: number;
  /** Actual measured duration of the last completed bottom pause (ms). */
  lastBottomMs?: number;
  /** Actual measured duration of the last completed ascent (ms). */
  lastAscentMs?: number;
};

// ── Phase config ──────────────────────────────────────────────────────────────

type PhaseConfig = { icon: string; color: string; title: string; subtitle: string };

const PHASE_CONFIG: Record<VisionPhase, PhaseConfig> = {
  descent: { icon: '↓', color: '#60C8FF', title: 'LOWER',        subtitle: 'Control the descent'   },
  bottom:  { icon: '⏸', color: '#FFB17A', title: 'HOLD',         subtitle: 'Pause at the bottom'   },
  ascent:  { icon: '↑', color: '#3DDC84', title: 'DRIVE',        subtitle: 'Power through the top'  },
  top:     { icon: '✓', color: '#C8AAFF', title: 'RESET',        subtitle: 'Reset and breathe'      },
  rest:    { icon: '↓', color: '#60C8FF', title: 'LOWER SLOWLY', subtitle: 'Begin your descent'     },
};

// ── Tempo chip ────────────────────────────────────────────────────────────────

const TEMPO_CHIP: Record<PaceAssessment, { bg: string; color: string; label: string }> = {
  on_tempo:  { bg: 'rgba(61,220,132,0.20)',  color: '#3DDC84',              label: 'On tempo'    },
  too_fast:  { bg: 'rgba(255,90,95,0.25)',   color: '#FF6B6B',              label: 'Too fast'    },
  too_slow:  { bg: 'rgba(255,177,122,0.20)', color: '#FFB17A',              label: 'Slow down'   },
  uncertain: { bg: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.35)', label: 'Assessing…' },
};

// ── Rep-blocker hint text ─────────────────────────────────────────────────────

function blockerHintText(reason: RepBlockerReason): string | null {
  switch (reason) {
    case 'insufficient_depth': return '↓ Go lower to count the rep';
    case 'no_lockout':         return '↑ Stand fully tall to complete it';
    case 'moved_too_fast':     return '⏱ Slow down — too fast to assess';
    case 'poor_visibility':    return '📷 Adjust camera — can\'t see full body';
    case 'low_confidence':     return '👁 Still getting a read…';
    case 'incomplete_cycle':   return '↺ Finish the full rep cycle';
    case 'unknown':            return '◉ Calibrating — keep moving';
    case null:                 return null;
    default:                   return null;
  }
}

function blockerHintColor(reason: RepBlockerReason): string {
  switch (reason) {
    case 'insufficient_depth':
    case 'no_lockout':
    case 'incomplete_cycle': return '#FFB17A'; // amber — technique correction
    case 'moved_too_fast':   return '#FF6B6B'; // red — tempo
    case 'poor_visibility':  return '#FFD5A0'; // warm — camera
    case 'low_confidence':
    case 'unknown':          return 'rgba(255,255,255,0.45)'; // dim — informational
    default:                 return '#FFB17A';
  }
}

// ── Framing guidance text ─────────────────────────────────────────────────────

function framingGuidanceText(issue: FramingIssue, visibility: VisibilityState): string {
  switch (issue) {
    case 'too_close':    return 'Step back — full body needs to be in frame';
    case 'too_far':      return 'Move closer so I can read your form';
    case 'body_cut_off': return 'Adjust camera — head or feet are cut off';
    case 'angle_unclear':return 'Reposition camera for a clear side or front view';
    case 'lighting_poor':return 'Move to better lighting';
    case 'motion_blur':  return 'Hold your position for a moment';
    default:
      return visibility === 'poor'
        ? 'Adjust camera — full body not visible'
        : 'Adjust framing slightly';
  }
}

// ── FSM path label ────────────────────────────────────────────────────────────

function fsmPathLabel(state: RepFsmState): string {
  switch (state) {
    case 'descending':     return '↓ Descending';
    case 'bottom_reached': return '⏸ Bottom';
    case 'ascending':      return '↑ Ascending';
    default:               return '';
  }
}

// ── Phase dot ─────────────────────────────────────────────────────────────────

function PhaseDot({ filled, color }: { filled: boolean; color: string }) {
  return (
    <View
      style={[
        dotStyles.dot,
        filled
          ? { backgroundColor: color, shadowColor: color, shadowOpacity: 0.6, shadowRadius: 6, elevation: 4 }
          : dotStyles.dotEmpty,
      ]}
    />
  );
}

const dotStyles = StyleSheet.create({
  dot: { width: 9, height: 9, borderRadius: 5, shadowOffset: { width: 0, height: 0 } },
  dotEmpty: { backgroundColor: 'rgba(255,255,255,0.18)' },
});

// ── Duration badge ────────────────────────────────────────────────────────────
// Shows "X.Xs" measured duration for the last completed phase, only when we
// have a real measurement (> 0 ms). Makes tempo feedback feel credible.

function DurationBadge({ ms, label }: { ms: number; label: string }) {
  if (ms <= 0) return null;
  return (
    <View style={durationStyles.badge}>
      <Text style={durationStyles.label}>{label}</Text>
      <Text style={durationStyles.value}>{(ms / 1000).toFixed(1)}s</Text>
    </View>
  );
}

const durationStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  label: { color: 'rgba(255,255,255,0.35)', fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  value: { color: 'rgba(255,255,255,0.70)', fontSize: 10, fontWeight: '800' },
});

// ── Main component ────────────────────────────────────────────────────────────

export function FormReviewTempoOverlay({
  activePhase,
  phaseConfidence,
  assessmentState,
  visibilityState,
  framingIssue,
  tempoStatus,
  repCount,
  repFsmState,
  maxReps = 5,
  lastVisionCue,
  isStuck = false,
  visible,
  repBlockerReason = null,
  lastDescentMs = 0,
  lastBottomMs = 0,
  lastAscentMs = 0,
}: FormReviewTempoOverlayProps) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.85)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Fade the overlay in/out.
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible, fadeAnim]);

  // Pulse icon on phase change.
  useEffect(() => {
    pulseLoopRef.current?.stop();
    pulseAnim.setValue(0.85);
    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.85, duration: 700, useNativeDriver: true }),
      ]),
    );
    pulseLoopRef.current.start();
    return () => pulseLoopRef.current?.stop();
  }, [activePhase, pulseAnim]);

  // ── Derived display values ────────────────────────────────────────────────
  const config = PHASE_CONFIG[activePhase] ?? PHASE_CONFIG.rest;
  const chip   = TEMPO_CHIP[tempoStatus]  ?? TEMPO_CHIP.uncertain;

  const cannotAssess = assessmentState === 'unable_to_assess';
  const lowConfidence = assessmentState === 'low_confidence';
  const needsFraming = visibilityState !== 'good' || cannotAssess;
  const framingText = needsFraming ? framingGuidanceText(framingIssue, visibilityState) : null;

  const phaseOpacity = cannotAssess ? 0.3 : lowConfidence ? 0.65 : 1;

  const fsmLabel = repFsmState !== 'idle' ? fsmPathLabel(repFsmState) : null;

  const confColor =
    phaseConfidence >= 0.75 ? '#3DDC84' :
    phaseConfidence >= 0.55 ? '#FFB17A' :
    '#FF6B6B';

  const blockerText = blockerHintText(repBlockerReason);
  const blockerColor = blockerHintColor(repBlockerReason);

  // Show measured durations row only when we have at least one real measurement.
  const hasDurations = lastDescentMs > 0 || lastBottomMs > 0 || lastAscentMs > 0;

  return (
    <Animated.View
      pointerEvents="none"
      style={[overlayStyles.container, { opacity: fadeAnim }]}
    >
      {/* Dim backdrop */}
      <View style={overlayStyles.backdrop} />

      {/* ── Framing banner (highest priority) ────────────────────────────── */}
      {framingText !== null && (
        <View style={overlayStyles.framingBanner}>
          <Text style={overlayStyles.framingIcon}>⚠</Text>
          <Text style={overlayStyles.framingText}>{framingText}</Text>
        </View>
      )}

      {/* ── Main card ────────────────────────────────────────────────────── */}
      <Animated.View style={[overlayStyles.card, { opacity: phaseOpacity }]}>
        {/* Phase icon — pulses on change */}
        <Animated.Text
          style={[
            overlayStyles.phaseIcon,
            { color: config.color, transform: [{ scale: pulseAnim }] },
          ]}
        >
          {config.icon}
        </Animated.Text>

        {/* Phase title + confidence badge */}
        <View style={overlayStyles.titleRow}>
          <Text style={[overlayStyles.phaseTitle, { color: config.color }]}>
            {config.title}
          </Text>
          {!cannotAssess && (
            <View style={[overlayStyles.confBadge, { borderColor: confColor }]}>
              <Text style={[overlayStyles.confText, { color: confColor }]}>
                {Math.round(phaseConfidence * 100)}%
              </Text>
            </View>
          )}
        </View>

        {/* FSM path label (shows active leg of rep cycle) */}
        {fsmLabel !== null && !cannotAssess && (
          <Text style={overlayStyles.fsmLabel}>{fsmLabel}</Text>
        )}

        {/* Subtitle — hidden when a coaching cue is present to reduce clutter */}
        {!cannotAssess && !lastVisionCue && (
          <Text style={overlayStyles.phaseSubtitle}>{config.subtitle}</Text>
        )}

        {/* Last vision cue — primary coaching line, replaces subtitle when present */}
        {!!lastVisionCue && !cannotAssess && (
          <View style={overlayStyles.cueRow}>
            <Text style={overlayStyles.cueText}>{lastVisionCue}</Text>
          </View>
        )}

        {/* Stuck-phase warning */}
        {isStuck && !cannotAssess && (
          <View style={overlayStyles.stuckStrip}>
            <Text style={overlayStyles.stuckText}>⚡ Keep moving</Text>
          </View>
        )}

        {/* Tempo chip — hidden when a coaching cue is active (cue has higher priority) */}
        {!lastVisionCue && (
          <View style={[overlayStyles.chip, { backgroundColor: chip.bg }]}>
            <Text style={[overlayStyles.chipText, { color: chip.color }]}>{chip.label}</Text>
          </View>
        )}

        {/* Measured phase durations — shows real timing, not synthetic */}
        {hasDurations && !cannotAssess && (
          <View style={overlayStyles.durationsRow}>
            <DurationBadge ms={lastDescentMs} label="↓" />
            <DurationBadge ms={lastBottomMs}  label="⏸" />
            <DurationBadge ms={lastAscentMs}  label="↑" />
          </View>
        )}
      </Animated.View>

      {/* ── Rep-blocker hint — why this rep isn't counting ────────────────── */}
      {blockerText !== null && !cannotAssess && (
        <View style={[overlayStyles.blockerStrip, { borderColor: `${blockerColor}50` }]}>
          <Text style={[overlayStyles.blockerText, { color: blockerColor }]}>{blockerText}</Text>
        </View>
      )}

      {/* ── Footer — rep counter + dots ───────────────────────────────────── */}
      <View style={overlayStyles.footer}>
        <View style={overlayStyles.repRow}>
          <Text style={overlayStyles.repCount}>{repCount}</Text>
          <Text style={overlayStyles.repLabel}>/ {maxReps} reps</Text>
        </View>
        <View style={overlayStyles.dotsRow}>
          {Array.from({ length: maxReps }).map((_, i) => (
            <PhaseDot key={i} filled={i < repCount} color={config.color} />
          ))}
        </View>
        {lowConfidence && (
          <Text style={overlayStyles.lowConfLabel}>estimating…</Text>
        )}
      </View>
    </Animated.View>
  );
}

const overlayStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },

  // ── Framing banner ────────────────────────────────────────────────────────
  framingBanner: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,177,122,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,177,122,0.40)',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  framingIcon: {
    color: '#FFB17A',
    fontSize: 14,
    fontWeight: '700',
  },
  framingText: {
    flex: 1,
    color: '#FFD5A0',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // ── Main card ─────────────────────────────────────────────────────────────
  card: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 32,
    paddingHorizontal: 48,
    backgroundColor: 'rgba(8,14,22,0.60)',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    minWidth: 220,
    maxWidth: 300,
  },
  phaseIcon: {
    fontSize: 80,
    lineHeight: 88,
    fontWeight: '800',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phaseTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 3.5,
  },
  confBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  confText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  fsmLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  phaseSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.48)',
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // ── Stuck strip ───────────────────────────────────────────────────────────
  stuckStrip: {
    backgroundColor: 'rgba(255,90,95,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,90,95,0.35)',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  stuckText: {
    color: '#FF8A8A',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // ── Tempo chip ────────────────────────────────────────────────────────────
  chip: {
    paddingVertical: 4,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginTop: 2,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  // ── Measured durations row ────────────────────────────────────────────────
  durationsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },

  // ── Vision cue ────────────────────────────────────────────────────────────
  cueRow: {
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  cueText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  // ── Rep-blocker hint ──────────────────────────────────────────────────────
  blockerStrip: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(8,14,22,0.72)',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  blockerText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 28,
    alignItems: 'center',
    gap: 10,
  },
  repRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  repCount: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
  },
  repLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    fontWeight: '600',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  lowConfLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
