import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

export type FormReviewClip = {
  coachUserId: string | null;
  exerciseName: string;
  id: string;
  metadata?: Record<string, unknown> | null;
  status: 'archived' | 'reviewed' | 'submitted';
  submittedAt: string;
  userId: string;
  videoUrl: string;
};

function mapClip(row: any): FormReviewClip {
  return {
    coachUserId: row.coach_user_id ?? null,
    exerciseName: row.exercise_name,
    id: row.id,
    metadata: row.metadata ?? {},
    status: row.status,
    submittedAt: row.submitted_at,
    userId: row.user_id,
    videoUrl: row.video_url,
  };
}

function buildStoragePath(userId: string, exerciseName: string, uri: string) {
  const ext = uri.split('.').pop()?.toLowerCase() || 'mp4';
  const safeExercise = exerciseName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${userId}/${Date.now()}-${safeExercise}.${ext}`;
}

function getContentType(uri: string) {
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  return 'video/mp4';
}

export async function submitFormReviewClip(input: {
  clipUri: string;
  coachUserId?: string | null;
  exerciseName: string;
  metadata?: Record<string, unknown>;
  userId: string;
}) {
  const storagePath = buildStoragePath(input.userId, input.exerciseName, input.clipUri);
  const contentType = getContentType(input.clipUri);
  const fileBase64 = await FileSystem.readAsStringAsync(input.clipUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = Uint8Array.from(atob(fileBase64), (char) => char.charCodeAt(0));

  const { error: uploadError } = await supabase.storage
    .from('form-review-clips')
    .upload(storagePath, bytes, { contentType, upsert: false });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: urlData } = supabase.storage.from('form-review-clips').getPublicUrl(storagePath);
  const { data, error } = await supabase
    .from('form_review_clips')
    .insert({
      coach_user_id: input.coachUserId ?? null,
      exercise_name: input.exerciseName,
      metadata: input.metadata ?? {},
      storage_path: storagePath,
      user_id: input.userId,
      video_url: urlData.publicUrl,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapClip(data);
}

export async function getCoachFormReviewClips(coachUserId: string): Promise<FormReviewClip[]> {
  const { data, error } = await supabase
    .from('form_review_clips')
    .select('*')
    .eq('coach_user_id', coachUserId)
    .order('submitted_at', { ascending: false })
    .limit(200);

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapClip);
}
