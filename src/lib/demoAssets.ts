import { supabase } from '@/lib/supabase';

export type DemoAsset = {
  id: string;
  coachLabel: string;
  exerciseName: string;
  assetKind: 'reference' | 'video';
  status: 'candidate' | 'approved' | 'archived';
  prompt?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

const SEEDED_APPROVED_DEMO_ASSETS: DemoAsset[] = [
  {
    id: 'seeded-marcus-bench-press-video-v1',
    coachLabel: 'Marcus',
    exerciseName: 'Bench Press',
    assetKind: 'video',
    status: 'approved',
    prompt: 'Seeded approved Marcus bench press demo. 16:9, 12 seconds, 3 to 4 clean reps, chest touch at the bottom, strong press and lockout.',
    imageUrl: null,
    videoUrl: 'https://v3b.fal.media/files/b/0a96348f/8WpG7tYXDqYQWEztAz6BT_video.mp4',
    requestId: null,
    metadata: {
      seeded: true,
      source: 'manual-approval',
      aspectRatio: '16:9',
      durationSeconds: 12,
    },
    createdAt: '2026-04-14T09:30:00.000Z',
    updatedAt: '2026-04-14T09:30:00.000Z',
  },
];

function normalizeAssetKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapDemoAsset(row: any): DemoAsset {
  return {
    id: row.id,
    coachLabel: row.coach_label,
    exerciseName: row.exercise_name,
    assetKind: row.asset_kind,
    status: row.status,
    prompt: row.prompt ?? null,
    imageUrl: row.image_url ?? null,
    videoUrl: row.video_url ?? null,
    requestId: row.request_id ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getApprovedDemoAsset(coachLabel: string, exerciseName: string, assetKind: 'reference' | 'video') {
  const seeded = SEEDED_APPROVED_DEMO_ASSETS.find((asset) =>
    asset.assetKind === assetKind &&
    normalizeAssetKey(asset.coachLabel) === normalizeAssetKey(coachLabel) &&
    normalizeAssetKey(asset.exerciseName) === normalizeAssetKey(exerciseName),
  );
  if (seeded) return seeded;

  const { data, error } = await supabase
    .from('demo_assets')
    .select('*')
    .eq('coach_label', coachLabel)
    .eq('exercise_name', exerciseName)
    .eq('asset_kind', assetKind)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data) return mapDemoAsset(data);

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from('demo_assets')
    .select('*')
    .eq('coach_label', coachLabel)
    .eq('asset_kind', assetKind)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(200);

  if (fallbackError) throw fallbackError;
  const normalizedExerciseName = normalizeAssetKey(exerciseName);
  const matched = (fallbackRows ?? []).find((row) => normalizeAssetKey(row.exercise_name) === normalizedExerciseName);
  return matched ? mapDemoAsset(matched) : null;
}

export async function getDemoAssetsForExercise(coachLabel: string, exerciseName: string, assetKind?: 'reference' | 'video') {
  let query = supabase
    .from('demo_assets')
    .select('*')
    .eq('coach_label', coachLabel)
    .eq('exercise_name', exerciseName)
    .order('created_at', { ascending: false });

  if (assetKind) {
    query = query.eq('asset_kind', assetKind);
  }

  const { data, error } = await query.limit(20);
  if (error) throw error;
  return (data ?? []).map(mapDemoAsset);
}

export async function getCoachDemoAssets(coachLabel: string, assetKind?: 'reference' | 'video') {
  const seeded = SEEDED_APPROVED_DEMO_ASSETS.filter((asset) =>
    normalizeAssetKey(asset.coachLabel) === normalizeAssetKey(coachLabel) &&
    (!assetKind || asset.assetKind === assetKind),
  );

  let query = supabase
    .from('demo_assets')
    .select('*')
    .eq('coach_label', coachLabel)
    .order('created_at', { ascending: false });

  if (assetKind) {
    query = query.eq('asset_kind', assetKind);
  }

  const { data, error } = await query.limit(500);
  if (error) throw error;
  return [...seeded, ...(data ?? []).map(mapDemoAsset)];
}

export function normalizeDemoExerciseName(value: string) {
  return normalizeAssetKey(value);
}

export async function approveDemoAsset(id: string) {
  const { error } = await supabase
    .from('demo_assets')
    .update({ status: 'approved' })
    .eq('id', id);
  if (error) throw error;
}

export async function archiveDemoAsset(id: string) {
  const { error } = await supabase
    .from('demo_assets')
    .update({ status: 'archived' })
    .eq('id', id);
  if (error) throw error;
}
