/**
 * ActiveWorkoutPanel
 *
 * Full-screen active-workout overlay combining:
 *   • Voice coach (Serena / Marcus) — always-on ElevenLabs session
 *   • Quick form-video handoff to Coach Josh
 *   • Workout progress — current exercise, logged sets, up-next preview
 *
 * Design deliberately matches FormReviewScreen: camera fills the top area,
 * content overlays, SpaceMono font, corner-bracket camera frame, green accents.
 *
 * Rendered as an absolute-fill overlay inside TrainScreen so it shares all
 * workout state without a navigation round-trip.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';

import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';
import { typography } from '@/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

type SetEntry = {
  reps: string;
  restSeconds: string;
  setType?: 'circuit' | 'drop' | 'straight' | 'superset' | 'triset';
  weightLbs: string;
};

type Exercise = {
  name: string;
  num: number;
  sets: string;
};

type MovementPhase = 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';

type RealtimeCue = {
  cue: string;
  /** Plain-English description of what the camera sees — forwarded to Serena
   *  so she has rich visual context, not just a 5-word label. */
  description?: string;
  /** Movement phase detected in this frame — used for rep counting. */
  phase?: MovementPhase;
  severity: 'critical' | 'fix' | 'positive' | 'tip';
};

export type ActiveWorkoutPanelProps = {
  assistantTranscript: string;
  coachAvatar?: ImageSourcePropType;
  coachLabel: string;
  currentExerciseName: string;
  currentExercisePrescription: string;
  doneSets: number[];
  exercises: Exercise[];
  isConnected: boolean;
  isConnecting: boolean;
  isSpeaking: boolean;
  nextExerciseName?: string;
  onClose: () => void;
  onConnect: () => void;
  onEndSession: () => void;
  /** Called when the camera analysis produces a new form cue. */
  onFormCue?: (cue: RealtimeCue) => void;
  onSendFormVideo?: (exerciseName: string) => void;
  /** Semantic rep/rest events from phase-transition detection.
   *  - rep: a rep just completed, repNumber is running set count
   *  - rest_start: athlete stopped moving after ≥1 rep (end of set)
   *  - rest_end: athlete started moving again after a rest */
  onRepEvent?: (event:
    | { type: 'rep'; repNumber: number }
    | { type: 'rest_start'; totalReps: number }
    | { type: 'rest_end' }
  ) => void;
  sessionTimeStr: string;
  todayExerciseSets: Record<string, SetEntry[]>;
  todayWorkoutName: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

// Capture at 2fps so phase transitions are detected quickly.
const REALTIME_CAPTURE_MS = 500;
// Single-frame analysis — fires as fast as the API allows (~1-1.5 s round-trip).
// isAnalyzingRef prevents overlap; frames captured during analysis are discarded.
const REALTIME_FRAMES = 1;

const CUE_COLOR: Record<RealtimeCue['severity'], string> = {
  critical: '#ef4444',
  fix: C.orange,
  positive: '#FFD700',
  tip: C.green,
};

// Corner bracket decoration — one corner, rotated 4× in JSX
function CameraCorner({ style }: { style?: object }) {
  return (
    <View style={[styles.corner, style]}>
      <View style={styles.cornerH} />
      <View style={styles.cornerV} />
    </View>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ActiveWorkoutPanel({
  assistantTranscript,
  coachAvatar,
  coachLabel,
  currentExerciseName,
  currentExercisePrescription,
  doneSets,
  exercises,
  isConnected,
  isConnecting,
  isSpeaking,
  nextExerciseName,
  onClose,
  onConnect,
  onEndSession,
  onFormCue,
  onSendFormVideo,
  onRepEvent,
  sessionTimeStr,
  todayExerciseSets,
  todayWorkoutName,
}: ActiveWorkoutPanelProps) {
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraVisible, setCameraVisible] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [realtimeCue, setRealtimeCue] = useState<RealtimeCue | null>(null);
  // Rep counting + rest detection via phase-transition
  const [repCount, setRepCount] = useState(0);
  const prevPhaseRef = useRef<MovementPhase | null>(null);
  const repCountRef = useRef(0);
  const isRestingRef = useRef(true);  // starts as resting (not mid-set)
  // How many consecutive rest/top frames before we declare "set over"
  // At ~1 analysis per 1.5 s, 4 frames ≈ 6 s of stillness
  const restFrameCountRef = useRef(0);
  const REST_FRAMES_THRESHOLD = 4;

  const cameraRef = useRef<CameraView>(null);
  const isMounted = useRef(true);
  const isCapturingRef = useRef(false);
  const isAnalyzingRef = useRef(false);
  const frameBufferRef = useRef<string[]>([]);

  // Animated values
  const speakingDot = useRef(new Animated.Value(1)).current;
  const connectingPulse = useRef(new Animated.Value(0.4)).current;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // ── Animations ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isConnecting) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(connectingPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(connectingPulse, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      connectingPulse.stopAnimation();
      Animated.timing(connectingPulse, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    }
  }, [isConnecting, connectingPulse]);

  useEffect(() => {
    if (isSpeaking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(speakingDot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          Animated.timing(speakingDot, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      speakingDot.stopAnimation();
      speakingDot.setValue(1);
    }
  }, [isSpeaking, speakingDot]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (cameraVisible) {
      setCameraActive(false);
      setCameraReady(false);
      frameBufferRef.current = [];
      setRealtimeCue(null);
      // Reset all rep / rest tracking when camera is hidden
      repCountRef.current = 0;
      prevPhaseRef.current = null;
      isRestingRef.current = true;
      restFrameCountRef.current = 0;
      setRepCount(0);
      setTimeout(() => { if (isMounted.current) setCameraVisible(false); }, 150);
      return;
    }

    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    setCameraVisible(true);
    setTimeout(() => { if (isMounted.current) setCameraActive(true); }, 120);
  }, [cameraPermission?.granted, cameraVisible, requestCameraPermission]);

  // ── Real-time analysis ─────────────────────────────────────────────────────
  const onFormCueRef = useRef(onFormCue);
  onFormCueRef.current = onFormCue;
  const onRepEventRef = useRef(onRepEvent);
  onRepEventRef.current = onRepEvent;

  const runRealtimeAnalysis = useCallback(async (frames: string[]) => {
    if (isAnalyzingRef.current || !isMounted.current) return;
    isAnalyzingRef.current = true;
    try {
      const systemPrompt = `You are an elite strength coach watching a live camera frame of ${currentExerciseName || 'an exercise'}.
Respond ONLY with valid JSON (no markdown, no extra text):
{"cue":"<max 6 words>","severity":"positive|tip|fix|critical","description":"<one sentence: what you see the athlete doing right now>","phase":"top|descent|bottom|ascent|rest"}

Phase definitions:
- "top": athlete is standing/at the start position before or after a rep
- "descent": athlete is moving downward (lowering into squat, hinge, etc.)
- "bottom": athlete is at the lowest point of the movement
- "ascent": athlete is driving back up
- "rest": athlete is standing still, resting between reps

Examples:
- "description": "athlete is at the bottom of a squat, heels flat, good depth"
- "cue": "chest up, drive through heels"
- severity: positive=good form, tip=minor improvement, fix=needs correction, critical=injury risk`;

      const imageContent = frames.map((b64) => ({
        source: { data: b64, media_type: 'image/jpeg', type: 'base64' },
        type: 'image',
      }));

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 160,
          messages: [{ content: [...imageContent, { text: 'Analyze.', type: 'text' }], role: 'user' }],
          model: 'claude-3-5-haiku-20241022',
          system: systemPrompt,
        },
      });

      if (error || !data) return;
      const text: string = data?.content?.[0]?.text ?? '';
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return;
      const parsed = JSON.parse(jsonMatch[0]) as RealtimeCue;

      if (isMounted.current) {
        setRealtimeCue(parsed);
        onFormCueRef.current?.(parsed);

        // ── Rep counting + rest detection ────────────────────────────────
        const phase = parsed.phase;
        if (phase) {
          const prev = prevPhaseRef.current;
          const isIdlePhase = phase === 'rest' || phase === 'top';
          const isActivePhase = phase === 'descent' || phase === 'bottom' || phase === 'ascent';

          if (isActivePhase) {
            // Athlete is moving — clear the rest counter
            restFrameCountRef.current = 0;

            // Detect resume from rest
            if (isRestingRef.current) {
              isRestingRef.current = false;
              repCountRef.current = 0;
              prevPhaseRef.current = null;
              setRepCount(0);
              onRepEventRef.current?.({ type: 'rest_end' });
            }

            // Rep complete: downward → upward transition
            const wasDown = prev === 'descent' || prev === 'bottom';
            const isUp = phase === 'ascent' || phase === 'top';
            if (wasDown && isUp) {
              repCountRef.current += 1;
              setRepCount(repCountRef.current);
              onRepEventRef.current?.({ type: 'rep', repNumber: repCountRef.current });
            }
          } else if (isIdlePhase) {
            restFrameCountRef.current += 1;
            // Declare rest after threshold consecutive idle frames AND at least 1 rep done
            if (
              !isRestingRef.current &&
              repCountRef.current > 0 &&
              restFrameCountRef.current >= REST_FRAMES_THRESHOLD
            ) {
              isRestingRef.current = true;
              onRepEventRef.current?.({ type: 'rest_start', totalReps: repCountRef.current });
            }
          }

          prevPhaseRef.current = phase;
        }
      }
    } catch {
      // silent — next frame will retry
    } finally {
      isAnalyzingRef.current = false;
    }
  }, [currentExerciseName]);

  useEffect(() => {
    if (!cameraVisible || !cameraActive || !cameraReady) {
      frameBufferRef.current = [];
      return;
    }
    const interval = setInterval(async () => {
      if (!isMounted.current || !cameraRef.current || isCapturingRef.current) return;
      isCapturingRef.current = true;
      try {
        const photo = await cameraRef.current.takePictureAsync({ base64: false, quality: 0.4 });
        const b64 = await FileSystem.readAsStringAsync(photo.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        // With REALTIME_FRAMES = 1 every captured frame triggers analysis.
        // isAnalyzingRef ensures we never overlap — frames during an in-flight
        // request are simply dropped (no queue build-up).
        if (!isAnalyzingRef.current) {
          runRealtimeAnalysis([b64]).catch(() => null);
        }
      } catch {
        // noop
      } finally {
        isCapturingRef.current = false;
      }
    }, REALTIME_CAPTURE_MS);
    return () => { clearInterval(interval); frameBufferRef.current = []; };
  }, [cameraVisible, cameraActive, cameraReady, runRealtimeAnalysis]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const filledSets = (todayExerciseSets[currentExerciseName] ?? []).filter(
    (s) => s.reps?.trim() || s.weightLbs?.trim(),
  );

  const dotColor = isConnecting ? C.orange : isConnected ? C.green : '#444';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.overlay, { paddingTop: insets.top }]}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onClose} hitSlop={12}>
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerWorkout} numberOfLines={1}>{todayWorkoutName}</Text>
          <Text style={[styles.headerTimer, { color: C.green }]}>{sessionTimeStr}</Text>
        </View>
        <Pressable style={styles.endBtn} onPress={onEndSession} hitSlop={12}>
          <Text style={styles.endBtnText}>■ End</Text>
        </Pressable>
      </View>

      {/* ── Camera area (full flex) or voice card ─────────────────────────── */}
      {cameraVisible ? (
        <View style={styles.cameraArea}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={cameraFacing}
            mode="picture"
            active={cameraActive}
            onCameraReady={() => setCameraReady(true)}
          />

          {/* Corner brackets */}
          <CameraCorner style={styles.cornerTL} />
          <CameraCorner style={[styles.cornerTR, { transform: [{ rotate: '90deg' }] }]} />
          <CameraCorner style={[styles.cornerBL, { transform: [{ rotate: '-90deg' }] }]} />
          <CameraCorner style={[styles.cornerBR, { transform: [{ rotate: '180deg' }] }]} />

          {/* Loading */}
          {cameraActive && !cameraReady && (
            <View style={styles.cameraLoading}>
              <ActivityIndicator color={C.green} />
            </View>
          )}

          {/* LIVE badge */}
          {cameraReady && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}

          {/* Flip camera button */}
          <Pressable
            style={styles.flipCameraBtn}
            onPress={() => {
              setCameraReady(false);
              setCameraFacing((f) => (f === 'front' ? 'back' : 'front'));
            }}
            hitSlop={12}
          >
            <Text style={styles.flipCameraBtnText}>⟳</Text>
          </Pressable>

          {/* Rep counter badge — shown once at least one rep detected */}
          {repCount > 0 && (
            <View style={styles.repBadge}>
              <Text style={styles.repBadgeCount}>{repCount}</Text>
              <Text style={styles.repBadgeLabel}>REPS</Text>
            </View>
          )}

          {/* Form cue */}
          {realtimeCue && (
            <View style={[styles.cueBanner, { borderLeftColor: CUE_COLOR[realtimeCue.severity] }]}>
              <Text style={[styles.cueSeverity, { color: CUE_COLOR[realtimeCue.severity] }]}>
                {realtimeCue.severity === 'positive' ? '★' : realtimeCue.severity.toUpperCase()}
              </Text>
              <Text style={styles.cueText}>{realtimeCue.cue}</Text>
            </View>
          )}

          {/* Bottom overlays: voice + exercise + hide-camera */}
          <View style={[styles.cameraOverlayBottom, { paddingBottom: insets.bottom + 10 }]}>
            {/* Voice compact strip */}
            <View style={styles.voiceStrip}>
              <Animated.View style={[styles.voiceDot, { backgroundColor: dotColor, opacity: isConnecting ? connectingPulse : isSpeaking ? speakingDot : 1 }]} />
              <Text style={styles.voiceStripStatus}>
                {isConnecting ? `Connecting ${coachLabel}…` : isConnected ? `${coachLabel} · ${isSpeaking ? 'speaking' : 'listening'}` : `${coachLabel} · not connected`}
              </Text>
            </View>

            {/* Exercise chip */}
            <View style={styles.exerciseChip}>
              <Text style={styles.exerciseChipName} numberOfLines={1}>{currentExerciseName}</Text>
              {filledSets.length > 0 && (
                <Text style={styles.exerciseChipSets}>{filledSets.length} set{filledSets.length !== 1 ? 's' : ''} logged</Text>
              )}
            </View>

            {/* Hide camera button */}
            <Pressable style={styles.hideCameraBtn} onPress={toggleCamera}>
              <Text style={styles.hideCameraBtnText}>✕ Hide Camera</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        /* ── No-camera mode: voice card + exercise tracking ──────────────── */
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Voice card */}
          <View style={styles.voiceCard}>
            {coachAvatar && (
              <Image source={coachAvatar} style={styles.coachAvatar} />
            )}
            <View style={styles.voiceCardBody}>
              <View style={styles.voiceStatusRow}>
                <Animated.View
                  style={[
                    styles.voiceDot,
                    {
                      backgroundColor: dotColor,
                      opacity: isConnecting ? connectingPulse : isSpeaking ? speakingDot : 1,
                    },
                  ]}
                />
                <Text style={styles.voiceStatusText}>
                  {isConnecting
                    ? `Connecting ${coachLabel}…`
                    : isConnected
                      ? isSpeaking ? `${coachLabel} · Speaking` : `${coachLabel} · Listening`
                      : `${coachLabel} · Not connected`}
                </Text>
                {isConnecting && <ActivityIndicator size="small" color={C.orange} style={{ marginLeft: 6 }} />}
              </View>

              {/* Transcript or placeholder */}
              {assistantTranscript ? (
                <Text style={styles.transcript}>"{assistantTranscript}"</Text>
              ) : isConnected ? (
                <Text style={styles.transcriptHint}>
                  Just talk — log sets, ask for a form tip, or say "next exercise."
                </Text>
              ) : !isConnecting ? (
                <Text style={styles.transcriptHint}>
                  Tap Connect to start your live session with {coachLabel}.
                </Text>
              ) : null}

              {/* Reconnect CTA — only visible when disconnected and not connecting */}
              {!isConnected && !isConnecting && (
                <Pressable style={styles.connectBtn} onPress={onConnect}>
                  <Text style={styles.connectBtnText}>Connect {coachLabel}</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Current exercise */}
          <View style={styles.exerciseCard}>
            <Text style={styles.eyebrow}>CURRENT EXERCISE</Text>
            <Text style={styles.exerciseName}>{currentExerciseName || todayWorkoutName}</Text>
            {currentExercisePrescription ? (
              <Text style={styles.exercisePrescription}>{currentExercisePrescription}</Text>
            ) : null}

            {filledSets.length > 0 ? (
              <View style={styles.setsGrid}>
                {filledSets.map((set, i) => (
                  <View key={i} style={styles.setRow}>
                    <Text style={styles.setLabel}>Set {i + 1}</Text>
                    <Text style={styles.setDetail}>
                      {set.weightLbs?.trim() ? `${set.weightLbs} lbs × ` : ''}{set.reps} reps
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.noSetsHint}>
                No sets logged yet — just tell {coachLabel} your reps.
              </Text>
            )}
          </View>

          {/* Up next */}
          {nextExerciseName && (
            <View style={styles.upNextCard}>
              <Text style={[styles.eyebrow, { color: '#555' }]}>UP NEXT</Text>
              <Text style={styles.upNextName}>{nextExerciseName}</Text>
            </View>
          )}

          {/* Progress dots */}
          <View style={styles.progressRow}>
            {exercises.map((ex) => (
              <View
                key={ex.num}
                style={[
                  styles.progressDot,
                  ex.name === currentExerciseName && styles.progressDotCurrent,
                  doneSets.includes(ex.num) && styles.progressDotDone,
                ]}
              />
            ))}
          </View>
          <Text style={styles.progressLabel}>{doneSets.length}/{exercises.length} exercises done</Text>
        </ScrollView>
      )}

      {/* ── Camera toggle (fixed footer, only when camera is off) ─────────── */}
      {!cameraVisible && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
          <Pressable style={styles.cameraBtn} onPress={() => onSendFormVideo?.(currentExerciseName)}>
            <Text style={styles.cameraBtnText}>📷  Send Form Video to Coach Josh</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BRACKET = 22;
const BRACKET_THICK = 2.5;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.black,
    zIndex: 100,
  },

  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 8,
  },
  backBtn: { paddingHorizontal: 4 },
  backBtnText: {
    fontSize: 14,
    fontFamily: typography.mono.regular,
    color: C.muted,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerWorkout: {
    fontSize: 11,
    fontFamily: typography.mono.regular,
    color: '#666',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  headerTimer: {
    fontSize: 20,
    fontFamily: typography.mono.regular,
  },
  endBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    backgroundColor: 'rgba(239,68,68,0.1)',
  },
  endBtnText: {
    fontSize: 12,
    fontFamily: typography.mono.regular,
    color: '#ef4444',
  },

  // ── Camera area
  cameraArea: {
    flex: 1,
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  cameraLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },

  // Corner brackets
  corner: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
  },
  cornerTL: { top: 12, left: 12 },
  cornerTR: { top: 12, right: 12 },
  cornerBL: { bottom: 12, left: 12 },
  cornerBR: { bottom: 12, right: 12 },
  cornerH: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BRACKET,
    height: BRACKET_THICK,
    backgroundColor: C.green,
    borderRadius: 1,
  },
  cornerV: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BRACKET_THICK,
    height: BRACKET,
    backgroundColor: C.green,
    borderRadius: 1,
  },

  flipCameraBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipCameraBtnText: {
    fontSize: 20,
    color: '#fff',
    lineHeight: 24,
  },
  liveBadge: {
    position: 'absolute',
    top: 14,
    right: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.greenBorder,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  liveText: { fontSize: 10, fontFamily: typography.mono.regular, color: C.green, letterSpacing: 1 },

  repBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.greenBorder,
    paddingHorizontal: 12,
    paddingVertical: 5,
    minWidth: 52,
  },
  repBadgeCount: {
    fontSize: 26,
    fontFamily: typography.mono.regular,
    color: C.green,
    lineHeight: 30,
  },
  repBadgeLabel: {
    fontSize: 9,
    fontFamily: typography.mono.regular,
    color: C.green,
    letterSpacing: 1.5,
    opacity: 0.7,
  },

  cueBanner: {
    position: 'absolute',
    bottom: 120,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderLeftWidth: 3,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cueSeverity: { fontSize: 10, fontFamily: typography.mono.regular, fontWeight: '700', minWidth: 38 },
  cueText: { flex: 1, fontSize: 14, fontFamily: typography.mono.regular, color: '#fff' },

  cameraOverlayBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  voiceStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  voiceStripStatus: {
    fontSize: 12,
    fontFamily: typography.mono.regular,
    color: C.muted,
  },
  exerciseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  exerciseChipName: {
    flex: 1,
    fontSize: 14,
    fontFamily: typography.mono.regular,
    color: '#fff',
  },
  exerciseChipSets: {
    fontSize: 11,
    fontFamily: typography.mono.regular,
    color: C.green,
  },
  hideCameraBtn: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'rgba(0,0,0,0.4)',
    marginTop: 2,
  },
  hideCameraBtnText: {
    fontSize: 13,
    fontFamily: typography.mono.regular,
    color: C.muted,
  },

  // ── Scroll (no-camera mode)
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 10 },

  voiceCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  coachAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: C.greenBorder,
  },
  voiceCardBody: { flex: 1, gap: 8 },
  voiceStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceDot: { width: 8, height: 8, borderRadius: 4 },
  voiceStatusText: {
    fontSize: 13,
    fontFamily: typography.mono.regular,
    color: C.muted,
  },
  transcript: {
    fontSize: 14,
    fontFamily: typography.body.regular,
    color: '#e0e0e0',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  transcriptHint: {
    fontSize: 12,
    fontFamily: typography.mono.regular,
    color: '#555',
    lineHeight: 18,
  },
  connectBtn: {
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  connectBtnText: {
    fontSize: 13,
    fontFamily: typography.mono.regular,
    color: C.green,
  },

  // ── Exercise card
  exerciseCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },
  eyebrow: {
    fontSize: 10,
    fontFamily: typography.mono.regular,
    color: C.green,
    letterSpacing: 1.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  exerciseName: {
    fontSize: 22,
    fontFamily: typography.mono.regular,
    color: '#fff',
    marginBottom: 3,
  },
  exercisePrescription: {
    fontSize: 13,
    fontFamily: typography.mono.regular,
    color: C.muted,
    marginBottom: 12,
  },
  setsGrid: { gap: 6, marginTop: 4 },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.greenSoft,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.greenBorder,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  setLabel: {
    fontSize: 11,
    fontFamily: typography.mono.regular,
    color: C.green,
    minWidth: 42,
  },
  setDetail: {
    fontSize: 13,
    fontFamily: typography.mono.regular,
    color: '#e0e0e0',
  },
  noSetsHint: {
    fontSize: 12,
    fontFamily: typography.mono.regular,
    color: '#555',
    marginTop: 4,
  },

  // ── Up next
  upNextCard: {
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  upNextName: {
    fontSize: 14,
    fontFamily: typography.mono.regular,
    color: C.muted,
  },

  // ── Progress
  progressRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: C.border,
  },
  progressDotCurrent: {
    width: 22,
    borderRadius: 4,
    backgroundColor: C.green,
    borderColor: C.green,
  },
  progressDotDone: {
    backgroundColor: C.greenDim,
    borderColor: C.greenDim,
  },
  progressLabel: {
    fontSize: 11,
    fontFamily: typography.mono.regular,
    color: '#555',
  },

  // ── Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: C.black,
    borderTopWidth: 1,
    borderTopColor: C.border,
    alignItems: 'center',
  },
  cameraBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    width: '100%',
    alignItems: 'center',
  },
  cameraBtnText: {
    fontSize: 15,
    fontFamily: typography.mono.regular,
    color: C.muted,
    letterSpacing: 0.5,
  },
});
