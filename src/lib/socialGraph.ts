/**
 * socialGraph.ts
 *
 * Types and AsyncStorage helpers for the APEX social graph:
 *   - Friend requests (send / accept / decline)
 *   - Friends list
 *   - Private messages (per-conversation threads)
 *   - Privacy settings (who can message / friend-request you)
 *
 * All data is stored locally; a real backend would sync via Supabase.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Keys ────────────────────────────────────────────────────────────────────

const FRIENDS_KEY         = 'apex.social.friends';
const REQUESTS_KEY        = 'apex.social.friendRequests';
const CONVERSATIONS_KEY   = 'apex.social.conversations';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PrivacySetting = 'everyone' | 'friends' | 'nobody';

/** Stored as part of UserProfile in GoalSetupScreen */
export type PrivacyPrefs = {
  /** Who can send this user a private message */
  allowMessages?: PrivacySetting;
  /** Who can send this user a friend request */
  allowFriendRequests?: PrivacySetting;
};

export type Friend = {
  id: string;
  name: string;
  initials: string;
  addedAt: string;
};

export type FriendRequest = {
  id: string;
  fromId: string;
  fromName: string;
  fromInitials: string;
  sentAt: string;
  status: 'pending' | 'accepted' | 'declined';
};

export type DirectMessage = {
  id: string;
  fromName: string;
  fromInitials: string;
  body: string;
  sentAt: string;
  read: boolean;
};

export type Conversation = {
  /** The other user's display name (used as key) */
  withName: string;
  withInitials: string;
  messages: DirectMessage[];
};

// ─── Mock public profile data for seeded community members ───────────────────

export type PublicProfile = {
  name: string;
  initials: string;
  streak: number;
  totalWorkouts: number;
  xp: number;
  badges: Array<{ icon: string; name: string }>;
  title?: string;
  goal: string;
};

/** Seeded public profiles for the recurring community characters */
export const MOCK_PROFILES: Record<string, PublicProfile> = {
  MT: { name: 'Marcus T.', initials: 'MT', streak: 28, totalWorkouts: 94, xp: 4820, goal: 'Build Muscle', title: 'Iron Consistent', badges: [{ icon: '🏆', name: '30-Day Streak' }, { icon: '💪', name: 'Strength Elite' }, { icon: '🔥', name: 'Calorie Burner' }] },
  AR: { name: 'Ashley R.', initials: 'AR', streak: 14, totalWorkouts: 61, xp: 2990, goal: 'Fat Loss', title: 'Fat Burner', badges: [{ icon: '⚡', name: 'Step Champion' }, { icon: '🥗', name: 'Nutrition Pro' }] },
  JD: { name: 'Jake D.', initials: 'JD', streak: 42, totalWorkouts: 130, xp: 7310, goal: 'Recomp', title: 'Elite Performer', badges: [{ icon: '🥇', name: 'Top 1%' }, { icon: '💧', name: 'Hydration Hero' }, { icon: '🧬', name: 'Macro Master' }] },
  SK: { name: 'Sara K.', initials: 'SK', streak: 7, totalWorkouts: 38, xp: 1750, goal: 'Body Recomp', title: 'Rising Star', badges: [{ icon: '🌟', name: 'Newcomer Star' }, { icon: '🥩', name: 'Protein Champ' }] },
  JR: { name: 'Jake R.', initials: 'JR', streak: 19, totalWorkouts: 72, xp: 3440, goal: 'Performance', title: 'Hydration Hero', badges: [{ icon: '💧', name: 'Hydration Hero' }, { icon: '⚡', name: 'Step Champion' }] },
};

/** Look up a public profile by name or initials. Returns null for "You" or unknown users. */
export function lookupProfile(name: string, initials: string): PublicProfile | null {
  // Try by initials first
  if (MOCK_PROFILES[initials]) return MOCK_PROFILES[initials];
  // Try by name
  const byName = Object.values(MOCK_PROFILES).find((p) => p.name === name);
  if (byName) return byName;
  // Unknown external user — build a generic profile
  if (!name || name === 'You' || name.endsWith('(You)')) return null;
  return {
    name,
    initials,
    streak: 0,
    totalWorkouts: 0,
    xp: 0,
    goal: 'Fitness',
    badges: [],
  };
}

// ─── Friend helpers ───────────────────────────────────────────────────────────

export async function getFriends(): Promise<Friend[]> {
  const raw = await AsyncStorage.getItem(FRIENDS_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as Friend[]) : [];
}

export async function addFriend(friend: Omit<Friend, 'id' | 'addedAt'>): Promise<void> {
  const friends = await getFriends();
  if (friends.some((f) => f.name === friend.name)) return; // already friends
  const updated = [...friends, { ...friend, id: `fr-${Date.now()}`, addedAt: new Date().toISOString() }];
  await AsyncStorage.setItem(FRIENDS_KEY, JSON.stringify(updated));
}

export async function isFriend(name: string): Promise<boolean> {
  const friends = await getFriends();
  return friends.some((f) => f.name === name);
}

// ─── Friend request helpers ───────────────────────────────────────────────────

export async function getFriendRequests(): Promise<FriendRequest[]> {
  const raw = await AsyncStorage.getItem(REQUESTS_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as FriendRequest[]) : [];
}

export async function sendFriendRequest(to: { name: string; initials: string }): Promise<void> {
  const requests = await getFriendRequests();
  const exists = requests.some((r) => r.fromName === to.name && r.status === 'pending');
  if (exists) return;
  const updated = [...requests, {
    id: `req-${Date.now()}`,
    fromId: `user-${Date.now()}`,
    fromName: to.name,
    fromInitials: to.initials,
    sentAt: new Date().toISOString(),
    status: 'pending' as const,
  }];
  await AsyncStorage.setItem(REQUESTS_KEY, JSON.stringify(updated));
}

export async function hasPendingRequest(name: string): Promise<boolean> {
  const requests = await getFriendRequests();
  return requests.some((r) => r.fromName === name && r.status === 'pending');
}

// ─── Conversation / DM helpers ────────────────────────────────────────────────

export async function getConversations(): Promise<Conversation[]> {
  const raw = await AsyncStorage.getItem(CONVERSATIONS_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as Conversation[]) : [];
}

export async function sendDirectMessage(to: { name: string; initials: string }, body: string): Promise<void> {
  const convos = await getConversations();
  const idx = convos.findIndex((c) => c.withName === to.name);
  const msg: DirectMessage = {
    id: `dm-${Date.now()}`,
    fromName: 'Me',
    fromInitials: 'ME',
    body,
    sentAt: new Date().toISOString(),
    read: true,
  };
  if (idx >= 0) {
    convos[idx].messages.push(msg);
  } else {
    convos.push({ withName: to.name, withInitials: to.initials, messages: [msg] });
  }
  await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convos));
}

export async function getConversation(name: string): Promise<Conversation | null> {
  const convos = await getConversations();
  return convos.find((c) => c.withName === name) ?? null;
}
