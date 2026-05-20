# APEX Coach Roadmap

## Already Landed
- Real workout-day context in the Train voice coach
- Warm-up and cardio visibility inside the live workout coach flow
- Voice-driven workout logging for warm-up, cardio, reps, sets, and next-exercise progression
- Shorter spoken coach replies
- Coach voice selection in Profile
- Coach-aware meal plan generation and meal plan update requests from the Coach tab

## Phase 1: Make It Feel Like A Real Coach
- Expand workout voice commands:
  - `log 8 reps`
  - `log 2 sets of 10`
  - `135 pounds`
  - `next exercise`
  - `mark warm-up done`
  - `log cardio complete`
  - `repeat that`
  - `how long should I rest`
- Keep replies to one short sentence by default
- Improve pause detection in noisy gym settings
- Add clearer session states:
  - listening
  - thinking
  - coach speaking
- Add “repeat cue” and “shorter answer” commands

## Phase 2: Make It Operational
- Track set-by-set workout state:
  - current exercise
  - current set number
  - sets remaining
  - weight used last set
  - rest timer state
- Let the coach perform app actions directly:
  - mark set logged
  - mark exercise complete
  - skip an exercise
  - swap an exercise
  - shorten a session
  - change cardio choice
- Let the coach update nutrition live:
  - swap breakfast/lunch/dinner
  - increase protein
  - reduce calories
  - remove foods
  - lower cost
  - rebuild grocery list after meal-plan edits

## Phase 3: Make It Personal
- Persistent coach memory:
  - injuries
  - equipment limitations
  - preferred exercises
  - disliked foods
  - pacing preferences
  - preferred coaching style
- Voice personality settings:
  - calm
  - intense
  - technical
  - encouraging
- Separate male/female/default coach voices for Pro users
- Better context injection before every coach response:
  - recent workouts
  - meal adherence
  - streak status
  - sleep data
  - wearable data

## Phase 4: Make It Premium
- Live adaptive programming:
  - coach changes tomorrow’s workout based on today’s performance
  - coach changes cardio based on logged fatigue
  - coach changes meal plans based on compliance
- Recovery-aware coaching:
  - sleep analytics
  - HRV / recovery score when available
  - readiness-based volume changes
- Full “coach in your ear” mode:
  - auto-check-ins between sets
  - auto cue for the next lift
  - automatic rest countdown guidance
  - celebration and correction moments during the session

## Voice Catalog Direction
- Default male coach:
  - custom ElevenLabs cloned voice
- Default female coach:
  - curated premium female coach voice
- Keep voice choice in Profile under `AI Coach Voice`
- Pro users should be able to change voices at any time

## Open Product Decisions
- Whether free users get a limited coach voice preview
- Whether meal-plan editing is Pro-only or included inside AI Coach access
- Whether coach can auto-commit exercise swaps or should confirm first
- Whether coach replies should always stay under 12 seconds of speech
