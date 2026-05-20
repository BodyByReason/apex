// TempoAssistCard — compact bottom-of-camera card for Tempo Assist in
// normal set vision mode. Shows a 4-segment phase rail, a pace chip,
// and the last form cue or positive note.
//
// Props:
//   activePhase    — smoothedPhase from the Gemini vision loop
//   phaseElapsedMs — milliseconds elapsed in the current phase (100ms tick)
//   tempoTarget    — TempoProfile from getTargetTempoForExercise
//   paceStatus     — 'on_tempo' | 'slightly_fast' | 'too_fast'
//   tempoDisplay   — compact string like "4-1-1-0" shown in header
//   tempoDescription — human label like "Lower: 4s · Hold: 1s · Drive: 1s"
//   lastCue        — last form cue text (or null)
//   repCount       — current rep count for the set

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export type VisionPhase = 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';
export type PaceStatus = 'on_tempo' | 'slightly_fast' | 'too_fast';

export type TempoProfile = {
  descent: number;
  bottom: number;
  ascent: number;
  top: number;
};

export type TempoAssistCardProps = {
  activePhase: VisionPhase;
  phaseElapsedMs: number;
  tempoTarget: TempoProfile;
  paceStatus: PaceStatus;
  tempoDisplay: string;
  tempoDescription: string;
  lastCue?: string | null;
  repCount: number;
};

// ── Rail config ───────────────────────────────────────────────────────────────

type RailSegment = {
  key: keyof TempoProfile;
  icon: string;
  label: string;
};

const RAIL_SEGMENTS: RailSegment[] = [
  { key: 'descent', icon: '↓', label: 'Lower' },
  { key: 'bottom',  icon: '⏸', label: 'Hold'  },
  { key: 'ascent',  icon: '↑', label: 'Up'    },
  { key: 'top',     icon: '✓', label: 'Top'   },
];

const PACE_CHIP: Record<PaceStatus, { bg: string; color: string; label: string }> = {
  on_tempo:      { bg: 'rgba(61,220,132,0.18)',  color: '#3DDC84', label: 'On tempo' },
  slightly_fast: { bg: 'rgba(255,177,122,0.18)', color: '#FFB17A', label: 'A little fast' },
  too_fast:      { bg: 'rgba(255,90,95,0.22)',   color: '#FF6B6B', label: 'Too fast' },
};

// ── Rail segment ──────────────────────────────────────────────────────────────

type SegmentProps = {
  seg: RailSegment;
  isActive: boolean;
  isLast: boolean;
  target: number;
  phaseElapsedMs: number;
};

function RailSegmentView({ seg, isActive, isLast, target, phaseElapsedMs }: SegmentProps) {
  const pulseAnim = useRef(new Animated.Value(0.6)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    pulseLoopRef.current?.stop();
    if (isActive) {
      pulseAnim.setValue(0.6);
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 700, useNativeDriver: true }),
        ]),
      );
      pulseLoopRef.current.start();
    }
    return () => pulseLoopRef.current?.stop();
  }, [isActive, pulseAnim]);

  const isInstant = target === 0;
  const targetMs = target * 1000;
  const progress = isActive && !isInstant ? Math.min(1, phaseElapsedMs / targetMs) : 0;
  const remaining = isActive && !isInstant ? Math.max(0, (targetMs - phaseElapsedMs) / 1000) : null;
  const held = isActive && !isInstant && progress >= 1;

  return (
    <View
      style={[
        segStyles.seg,
        isInstant && !isActive && segStyles.segInstant,
        !isLast && segStyles.segDivider,
        isActive && segStyles.segActiveGlow,
      ]}
    >
      {isActive && <View style={[StyleSheet.absoluteFill, segStyles.activeBg]} />}
      {isActive && (
        <Animated.View
          style={[StyleSheet.absoluteFill, segStyles.pulseBg, { opacity: pulseAnim }]}
        />
      )}
      {isActive && !isInstant && (
        <View
          style={[
            segStyles.progressBar,
            { width: `${progress * 100}%` as `${number}%` },
            held && segStyles.progressBarHeld,
          ]}
        />
      )}
      <Text style={[segStyles.icon, isActive && segStyles.iconActive, isInstant && !isActive && segStyles.dimmed]}>
        {seg.icon}
      </Text>
      <Text style={[segStyles.label, isActive && segStyles.labelActive, isInstant && !isActive && segStyles.dimmed]}>
        {seg.label}
      </Text>
      {isActive && !isInstant && (
        <Text style={held ? segStyles.held : segStyles.countdown}>
          {held ? '✓' : `${remaining!.toFixed(1)}s`}
        </Text>
      )}
      {isActive && isInstant && <Text style={segStyles.held}>—</Text>}
      {!isActive && !isInstant && <Text style={segStyles.targetLabel}>{target}s</Text>}
    </View>
  );
}

const segStyles = StyleSheet.create({
  seg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    gap: 3,
    overflow: 'hidden',
  },
  activeBg: { backgroundColor: 'rgba(61,220,132,0.20)' },
  pulseBg:  { backgroundColor: 'rgba(61,220,132,0.10)' },
  segActiveGlow: {
    shadowColor: '#3DDC84',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  segInstant: { flex: 0.6, opacity: 0.45 },
  segDivider: { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.09)' },
  progressBar: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(61,220,132,0.7)',
    borderRadius: 2,
  },
  progressBarHeld: { backgroundColor: '#3DDC84' },
  icon:        { fontSize: 14, color: 'rgba(255,255,255,0.45)' },
  iconActive:  { fontSize: 16, color: '#3DDC84' },
  label:       { fontSize: 9,  fontWeight: '700', color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 },
  labelActive: { fontSize: 10, color: '#FFFFFF' },
  dimmed:      { color: 'rgba(255,255,255,0.22)' },
  countdown:   { fontSize: 10, fontWeight: '800', color: '#3DDC84', letterSpacing: 0.3 },
  held:        { fontSize: 11, fontWeight: '800', color: '#3DDC84' },
  targetLabel: { fontSize: 9,  color: 'rgba(255,255,255,0.30)' },
});

// ── Main component ────────────────────────────────────────────────────────────

export function TempoAssistCard({
  activePhase,
  phaseElapsedMs,
  tempoTarget,
  paceStatus,
  tempoDisplay,
  tempoDescription,
  lastCue,
  repCount,
}: TempoAssistCardProps) {
  // 'rest' maps to the 'top' rail segment.
  const activeKey: keyof TempoProfile = activePhase === 'rest' ? 'top' : activePhase;
  const chip = PACE_CHIP[paceStatus];

  return (
    <View style={cardStyles.card}>
      {/* ── Header row ── */}
      <View style={cardStyles.header}>
        <View style={cardStyles.headerLeft}>
          <Text style={cardStyles.eyebrow}>TEMPO ASSIST</Text>
          <Text style={cardStyles.targetBadge}>{tempoDisplay}</Text>
        </View>
        <View style={[cardStyles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[cardStyles.chipText, { color: chip.color }]}>{chip.label}</Text>
        </View>
      </View>

      {/* ── Phase rail ── */}
      <View style={cardStyles.rail}>
        {RAIL_SEGMENTS.map((seg, i) => (
          <RailSegmentView
            key={seg.key}
            seg={seg}
            isActive={seg.key === activeKey}
            isLast={i === RAIL_SEGMENTS.length - 1}
            target={tempoTarget[seg.key]}
            phaseElapsedMs={phaseElapsedMs}
          />
        ))}
      </View>

      {/* ── Footer row: cue + rep count ── */}
      <View style={cardStyles.footer}>
        <Text style={cardStyles.description} numberOfLines={1}>
          {lastCue ?? tempoDescription}
        </Text>
        {repCount > 0 && (
          <View style={cardStyles.repBadge}>
            <Text style={cardStyles.repText}>{repCount}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(8,14,22,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.50)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  targetBadge: {
    color: 'rgba(255,255,255,0.70)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  chip: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  rail: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    minHeight: 62,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },
  description: {
    flex: 1,
    color: 'rgba(255,255,255,0.48)',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  repBadge: {
    backgroundColor: 'rgba(61,220,132,0.15)',
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginLeft: 8,
  },
  repText: {
    color: '#3DDC84',
    fontSize: 12,
    fontWeight: '800',
  },
});
