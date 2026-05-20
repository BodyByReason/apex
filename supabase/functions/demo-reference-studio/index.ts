import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type GenerateBody = {
  action: 'generate_candidates' | 'generate_wide_reference' | 'approve_candidate' | 'save_video';
  coachLabel?: string;
  exerciseName?: string;
  candidateIndex?: number;
  imageBase64?: string;
  prompt?: string;
  sourceImageBase64?: string;
  sourceImageUrl?: string;
  status?: 'candidate' | 'approved' | 'archived';
  videoUrl?: string;
  metadata?: Record<string, unknown>;
};

function decodeJwtSub(request: Request) {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
    const payload = JSON.parse(json) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function buildPromptOnlyPayload(coachLabel: string, exerciseName: string, warning?: string) {
  const prompts = [1, 2].map((variant) => ({
    id: `${coachLabel}-${exerciseName}-${variant}`,
    prompt: buildReferencePrompt(coachLabel, exerciseName, variant),
  }));

  return {
    candidates: [],
    prompts,
    provider: 'prompt-only',
    warning,
  };
}

function getExerciseSpec(exerciseName: string) {
  const normalizedExercise = exerciseName.toLowerCase();
  const equipment =
    normalizedExercise.includes('dumbbell') || normalizedExercise.includes('db')
      ? 'dumbbells'
      : normalizedExercise.includes('barbell')
        ? 'barbell'
        : normalizedExercise.includes('cable')
          ? 'cable machine'
          : normalizedExercise.includes('band')
            ? 'resistance band'
            : normalizedExercise.includes('machine')
              ? 'machine'
              : 'correct exercise equipment';
  const position =
    normalizedExercise.includes('seated')
      ? 'seated'
      : normalizedExercise.includes('standing')
        ? 'standing'
        : normalizedExercise.includes('lying') || normalizedExercise.includes('bench') || normalizedExercise.includes('press')
          ? 'bench-supported'
          : 'correct athletic position';
  const grip =
    normalizedExercise.includes('underhand') || normalizedExercise.includes('supinated')
      ? 'underhand grip'
      : normalizedExercise.includes('overhand') || normalizedExercise.includes('pronated')
        ? 'overhand grip'
        : normalizedExercise.includes('neutral')
          ? 'neutral grip'
          : 'exercise-appropriate grip';
  const benchAngle =
    normalizedExercise.includes('incline')
      ? 'incline bench'
      : normalizedExercise.includes('decline')
        ? 'decline bench'
        : normalizedExercise.includes('flat') || normalizedExercise.includes('bench press')
          ? 'flat bench'
          : 'correct bench setup if a bench is used';

  return { benchAngle, equipment, grip, position };
}

function getExerciseSetupDirection(exerciseName: string) {
  const normalizedExercise = exerciseName.toLowerCase();
  const spec = getExerciseSpec(exerciseName);

  if (normalizedExercise.includes('bench press')) {
    return `The coach is already lying on a ${spec.benchAngle} bench under a ${spec.equipment} with a realistic ${spec.grip}, chest up, shoulder blades pinned together, hands set on the bar, toes pulled back toward the glutes, balls of the feet pressing into the floor, realistic bench rack visible, bar lowering toward the upper ribs, and the scene clearly reads as a real bench press setup rather than a standing barbell pose.`;
  }

  if (normalizedExercise.includes('overhead press')) {
    return `The coach is ${spec.position} with the ${spec.equipment} at shoulder level or pressing overhead using a realistic ${spec.grip}, elbows and wrists aligned, and the scene clearly reads as an overhead press setup.`;
  }

  if (normalizedExercise.includes('incline')) {
    return `The coach is positioned on an ${spec.benchAngle} using ${spec.equipment}, with a realistic ${spec.grip} and the equipment clearly visible so the movement reads correctly.`;
  }

  if (normalizedExercise.includes('lateral raise')) {
    return `The coach is ${spec.position} with ${spec.equipment} at the sides or mid-raise, using a realistic ${spec.grip}, with natural shoulder positioning and believable gym posture.`;
  }

  if (normalizedExercise.includes('pushdown')) {
    return `The coach is ${spec.position} at a ${spec.equipment} with the attachment in hand, elbows tucked, realistic ${spec.grip}, and the machine clearly visible so the exercise reads as a tricep pushdown.`;
  }

  return `The coach is correctly demonstrating ${exerciseName} using ${spec.equipment}, in a ${spec.position} setup, with a realistic ${spec.grip}, ${spec.benchAngle}, and believable form in a real commercial gym.`;
}

function buildReferencePrompt(coachLabel: string, exerciseName: string, variant: number) {
  const coachStyle =
    coachLabel === 'Serena'
      ? 'Photorealistic female performance coach in her late 20s, bright warm expression, athletic build, real gym environment, true-to-life skin pores, subtle facial asymmetry, realistic skin grain, natural sweat sheen, realistic proportions, documentary fitness photography, authentic training presence, strong but friendly eye contact.'
      : 'Photorealistic male strength coach in his late 30s, commanding intense expression, muscular build, real gym environment, true-to-life skin pores, subtle facial asymmetry, realistic beard texture, realistic skin grain, natural sweat sheen, realistic proportions, documentary fitness photography, authentic training presence, focused eyes.';

  const variationNotes = [
    'Natural handheld sports photo with subtle depth of field, real lens falloff, realistic fabric wrinkles, and no smoothing filter.',
    'Mid-session training photo taken inside a working gym, not a studio, with believable skin texture and natural imperfections.',
    'Real athlete-coach setup moment with believable body positioning, equipment spacing, and documentary-style skin detail.',
    'Editorial sports photo with natural sweat, realistic shadows, no beauty retouching, and no waxy or plastic-looking skin.',
  ];

  const exerciseDirection = getExerciseSetupDirection(exerciseName);

  return `${coachStyle} Exercise: ${exerciseName}. ${variationNotes[(variant - 1) % variationNotes.length]} ${exerciseDirection} Strict 16:9 landscape framing with enough room to clearly read the exercise setup. Real commercial gym lighting. Shot on a real camera. No CGI look, no cartoon look, no illustration feel, no airbrushed skin, no glossy ad styling, no waxy skin, no plastic skin, no hyper-sharpened pores, no exaggerated muscles, no distorted anatomy, no extra limbs, no text, no watermark, no collage.`;
}

function buildWideReferencePrompt(coachLabel: string, exerciseName: string) {
  return coachLabel === 'Serena'
    ? `She is doing ${exerciseName}. Keep everything else the same.`
    : `He is doing ${exerciseName}. Keep everything else the same.`;
}

function base64ToBlob(base64: string, mimeType = 'image/png') {
  const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([binary], { type: mimeType });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), { headers: corsHeaders, status: 405 });
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), { headers: corsHeaders, status: 400 });
  }

  const coachLabel = body.coachLabel?.trim() || 'Marcus';
  const exerciseName = body.exerciseName?.trim() || '';
  const requesterId = decodeJwtSub(request);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Supabase service role is not configured.' }), { headers: corsHeaders, status: 500 });
  }

  if ((body.action === 'approve_candidate' || body.action === 'save_video') && !requesterId) {
    return new Response(JSON.stringify({ error: 'Could not identify the signed-in coach for this save action.' }), { headers: corsHeaders, status: 401 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === 'save_video') {
    if (!exerciseName || !body.videoUrl) {
      return new Response(JSON.stringify({ error: 'exerciseName and videoUrl are required.' }), { headers: corsHeaders, status: 400 });
    }

    const { data, error } = await supabase
      .from('demo_assets')
      .insert({
        created_by: requesterId,
        coach_label: coachLabel,
        exercise_name: exerciseName,
        asset_kind: 'video',
        status: body.status ?? 'approved',
        video_url: body.videoUrl,
        prompt: body.prompt ?? null,
        metadata: body.metadata ?? {},
      })
      .select('*')
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
    }

    return new Response(JSON.stringify({ asset: data }), { headers: corsHeaders, status: 200 });
  }

  if (body.action === 'generate_wide_reference') {
    if (!exerciseName || !body.sourceImageUrl) {
      return new Response(JSON.stringify({ error: 'exerciseName and sourceImageUrl are required.' }), { headers: corsHeaders, status: 400 });
    }

    if (!openaiApiKey) {
      return new Response(JSON.stringify({
        candidate: null,
        warning: 'Wide-shot generation is not connected yet. Add a working OPENAI_API_KEY to enable reference widening.',
      }), {
        headers: corsHeaders,
        status: 200,
      });
    }

    try {
      const sourceResponse = await fetch(body.sourceImageUrl);
      if (!sourceResponse.ok) {
        return new Response(JSON.stringify({ error: 'Could not fetch the approved reference image for wide-shot generation.' }), {
          headers: corsHeaders,
          status: 400,
        });
      }

      const sourceBlob = await sourceResponse.blob();
      const prompt = buildWideReferencePrompt(coachLabel, exerciseName);
      const formData = new FormData();
      formData.append('model', 'gpt-image-1');
      formData.append('prompt', prompt);
      formData.append('size', '1536x1024');
      formData.append('quality', 'high');
      formData.append('image', sourceBlob, `${coachLabel.toLowerCase()}-${exerciseName.toLowerCase().replace(/\s+/g, '-')}-source.png`);

      const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let warning = 'Wide-shot generation is unavailable right now.';
        try {
          const parsed = JSON.parse(errorText) as { error?: { code?: string; message?: string } };
          if (parsed.error?.code === 'billing_hard_limit_reached') {
            warning = 'OpenAI wide-shot generation is paused because the OpenAI project hit its billing hard limit.';
          } else if (parsed.error?.message) {
            warning = parsed.error.message;
          }
        } catch {
          if (errorText.trim()) warning = errorText;
        }

        return new Response(JSON.stringify({ candidate: null, warning }), {
          headers: corsHeaders,
          status: 200,
        });
      }

      const payload = await response.json() as { data?: Array<{ b64_json?: string }> };
      const imageBase64 = payload.data?.[0]?.b64_json;
      if (!imageBase64) {
        return new Response(JSON.stringify({ candidate: null, warning: 'OpenAI did not return a wide-shot image.' }), {
          headers: corsHeaders,
          status: 200,
        });
      }

      return new Response(JSON.stringify({
        candidate: {
          id: `${coachLabel}-${exerciseName}-wide-${Date.now()}`,
          prompt,
          imageBase64,
          mimeType: 'image/png',
        },
        provider: 'openai-gpt-image-1-edit',
      }), {
        headers: corsHeaders,
        status: 200,
      });
    } catch (error) {
      return new Response(JSON.stringify({
        candidate: null,
        warning: error instanceof Error ? error.message : 'Wide-shot generation failed.',
      }), {
        headers: corsHeaders,
        status: 200,
      });
    }
  }

  if (body.action === 'approve_candidate') {
    if (!exerciseName || !body.imageBase64) {
      return new Response(JSON.stringify({ error: 'exerciseName and imageBase64 are required.' }), { headers: corsHeaders, status: 400 });
    }

    const binary = Uint8Array.from(atob(body.imageBase64), (char) => char.charCodeAt(0));
    const fileName = `${coachLabel.toLowerCase()}-${exerciseName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.png`;
    const filePath = `${coachLabel.toLowerCase()}/${fileName}`;

    const upload = await supabase.storage
      .from('demo-reference-assets')
      .upload(filePath, binary, { contentType: 'image/png', upsert: true });

    if (upload.error) {
      return new Response(JSON.stringify({ error: upload.error.message }), { headers: corsHeaders, status: 500 });
    }

    const { data: publicUrlData } = supabase.storage.from('demo-reference-assets').getPublicUrl(filePath);

    const { data, error } = await supabase
      .from('demo_assets')
      .insert({
        created_by: requesterId,
        coach_label: coachLabel,
        exercise_name: exerciseName,
        asset_kind: 'reference',
        status: 'approved',
        image_url: publicUrlData.publicUrl,
        prompt: body.prompt ?? null,
        metadata: body.metadata ?? {},
      })
      .select('*')
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
    }

    return new Response(JSON.stringify({ asset: data, publicUrl: publicUrlData.publicUrl }), { headers: corsHeaders, status: 200 });
  }

  if (body.action === 'generate_candidates') {
    if (!exerciseName) {
      return new Response(JSON.stringify({ error: 'exerciseName is required.' }), { headers: corsHeaders, status: 400 });
    }

    if (!openaiApiKey) {
      return new Response(JSON.stringify(buildPromptOnlyPayload(
        coachLabel,
        exerciseName,
        'Reference images are not connected yet. Add a working OPENAI_API_KEY to enable still generation.',
      )), {
        headers: corsHeaders,
        status: 200,
      });
    }

    const generationJobs = [1, 2].map(async (variant) => {
      const prompt = buildReferencePrompt(coachLabel, exerciseName, variant);
      let response: Response;

      if (body.sourceImageBase64 || body.sourceImageUrl) {
        let sourceBlob: Blob | null = null;
        if (body.sourceImageBase64) {
          sourceBlob = base64ToBlob(body.sourceImageBase64);
        } else if (body.sourceImageUrl) {
          const sourceResponse = await fetch(body.sourceImageUrl);
          if (sourceResponse.ok) {
            sourceBlob = await sourceResponse.blob();
          }
        }

        if (sourceBlob) {
          const formData = new FormData();
          formData.append('model', 'gpt-image-1');
          formData.append('prompt', buildWideReferencePrompt(coachLabel, exerciseName));
          formData.append('size', '1536x1024');
          formData.append('quality', 'high');
          formData.append('image', sourceBlob, `${coachLabel.toLowerCase()}-${exerciseName.toLowerCase().replace(/\s+/g, '-')}-reference.png`);

          response = await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
            },
            body: formData,
          });
        } else {
          response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-image-1',
              prompt: buildWideReferencePrompt(coachLabel, exerciseName),
              size: '1536x1024',
              quality: 'medium',
            }),
          });
        }
      } else {
        response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-image-1',
            prompt: buildWideReferencePrompt(coachLabel, exerciseName),
            size: '1536x1024',
            quality: 'medium',
          }),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        let warning = 'Reference image generation is unavailable right now. You can still use the saved prompts while we reconnect the image provider.';
        try {
          const parsed = JSON.parse(errorText) as { error?: { code?: string; message?: string } };
          if (parsed.error?.code === 'billing_hard_limit_reached') {
            warning = 'OpenAI image generation is paused because the OpenAI project hit its billing hard limit. Add billing or top up OpenAI, then try again.';
          } else if (parsed.error?.message) {
            warning = parsed.error.message;
          }
        } catch {
          if (errorText.trim()) warning = errorText;
        }

        throw new Error(warning);
      }

      const payload = await response.json() as { data?: Array<{ b64_json?: string }> };
      const imageBase64 = payload.data?.[0]?.b64_json;
      if (!imageBase64) return null;
      return {
        id: `${coachLabel}-${exerciseName}-${variant}`,
        prompt,
        imageBase64,
        mimeType: 'image/png',
      };
    });

    const results = await Promise.allSettled(generationJobs);
    const candidates = results
      .filter((result): result is PromiseFulfilledResult<{ id: string; prompt: string; imageBase64: string; mimeType: string } | null> => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter(Boolean) as Array<{ id: string; prompt: string; imageBase64: string; mimeType: string }>;

    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (candidates.length === 0) {
      return new Response(JSON.stringify(buildPromptOnlyPayload(
        coachLabel,
        exerciseName,
        rejected?.reason instanceof Error ? rejected.reason.message : 'Reference image generation timed out. Try again in a moment.',
      )), {
        headers: corsHeaders,
        status: 200,
      });
    }

    return new Response(JSON.stringify({ candidates, provider: 'openai-gpt-image-1' }), {
      headers: corsHeaders,
      status: 200,
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action.' }), { headers: corsHeaders, status: 400 });
});
