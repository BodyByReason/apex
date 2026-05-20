/**
 * WalkWaterTrainScreen
 *
 * Walk & Water Challenge Edition — Train tab.
 * 3 categories, each showing ONE workout card at a time.
 * Level toggle (Beginner / Intermediate / Advanced) switches the card.
 * Tap a card → modal with exercise GIFs from ExerciseDB.
 * Heart icon saves/unsaves workouts to AsyncStorage.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image as RNImage,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import { useExerciseGif } from '@/hooks/useExerciseGif';
import {
  WW_WORKOUT_CATEGORIES,
  getWorkoutsByCategory,
  type WWExercise,
  type WWWorkout,
} from '@/lib/wwWorkouts';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black:      '#050A14',
  dark:       '#080F1A',
  card:       '#0D1B2A',
  border:     '#1A2E45',
  blue:       '#0EA5E9',
  teal:       '#06B6D4',
  green:      '#22C55E',
  orange:     '#F59E0B',
  blueSoft:   'rgba(14,165,233,0.08)',
  blueBorder: 'rgba(14,165,233,0.2)',
  tealSoft:   'rgba(6,182,212,0.08)',
  tealBorder: 'rgba(6,182,212,0.2)',
  greenSoft:  'rgba(34,197,94,0.10)',
  greenBorder:'rgba(34,197,94,0.25)',
  text:       '#F0F8FF',
  muted:      '#6B8BA4',
};

const SAVED_KEY = 'apex.ww.savedWorkouts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diffColor(difficulty: string): string {
  switch (difficulty) {
    case 'Recovery':
    case 'Mobility':
    case 'Flexibility': return WW.teal;
    case 'Intermediate': return WW.blue;
    case 'Advanced':     return WW.orange;
    default:             return WW.green; // Beginner
  }
}

// ─── ExerciseGifRow ───────────────────────────────────────────────────────────

const THUMB_WIDTH  = Dimensions.get('window').width - 40;
const THUMB_HEIGHT = 180;

function ExerciseGifThumbnail({
  videoId,
  onPress,
}: {
  videoId: string;
  onPress: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  return (
    <Pressable
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
      onPress={onPress}
    >
      {imgError ? (
        <View style={[modalStyles.gifFallbackBox, { width: THUMB_WIDTH, height: THUMB_HEIGHT }]}>
          <Text style={modalStyles.gifFallback}>🏋️</Text>
          <Text style={modalStyles.watchLabelFallback}>▶ Watch</Text>
        </View>
      ) : (
        <RNImage
          source={{ uri: thumbnailUrl }}
          style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      )}
      {!imgError && (
        <View style={modalStyles.watchOverlay}>
          <View style={modalStyles.watchBtn}>
            <Text style={modalStyles.watchIcon}>▶</Text>
            <Text style={modalStyles.watchLabel}>Watch</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function ExerciseGifRowFetched({ exercise, index }: { exercise: WWExercise; index: number }) {
  const { gifUrl, videoId, loading } = useExerciseGif(exercise.exerciseDbName);
  const [showPlayer, setShowPlayer] = useState(false);

  return (
    <View style={modalStyles.exerciseRow}>
      <View style={modalStyles.gifBox}>
        {loading ? (
          <ActivityIndicator size="large" color={WW.blue} />
        ) : videoId ? (
          <ExerciseGifThumbnail videoId={videoId} onPress={() => setShowPlayer(true)} />
        ) : (
          <View style={modalStyles.gifFallbackBox}>
            <Text style={modalStyles.gifFallback}>🏋️</Text>
          </View>
        )}
      </View>
      <View style={modalStyles.exerciseInfo}>
        <View style={modalStyles.exerciseNameRow}>
          <View style={modalStyles.exerciseNumber}>
            <Text style={modalStyles.exerciseNumberText}>{index + 1}</Text>
          </View>
          <Text style={modalStyles.exerciseName}>{exercise.displayName}</Text>
        </View>
        <Text style={modalStyles.exerciseSets}>{exercise.sets}</Text>
        {exercise.note ? <Text style={modalStyles.exerciseNote}>{exercise.note}</Text> : null}
      </View>
      <VideoPlayerModal
        visible={showPlayer && !!videoId}
        youtubeId={videoId ?? ''}
        title={exercise.displayName}
        onClose={() => setShowPlayer(false)}
      />
    </View>
  );
}

function ExerciseGifRow({ exercise, index }: { exercise: WWExercise; index: number }) {
  const [showPlayer, setShowPlayer] = useState(false);

  // Fast path: hardcoded YouTube ID — no hooks, no async, renders immediately.
  if (exercise.youtubeId) {
    return (
      <View style={modalStyles.exerciseRow}>
        <View style={modalStyles.gifBox}>
          <ExerciseGifThumbnail
            videoId={exercise.youtubeId}
            onPress={() => setShowPlayer(true)}
          />
        </View>
        <View style={modalStyles.exerciseInfo}>
          <View style={modalStyles.exerciseNameRow}>
            <View style={modalStyles.exerciseNumber}>
              <Text style={modalStyles.exerciseNumberText}>{index + 1}</Text>
            </View>
            <Text style={modalStyles.exerciseName}>{exercise.displayName}</Text>
          </View>
          <Text style={modalStyles.exerciseSets}>{exercise.sets}</Text>
          {exercise.note ? <Text style={modalStyles.exerciseNote}>{exercise.note}</Text> : null}
        </View>
        <VideoPlayerModal
          visible={showPlayer}
          youtubeId={exercise.youtubeId}
          title={exercise.displayName}
          onClose={() => setShowPlayer(false)}
        />
      </View>
    );
  }

  return <ExerciseGifRowFetched exercise={exercise} index={index} />;
}

// ─── WorkoutModal ─────────────────────────────────────────────────────────────

function WorkoutModal({
  workout,
  saved,
  onToggleSave,
  onClose,
}: {
  workout: WWWorkout;
  saved: boolean;
  onToggleSave: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const dc = diffColor(workout.difficulty);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[modalStyles.root, { paddingBottom: insets.bottom + 16 }]}>
        <ScrollView
          contentContainerStyle={modalStyles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={modalStyles.header}>
            <View style={modalStyles.headerLeft}>
              <Text style={modalStyles.emoji}>{workout.emoji}</Text>
              <View style={modalStyles.headerMeta}>
                <Text style={modalStyles.title}>{workout.title}</Text>
                <View style={modalStyles.pills}>
                  <View style={modalStyles.pill}>
                    <Text style={modalStyles.pillText}>⏱ {workout.duration}</Text>
                  </View>
                  <View style={[modalStyles.pill, { borderColor: dc + '40', backgroundColor: dc + '12' }]}>
                    <Text style={[modalStyles.pillText, { color: dc }]}>{workout.difficulty}</Text>
                  </View>
                </View>
              </View>
            </View>

            <Pressable
              style={[modalStyles.heartBtn, saved && modalStyles.heartBtnSaved]}
              onPress={onToggleSave}
            >
              <Text style={modalStyles.heartIcon}>{saved ? '❤️' : '🤍'}</Text>
            </Pressable>
          </View>

          <Text style={modalStyles.tagline}>{workout.tagline}</Text>

          <Text style={modalStyles.exerciseLabel}>EXERCISES</Text>
          <View style={modalStyles.exerciseList}>
            {workout.exercises.map((ex, i) => (
              <ExerciseGifRow key={ex.exerciseDbName} exercise={ex} index={i} />
            ))}
          </View>

          <View style={modalStyles.coachTip}>
            <Text style={modalStyles.coachTipLabel}>💡 COACH TIP</Text>
            <Text style={modalStyles.coachTipText}>{workout.coachTip}</Text>
          </View>
        </ScrollView>

        <Pressable style={modalStyles.closeBtn} onPress={onClose}>
          <Text style={modalStyles.closeBtnText}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ─── WorkoutCard ──────────────────────────────────────────────────────────────

function WorkoutCard({
  workout,
  saved,
  onPress,
  onToggleSave,
}: {
  workout: WWWorkout;
  saved: boolean;
  onPress: () => void;
  onToggleSave: () => void;
}) {
  const dc = diffColor(workout.difficulty);

  return (
    <Pressable
      style={({ pressed }) => [styles.workoutCard, pressed && styles.workoutCardPressed]}
      onPress={onPress}
    >
      <View style={styles.workoutCardBody}>
        <Text style={styles.workoutEmoji}>{workout.emoji}</Text>
        <View style={styles.workoutInfo}>
          <Text style={styles.workoutTitle}>{workout.title}</Text>
          <Text style={styles.workoutTagline}>{workout.tagline}</Text>
          <View style={styles.workoutMeta}>
            <Text style={styles.workoutMetaText}>⏱ {workout.duration}</Text>
            <Text style={styles.workoutMetaDot}>·</Text>
            <Text style={[styles.workoutMetaText, { color: dc }]}>{workout.difficulty}</Text>
          </View>
        </View>
      </View>

      <View style={styles.workoutCardFooter}>
        <Pressable
          style={styles.heartTap}
          onPress={(e) => { e.stopPropagation?.(); onToggleSave(); }}
          hitSlop={8}
        >
          <Text style={styles.heartIcon}>{saved ? '❤️' : '🤍'}</Text>
        </Pressable>
        <Text style={styles.workoutArrow}>Tap to open →</Text>
      </View>
    </Pressable>
  );
}

// ─── CategorySection ──────────────────────────────────────────────────────────

function CategorySection({
  catKey,
  catEmoji,
  catLabel,
  savedIds,
  onOpen,
  onToggleSave,
}: {
  catKey: WWWorkout['category'];
  catEmoji: string;
  catLabel: string;
  savedIds: Set<string>;
  onOpen: (w: WWWorkout) => void;
  onToggleSave: (id: string) => void;
}) {
  const workouts = getWorkoutsByCategory(catKey); // [week1, week2, week3]
  const [selectedIndex, setSelectedIndex] = useState(0);
  const workout = workouts[selectedIndex];

  return (
    <View style={styles.section}>
      {/* Section header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEmoji}>{catEmoji}</Text>
        <Text style={styles.sectionLabel}>{catLabel.toUpperCase()}</Text>
      </View>

      {/* Level toggle */}
      <View style={styles.levelToggle}>
        {workouts.map((w, i) => {
          const dc = diffColor(w.difficulty);
          const active = i === selectedIndex;
          return (
            <Pressable
              key={w.id}
              style={[
                styles.levelBtn,
                active && { backgroundColor: dc + '18', borderColor: dc + '50' },
              ]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => null);
                setSelectedIndex(i);
              }}
            >
              <Text style={[styles.levelBtnText, active && { color: dc }]}>
                {w.difficulty}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Single workout card */}
      <WorkoutCard
        workout={workout}
        saved={savedIds.has(workout.id)}
        onPress={() => onOpen(workout)}
        onToggleSave={() => onToggleSave(workout.id)}
      />
    </View>
  );
}

// ─── WalkWaterTrainScreen ─────────────────────────────────────────────────────

export default function WalkWaterTrainScreen() {
  const insets = useSafeAreaInsets();
  const [activeWorkout, setActiveWorkout] = useState<WWWorkout | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(SAVED_KEY)
      .then(raw => { if (raw) setSavedIds(new Set(JSON.parse(raw) as string[])); })
      .catch(() => null);
  }, []);

  const persistSaved = useCallback(async (next: Set<string>) => {
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify([...next])).catch(() => null);
  }, []);

  const handleToggleSave = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      persistSaved(next);
      return next;
    });
  }, [persistSaved]);

  const handleOpen = useCallback((workout: WWWorkout) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    setActiveWorkout(workout);
  }, []);

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>APEX TRAIN</Text>
        <Text style={styles.title}>No gym{'\n'}required.</Text>
        <Text style={styles.sub}>
          Bodyweight, dumbbell, and resistance workouts built around your walks.
        </Text>
      </View>

      {/* 3 category sections — one card each with level toggle */}
      {WW_WORKOUT_CATEGORIES.map(cat => (
        <CategorySection
          key={cat.key}
          catKey={cat.key}
          catEmoji={cat.emoji}
          catLabel={cat.label}
          savedIds={savedIds}
          onOpen={handleOpen}
          onToggleSave={handleToggleSave}
        />
      ))}

      {activeWorkout && (
        <WorkoutModal
          workout={activeWorkout}
          saved={savedIds.has(activeWorkout.id)}
          onToggleSave={() => handleToggleSave(activeWorkout.id)}
          onClose={() => setActiveWorkout(null)}
        />
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: WW.black },
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 28 },

  header:  { gap: 6, marginBottom: 4 },
  eyebrow: { fontSize: 9, color: WW.blue, fontWeight: '700', letterSpacing: 2 },
  title:   { fontSize: 34, color: WW.text, fontWeight: '900', letterSpacing: -0.6, lineHeight: 40 },
  sub:     { fontSize: 14, color: WW.muted, lineHeight: 21, fontWeight: '500' },

  section:       { gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionEmoji:  { fontSize: 16 },
  sectionLabel:  { fontSize: 10, color: WW.muted, fontWeight: '700', letterSpacing: 1.5 },

  // Level toggle
  levelToggle: {
    flexDirection: 'row', gap: 8,
  },
  levelBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: WW.border,
    backgroundColor: WW.card,
    alignItems: 'center', justifyContent: 'center',
  },
  levelBtnText: {
    fontSize: 11, fontWeight: '700', color: WW.muted, letterSpacing: 0.2,
  },

  // Workout card
  workoutCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 16, padding: 16, gap: 12,
  },
  workoutCardPressed: { opacity: 0.75 },
  workoutCardBody:    { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  workoutEmoji:       { fontSize: 30, marginTop: 2 },
  workoutInfo:        { flex: 1, gap: 4 },
  workoutTitle:       { fontSize: 16, color: WW.text, fontWeight: '800' },
  workoutTagline:     { fontSize: 12, color: WW.muted, lineHeight: 17 },
  workoutMeta:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  workoutMetaText:    { fontSize: 11, color: WW.blue, fontWeight: '600' },
  workoutMetaDot:     { fontSize: 11, color: WW.muted },
  workoutCardFooter:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heartTap:           { padding: 4 },
  heartIcon:          { fontSize: 16 },
  workoutArrow:       { fontSize: 12, color: WW.muted, fontWeight: '600' },
});

const modalStyles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: WW.dark },
  content: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 16, gap: 20 },

  header:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  emoji:      { fontSize: 40 },
  headerMeta: { flex: 1, gap: 8 },
  title:      { fontSize: 20, color: WW.text, fontWeight: '900', letterSpacing: -0.3, lineHeight: 26 },
  pills:      { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: {
    backgroundColor: WW.blueSoft, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  pillText: { fontSize: 10, color: WW.blue, fontWeight: '700' },

  heartBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    alignItems: 'center', justifyContent: 'center',
  },
  heartBtnSaved: { borderColor: 'rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.08)' },
  heartIcon: { fontSize: 16 },

  tagline: { fontSize: 14, color: WW.muted, lineHeight: 21 },

  exerciseLabel: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.5 },
  exerciseList:  { gap: 12 },

  exerciseRow: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 14, overflow: 'hidden',
  },
  gifBox: {
    height: 180, backgroundColor: '#0A1520',
    alignItems: 'center', justifyContent: 'center',
  },
  gif: { width: '100%', height: '100%' },
  watchOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(5,10,20,0.55)',
    paddingVertical: 8, alignItems: 'center',
  },
  watchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  watchIcon:  { fontSize: 11, color: '#fff' },
  watchLabel: { fontSize: 12, color: '#fff', fontWeight: '700', letterSpacing: 0.3 },
  gifFallbackBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  gifFallback:        { fontSize: 40 },
  watchLabelFallback: { fontSize: 12, color: WW.blue, fontWeight: '700' },

  exerciseInfo:    { padding: 14, gap: 4 },
  exerciseNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exerciseNumber: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: WW.blueSoft, borderWidth: 1, borderColor: WW.blueBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  exerciseNumberText: { fontSize: 11, color: WW.blue, fontWeight: '800' },
  exerciseName:       { fontSize: 15, color: WW.text, fontWeight: '700', flex: 1 },
  exerciseSets:       { fontSize: 13, color: WW.blue, fontWeight: '600', marginLeft: 34 },
  exerciseNote:       { fontSize: 11, color: WW.muted, fontWeight: '500', marginLeft: 34, marginTop: 1 },

  coachTip: {
    backgroundColor: WW.blueSoft, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 12, padding: 14, gap: 6,
  },
  coachTipLabel: { fontSize: 9, color: WW.blue, fontWeight: '700', letterSpacing: 1.2 },
  coachTipText:  { fontSize: 13, color: WW.text, lineHeight: 20, fontWeight: '400' },

  closeBtn: {
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: WW.blue, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, color: '#000', fontWeight: '800' },
});

