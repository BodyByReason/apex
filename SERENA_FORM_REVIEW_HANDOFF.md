# Serena Form Review — Engineering Handoff

## What this feature is

Form Review is a guided rep-counting and coaching mode inside the APEX React Native fitness app. The athlete taps "Review my form" during a live session with Serena (an AI voice coach). A 3-2-1 countdown fires, then the phone camera analyzes every second of movement using Claude Sonnet 4.6 vision. The results drive:

- A live overlay showing the current movement phase, tempo, rep count, and why a rep did or did not count
- Serena's spoken coaching via ElevenLabs — form corrections, rep callouts, framing guidance
- Automatic completion after 5 guided reps, with Supabase persistence

This is distinct from the "Normal set" vision mode (which uses Gemini 2.0 Flash at 400ms cadence for faster rep counting with less coaching depth). Form Review runs at 1000ms cadence, uses Claude for richer structured output, and auto-stops at a configured rep cap.

---

## Tech stack

| Layer | Technology |
|---|---|
| Mobile app | React Native 0.81 + Expo 54 |
| Voice coach | ElevenLabs Conversational AI via `@elevenlabs/react-native` (LiveKit WebRTC) |
| Form Review vision | Claude Sonnet 4.6 via Supabase Edge Function |
| Normal set vision | Gemini 2.0 Flash via Supabase Edge Function |
| Backend / auth / DB | Supabase (Postgres + Edge Functions + Auth) |
| Camera | `expo-camera` (`CameraView`) |

---

## Required secrets / env vars

```
ANTHROPIC_API_KEY      # for the `anthropic` Supabase edge function
GEMINI_API_KEY         # for the `gemini-vision` Supabase edge function
ELEVENLABS_AGENT_ID    # ElevenLabs conversational agent ID for Serena
SUPABASE_URL
SUPABASE_ANON_KEY
```

The mobile app reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `@/lib/env` (Expo config). The edge functions read their keys from Supabase Vault secrets.

---

## File map

```
src/
├── screens/
│   └── SerenaProtoScreen.tsx          ← Main screen. Owns all state, both vision modes,
│                                         Serena session, and UI layout.
├── hooks/
│   ├── useFormReviewVisionLoop.ts     ← Form Review polling loop (Claude).
│   │                                    Owns RepFSM, tempo classification, phase tracking,
│   │                                    stuck detection, and Serena context routing.
│   └── useSerenaLiveSession.ts        ← ElevenLabs WebRTC session. Exposes connect(),
│                                         disconnect(), sendContext(), isSpeaking,
│                                         transcript, currentExercise, loggedSets.
├── components/
│   ├── FormReviewTempoOverlay.tsx     ← Full-camera overlay for Form Review.
│   │                                    Shows phase, confidence, FSM state, tempo chip,
│   │                                    duration badges, coaching cue, framing banner,
│   │                                    rep-blocker hint, rep counter + dots.
│   └── TempoAssistCard.tsx            ← Compact bottom card for Normal set mode (Gemini).
│                                         Shows 4-segment phase rail with live countdown.
├── lib/
│   ├── getClaudeVisionRequestBody.ts  ← Builds the Anthropic Messages API payload.
│   │                                    Contains the full vision system prompt.
│   ├── parseClaudeVisionResult.ts     ← Defensive parser for Claude vision responses.
│   │                                    Handles raw JSON, prose-wrapped JSON,
│   │                                    Anthropic message envelopes.
│   └── buildSerenaContextFromVision.ts← Converts VisionResult into throttled sendContext()
│                                         event strings. Priority-ordered, deduplicated.
└── __tests__/
    └── formReview.test.ts             ← Unit tests for advanceRepFsm,
                                          parseClaudeVisionResult, buildSerenaContextFromVision.

supabase/functions/
├── anthropic/index.ts                 ← General Anthropic Messages API proxy.
│                                         Vision requests: normalizes Claude JSON → VisionResult.
│                                         Other requests: pass-through.
└── gemini-vision/index.ts             ← Gemini 2.0 Flash phase detection for Normal set mode.
```

---

## Data flow — Form Review

```
[CameraView.takePictureAsync()]
        │ base64 JPEG (quality 0.45)
        ▼
[getClaudeVisionRequestBody()]
        │ Anthropic Messages API payload
        │ • system: CLAUDE_VISION_SYSTEM_PROMPT (framing → phase → rep → cue → pace)
        │ • user: exercise name + tempo hint + image
        ▼
[supabase.functions.invoke('anthropic')]
        │ POST to Anthropic API with ANTHROPIC_API_KEY
        │ max_tokens: 180, model: claude-sonnet-4-6
        ▼
[normalizeVisionResult() — edge function]
        │ Extracts JSON from Claude text block, validates all fields, applies safe defaults
        ▼
[normalizeEdgeResponse() — client]
        │ Runs parseClaudeVisionResult for full client-side validation
        │ Infers missing fields from confidence score if old edge function
        ▼
[useFormReviewVisionLoop — runVisionPass()]
        │
        ├─ setVisionPhase / setPhaseConfidence / setAssessmentState / setVisibilityState
        │         → drives FormReviewTempoOverlay display
        │
        ├─ Phase-duration tracking
        │         → measures actual descent/bottom/ascent time
        │         → classifyPhaseTempo() → setTempoStatus
        │
        ├─ Stuck-phase detection
        │         → after 8s in same active phase → setIsStuck + sendSerenaContext(STUCK)
        │
        ├─ advanceRepFsm()
        │         → idle → descending → bottom_reached → ascending → idle
        │         → repConfirmed=true → setRepCount++ → triggers rep flash animation
        │
        ├─ RepBlockerReason detection
        │         → insufficient_depth, no_lockout, moved_too_fast,
        │            poor_visibility, low_confidence, incomplete_cycle, unknown
        │         → setRepBlockerReason → drives blocker hint strip in overlay
        │
        └─ buildSerenaContextFromVision()
                  → priority-ordered, throttled events:
                    FRAMING > COUNTABILITY > REP > FORM > TEMPO
                  → sendSerenaContext(event.text)
                  → ElevenLabs agent speaks the coaching cue
```

---

## RepFSM — state machine

```
idle ──(confident descent/bottom)──▶ descending
         ▲                                 │
         │                    (confident bottom)
         │                                 ▼
         │                          bottom_reached
         │                                 │
         │                    (confident ascent/top)
         │                                 ▼
         └──────(confident top/rest)── ascending
                   repConfirmed = true
```

**Bottom-miss shortcut**: At 1s cadence, the bottom frame is often missed. If the FSM sees `ascent` while in `descending`, it jumps directly to `ascending` without requiring `bottom_reached`. This prevents reps being silently dropped due to cadence gaps.

**Secondary signal**: Claude also emits a `repCompleted` boolean when it directly observes a full cycle. If the FSM missed the rep (ambiguous top frame) but Claude's model-level signal is confident, the secondary path counts the rep and snaps the FSM back to `idle`.

---

## VisionResult schema

Every frame returns this JSON from Claude (validated by `parseClaudeVisionResult`):

```typescript
type VisionResult = {
  phase: 'top' | 'descent' | 'bottom' | 'ascent' | 'rest';
  confidence: number;          // 0.0–1.0
  repCompleted: boolean;       // true only when full cycle + return to lockout observed
  formCue: string | null;      // ≤8 words, corrective. null when form is fine
  severity: 'tip' | 'fix' | 'critical' | null;
  positiveNote: string | null; // ≤8 words, praise. null when formCue is present
  visibilityState: 'good' | 'partial' | 'poor';
  framingIssue: 'none' | 'too_close' | 'too_far' | 'body_cut_off' |
                'angle_unclear' | 'lighting_poor' | 'motion_blur' | 'unknown';
  assessmentState: 'tracking' | 'low_confidence' | 'unable_to_assess';
  paceAssessment: 'on_tempo' | 'too_fast' | 'too_slow' | 'uncertain';
}
```

**Safety invariants enforced by the parser:**
- `formCue null` → `severity null`
- `formCue present` → `positiveNote null` (corrective wins)
- `assessmentState = 'unable_to_assess'` → `repCompleted = false` (never count blind)

---

## Serena context events

`buildSerenaContextFromVision()` converts each frame into zero or more of these structured strings sent to the ElevenLabs agent via `sendContext()`:

| Event | Trigger | Throttle |
|---|---|---|
| `FORM_REVIEW_START` | Mode entry | Once |
| `FRAMING` | Poor visibility or framing issue | 7s + change-gated |
| `VISION_UNCERTAIN` | `assessmentState = low_confidence` | 10s |
| `COUNTABILITY` | Active `repBlockerReason` | 5s + change-gated |
| `REP` | Confirmed rep (FSM or secondary signal) | None (every rep is unique) |
| `FORM` | Corrective or positive cue | 2.5s + deduplicated |
| `TEMPO` | `too_fast` or `too_slow` persists | 8s + change-gated |
| `STUCK` | Same active phase > 8s | 12s |
| `FORM_REVIEW_END` | Mode exit (manual or auto) | Once |

**Anti-spam protection**: `FORM_REVIEW_ACTIVE` keepalive fires every 9s while Form Review is active, preventing ElevenLabs from firing the "Are you still there?" idle prompt (which would break the coaching experience since the athlete is silent by design).

---

## RepBlockerReason — why a rep didn't count

Displayed in the overlay hint strip and routed to Serena as a `COUNTABILITY` event:

| Reason | Trigger | Serena instruction |
|---|---|---|
| `insufficient_depth` | FSM stuck in `descending` > 3.5s | "Go lower so I can count that one" |
| `no_lockout` | FSM stuck in `ascending` > 3s | "Stand fully tall at the top" |
| `moved_too_fast` | `tempoStatus = too_fast` | "Slow that down — couldn't judge the form" |
| `poor_visibility` | `unable_to_assess` or `visibilityState = poor` | "Adjust the camera" |
| `low_confidence` | `assessmentState = low_confidence` | "Keep going — still getting a read" |
| `incomplete_cycle` | Went back down before completing ascent | "Finish one rep all the way through" |
| `unknown` | Camera-confirmed but reason unclear | "Keep going — still calibrating" |

---

## Tempo classification

The hook measures actual phase durations between Claude responses. When a phase transitions, it records how long the previous phase lasted and compares it to the exercise-specific target:

```
Back Squat / Goblet / Lunge: descent=4s, bottom=1s, ascent=1s, top=0s
RDL / Romanian Deadlift:     descent=3s, bottom=1s, ascent=1s, top=1s
Row / Press / Curl / etc.:   descent=3s, bottom=0s, ascent=1s, top=1s
```

Thresholds:
- descent: < 65% of target → `too_fast`
- bottom: < 50% of target → `too_fast`
- ascent: < 40% of target → `too_fast`
- > 250% of target → `too_slow`

---

## Claude vision system prompt (summary)

The full prompt is in `getClaudeVisionRequestBody.ts` → `CLAUDE_VISION_SYSTEM_PROMPT`. Key instructions:

1. Assess framing/visibility first, before any movement analysis
2. If `unable_to_assess`, return safe defaults and never emit `repCompleted: true`
3. `repCompleted` requires high confidence of a full cycle back to lockout — never guess
4. At most one `formCue` OR one `positiveNote` per frame, never both
5. `paceAssessment` defaults to `"uncertain"` — single still frames can rarely assess pace
6. Return strict JSON only, no prose

---

## UI layout — camera mode

When the camera is active (set mode, form review, or countdown), the screen switches from a ScrollView layout to a flex column:

```
[SafeAreaView]
  [Header — title + LIVE badge]
  [cameraWrap — flex:1, borderRadius:20, overflow:hidden]
    [CameraView — absoluteFill]
    [countdown overlay — if counting down]
    [Normal set chrome — if inVision]
      • rep flash animation (green)
      • "SERENA IS WATCHING" badge
      • rep count overlay (top)
      • VISION pill
      • TempoAssistCard (bottom)
    [Form Review chrome — if isFormReview]
      • rep flash animation (green, zIndex:10)
      • "FORM REVIEW · CLAUDE VISION" badge
      • FormReviewTempoOverlay (absoluteFill, zIndex:20)
  [cameraExerciseStrip — exercise name + set number]
  [btnRow — End Review / End Set / Cancel N / Start Set]
```

When camera is off, the screen uses a standard ScrollView with the Serena avatar/transcript card, exercise card (with "Review my form" button), and logged sets.

---

## FormReviewTempoOverlay — display priority

```
1. Framing banner (⚠ amber) — top:56, when visibility ≠ good
2. Main card (centered glass panel)
   a. Phase icon (↓ ⏸ ↑ ✓) — pulses on change
   b. Phase title (LOWER / HOLD / DRIVE / RESET) + confidence badge
   c. FSM path label (↓ Descending / ⏸ Bottom / ↑ Ascending)
   d. Coaching cue — primary line when present, replaces subtitle
      OR Phase subtitle (Control the descent / etc.) — when no cue
   e. Stuck strip (⚡ Keep moving) — if isStuck
   f. Tempo chip (On tempo / Too fast / Too slow / Assessing…)
   g. Duration badges (↓ 3.2s  ⏸ 0.8s  ↑ 0.9s) — after first measurement
3. Rep-blocker hint strip — bottom:120, why rep isn't counting
4. Footer — bottom:28
   • Rep count (large) / maxReps
   • Progress dots (filled = counted reps)
   • "estimating…" label if low_confidence
```

Opacity rules: `unable_to_assess` → 0.3, `low_confidence` → 0.65, `tracking` → 1.0.

---

## Entry / exit flows

### Enter Form Review
1. User is on SerenaProtoScreen, Serena knows the current exercise (`serena.currentExercise` is set)
2. "Review my form" button visible (gated: exercise known, no active vision, no countdown)
3. Tap → `onStartFormReview()` → `setFormReviewEnabled(true)` → 3-2-1 countdown
4. On countdown end → `startFormReviewLoop()` → sends `FORM_REVIEW_START` context → begins 1s polling

### Exit Form Review (manual)
1. Tap "End Review" → `onEndFormReview()` → `stopFormReviewLoop()` → `setFormReviewEnabled(false)`
2. Hook sends `FORM_REVIEW_END` with final rep count to Serena
3. `persistFormReviewReps()` writes to `workout_exercise_logs` in Supabase

### Exit Form Review (auto-complete)
1. `repCount >= maxGuidedReps (5)` → `stop('auto', finalCount)` inside hook
2. `setAutoCompleted(true)` → `onAutoComplete(finalCount)` → parent sets `formReviewEnabled(false)` + persists

### Prevent "Are you still there?"
ElevenLabs fires an idle prompt after ~8–10s of silence. While `isFormReview`, a `setInterval` fires every 9s:
```
[FORM_REVIEW_ACTIVE] Athlete is mid-review and actively moving.
Do NOT ask if they are still there. Continue monitoring.
```

---

## DB persistence

On Form Review end (manual or auto), if a `workoutId` was passed as a navigation param:

```sql
INSERT INTO workout_exercise_logs (
  workout_id, user_id, exercise_name,
  set_number, reps, completed_at, notes
) VALUES (
  $workoutId, $userId, $exerciseName,
  1, $reps, NOW(), 'form_review'
)
```

Silently skipped if `workoutId` is null (standalone Serena session with no active workout).

---

## Key tuning constants

```typescript
// useFormReviewVisionLoop.ts
DEFAULT_FRAME_INTERVAL_MS   = 1000   // Claude call cadence
DEFAULT_MIN_REP_GAP_MS      = 2000   // minimum ms between counted reps
DEFAULT_CONFIDENCE_THRESHOLD = 0.65  // below this, FSM and tempo math are skipped
DEFAULT_MAX_GUIDED_REPS     = 5      // auto-stop rep count
STUCK_PHASE_MS              = 8000   // how long in one phase before stuck cue
STUCK_SERENA_COOLDOWN_MS    = 12000  // min gap between stuck cues
DEPTH_STALL_MS              = 3500   // descending without bottom → insufficient_depth
LOCKOUT_STALL_MS            = 3000   // ascending without top → no_lockout

// SerenaProtoScreen.tsx (Normal set / Gemini mode)
FRAME_INTERVAL_MS           = 400
MIN_REP_MS                  = 600
HIGH_CONFIDENCE             = 0.82
CUE_THROTTLE_MS             = 6000
CUE_COOLDOWN_MS             = 2000
CRITICAL_COOLDOWN_MS        = 800

// buildSerenaContextFromVision.ts
DEFAULT_FORM_CUE_COOLDOWN_MS        = 2500
DEFAULT_POSITIVE_CUE_COOLDOWN_MS    = 4000
DEFAULT_TEMPO_CUE_COOLDOWN_MS       = 8000
DEFAULT_FRAMING_CUE_COOLDOWN_MS     = 7000
DEFAULT_UNCERTAIN_CUE_COOLDOWN_MS   = 10000
DEFAULT_COUNTABILITY_CUE_COOLDOWN_MS= 5000
```

---

## Known limitations / future work

1. **Camera angle sensitivity** — Claude Vision accuracy drops significantly when the phone isn't positioned to show the full body from a side or front angle. Poor framing generates `unable_to_assess` frames that freeze the FSM. The framing banner helps guide the athlete but the phone still needs to be well-placed.

2. **1s cadence misses fast transitions** — For exercises with a bottom hold < 1s, the `bottom` phase frame is frequently missed. The FSM handles this via the bottom-miss shortcut (descending → ascending), but `lastBottomMs` will often read 0.

3. **Phase rail not in Form Review overlay** — The Normal set `TempoAssistCard` has a 4-segment animated rail (Lower / Hold / Drive / Top). The Form Review overlay uses a phase icon + title instead. A rail was considered but deferred to avoid crowding the already-dense overlay.

4. **Gemini Tempo Assist (Normal mode) not connected to `slightly_fast`** — The `PaceStatus` type in Normal mode has `slightly_fast` but `TempoAssistCard` shows it in amber without a Serena cue. The Form Review path uses `too_fast` only.

5. **`workout_exercise_logs.set_number` hardcoded to 1** — Form Review always logs as set 1 regardless of how many sets the athlete has done. Would need session context to fix.

6. **No offline support** — Both vision modes require network. Frames are dropped silently on failure and the loop retries on the next tick.

---

## Running / testing locally

```bash
# Start the Expo dev server
cd apex
npx expo start --clear

# Deploy the Supabase edge functions (requires Supabase CLI)
supabase functions deploy anthropic
supabase functions deploy gemini-vision

# Set secrets in Supabase
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set GEMINI_API_KEY=...

# Run unit tests
npx jest src/__tests__/formReview.test.ts
```

### Manual test checklist
1. Open the app → navigate to a workout → tap "Serena · Live"
2. Tell Serena the exercise ("I'm doing back squats") → wait for `currentExercise` to be set
3. Tap "Review my form" in the exercise card → countdown fires → Form Review activates
4. Stand in front of the camera (full body visible, side or front angle)
5. Perform a slow squat (4s down, 1s hold, 1s up) → verify:
   - Overlay phase label tracks movement (LOWER → HOLD → DRIVE → RESET)
   - Rep counter increments + green flash fires on confirmed rep
   - Serena calls out "1!" or "That's 1!" — NOT "set 1"
6. Do a shallow half-squat → blocker strip shows "↓ Go lower to count the rep"
7. Move too close to camera → framing banner appears at top
8. Tap "End Review" → Serena gives a summary
