import type { UserProfile } from '@/screens/GoalSetupScreen';

export type WorkoutProgramExercise = {
  name: string;
  num: number;
  sets: string;
  youtubeId: string;
};

export type WorkoutProgramDay = {
  badge: 'lift' | 'cardio' | 'rest';
  day: string;
  exercises: WorkoutProgramExercise[];
  meta: string;
  name: string;
};

export type ProgramDefinition = {
  coachTeam: Array<{
    compliance: number;
    complianceColor: string;
    icon: string;
    name: string;
    spec: string;
  }>;
  daysPerWeek: number;
  description: string;
  durationWeeks: number;
  icon: string;
  id: 'power-build' | 'hiit-burn' | 'body-recomp-pro' | 'elite-performance';
  level: 'All levels' | 'Intermediate' | 'Advanced';
  reason: string;
  schedule: WorkoutProgramDay[];
  subtitle: string;
  title: string;
};

const PLANNABLE_EXERCISE_LIBRARY = [
  // Strength — Main Lifts
  'Barbell Bench Press',
  'Incline Barbell Bench Press',
  'Decline Bench Press',
  'DB Bench Press',
  'Incline DB Press',
  'Decline DB Press',
  'Overhead Press',
  'DB Shoulder Press',
  'Neutral Grip DB Shoulder Press',
  'Push Press',
  'Overhand Barbell Bent Over Row',
  'Underhand Barbell Bent Over Row',
  'Chest Supported Row',
  'Seated Overhand Cable Row',
  'Seated Underhand Cable Row',
  'Seated Neutral Grip Row',
  'Overhand Lat Pulldown',
  'Underhand Lat Pulldown',
  'Neutral Grip Lat Pulldown',
  'Pull Up',
  'Neutral Grip Pull Up',
  'Chin Up',
  'Weighted Pull Up',
  'Conventional Deadlift',
  'Sumo Deadlift',
  'Romanian Deadlift',
  'Hip Thrust',
  'Glute Bridge',
  'Narrow Stance Leg Press',
  'Sumo Stance Leg Press',
  'Hamstring Curl Machine',
  'Dumbbell Lying Hamstring Curl',
  'Leg Extension Machine',
  'Back Squat',
  'Front Squat',
  'Goblet Squat',
  'Bulgarian Split Squat',
  'Walking Lunges',
  'Reverse Lunge',
  'Box Jump',
  'Jump Squats',
  'Hang Power Clean',
  'Power Clean',
  'Sled Push',
  'Sled Rope Pull',
  'Farmer Carry',
  // Hypertrophy — Accessory
  'Cable Fly',
  'DB Fly',
  'DB Pullover',
  'Lateral Raise',
  'Face Pull',
  'DB Curl',
  'Barbell Curl',
  'Incline DB Curl',
  'Hammer Curl',
  'Cable Curl',
  'Band Curl',
  'Tricep Pushdown',
  'Band Tricep Pressdown',
  'Calf Raise',
  'Leg Raise',
  'Crunch',
  'Sit Up',
  'Russian Twist',
  'Dead Bug',
  'Plank Push Up',
  'Plank On Forearms',
  'Shoulder Taps',
  'Push Up',
  'Dips',
  'Band Pull Apart',
  'Kettlebell Swing',
  'DB Thruster',
  // Conditioning
  'Air Bike',
  'Assault Bike Intervals',
  'Battle Ropes',
  'Row Intervals',
  'Sprint Intervals',
  'Hill Sprints',
  'Jump Rope',
  'Med Ball Slams',
  'Burpees',
  'Mountain Climbers',
  // Recovery (not demo-video exercises — kept for plan-building compatibility)
  'Breathwork',
  'Cool Down',
  'Foam Rolling',
  'Full Body Stretch',
  'Hip Flexor Stretch',
  'Light Walk',
  'Meditation',
  'Mobility Flow',
  'Recovery Walk',
  'Stretch',
  'Thoracic Rotation',
  'Walk',
  'Walk Cooldown',
].sort((a, b) => a.localeCompare(b));

const POWER_BUILD_SCHEDULE: WorkoutProgramDay[] = [
  {
    day: 'MON',
    name: 'Upper Body Push',
    meta: '5 exercises · ~54 min · Chest · Shoulders · Triceps',
    badge: 'lift',
    exercises: [
      { num: 1, name: 'Bench Press', sets: '4 x 6 @ 80% · Rest 3 min', youtubeId: '_FkbD0FhgVE' },
      { num: 2, name: 'Overhead Press', sets: '3 x 8 · Rest 2 min', youtubeId: 'zoN5EH50Dro' },
      { num: 3, name: 'Incline DB Press', sets: '3 x 10 · Rest 90s', youtubeId: '8fXfwG4ftaQ' },
      { num: 4, name: 'Lateral Raises', sets: '4 x 15 · Controlled tempo', youtubeId: 'Kl3LEzQ5Zqs' },
      { num: 5, name: 'Tricep Pushdowns', sets: '3 x 12 · Cable or bands', youtubeId: '4s8Fdhnk6aI' },
    ],
  },
  {
    day: 'TUE',
    name: 'Upper Body Pull',
    meta: '6 exercises · ~61 min · Back · Biceps',
    badge: 'lift',
    exercises: [
      { num: 1, name: 'Pull-Up', sets: '4 x max · Weighted if possible', youtubeId: '1Sw5mevOsb0' },
      { num: 2, name: 'Barbell Row', sets: '4 x 6 · Rest 3 min', youtubeId: 'dpYI8K6e-jE' },
      { num: 3, name: 'Seated Cable Row', sets: '3 x 10 · Rest 2 min', youtubeId: 'KaCcBqhiXtc' },
      { num: 4, name: 'Face Pulls', sets: '4 x 15 · Light weight', youtubeId: 'qEyoBOpvqR4' },
      { num: 5, name: 'DB Curls', sets: '3 x 12 each arm', youtubeId: 'iui51E31sX8' },
      { num: 6, name: 'Hammer Curls', sets: '3 x 10 each arm', youtubeId: 'K9LiwcGuqA0' },
    ],
  },
  {
    day: 'WED',
    name: 'Active Recovery',
    meta: '20 min walk · mobility · optional foam roll',
    badge: 'rest',
    exercises: [
      { num: 1, name: 'Light Walk', sets: '20–30 min · Zone 2 pace', youtubeId: '' },
      { num: 2, name: 'Hip Flexor Stretch', sets: '3 x 60s each side', youtubeId: 'ktgtEWGhFd8' },
      { num: 3, name: 'Foam Rolling', sets: '10 min · focus on sore areas', youtubeId: 'aBDkiULJAMQ' },
    ],
  },
  {
    day: 'THU',
    name: 'Lower Body Strength',
    meta: '6 exercises · ~58 min · Quads · Glutes · Hamstrings',
    badge: 'lift',
    exercises: [
      { num: 1, name: 'Back Squat', sets: '4 x 6 @ 80%', youtubeId: 'dW3zj79xfrc' },
      { num: 2, name: 'Romanian Deadlift', sets: '3 x 8 @ 185 lbs', youtubeId: '_TchJLlBO-4' },
      { num: 3, name: 'Walking Lunges', sets: '3 x 12 each', youtubeId: 'L8fvypPrzzs' },
      { num: 4, name: 'Leg Press', sets: '4 x 10 @ 360 lbs', youtubeId: 'C4bIC78wu6s' },
      { num: 5, name: 'Leg Curl', sets: '3 x 12 @ 120 lbs', youtubeId: 'd6sg829PgNs' },
      { num: 6, name: 'Standing Calf Raises', sets: '4 x 15', youtubeId: 'B30JglFGx8Y' },
    ],
  },
  {
    day: 'FRI',
    name: 'Full Body Power',
    meta: '5 exercises · Deadlift · Clean · Push Press',
    badge: 'lift',
    exercises: [
      { num: 1, name: 'Deadlift', sets: '4 x 4 @ 85%', youtubeId: 'op9kVnSso6Q' },
      { num: 2, name: 'Hang Power Clean', sets: '4 x 4', youtubeId: '5FvJsmmMipo' },
      { num: 3, name: 'Push Press', sets: '3 x 5', youtubeId: 'BKy8FcKhE-E' },
      { num: 4, name: 'Box Jump', sets: '4 x 5', youtubeId: 'NBY9-kTuHEk' },
      { num: 5, name: 'Farmer Carry', sets: '4 x 30m', youtubeId: '1uOs1hP3u4A' },
    ],
  },
  {
    day: 'SAT',
    name: 'Cardio + Core',
    meta: '4 exercises · 18 min · Core · Conditioning',
    badge: 'cardio',
    exercises: [
      { num: 1, name: 'Sit Ups', sets: '3 x 20', youtubeId: 'q5EOcLVXwZ8' },
      { num: 2, name: 'Crunches', sets: '3 x 20', youtubeId: 'eeJ_CYqSoT4' },
      { num: 3, name: 'Plank Hold', sets: '3 x 45s', youtubeId: 'mwlp75MS6Rg' },
      { num: 4, name: 'Mountain Climbers', sets: '3 x 30s', youtubeId: '7W4JEfEKuC4' },
    ],
  },
  {
    day: 'SUN',
    name: 'Rest Day',
    meta: 'Foam roll · eat well · recover',
    badge: 'rest',
    exercises: [
      { num: 1, name: 'Full Body Stretch', sets: '15–20 min', youtubeId: 'L_xrDAtykMI' },
      { num: 2, name: 'Meditation', sets: '10–15 min', youtubeId: '' },
    ],
  },
];

const HIIT_BURN_SCHEDULE: WorkoutProgramDay[] = [
  { day: 'MON', name: 'HIIT Sprint Intervals', meta: '4 exercises · 24 min · Fat loss', badge: 'cardio', exercises: [
    { num: 1, name: 'Sprint Intervals', sets: '8 x 20s on / 40s off', youtubeId: 'isKfhbZkK_Y' },
    { num: 2, name: 'Jump Squats', sets: '3 x 15', youtubeId: 'LNeXr1IMsJ0' },
    { num: 3, name: 'Burpees', sets: '3 x 12', youtubeId: 'dZgVxmf6jkA' },
    { num: 4, name: 'Bike Cooldown', sets: '6 min easy spin', youtubeId: '' },
  ]},
  { day: 'TUE', name: 'Upper Body Burner', meta: '4 exercises · 20 min · Push + pull', badge: 'lift', exercises: [
    { num: 1, name: 'Push Ups', sets: '4 x 15', youtubeId: 'WDIpL0pjun0' },
    { num: 2, name: 'Bent Over Row', sets: '4 x 12', youtubeId: 'dpYI8K6e-jE' },
    { num: 3, name: 'Shoulder Taps', sets: '3 x 20', youtubeId: '_d9150y7IGs' },
    { num: 4, name: 'Battle Ropes', sets: '6 x 20s', youtubeId: 'NEe8PBbUgOQ' },
  ]},
  { day: 'WED', name: 'Mobility Reset', meta: '3 exercises · 15 min · Recovery', badge: 'rest', exercises: [
    { num: 1, name: 'Walk', sets: '15 min easy pace', youtubeId: '' },
    { num: 2, name: 'Hip Openers', sets: '3 x 45s', youtubeId: 'ktgtEWGhFd8' },
    { num: 3, name: 'Thoracic Rotation', sets: '3 x 10 each', youtubeId: 'C8wzQhlXPx8' },
  ]},
  { day: 'THU', name: 'Lower Body Burner', meta: '4 exercises · 22 min · Legs + glutes', badge: 'lift', exercises: [
    { num: 1, name: 'Goblet Squat', sets: '4 x 12', youtubeId: 'lRYBbchqxtI' },
    { num: 2, name: 'Reverse Lunge', sets: '3 x 10 each', youtubeId: 'xrPteyQLGAo' },
    { num: 3, name: 'Kettlebell Swing', sets: '4 x 15', youtubeId: 'n1df4ASFeZU' },
    { num: 4, name: 'Jump Rope', sets: '5 x 45s', youtubeId: 'XrUbw2MoAqE' },
  ]},
  { day: 'FRI', name: 'Full Body Sweat', meta: '4 exercises · 25 min · Circuit', badge: 'cardio', exercises: [
    { num: 1, name: 'Row Intervals', sets: '6 x 30s', youtubeId: '8SAj7l9xys4' },
    { num: 2, name: 'DB Thrusters', sets: '4 x 12', youtubeId: 'buaJ_Za7IWA' },
    { num: 3, name: 'Push Up Plank', sets: '3 x 12', youtubeId: 'WDIpL0pjun0' },
    { num: 4, name: 'Walking Recovery', sets: '8 min', youtubeId: '' },
  ]},
  { day: 'SAT', name: 'Core Finisher', meta: '4 exercises · 16 min · Core', badge: 'cardio', exercises: [
    { num: 1, name: 'Crunches', sets: '3 x 25', youtubeId: 'eeJ_CYqSoT4' },
    { num: 2, name: 'Plank Hold', sets: '3 x 60s', youtubeId: 'mwlp75MS6Rg' },
    { num: 3, name: 'Russian Twists', sets: '3 x 20', youtubeId: 'aRUMRbl7KS4' },
    { num: 4, name: 'Leg Raises', sets: '3 x 15', youtubeId: '6tkgHJZYh1A' },
  ]},
  { day: 'SUN', name: 'Rest Day', meta: 'Walk · recover · reset', badge: 'rest', exercises: [
    { num: 1, name: 'Walk', sets: '20 min easy', youtubeId: '' },
    { num: 2, name: 'Stretch', sets: '10 min', youtubeId: 'L_xrDAtykMI' },
  ]},
];

const BODY_RECOMP_SCHEDULE: WorkoutProgramDay[] = [
  { day: 'MON', name: 'Upper Strength', meta: '5 exercises · 45 min · Recomp', badge: 'lift', exercises: [
    { num: 1, name: 'Bench Press', sets: '4 x 8', youtubeId: '_FkbD0FhgVE' },
    { num: 2, name: 'Pull Ups', sets: '4 x 8', youtubeId: '1Sw5mevOsb0' },
    { num: 3, name: 'DB Shoulder Press', sets: '3 x 10', youtubeId: 'k6tzKisR3NY' },
    { num: 4, name: 'Cable Row', sets: '3 x 12', youtubeId: 'KaCcBqhiXtc' },
    { num: 5, name: 'Finisher Walk', sets: '10 min incline', youtubeId: '' },
  ]},
  { day: 'TUE', name: 'Lower Strength', meta: '5 exercises · 48 min · Quads · glutes', badge: 'lift', exercises: [
    { num: 1, name: 'Back Squat', sets: '4 x 8', youtubeId: 'dW3zj79xfrc' },
    { num: 2, name: 'RDL', sets: '4 x 10', youtubeId: '_TchJLlBO-4' },
    { num: 3, name: 'Split Squat', sets: '3 x 10 each', youtubeId: 'dYw66M3gxSw' },
    { num: 4, name: 'Leg Curl', sets: '3 x 12', youtubeId: 'd6sg829PgNs' },
    { num: 5, name: 'Bike Flush', sets: '8 min', youtubeId: '' },
  ]},
  { day: 'WED', name: 'Recovery Walk', meta: '3 exercises · 20 min · Recovery', badge: 'rest', exercises: [
    { num: 1, name: 'Walk', sets: '20 min brisk', youtubeId: '' },
    { num: 2, name: 'Stretch', sets: '8 min', youtubeId: 'L_xrDAtykMI' },
    { num: 3, name: 'Breathwork', sets: '5 min', youtubeId: 'tybOi4hjZFQ' },
  ]},
  { day: 'THU', name: 'Upper Hypertrophy', meta: '5 exercises · 42 min · Volume', badge: 'lift', exercises: [
    { num: 1, name: 'Incline Press', sets: '4 x 10', youtubeId: '8fXfwG4ftaQ' },
    { num: 2, name: 'Lat Pulldown', sets: '4 x 12', youtubeId: 'bNmvKpJSWKM' },
    { num: 3, name: 'Lateral Raise', sets: '3 x 15', youtubeId: 'Kl3LEzQ5Zqs' },
    { num: 4, name: 'Cable Curl', sets: '3 x 12', youtubeId: 'qEdBw-eowVg' },
    { num: 5, name: 'Tricep Pressdown', sets: '3 x 12', youtubeId: '4s8Fdhnk6aI' },
  ]},
  { day: 'FRI', name: 'Lower + Core', meta: '5 exercises · 40 min · Recomp', badge: 'lift', exercises: [
    { num: 1, name: 'Leg Press', sets: '4 x 12', youtubeId: 'C4bIC78wu6s' },
    { num: 2, name: 'Walking Lunges', sets: '3 x 12 each', youtubeId: 'L8fvypPrzzs' },
    { num: 3, name: 'Hip Thrust', sets: '3 x 10', youtubeId: 'W86oVlnLqY4' },
    { num: 4, name: 'Plank Hold', sets: '3 x 45s', youtubeId: 'mwlp75MS6Rg' },
    { num: 5, name: 'Dead Bug', sets: '3 x 12 each', youtubeId: 'bxn9FBrt4-A' },
  ]},
  { day: 'SAT', name: 'Rest Day', meta: 'Light walk · recover', badge: 'rest', exercises: [
    { num: 1, name: 'Walk', sets: '20 min easy', youtubeId: '' },
    { num: 2, name: 'Stretch', sets: '10 min', youtubeId: 'L_xrDAtykMI' },
  ]},
  { day: 'SUN', name: 'Rest Day', meta: 'Full recovery', badge: 'rest', exercises: [
    { num: 1, name: 'Foam Roll', sets: '10 min', youtubeId: 'aBDkiULJAMQ' },
    { num: 2, name: 'Mobility Flow', sets: '10 min', youtubeId: 'L_xrDAtykMI' },
  ]},
];

const ELITE_PERFORMANCE_SCHEDULE: WorkoutProgramDay[] = [
  { day: 'MON', name: 'Speed + Power', meta: '6 exercises · 60 min · Explosive', badge: 'lift', exercises: [
    { num: 1, name: 'Power Clean', sets: '5 x 3', youtubeId: '5FvJsmmMipo' },
    { num: 2, name: 'Front Squat', sets: '4 x 5', youtubeId: '8y_6tN6wvZM' },
    { num: 3, name: 'Broad Jump', sets: '5 x 3', youtubeId: 'J6Nyq-SDRyw' },
    { num: 4, name: 'Sled Push', sets: '6 x 20m', youtubeId: 'dn_rPCyHYJk' },
    { num: 5, name: 'Core Bracing', sets: '3 x 45s', youtubeId: 'mwlp75MS6Rg' },
    { num: 6, name: 'Cool Down', sets: '8 min', youtubeId: 'L_xrDAtykMI' },
  ]},
  { day: 'TUE', name: 'Upper Strength', meta: '6 exercises · 58 min · Heavy push/pull', badge: 'lift', exercises: [
    { num: 1, name: 'Bench Press', sets: '5 x 5', youtubeId: '_FkbD0FhgVE' },
    { num: 2, name: 'Weighted Pull Up', sets: '5 x 5', youtubeId: '1Sw5mevOsb0' },
    { num: 3, name: 'Barbell Row', sets: '4 x 8', youtubeId: 'dpYI8K6e-jE' },
    { num: 4, name: 'Overhead Press', sets: '4 x 6', youtubeId: 'zoN5EH50Dro' },
    { num: 5, name: 'Farmer Carry', sets: '4 x 30m', youtubeId: '1uOs1hP3u4A' },
    { num: 6, name: 'Band Mobility', sets: '5 min', youtubeId: 'L_xrDAtykMI' },
  ]},
  { day: 'WED', name: 'Conditioning', meta: '4 exercises · 32 min · Engine', badge: 'cardio', exercises: [
    { num: 1, name: 'Row Intervals', sets: '8 x 250m', youtubeId: '8SAj7l9xys4' },
    { num: 2, name: 'Air Bike', sets: '6 x 30s', youtubeId: '1K2GIpSd8ws' },
    { num: 3, name: 'Core Circuit', sets: '3 rounds', youtubeId: 'DHD1-2P94DI' },
    { num: 4, name: 'Walk Cooldown', sets: '10 min', youtubeId: '' },
  ]},
  { day: 'THU', name: 'Lower Strength', meta: '6 exercises · 62 min · Posterior chain', badge: 'lift', exercises: [
    { num: 1, name: 'Back Squat', sets: '5 x 5', youtubeId: 'dW3zj79xfrc' },
    { num: 2, name: 'Deadlift', sets: '4 x 4', youtubeId: 'op9kVnSso6Q' },
    { num: 3, name: 'Split Squat', sets: '3 x 8 each', youtubeId: 'dYw66M3gxSw' },
    { num: 4, name: 'Hamstring Curl', sets: '3 x 10', youtubeId: 'd6sg829PgNs' },
    { num: 5, name: 'Calf Raise', sets: '4 x 15', youtubeId: 'B30JglFGx8Y' },
    { num: 6, name: 'Mobility', sets: '8 min', youtubeId: 'L_xrDAtykMI' },
  ]},
  { day: 'FRI', name: 'Athletic Upper', meta: '5 exercises · 48 min · Athletic power', badge: 'lift', exercises: [
    { num: 1, name: 'Push Press', sets: '4 x 5', youtubeId: 'BKy8FcKhE-E' },
    { num: 2, name: 'Chest Supported Row', sets: '4 x 8', youtubeId: 'KaCcBqhiXtc' },
    { num: 3, name: 'DB Bench', sets: '3 x 10', youtubeId: 'fjNxsn57o_g' },
    { num: 4, name: 'Face Pull', sets: '3 x 15', youtubeId: 'qEyoBOpvqR4' },
    { num: 5, name: 'Sled Rope Pull', sets: '4 x 20m', youtubeId: 'dn_rPCyHYJk' },
  ]},
  { day: 'SAT', name: 'Field Conditioning', meta: '4 exercises · 28 min · Sprint mechanics', badge: 'cardio', exercises: [
    { num: 1, name: 'Sprint Drills', sets: '6 x 20m', youtubeId: 'isKfhbZkK_Y' },
    { num: 2, name: 'Hill Sprints', sets: '8 x 15s', youtubeId: 'isKfhbZkK_Y' },
    { num: 3, name: 'Med Ball Slams', sets: '4 x 12', youtubeId: 'f8wbXUucWeA' },
    { num: 4, name: 'Walk Recovery', sets: '12 min', youtubeId: '' },
  ]},
  { day: 'SUN', name: 'Recovery Day', meta: 'Breathwork · mobility · easy walk', badge: 'rest', exercises: [
    { num: 1, name: 'Walk', sets: '25 min', youtubeId: '' },
    { num: 2, name: 'Mobility Flow', sets: '15 min', youtubeId: 'L_xrDAtykMI' },
  ]},
];

export const PROGRAM_LIBRARY: ProgramDefinition[] = [
  {
    id: 'power-build',
    title: 'APEX Power Build',
    subtitle: 'Best for building a stronger base with structure and steady progression.',
    description: 'A balanced strength-first split with compound lifts, power work, and recovery built in.',
    reason: 'Choose this if you want to get stronger, build lean muscle, and train with a classic weekly split.',
    icon: '⚡',
    durationWeeks: 12,
    daysPerWeek: 5,
    level: 'Intermediate',
    schedule: POWER_BUILD_SCHEDULE,
    coachTeam: [
      { icon: '👨‍💼', name: 'Alex Rivera · Strength Coach', spec: 'Powerlifting · Hypertrophy · 8 yrs', compliance: 88, complianceColor: '#00ff87' },
      { icon: '👩‍⚕️', name: 'Lisa Chen · Nutrition Coach', spec: 'Sports Nutrition · Recomp focus', compliance: 72, complianceColor: '#3b82f6' },
    ],
  },
  {
    id: 'hiit-burn',
    title: 'HIIT & Burn',
    subtitle: 'Best for leaning out with shorter sessions and more conditioning.',
    description: 'Fast-paced intervals, sweat sessions, and calorie-burning circuits to support fat loss.',
    reason: 'Choose this if fat loss, conditioning, and shorter sessions matter more than heavy strength work right now.',
    icon: '🔥',
    durationWeeks: 8,
    daysPerWeek: 4,
    level: 'All levels',
    schedule: HIIT_BURN_SCHEDULE,
    coachTeam: [
      { icon: '🏃', name: 'Maya Torres · Conditioning Coach', spec: 'HIIT · Fat loss · 6 yrs', compliance: 83, complianceColor: '#ff6b35' },
      { icon: '🥗', name: 'Emma Liu · Nutrition Coach', spec: 'Calorie deficit · High satiety meals', compliance: 77, complianceColor: '#3b82f6' },
    ],
  },
  {
    id: 'body-recomp-pro',
    title: 'Body Recomp Pro',
    subtitle: 'Best for losing fat and building muscle at the same time.',
    description: 'A hybrid split that mixes strength, hypertrophy, and recovery to drive recomposition.',
    reason: 'Choose this if you want to tighten up, improve body composition, and keep training balanced.',
    icon: '💫',
    durationWeeks: 16,
    daysPerWeek: 4,
    level: 'Intermediate',
    schedule: BODY_RECOMP_SCHEDULE,
    coachTeam: [
      { icon: '💪', name: 'Jordan Lee · Recomp Coach', spec: 'Muscle retention · Body composition', compliance: 86, complianceColor: '#00ff87' },
      { icon: '🍽️', name: 'Nina Patel · Macro Coach', spec: 'High protein · Meal timing', compliance: 75, complianceColor: '#3b82f6' },
    ],
  },
  {
    id: 'elite-performance',
    title: 'Elite Performance',
    subtitle: 'Best for athletes chasing higher output, speed, and advanced performance.',
    description: 'A high-commitment advanced plan built around power, speed, strength, and conditioning.',
    reason: 'Choose this if you already train consistently and want a more demanding athletic-performance block.',
    icon: '👑',
    durationWeeks: 20,
    daysPerWeek: 6,
    level: 'Advanced',
    schedule: ELITE_PERFORMANCE_SCHEDULE,
    coachTeam: [
      { icon: '🏆', name: 'Marcus Vale · Performance Coach', spec: 'Speed · Power · Athlete prep', compliance: 91, complianceColor: '#00ff87' },
      { icon: '🧠', name: 'Dr. Sara Kim · Recovery Coach', spec: 'Recovery · Sleep · HRV', compliance: 79, complianceColor: '#3b82f6' },
    ],
  },
];

export function getPlanById(planId?: UserProfile['activePlanId']) {
  return PROGRAM_LIBRARY.find((plan) => plan.id === planId) ?? PROGRAM_LIBRARY[0];
}

export function getSuggestedPlanId(
  goal: UserProfile['goal'] = 'recomp',
  experience: UserProfile['experience'] = 'intermediate',
): ProgramDefinition['id'] {
  if (goal === 'lose') return 'hiit-burn';
  if (goal === 'performance' || experience === 'advanced') return 'elite-performance';
  if (goal === 'build') return 'power-build';
  return 'body-recomp-pro';
}

export function getMembershipLabel(isPro: boolean) {
  return isPro ? 'APEX Pro Membership' : 'APEX Free Plan';
}

export function getMembershipDescription(isPro: boolean) {
  return isPro
    ? 'You have full access to premium plans, unlimited AI coaching, voice workouts, and advanced support features.'
    : 'Free includes program previews, manual workout logging, manual and barcode food tracking, and limited coach access.';
}

export function getMembershipCta(isPro: boolean) {
  return isPro ? 'MANAGE →' : 'UPGRADE →';
}

const RECOVERY_EXERCISES = new Set([
  'Breathwork', 'Cool Down', 'Foam Rolling', 'Full Body Stretch',
  'Hip Flexor Stretch', 'Light Walk', 'Meditation', 'Mobility Flow',
  'Recovery Walk', 'Stretch', 'Thoracic Rotation', 'Walk', 'Walk Cooldown',
  'Band Mobility', 'Core Bracing', 'Finisher Walk', 'Foam Roll',
  'Hip Openers', 'Sprint Drills', 'Walk Recovery',
]);

export function getDemoVideoExercises(): string[] {
  return PLANNABLE_EXERCISE_LIBRARY.filter((name) => !RECOVERY_EXERCISES.has(name));
}

export function getAllProgramExerciseNames() {
  return Array.from(
    new Set(
      [
        ...PROGRAM_LIBRARY.flatMap((program) =>
          program.schedule.flatMap((day) => day.exercises.map((exercise) => exercise.name.trim())),
        ),
        ...PLANNABLE_EXERCISE_LIBRARY,
      ],
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export function getPlanBuilderExerciseCatalog() {
  return {
    strength: [
      'Back Squat',
      'Front Squat',
      'Bench Press',
      'Barbell Bench Press',
      'Incline DB Press',
      'Decline Bench Press',
      'Overhead Press',
      'Seated DB Shoulder Press',
      'Barbell Row',
      'Seated Cable Row',
      'Neutral Grip Lat Pulldown',
      'Weighted Pull Up',
      'Romanian Deadlift',
      'Deadlift',
      'Hip Thrust',
      'Leg Press',
      'Walking Lunges',
      'Bulgarian Split Squat',
    ],
    hypertrophy: [
      'Cable Fly',
      'Standing Cable Fly',
      'Lateral Raises',
      'Face Pulls',
      'Cable Curl',
      'Incline DB Curl',
      'Hammer Curls',
      'Rope Tricep Pushdown',
      'Band Tricep Pressdown',
      'Leg Curl',
      'Standing Calf Raises',
    ],
    conditioning: [
      'Air Bike',
      'Assault Bike Intervals',
      'Row Intervals',
      'Battle Ropes',
      'Sprint Intervals',
      'Hill Sprints',
      'Jump Rope',
      'Sled Push',
      'Sled Rope Pull',
      'Med Ball Slams',
    ],
    recovery: [
      'Light Walk',
      'Recovery Walk',
      'Walk Cooldown',
      'Foam Rolling',
      'Hip Flexor Stretch',
      'Mobility Flow',
      'Thoracic Rotation',
      'Breathwork',
      'Stretch',
      'Meditation',
    ],
  };
}

/**
 * Fallback YouTube ID map for common exercises not in the active plan.
 * Used by getYoutubeIdForExercise() when the plan lookup returns nothing.
 */
const EXERCISE_YOUTUBE_FALLBACK: Record<string, string> = {
  'squat': 'dW3zj79xfrc',
  'back squat': 'dW3zj79xfrc',
  'barbell squat': 'dW3zj79xfrc',
  'front squat': '8y_6tN6wvZM',
  'goblet squat': 'lRYBbchqxtI',
  'bench press': '_FkbD0FhgVE',
  'barbell bench': '_FkbD0FhgVE',
  'barbell bench press': '_FkbD0FhgVE',
  'dumbbell bench': 'fjNxsn57o_g',
  'db bench': 'fjNxsn57o_g',
  'flat barbell bench press': '_FkbD0FhgVE',
  'flat bench press': '_FkbD0FhgVE',
  'incline press': '8fXfwG4ftaQ',
  'incline bench': '8fXfwG4ftaQ',
  'incline db press': '8fXfwG4ftaQ',
  'incline bench press': '8fXfwG4ftaQ',
  'incline barbell bench press': '8fXfwG4ftaQ',
  'decline bench press': '4T9UQ4FBf1Q',
  'decline db press': 'SkM-XR3xYgg',
  'overhead press': 'zoN5EH50Dro',
  'ohp': 'zoN5EH50Dro',
  'military press': 'zoN5EH50Dro',
  'standing overhead press': 'zoN5EH50Dro',
  'seated overhead press': 'k6tzKisR3NY',
  'push press': 'BKy8FcKhE-E',
  'db shoulder press': 'k6tzKisR3NY',
  'standing db shoulder press': 'k6tzKisR3NY',
  'seated db shoulder press': 'k6tzKisR3NY',
  'deadlift': 'op9kVnSso6Q',
  'romanian deadlift': '_TchJLlBO-4',
  'rdl': '_TchJLlBO-4',
  'sumo deadlift': 'op9kVnSso6Q',
  'pull up': '1Sw5mevOsb0',
  'pull-up': '1Sw5mevOsb0',
  'pullup': '1Sw5mevOsb0',
  'pull ups': '1Sw5mevOsb0',
  'weighted pull up': '1Sw5mevOsb0',
  'chin up': '1Sw5mevOsb0',
  'barbell row': 'dpYI8K6e-jE',
  'bent over row': 'dpYI8K6e-jE',
  'seated cable row': 'KaCcBqhiXtc',
  'cable row': 'KaCcBqhiXtc',
  'overhand cable row': 'KaCcBqhiXtc',
  'underhand cable row': 'KaCcBqhiXtc',
  'lat pulldown': 'bNmvKpJSWKM',
  'neutral grip lat pulldown': 'bNmvKpJSWKM',
  'underhand lat pulldown': 'bNmvKpJSWKM',
  'overhand lat pulldown': 'bNmvKpJSWKM',
  'face pulls': 'qEyoBOpvqR4',
  'face pull': 'qEyoBOpvqR4',
  'lateral raises': 'Kl3LEzQ5Zqs',
  'lateral raise': 'Kl3LEzQ5Zqs',
  'side raises': 'Kl3LEzQ5Zqs',
  'cable lateral raise': 'Kl3LEzQ5Zqs',
  'band lateral raise': 'Kl3LEzQ5Zqs',
  'tricep pushdowns': '4s8Fdhnk6aI',
  'tricep pressdown': '4s8Fdhnk6aI',
  'tricep pushdown': '4s8Fdhnk6aI',
  'tricep extension': '4s8Fdhnk6aI',
  'rope tricep pushdown': '4s8Fdhnk6aI',
  'band tricep pressdown': '4s8Fdhnk6aI',
  'db curls': 'iui51E31sX8',
  'dumbbell curl': 'iui51E31sX8',
  'bicep curl': 'iui51E31sX8',
  'standing db curl': 'iui51E31sX8',
  'standing barbell curl': 'iui51E31sX8',
  'hammer curls': 'K9LiwcGuqA0',
  'seated hammer curl': 'K9LiwcGuqA0',
  'cable curl': 'qEdBw-eowVg',
  'incline db curl': 'soxrZlIl35U',
  'walking lunges': 'L8fvypPrzzs',
  'lunges': 'L8fvypPrzzs',
  'reverse lunge': 'xrPteyQLGAo',
  'split squat': 'dYw66M3gxSw',
  'bulgarian split squat': 'dYw66M3gxSw',
  'leg press': 'C4bIC78wu6s',
  'leg curl': 'd6sg829PgNs',
  'hamstring curl': 'd6sg829PgNs',
  'standing calf raises': 'B30JglFGx8Y',
  'calf raise': 'B30JglFGx8Y',
  'calf raises': 'B30JglFGx8Y',
  'hip thrust': 'W86oVlnLqY4',
  'glute bridge': 'W86oVlnLqY4',
  'power clean': '5FvJsmmMipo',
  'hang power clean': '5FvJsmmMipo',
  'farmer carry': '1uOs1hP3u4A',
  'farmer walk': '1uOs1hP3u4A',
  'box jump': 'NBY9-kTuHEk',
  'push ups': 'WDIpL0pjun0',
  'push-ups': 'WDIpL0pjun0',
  'pushup': 'WDIpL0pjun0',
  'plank': 'mwlp75MS6Rg',
  'plank hold': 'mwlp75MS6Rg',
  'crunches': 'eeJ_CYqSoT4',
  'crunch': 'eeJ_CYqSoT4',
  'sit ups': 'q5EOcLVXwZ8',
  'sit-ups': 'q5EOcLVXwZ8',
  'situps': 'q5EOcLVXwZ8',
  'russian twists': 'aRUMRbl7KS4',
  'russian twist': 'aRUMRbl7KS4',
  'leg raises': '6tkgHJZYh1A',
  'leg raise': '6tkgHJZYh1A',
  'dead bug': 'bxn9FBrt4-A',
  'mountain climbers': '7W4JEfEKuC4',
  'mountain climber': '7W4JEfEKuC4',
  'burpees': 'dZgVxmf6jkA',
  'burpee': 'dZgVxmf6jkA',
  'jump squats': 'LNeXr1IMsJ0',
  'jump squat': 'LNeXr1IMsJ0',
  'kettlebell swing': 'n1df4ASFeZU',
  'kb swing': 'n1df4ASFeZU',
  'foam rolling': 'aBDkiULJAMQ',
  'foam roll': 'aBDkiULJAMQ',
  'hip flexor stretch': 'ktgtEWGhFd8',
  'stretch': 'L_xrDAtykMI',
  'full body stretch': 'L_xrDAtykMI',
  'mobility flow': 'L_xrDAtykMI',
  'med ball slams': 'f8wbXUucWeA',
  'battle ropes': 'NEe8PBbUgOQ',
  'air bike': '1K2GIpSd8ws',
  'assault bike intervals': '1K2GIpSd8ws',
  'walk cooldown': '',
  'recovery walk': '',
  'light walk': '',
};

/**
 * Look up a YouTube demo ID for any exercise name.
 * First checks the active plan's exercises for an exact match,
 * then falls back to the fuzzy lookup map using lowercase contains-matching.
 */
export function getYoutubeIdForExercise(exerciseName: string, planExercises: WorkoutProgramExercise[]): string {
  // Exact plan match first
  const exact = planExercises.find((e) => e.name.toLowerCase() === exerciseName.toLowerCase());
  if (exact?.youtubeId) return exact.youtubeId;

  const lower = exerciseName.toLowerCase().trim();

  // Direct key lookup
  if (EXERCISE_YOUTUBE_FALLBACK[lower]) return EXERCISE_YOUTUBE_FALLBACK[lower];

  // Partial contains-match (e.g. "Heavy Barbell Squat" → 'squat')
  for (const [key, id] of Object.entries(EXERCISE_YOUTUBE_FALLBACK)) {
    if (lower.includes(key) || key.includes(lower)) return id;
  }

  return '';
}
