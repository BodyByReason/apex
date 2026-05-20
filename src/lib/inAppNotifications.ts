/**
 * In-app notification log.
 *
 * Notifications are written when:
 *  - An achievement is newly earned (detected on ProfileScreen mount)
 *  - A streak milestone is crossed for the first time
 *
 * All entries are stored in AsyncStorage and shown in the Profile
 * "Recent Notifications" section. Capped at 50 entries.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIF_KEY = 'apex.inapp.notifications.v1';
const SEEN_ACHIEVEMENTS_KEY = 'apex.inapp.seenAchievements';
const SEEN_STREAK_KEY = 'apex.inapp.seenStreakMilestones';

export type AppNotification = {
  id: string;
  icon: string;
  text: string;
  createdAt: number;
  read: boolean;
};

// ─── Core CRUD ────────────────────────────────────────────────────────────────

export async function getInAppNotifications(): Promise<AppNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as AppNotification[]).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  } catch {
    return [];
  }
}

export async function appendInAppNotification(
  n: Omit<AppNotification, 'id'>,
): Promise<void> {
  const existing = await getInAppNotifications();
  const next: AppNotification[] = [
    {
      ...n,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    },
    ...existing,
  ].slice(0, 50);
  await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));
}

export async function markAllInAppRead(): Promise<void> {
  const existing = await getInAppNotifications();
  const next = existing.map((n) => ({ ...n, read: true }));
  await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));
}

// ─── Achievement detection ────────────────────────────────────────────────────

async function getSeenAchievementIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_ACHIEVEMENTS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Call on ProfileScreen mount with the earned achievements list.
 * Newly-earned achievements (not yet seen) get a notification written.
 * Returns the count of new notifications added.
 */
export async function syncAchievementNotifications(
  earnedAchievements: Array<{ id: string; icon: string; name: string; description: string }>,
): Promise<number> {
  const seen = await getSeenAchievementIds();
  const newlyEarned = earnedAchievements.filter((a) => !seen.has(a.id));
  if (!newlyEarned.length) return 0;

  for (const a of newlyEarned) {
    await appendInAppNotification({
      icon: a.icon,
      text: `You unlocked "${a.name}" - ${a.description}`,
      createdAt: Date.now(),
      read: false,
    });
  }

  const merged = [...new Set([...seen, ...newlyEarned.map((a) => a.id)])];
  await AsyncStorage.setItem(SEEN_ACHIEVEMENTS_KEY, JSON.stringify(merged));
  return newlyEarned.length;
}

// ─── Streak milestone detection ───────────────────────────────────────────────

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

async function getSeenStreakMilestones(): Promise<Set<number>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_STREAK_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

/**
 * Call on ProfileScreen mount with the current streak count.
 * Fires a notification the first time each milestone is crossed.
 */
export async function syncStreakNotifications(streak: number): Promise<void> {
  if (streak < 3) return;
  const seen = await getSeenStreakMilestones();
  const hit = STREAK_MILESTONES.filter((m) => streak >= m && !seen.has(m));
  if (!hit.length) return;

  const top = Math.max(...hit);
  await appendInAppNotification({
    icon: '🔥',
    text: `${top}-day workout streak unlocked! Keep the momentum going.`,
    createdAt: Date.now(),
    read: false,
  });

  const merged = [...new Set([...seen, ...hit])];
  await AsyncStorage.setItem(SEEN_STREAK_KEY, JSON.stringify(merged));
}
