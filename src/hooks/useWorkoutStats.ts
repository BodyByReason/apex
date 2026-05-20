import { useCallback } from 'react';

import { supabase } from '@/lib/supabase';

export function useWorkoutStats() {
  const getWorkoutCount = useCallback(async (userId: string, since?: string) => {
    let query = supabase
      .from('workouts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (since) {
      query = query.gte('workout_date', since);
    }

    const { count } = await query;
    return count ?? 0;
  }, []);

  const getWorkoutStreak = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('workouts')
      .select('workout_date')
      .eq('user_id', userId)
      .order('workout_date', { ascending: false })
      .limit(60);

    if (!data?.length) return 0;

    const dates = [...new Set(data.map((workout) => workout.workout_date?.slice(0, 10)).filter(Boolean))];
    let streak = 0;
    const today = new Date();

    for (let i = 0; i < dates.length; i += 1) {
      const expected = new Date(today);
      expected.setDate(today.getDate() - i);

      if (dates[i] === expected.toISOString().slice(0, 10)) {
        streak += 1;
      } else {
        break;
      }
    }

    return streak;
  }, []);

  return { getWorkoutCount, getWorkoutStreak };
}
