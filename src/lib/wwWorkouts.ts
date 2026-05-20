/**
 * wwWorkouts.ts
 *
 * Walk & Water Challenge Edition — workout library.
 * 3 categories × 3 progressive levels = 9 workout cards.
 *
 * All videos are YouTube Shorts / clips verified at 5–30 seconds,
 * embeddable, sourced from channels that allow embedding.
 */

export type WWExercise = {
  exerciseDbName: string;    // used as fallback for YouTube search
  displayName:    string;    // shown in the UI
  sets:           string;    // e.g. "3 × 12 reps" or "60 sec"
  note?:          string;
  youtubeId?:     string;    // hardcoded video ID, skips API entirely
};

export type WWWorkout = {
  id:          string;
  category:    'walk-core' | 'strength' | 'stretching';
  week:        1 | 2 | 3;
  emoji:       string;
  title:       string;
  duration:    string;
  difficulty:  string;
  tagline:     string;
  exercises:   WWExercise[];
  coachTip:    string;
};

// ─── Walk & Core ──────────────────────────────────────────────────────────────

const WALK_CORE: WWWorkout[] = [
  {
    id:         'walk-core-1',
    category:   'walk-core',
    week:       1,
    emoji:      '🚶',
    title:      'Walk & Core — Week 1',
    duration:   '20 min',
    difficulty: 'Beginner',
    tagline:    'Build core awareness from the ground up. Form first, always.',
    exercises: [
      { exerciseDbName: 'bicycle crunch', displayName: 'Bicycle Crunch', sets: '3 × 15 reps',                                youtubeId: 'F-USZMJJZVU' }, // 24s
      { exerciseDbName: 'plank',          displayName: 'Plank Hold',     sets: '3 × 20 sec',  note: 'Keep hips level — no sagging', youtubeId: 'mwlp75MS6Rg' }, // 15s ✅ keep
      { exerciseDbName: 'dead bug',       displayName: 'Dead Bug',       sets: '3 × 8 reps',  note: 'Slow, exhale on every rep',    youtubeId: 'bxn9FBrt4-A' }, // 30s ✅ keep
      { exerciseDbName: 'glute bridge',   displayName: 'Glute Bridge',   sets: '3 × 12 reps', note: 'Pause 1 sec at the top',       youtubeId: 'tqp5XQPpTxY' }, // 21s ✅ keep
    ],
    coachTip: 'Breathe out on every effort. That one habit makes core work 3× more effective.',
  },
  {
    id:         'walk-core-2',
    category:   'walk-core',
    week:       2,
    emoji:      '🚶',
    title:      'Walk & Core — Week 2',
    duration:   '22 min',
    difficulty: 'Intermediate',
    tagline:    'More time under tension. Your core is ready for it.',
    exercises: [
      { exerciseDbName: 'russian twist',    displayName: 'Russian Twist',     sets: '3 × 20 reps', note: 'Feet off floor for more challenge', youtubeId: 'aRUMRbl7KS4' }, // 18s
      { exerciseDbName: 'mountain climber', displayName: 'Mountain Climbers', sets: '3 × 30 sec',  note: 'Drive knees in — keep hips down',  youtubeId: '7W4JEfEKuC4' }, // 8s
      { exerciseDbName: 'plank',            displayName: 'Plank Hold',        sets: '3 × 40 sec',                                            youtubeId: 'mwlp75MS6Rg' }, // 15s ✅ keep
      { exerciseDbName: 'leg raise',        displayName: 'Leg Raise',         sets: '3 × 12 reps', note: 'Press lower back into the floor',  youtubeId: '6tkgHJZYh1A' }, // 9s
    ],
    coachTip: 'If your lower back aches, shorten the range. Full range with control beats cheating.',
  },
  {
    id:         'walk-core-3',
    category:   'walk-core',
    week:       3,
    emoji:      '🚶',
    title:      'Walk & Core — Week 3',
    duration:   '25 min',
    difficulty: 'Advanced',
    tagline:    'Full core challenge. You built to this.',
    exercises: [
      { exerciseDbName: 'v-up',               displayName: 'V-Ups',              sets: '3 × 15 reps',                                      youtubeId: 'saHkR_MvIdA' }, // 7s
      { exerciseDbName: 'mountain climber',   displayName: 'Mountain Climbers',  sets: '3 × 45 sec',  note: 'Explosive — drive the knees', youtubeId: '7W4JEfEKuC4' }, // 8s
      { exerciseDbName: 'side plank',         displayName: 'Side Plank',         sets: '3 × 30 sec each side',                             youtubeId: 'BtM0a9x1F5o' }, // 11s
      { exerciseDbName: 'hanging knee raise', displayName: 'Hanging Knee Raise', sets: '3 × 12 reps', note: 'Control the swing',          youtubeId: 'V-5_KVKyPmk' }, // 23s
    ],
    coachTip: 'Rest 90 sec between sets here. Going hard on rest will break your form — protect it.',
  },
];

// ─── Full Body Strength ───────────────────────────────────────────────────────

const STRENGTH: WWWorkout[] = [
  {
    id:         'strength-1',
    category:   'strength',
    week:       1,
    emoji:      '💪',
    title:      'Full Body Strength — Week 1',
    duration:   '25 min',
    difficulty: 'Beginner',
    tagline:    'No equipment needed. Master the patterns before adding weight.',
    exercises: [
      { exerciseDbName: 'squat',          displayName: 'Bodyweight Squat', sets: '3 × 12 reps', note: 'Chest up, knees track toes',    youtubeId: 'SLOkdLLWj8A' }, // 19s
      { exerciseDbName: 'push-up',        displayName: 'Push-Up',          sets: '3 × 8 reps',  note: 'Drop to knees if needed',       youtubeId: 'WDIpL0pjun0' }, // 14s ✅ keep
      { exerciseDbName: 'reverse lunge',  displayName: 'Reverse Lunge',    sets: '3 × 10 each leg',                                   youtubeId: 'cPCLYMxjqwA' }, // 9s
      { exerciseDbName: 'glute bridge',   displayName: 'Glute Bridge',     sets: '3 × 15 reps', note: 'Squeeze at the top',           youtubeId: 'tqp5XQPpTxY' }, // 21s ✅ keep
      { exerciseDbName: 'bent over row',  displayName: 'Bent-Over Row',    sets: '3 × 10 reps', note: 'Use water bottles or a band',  youtubeId: 'dpYI8K6e-jE' }, // 9s
    ],
    coachTip: 'Slow the lowering phase to 3 seconds on every exercise. That\'s where the strength is built.',
  },
  {
    id:         'strength-2',
    category:   'strength',
    week:       2,
    emoji:      '💪',
    title:      'Full Body Strength — Week 2',
    duration:   '30 min',
    difficulty: 'Intermediate',
    tagline:    'Add load. Same patterns, more demand.',
    exercises: [
      { exerciseDbName: 'dumbbell goblet squat',   displayName: 'Goblet Squat',       sets: '4 × 10 reps', note: 'Hold a dumbbell or water jug at chest', youtubeId: 'lRYBbchqxtI' }, // 22s
      { exerciseDbName: 'push-up',                 displayName: 'Push-Up',            sets: '4 × 12 reps', note: 'Full range, chest to floor',            youtubeId: 'WDIpL0pjun0' }, // 14s ✅ keep
      { exerciseDbName: 'romanian deadlift',       displayName: 'Romanian Deadlift',  sets: '3 × 10 reps', note: 'Hinge at hips, soft knee',              youtubeId: '_TchJLlBO-4' }, // 9s
      { exerciseDbName: 'dumbbell shoulder press', displayName: 'Shoulder Press',     sets: '3 × 10 reps',                                                youtubeId: 'k6tzKisR3NY' }, // 9s
      { exerciseDbName: 'dumbbell row',            displayName: 'Single-Arm Row',     sets: '3 × 10 each arm',                                            youtubeId: 'KaCcBqhiXtc' }, // 14s
    ],
    coachTip: 'If you can\'t feel the muscle working, slow down. Speed hides technique flaws.',
  },
  {
    id:         'strength-3',
    category:   'strength',
    week:       3,
    emoji:      '💪',
    title:      'Full Body Strength — Week 3',
    duration:   '35 min',
    difficulty: 'Advanced',
    tagline:    'Full load, full range. This is where you change.',
    exercises: [
      { exerciseDbName: 'barbell squat',          displayName: 'Barbell Back Squat', sets: '4 × 8 reps',   note: 'Brace the core before every rep',      youtubeId: 'dW3zj79xfrc' }, // 11s
      { exerciseDbName: 'bench press',            displayName: 'Bench Press',        sets: '4 × 8 reps',                                                 youtubeId: '_FkbD0FhgVE' }, // 17s
      { exerciseDbName: 'deadlift',               displayName: 'Deadlift',           sets: '3 × 6 reps',   note: 'Neutral spine — hinge, don\'t squat', youtubeId: 'rDk1oz5bbMA' }, // 8s
      { exerciseDbName: 'pull-up',                displayName: 'Pull-Up',            sets: '3 × max reps', note: 'Dead hang start, chin over bar',       youtubeId: '1Sw5mevOsb0' }, // 25s
      { exerciseDbName: 'dumbbell lateral raise', displayName: 'Lateral Raise',      sets: '3 × 12 reps',  note: 'Lead with elbows, not wrists',         youtubeId: 'Kl3LEzQ5Zqs' }, // 8s
    ],
    coachTip: 'Rest 2 full minutes between sets at this load. Rushing rest means weaker sets — every time.',
  },
];

// ─── Stretching ───────────────────────────────────────────────────────────────

const STRETCHING: WWWorkout[] = [
  {
    id:         'stretch-1',
    category:   'stretching',
    week:       1,
    emoji:      '🧘',
    title:      'Stretch & Recover — Week 1',
    duration:   '15 min',
    difficulty: 'Recovery',
    tagline:    'Keep the joints healthy. Do this after every walk day.',
    exercises: [
      { exerciseDbName: 'hip flexor stretch', displayName: 'Hip Flexor Stretch', sets: '60 sec each side', note: 'Lunge position, push hips forward', youtubeId: 'ktgtEWGhFd8' }, // 20s
      { exerciseDbName: 'hamstring stretch',  displayName: 'Hamstring Stretch',  sets: '60 sec each side',                                             youtubeId: 'j4B6Kmi7g5k' }, // 16s
      { exerciseDbName: 'cat cow stretch',    displayName: 'Cat-Cow',            sets: '10 slow reps',     note: 'Breathe with the movement',         youtubeId: '2of247Kt0tU' }, // 9s
      { exerciseDbName: 'childs pose',        displayName: 'Child\'s Pose',      sets: '60 sec',                                                       youtubeId: 'YAmAET3Uomk' }, // 7s
      { exerciseDbName: 'pigeon pose',        displayName: 'Pigeon Pose',        sets: '60 sec each side', note: 'Sink slowly — don\'t force it',     youtubeId: 'KUclDkITsS8' }, // 13s
    ],
    coachTip: 'Never stretch to pain — stretch to tension. Ease off if you feel sharp discomfort.',
  },
  {
    id:         'stretch-2',
    category:   'stretching',
    week:       2,
    emoji:      '🧘',
    title:      'Stretch & Recover — Week 2',
    duration:   '18 min',
    difficulty: 'Mobility',
    tagline:    'Deeper holds, more range. Your body is ready to open up.',
    exercises: [
      { exerciseDbName: 'thoracic rotation',  displayName: 'Thoracic Rotation',     sets: '10 reps each side', note: 'Seated or in thread-the-needle',  youtubeId: 'C8wzQhlXPx8' }, // 25s ✅ keep
      { exerciseDbName: 'deep squat stretch', displayName: 'Deep Squat Hold',       sets: '3 × 45 sec',        note: 'Hold onto something if needed',   youtubeId: '6R6X6-qVjRE' }, // 16s
      { exerciseDbName: 'figure four stretch',displayName: 'Figure-4 Stretch',      sets: '60 sec each side',                                            youtubeId: 'ckHZyA99Das' }, // 28s
      { exerciseDbName: 'chest stretch',      displayName: 'Doorway Chest Stretch', sets: '60 sec',            note: 'Arms at 90°, lean gently forward', youtubeId: 'R_XFo9T7waQ' }, // 20s
      { exerciseDbName: 'seated forward fold',displayName: 'Seated Forward Fold',   sets: '90 sec',                                                      youtubeId: '5njnlgYYdD4' }, // 5s
    ],
    coachTip: 'Exhale to go deeper. Every exhale releases tension — use your breath as a tool.',
  },
  {
    id:         'stretch-3',
    category:   'stretching',
    week:       3,
    emoji:      '🧘',
    title:      'Stretch & Recover — Week 3',
    duration:   '20 min',
    difficulty: 'Flexibility',
    tagline:    'Advanced holds for serious range. Earned this.',
    exercises: [
      { exerciseDbName: 'couch stretch',       displayName: 'Couch Stretch',         sets: '90 sec each side', note: 'Back foot on wall or couch',  youtubeId: 'TIJu5aWPke0' }, // 11s
      { exerciseDbName: 'bridge pose',         displayName: 'Bridge Pose',           sets: '3 × 30 sec',       note: 'Press through your feet',     youtubeId: 'H2oJdqGikTY' }, // 10s
      { exerciseDbName: 'pancake stretch',     displayName: 'Wide-Leg Forward Fold', sets: '90 sec',           note: 'Walk hands forward slowly',   youtubeId: 'HgPDRQVr9MQ' }, // 15s
      { exerciseDbName: 'pigeon pose',         displayName: 'Pigeon Pose',           sets: '90 sec each side', note: 'Full torso down if you can',  youtubeId: 'KUclDkITsS8' }, // 13s
      { exerciseDbName: 'seated forward fold', displayName: 'Seated Forward Fold',   sets: '2 min',                                                 youtubeId: '5njnlgYYdD4' }, // 5s
    ],
    coachTip: 'Hold for time, not for performance. The real flexibility gains happen in the last 30 seconds of a hold.',
  },
];

// ─── Exports ──────────────────────────────────────────────────────────────────

export const WW_WORKOUTS = [...WALK_CORE, ...STRENGTH, ...STRETCHING];

export const WW_WORKOUT_CATEGORIES = [
  { key: 'walk-core'  as const, label: 'Walk & Core',          emoji: '🚶' },
  { key: 'strength'   as const, label: 'Full Body Strength',   emoji: '💪' },
  { key: 'stretching' as const, label: 'Stretch & Recover',    emoji: '🧘' },
];

export function getWorkoutsByCategory(category: WWWorkout['category']): WWWorkout[] {
  return WW_WORKOUTS.filter(w => w.category === category);
}
