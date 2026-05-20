import AsyncStorage from '@react-native-async-storage/async-storage';

import type { UserAchievement } from '@/lib/achievements';
import type { ThemeId } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabase';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';

const TRIBE_FEED_STORAGE_KEY = 'apex.tribe.customPosts';
const TRIBE_COMMENT_STORAGE_KEY = 'apex.tribe.comments';

export type TribeFeedPost = {
  author: string;
  authorAvatarUrl?: string;
  authorCoachBio?: string;
  authorIsCoach?: boolean;
  authorThemeId?: ThemeId;
  authorTitle?: string;
  badge: string;
  badgeType: 'pr' | 'q' | 'tip' | 'win';
  body: string;
  comments: number;
  createdAt: number;
  id: string;
  likes: number;
  time: string;
  videoUrl?: string;
};

export type TribeComment = {
  author: string;
  authorAvatarUrl?: string;
  authorIsCoach?: boolean;
  authorThemeId?: ThemeId;
  authorTitle?: string;
  body: string;
  createdAt: number;
  id: string;
  postId: string;
};

type TribePostRow = {
  badge_type: TribeFeedPost['badgeType'];
  content: string;
  created_at: string;
  id: string;
  like_count?: number | null;
  user_id: string;
  video_url?: string | null;
};

type TribeCommentRow = {
  content: string;
  created_at: string;
  id: string;
  post_id: string;
  user_id: string;
};

type ProfileRow = {
  avatar_url?: string | null;
  coach_bio?: string | null;
  display_name?: string | null;
  is_coach?: boolean | null;
  selected_title?: string | null;
  theme_id?: ThemeId | null;
  user_id: string;
  username?: string | null;
};

function toPublicProfile(userId: string, profile?: UserProfile | null): ProfileRow | null {
  if (!profile) return null;
  return {
    avatar_url: profile.avatarUrl ?? null,
    coach_bio: profile.coachBio ?? null,
    display_name: profile.displayName ?? null,
    is_coach: profile.isCoach ?? null,
    selected_title: profile.selectedTitle ?? null,
    theme_id: profile.themeId ?? null,
    user_id: userId,
    username: profile.username ?? null,
  };
}

function mergeProfile(primary?: ProfileRow | null, fallback?: ProfileRow | null): ProfileRow | undefined {
  if (!primary && !fallback) return undefined;
  return {
    avatar_url: primary?.avatar_url ?? fallback?.avatar_url ?? null,
    coach_bio: primary?.coach_bio ?? fallback?.coach_bio ?? null,
    display_name: primary?.display_name ?? fallback?.display_name ?? null,
    is_coach: primary?.is_coach ?? fallback?.is_coach ?? null,
    selected_title: primary?.selected_title ?? fallback?.selected_title ?? null,
    theme_id: primary?.theme_id ?? fallback?.theme_id ?? null,
    user_id: primary?.user_id ?? fallback?.user_id ?? '',
    username: primary?.username ?? fallback?.username ?? null,
  };
}

const BADGE_LABEL: Record<TribeFeedPost['badgeType'], string> = {
  pr: 'PR',
  q: 'Q&A',
  tip: 'TIP',
  win: 'WIN',
};

function buildPublicAuthor(profile?: ProfileRow | null, fallback?: string) {
  return (
    profile?.display_name?.trim() ||
    profile?.username?.trim() ||
    fallback?.trim() ||
    'Athlete'
  );
}

export function formatRelativeTime(createdAt: number | string | Date) {
  const ts =
    typeof createdAt === 'number'
      ? createdAt
      : createdAt instanceof Date
        ? createdAt.getTime()
        : Date.parse(createdAt);

  const diffMs = Date.now() - ts;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return diffMinutes === 1 ? '1 min ago' : `${diffMinutes} mins ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;

  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`;
}

async function savePostsLocal(posts: TribeFeedPost[]) {
  await AsyncStorage.setItem(TRIBE_FEED_STORAGE_KEY, JSON.stringify(posts.slice(0, 50)));
}

async function getCommentMapLocal() {
  const raw = await AsyncStorage.getItem(TRIBE_COMMENT_STORAGE_KEY);
  if (!raw) return {} as Record<string, TribeComment[]>;
  try {
    return JSON.parse(raw) as Record<string, TribeComment[]>;
  } catch {
    return {} as Record<string, TribeComment[]>;
  }
}

async function saveCommentMapLocal(map: Record<string, TribeComment[]>) {
  await AsyncStorage.setItem(TRIBE_COMMENT_STORAGE_KEY, JSON.stringify(map));
}

async function getStoredTribeFeedPostsLocal() {
  const raw = await AsyncStorage.getItem(TRIBE_FEED_STORAGE_KEY);
  if (!raw) return [] as TribeFeedPost[];
  try {
    const parsed = JSON.parse(raw) as TribeFeedPost[];
    return parsed.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [] as TribeFeedPost[];
  }
}

async function fetchProfiles(userIds: string[]) {
  if (!userIds.length) return new Map<string, ProfileRow>();

  const { data, error } = await supabase.rpc('get_public_profiles', {
    target_user_ids: userIds,
  });

  if (error || !data) {
    return new Map<string, ProfileRow>();
  }

  return new Map((data as ProfileRow[]).map((row) => [row.user_id, row]));
}

function mapPostRow(row: TribePostRow, profiles: Map<string, ProfileRow>, commentCount = 0): TribeFeedPost {
  const profile = profiles.get(row.user_id);
  const author = buildPublicAuthor(profile);
  const createdAt = Date.parse(row.created_at);

  return {
    author,
    authorAvatarUrl: profile?.avatar_url ?? undefined,
    authorCoachBio: profile?.coach_bio ?? undefined,
    authorIsCoach: profile?.is_coach ?? false,
    authorThemeId: profile?.theme_id ?? undefined,
    authorTitle: profile?.selected_title ?? undefined,
    badge: BADGE_LABEL[row.badge_type],
    badgeType: row.badge_type,
    body: row.content,
    comments: commentCount,
    createdAt,
    id: row.id,
    likes: row.like_count ?? 0,
    time: formatRelativeTime(createdAt),
    videoUrl: row.video_url ?? undefined,
  };
}

async function getCommentCounts(postIds: string[]) {
  if (!postIds.length) return new Map<string, number>();

  const { data, error } = await supabase
    .from('tribe_comments')
    .select('post_id')
    .in('post_id', postIds);

  if (error || !data) {
    return new Map<string, number>();
  }

  const counts = new Map<string, number>();
  (data as Array<{ post_id: string }>).forEach(({ post_id }) => {
    counts.set(post_id, (counts.get(post_id) ?? 0) + 1);
  });
  return counts;
}

async function getCurrentUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

async function getCurrentUserProfileFallback() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { profile: null as ProfileRow | null, userId: null as string | null };
  }

  const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY).catch(() => null);
  if (!raw) {
    return { profile: null as ProfileRow | null, userId };
  }

  try {
    const parsed = JSON.parse(raw) as UserProfile;
    return { profile: toPublicProfile(userId, parsed), userId };
  } catch {
    return { profile: null as ProfileRow | null, userId };
  }
}

export async function getStoredTribeFeedPosts() {
  try {
    const { data, error } = await supabase
      .from('tribe_posts')
      .select('id, user_id, badge_type, content, like_count, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data) {
      return await getStoredTribeFeedPostsLocal();
    }

    const rows = data as TribePostRow[];
    const [{ profile: currentUserProfile, userId: currentUserId }, profiles, commentCounts] = await Promise.all([
      getCurrentUserProfileFallback(),
      fetchProfiles(rows.map((row) => row.user_id)),
      getCommentCounts(rows.map((row) => row.id)),
    ]);

    const posts = rows.map((row) => {
      if (currentUserId && row.user_id === currentUserId) {
        const merged = mergeProfile(profiles.get(row.user_id), currentUserProfile);
        const nextProfiles = new Map(profiles);
        if (merged) {
          nextProfiles.set(row.user_id, merged);
        }
        return mapPostRow(row, nextProfiles, commentCounts.get(row.id) ?? 0);
      }
      return mapPostRow(row, profiles, commentCounts.get(row.id) ?? 0);
    });
    await savePostsLocal(posts).catch(() => null);
    return posts;
  } catch {
    return await getStoredTribeFeedPostsLocal();
  }
}

export async function addAchievementPostToFeed({
  achievement,
  author,
}: {
  achievement: UserAchievement;
  author: string;
}) {
  return addTextPostToFeed({
    author,
    badgeType: 'win',
    body: `${achievement.icon} Just unlocked ${achievement.name} on APEX — ${achievement.description}.`,
  });
}

export async function addTextPostToFeed({
  author,
  body,
  badgeType = 'win',
  videoUrl,
}: {
  author: string;
  body: string;
  badgeType?: TribeFeedPost['badgeType'];
  videoUrl?: string;
}) {
  const userId = await getCurrentUserId();
  const createdAt = Date.now();

  const fallbackPost: TribeFeedPost = {
    author,
    badge: BADGE_LABEL[badgeType],
    badgeType,
    body,
    comments: 0,
    createdAt,
    id: `post-${createdAt}`,
    likes: 0,
    time: formatRelativeTime(createdAt),
    videoUrl,
  };

  if (!userId) {
    const posts = await getStoredTribeFeedPostsLocal();
    await savePostsLocal([fallbackPost, ...posts]);
    return fallbackPost;
  }

  try {
    const { data, error } = await supabase
      .from('tribe_posts')
      .insert({
        badge_type: badgeType,
        content: body,
        user_id: userId,
        video_url: videoUrl ?? null,
      })
      .select('id, user_id, badge_type, content, like_count, created_at')
      .single();

    if (error || !data) {
      throw error ?? new Error('Could not create tribe post');
    }

    const profiles = await fetchProfiles([userId]);
    const post = mapPostRow(data as TribePostRow, profiles, 0);
    const latest = await getStoredTribeFeedPosts();
    await savePostsLocal(latest).catch(() => null);
    return post;
  } catch {
    const posts = await getStoredTribeFeedPostsLocal();
    await savePostsLocal([fallbackPost, ...posts]);
    return fallbackPost;
  }
}

/**
 * Fetches the author profile for a single raw post row and returns a
 * fully-hydrated TribeFeedPost. Used by the realtime subscription so
 * incoming INSERT payloads can be displayed immediately without a
 * full feed reload.
 */
export async function hydrateRealtimePost(row: {
  id: string;
  user_id: string;
  badge_type: string;
  content: string;
  like_count?: number | null;
  created_at: string;
}): Promise<TribeFeedPost> {
  const [{ profile: currentUserProfile, userId: currentUserId }, profiles] = await Promise.all([
    getCurrentUserProfileFallback(),
    fetchProfiles([row.user_id]),
  ]);
  if (currentUserId && row.user_id === currentUserId) {
    const merged = mergeProfile(profiles.get(row.user_id), currentUserProfile);
    if (merged) {
      profiles.set(row.user_id, merged);
    }
  }
  return mapPostRow(row as TribePostRow, profiles, 0);
}

export async function getCommentsForPost(postId: string) {
  try {
    const { data, error } = await supabase
      .from('tribe_comments')
      .select('id, post_id, user_id, content, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error || !data) {
      throw error ?? new Error('Could not load comments');
    }

    const rows = data as TribeCommentRow[];
    const [{ profile: currentUserProfile, userId: currentUserId }, profiles] = await Promise.all([
      getCurrentUserProfileFallback(),
      fetchProfiles(rows.map((row) => row.user_id)),
    ]);
    return rows.map((row) => {
      const profile = currentUserId && row.user_id === currentUserId
        ? mergeProfile(profiles.get(row.user_id), currentUserProfile)
        : profiles.get(row.user_id);
      return {
        author: buildPublicAuthor(profile),
        authorAvatarUrl: profile?.avatar_url ?? undefined,
        authorIsCoach: profile?.is_coach ?? false,
        authorThemeId: profile?.theme_id ?? undefined,
        authorTitle: profile?.selected_title ?? undefined,
        body: row.content,
        createdAt: Date.parse(row.created_at),
        id: row.id,
        postId: row.post_id,
      } satisfies TribeComment;
    });
  } catch {
    const map = await getCommentMapLocal();
    const comments = map[postId] ?? [];
    return comments.sort((a, b) => a.createdAt - b.createdAt);
  }
}

export async function getCommentCount(postId: string) {
  try {
    const { count, error } = await supabase
      .from('tribe_comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId);

    if (error) {
      throw error;
    }

    return count ?? 0;
  } catch {
    const comments = await getCommentsForPost(postId);
    return comments.length;
  }
}

export async function addCommentToPost({
  author,
  authorAvatarUrl,
  body,
  postId,
}: {
  author: string;
  authorAvatarUrl?: string;
  body: string;
  postId: string;
}) {
  const userId = await getCurrentUserId();
  const createdAt = Date.now();

  const fallbackComment: TribeComment = {
    author,
    authorAvatarUrl,
    body,
    createdAt,
    id: `comment-${postId}-${createdAt}`,
    postId,
  };

  if (!userId) {
    const map = await getCommentMapLocal();
    const existing = map[postId] ?? [];
    map[postId] = [...existing, fallbackComment];
    await saveCommentMapLocal(map);
    return fallbackComment;
  }

  try {
    const { data, error } = await supabase
      .from('tribe_comments')
      .insert({
        content: body,
        post_id: postId,
        user_id: userId,
      })
      .select('id, post_id, user_id, content, created_at')
      .single();

    if (error || !data) {
      throw error ?? new Error('Could not create tribe comment');
    }

    const profiles = await fetchProfiles([userId]);
    const profile = profiles.get(userId);
    return {
      author: buildPublicAuthor(profile, author),
      authorAvatarUrl: profile?.avatar_url ?? undefined,
      authorIsCoach: profile?.is_coach ?? false,
      authorThemeId: profile?.theme_id ?? undefined,
      authorTitle: profile?.selected_title ?? undefined,
      body: (data as TribeCommentRow).content,
      createdAt: Date.parse((data as TribeCommentRow).created_at),
      id: (data as TribeCommentRow).id,
      postId: (data as TribeCommentRow).post_id,
    } satisfies TribeComment;
  } catch {
    const map = await getCommentMapLocal();
    const existing = map[postId] ?? [];
    map[postId] = [...existing, fallbackComment];
    await saveCommentMapLocal(map);
    return fallbackComment;
  }
}

export async function migratePostAuthors(_oldNames: string[], _newName: string): Promise<void> {
  const oldNames = _oldNames
    .map((name) => name.trim())
    .filter((name, index, arr) => Boolean(name) && arr.indexOf(name) === index && name !== _newName);

  if (!oldNames.length) return;

  const posts = await getStoredTribeFeedPostsLocal();
  if (posts.length) {
    const nextPosts = posts.map((post) =>
      oldNames.includes(post.author)
        ? {
            ...post,
            author: _newName,
          }
        : post,
    );
    await savePostsLocal(nextPosts).catch(() => null);
  }

  const commentMap = await getCommentMapLocal();
  const nextCommentMap = Object.fromEntries(
    Object.entries(commentMap).map(([postId, comments]) => [
      postId,
      comments.map((comment) =>
        oldNames.includes(comment.author)
          ? {
              ...comment,
              author: _newName,
            }
          : comment,
      ),
    ]),
  );

  await saveCommentMapLocal(nextCommentMap).catch(() => null);
}
