export type AchievementStats = {
  level: number;
  mealCount: number;
  photoScanCount: number;
  streak: number;
  workoutCount: number;
  xp: number;
  walkCount: number;
  totalWalkDistanceKm: number;
  /** Total Academy modules the user has marked complete */
  academyModuleCount: number;
  /** Number of APEX Blueprint modules marked complete */
  blueprintModuleCount: number;
  /** Number of Academy courses where every module is complete */
  completedCourseCount: number;
};

export const FOOD_CAMERA_SCAN_STORAGE_KEY = 'apex.food.cameraScanCount';

type AchievementMetric = 'level' | 'mealCount' | 'photoScanCount' | 'streak' | 'workoutCount' | 'walkCount' | 'totalWalkDistanceKm' | 'academyModuleCount' | 'blueprintModuleCount' | 'completedCourseCount';

type AchievementDefinition = {
  description: string;
  icon: string;
  id: string;
  metric: AchievementMetric;
  name: string;
  shareTemplate: string;
  target: number;
};

export type UserAchievement = AchievementDefinition & {
  current: number;
  earned: boolean;
  progressLabel: string;
};

const DEFINITIONS: AchievementDefinition[] = [
  {
    id: 'first-steps',
    icon: '👟',
    name: 'First Steps',
    description: 'Complete your first walk',
    metric: 'walkCount',
    target: 1,
    shareTemplate: 'Just logged my first walk on APEX.',
  },
  {
    id: 'walk-mover',
    icon: '🚶',
    name: 'Mover',
    description: 'Complete 5 walks',
    metric: 'walkCount',
    target: 5,
    shareTemplate: 'Just completed 5 walks on APEX.',
  },
  {
    id: 'walk-road-regular',
    icon: '🛤️',
    name: 'Road Regular',
    description: 'Complete 20 walks',
    metric: 'walkCount',
    target: 20,
    shareTemplate: 'Just hit 20 walks on APEX.',
  },
  {
    id: 'walk-5k',
    icon: '🏅',
    name: '5K Finisher',
    description: 'Walk 5 km in total',
    metric: 'totalWalkDistanceKm',
    target: 5,
    shareTemplate: 'Just walked a total of 5 km on APEX.',
  },
  {
    id: 'walk-50k',
    icon: '🌍',
    name: 'Half Century',
    description: 'Walk 50 km in total',
    metric: 'totalWalkDistanceKm',
    target: 50,
    shareTemplate: 'Just walked a total of 50 km on APEX.',
  },

  {
    id: 'first-session',
    icon: '⚡',
    name: 'First Rep',
    description: 'Log your first workout',
    metric: 'workoutCount',
    target: 1,
    shareTemplate: 'Just unlocked First Rep on APEX after logging my first workout.',
  },
  {
    id: 'on-fire',
    icon: '🔥',
    name: 'On Fire',
    description: '7-day streak',
    metric: 'streak',
    target: 7,
    shareTemplate: 'Just hit a 7-day streak on APEX. Locked in all week.',
  },
  {
    id: 'iron-willed',
    icon: '💪',
    name: 'Iron Willed',
    description: '50 workouts logged',
    metric: 'workoutCount',
    target: 50,
    shareTemplate: 'Just unlocked Iron Willed on APEX after 50 workouts logged.',
  },
  {
    id: 'clean-eater',
    icon: '🥗',
    name: 'Clean Eater',
    description: '25 meals logged',
    metric: 'mealCount',
    target: 25,
    shareTemplate: 'Just unlocked Clean Eater on APEX after logging 25 meals.',
  },
  {
    id: 'snap-and-track',
    icon: '📸',
    name: 'Snap & Track',
    description: 'Log your first meal after using the camera scan',
    metric: 'photoScanCount',
    target: 1,
    shareTemplate: 'Just unlocked Snap & Track on APEX after logging my first meal from a camera scan.',
  },
  {
    id: 'double-digits',
    icon: '🏆',
    name: 'Double Digits',
    description: 'Reach Level 10',
    metric: 'level',
    target: 10,
    shareTemplate: 'Just reached Level 10 on APEX. Progress is stacking up.',
  },
  {
    id: 'legendary',
    icon: '👑',
    name: 'Legendary',
    description: 'Reach Level 25',
    metric: 'level',
    target: 25,
    shareTemplate: 'Just unlocked Legendary on APEX by reaching Level 25.',
  },

  // ── Academy achievements ──────────────────────────────────────────────────
  {
    id: 'academy-first-lesson',
    icon: '📖',
    name: 'First Page Turned',
    description: 'Complete your first Academy module',
    metric: 'academyModuleCount',
    target: 1,
    shareTemplate: 'Just completed my first Academy module on APEX. The journey starts here.',
  },
  {
    id: 'academy-5-lessons',
    icon: '📚',
    name: 'Knowledge Seeker',
    description: 'Complete 5 Academy modules',
    metric: 'academyModuleCount',
    target: 5,
    shareTemplate: 'Just completed 5 Academy modules on APEX. Building that knowledge stack.',
  },
  {
    id: 'academy-10-lessons',
    icon: '🏫',
    name: 'Dedicated Student',
    description: 'Complete 10 Academy modules',
    metric: 'academyModuleCount',
    target: 10,
    shareTemplate: 'Just hit 10 completed Academy modules on APEX. Locked in.',
  },
  {
    id: 'academy-20-lessons',
    icon: '🔭',
    name: 'Deep Diver',
    description: 'Complete 20 Academy modules',
    metric: 'academyModuleCount',
    target: 20,
    shareTemplate: 'Just completed 20 Academy modules on APEX. Going deep.',
  },
  {
    id: 'academy-course-complete',
    icon: '🎓',
    name: 'Course Graduate',
    description: 'Complete every module in an Academy course',
    metric: 'completedCourseCount',
    target: 1,
    shareTemplate: 'Just finished an entire Academy course on APEX. Graduated.',
  },
  {
    id: 'academy-blueprint-master',
    icon: '⚡',
    name: 'Blueprint Master',
    description: 'Complete all 5 APEX Blueprint modules',
    metric: 'blueprintModuleCount',
    target: 5,
    shareTemplate: 'Just completed the full personalised APEX Blueprint. Built different.',
  },
  {
    id: 'academy-all-complete',
    icon: '🧠',
    name: 'APEX Scholar',
    description: 'Complete all 4 Academy courses',
    metric: 'completedCourseCount',
    target: 4,
    shareTemplate: 'Just completed the entire APEX Academy. All knowledge unlocked. #APEXScholar',
  },
];

function getCurrentValue(stats: AchievementStats, metric: AchievementMetric) {
  return stats[metric];
}

function getMetricSuffix(metric: AchievementMetric) {
  switch (metric) {
    case 'level':
      return 'levels';
    case 'mealCount':
      return 'meals';
    case 'photoScanCount':
      return 'scans';
    case 'streak':
      return 'days';
    case 'workoutCount':
      return 'workouts';
    case 'walkCount':
      return 'walks';
    case 'totalWalkDistanceKm':
      return 'km';
    case 'academyModuleCount':
      return 'modules';
    case 'blueprintModuleCount':
      return 'modules';
    case 'completedCourseCount':
      return 'courses';
    default:
      return '';
  }
}

export function getAchievementShareMessage(achievement: UserAchievement) {
  return `${achievement.icon} ${achievement.shareTemplate} ${achievement.description}. #APEX #Fitness`;
}

export function getUserAchievements(stats: AchievementStats): UserAchievement[] {
  return DEFINITIONS.map((definition) => {
    const current = getCurrentValue(stats, definition.metric);
    const earned = current >= definition.target;
    const clampedCurrent = Math.min(current, definition.target);

    return {
      ...definition,
      current,
      earned,
      progressLabel: earned
        ? 'Unlocked'
        : `${clampedCurrent} / ${definition.target} ${getMetricSuffix(definition.metric)}`,
    };
  });
}
