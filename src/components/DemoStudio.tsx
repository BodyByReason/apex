import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { env } from '@/lib/env';
import {
  buildDemoPrompt,
  pollVideoStatus,
  submitImageToVideo,
  type VideoGenStatus,
} from '@/lib/falVideoGen';
import {
  approveDemoAsset,
  archiveDemoAsset,
  getCoachDemoAssets,
  type DemoAsset,
} from '@/lib/demoAssets';
import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';

const EQUIPMENT_OPTIONS = [
  'Barbell',
  'Dumbbells',
  'Kettlebell',
  'Cable',
  'Machine',
  'Bodyweight',
] as const;

type Equipment = (typeof EQUIPMENT_OPTIONS)[number];
type Coach = 'Marcus' | 'Serena';

const COACH_OPTIONS: Coach[] = ['Marcus', 'Serena'];

const POLL_INTERVAL_MS = 4000;

function referenceUrlForCoach(coach: Coach): string {
  return coach === 'Marcus' ? env.demoRefMarcusUrl : env.demoRefSerenaUrl;
}

export function DemoStudio() {
  const [selectedCoach, setSelectedCoach] = useState<Coach>('Marcus');
  const [exerciseName, setExerciseName] = useState('');
  const [equipment, setEquipment] = useState<Equipment>('Barbell');
  const [position, setPosition] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<VideoGenStatus | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  const [assetStatus, setAssetStatus] = useState<DemoAsset['status'] | null>(null);
  const [recentAssets, setRecentAssets] = useState<DemoAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const prompt = buildDemoPrompt(
    exerciseName.trim() || '[Exercise]',
    equipment,
    position.trim() || '[Position]',
  );

  const refUrl = referenceUrlForCoach(selectedCoach);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const loadRecentAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const marcus = await getCoachDemoAssets('Marcus', 'video');
      const serena = await getCoachDemoAssets('Serena', 'video');
      const all = [...marcus, ...serena].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setRecentAssets(all.slice(0, 20));
    } catch {
      // silent
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  useEffect(() => {
    loadRecentAssets();
  }, [loadRecentAssets]);

  const startPolling = useCallback(
    (falRequest: import('@/lib/falVideoGen').VideoGenRequest) => {
      pollTimer.current = setInterval(async () => {
        try {
          const result = await pollVideoStatus(falRequest);
          setGenStatus(result.status);
          if (result.status === 'completed') {
            stopPolling();
            setGenerating(false);
            if (result.videoUrl) {
              setVideoUrl(result.videoUrl);
              const { data, error } = await supabase
                .from('demo_assets')
                .insert({
                  coach_label: selectedCoach,
                  exercise_name: exerciseName.trim(),
                  asset_kind: 'video',
                  status: 'candidate',
                  prompt,
                  video_url: result.videoUrl,
                  request_id: falRequest.requestId,
                  metadata: { aspect_ratio: '16:9', duration_seconds: 10, model: 'kling-v1.6-pro' },
                })
                .select('id')
                .single();
              if (!error && data) {
                setSavedAssetId(data.id);
                setAssetStatus('candidate');
              }
              loadRecentAssets();
            }
          } else if (result.status === 'failed') {
            stopPolling();
            setGenerating(false);
            Alert.alert('Generation failed', result.error ?? 'fal.ai returned an error.');
          }
        } catch (err: any) {
          stopPolling();
          setGenerating(false);
          Alert.alert('Error', err?.message ?? 'Polling error.');
        }
      }, POLL_INTERVAL_MS);
    },
    [selectedCoach, exerciseName, prompt, stopPolling, loadRecentAssets],
  );

  const handleGenerate = async () => {
    if (!exerciseName.trim()) {
      Alert.alert('Missing info', 'Enter an exercise name first.');
      return;
    }
    if (!position.trim()) {
      Alert.alert('Missing info', 'Enter a position (e.g. standing, seated).');
      return;
    }
    if (!refUrl) {
      Alert.alert(
        'Reference image not set',
        `Set EXPO_PUBLIC_DEMO_REF_${selectedCoach.toUpperCase()}_URL in your .env and restart.`,
      );
      return;
    }
    if (!env.falApiKey) {
      Alert.alert('fal.ai key missing', 'Set EXPO_PUBLIC_FAL_KEY in your .env and restart.');
      return;
    }

    setVideoUrl(null);
    setSavedAssetId(null);
    setAssetStatus(null);
    setGenerating(true);
    setGenStatus('queued');

    try {
      const falRequest = await submitImageToVideo({ imageUrl: refUrl, prompt });
      setRequestId(falRequest.requestId);
      startPolling(falRequest);
    } catch (err: any) {
      setGenerating(false);
      setGenStatus(null);
      Alert.alert('Submit failed', err?.message ?? 'Could not start generation.');
    }
  };

  const handleApprove = async () => {
    if (!savedAssetId) return;
    try {
      await approveDemoAsset(savedAssetId);
      setAssetStatus('approved');
      loadRecentAssets();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not approve.');
    }
  };

  const handleArchive = async () => {
    if (!savedAssetId) return;
    try {
      await archiveDemoAsset(savedAssetId);
      setAssetStatus('archived');
      loadRecentAssets();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not archive.');
    }
  };

  const canGenerate = !generating && !!exerciseName.trim() && !!position.trim();

  const statusLabel: Record<VideoGenStatus, string> = {
    queued: 'Queued...',
    in_progress: 'Generating video...',
    completed: 'Done',
    failed: 'Failed',
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* ── Section: Reference Images ── */}
      <Text style={styles.sectionLabel}>REFERENCE IMAGES</Text>
      <View style={styles.refRow}>
        {COACH_OPTIONS.map((coach) => {
          const isSelected = selectedCoach === coach;
          const url = referenceUrlForCoach(coach);
          return (
            <Pressable
              key={coach}
              style={[styles.refCard, isSelected && styles.refCardSelected]}
              onPress={() => setSelectedCoach(coach)}
            >
              <View style={styles.refImageWrap}>
                {url ? (
                  <Image
                    source={{ uri: url }}
                    style={styles.refImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.refImagePlaceholder}>
                    <Text style={styles.refImagePlaceholderIcon}>
                      {coach === 'Marcus' ? '💪' : '🏋️'}
                    </Text>
                    <Text style={styles.refImagePlaceholderText}>Upload{'\n'}ref photo</Text>
                  </View>
                )}
                {isSelected && (
                  <View style={styles.refSelectedBadge}>
                    <Text style={styles.refSelectedBadgeText}>✓</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.refLabel, isSelected && styles.refLabelSelected]}>
                {coach}
              </Text>
              {isSelected && <Text style={styles.refActiveTag}>ACTIVE</Text>}
            </Pressable>
          );
        })}
      </View>

      {/* ── Section: Exercise Builder ── */}
      <Text style={styles.sectionLabel}>EXERCISE</Text>
      <TextInput
        style={styles.textInput}
        placeholder="Exercise name (e.g. Squat, Bench Press)"
        placeholderTextColor={C.subtle}
        value={exerciseName}
        onChangeText={setExerciseName}
      />

      <Text style={styles.sectionLabel}>EQUIPMENT</Text>
      <View style={styles.equipRow}>
        {EQUIPMENT_OPTIONS.map((opt) => (
          <Pressable
            key={opt}
            style={[styles.equipChip, equipment === opt && styles.equipChipSelected]}
            onPress={() => setEquipment(opt)}
          >
            <Text style={[styles.equipChipText, equipment === opt && styles.equipChipTextSelected]}>
              {opt}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>POSITION</Text>
      <TextInput
        style={styles.textInput}
        placeholder="e.g. standing, seated, lying flat"
        placeholderTextColor={C.subtle}
        value={position}
        onChangeText={setPosition}
      />

      {/* ── Prompt Preview ── */}
      <View style={styles.promptBox}>
        <Text style={styles.promptLabel}>PROMPT PREVIEW</Text>
        <Text style={styles.promptText}>{prompt}</Text>
      </View>

      {/* ── Generate Button ── */}
      <Pressable
        style={[styles.generateBtn, !canGenerate && styles.generateBtnDisabled]}
        onPress={handleGenerate}
        disabled={!canGenerate}
      >
        {generating ? (
          <View style={styles.generateBtnRow}>
            <ActivityIndicator color="#000" size="small" />
            <Text style={styles.generateBtnText}>
              {genStatus ? statusLabel[genStatus] : 'Working...'}
            </Text>
          </View>
        ) : (
          <Text style={styles.generateBtnText}>🎬 Generate Demo Video</Text>
        )}
      </Pressable>

      {/* ── Video Result ── */}
      {videoUrl ? (
        <View style={styles.videoSection}>
          <Text style={styles.sectionLabel}>GENERATED VIDEO</Text>
          <Video
            source={{ uri: videoUrl }}
            style={styles.video}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            isLooping
            shouldPlay
          />
          <Text style={styles.videoMeta}>
            {selectedCoach} · {exerciseName} · {equipment} · {position}
          </Text>

          {/* Action buttons */}
          {assetStatus !== 'approved' && assetStatus !== 'archived' && (
            <View style={styles.actionRow}>
              <Pressable style={styles.approveBtn} onPress={handleApprove}>
                <Text style={styles.approveBtnText}>✓ Approve</Text>
              </Pressable>
              <Pressable style={styles.archiveBtn} onPress={handleArchive}>
                <Text style={styles.archiveBtnText}>✕ Archive</Text>
              </Pressable>
            </View>
          )}
          {assetStatus === 'approved' && (
            <View style={styles.statusBadgeRow}>
              <View style={[styles.statusBadge, styles.statusApproved]}>
                <Text style={styles.statusApprovedText}>✓ APPROVED — saved to demo library</Text>
              </View>
            </View>
          )}
          {assetStatus === 'archived' && (
            <View style={styles.statusBadgeRow}>
              <View style={[styles.statusBadge, styles.statusArchived]}>
                <Text style={styles.statusArchivedText}>ARCHIVED</Text>
              </View>
            </View>
          )}
        </View>
      ) : null}

      {/* ── Recent Assets ── */}
      <View style={styles.recentHeader}>
        <Text style={styles.sectionLabel}>DEMO LIBRARY</Text>
        <Pressable onPress={loadRecentAssets} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>↻ Refresh</Text>
        </Pressable>
      </View>

      {loadingAssets ? (
        <ActivityIndicator color={C.green} style={{ marginVertical: 12 }} />
      ) : recentAssets.length === 0 ? (
        <Text style={styles.emptyText}>No demo videos yet. Generate one above.</Text>
      ) : (
        recentAssets.map((asset) => (
          <AssetRow
            key={asset.id}
            asset={asset}
            onApprove={async () => {
              await approveDemoAsset(asset.id);
              loadRecentAssets();
            }}
            onArchive={async () => {
              await archiveDemoAsset(asset.id);
              loadRecentAssets();
            }}
          />
        ))
      )}
    </ScrollView>
  );
}

function AssetRow({
  asset,
  onApprove,
  onArchive,
}: {
  asset: DemoAsset;
  onApprove: () => void;
  onArchive: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable style={styles.assetRow} onPress={() => setExpanded((v) => !v)}>
      <View style={styles.assetRowTop}>
        <View style={styles.assetRowInfo}>
          <Text style={styles.assetRowCoach}>{asset.coachLabel}</Text>
          <Text style={styles.assetRowExercise}>{asset.exerciseName}</Text>
        </View>
        <View style={[styles.assetStatusBadge, asset.status === 'approved' ? styles.statusApproved : asset.status === 'archived' ? styles.statusArchived : styles.statusCandidate]}>
          <Text style={[styles.assetStatusText, asset.status === 'approved' ? styles.statusApprovedText : asset.status === 'archived' ? styles.statusArchivedText : styles.statusCandidateText]}>
            {asset.status.toUpperCase()}
          </Text>
        </View>
      </View>

      {expanded && asset.videoUrl ? (
        <View style={styles.assetExpanded}>
          <Video
            source={{ uri: asset.videoUrl }}
            style={styles.assetVideo}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            isLooping={false}
          />
          {asset.status !== 'approved' && asset.status !== 'archived' && (
            <View style={styles.actionRow}>
              <Pressable style={styles.approveBtn} onPress={onApprove}>
                <Text style={styles.approveBtnText}>✓ Approve</Text>
              </Pressable>
              <Pressable style={styles.archiveBtn} onPress={onArchive}>
                <Text style={styles.archiveBtnText}>✕ Archive</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.black },
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'SpaceMono_400Regular',
    color: C.subtle,
    letterSpacing: 1.2,
    marginTop: 8,
    marginBottom: 4,
  },

  // Reference images
  refRow: { flexDirection: 'row', gap: 12 },
  refCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: C.border,
    overflow: 'hidden',
    backgroundColor: C.card,
    alignItems: 'center',
    paddingBottom: 10,
  },
  refCardSelected: { borderColor: C.green },
  refImageWrap: { width: '100%', aspectRatio: 9 / 16, position: 'relative' },
  refImage: { width: '100%', height: '100%' },
  refImagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: C.dark,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  refImagePlaceholderIcon: { fontSize: 28 },
  refImagePlaceholderText: {
    fontSize: 11,
    color: C.subtle,
    fontFamily: 'DMSans_400Regular',
    textAlign: 'center',
  },
  refSelectedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refSelectedBadgeText: { color: '#000', fontSize: 13, fontFamily: 'DMSans_700Bold' },
  refLabel: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: C.muted,
  },
  refLabelSelected: { color: C.green },
  refActiveTag: {
    fontSize: 9,
    fontFamily: 'SpaceMono_400Regular',
    color: C.green,
    letterSpacing: 1,
    marginTop: 2,
  },

  // Form
  textInput: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  equipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  equipChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  equipChipSelected: { borderColor: C.green, backgroundColor: 'rgba(0,255,135,0.08)' },
  equipChipText: { fontSize: 13, color: C.subtle, fontFamily: 'DMSans_500Medium' },
  equipChipTextSelected: { color: C.green },

  // Prompt preview
  promptBox: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  promptLabel: {
    fontSize: 9,
    fontFamily: 'SpaceMono_400Regular',
    color: C.subtle,
    letterSpacing: 1,
  },
  promptText: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: C.text,
    lineHeight: 20,
    fontStyle: 'italic',
  },

  // Generate button
  generateBtn: {
    backgroundColor: C.green,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  generateBtnText: { fontSize: 15, fontFamily: 'DMSans_700Bold', color: '#000' },

  // Video result
  videoSection: { gap: 10, marginTop: 4 },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#000' },
  videoMeta: {
    fontSize: 11,
    color: C.subtle,
    fontFamily: 'DMSans_400Regular',
    textAlign: 'center',
  },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  approveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: 'rgba(0,255,135,0.1)',
    borderWidth: 1,
    borderColor: C.greenBorder,
    alignItems: 'center',
  },
  approveBtnText: { color: C.green, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  archiveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: 'rgba(255,107,53,0.08)',
    borderWidth: 1,
    borderColor: C.orangeBorder,
    alignItems: 'center',
  },
  archiveBtnText: { color: C.orange, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  statusBadgeRow: { alignItems: 'center' },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusApproved: {
    backgroundColor: 'rgba(0,255,135,0.08)',
    borderColor: C.greenBorder,
  },
  statusApprovedText: { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 0.5 },
  statusArchived: {
    backgroundColor: 'rgba(255,107,53,0.08)',
    borderColor: C.orangeBorder,
  },
  statusArchivedText: { color: C.orange, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 0.5 },
  statusCandidate: {
    backgroundColor: 'rgba(168,85,247,0.08)',
    borderColor: 'rgba(168,85,247,0.25)',
  },
  statusCandidateText: { color: C.purple, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 0.5 },

  // Recent assets
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  refreshBtn: { padding: 4 },
  refreshBtnText: { fontSize: 12, color: C.subtle, fontFamily: 'DMSans_400Regular' },
  emptyText: { fontSize: 13, color: C.subtle, fontFamily: 'DMSans_400Regular', textAlign: 'center', paddingVertical: 16 },
  assetRow: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  assetRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assetRowInfo: { gap: 2, flex: 1 },
  assetRowCoach: { fontSize: 11, color: C.subtle, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5 },
  assetRowExercise: { fontSize: 14, color: C.text, fontFamily: 'DMSans_600SemiBold' },
  assetStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  assetStatusText: { fontSize: 9, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5 },
  assetExpanded: { gap: 10 },
  assetVideo: { width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#000' },
});
