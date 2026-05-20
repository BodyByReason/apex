/**
 * Walk Location Background Task
 *
 * Registered with TaskManager so iOS/Android can deliver GPS points even when
 * the screen is locked or the app is backgrounded. Points are written to
 * AsyncStorage and polled by WalkTrackerScreen while the UI is visible.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';

export const WALK_LOCATION_TASK = 'apex.walkLocationTask';
export const WALK_LIVE_POINTS_KEY = 'apex.walkTracker.livePoints';

type Point = { latitude: number; longitude: number };

TaskManager.defineTask(WALK_LOCATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Array<{ coords: Point }> }>) => {
  if (error) {
    console.warn('[WalkTask] location error:', error.message);
    return;
  }

  const locations = (data as any)?.locations as Array<{ coords: Point }> | undefined;
  if (!locations?.length) return;

  try {
    const raw = await AsyncStorage.getItem(WALK_LIVE_POINTS_KEY);
    const points: Point[] = raw ? (JSON.parse(raw) as Point[]) : [];

    for (const loc of locations) {
      points.push({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    }

    await AsyncStorage.setItem(WALK_LIVE_POINTS_KEY, JSON.stringify(points));
  } catch (e) {
    console.warn('[WalkTask] failed to save points:', e);
  }
});
