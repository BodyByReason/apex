/**
 * Earnable titles — shown in the identity card next to the streak badge.
 * Titles are unlocked by hitting stat thresholds (workouts, streak, meals,
 * level). The user can pick any title they've earned to display on their
 * profile and on the leaderboard.
 */

import type { AchievementStats } from '@/lib/achievements';

export type TitleDefinition = {
  id: string;
  icon: string;
  label: string;
  description: string;
  /** All thresholds must be met for the title to unlock */
  minWorkouts?: number;
  minStreak?: number;
  minMeals?: number;
  minLevel?: number;
  minWalks?: number;
  minWalkDistanceKm?: number;
  /** Academy-based thresholds */
  minAcademyModules?: number;
  minBlueprintModules?: number;
  minCompletedCourses?: number;
};

export const TITLE_DEFINITIONS: TitleDefinition[] = [
  {
    id: 'rookie',
    icon: '🌱',
    label: 'Rookie',
    description: 'Welcome to APEX',
    minWorkouts: 0,
  },
  {
    id: 'grinder',
    icon: '⚡',
    label: 'Grinder',
    description: 'Log 10 workouts',
    minWorkouts: 10,
  },
  {
    id: 'iron',
    icon: '🔩',
    label: 'Iron',
    description: 'Log 25 workouts',
    minWorkouts: 25,
  },
  {
    id: 'elite',
    icon: '🏆',
    label: 'Elite',
    description: 'Log 50 workouts',
    minWorkouts: 50,
  },
  {
    id: 'legend',
    icon: '💀',
    label: 'Legend',
    description: 'Log 100 workouts',
    minWorkouts: 100,
  },
  {
    id: 'on-fire',
    icon: '🔥',
    label: 'On Fire',
    description: '7-day workout streak',
    minStreak: 7,
  },
  {
    id: 'unstoppable',
    icon: '💥',
    label: 'Unstoppable',
    description: '30-day workout streak',
    minStreak: 30,
  },
  {
    id: 'fueled',
    icon: '🥗',
    label: 'Fueled',
    description: 'Log 25 meals',
    minMeals: 25,
  },
  {
    id: 'apex-level',
    icon: '🧬',
    label: 'APEX',
    description: 'Reach Level 10',
    minLevel: 10,
  },
  {
    id: 'pavement-pounder',
    icon: '👟',
    label: 'Pavement Pounder',
    description: 'Complete 5 walks',
    minWalks: 5,
  },
  {
    id: 'road-runner',
    icon: '🏃',
    label: 'Road Runner',
    description: 'Walk 20 km total',
    minWalkDistanceKm: 20,
  },

  // ── Academy titles ────────────────────────────────────────────────────────
  {
    id: 'scholar',
    icon: '📖',
    label: 'Scholar',
    description: 'Complete your first Academy module',
    minAcademyModules: 1,
  },
  {
    id: 'knowledge-seeker',
    icon: '📚',
    label: 'Knowledge Seeker',
    description: 'Complete 5 Academy modules',
    minAcademyModules: 5,
  },
  {
    id: 'dedicated-student',
    icon: '🏫',
    label: 'Dedicated Student',
    description: 'Complete 10 Academy modules',
    minAcademyModules: 10,
  },
  {
    id: 'deep-diver',
    icon: '🔭',
    label: 'Deep Diver',
    description: 'Complete 20 Academy modules',
    minAcademyModules: 20,
  },
  {
    id: 'graduate',
    icon: '🎓',
    label: 'Graduate',
    description: 'Complete every module in any Academy course',
    minCompletedCourses: 1,
  },
  {
    id: 'blueprint-master',
    icon: '⚡',
    label: 'Blueprint Master',
    description: 'Complete all APEX Blueprint modules',
    minBlueprintModules: 5,
  },
  {
    id: 'apex-scholar',
    icon: '🧠',
    label: 'APEX Scholar',
    description: 'Complete all 4 Academy courses',
    minCompletedCourses: 4,
  },
];

/** Returns all titles the user has unlocked based on their current stats */
export function getEarnedTitles(
  stats: Pick<AchievementStats, 'workoutCount' | 'streak' | 'mealCount' | 'level' | 'walkCount' | 'totalWalkDistanceKm' | 'academyModuleCount' | 'blueprintModuleCount' | 'completedCourseCount'>,
): TitleDefinition[] {
  return TITLE_DEFINITIONS.filter((t) => {
    if (t.minWorkouts !== undefined && stats.workoutCount < t.minWorkouts) return false;
    if (t.minStreak !== undefined && stats.streak < t.minStreak) return false;
    if (t.minMeals !== undefined && stats.mealCount < t.minMeals) return false;
    if (t.minLevel !== undefined && stats.level < t.minLevel) return false;
    if (t.minWalks !== undefined && stats.walkCount < t.minWalks) return false;
    if (t.minWalkDistanceKm !== undefined && stats.totalWalkDistanceKm < t.minWalkDistanceKm) return false;
    if (t.minAcademyModules !== undefined && stats.academyModuleCount < t.minAcademyModules) return false;
    if (t.minBlueprintModules !== undefined && stats.blueprintModuleCount < t.minBlueprintModules) return false;
    if (t.minCompletedCourses !== undefined && stats.completedCourseCount < t.minCompletedCourses) return false;
    return true;
  });
}

/** Return the title definition for a stored ID, falling back to Rookie */
export function getTitleById(id: string | undefined): TitleDefinition {
  return TITLE_DEFINITIONS.find((t) => t.id === id) ?? TITLE_DEFINITIONS[0];
}
