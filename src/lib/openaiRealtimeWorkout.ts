import type { CoachVoiceOption } from '@/lib/coachVoice';

export type RealtimeWorkoutToolName =
  | 'log_set'
  | 'mark_warmup_step'
  | 'mark_cardio_done'
  | 'move_to_next_exercise'
  | 'set_rest_timer'
  | 'schedule_reminder'
  | 'apply_plan_adjustment';

export type RealtimeWorkoutToolCall = {
  arguments: Record<string, unknown>;
  callId: string;
  name: RealtimeWorkoutToolName;
};

export type RealtimeWorkoutToolResult = {
  [key: string]: unknown;
  ok: boolean;
};

export type RealtimeWorkoutSessionConfig = {
  audio: {
    input: {
      format: {
        rate: 24000;
        type: 'audio/pcm';
      };
      noise_reduction: {
        type: 'near_field';
      };
      transcription: {
        language: 'en';
        model: string;
      };
      turn_detection:
        | {
            create_response: boolean;
            eagerness: 'auto' | 'high' | 'low' | 'medium';
            interrupt_response: boolean;
            type: 'semantic_vad';
          }
        | {
            create_response: boolean;
            interrupt_response: boolean;
            prefix_padding_ms: number;
            silence_duration_ms: number;
            threshold: number;
            type: 'server_vad';
          };
    };
    output: {
      format: {
        rate: 24000;
        type: 'audio/pcm';
      };
      voice: string;
    };
  };
  max_output_tokens: number;
  truncation: {
    retention_ratio: number;
    token_limits: {
      post_instructions: number;
    };
    type: 'retention_ratio';
  };
  tool_choice: 'auto';
  tools: ReadonlyArray<unknown>;
  type: 'realtime';
};

export const WORKOUT_REALTIME_TOOLS = [
  {
    description:
      'Log a working set, warm-up effort, or cardio effort into the workout. Use this when the athlete tells you reps, weight, sets, or completion details.',
    name: 'log_set',
    parameters: {
      additionalProperties: false,
      properties: {
        cardio: { type: 'boolean' },
        exerciseName: { type: 'string' },
        reps: { type: 'string' },
        setCount: { type: 'number' },
        warmup: { type: 'boolean' },
        weightLbs: { type: 'string' },
      },
      required: ['exerciseName'],
      type: 'object',
    },
    type: 'function',
  },
  {
    description:
      'Mark a warm-up step complete or incomplete. Use this whenever the athlete says a specific warm-up movement is done.',
    name: 'mark_warmup_step',
    parameters: {
      additionalProperties: false,
      properties: {
        complete: { type: 'boolean' },
        stepIndex: { type: 'number' },
      },
      required: ['stepIndex'],
      type: 'object',
    },
    type: 'function',
  },
  {
    description:
      'Mark the cardio finisher complete or incomplete. Use this when the athlete confirms they finished cardio.',
    name: 'mark_cardio_done',
    parameters: {
      additionalProperties: false,
      properties: {
        complete: { type: 'boolean' },
      },
      type: 'object',
    },
    type: 'function',
  },
  {
    description:
      'Advance the workout to the next exercise. Use this when the athlete asks what is next or wants to move on.',
    name: 'move_to_next_exercise',
    parameters: {
      additionalProperties: false,
      properties: {
        skipCurrent: { type: 'boolean' },
      },
      type: 'object',
    },
    type: 'function',
  },
  {
    description: 'Set the rest timer in seconds. Use only one of the supported values: 30, 60, 90, or 120.',
    name: 'set_rest_timer',
    parameters: {
      additionalProperties: false,
      properties: {
        seconds: { enum: [30, 60, 90, 120], type: 'number' },
      },
      required: ['seconds'],
      type: 'object',
    },
    type: 'function',
  },
  {
    description:
      'Schedule a reminder for the athlete. Use this if they ask to be reminded about meals, walking, weigh-ins, or workouts.',
    name: 'schedule_reminder',
    parameters: {
      additionalProperties: false,
      properties: {
        body: { type: 'string' },
        remindAtIso: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['title'],
      type: 'object',
    },
    type: 'function',
  },
  {
    description:
      'Apply or note a training-plan adjustment when the athlete asks for a plan change. Use this to store a coaching adjustment note into the active plan.',
    name: 'apply_plan_adjustment',
    parameters: {
      additionalProperties: false,
      properties: {
        note: { type: 'string' },
      },
      required: ['note'],
      type: 'object',
    },
    type: 'function',
  },
] as const;

export function buildWorkoutRealtimeInstructions(input: {
  coachVoice: CoachVoiceOption | null;
  workoutContext: string;
}) {
  const coachName = input.coachVoice?.label ?? 'Marcus';
  const personaBlock = input.coachVoice?.persona ? `\n\nVOICE PERSONA\n${input.coachVoice.persona}` : '';

  return `You are ${coachName}, the live APEX workout coach inside a strength-training session.

Your job is to stay with the athlete through the entire workout, give short spoken coaching, and use tools whenever the athlete asks you to log, advance, mark completion, schedule reminders, or update the plan.

Core behavior:
- Sound like a real coach in the athlete's ear, not a chatbot.
- Usually answer in one short sentence. Use two only if needed.
- Keep replies specific to the current movement, workload, form cue, or next action.
- Respond like spoken coaching in an earbud: short, natural, and immediately useful.
- If the athlete gives a clear logging command, call the right tool first.
- If the athlete asks what is next, move them forward with the tool.
- If the athlete asks to repeat yourself, repeat the clearest cue in fresh words.
- If you use a tool, briefly explain what you changed after the tool succeeds.
- Never say the session is finished unless the workout context says every lift and cardio piece are complete.
- Never invent progress that the workout state does not support.
- Use the workout context below as the source of truth for workout order and progress.

Tool priorities:
- Use log_set for reps, weight, completed sets, warm-up logging, and cardio logging.
- Use mark_warmup_step for warm-up completion.
- Use mark_cardio_done for cardio completion.
- Use move_to_next_exercise when the athlete wants the next movement.
- Use set_rest_timer when rest timing is requested.
- Use schedule_reminder when the athlete explicitly asks for a reminder.
- Use apply_plan_adjustment when they ask you to change the training plan itself.

Never output markdown, bullets, or emoji. Spoken text only.${personaBlock}

WORKOUT CONTEXT
${input.workoutContext}`.trim();
}

export function buildWorkoutRealtimeSessionConfig(input: {
  coachVoice: CoachVoiceOption | null;
  turnDetectionMode?: 'semantic_vad' | 'server_vad';
  tools: ReadonlyArray<unknown>;
}): RealtimeWorkoutSessionConfig {
  return {
    audio: {
      input: {
        format: {
          rate: 24000,
          type: 'audio/pcm',
        },
        noise_reduction: {
          type: 'near_field',
        },
        transcription: {
          language: 'en',
          model: 'gpt-4o-mini-transcribe',
        },
        turn_detection:
          input.turnDetectionMode === 'server_vad'
            ? {
                create_response: true,
                interrupt_response: true,
                prefix_padding_ms: 300,
                silence_duration_ms: 700,
                threshold: 0.6,
                type: 'server_vad',
              }
            : {
                create_response: true,
                eagerness: 'auto',
                interrupt_response: true,
                type: 'semantic_vad',
              },
      },
      output: {
        format: {
          rate: 24000,
          type: 'audio/pcm',
        },
        voice: input.coachVoice?.realtimeVoice ?? 'ash',
      },
    },
    max_output_tokens: 220,
    truncation: {
      retention_ratio: 0.8,
      token_limits: {
        post_instructions: 8000,
      },
      type: 'retention_ratio',
    },
    tool_choice: 'auto',
    tools: input.tools,
    type: 'realtime',
  };
}
