import { fal } from '@fal-ai/client';
import { env } from '@/lib/env';

const IMAGE_MODEL = 'openai/gpt-image-2/edit';
const VIDEO_MODEL = 'xai/grok-imagine-video/reference-to-video';

export type VideoGenStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

export type VideoGenRequest = {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
};

export type VideoGenResult = {
  requestId: string;
  status: VideoGenStatus;
  videoUrl?: string;
  imageUrl?: string;
  error?: string;
};

function configureFal() {
  fal.config({ credentials: env.falApiKey });
}

// Step 1 — edit coach reference photo into exercise-specific still
export async function submitReferenceImage(params: {
  imageUrl: string;
  prompt: string;
}): Promise<VideoGenRequest> {
  configureFal();

  const { request_id } = await fal.queue.submit(IMAGE_MODEL, {
    input: {
      prompt: params.prompt,
      image_urls: [params.imageUrl],
      image_size: 'landscape_16_9',
      quality: 'high',
      num_images: 1,
      output_format: 'png',
    },
  });

  return {
    requestId: request_id,
    statusUrl: `https://queue.fal.run/requests/${request_id}/status`,
    responseUrl: `https://queue.fal.run/requests/${request_id}`,
  };
}

// Step 2 — animate the approved reference image into a 16:9 720p video
export async function submitImageToVideo(params: {
  imageUrl: string;
  prompt: string;
}): Promise<VideoGenRequest> {
  configureFal();

  const videoPrompt = `Animate @Image1 - no talking - realistic movement - no sweat`;

  const { request_id } = await fal.queue.submit(VIDEO_MODEL, {
    input: {
      prompt: videoPrompt,
      reference_image_urls: [params.imageUrl],
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '720p',
    },
  });

  return {
    requestId: request_id,
    statusUrl: `https://queue.fal.run/requests/${request_id}/status`,
    responseUrl: `https://queue.fal.run/requests/${request_id}`,
  };
}

export async function pollJobStatus(request: VideoGenRequest): Promise<VideoGenResult> {
  configureFal();

  const status = await fal.queue.status(IMAGE_MODEL, {
    requestId: request.requestId,
    logs: false,
  });

  const raw = (status as any).status ?? '';
  const mapped: VideoGenStatus =
    raw === 'COMPLETED' ? 'completed'
    : raw === 'FAILED' ? 'failed'
    : raw === 'IN_PROGRESS' ? 'in_progress'
    : 'queued';

  if (mapped === 'completed') {
    return fetchResult(request);
  }

  return { requestId: request.requestId, status: mapped };
}

export const pollVideoStatus = pollJobStatus;

async function fetchResult(request: VideoGenRequest): Promise<VideoGenResult> {
  configureFal();

  try {
    // Try image model result shape first
    const res = await fal.queue.result(IMAGE_MODEL, { requestId: request.requestId });
    const data = (res as any).data ?? res;

    const imageUrl: string | undefined =
      data?.images?.[0]?.url ?? data?.image?.url ?? undefined;

    const videoUrl: string | undefined =
      data?.video?.url ?? data?.video_url ?? undefined;

    return { requestId: request.requestId, status: 'completed', imageUrl, videoUrl };
  } catch {
    return { requestId: request.requestId, status: 'failed', error: 'Could not fetch result' };
  }
}

// Build exercise-specific image-edit prompt
export function buildDemoPrompt(exercise: string, equipment: string, coachGender: 'male' | 'female' = 'male'): string {
  const pronoun = coachGender === 'female' ? 'her' : 'him';
  const name = exercise.trim();
  const eq = equipment.trim();

  // Generate a natural exercise description
  const bodyweightExercises = new Set(['push up', 'push-up', 'pushup', 'pull up', 'pull-up', 'pullup', 'plank', 'burpee', 'lunge', 'squat jump', 'box jump', 'mountain climber', 'sit up', 'crunch', 'dip']);
  const isBodyweight = eq.toLowerCase() === 'bodyweight' || bodyweightExercises.has(name.toLowerCase());

  const equipmentPhrase = isBodyweight ? '' : ` with ${eq.toLowerCase()}`;
  return `Keep everything the same - make ${pronoun} do a ${name}${equipmentPhrase} - wide shot, gym setting`;
}
