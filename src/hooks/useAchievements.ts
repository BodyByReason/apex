import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { useGamification } from '@/contexts/GamificationContext';
import {
  FOOD_CAMERA_SCAN_STORAGE_KEY,
  getUserAchievements,
  type AchievementStats,
} from '@/lib/achievements';
import { getCompletedWalks } from '@/lib/walkRecords';
import { supabase } from '@/lib/supabase';

function computeWorkoutStreak(workoutDates: Array<string | null | undefined>) {
  const uniqueDates = [...new Set(workoutDates.map((value) => value?.slice(0, 10)).filter(Boolean))];
  if (!uniqueDates.length) return 0;

  let streak = 0;
  const today = new Date();

  for (let i = 0; i < uniqueDates.length; i += 1) {
    const expected = new Date(today);
    expected.setDate(today.getDate() - i);

    if (uniqueDates[i] === expected.toISOString().slice(0, 10)) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
}

export function useAchievements() {
  const { session } = useAuth();
  const { level, xp } = useGamification();
  const [loading, setLoading] = useState(true);
  const [mealCount, setMealCount] = useState(0);
  const [photoScanCount, setPhotoScanCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [workoutCount, setWorkoutCount] = useState(0);
  const [walkCount, setWalkCount] = useState(0);
  const [totalWalkDistanceKm, setTotalWalkDistanceKm] = useState(0);
  const [academyModuleCount, setAcademyModuleCount] = useState(0);
  const [blueprintModuleCount, setBlueprintModuleCount] = useState(0);
  const [completedCourseCount, setCompletedCourseCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      if (!session?.user?.id) {
        setMealCount(0);
        setPhotoScanCount(0);
        setStreak(0);
        setWorkoutCount(0);
        setWalkCount(0);
        setTotalWalkDistanceKm(0);
        setAcademyModuleCount(0);
        setBlueprintModuleCount(0);
        setCompletedCourseCount(0);
        setLoading(false);
        return;
      }

      const [workoutCountResult, workoutDatesResult, mealCountResult, photoScanCountValue, walkHistory] = await Promise.all([
        supabase
          .from('workouts')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', session.user.id),
        supabase
          .from('workouts')
          .select('workout_date')
          .eq('user_id', session.user.id)
          .order('workout_date', { ascending: false })
          .limit(120),
        supabase
          .from('nutrition_entries')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', session.user.id),
        AsyncStorage.getItem(FOOD_CAMERA_SCAN_STORAGE_KEY),
        getCompletedWalks(),
      ]);

      setWorkoutCount(workoutCountResult.count ?? 0);
      setMealCount(mealCountResult.count ?? 0);
      setPhotoScanCount(Number(photoScanCountValue ?? 0));
      setStreak(computeWorkoutStreak((workoutDatesResult.data ?? []).map((item) => item.workout_date)));
      setWalkCount(walkHistory.length);
      setTotalWalkDistanceKm(walkHistory.reduce((s, w) => s + w.distanceKm, 0));

      // Academy progress — stored locally in AsyncStorage
      const [completedRaw, completedCoursesRaw, blueprintRaw] = await Promise.all([
        AsyncStorage.getItem('apex.academy.completed').catch(() => null),
        AsyncStorage.getItem('apex.academy.completedCourses').catch(() => null),
        AsyncStorage.getItem('apex.academy.blueprintDone').catch(() => null),
      ]);
      const completedIds: string[] = completedRaw ? JSON.parse(completedRaw) : [];
      const completedCourses: string[] = completedCoursesRaw ? JSON.parse(completedCoursesRaw) : [];
      setAcademyModuleCount(completedIds.length);
      setCompletedCourseCount(completedCourses.length);
      setBlueprintModuleCount(Number(blueprintRaw ?? 0));

      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [session?.user?.id]);

  const stats = useMemo<AchievementStats>(
    () => ({
      level,
      mealCount,
      photoScanCount,
      streak,
      workoutCount,
      xp,
      walkCount,
      totalWalkDistanceKm,
      academyModuleCount,
      blueprintModuleCount,
      completedCourseCount,
    }),
    [level, mealCount, photoScanCount, streak, workoutCount, xp, walkCount, totalWalkDistanceKm, academyModuleCount, blueprintModuleCount, completedCourseCount],
  );

  const achievements = useMemo(() => getUserAchievements(stats), [stats]);

  return {
    achievements,
    loading,
    stats,
  };
}
