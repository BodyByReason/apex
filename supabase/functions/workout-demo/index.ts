const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type WorkoutDemoBody = {
  cardio?: string;
  coachPersona?: string;
  coachPersonaPrompt?: string;
  currentExercise?: string;
  currentPrescription?: string;
  exerciseName?: string;
  exerciseSets?: string;
  planTitle?: string;
  referenceImageUrl?: string | null;
  todayWorkout?: string;
  videoRequestId?: string;
  warmup?: string;
  youtubeId?: string | null;
};

type FalQueueSubmitResponse = {
  request_id?: string;
  response_url?: string;
  status_url?: string;
};

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

function getExerciseCoachingCues(exerciseName: string) {
  const normalizedExercise = exerciseName.toLowerCase();
  const spec = getExerciseSpec(exerciseName);

  if (normalizedExercise.includes('bench press')) {
    return {
      spokenCues: `Set up on the ${spec.benchAngle} with the ${spec.equipment} and a solid ${spec.grip}. Chest up, shoulder blades pinned together, bring your toes toward your glutes and drive the balls of your feet into the floor. Feel your back on the way down, let the bar tap the chest at the bottom of the movement, then press up and squeeze the chest for 3 to 4 clean reps.`,
      cameraPlan: [
        `Wide side angle showing Marcus or Serena already lying on the ${spec.benchAngle} with the ${spec.equipment}, feet set and shoulder blades pinned through multiple smooth reps`,
        `Tight bar-path angle showing the ${spec.equipment} lowering under control until it taps the chest at the bottom with chest up and back tension`,
        'Close cue shot on leg drive, chest touch, chest squeeze, and the clean press back to lockout across 3 to 4 reps',
      ],
      generationPrompt: `The coach is already lying on a ${spec.benchAngle} under the ${spec.equipment} using a realistic ${spec.grip}, chest up, shoulder blades pinned together, toes drawn toward the glutes, and the balls of the feet driving into the floor. Show 3 to 4 clean bench press reps in sequence. Each rep should lower under control until the ${spec.equipment} taps the chest at the bottom of the movement, then drive back up with a strong press, chest squeeze, and clean lockout.`,
    };
  }

  return {
    spokenCues: `Set up clean with ${spec.equipment}, in a ${spec.position} position, using a realistic ${spec.grip}. Brace hard, control the lowering phase, and finish 3 to 4 strong reps with intention.`,
    cameraPlan: [
      `Front setup angle on ${exerciseName} showing the coach using ${spec.equipment} in a ${spec.position} setup through multiple clean reps`,
      `Side angle showing range of motion, ${spec.grip}, and bar path or resistance path`,
      `Coach cue close-up on tempo, brace, and finish across 3 to 4 reps with the ${spec.benchAngle}`,
    ],
    generationPrompt: `Clear ${spec.position} setup using ${spec.equipment}, realistic ${spec.grip}, ${spec.benchAngle}, and 3 to 4 clean working reps for ${exerciseName}, finishing strong with controlled tempo and realistic movement.`,
  };
}

function buildFallbackDemo(exerciseName: string, exerciseSets: string, coachPersona: string) {
  const coachName = coachPersona.toLowerCase().includes('serena') ? 'Serena' : 'Marcus';
  const roleLabel = coachName === 'Serena' ? 'performance coach' : 'strength coach';
  const cues = getExerciseCoachingCues(exerciseName);

  return {
    headline: `${exerciseName} with ${coachName}`,
    demoScript:
      coachName === 'Serena'
        ? `Serena walks you through ${exerciseName}. ${cues.spokenCues} Stay smooth through every rep, reset your breath, and own the set.`
        : `Marcus coaches your ${exerciseName}. ${cues.spokenCues} Stay disciplined through the full set and finish every rep clean.`,
    cameraPlan: cues.cameraPlan,
    generationPrompt: `${coachName}, a ${roleLabel}, demonstrates ${exerciseName} for ${exerciseSets}. ${cues.generationPrompt} Use the ${coachName} coach look and personality.`,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      headers: corsHeaders,
      status: 405,
    });
  }

  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');

  let body: WorkoutDemoBody;
  try {
    body = (await request.json()) as WorkoutDemoBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  const exerciseName = body.exerciseName?.trim() || body.currentExercise?.trim() || '';
  const exerciseSets = body.exerciseSets?.trim() || body.currentPrescription?.trim() || 'Use standard working sets';
  const coachPersona = body.coachPersonaPrompt?.trim() || body.coachPersona?.trim() || 'Marcus';
  const fallbackDemo = buildFallbackDemo(exerciseName, exerciseSets, coachPersona);

  if (!exerciseName) {
    return new Response(JSON.stringify({ error: 'exerciseName is required.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  const prompt = `Create a compact AI workout demo package for the exercise below.

Exercise: ${exerciseName}
Prescription: ${exerciseSets}
Coach persona: ${coachPersona}
Plan: ${body.planTitle || 'APEX workout'}
Today workout: ${body.todayWorkout || 'today'}
Warm-up context: ${body.warmup || 'none'}
Cardio context: ${body.cardio || 'none'}
Reference YouTube id: ${body.youtubeId || 'none'}

Return ONLY valid JSON:
{"headline":"...","demoScript":"...","cameraPlan":["...","...","..."],"generationPrompt":"..."}

Rules:
- headline under 10 words
- demoScript under 80 words, spoken like an in-ear coach
- cameraPlan must have exactly 3 items
- generationPrompt should describe a cinematic short workout demo video for this movement, using the chosen coach persona
- if the exercise is Bench Press, the coach should already be lying flat on the bench with the correct setup and cues
- do not mention YouTube in the output`;

  let parsed: { headline?: string; demoScript?: string; cameraPlan?: string[]; generationPrompt?: string } = fallbackDemo;
  let llm_status: 'ready' | 'fallback' = anthropicApiKey ? 'fallback' : 'fallback';

  if (anthropicApiKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'x-api-key': anthropicApiKey,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const text = await response.text();
      if (response.ok) {
        const data = JSON.parse(text) as { content?: Array<{ text?: string }> };
        const raw = data.content?.map((item) => item.text ?? '').join('') ?? '';
        const maybeParsed = JSON.parse(raw) as typeof parsed;
        parsed = {
          headline: maybeParsed.headline ?? fallbackDemo.headline,
          demoScript: maybeParsed.demoScript ?? fallbackDemo.demoScript,
          cameraPlan: maybeParsed.cameraPlan ?? fallbackDemo.cameraPlan,
          generationPrompt: maybeParsed.generationPrompt ?? fallbackDemo.generationPrompt,
        };
        llm_status = 'ready';
      }
    } catch {
      parsed = fallbackDemo;
      llm_status = 'fallback';
    }
  }

  const webhookUrl = Deno.env.get('WORKOUT_DEMO_WEBHOOK_URL');
  let video_url: string | null = null;
  let video_status: 'ready' | 'queued' | 'not_configured' | 'failed' = 'not_configured';
  let video_provider: 'webhook' | 'fal-seedance' | 'none' = 'none';
  let video_request_id: string | null = body.videoRequestId?.trim() || null;
  let falStatusUrl: string | null = null;
  let falResponseUrl: string | null = null;
  if (webhookUrl) {
    try {
      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseName,
          generationPrompt: parsed.generationPrompt,
        }),
      });
      const webhookData = (await webhookResponse.json()) as { video_url?: string };
      video_url = webhookData.video_url ?? null;
      video_status = video_url ? 'ready' : 'queued';
      video_provider = 'webhook';
    } catch {
      video_url = null;
      video_status = 'failed';
    }
  } else {
    const falKey = Deno.env.get('FAL_KEY');
    const coachLabel = (body.coachPersona?.trim() || coachPersona || 'Marcus').toLowerCase();
    const coachImageUrl = body.referenceImageUrl?.trim() || (coachLabel.includes('serena')
      ? Deno.env.get('SERENA_DEMO_IMAGE_URL')
      : Deno.env.get('MARCUS_DEMO_IMAGE_URL'));

    if (falKey && coachImageUrl) {
      try {
        video_provider = 'fal-seedance';
        const endpoint = 'https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/image-to-video';

        if (!video_request_id) {
          const submitResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Key ${falKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt: parsed.generationPrompt,
              image_url: coachImageUrl,
              aspect_ratio: '16:9',
              resolution: '720p',
              duration: '12',
              generate_audio: true,
              enable_safety_checker: true,
            }),
          });

          if (!submitResponse.ok) {
            video_status = 'failed';
          } else {
            const submitData = (await submitResponse.json()) as FalQueueSubmitResponse;
            video_request_id = submitData.request_id ?? null;
            falStatusUrl = submitData.status_url ?? (video_request_id ? `https://queue.fal.run/fal-ai/bytedance/requests/${video_request_id}/status` : null);
            falResponseUrl = submitData.response_url ?? (video_request_id ? `https://queue.fal.run/fal-ai/bytedance/requests/${video_request_id}` : null);
            video_status = video_request_id ? 'queued' : 'failed';
          }
        }

        if (video_request_id) {
          const statusUrl = falStatusUrl ?? `https://queue.fal.run/fal-ai/bytedance/requests/${video_request_id}/status`;
          const responseUrl = falResponseUrl ?? `https://queue.fal.run/fal-ai/bytedance/requests/${video_request_id}`;
          const statusResponse = await fetch(statusUrl, {
            headers: { 'Authorization': `Key ${falKey}` },
          });

          if (statusResponse.ok) {
            const statusData = (await statusResponse.json()) as { status?: string };
            const status = String(statusData.status ?? '');

            if (status === 'COMPLETED') {
              const resultResponse = await fetch(`${responseUrl}/response`, {
                method: 'POST',
                headers: { 'Authorization': `Key ${falKey}` },
              });
              if (resultResponse.ok) {
                const resultData = (await resultResponse.json()) as { video?: { url?: string } };
                video_url = resultData.video?.url ?? null;
                video_status = video_url ? 'ready' : 'failed';
              } else {
                video_status = 'failed';
              }
            } else if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
              video_status = 'queued';
            } else {
              video_status = 'failed';
            }
          } else {
            video_status = 'failed';
          }
        }
      } catch {
        video_status = 'failed';
      }
    }
  }

  return new Response(JSON.stringify({ ...parsed, llm_status, video_provider, video_request_id, video_status, video_url }), {
    headers: corsHeaders,
    status: 200,
  });
});
