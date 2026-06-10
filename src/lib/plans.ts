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
      { num: 1, name: 'Bench Press', sets: '4 x 6 @ 80% · Rest 3 min', youtubeId: 'KaCcBqhiXtc' },
      { num: 2, name: 'Overhead Press', sets: '3 x 8 · Rest 2 min', youtubeId: 'QAQ64hK4d00' },
      { num: 3, name: 'Incline DB Press', sets: '3 x 10 · Rest 90s', youtubeId: '8iPEnn-ltC8' },
      { num: 4, name: 'Lateral Raises', sets: '4 x 15 · Controlled tempo', youtubeId: 'kDqklk1ZESo' },
      { num: 5, name: 'Tricep Pushdowns', sets: '3 x 12 · Cable or bands', youtubeId: '2-LAMcpzODU' },
    ],
  },
  {
    day: 'TUE',
    name: 'Upper Body Pull',
    meta: '6 exercises · ~61 min · Back · Biceps',
    badge: 'lift',
    exercises: [
      { num: 1, name: 'Pull-Up', sets: '4 x max · Weighted if possible', youtubeId: 'eGo4IYlbE5g' },
      { num: 2, name: 'Barbell Row', sets: '4 x 6 · Rest 3 min', youtubeId: 'kBWAon7ItDw' },
      { num: 3, name: 'Seated Cable Row', sets: '3 x 10 · Rest 2 min', youtubeId: 'GZbfZ033f74' },
      { num: 4, name: 'Face Pulls', sets: '4 x 15 · Light weight', youtubeId: 'HSoHeSjfOpk' },
      { num: 5, name: 'DB Curls', sets: '3 x 12 each arm', youtubeId: 'ykJmrZ5v0Oo' },
      { num: 6, name: 'Hammer Curls', sets: '3 x 10 each arm', youtubeId: 'zC3nLlEvin4' },
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
      { num: 1, name: 'Back Squat', sets: '4 x 6 @ 80%', youtubeId: 'ultWZbUMPL8' },
      { num: 2, name: 'Romanian Deadlift', sets: '3 x 8 @ 185 lbs', youtubeId: 'JCXUYuzwNrM' },
      { num: 3, name: 'Walking Lunges', sets: '3 x 12 each', youtubeId: 'L8fvypPrzzs' },
      { num: 4, name: 'Leg Press', sets: '4 x 10 @ 360 lbs', youtubeId: 'IZxyjW7MPJQ' },
      { num: 5, name: 'Leg Curl', sets: '3 x 12 @ 120 lbs', youtubeId: 'ELOCsoDSmrg' },
      { num: 6, name: 'Standing Calf Raises', sets: '4 x 15', youtubeId: 'gwLzBJYoWlI' },
    ],
  },
  {
    day: 'FRI',
    name: 'Full Body Power',
    meta: '5 exercises · Deadlift · Clean · Push Press',
    badge: 'lift',
    exercises: [
      { num: 1, name: 'Deadlift', sets: '4 x 4 @ 85%', youtubeId: 'op9kVnSso6Q' },
      { num: 2, name: 'Hang Power Clean', sets: '4 x 4', youtubeId: 'RL-Jkf5EMHY' },
      { num: 3, name: 'Push Press', sets: '3 x 5', youtubeId: 'iaBVSJm78ko' },
      { num: 4, name: 'Box Jump', sets: '4 x 5', youtubeId: 'NBY9-kTuHEk' },
      { num: 5, name: 'Farmer Carry', sets: '4 x 30m', youtubeId: 'rt17lmnaLSM' },
    ],
  },
  {
    day: 'SAT',
    name: 'Cardio + Core',
    meta: '4 exercises · 18 min · Core · Conditioning',
    badge: 'cardio',
    exercises: [
      { num: 1, name: 'Sit Ups', sets: '3 x 20', youtubeId: 'jDwoBqPH0jk' },
      { num: 2, name: 'Crunches', sets: '3 x 20', youtubeId: 'Xyd_fa5zoEU' },
      { num: 3, name: 'Plank Hold', sets: '3 x 45s', youtubeId: 'ASdvN_XEl_c' },
      { num: 4, name: 'Mountain Climbers', sets: '3 x 30s', youtubeId: 'nmwgirgXLYM' },
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
    { num: 1, name: 'Sprint Intervals', sets: '8 x 20s on / 40s off', youtubeId: 'lN3_GHpsGrk' },
    { num: 2, name: 'Jump Squats', sets: '3 x 15', youtubeId: 'A-cFYWvaHr0' },
    { num: 3, name: 'Burpees', sets: '3 x 12', youtubeId: 'dZgVxmf6jkA' },
    { num: 4, name: 'Bike Cooldown', sets: '6 min easy spin', youtubeId: '' },
  ]},
  { day: 'TUE', name: 'Upper Body Burner', meta: '4 exercises · 20 min · Push + pull', badge: 'lift', exercises: [
    { num: 1, name: 'Push Ups', sets: '4 x 15', youtubeId: 'IODxDxX7oi4' },
    { num: 2, name: 'Bent Over Row', sets: '4 x 12', youtubeId: 'kBWAon7ItDw' },
    { num: 3, name: 'Shoulder Taps', sets: '3 x 20', youtubeId: 'LEZq7oxoXG8' },
    { num: 4, name: 'Battle Ropes', sets: '6 x 20s', youtubeId: 'NEe8PBbUgOQ' },
  ]},
  { day: 'WED', name: 'Mobility Reset', meta: '3 exercises · 15 min · Recovery', badge: 'rest', exercises: [
    { num: 1, name: 'Walk', sets: '15 min easy pace', youtubeId: '' },
    { num: 2, name: 'Hip Openers', sets: '3 x 45s', youtubeId: 'ktgtEWGhFd8' },
    { num: 3, name: 'Thoracic Rotation', sets: '3 x 10 each', youtubeId: 'C8wzQhlXPx8' },
  ]},
  { day: 'THU', name: 'Lower Body Burner', meta: '4 exercises · 22 min · Legs + glutes', badge: 'lift', exercises: [
    { num: 1, name: 'Goblet Squat', sets: '4 x 12', youtubeId: 'MxsFDhcyFyE' },
    { num: 2, name: 'Reverse Lunge', sets: '3 x 10 each', youtubeId: 'xrPteyQLGAo' },
    { num: 3, name: 'Kettlebell Swing', sets: '4 x 15', youtubeId: 'cKx8xE8jhjg' },
    { num: 4, name: 'Jump Rope', sets: '5 x 45s', youtubeId: 'u3zgHI8QnqE' },
  ]},
  { day: 'FRI', name: 'Full Body Sweat', meta: '4 exercises · 25 min · Circuit', badge: 'cardio', exercises: [
    { num: 1, name: 'Row Intervals', sets: '6 x 30s', youtubeId: 'H0r_Bbl7jRE' },
    { num: 2, name: 'DB Thrusters', sets: '4 x 12', youtubeId: 'L219ltL15zk' },
    { num: 3, name: 'Push Up Plank', sets: '3 x 12', youtubeId: 'IODxDxX7oi4' },
    { num: 4, name: 'Walking Recovery', sets: '8 min', youtubeId: '' },
  ]},
  { day: 'SAT', name: 'Core Finisher', meta: '4 exercises · 16 min · Core', badge: 'cardio', exercises: [
    { num: 1, name: 'Crunches', sets: '3 x 25', youtubeId: 'Xyd_fa5zoEU' },
    { num: 2, name: 'Plank Hold', sets: '3 x 60s', youtubeId: 'ASdvN_XEl_c' },
    { num: 3, name: 'Russian Twists', sets: '3 x 20', youtubeId: 'aRUMRbl7KS4' },
    { num: 4, name: 'Leg Raises', sets: '3 x 15', youtubeId: 'JB2oyawG9KI' },
  ]},
  { day: 'SUN', name: 'Rest Day', meta: 'Walk · recover · reset', badge: 'rest', exercises: [
    { num: 1, name: 'Walk', sets: '20 min easy', youtubeId: '' },
    { num: 2, name: 'Stretch', sets: '10 min', youtubeId: 'L_xrDAtykMI' },
  ]},
];

const BODY_RECOMP_SCHEDULE: WorkoutProgramDay[] = [
  { day: 'MON', name: 'Upper Strength', meta: '5 exercises · 45 min · Recomp', badge: 'lift', exercises: [
    { num: 1, name: 'Bench Press', sets: '4 x 8', youtubeId: 'KaCcBqhiXtc' },
    { num: 2, name: 'Pull Ups', sets: '4 x 8', youtubeId: 'eGo4IYlbE5g' },
    { num: 3, name: 'DB Shoulder Press', sets: '3 x 10', youtubeId: 'qEwKCR5JCog' },
    { num: 4, name: 'Cable Row', sets: '3 x 12', youtubeId: 'GZbfZ033f74' },
    { num: 5, name: 'Finisher Walk', sets: '10 min incline', youtubeId: '' },
  ]},
  { day: 'TUE', name: 'Lower Strength', meta: '5 exercises · 48 min · Quads · glutes', badge: 'lift', exercises: [
    { num: 1, name: 'Back Squat', sets: '4 x 8', youtubeId: 'ultWZbUMPL8' },
    { num: 2, name: 'RDL', sets: '4 x 10', youtubeId: 'JCXUYuzwNrM' },
    { num: 3, name: 'Split Squat', sets: '3 x 10 each', youtubeId: 'hz79nppjPrI' },
    { num: 4, name: 'Leg Curl', sets: '3 x 12', youtubeId: 'ELOCsoDSmrg' },
    { num: 5, name: 'Bike Flush', sets: '8 min', youtubeId: '' },
  ]},
  { day: 'WED', name: 'Recovery Walk', meta: '3 exercises · 20 min · Recovery', badge: 'rest', exercises: [
    { num: 1, name: 'Walk', sets: '20 min brisk', youtubeId: '' },
    { num: 2, name: 'Stretch', sets: '8 min', youtubeId: 'L_xrDAtykMI' },
    { num: 3, name: 'Breathwork', sets: '5 min', youtubeId: 'tybOi4hjZFQ' },
  ]},
  { day: 'THU', name: 'Upper Hypertrophy', meta: '5 exercises · 42 min · Volume', badge: 'lift', exercises: [
    { num: 1, name: 'Incline Press', sets: '4 x 10', youtubeId: '8iPEnn-ltC8' },
    { num: 2, name: 'Lat Pulldown', sets: '4 x 12', youtubeId: 'CAwf7n6Luuc' },
    { num: 3, name: 'Lateral Raise', sets: '3 x 15', youtubeId: 'kDqklk1ZESo' },
    { num: 4, name: 'Cable Curl', sets: '3 x 12', youtubeId: 'NFzTWp2qpiE' },
    { num: 5, name: 'Tricep Pressdown', sets: '3 x 12', youtubeId: '2-LAMcpzODU' },
  ]},
  { day: 'FRI', name: 'Lower + Core', meta: '5 exercises · 40 min · Recomp', badge: 'lift', exercises: [
    { num: 1, name: 'Leg Press', sets: '4 x 12', youtubeId: 'IZxyjW7MPJQ' },
    { num: 2, name: 'Walking Lunges', sets: '3 x 12 each', youtubeId: 'L8fvypPrzzs' },
    { num: 3, name: 'Hip Thrust', sets: '3 x 10', youtubeId: 'xDmFkJxPzeM' },
    { num: 4, name: 'Plank Hold', sets: '3 x 45s', youtubeId: 'ASdvN_XEl_c' },
    { num: 5, name: 'Dead Bug', sets: '3 x 12 each', youtubeId: 'g_BYB0R-4Ws' },
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
    { num: 1, name: 'Power Clean', sets: '5 x 3', youtubeId: 'RL-Jkf5EMHY' },
    { num: 2, name: 'Front Squat', sets: '4 x 5', youtubeId: 'uYumuL_G_V0' },
    { num: 3, name: 'Broad Jump', sets: '5 x 3', youtubeId: 'tNS-4kqSf24' },
    { num: 4, name: 'Sled Push', sets: '6 x 20m', youtubeId: 'Uif3lTj3MqU' },
    { num: 5, name: 'Core Bracing', sets: '3 x 45s', youtubeId: 'ASdvN_XEl_c' },
    { num: 6, name: 'Cool Down', sets: '8 min', youtubeId: 'L_xrDAtykMI' },
  ]},
  { day: 'TUE', name: 'Upper Strength', meta: '6 exercises · 58 min · Heavy push/pull', badge: 'lift', exercises: [
    { num: 1, name: 'Bench Press', sets: '5 x 5', youtubeId: 'KaCcBqhiXtc' },
    { num: 2, name: 'Weighted Pull Up', sets: '5 x 5', youtubeId: 'eGo4IYlbE5g' },
    { num: 3, name: 'Barbell Row', sets: '4 x 8', youtubeId: 'kBWAon7ItDw' },
    { num: 4, name: 'Overhead Press', sets: '4 x 6', youtubeId: 'QAQ64hK4d00' },
    { num: 5, name: 'Farmer Carry', sets: '4 x 30m', youtubeId: 'rt17lmnaLSM' },
    { num: 6, name: 'Band Mobility', sets: '5 min', youtubeId: 'L_xrDAtykMI' },
  ]},
  { day: 'WED', name: 'Conditioning', meta: '4 exercises · 32 min · Engine', badge: 'cardio', exercises: [
    { num: 1, name: 'Row Intervals', sets: '8 x 250m', youtubeId: 'H0r_Bbl7jRE' },
    { num: 2, name: 'Air Bike', sets: '6 x 30s', youtubeId: 'HhOCSmOhpEQ' },
    { num: 3, name: 'Core Circuit', sets: '3 rounds', youtubeId: 'DHD1-2P94DI' },
    { num: 4, name: 'Walk Cooldown', sets: '10 min', youtubeId: '' },
  ]},
  { day: 'THU', name: 'Lower Strength', meta: '6 exercises · 62 min · Posterior chain', badge: 'lift', exercises: [
    { num: 1, name: 'Back Squat', sets: '5 x 5', youtubeId: 'ultWZbUMPL8' },
    { num: 2, name: 'Deadlift', sets: '4 x 4', youtubeId: 'op9kVnSso6Q' },
    { num: 3, name: 'Split Squat', sets: '3 x 8 each', youtubeId: 'hz79nppjPrI' },
    { num: 4, name: 'Hamstring Curl', sets: '3 x 10', youtubeId: 'ELOCsoDSmrg' },
    { num: 5, name: 'Calf Raise', sets: '4 x 15', youtubeId: 'gwLzBJYoWlI' },
    { num: 6, name: 'Mobility', sets: '8 min', youtubeId: 'L_xrDAtykMI' },
  ]},
  { day: 'FRI', name: 'Athletic Upper', meta: '5 exercises · 48 min · Athletic power', badge: 'lift', exercises: [
    { num: 1, name: 'Push Press', sets: '4 x 5', youtubeId: 'iaBVSJm78ko' },
    { num: 2, name: 'Chest Supported Row', sets: '4 x 8', youtubeId: 'GZbfZ033f74' },
    { num: 3, name: 'DB Bench', sets: '3 x 10', youtubeId: 'VmB1G1K7v94' },
    { num: 4, name: 'Face Pull', sets: '3 x 15', youtubeId: 'HSoHeSjfOpk' },
    { num: 5, name: 'Sled Rope Pull', sets: '4 x 20m', youtubeId: 'Uif3lTj3MqU' },
  ]},
  { day: 'SAT', name: 'Field Conditioning', meta: '4 exercises · 28 min · Sprint mechanics', badge: 'cardio', exercises: [
    { num: 1, name: 'Sprint Drills', sets: '6 x 20m', youtubeId: 'lN3_GHpsGrk' },
    { num: 2, name: 'Hill Sprints', sets: '8 x 15s', youtubeId: 'lN3_GHpsGrk' },
    { num: 3, name: 'Med Ball Slams', sets: '4 x 12', youtubeId: '4MnBFGSFeUI' },
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
  'squat': 'ultWZbUMPL8',
  'back squat': 'ultWZbUMPL8',
  'barbell squat': 'ultWZbUMPL8',
  'front squat': 'uYumuL_G_V0',
  'goblet squat': 'MxsFDhcyFyE',
  'bench press': 'KaCcBqhiXtc',
  'barbell bench': 'KaCcBqhiXtc',
  'barbell bench press': 'KaCcBqhiXtc',
  'dumbbell bench': 'VmB1G1K7v94',
  'db bench': 'VmB1G1K7v94',
  'flat barbell bench press': 'KaCcBqhiXtc',
  'flat bench press': 'KaCcBqhiXtc',
  'incline press': '8iPEnn-ltC8',
  'incline bench': '8iPEnn-ltC8',
  'incline db press': '8iPEnn-ltC8',
  'incline bench press': '8iPEnn-ltC8',
  'incline barbell bench press': '8iPEnn-ltC8',
  'decline bench press': '4T9UQ4FBf1Q',
  'decline db press': 'SkM-XR3xYgg',
  'overhead press': 'QAQ64hK4d00',
  'ohp': 'QAQ64hK4d00',
  'military press': 'QAQ64hK4d00',
  'standing overhead press': 'QAQ64hK4d00',
  'seated overhead press': 'qEwKCR5JCog',
  'push press': 'iaBVSJm78ko',
  'db shoulder press': 'qEwKCR5JCog',
  'standing db shoulder press': 'qEwKCR5JCog',
  'seated db shoulder press': 'qEwKCR5JCog',
  'deadlift': 'op9kVnSso6Q',
  'romanian deadlift': 'JCXUYuzwNrM',
  'rdl': 'JCXUYuzwNrM',
  'sumo deadlift': 'op9kVnSso6Q',
  'pull up': 'eGo4IYlbE5g',
  'pull-up': 'eGo4IYlbE5g',
  'pullup': 'eGo4IYlbE5g',
  'pull ups': 'eGo4IYlbE5g',
  'weighted pull up': 'eGo4IYlbE5g',
  'chin up': 'eGo4IYlbE5g',
  'barbell row': 'kBWAon7ItDw',
  'bent over row': 'kBWAon7ItDw',
  'seated cable row': 'GZbfZ033f74',
  'cable row': 'GZbfZ033f74',
  'overhand cable row': 'GZbfZ033f74',
  'underhand cable row': 'GZbfZ033f74',
  'lat pulldown': 'CAwf7n6Luuc',
  'neutral grip lat pulldown': 'CAwf7n6Luuc',
  'underhand lat pulldown': 'CAwf7n6Luuc',
  'overhand lat pulldown': 'CAwf7n6Luuc',
  'face pulls': 'HSoHeSjfOpk',
  'face pull': 'HSoHeSjfOpk',
  'lateral raises': 'kDqklk1ZESo',
  'lateral raise': 'kDqklk1ZESo',
  'side raises': 'kDqklk1ZESo',
  'cable lateral raise': 'kDqklk1ZESo',
  'band lateral raise': 'kDqklk1ZESo',
  'tricep pushdowns': '2-LAMcpzODU',
  'tricep pressdown': '2-LAMcpzODU',
  'tricep pushdown': '2-LAMcpzODU',
  'tricep extension': '2-LAMcpzODU',
  'rope tricep pushdown': '2-LAMcpzODU',
  'band tricep pressdown': '2-LAMcpzODU',
  'db curls': 'ykJmrZ5v0Oo',
  'dumbbell curl': 'ykJmrZ5v0Oo',
  'bicep curl': 'ykJmrZ5v0Oo',
  'standing db curl': 'ykJmrZ5v0Oo',
  'standing barbell curl': 'ykJmrZ5v0Oo',
  'hammer curls': 'zC3nLlEvin4',
  'seated hammer curl': 'zC3nLlEvin4',
  'cable curl': 'NFzTWp2qpiE',
  'incline db curl': 'soxrZlIl35U',
  'walking lunges': 'L8fvypPrzzs',
  'lunges': 'L8fvypPrzzs',
  'reverse lunge': 'xrPteyQLGAo',
  'split squat': 'hz79nppjPrI',
  'bulgarian split squat': 'hz79nppjPrI',
  'leg press': 'IZxyjW7MPJQ',
  'leg curl': 'ELOCsoDSmrg',
  'hamstring curl': 'ELOCsoDSmrg',
  'standing calf raises': 'gwLzBJYoWlI',
  'calf raise': 'gwLzBJYoWlI',
  'calf raises': 'gwLzBJYoWlI',
  'hip thrust': 'xDmFkJxPzeM',
  'glute bridge': 'xDmFkJxPzeM',
  'power clean': 'RL-Jkf5EMHY',
  'hang power clean': 'RL-Jkf5EMHY',
  'farmer carry': 'rt17lmnaLSM',
  'farmer walk': 'rt17lmnaLSM',
  'box jump': 'NBY9-kTuHEk',
  'push ups': 'IODxDxX7oi4',
  'push-ups': 'IODxDxX7oi4',
  'pushup': 'IODxDxX7oi4',
  'plank': 'ASdvN_XEl_c',
  'plank hold': 'ASdvN_XEl_c',
  'crunches': 'Xyd_fa5zoEU',
  'crunch': 'Xyd_fa5zoEU',
  'sit ups': 'jDwoBqPH0jk',
  'sit-ups': 'jDwoBqPH0jk',
  'situps': 'jDwoBqPH0jk',
  'russian twists': 'aRUMRbl7KS4',
  'russian twist': 'aRUMRbl7KS4',
  'leg raises': 'JB2oyawG9KI',
  'leg raise': 'JB2oyawG9KI',
  'dead bug': 'g_BYB0R-4Ws',
  'mountain climbers': 'nmwgirgXLYM',
  'mountain climber': 'nmwgirgXLYM',
  'burpees': 'dZgVxmf6jkA',
  'burpee': 'dZgVxmf6jkA',
  'jump squats': 'A-cFYWvaHr0',
  'jump squat': 'A-cFYWvaHr0',
  'kettlebell swing': 'cKx8xE8jhjg',
  'kb swing': 'cKx8xE8jhjg',
  'foam rolling': 'aBDkiULJAMQ',
  'foam roll': 'aBDkiULJAMQ',
  'hip flexor stretch': 'ktgtEWGhFd8',
  'stretch': 'L_xrDAtykMI',
  'full body stretch': 'L_xrDAtykMI',
  'mobility flow': 'L_xrDAtykMI',
  'med ball slams': '4MnBFGSFeUI',
  'battle ropes': 'NEe8PBbUgOQ',
  'air bike': 'HhOCSmOhpEQ',
  'assault bike intervals': 'HhOCSmOhpEQ',
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
