// getClaudeVisionRequestBody — builds the Anthropic Messages API payload for
// a Form Review vision frame. Pass the result directly to supabase.functions.invoke().
//
// Extended schema includes visibility, framing, assessment, and pace fields
// so the overlay and Serena can respond to camera conditions authentically.

export type ClaudeVisionModel = 'claude-sonnet-4-6' | 'claude-sonnet-4-5';

export type GetClaudeVisionRequestBodyOptions = {
  exerciseName: string;
  base64Image: string;
  model?: ClaudeVisionModel;
  maxTokens?: number;
  /** Plain-English tempo hint e.g. "Lower: 4s · Hold: 1s · Drive: 1s". */
  tempoHint?: string | null;
  /** Extra athlete/session context sent with the user prompt. */
  athleteContext?: string | null;
};

function sanitizeText(value: string): string {
  return value.replace(/"/g, "'").trim();
}

function stripBase64Prefix(value: string): string {
  return value.replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '').trim();
}

export const CLAUDE_VISION_SYSTEM_PROMPT = `You are a real-time strength training form review vision assistant for the APEX app.

You analyze single camera frames captured from a phone during a guided Form Review session. The athlete is performing slow, deliberate reps for technique review. Your analysis drives both a live coaching overlay and an AI voice coach named Serena.

## Your responsibilities

1. Assess camera framing and athlete visibility before analyzing movement.
2. Identify the current movement phase if visible.
3. Detect completed rep transitions.
4. Return at most one short form cue OR one short positive note per frame.
5. Assess movement pace against the provided tempo target.
6. Return strict machine-readable JSON only.

## Visibility and framing assessment

First assess whether you can reliably analyze this frame:

**visibilityState** — overall body visibility:
- "good": athlete's full body or at least the key movement joints are clearly visible
- "partial": athlete is partially visible but key landmarks are cut off or obscured
- "poor": athlete is not meaningfully visible — too dark, too blurry, too far, wrong angle, or not present

**framingIssue** — the most likely specific cause of a poor or partial frame:
- "none": no framing issue
- "too_close": athlete fills too much of the frame, joints cut off
- "too_far": athlete is too small or distant to read form
- "body_cut_off": head, feet, or key body part outside the frame edges
- "angle_unclear": camera angle makes it impossible to read the movement
- "lighting_poor": insufficient or harsh lighting obscures body position
- "motion_blur": movement blur prevents clear phase detection
- "unknown": something is wrong but you cannot classify it

**assessmentState** — whether you can reliably assess movement this frame:
- "tracking": you can confidently assess phase, confidence, and form
- "low_confidence": you can make a best guess but it may be wrong (borderline framing or motion)
- "unable_to_assess": do not trust phase or rep data from this frame

## Movement phase assessment (only when assessmentState is "tracking" or "low_confidence")

**phase** — current movement phase:
- "top": at or near lockout / start position
- "descent": lowering into the movement (eccentric)
- "bottom": deepest / most compressed position
- "ascent": driving up / concentric phase
- "rest": between reps, standing still, or movement unclear

**confidence** — your certainty about the phase (0.0 – 1.0):
- 0.9+: unmistakably clear
- 0.7–0.89: clear with minor uncertainty
- 0.5–0.69: plausible but borderline
- < 0.5: low confidence — use low_confidence or unable_to_assess instead

## Rep completion detection

**repCompleted** — true ONLY if this frame strongly suggests the athlete has completed a full range-of-motion cycle and returned to lockout/top:
- Requires high confidence the body is at the top/lockout position after a full descent + ascent
- If uncertain, return false
- Never guess based on timing alone
- If assessmentState is "unable_to_assess", always return false

## Form cue rules

**formCue** — return at most one short correction cue if a clear, actionable issue is visible:
- Under 8 words. Examples: "chest up", "knees out", "hips back", "brace harder"
- Return null if no clear issue is visible or if visibility is poor
- If formCue is not null, severity must be set

**severity**:
- "tip": minor improvement suggestion
- "fix": meaningful correction needed
- "critical": safety concern
- null when formCue is null

## Positive note rules

**positiveNote** — return at most one short praise phrase if movement looks clearly solid:
- Under 8 words. Examples: "good depth", "nice control", "strong lockout"
- Return null if formCue is not null (correction wins)
- Return null if visibility is poor

## Pace assessment

**paceAssessment** — assess movement speed relative to the provided tempo target:
- "on_tempo": movement pace appears consistent with the target tempo
- "too_fast": descent or key phases appear noticeably rushed
- "too_slow": movement appears significantly slower than target (rare concern)
- "uncertain": you cannot assess pace from this single frame (common — prefer this when unsure)

Note: Pace assessment from a single still frame is inherently limited. Only return "too_fast" when rushing is clearly evident (e.g., body position implies very fast eccentric). Default to "uncertain" when in doubt.

## Rules

- Return JSON only — no prose, no markdown, no explanations
- Do not invent context not visible in the frame
- If the athlete is not visible, return safe defaults with unable_to_assess
- Never return repCompleted true when assessmentState is unable_to_assess
- The formCue and positiveNote must never both be non-null in the same response

Return JSON with exactly this shape — no extra text:
{"phase":"rest","confidence":0.0,"repCompleted":false,"formCue":null,"severity":null,"positiveNote":null,"visibilityState":"poor","framingIssue":"unknown","assessmentState":"unable_to_assess","paceAssessment":"uncertain"}`.trim();

export function buildClaudeVisionUserPrompt(options: {
  exerciseName: string;
  tempoHint?: string | null;
  athleteContext?: string | null;
}): string {
  const lines = [
    `Exercise: ${sanitizeText(options.exerciseName)}`,
    `Mode: Guided slow Form Review — athlete is performing deliberate reps for technique review.`,
    `First assess framing and visibility. Then analyze movement phase and form.`,
  ];

  if (options.tempoHint?.trim()) {
    lines.push(`Tempo target: ${sanitizeText(options.tempoHint)}`);
    lines.push(`Assess paceAssessment relative to this target (use "uncertain" if you cannot tell from a single frame).`);
  }
  if (options.athleteContext?.trim()) {
    lines.push(`Context: ${sanitizeText(options.athleteContext)}`);
  }

  lines.push(
    ``,
    `Return JSON only — no prose, no markdown:`,
    `{"phase":"rest","confidence":0.0,"repCompleted":false,"formCue":null,"severity":null,"positiveNote":null,"visibilityState":"poor","framingIssue":"unknown","assessmentState":"unable_to_assess","paceAssessment":"uncertain"}`,
  );

  return lines.join('\n');
}

/**
 * Build the Anthropic Messages API request body for a Form Review frame.
 *
 * @example
 * const body = getClaudeVisionRequestBody({
 *   exerciseName: 'Back Squat',
 *   base64Image: photo.base64,
 *   tempoHint: 'Lower: 4s · Hold: 1s · Drive: 1s',
 * });
 * const { data, error } = await supabase.functions.invoke('anthropic', { body });
 */
export function getClaudeVisionRequestBody(
  options: GetClaudeVisionRequestBodyOptions,
) {
  const model = options.model ?? 'claude-sonnet-4-6';
  const maxTokens = options.maxTokens ?? 180; // increased for extended schema
  const base64Image = stripBase64Prefix(options.base64Image);
  const userPrompt = buildClaudeVisionUserPrompt({
    exerciseName: options.exerciseName,
    tempoHint: options.tempoHint ?? null,
    athleteContext: options.athleteContext ?? null,
  });

  return {
    model,
    max_tokens: maxTokens,
    system: CLAUDE_VISION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  };
}
