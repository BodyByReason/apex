import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Audio, Video, ResizeMode } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Animated, ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { AppHeader } from '@/components/AppHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useAchievements } from '@/hooks/useAchievements';
import { useHealth } from '@/hooks/useHealth';
import { usePro } from '@/hooks/usePro';
import { getAchievementShareMessage, type UserAchievement } from '@/lib/achievements';
import { getOrComputeMacroTargets } from '@/lib/bmr';
import { env } from '@/lib/env';
import { maybeShowPaywall } from '@/lib/revenuecat';
import { loadSuggestionCycleState, type Suggestion } from '@/lib/suggestions';
import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';
import { THEMES, type ThemeId, useTheme } from '@/contexts/ThemeContext';
import { addAchievementPostToFeed, addCommentToPost, addTextPostToFeed, formatRelativeTime, getCommentCount, getCommentsForPost, getStoredTribeFeedPosts, hydrateRealtimePost, migratePostAuthors, type TribeComment, type TribeFeedPost } from '@/lib/tribeFeed';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { UserProfileModal } from '@/components/UserProfileModal';
import { SkeletonCard } from '@/components/SkeletonCard';
import { speakWithElevenLabs } from '@/lib/elevenlabs';
import { getCoachPersonaPrefix } from '@/lib/coachVoice';

const HYDRATION_KEY = (date: string) => `apex.hydration.${date}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const TRIBE_CHALLENGES_STORAGE_KEY = 'apex.tribe.joinedChallenges';
// v3 — forces regeneration: personalised actions + guaranteed quiz per module
const academyStorageKey = (courseName: string) => `apex.academy.v3.${courseName.toLowerCase().replace(/\s+/g, '-')}`;
const ACADEMY_QUIZ_RESULTS_KEY = 'apex.academy.quizResults.v1';
const challengeGroupKey = (challengeId: string) => `apex.challenge.group.${challengeId}`;

type GroupMessage = {
  id: string;
  author: string;
  authorAvatarUrl?: string;
  authorInitials: string;
  body: string;
  imageUri?: string;
  videoUri?: string;
  audioUri?: string;
  createdAt: string;
};

type Tab = 'feed' | 'leaderboard' | 'challenges' | 'academy';
type BadgeStyle = 'pr' | 'tip' | 'q' | 'win';
type LeaderboardScope = 'week' | 'month' | 'allTime';
type AcademyModule = {
  action: string;
  bullets: string[];
  id: string;
  quiz?: { correctIndex: number; options: string[]; question: string };
  shareSnippet: string;
  summary: string;
  title: string;
};

type AcademyChatMessage = {
  id: string;
  role: 'user' | 'coach';
  text: string;
};

type AcademyQuizResult = {
  answerIndex: number;
  correctIndex: number;
  answeredAt: string;
};

const USER_AVA_COLORS: Record<string, { bg: string; text: string }> = {
  MT: { bg: '#FF6B35', text: '#000' },
  AR: { bg: C.green, text: '#000' },
  SK: { bg: C.purple, text: '#fff' },
  JD: { bg: '#FFD700', text: '#000' },
  JR: { bg: C.blue, text: '#fff' },
};

function getThemeAvatarColors(themeId?: ThemeId | null, fallback?: { bg: string; text: string }) {
  const theme = THEMES.find((item) => item.id === themeId);
  if (!theme) return fallback ?? { bg: C.border, text: C.text };
  return {
    bg: theme.accentSoft,
    text: theme.accent,
  };
}

const BADGE_STYLES: Record<BadgeStyle, { bg: string; color: string; border: string }> = {
  pr: { bg: 'rgba(255,107,53,0.2)', color: C.orange, border: C.orange },
  tip: { bg: 'rgba(168,85,247,0.2)', color: C.purple, border: C.purple },
  q: { bg: C.blueSoft, color: C.blue, border: C.blue },
  win: { bg: 'rgba(0,255,135,0.12)', color: C.green, border: C.green },
};

function PostBadge({ label, type }: { label: string; type: BadgeStyle }) {
  const style = BADGE_STYLES[type];
  return (
    <View style={[styles.badge, { backgroundColor: style.bg, borderColor: style.border }]}>
      <Text style={[styles.badgeText, { color: style.color }]}>{label}</Text>
    </View>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '??';
}

function PostCard({
  author,
  badge,
  badgeType,
  body,
  comments,
  id,
  likes,
  onCommentPress,
  onAuthorPress,
  time,
  authorAvatarUrl,
  authorCoachBio,
  authorIsCoach,
  authorThemeId,
  authorTitle,
  accentColor,
  accentStrongBorder: accentStrongBorderColor,
  videoUrl,
}: {
  author: string;
  badge: string;
  badgeType: BadgeStyle;
  body: string;
  comments: number;
  id: string;
  likes: number;
  onCommentPress: (postId: string) => void;
  onAuthorPress?: (target: {
    avatarUrl?: string;
    bio?: string;
    initials: string;
    isCoach?: boolean;
    name: string;
    title?: string;
  }) => void;
  time: string;
  authorAvatarUrl?: string;
  authorCoachBio?: string;
  authorIsCoach?: boolean;
  authorThemeId?: ThemeId;
  authorTitle?: string;
  accentColor: string;
  accentStrongBorder: string;
  videoUrl?: string;
}) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(likes);
  const initials = getInitials(author);
  const avaStyle = getThemeAvatarColors(authorThemeId, USER_AVA_COLORS[initials] ?? { bg: C.border, text: C.text });

  return (
    <View style={styles.postCard}>
      <View style={styles.postHead}>
        <Pressable
          onPress={() => onAuthorPress?.({ name: author, initials, avatarUrl: authorAvatarUrl, bio: authorCoachBio, isCoach: authorIsCoach, title: authorTitle })}
          hitSlop={8}
        >
          <View style={[styles.postAva, { backgroundColor: authorAvatarUrl ? 'transparent' : avaStyle.bg }]}>
            {authorAvatarUrl ? (
              <Image source={{ uri: authorAvatarUrl }} style={styles.postAvaImage} />
            ) : (
              <Text style={[styles.postAvaText, { color: avaStyle.text }]}>{initials}</Text>
            )}
          </View>
        </Pressable>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => onAuthorPress?.({ name: author, initials, avatarUrl: authorAvatarUrl, bio: authorCoachBio, isCoach: authorIsCoach, title: authorTitle })}
        >
          <View style={styles.postAuthorRow}>
            <Text style={styles.postAuthor}>{author}</Text>
            {authorIsCoach ? (
              <View style={styles.coachChip}>
                <Text style={styles.coachChipText}>Coach</Text>
              </View>
            ) : null}
          </View>
          {authorTitle ? <Text style={styles.postAuthorTitle}>{authorTitle}</Text> : null}
          <Text style={styles.postTime}>{time}</Text>
        </Pressable>
        <PostBadge type={badgeType} label={badge} />
      </View>
      <Text style={styles.postBody}>{body}</Text>
      {videoUrl ? (
        <Video
          source={{ uri: videoUrl }}
          style={styles.postVideo}
          resizeMode={ResizeMode.COVER}
          useNativeControls
          shouldPlay={false}
        />
      ) : null}
      <View style={styles.postActions}>
        <Pressable
          style={[styles.postAction, liked ? styles.postActionLiked : null]}
          onPress={() => {
            setLiked((current) => !current);
            setLikeCount((current) => (liked ? current - 1 : current + 1));
          }}
        >
          <Text>🔥</Text>
          <Text style={liked ? { color: accentColor } : { color: C.muted }}>{likeCount}</Text>
        </Pressable>
        <Pressable style={[styles.postAction, liked ? { borderColor: accentStrongBorderColor } : null]} onPress={() => onCommentPress(id)}>
          <Text>💬</Text>
          <Text style={{ color: C.muted }}>{comments}</Text>
        </Pressable>
      </View>
    </View>
  );
}

type PostBadgeChoice = 'auto' | BadgeStyle;

const BADGE_CHOICES: Array<{ key: PostBadgeChoice; icon: string; label: string }> = [
  { icon: '🤖', key: 'auto',  label: 'AI Pick' },
  { icon: '🏆', key: 'pr',   label: 'PR'       },
  { icon: '💡', key: 'tip',  label: 'Tip'      },
  { icon: '❓', key: 'q',    label: 'Question' },
  { icon: '🏅', key: 'win',  label: 'Win'      },
];

// Ask Claude to classify the post into one of the four badge types
async function classifyPost(text: string): Promise<BadgeStyle> {
  try {
    const { data } = await supabase.functions.invoke('anthropic', {
      body: {
        max_tokens: 10,
        model: 'claude-haiku-4-5-20251001',
        messages: [{
          role: 'user',
          content: `Classify this fitness community post into exactly one category.
Reply with ONLY the single word: pr, tip, q, or win.
- pr = personal record or achievement milestone
- tip = advice, technique, or knowledge
- q = question or asking for help
- win = general positive update or progress

Post: "${text}"`,
        }],
      },
    });
    const raw = (data?.content as Array<{ text?: string }>)?.[0]?.text?.trim().toLowerCase() ?? '';
    if (['pr','tip','q','win'].includes(raw)) return raw as BadgeStyle;
  } catch { /* fall through to default */ }
  return 'win';
}

function PostModal({
  author,
  onClose,
  onPosted,
  visible,
}: {
  author: string;
  onClose: () => void;
  onPosted: () => void;
  visible: boolean;
}) {
  const { isPro } = usePro();
  const { accent, accentSoft } = useTheme();
  const [text, setText] = useState('');
  const [badgeChoice, setBadgeChoice] = useState<PostBadgeChoice>('auto');
  const [submitting, setSubmitting] = useState(false);

  const handlePost = async () => {
    if (!text.trim() || submitting) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      // Resolve badge type — AI classify (Pro only) or use user's manual choice
      const resolvedBadge: BadgeStyle = (badgeChoice === 'auto' && isPro)
        ? await classifyPost(text.trim())
        : badgeChoice === 'auto'
          ? 'win'   // free user kept default — treat as generic Win
          : badgeChoice;

      await addTextPostToFeed({ author, body: text.trim(), badgeType: resolvedBadge });
    } catch { /* silently continue */ } finally {
      setSubmitting(false);
      setText('');
      setBadgeChoice('auto');
      onPosted();
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={24}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modal}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>SHARE WITH THE TRIBE</Text>

          {/* Badge type selector */}
          <Text style={styles.formLabel}>Post Type</Text>
          <View style={styles.badgeChooser}>
            {BADGE_CHOICES.map((opt) => {
              const isActive = badgeChoice === opt.key;
              const bStyle = opt.key !== 'auto' ? BADGE_STYLES[opt.key as BadgeStyle] : null;
              const isAiLocked = opt.key === 'auto' && !isPro;
              return (
                <Pressable
                  key={opt.key}
                  style={[
                    styles.badgeChip,
                    isActive && opt.key === 'win' ? { borderColor: accent, backgroundColor: accentSoft } : null,
                    isActive && bStyle && opt.key !== 'win' ? { borderColor: bStyle.border, backgroundColor: bStyle.bg } : null,
                    isActive && opt.key === 'auto' ? { borderColor: accent, backgroundColor: accentSoft } : null,
                    isAiLocked ? { opacity: 0.6 } : null,
                  ]}
                  onPress={async () => {
                    await Haptics.selectionAsync();
                    if (isAiLocked) {
                      await maybeShowPaywall().catch(() => null);
                      return;
                    }
                    setBadgeChoice(opt.key);
                  }}
                >
                  <Text style={styles.badgeChipIcon}>{isAiLocked ? '🔒' : opt.icon}</Text>
                  <Text style={[
                    styles.badgeChipLabel,
                    isActive && opt.key === 'win' ? { color: accent } : null,
                    isActive && bStyle && opt.key !== 'win' ? { color: bStyle.color } : null,
                    isActive && opt.key === 'auto' ? { color: accent } : null,
                  ]}>{opt.label}{isAiLocked ? ' · Pro' : ''}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.formLabel}>What&apos;s your win?</Text>
          <TextInput
            style={[styles.formInput, { height: 90, textAlignVertical: 'top', marginBottom: 12 }]}
            placeholder="Share a PR, ask a question, drop a tip..."
            placeholderTextColor={C.muted}
            multiline
            value={text}
            onChangeText={setText}
            editable={!submitting}
          />
          <View style={styles.modalBtns}>
            <Pressable style={styles.btnGhost} onPress={onClose} disabled={submitting}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 2, backgroundColor: accent }, (!text.trim() || submitting) ? { opacity: 0.6 } : null]}
              onPress={handlePost}
              disabled={!text.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.btnPrimaryText}>
                    {badgeChoice === 'auto' ? '🤖 Post + Auto-Tag' : 'Post'}
                  </Text>
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CommentsModal({
  author,
  authorAvatarUrl,
  onClose,
  onCommentAdded,
  postId,
  visible,
}: {
  author: string;
  authorAvatarUrl?: string;
  onClose: () => void;
  onCommentAdded: () => void;
  postId: string | null;
  visible: boolean;
}) {
  const [comments, setComments] = useState<TribeComment[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadComments = useCallback(async () => {
    if (!postId) {
      setComments([]);
      return;
    }

    const nextComments = await getCommentsForPost(postId);
    setComments(nextComments);
  }, [postId]);

  React.useEffect(() => {
    if (visible) {
      loadComments().catch(() => setComments([]));
    }
  }, [loadComments, visible]);

  const handlePostComment = async () => {
    if (!postId || !text.trim() || submitting) return;
    await Haptics.selectionAsync();
    setSubmitting(true);
    await addCommentToPost({
      author,
      authorAvatarUrl,
      body: text.trim(),
      postId,
    });
    setText('');
    setSubmitting(false);
    await loadComments();
    onCommentAdded();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={24}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modal}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>COMMENTS</Text>
          <ScrollView style={styles.commentList} contentContainerStyle={{ gap: 8 }}>
            {comments.length ? (
              comments.map((comment) => {
                const initials = getInitials(comment.author);
                const avaStyle = getThemeAvatarColors(comment.authorThemeId, USER_AVA_COLORS[initials] ?? { bg: C.border, text: C.text });
                return (
                  <View key={comment.id} style={styles.commentCard}>
                    <View style={styles.commentHead}>
                      <View style={[styles.commentAvatar, { backgroundColor: comment.authorAvatarUrl ? 'transparent' : avaStyle.bg }]}>
                        {comment.authorAvatarUrl ? (
                          <Image source={{ uri: comment.authorAvatarUrl }} style={styles.commentAvatarImage} />
                        ) : (
                          <Text style={[styles.commentAvatarText, { color: avaStyle.text }]}>{initials}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.postAuthorRow}>
                          <Text style={styles.commentAuthor}>{comment.author}</Text>
                          {comment.authorIsCoach ? (
                            <View style={styles.coachChip}>
                              <Text style={styles.coachChipText}>Coach</Text>
                            </View>
                          ) : null}
                        </View>
                        {comment.authorTitle ? <Text style={styles.postAuthorTitle}>{comment.authorTitle}</Text> : null}
                      </View>
                    </View>
                    <Text style={styles.commentBody}>{comment.body}</Text>
                  </View>
                );
              })
            ) : (
              <Text style={styles.commentEmpty}>No comments yet. Start the conversation.</Text>
            )}
          </ScrollView>

          <TextInput
            style={[styles.formInput, { marginBottom: 12 }]}
            placeholder="Write a comment..."
            placeholderTextColor={C.muted}
            value={text}
            onChangeText={setText}
            editable={!submitting}
          />

          <View style={styles.modalBtns}>
            <Pressable style={styles.btnGhost} onPress={onClose} disabled={submitting}>
              <Text style={styles.btnGhostText}>Close</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 2 }, (!text.trim() || submitting) ? { opacity: 0.6 } : null]}
              onPress={() => handlePostComment().catch(() => null)}
              disabled={!text.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.btnPrimaryText}>Comment</Text>
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Challenge Group Chat Modal ───────────────────────────────────────────────
// ── Inline audio player for group voice memos ────────────────────────────────
function GroupAudioPlayer({ uri, isMe, accentColor }: { uri: string; isMe: boolean; accentColor?: string }) {
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const toggle = async () => {
    if (playing) {
      await soundRef.current?.pauseAsync().catch(() => null);
      setPlaying(false);
    } else {
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri }, {}, (status) => {
          if ('didJustFinish' in status && status.didJustFinish) {
            setPlaying(false);
            soundRef.current = null;
          }
        });
        soundRef.current = sound;
      }
      await soundRef.current.playAsync().catch(() => null);
      setPlaying(true);
    }
  };

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => null); }, []);

  return (
    <Pressable style={groupStyles.audioPlayer} onPress={() => toggle().catch(() => null)}>
      <View style={[groupStyles.audioPlayBtn, playing && { backgroundColor: accentColor || C.green }]}>
        <Text style={[groupStyles.audioPlayIcon, playing && { color: '#000' }]}>{playing ? '⏸' : '▶'}</Text>
      </View>
      <View style={groupStyles.audioWave}>
        {Array.from({ length: 20 }).map((_, i) => (
          <View
            key={i}
            style={[
              groupStyles.audioBar,
              { height: 3 + Math.abs(Math.sin(i * 0.9)) * 10 + Math.abs(Math.sin(i * 1.5)) * 5 },
              playing && { backgroundColor: isMe ? (accentColor || C.green) : C.text },
            ]}
          />
        ))}
      </View>
      <Text style={groupStyles.audioLabel}>Voice memo</Text>
    </Pressable>
  );
}

function ChallengeGroupModal({
  visible,
  challenge,
  displayName,
  myAvatarUrl,
  onClose,
  onViewProfile,
}: {
  visible: boolean;
  challenge: { id: string; title: string; members: number } | null;
  displayName: string;
  myAvatarUrl?: string;
  onClose: () => void;
  onViewProfile?: (name: string, initials: string) => void;
}) {
  const { accent } = useTheme();
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const listRef = useRef<FlatList<GroupMessage>>(null);

  const initials = displayName
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'ME';

  // Seed messages on open so the group doesn't feel empty
  const SEED: Record<string, GroupMessage[]> = {
    'steps-daily': [
      { id: 's1', author: 'Marcus T.', authorInitials: 'MT', body: 'Hit 12k today! Morning walk before coffee is the move 🔥', createdAt: new Date(Date.now() - 1000 * 60 * 47).toISOString() },
      { id: 's2', author: 'Ashley R.', authorInitials: 'AR', body: 'Struggling to get past 6k on work days. Any tips?', createdAt: new Date(Date.now() - 1000 * 60 * 31).toISOString() },
      { id: 's3', author: 'Jake D.', authorInitials: 'JD', body: 'Park further from the office, take stairs, 10-min walk at lunch. Easy 3k right there', createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString() },
    ],
    'protein-goal': [
      { id: 'p1', author: 'Sara K.', authorInitials: 'SK', body: 'Greek yogurt + protein powder mixed in = 45g at breakfast. Game changer', createdAt: new Date(Date.now() - 1000 * 60 * 62).toISOString() },
      { id: 'p2', author: 'Jake D.', authorInitials: 'JD', body: 'Anyone hit their full goal without supplements? Genuinely curious', createdAt: new Date(Date.now() - 1000 * 60 * 44).toISOString() },
      { id: 'p3', author: 'Marcus T.', authorInitials: 'MT', body: 'Chicken, eggs, cottage cheese, tuna — I do it most days but it takes meal prep', createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString() },
    ],
    'hydration-hero': [
      { id: 'h1', author: 'Ashley R.', authorInitials: 'AR', body: 'Bought a 40oz Stanley, just refilling twice hits the goal without thinking about it', createdAt: new Date(Date.now() - 1000 * 60 * 55).toISOString() },
      { id: 'h2', author: 'Jake R.', authorInitials: 'JR', body: 'I add lemon + electrolytes to mine, makes it way easier to drink', createdAt: new Date(Date.now() - 1000 * 60 * 33).toISOString() },
      { id: 'h3', author: 'Sara K.', authorInitials: 'SK', body: 'Set an alarm every 90 mins. Annoying but it works lol', createdAt: new Date(Date.now() - 1000 * 60 * 11).toISOString() },
    ],
  };

  useEffect(() => {
    if (!visible || !challenge) return;
    AsyncStorage.getItem(challengeGroupKey(challenge.id))
      .then((raw) => {
        if (raw) {
          setMessages(JSON.parse(raw) as GroupMessage[]);
        } else {
          const seed = SEED[challenge.id] ?? [];
          setMessages(seed);
          AsyncStorage.setItem(challengeGroupKey(challenge.id), JSON.stringify(seed)).catch(() => null);
        }
      })
      .catch(() => setMessages(SEED[challenge.id] ?? []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, challenge?.id]);

  const saveMessages = async (updated: GroupMessage[]) => {
    if (!challenge) return;
    setMessages(updated);
    await AsyncStorage.setItem(challengeGroupKey(challenge.id), JSON.stringify(updated)).catch(() => null);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const sendText = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const msg: GroupMessage = {
      id: `m-${Date.now()}`,
      author: displayName || 'You',
      authorAvatarUrl: myAvatarUrl,
      authorInitials: initials,
      body: input.trim(),
      createdAt: new Date().toISOString(),
    };
    await saveMessages([...messages, msg]);
    setInput('');
    setSending(false);
  };

  const pickFromLibrary = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission needed', 'Allow photo/video access to share in the group.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: false,
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const asset = result.assets[0];
    const isVideo = asset.type === 'video';
    const msg: GroupMessage = {
      id: `m-${Date.now()}`,
      author: displayName || 'You',
      authorAvatarUrl: myAvatarUrl,
      authorInitials: initials,
      body: '',
      imageUri: isVideo ? undefined : asset.uri,
      videoUri: isVideo ? asset.uri : undefined,
      createdAt: new Date().toISOString(),
    };
    await saveMessages([...messages, msg]);
  };

  const openCamera = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission needed', 'Allow camera access to take photos and videos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const asset = result.assets[0];
    const isVideo = asset.type === 'video';
    const msg: GroupMessage = {
      id: `m-${Date.now()}`,
      author: displayName || 'You',
      authorAvatarUrl: myAvatarUrl,
      authorInitials: initials,
      body: '',
      imageUri: isVideo ? undefined : asset.uri,
      videoUri: isVideo ? asset.uri : undefined,
      createdAt: new Date().toISOString(),
    };
    await saveMessages([...messages, msg]);
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Allow microphone access to send voice memos.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecording(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      setRecording(null);
      setIsRecording(false);
      if (!uri) return;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const msg: GroupMessage = {
        id: `m-${Date.now()}`,
        author: displayName || 'You',
        authorAvatarUrl: myAvatarUrl,
        authorInitials: initials,
        body: '',
        audioUri: uri,
        createdAt: new Date().toISOString(),
      };
      await saveMessages([...messages, msg]);
    } catch {
      setIsRecording(false);
      setRecording(null);
    }
  };

  const renderMessage = ({ item }: { item: GroupMessage }) => {
    const isMe = item.authorInitials === initials && item.author === (displayName || 'You');
    const avatarStyle = USER_AVA_COLORS[item.authorInitials] ?? { bg: C.dark, text: C.text };
    return (
      <View style={[groupStyles.msgRow, isMe && groupStyles.msgRowMe]}>
        {!isMe && (
          <Pressable
            onPress={() => onViewProfile?.(item.author, item.authorInitials)}
            hitSlop={6}
          >
            <View style={[groupStyles.avatar, { backgroundColor: item.authorAvatarUrl ? 'transparent' : avatarStyle.bg, overflow: 'hidden' }]}>
              {item.authorAvatarUrl ? (
                <Image source={{ uri: item.authorAvatarUrl }} style={groupStyles.chatAvatarImage} />
              ) : (
                <Text style={[groupStyles.avatarText, { color: avatarStyle.text }]}>{item.authorInitials}</Text>
              )}
            </View>
          </Pressable>
        )}
        <View style={[groupStyles.bubble, isMe && groupStyles.bubbleMe]}>
          {!isMe && <Text style={groupStyles.bubbleAuthor}>{item.author}</Text>}
          {/* Photo */}
          {item.imageUri ? (
            <Image source={{ uri: item.imageUri }} style={groupStyles.bubbleImage} resizeMode="cover" />
          ) : null}
          {/* Video thumbnail with play overlay */}
          {item.videoUri ? (
            <View style={groupStyles.videoThumb}>
              <Image source={{ uri: item.videoUri }} style={groupStyles.bubbleImage} resizeMode="cover" />
              <View style={groupStyles.videoPlayOverlay}>
                <Text style={groupStyles.videoPlayIcon}>▶</Text>
              </View>
            </View>
          ) : null}
          {/* Voice memo */}
          {item.audioUri ? (
            <GroupAudioPlayer uri={item.audioUri} isMe={isMe} accentColor={accent} />
          ) : null}
          {item.body ? <Text style={[groupStyles.bubbleText, isMe && groupStyles.bubbleTextMe]}>{item.body}</Text> : null}
          <Text style={[groupStyles.bubbleTime, isMe && { textAlign: 'right' }]}>{formatRelativeTime(Date.parse(item.createdAt))}</Text>
        </View>
        {isMe && (
          <View style={[groupStyles.avatar, { backgroundColor: myAvatarUrl ? 'transparent' : accent, overflow: 'hidden' }]}>
            {myAvatarUrl ? (
              <Image source={{ uri: myAvatarUrl }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <Text style={[groupStyles.avatarText, { color: '#000' }]}>{initials}</Text>
            )}
          </View>
        )}
      </View>
    );
  };

  if (!challenge) return null;

  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/*
        KeyboardAvoidingView MUST wrap the entire screen content — not just the
        input bar. When it only wraps the input bar the FlatList never shrinks
        and the keyboard covers messages. keyboardVerticalOffset matches the
        marginTop (50) on the screen container so calculations stay accurate.
      */}
      <KeyboardAvoidingView
        style={{ flex: 1, marginTop: 50 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={50}
      >
        <View style={[groupStyles.screen, { marginTop: 0 }]}>
          {/* Header */}
          <View style={groupStyles.header}>
            <Pressable onPress={onClose} hitSlop={12} style={groupStyles.backBtn}>
              <Text style={groupStyles.backText}>‹ Back</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={groupStyles.headerTitle} numberOfLines={1}>{challenge.title}</Text>
              <Text style={groupStyles.headerSub}>{challenge.members + messages.filter((m) => m.authorInitials === initials).length} members · Challenge Group</Text>
            </View>
          </View>

          {/* Messages — flex: 1 makes it shrink when keyboard pushes up */}
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={groupStyles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            ListEmptyComponent={
              <View style={groupStyles.emptyState}>
                <Text style={groupStyles.emptyIcon}>💬</Text>
                <Text style={groupStyles.emptyText}>Be the first to post in this challenge group!</Text>
              </View>
            }
          />

          {/* Input bar — raised off the bottom edge with safe-area padding */}
          <View style={[groupStyles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {/* Photo/video from library */}
            <Pressable style={groupStyles.mediaBtn} onPress={() => pickFromLibrary().catch(() => null)} hitSlop={6}>
              <Text style={groupStyles.mediaBtnText}>🖼</Text>
            </Pressable>
            {/* Camera (photo or video) */}
            <Pressable style={groupStyles.mediaBtn} onPress={() => openCamera().catch(() => null)} hitSlop={6}>
              <Text style={groupStyles.mediaBtnText}>📷</Text>
            </Pressable>
            {/* Voice memo — tap to start, tap again to send */}
            <Pressable
              style={[groupStyles.mediaBtn, isRecording && groupStyles.mediaBtnRecording]}
              onPress={() => (isRecording ? stopRecording() : startRecording()).catch(() => null)}
              hitSlop={6}
            >
              <Text style={groupStyles.mediaBtnText}>{isRecording ? '⏹' : '🎙'}</Text>
            </Pressable>
            <TextInput
              style={groupStyles.input}
              value={input}
              onChangeText={setInput}
              placeholder={isRecording ? 'Recording… tap ⏹ to send' : 'Message the group…'}
              placeholderTextColor={C.muted}
              returnKeyType="send"
              onSubmitEditing={() => sendText().catch(() => null)}
              editable={!sending && !isRecording}
              multiline
            />
            <Pressable
              style={[groupStyles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
              onPress={() => sendText().catch(() => null)}
              disabled={!input.trim() || sending}
            >
              <Text style={groupStyles.sendBtnText}>↑</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const groupStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { paddingRight: 4 },
  backText: { color: C.green, fontSize: 17, fontFamily: 'DMSans_500Medium' },
  headerTitle: { fontSize: 15, color: C.text, fontFamily: 'DMSans_700Bold' },
  headerSub: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', marginTop: 1 },
  list: { padding: 16, gap: 12, paddingBottom: 8 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 4 },
  msgRowMe: { flexDirection: 'row-reverse' },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chatAvatarImage: { width: '100%', height: '100%' },
  avatarText: { fontSize: 11, fontFamily: 'DMSans_700Bold' },
  bubble: { maxWidth: '75%', backgroundColor: C.card, borderRadius: 16, borderBottomLeftRadius: 4, padding: 10, gap: 4, borderWidth: 1, borderColor: C.border },
  bubbleMe: { backgroundColor: 'rgba(0,255,136,0.12)', borderColor: 'rgba(0,255,136,0.3)', borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },
  bubbleAuthor: { fontSize: 11, color: C.green, fontFamily: 'DMSans_700Bold' },
  bubbleText: { fontSize: 14, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 20 },
  bubbleTextMe: { color: C.text },
  bubbleTime: { fontSize: 10, color: C.muted, fontFamily: 'DMSans_400Regular' },
  bubbleImage: { width: 200, height: 150, borderRadius: 10, marginBottom: 2 },
  // Video thumbnail with play overlay
  videoThumb: { position: 'relative', width: 200, height: 150, borderRadius: 10, marginBottom: 2, overflow: 'hidden' },
  videoPlayOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  videoPlayIcon: { fontSize: 30, color: '#fff' },
  // Voice memo player
  audioPlayer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 2, marginBottom: 2 },
  audioPlayBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  audioPlayIcon: { fontSize: 14, color: C.text },
  audioWave: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 24, flex: 1 },
  audioBar: { width: 3, borderRadius: 2, backgroundColor: C.border },
  audioLabel: { fontSize: 10, color: C.muted, fontFamily: 'DMSans_400Regular' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.black },
  mediaBtn: { width: 36, height: 36, borderRadius: 9, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  mediaBtnRecording: { backgroundColor: 'rgba(239,68,68,0.2)', borderColor: '#EF4444' },
  mediaBtnText: { fontSize: 18 },
  input: { flex: 1, backgroundColor: C.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, minHeight: 40, maxHeight: 100, borderWidth: 1, borderColor: C.border },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#000', fontSize: 20, fontFamily: 'DMSans_700Bold' },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 14, textAlign: 'center' },
});

export default function TribeScreen() {
  const { accent, accentSoft, accentBorder, accentStrongBorder } = useTheme();
  const navigation = useNavigation<any>();
  const { achievements, stats } = useAchievements();
  const { session } = useAuth();
  const { isPro } = usePro();
  const health = useHealth();
  const [tab, setTab] = useState<Tab>('feed');
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>('week');
  const [customPosts, setCustomPosts] = useState<TribeFeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [postVisible, setPostVisible] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // User profile viewer modal
  const [profileModalTarget, setProfileModalTarget] = useState<{
    avatarUrl?: string;
    bio?: string;
    initials: string;
    isCoach?: boolean;
    name: string;
    title?: string;
  } | null>(null);
  const openUserProfile = (target: {
    avatarUrl?: string;
    bio?: string;
    initials: string;
    isCoach?: boolean;
    name: string;
    title?: string;
  }) => {
    // Don't open profile for "you" rows
    if (target.name.endsWith('(You)') || target.name === (profile?.displayName ?? '')) return;
    setProfileModalTarget(target);
  };
  const [hydrationOz, setHydrationOz] = useState(0);
  const [todayProtein, setTodayProtein] = useState(0);
  // Tick every 60 s so relative timestamps re-render without a page reload
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);
  const [joinedChallenges, setJoinedChallenges] = useState<string[]>([]);
  const [groupModalChallenge, setGroupModalChallenge] = useState<{ id: string; title: string; members: number } | null>(null);
  const [academyVisible, setAcademyVisible] = useState(false);
  const [academyLoading, setAcademyLoading] = useState(false);
  const [academyCourseTitle, setAcademyCourseTitle] = useState('');
  const [academyCourseAccent, setAcademyCourseAccent] = useState(C.green);
  const [academyModules, setAcademyModules] = useState<AcademyModule[]>([]);
  const [activeModule, setActiveModule] = useState<AcademyModule | null>(null);
  const [academyModuleTab, setAcademyModuleTab] = useState<'lesson' | 'coach' | 'quiz'>('lesson');
  const [academyChat, setAcademyChat] = useState<AcademyChatMessage[]>([]);
  const [academyChatInput, setAcademyChatInput] = useState('');
  const [academyChatLoading, setAcademyChatLoading] = useState(false);
  const [academyQuizAnswer, setAcademyQuizAnswer] = useState<number | null>(null);
  const [academyQuizResults, setAcademyQuizResults] = useState<Record<string, AcademyQuizResult>>({});
  const [academySpeaking, setAcademySpeaking] = useState(false);
  const [completedModules, setCompletedModules] = useState<Set<string>>(new Set());
  const [academyCourseTotalModules, setAcademyCourseTotalModules] = useState(0);
  const [workoutDates, setWorkoutDates] = useState<string[]>([]);
  const academyChatRef = useRef<ScrollView | null>(null);
  const storyCardRef = useRef<ViewShot>(null);
  const [storyCardData, setStoryCardData] = useState<{ snippet: string; courseName: string } | null>(null);

  // ── Feature Voting ──────────────────────────────────────────────────────────
  const [activeSuggestion, setActiveSuggestion] = useState<Suggestion | null>(null);
  const [suggestionMinutesRemaining, setSuggestionMinutesRemaining] = useState(0);
  const [suggestionQueueCount, setSuggestionQueueCount] = useState(0);
  const [suggestionVoteCount, setSuggestionVoteCount] = useState(0);
  const [suggestionUserVoted, setSuggestionUserVoted] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionInput, setSuggestionInput] = useState('');
  const [suggestionComposing, setSuggestionComposing] = useState(false);
  const [suggestionSubmitting, setSuggestionSubmitting] = useState(false);

  // ── Academy modal swipe-to-dismiss ──────────────────────────────────────────
  const academySlideY = useRef(new Animated.Value(0)).current;
  const dismissAcademy = useCallback(() => {
    Animated.timing(academySlideY, { toValue: 800, duration: 220, useNativeDriver: true }).start(() => {
      academySlideY.setValue(0);
      setActiveModule(null);
      setAcademyVisible(false);
    });
  }, [academySlideY]);
  const academyPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 8,
      onPanResponderMove: (_, { dy }) => { if (dy > 0) academySlideY.setValue(dy); },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 90 || vy > 0.9) {
          dismissAcademy();
        } else {
          Animated.spring(academySlideY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
        }
      },
    }),
  ).current;
  const displayName = profile?.displayName || session?.user?.email?.split('@')[0] || 'You';

  const loadCustomPosts = useCallback(() => {
    setFeedLoading(true);
    getStoredTribeFeedPosts()
      .then(async (posts) => {
        setCustomPosts(posts);
        const customCountEntries = await Promise.all(
          posts.map(async (post) => [post.id, await getCommentCount(post.id)] as const),
        );
        const staticIds = ['seed-mike-torres-pr', 'seed-coach-tip', 'seed-sarah-question'];
        const staticCountEntries = await Promise.all(
          staticIds.map(async (id) => [id, await getCommentCount(id)] as const),
        );
        setCommentCounts(Object.fromEntries([...customCountEntries, ...staticCountEntries]));
        setFeedLoading(false);
      })
      .catch(() => { setCustomPosts([]); setFeedLoading(false); });
  }, []);

  const loadSuggestions = useCallback(async () => {
    setSuggestionLoading(true);
    try {
      const state = await loadSuggestionCycleState(session?.user?.id);
      setActiveSuggestion(state.activeSuggestion);
      setSuggestionMinutesRemaining(state.minutesRemaining);
      setSuggestionQueueCount(state.queueCount);
      setSuggestionVoteCount(state.voteCount);
      setSuggestionUserVoted(state.userVoted);
    } catch { /* ignore — show empty state */ } finally {
      setSuggestionLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadCustomPosts();
      loadSuggestions().catch(() => null);
      // Load profile from cache first, then merge fresh display name from Supabase
      AsyncStorage.getItem(PROFILE_STORAGE_KEY)
        .then(async (raw) => {
          const cached = raw ? (JSON.parse(raw) as UserProfile) : null;
          setProfile(cached);
          if (session?.user?.id) {
            const { data } = await supabase
              .from('profiles')
              .select('display_name, username, avatar_url, coach_bio, is_coach, selected_title, theme_id')
              .eq('id', session.user.id)
              .single();
            if (data) {
              const remoteProfile = data as {
                avatar_url?: string | null;
                coach_bio?: string | null;
                display_name?: string | null;
                is_coach?: boolean | null;
                selected_title?: string | null;
                theme_id?: ThemeId | null;
                username?: string | null;
              };
              const remoteName =
                remoteProfile.display_name ||
                remoteProfile.username ||
                null;
              if (remoteName) {
                const merged: UserProfile = {
                  ...(cached ?? ({} as UserProfile)),
                  avatarUrl: remoteProfile.avatar_url ?? cached?.avatarUrl,
                  coachBio: remoteProfile.coach_bio ?? cached?.coachBio,
                  displayName: remoteName,
                  isCoach: remoteProfile.is_coach ?? cached?.isCoach,
                  selectedTitle: remoteProfile.selected_title ?? cached?.selectedTitle,
                  themeId: remoteProfile.theme_id ?? cached?.themeId,
                  username: remoteProfile.username ?? cached?.username ?? remoteName,
                };
                setProfile(merged);
                await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(merged));
                // Rewrite any stored posts that still carry an old name
                const oldNames = [
                  cached?.displayName,
                  cached?.username,
                  session?.user?.email?.split('@')[0],
                ].filter((n): n is string => Boolean(n) && n !== remoteName);
                if (oldNames.length) {
                  await migratePostAuthors(oldNames, remoteName);
                  loadCustomPosts(); // re-read so the feed reflects updated names
                }
              }
            }
          }
        })
        .catch(() => setProfile(null));
      AsyncStorage.getItem(HYDRATION_KEY(todayStr()))
        .then((raw) => setHydrationOz(raw ? Number(raw) : 0))
        .catch(() => setHydrationOz(0));
      AsyncStorage.getItem(TRIBE_CHALLENGES_STORAGE_KEY)
        .then((raw) => setJoinedChallenges(raw ? JSON.parse(raw) as string[] : []))
        .catch(() => setJoinedChallenges([]));
      AsyncStorage.getItem('apex.academy.completed')
        .then((raw) => setCompletedModules(raw ? new Set(JSON.parse(raw) as string[]) : new Set()))
        .catch(() => setCompletedModules(new Set()));
      AsyncStorage.getItem(ACADEMY_QUIZ_RESULTS_KEY)
        .then((raw) => setAcademyQuizResults(raw ? JSON.parse(raw) as Record<string, AcademyQuizResult> : {}))
        .catch(() => setAcademyQuizResults({}));

      // ── Realtime subscription — live feed updates while screen is focused ──
      const channel = supabase
        .channel('tribe-feed-realtime')
        // New posts from any user → prepend to feed
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'tribe_posts' },
          async (payload) => {
            try {
              const newPost = await hydrateRealtimePost(payload.new as {
                id: string; user_id: string; badge_type: string;
                content: string; like_count?: number | null; created_at: string;
              });
              setCustomPosts((prev) => {
                if (prev.some((p) => p.id === newPost.id)) return prev; // dedupe
                return [newPost, ...prev];
              });
            } catch { /* silently skip — full reload on next focus */ }
          },
        )
        // New comments → increment count badge live
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'tribe_comments' },
          (payload) => {
            const { post_id } = payload.new as { post_id: string };
            setCommentCounts((prev) => ({ ...prev, [post_id]: (prev[post_id] ?? 0) + 1 }));
          },
        )
        // Like count updates → update post in-place
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tribe_posts' },
          (payload) => {
            const { id, like_count } = payload.new as { id: string; like_count: number };
            setCustomPosts((prev) =>
              prev.map((p) => (p.id === id ? { ...p, likes: like_count ?? p.likes } : p)),
            );
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel).catch(() => null);
      };
    }, [loadCustomPosts, loadSuggestions]),
  );

  useEffect(() => {
    const loadWorkoutDates = async () => {
      if (!session?.user?.id) {
        setWorkoutDates([]);
        return;
      }
      const { data } = await supabase
        .from('workouts')
        .select('workout_date')
        .eq('user_id', session.user.id)
        .order('workout_date', { ascending: false })
        .limit(500);
      setWorkoutDates((data ?? []).map((row) => row.workout_date));
    };
    loadWorkoutDates().catch(() => setWorkoutDates([]));
  }, [session?.user?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadSuggestions().catch(() => null);
    }, 30_000);

    return () => clearInterval(interval);
  }, [loadSuggestions]);

  React.useEffect(() => {
    const loadTodayProtein = async () => {
      if (!session?.user?.id) {
        setTodayProtein(0);
        return;
      }

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const { data } = await supabase
        .from('nutrition_entries')
        .select('protein_grams')
        .eq('user_id', session.user.id)
        .gte('consumed_at', startOfDay.toISOString());

      const total = (data ?? []).reduce((sum, row) => sum + Number(row.protein_grams ?? 0), 0);
      setTodayProtein(Math.round(total));
    };

    loadTodayProtein().catch(() => setTodayProtein(0));
  }, [session?.user?.id]);

  const handleShareAchievement = (achievement: UserAchievement) => {
    if (!achievement.earned) return;

    Alert.alert(achievement.name, 'Share this achievement to the Tribe feed or your socials.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Post to Tribe',
        onPress: () => {
          addAchievementPostToFeed({ achievement, author: displayName })
            .then(loadCustomPosts)
            .then(() => Alert.alert('Shared', `${achievement.name} was posted to the feed.`))
            .catch(() => null);
        },
      },
      {
        text: 'Share Social',
        onPress: () => {
          Share.share({ message: getAchievementShareMessage(achievement) }).catch(() => null);
        },
      },
    ]);
  };

  const handleToggleSuggestionVote = async () => {
    if (!session?.user?.id || !activeSuggestion) return;
    await Haptics.selectionAsync();
    if (suggestionUserVoted) {
      await supabase
        .from('suggestion_votes')
        .delete()
        .eq('suggestion_id', activeSuggestion.id)
        .eq('user_id', session.user.id)
        .then(() => null, () => null);
    } else {
      await supabase
        .from('suggestion_votes')
        .insert({ suggestion_id: activeSuggestion.id, user_id: session.user.id })
        .then(() => null, () => null);
    }
    await loadSuggestions();
  };

  const handleSubmitSuggestion = async () => {
    const text = suggestionInput.trim();
    if (!text || !session?.user?.id || suggestionSubmitting) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSuggestionSubmitting(true);
    try {
      // AI moderation — same logic as SuggestionsScreen
      try {
        const { data: modData, error: modError } = await supabase.functions.invoke('anthropic', {
          body: {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 128,
            system:
              'You are a content moderator for APEX, a fitness app. ' +
              'Evaluate the feature request and decide if it should be shown to the community. ' +
              'Reject if: spam, offensive, completely unrelated to fitness or the app, or gibberish. ' +
              'Approve anything that is a genuine fitness/app improvement idea. ' +
              'Reply ONLY valid JSON: {"approved":true,"reason":""} or {"approved":false,"reason":"one sentence"}',
            messages: [{ role: 'user', content: text }],
          },
        });
        if (!modError && modData) {
          const raw: string =
            (modData as { content: Array<{ text: string }> }).content?.[0]?.text?.trim() ?? '';
          try {
            const parsed = JSON.parse(raw) as { approved: boolean; reason: string };
            if (!parsed.approved) {
              setSuggestionSubmitting(false);
              Alert.alert(
                "Couldn't post that",
                parsed.reason || 'Try rephrasing it as a fitness or app feature idea.',
              );
              return;
            }
          } catch { /* JSON parse failed — fail open */ }
        }
      } catch { /* network/function error — fail open */ }

      const { error } = await supabase
        .from('suggestions')
        .insert({ title: text, user_id: session.user.id });
      if (error) {
        Alert.alert('Could not submit', error.message);
        return;
      }
      setSuggestionInput('');
      setSuggestionComposing(false);
      await loadSuggestions();
    } finally {
      setSuggestionSubmitting(false);
    }
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'feed', label: 'Feed' },
    { key: 'leaderboard', label: 'Leaderboard' },
    { key: 'challenges', label: 'Challenges' },
    { key: 'academy', label: 'Academy' },
  ];
  const visibleFeedPosts = useMemo(() => customPosts.slice(0, 6), [customPosts]);
  const hiddenFeedPostCount = Math.max(customPosts.length - visibleFeedPosts.length, 0);

  const openComments = (postId: string) => {
    setActiveCommentPostId(postId);
    setCommentsVisible(true);
  };

  const targets = getOrComputeMacroTargets(profile);
  const waterGoalOz = profile?.weightLbs ? Math.round(Number(profile.weightLbs) * 0.55) : 100;
  const challengeProgress = useMemo(() => ({
    hydrationPct: Math.min((hydrationOz / Math.max(waterGoalOz, 1)) * 100, 100),
    proteinPct: Math.min((todayProtein / Math.max(targets.dailyProtein, 1)) * 100, 100),
    stepsPct: Math.min((health.steps / 10000) * 100, 100),
  }), [health.steps, hydrationOz, targets.dailyProtein, waterGoalOz, todayProtein]);

  const startOfWeek = useMemo(() => {
    const date = new Date();
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);
  const startOfMonth = useMemo(() => {
    const date = new Date();
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);
  const workoutsThisWeek = useMemo(
    () => workoutDates.filter((date) => new Date(date) >= startOfWeek).length,
    [startOfWeek, workoutDates],
  );
  const workoutsThisMonth = useMemo(
    () => workoutDates.filter((date) => new Date(date) >= startOfMonth).length,
    [startOfMonth, workoutDates],
  );
  const weeklyScore = Math.round((workoutsThisWeek * 140) + (stats.mealCount * 18) + (stats.streak * 55) + (stats.xp * 0.45));
  const monthlyScore = Math.round((workoutsThisMonth * 160) + (stats.mealCount * 20) + (stats.streak * 65) + (stats.xp * 0.6));
  const allTimeScore = Math.round((stats.workoutCount * 175) + (stats.mealCount * 22) + (stats.xp * 0.9) + (stats.photoScanCount * 40));

  const leaderboardRowsWeek = [
    { rank: 1, name: 'Elite Pace', meta: 'Benchmark pace', sub: 'Top-tier weekly consistency', pts: Math.max(weeklyScore + 1800, 3200), themeId: 'gold' as ThemeId },
    { rank: 2, name: 'Strong Pace', meta: 'Benchmark pace', sub: 'Solid workouts + meals + streak', pts: Math.max(weeklyScore + 850, 2200), themeId: 'blue' as ThemeId },
    { rank: 3, name: 'Consistency Pace', meta: 'Benchmark pace', sub: 'Steady momentum over time', pts: Math.max(weeklyScore + 250, 1400), themeId: 'purple' as ThemeId },
    { rank: 4, name: `${displayName} (You)`, meta: `${stats.streak}-day streak`, sub: `${workoutsThisWeek} workouts this week · ${stats.mealCount} meals · ${stats.xp} XP`, pts: weeklyScore, themeId: (profile?.themeId ?? 'green') as ThemeId, isPro },
  ];
  const leaderboardRowsMonth = [
    { rank: 1, name: 'Monthly Leader Pace', meta: '30-day benchmark', sub: 'What steady momentum looks like over a month', pts: Math.max(monthlyScore + 2600, 4400), themeId: 'gold' as ThemeId },
    { rank: 2, name: 'Momentum Builder', meta: '30-day benchmark', sub: 'Strong training consistency with nutrition follow-through', pts: Math.max(monthlyScore + 1100, 2800), themeId: 'orange' as ThemeId },
    { rank: 3, name: `${displayName} (You)`, meta: `${workoutsThisMonth} workouts this month`, sub: `${stats.mealCount} meals logged · ${stats.xp} XP`, pts: monthlyScore, themeId: (profile?.themeId ?? 'green') as ThemeId, isPro },
  ];
  const leaderboardRowsAllTime = [
    { rank: 1, name: 'APEX All-Time Standard', meta: 'Lifetime benchmark', sub: 'What long-term consistency can look like', pts: Math.max(allTimeScore + 4000, 7000), themeId: 'gold' as ThemeId },
    { rank: 2, name: 'Pro Member Pace', meta: 'Lifetime benchmark', sub: 'Strong accumulation across training and nutrition', pts: Math.max(allTimeScore + 1600, 4200), themeId: 'rose' as ThemeId },
    { rank: 3, name: `${displayName} (You)`, meta: `${stats.workoutCount} total workouts`, sub: `${stats.mealCount} meals · ${stats.photoScanCount} scans · ${stats.xp} XP`, pts: allTimeScore, themeId: (profile?.themeId ?? 'green') as ThemeId, isPro },
  ];
  const leaderboardRows =
    leaderboardScope === 'allTime'
      ? leaderboardRowsAllTime
      : leaderboardScope === 'month'
        ? leaderboardRowsMonth
        : leaderboardRowsWeek;

  const challenges = [
    { id: 'steps-daily', title: '⚡ 10K Steps Daily', members: 342, progressPct: challengeProgress.stepsPct, body: `You: ${health.steps.toLocaleString()} / 10,000 steps` },
    { id: 'protein-goal', title: '🥩 Hit Protein Goal', members: 189, progressPct: challengeProgress.proteinPct, body: `${todayProtein} / ${targets.dailyProtein}g protein today` },
    { id: 'hydration-hero', title: '💧 Hydration Hero', members: 512, progressPct: challengeProgress.hydrationPct, body: `${hydrationOz} / ${waterGoalOz} oz water today` },
  ];

  const academyCourses = [
    { icon: '⚡', name: 'Your APEX Blueprint', modules: 5, rating: '5.0', sub: 'personalised entirely to your data', completed: 0, accent: 'rgba(255,107,53,0.12)', accentColor: C.orange, proOnly: true },
    { icon: '🎓', name: 'Foundations of Strength', modules: 8, rating: '4.9', sub: 'real progress from workouts', completed: Math.min(8, Math.max(completedModules.size > 0 ? 1 : 0, Math.floor(stats.workoutCount / 2))), accent: 'rgba(0,255,135,0.08)', accentColor: C.green, proOnly: false },
    { icon: '🧬', name: 'Nutrition Mastery', modules: 12, rating: '4.8', sub: 'real progress from nutrition logs', completed: Math.min(12, Math.floor(stats.mealCount / 3)), accent: 'rgba(59,130,246,0.08)', accentColor: C.blue, proOnly: false },
    { icon: '🧘', name: 'Recovery & Longevity', modules: 6, rating: '4.9', sub: 'real progress from recovery habits', completed: Math.min(6, Math.floor((challengeProgress.hydrationPct + challengeProgress.stepsPct) / 40)), accent: 'rgba(168,85,247,0.08)', accentColor: C.purple, proOnly: false },
  ];

  const toggleChallenge = async (challengeId: string) => {
    await Haptics.selectionAsync();
    const next = joinedChallenges.includes(challengeId)
      ? joinedChallenges.filter((id) => id !== challengeId)
      : [...joinedChallenges, challengeId];
    setJoinedChallenges(next);
    await AsyncStorage.setItem(TRIBE_CHALLENGES_STORAGE_KEY, JSON.stringify(next));
  };

  const openAcademyCourse = async (course: { accentColor: string; completed: number; modules: number; name: string }) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAcademyCourseTitle(course.name);
    setAcademyCourseAccent(course.accentColor as typeof C.green);
    setAcademyCourseTotalModules(course.modules);
    setAcademyVisible(true);
    setActiveModule(null);
    setAcademyChat([]);

    const cached = await AsyncStorage.getItem(academyStorageKey(course.name)).catch(() => null);
    if (cached) {
      try {
        setAcademyModules(JSON.parse(cached) as AcademyModule[]);
        return;
      } catch {
        // fall through to regenerate
      }
    }

    setAcademyLoading(true);
    try {
      const isBlueprint = course.name === 'Your APEX Blueprint';
      // Shared user data snippet injected into every prompt
      const userData = `User: ${profile?.displayName ?? 'Athlete'} | Goal: ${profile?.goal ?? 'recomp'} | Experience: ${profile?.experience ?? 'intermediate'}
Age: ${profile?.age ?? '?'} | Gender: ${profile?.gender ?? '?'}
Current weight: ${profile?.weightLbs ?? '?'} lbs → Target: ${profile?.goalWeightLbs ?? '?'} lbs
Protein target: ${profile?.dailyProtein ?? 200}g/day | Calorie target: ${profile?.dailyCalorieTarget ?? 2500} kcal
Workouts logged: ${stats.workoutCount} | Meals logged: ${stats.mealCount} | Streak: ${stats.streak} days`;

      const prompt = isBlueprint
        ? `You are the APEX AI Coach. Create 5 deeply personalised course modules for this specific user.
${userData}

Rules:
- Module titles MUST reference their actual numbers (e.g. "Closing the ${(profile?.goalWeightLbs && profile?.weightLbs) ? Math.abs(parseFloat(profile.weightLbs) - parseFloat(profile.goalWeightLbs)).toFixed(0) : '?'} lb Gap")
- The "action" for each module MUST name a specific thing they can do in APEX TODAY, referencing their real stats (e.g. "You've logged ${stats.mealCount} meals — open the nutrition tab and check if you hit ${profile?.dailyProtein ?? 200}g protein today")
- EVERY module MUST include a quiz with 4 options and a correctIndex
- Reply ONLY with valid JSON, nothing else

[{"id":"m1","title":"Specific title referencing their numbers","summary":"1 sentence using their actual data","bullets":["coaching point using their numbers","coaching point 2","coaching point 3"],"action":"Specific action referencing their real stats (workouts: ${stats.workoutCount}, protein: ${profile?.dailyProtein ?? 200}g, streak: ${stats.streak} days, weight gap etc.)","shareSnippet":"1 inspiring insight quote","quiz":{"question":"Relevant question about this module topic?","options":["Option A","Option B","Option C","Option D"],"correctIndex":0}}]`
        : `You are the APEX AI Coach. Create ${Math.min(course.modules, 6)} modules for the "${course.name}" course.
${userData}

Rules:
- The "action" for EACH module MUST be a specific, personalised next step referencing their real data above (not generic advice). E.g. "You have a ${stats.streak}-day streak — keep it alive by logging one meal tonight" or "You've done ${stats.workoutCount} workouts — add progressive overload to your next session"
- EVERY module MUST include a "quiz" with a question, 4 options, and correctIndex
- Keep bullets practical and tied to the course topic
- Reply ONLY with valid JSON array, nothing else

[{"id":"m1","title":"Short title","summary":"1 practical sentence","bullets":["step 1","step 2","step 3"],"action":"Personalised action using their actual stats (${stats.workoutCount} workouts, ${stats.mealCount} meals, ${stats.streak}-day streak, ${profile?.dailyProtein ?? 200}g protein target, ${profile?.weightLbs ?? '?'}lbs → ${profile?.goalWeightLbs ?? '?'}lbs goal)","shareSnippet":"inspiring 1-liner to share","quiz":{"question":"Question about this specific module topic?","options":["A","B","C","D"],"correctIndex":0}}]`;

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: { model: 'claude-haiku-4-5-20251001', max_tokens: 2400, messages: [{ role: 'user', content: prompt }] },
      });
      if (error) throw error;
      const raw: string = (data?.content as Array<{ text?: string }>)?.map((b) => b.text ?? '').join('') ?? '';
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Bad academy format');
      const modules = JSON.parse(jsonMatch[0]) as AcademyModule[];
      setAcademyModules(modules);
      await AsyncStorage.setItem(academyStorageKey(course.name), JSON.stringify(modules));
    } catch {
      const fallback: AcademyModule[] = Array.from({ length: Math.min(course.modules, 5) }).map((_, i) => ({
        action: 'Apply this in your next session and log it in APEX.',
        bullets: ['Focus on one concept and practise it deliberately.', 'Log the result so your progress is tracked.', 'Return and mark complete once done.'],
        id: `${course.name}-${i + 1}`,
        quiz: { correctIndex: 0, options: ['Consistency', 'Motivation', 'Equipment', 'Supplements'], question: 'What matters most for long-term results?' },
        shareSnippet: 'Small daily wins compound into extraordinary results.',
        summary: `A practical lesson from ${course.name.toLowerCase()} tied to your real progress.`,
        title: `Module ${i + 1}`,
      }));
      setAcademyModules(fallback);
    } finally {
      setAcademyLoading(false);
    }
  };

  const openModule = async (module: AcademyModule) => {
    await Haptics.selectionAsync();
    setActiveModule(module);
    setAcademyModuleTab('lesson');
    setAcademyQuizAnswer(academyQuizResults[module.id]?.answerIndex ?? null);
    // Seed the coach chat with a Socratic opening question
    const greeting: AcademyChatMessage = {
      id: `coach-open-${Date.now()}`,
      role: 'coach',
      text: `Let's make this interactive. Before I explain "${module.title}" — what do you already know about this topic, or what's been your biggest challenge with it?`,
    };
    setAcademyChat([greeting]);
  };

  const sendAcademyChat = async () => {
    if (!academyChatInput.trim() || academyChatLoading || !activeModule) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userMsg: AcademyChatMessage = { id: `u-${Date.now()}`, role: 'user', text: academyChatInput.trim() };
    const updatedChat = [...academyChat, userMsg];
    setAcademyChat(updatedChat);
    setAcademyChatInput('');
    setAcademyChatLoading(true);
    setTimeout(() => academyChatRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      const personaPrefix = await getCoachPersonaPrefix().catch(() => '');
      const systemPrompt = `${personaPrefix}You are the APEX AI Coach — a direct, data-aware fitness tutor inside an interactive learning module.
Current module: "${activeModule.title}" — ${activeModule.summary}
Course: ${academyCourseTitle}
Athlete data: Goal=${profile?.goal ?? 'recomp'}, Experience=${profile?.experience ?? 'intermediate'},
  Workouts=${stats.workoutCount}, Streak=${stats.streak} days, Protein target=${profile?.dailyProtein ?? 200}g/day,
  Current weight=${profile?.weightLbs ?? '?'} lbs, Goal weight=${profile?.goalWeightLbs ?? '?'} lbs.
Teaching style: Socratic — ask a follow-up question after every answer. Be concise (max 3 sentences).
Reference the user's real numbers when relevant. Challenge weak thinking. Celebrate genuine insight.`;

      const messages = updatedChat.map((m) => ({
        role: m.role === 'coach' ? 'assistant' : 'user',
        content: m.text,
      }));

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: { max_tokens: 300, system: systemPrompt, messages },
      });
      if (error) throw error;
      const reply = (data?.content as Array<{ text?: string }>)?.map((b) => b.text ?? '').join('').trim() ?? 'No response.';
      setAcademyChat((prev) => [...prev, { id: `coach-${Date.now()}`, role: 'coach', text: reply }]);
      setTimeout(() => academyChatRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      setAcademyChat((prev) => [...prev, { id: `err-${Date.now()}`, role: 'coach', text: 'Couldn\'t reach AI Coach right now — try again.' }]);
    } finally {
      setAcademyChatLoading(false);
    }
  };

  const applyToMyData = async () => {
    if (!activeModule || academyChatLoading) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prompt = `Based on "${activeModule.title}" and my real data (${stats.workoutCount} workouts, ${stats.streak} day streak, ${profile?.dailyProtein ?? 200}g protein target, ${profile?.weightLbs ?? '?'} lbs → ${profile?.goalWeightLbs ?? '?'} lbs goal), give me ONE specific, actionable insight that applies directly to my numbers.`;
    const userMsg: AcademyChatMessage = { id: `u-${Date.now()}`, role: 'user', text: prompt };
    const updated = [...academyChat, userMsg];
    setAcademyChat(updated);
    setAcademyModuleTab('coach');
    setAcademyChatLoading(true);

    try {
      const applyPersonaPrefix = await getCoachPersonaPrefix().catch(() => '');
      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 200,
          system: `${applyPersonaPrefix}You are the APEX AI Coach. Answer in 2-3 direct sentences using real numbers.`,
          messages: updated.map((m) => ({ role: m.role === 'coach' ? 'assistant' : 'user', content: m.text })),
        },
      });
      if (error) throw error;
      const reply = (data?.content as Array<{ text?: string }>)?.map((b) => b.text ?? '').join('').trim() ?? '';
      setAcademyChat((prev) => [...prev, { id: `coach-${Date.now()}`, role: 'coach', text: reply }]);
      setTimeout(() => academyChatRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      setAcademyChat((prev) => [...prev, { id: `err-${Date.now()}`, role: 'coach', text: 'Could not reach AI Coach.' }]);
    } finally {
      setAcademyChatLoading(false);
    }
  };

  const markModuleComplete = async (moduleId: string) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // 1. Update the global completed-modules set
    const next = new Set([...completedModules, moduleId]);
    setCompletedModules(next);
    await AsyncStorage.setItem('apex.academy.completed', JSON.stringify([...next])).catch(() => null);

    // 2. Track per-course progress (for "complete entire course" achievement)
    if (academyCourseTitle) {
      const courseProgressKey = `apex.academy.progress.${academyCourseTitle}`;
      const existingRaw = await AsyncStorage.getItem(courseProgressKey).catch(() => null);
      const existingIds: string[] = existingRaw ? JSON.parse(existingRaw) : [];
      if (!existingIds.includes(moduleId)) {
        const updatedIds = [...existingIds, moduleId];
        await AsyncStorage.setItem(courseProgressKey, JSON.stringify(updatedIds)).catch(() => null);

        // If the user has now completed every module in this course → mark course complete
        const totalForCourse = Math.min(academyCourseTotalModules, 6);
        if (updatedIds.length >= totalForCourse) {
          const completedCoursesRaw = await AsyncStorage.getItem('apex.academy.completedCourses').catch(() => null);
          const completedCourses: string[] = completedCoursesRaw ? JSON.parse(completedCoursesRaw) : [];
          if (!completedCourses.includes(academyCourseTitle)) {
            completedCourses.push(academyCourseTitle);
            await AsyncStorage.setItem('apex.academy.completedCourses', JSON.stringify(completedCourses)).catch(() => null);
          }
        }
      }
    }

    // 3. Track Blueprint-specific module count
    if (academyCourseTitle === 'Your APEX Blueprint') {
      const blueprintProgressKey = 'apex.academy.progress.Your APEX Blueprint';
      const bpRaw = await AsyncStorage.getItem(blueprintProgressKey).catch(() => null);
      const bpIds: string[] = bpRaw ? JSON.parse(bpRaw) : [];
      await AsyncStorage.setItem('apex.academy.blueprintDone', String(bpIds.length)).catch(() => null);
    }
  };

  const handleRetakeQuiz = async () => {
    if (!activeModule) return;
    await Haptics.selectionAsync();
    const nextResults = { ...academyQuizResults };
    delete nextResults[activeModule.id];
    setAcademyQuizResults(nextResults);
    setAcademyQuizAnswer(null);
    await AsyncStorage.setItem(ACADEMY_QUIZ_RESULTS_KEY, JSON.stringify(nextResults)).catch(() => null);
  };

  const handleShareInsight = (module: AcademyModule, courseName: string) => {
    const snippet = module.shareSnippet || module.summary;
    Alert.alert('Share Insight', 'Where would you like to share this?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: '🔥 Tribe Feed',
        onPress: () => {
          addTextPostToFeed({ author: displayName, body: `💡 "${snippet}"\n\n— from ${courseName} in APEX Academy` })
            .then(loadCustomPosts)
            .then(() => Alert.alert('Shared to Tribe ✓', 'Your insight was posted to the feed.'))
            .catch(() => null);
        },
      },
      {
        text: '↗ Story / Social',
        onPress: async () => {
          // Render story card off-screen then capture as PNG for Instagram / TikTok / FB Stories
          setStoryCardData({ snippet, courseName });
          // Wait one frame for the view to render
          await new Promise<void>((r) => setTimeout(r, 120));
          try {
            const uri = await storyCardRef.current?.capture?.();
            if (!uri) throw new Error('capture failed');
            const canShare = await Sharing.isAvailableAsync();
            if (canShare) {
              await Sharing.shareAsync(uri, {
                mimeType: 'image/png',
                dialogTitle: 'Share to Stories',
                UTI: 'public.png',
              });
            } else {
              // Fallback to text share on simulators / Android without share support
              await Share.share({ message: `${courseName}: "${snippet}"\n\nTracking my progress in APEX 💪` });
            }
          } catch {
            await Share.share({ message: `${courseName}: "${snippet}"\n\nTracking my progress in APEX 💪` });
          } finally {
            setStoryCardData(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <AppHeader />
      <View style={styles.tabRow}>
        {tabs.map((item) => (
          <Pressable
            key={item.key}
            style={[styles.tabBtn, tab === item.key ? styles.tabBtnActive : null]}
            onPress={() => setTab(item.key)}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={[styles.tabBtnText, tab === item.key ? [styles.tabBtnTextActive, { color: accent }] : null]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'feed' ? (
          <>
            <Pressable style={[styles.btnPrimary, { marginBottom: 14, backgroundColor: accent }]} onPress={() => setPostVisible(true)}>
              <Text style={styles.btnPrimaryText}>+ Share Your Win</Text>
            </Pressable>

            {activeSuggestion ? (
              <View style={[styles.votingPinnedCard, { backgroundColor: accentSoft, borderColor: accentStrongBorder }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.votingPinnedEyebrow, { color: accent }]}>LIVE COMMUNITY VOTE</Text>
                  <Text style={styles.votingPinnedTitle}>{activeSuggestion.title}</Text>
                  <Text style={styles.votingPinnedMeta}>
                    {suggestionVoteCount}/5 votes · {suggestionMinutesRemaining} min left
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.votingPinnedBtn,
                    suggestionUserVoted ? { backgroundColor: accent, borderColor: accentStrongBorder } : null,
                  ]}
                  onPress={() => handleToggleSuggestionVote().catch(() => null)}
                >
                  <Text style={[styles.votingPinnedBtnText, suggestionUserVoted ? styles.votingPinnedBtnTextActive : null]}>
                    {suggestionUserVoted ? 'VOTED' : 'VOTE'}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {feedLoading ? (
              [0, 1, 2].map((i) => (
                <View key={i} style={styles.postCard}>
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                    <SkeletonCard height={36} width={36} borderRadius={18} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <SkeletonCard height={12} width="45%" borderRadius={6} />
                      <SkeletonCard height={10} width="30%" borderRadius={6} />
                    </View>
                  </View>
                  <SkeletonCard height={14} borderRadius={6} style={{ marginBottom: 6 }} />
                  <SkeletonCard height={14} width="80%" borderRadius={6} />
                </View>
              ))
            ) : customPosts.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 24, gap: 10 }}>
                <Text style={{ fontSize: 32 }}>🏆</Text>
                <Text style={{ color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 20, letterSpacing: 1 }}>Your tribe is waiting</Text>
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>Share your first win, PR, or tip — your crew wants to hear it.</Text>
                <Pressable style={[styles.btnPrimary, { marginTop: 6, paddingHorizontal: 28, backgroundColor: accent }]} onPress={() => setPostVisible(true)}>
                  <Text style={styles.btnPrimaryText}>Post Your Win 🔥</Text>
                </Pressable>
              </View>
            ) : null}
            {!feedLoading && visibleFeedPosts.map((post) => (
              <PostCard
                key={post.id}
                id={post.id}
                author={post.author}
                time={formatRelativeTime(post.createdAt)}
                badge={post.badge}
                badgeType={post.badgeType}
                body={post.body}
                likes={post.likes}
                comments={commentCounts[post.id] ?? post.comments}
                onCommentPress={openComments}
                onAuthorPress={openUserProfile}
                authorAvatarUrl={post.authorAvatarUrl ?? (post.author === displayName ? profile?.avatarUrl : undefined)}
                authorCoachBio={post.authorCoachBio ?? (post.author === displayName ? profile?.coachBio : undefined)}
                authorIsCoach={post.authorIsCoach ?? (post.author === displayName ? profile?.isCoach : false)}
                authorThemeId={post.authorThemeId ?? (post.author === displayName ? profile?.themeId : undefined)}
                authorTitle={post.authorTitle ?? (post.author === displayName ? profile?.selectedTitle : undefined)}
                accentColor={accent}
                accentStrongBorder={accentStrongBorder}
                videoUrl={post.videoUrl}
              />
            ))}
            {!feedLoading && hiddenFeedPostCount > 0 ? (
              <View style={styles.feedLimitCard}>
                <Text style={styles.feedLimitTitle}>Showing the latest 6 Tribe posts</Text>
                <Text style={styles.feedLimitText}>
                  {hiddenFeedPostCount} older {hiddenFeedPostCount === 1 ? 'post is' : 'posts are'} hidden here to keep the feed easier to scan.
                </Text>
              </View>
            ) : null}
            {customPosts.length === 0 ? (
              <>
                <PostCard
                  id="seed-mike-torres-pr"
                  author="Mike Torres"
                  time="2 hours ago · Level 18"
                  badge="PR"
                  badgeType="pr"
                  body="Just hit a 405 deadlift for the first time. This community keeps me accountable every week."
                  likes={84}
                  comments={commentCounts['seed-mike-torres-pr'] ?? 23}
                  onCommentPress={openComments}
                  onAuthorPress={openUserProfile}
                  accentColor={accent}
                  accentStrongBorder={accentStrongBorder}
                />
                <PostCard
                  id="seed-coach-tip"
                  author="Coach Alex Rivera"
                  time="6 hours ago · Head Coach"
                  badge="Tip"
                  badgeType="tip"
                  body="Heavy work feels best when recovery is handled first. Check sleep and food before blaming motivation."
                  likes={156}
                  comments={commentCounts['seed-coach-tip'] ?? 42}
                  onCommentPress={openComments}
                  onAuthorPress={openUserProfile}
                  authorIsCoach
                  authorThemeId="orange"
                  authorTitle="Head Coach"
                  accentColor={accent}
                  accentStrongBorder={accentStrongBorder}
                />
                <PostCard
                  id="seed-sarah-question"
                  author="Sarah Kim"
                  time="4 hours ago · Level 9"
                  badge="Q"
                  badgeType="q"
                  body="Anyone have fast high-protein meal prep ideas? Hitting calories, but prep time is killing me."
                  likes={31}
                  comments={commentCounts['seed-sarah-question'] ?? 18}
                  onCommentPress={openComments}
                  onAuthorPress={openUserProfile}
                  accentColor={accent}
                  accentStrongBorder={accentStrongBorder}
                />
              </>
            ) : null}
            {/* ── Feature Voting ─────────────────────────────────────── */}
            <View style={styles.votingSectionHeader}>
              <Text style={[styles.votingSectionTitle, { color: accent }]}>💡 FEATURE VOTING</Text>
              <Pressable
                style={[styles.votingSuggestBtn, { borderColor: accentStrongBorder, backgroundColor: accentSoft }]}
                onPress={async () => {
                  await Haptics.selectionAsync();
                  setSuggestionComposing((v) => !v);
                }}
              >
                <Text style={[styles.votingSuggestBtnText, { color: accent }]}>+ Suggest</Text>
              </Pressable>
            </View>

            {suggestionComposing ? (
              <View style={[styles.votingComposeCard, { borderColor: accentStrongBorder }]}>
                <TextInput
                  style={styles.votingComposeInput}
                  placeholder="What feature would make APEX better?"
                  placeholderTextColor={C.muted}
                  value={suggestionInput}
                  onChangeText={setSuggestionInput}
                  multiline
                  editable={!suggestionSubmitting}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Pressable
                    style={[styles.btnGhost, { flex: 1 }]}
                    onPress={() => { setSuggestionComposing(false); setSuggestionInput(''); }}
                    disabled={suggestionSubmitting}
                  >
                    <Text style={styles.btnGhostText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btnPrimary, { flex: 2, backgroundColor: accent }, (!suggestionInput.trim() || suggestionSubmitting) ? { opacity: 0.6 } : null]}
                    onPress={() => handleSubmitSuggestion().catch(() => null)}
                    disabled={!suggestionInput.trim() || suggestionSubmitting}
                  >
                    {suggestionSubmitting
                      ? <ActivityIndicator size="small" color="#000" />
                      : <Text style={styles.btnPrimaryText}>Submit Idea</Text>
                    }
                  </Pressable>
                </View>
              </View>
            ) : null}

            {suggestionLoading && !activeSuggestion ? (
              <ActivityIndicator size="small" color={accent} style={{ marginBottom: 14 }} />
            ) : !activeSuggestion ? (
              <View style={styles.votingEmptyCard}>
                <Text style={styles.votingEmptyText}>No live feature vote right now. Submit an idea to start the next round.</Text>
              </View>
            ) : (
              <>
                <View style={styles.votingCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.votingCardTitle}>{activeSuggestion.title}</Text>
                    <Text style={styles.votingCardMeta}>
                      {suggestionVoteCount}/5 votes · {suggestionMinutesRemaining} min left · {suggestionQueueCount} queued
                    </Text>
                  </View>
                  <Pressable
                    style={[
                      styles.votingVoteBtn,
                      suggestionUserVoted ? { borderColor: accentStrongBorder, backgroundColor: accentSoft } : null,
                    ]}
                    onPress={() => handleToggleSuggestionVote().catch(() => null)}
                  >
                    <Text style={[styles.votingVoteBtnText, suggestionUserVoted ? [styles.votingVoteBtnTextActive, { color: accent }] : null]}>
                      {suggestionUserVoted ? '▲ Voted' : '△ Vote'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.votingDivider} />
              </>
            )}
            {/* ── End Feature Voting ─────────────────────────────────── */}
          </>
        ) : null}

        {tab === 'leaderboard' ? (
          <>
            <View style={{ flexDirection: 'row', gap: 7, marginBottom: 14 }}>
              <Pressable
                style={leaderboardScope === 'week' ? [styles.btnPrimarySmall, { backgroundColor: accent }] : [styles.btnGhostSmall, { borderColor: accentBorder }]}
                onPress={() => setLeaderboardScope('week')}
              >
                <Text style={leaderboardScope === 'week' ? styles.btnPrimarySmallText : [styles.btnGhostSmallText, { color: accent }]}>This Week</Text>
              </Pressable>
              <Pressable
                style={leaderboardScope === 'month' ? [styles.btnPrimarySmall, { backgroundColor: accent }] : [styles.btnGhostSmall, { borderColor: accentBorder }]}
                onPress={() => setLeaderboardScope('month')}
              >
                <Text style={leaderboardScope === 'month' ? styles.btnPrimarySmallText : [styles.btnGhostSmallText, { color: accent }]}>This Month</Text>
              </Pressable>
              <Pressable
                style={leaderboardScope === 'allTime' ? [styles.btnPrimarySmall, { backgroundColor: accent }] : [styles.btnGhostSmall, { borderColor: accentBorder }]}
                onPress={() => setLeaderboardScope('allTime')}
              >
                <Text style={leaderboardScope === 'allTime' ? styles.btnPrimarySmallText : [styles.btnGhostSmallText, { color: accent }]}>All Time</Text>
              </Pressable>
            </View>
            <View style={[styles.aiContextCard, { borderColor: accentStrongBorder, backgroundColor: accentSoft }]}>
              <Text style={[styles.aiContextTitle, { color: accent }]}>REAL SCOREBOARD</Text>
              <Text style={styles.aiContextBody}>
                Your row reflects live app data. The filters now switch between weekly, monthly, and all-time workout pace pulled from your logged training history.
              </Text>
            </View>
            {leaderboardRows.map((item) => {
              const isMe = item.name === `${displayName} (You)`;
              const initials = isMe ? getInitials(displayName) : String(item.rank);
              const avaStyle = getThemeAvatarColors(
                item.themeId,
                USER_AVA_COLORS[initials] ?? { bg: item.rank === 1 ? C.orange : item.rank === 2 ? C.blue : item.rank === 3 ? C.purple : C.green, text: item.rank === 1 ? '#000' : '#fff' },
              );
              return (
                <Pressable
                  key={item.name}
                  style={[styles.lbRow, isMe ? [styles.lbRowMe, { borderColor: accent }] : null]}
                  onPress={() => !isMe && openUserProfile({
                    name: item.name,
                    initials,
                    avatarUrl: isMe ? profile?.avatarUrl : undefined,
                    isCoach: isMe ? profile?.isCoach : false,
                    title: isMe ? profile?.selectedTitle : undefined,
                  })}
                  disabled={isMe}
                >
                  <Text style={[styles.lbRank, { color: item.rank === 1 ? '#FFD700' : item.rank === 2 ? '#C0C0C0' : item.rank === 3 ? '#CD7F32' : accent }]}>{item.rank}</Text>
                  <View style={[styles.lbAva, { backgroundColor: isMe && profile?.avatarUrl ? 'transparent' : avaStyle.bg, overflow: 'hidden' }]}>
                    {isMe && profile?.avatarUrl ? (
                      <Image source={{ uri: profile.avatarUrl }} style={styles.lbAvaImage} />
                    ) : (
                      <Text style={[styles.lbAvaText, { color: avaStyle.text }]}>{initials}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.lbNameRow}>
                      <Text style={styles.lbName}>{item.name}</Text>
                      {item.isPro ? (
                        <View style={styles.lbProPill}>
                          <Text style={styles.lbProPillText}>PRO</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.lbStreak}>{item.meta}</Text>
                    <Text style={styles.lbMeta}>{item.sub}</Text>
                  </View>
                  <Text style={[styles.lbPts, isMe ? { color: accent } : null]}>{item.pts.toLocaleString()} PTS</Text>
                </Pressable>
              );
            })}

            {/* Achievements grid */}
            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Your Achievements</Text>
            <View style={styles.achieveGrid}>
              {achievements.filter((badge) => badge.earned).map((badge) => (
                <Pressable
                  key={badge.id}
                  style={[styles.achieveCard, { borderColor: accentStrongBorder }]}
                  onPress={() => handleShareAchievement(badge)}
                >
                  <Text style={styles.achieveIcon}>{badge.icon}</Text>
                  <Text style={styles.achieveLabel}>{badge.name}</Text>
                  <Text style={styles.achieveMeta}>{badge.progressLabel}</Text>
                  <Text style={[styles.achieveShare, { color: accent }]}>SHARE ↗</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {tab === 'challenges' ? (
          <>
            <View style={[styles.aiContextCard, { borderColor: accentStrongBorder, backgroundColor: accentSoft }]}>
              <Text style={[styles.aiContextTitle, { color: accent }]}>LIVE PROGRESS</Text>
              <Text style={styles.aiContextBody}>
                These challenge cards now read from your actual step count, protein intake, and hydration progress instead of fake member counts or demo percentages.
              </Text>
            </View>
            {challenges.map((challenge) => {
              const joined = joinedChallenges.includes(challenge.id);
              const accentColor = accent;
              return (
                <View key={challenge.id} style={[styles.chalCard, { borderColor: joined ? accentColor : accentBorder }]}>
                  <View style={styles.chalHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chalTitle}>{challenge.title}</Text>
                      <Text style={styles.chalMeta}>Live from your app today</Text>
                    </View>
                    <Pressable
                      style={joined ? [styles.btnPrimarySmall, { backgroundColor: accentColor }] : [styles.btnGhostSmall, { borderColor: accentBorder }]}
                      onPress={() => toggleChallenge(challenge.id).catch(() => null)}
                    >
                      <Text style={joined ? styles.btnPrimarySmallText : [styles.btnGhostSmallText, { color: accentColor }]}>
                        {joined ? 'Joined ✓' : 'Join'}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${challenge.progressPct}%`, backgroundColor: accentColor }]} />
                  </View>
                  <Text style={styles.chalProgress}>{challenge.body}</Text>

                  {/* Enter group button — only visible once joined */}
                  {joined ? (
                    <Pressable
                      style={[styles.chalGroupBtn, { borderColor: accentColor, backgroundColor: accentSoft }]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null); setGroupModalChallenge(challenge); }}
                    >
                      <Text style={[styles.chalGroupBtnText, { color: accentColor }]}>💬 Enter Group Chat  ›</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}

        {tab === 'academy' ? (
          <>
            <Text style={styles.sectionLabel}>APEX Academy</Text>
            {/* Personalised header */}
            <View style={[styles.aiContextCard, { borderColor: C.orange, borderWidth: 1 }]}>
              <Text style={[styles.aiContextTitle, { color: C.orange }]}>⚡ INTERACTIVE AI LEARNING</Text>
              <Text style={styles.aiContextBody}>
                Each lesson has a live AI Coach chat, a quiz, and a share button. Your stats drive the content — the coach challenges you, not just explains to you.
              </Text>
            </View>
            {academyCourses.map((item) => {
              const isBlueprint = item.name === 'Your APEX Blueprint';
              const locked = item.proOnly && !isPro;
              const active = !locked && (item.completed > 0 || isBlueprint);
              const pct = Math.min(100, Math.round((item.completed / item.modules) * 100));
              return (
                <Pressable
                  key={item.name}
                  style={[
                    styles.progCard,
                    { borderColor: locked ? C.border : (active ? item.accentColor : C.border) },
                    isBlueprint && { borderWidth: 1.5 },
                  ]}
                  onPress={async () => {
                    if (locked) {
                      await maybeShowPaywall(session?.user?.id).catch(() => null);
                      navigation.navigate('Upgrade');
                      return;
                    }
                    openAcademyCourse(item).catch(() => null);
                  }}
                >
                  <View style={[styles.progThumb, { backgroundColor: locked ? 'rgba(255,255,255,0.04)' : item.accent }]}>
                    <Text style={{ fontSize: 36 }}>{locked ? '🔒' : item.icon}</Text>
                  </View>
                  <View style={styles.progBody}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.progName}>{item.name}</Text>
                      {isBlueprint && isPro && (
                        <View style={[styles.acBadge, { backgroundColor: 'rgba(255,107,53,0.18)', borderColor: C.orange }]}>
                          <Text style={[styles.acBadgeText, { color: C.orange }]}>PERSONALISED</Text>
                        </View>
                      )}
                      {isBlueprint && !isPro && (
                        <View style={[styles.acBadge, { backgroundColor: 'rgba(255,200,0,0.15)', borderColor: '#FFD700' }]}>
                          <Text style={[styles.acBadgeText, { color: '#FFD700' }]}>PRO</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.progMeta}>{item.modules} modules · {item.rating} ⭐ · {item.sub}</Text>
                    {locked ? (
                      <Text style={[styles.progTag, { color: '#FFD700' }]}>🔓 Unlock with Pro →</Text>
                    ) : (
                      <Text style={[styles.progTag, { color: active ? item.accentColor : C.muted }]}>
                        {active ? `✅ ${item.completed} / ${item.modules} complete · Open →` : 'Start interactive learning →'}
                      </Text>
                    )}
                    <View style={[styles.barTrack, { marginTop: 8, marginBottom: 0 }]}>
                      <View style={[styles.barFill, { width: locked ? '0%' : `${pct}%`, backgroundColor: item.accentColor }]} />
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      <PostModal
        author={displayName}
        visible={postVisible}
        onClose={() => setPostVisible(false)}
        onPosted={() => loadCustomPosts()}
      />
      <CommentsModal
        author={displayName}
        authorAvatarUrl={profile?.avatarUrl}
        visible={commentsVisible}
        postId={activeCommentPostId}
        onClose={() => setCommentsVisible(false)}
        onCommentAdded={() => loadCustomPosts()}
      />
      <Modal visible={academyVisible} transparent animationType="slide" onRequestClose={dismissAcademy}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={24}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissAcademy} />
          <Animated.View style={[styles.modal, { maxHeight: '92%', transform: [{ translateY: academySlideY }] }]}>
            {/* Drag handle — swipe down to dismiss */}
            <View {...academyPan.panHandlers} style={styles.acHandleArea}>
              <View style={styles.modalHandle} />
            </View>

            {/* ── Header ── */}
            <View style={styles.acHeader}>
              {activeModule ? (
                <Pressable onPress={() => setActiveModule(null)} hitSlop={10} style={styles.acBackBtn}>
                  <Text style={styles.acBackText}>‹ Modules</Text>
                </Pressable>
              ) : (
                <View style={{ width: 70 }} />
              )}
              <Text style={[styles.modalTitle, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                {activeModule ? activeModule.title.toUpperCase() : (academyCourseTitle || 'ACADEMY').toUpperCase()}
              </Text>
              {activeModule ? (
                <Pressable onPress={() => handleShareInsight(activeModule, academyCourseTitle)} hitSlop={10} style={styles.acShareBtn}>
                  <Text style={styles.acShareText}>↗ Share</Text>
                </Pressable>
              ) : (
                <Pressable onPress={dismissAcademy} hitSlop={10} style={styles.acShareBtn}>
                  <Text style={[styles.acShareText, { color: C.muted }]}>✕</Text>
                </Pressable>
              )}
            </View>

            {/* ── Loading ── */}
            {academyLoading ? (
              <View style={styles.academyLoadingWrap}>
                <ActivityIndicator size="large" color={academyCourseAccent} />
                <Text style={styles.commentEmpty}>Building your personalised modules…</Text>
              </View>

            ) : activeModule ? (
              <>
                {/* Tab row */}
                <View style={styles.acTabRow}>
                  {(['lesson', 'coach', 'quiz'] as const).map((t) => (
                    <Pressable
                      key={t}
                      style={[styles.acTab, academyModuleTab === t && { borderBottomColor: academyCourseAccent, borderBottomWidth: 2 }]}
                      onPress={() => setAcademyModuleTab(t)}
                    >
                      <Text style={[styles.acTabText, academyModuleTab === t && { color: academyCourseAccent }]}>
                        {t === 'lesson' ? '📖 LESSON' : t === 'coach' ? '🤖 ASK COACH' : '🎯 QUIZ'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* ── LESSON tab ── */}
                {academyModuleTab === 'lesson' ? (
                  <ScrollView style={styles.commentList} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
                    {/* AI Voice button */}
                    <Pressable
                      style={[styles.acVoiceBtn, academySpeaking && styles.acVoiceBtnActive]}
                      onPress={async () => {
                        if (academySpeaking) return;
                        const elevenKey = env.elevenLabsApiKey;
                        if (!elevenKey) {
                          Alert.alert('Voice unavailable', 'Add your ElevenLabs key and restart the app to use AI voice.');
                          return;
                        }
                        setAcademySpeaking(true);
                        try {
                          const lessonText = [
                            activeModule.title + '.',
                            activeModule.summary,
                            ...activeModule.bullets,
                            'Your action: ' + activeModule.action,
                          ].join(' ');
                          await speakWithElevenLabs(lessonText, elevenKey ?? '');
                        } catch { /* ignore — TTS is non-critical */ } finally {
                          setAcademySpeaking(false);
                        }
                      }}
                    >
                      <Text style={[styles.acVoiceIcon, academySpeaking && { color: academyCourseAccent }]}>
                        {academySpeaking ? '🔊' : '▶'}
                      </Text>
                      <Text style={[styles.acVoiceText, academySpeaking && { color: academyCourseAccent }]}>
                        {academySpeaking ? 'Playing…' : 'Listen to Lesson'}
                      </Text>
                    </Pressable>
                    <Text style={styles.commentBody}>{activeModule.summary}</Text>
                    {activeModule.bullets.map((b) => (
                      <View key={b} style={styles.acBulletRow}>
                        <Text style={[styles.acBulletDot, { color: academyCourseAccent }]}>▸</Text>
                        <Text style={styles.acBulletText}>{b}</Text>
                      </View>
                    ))}
                    <View style={[styles.aiContextCard, { borderColor: academyCourseAccent + '44' }]}>
                      <Text style={[styles.aiContextTitle, { color: academyCourseAccent }]}>YOUR NEXT ACTION</Text>
                      <Text style={styles.aiContextBody}>{activeModule.action}</Text>
                    </View>
                    {/* Apply to my data shortcut */}
                    <Pressable
                      style={[styles.acApplyBtn, { borderColor: academyCourseAccent }]}
                      onPress={applyToMyData}
                    >
                      <Text style={[styles.acApplyText, { color: academyCourseAccent }]}>⚡ Apply this to MY data →</Text>
                    </Pressable>
                    {/* Complete button */}
                    <Pressable
                      style={[styles.btnPrimary, completedModules.has(activeModule.id) && { backgroundColor: `${accent}20`, borderWidth: 1, borderColor: accent }]}
                      onPress={() => markModuleComplete(activeModule.id)}
                    >
                      <Text style={[styles.btnPrimaryText, completedModules.has(activeModule.id) && { color: accent }]}>
                        {completedModules.has(activeModule.id) ? '✓ Module Complete' : 'Mark Complete'}
                      </Text>
                    </Pressable>
                  </ScrollView>

                ) : academyModuleTab === 'coach' ? (
                  /* ── COACH CHAT tab ── */
                  <>
                    <ScrollView
                      ref={academyChatRef}
                      style={styles.commentList}
                      contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
                      onContentSizeChange={() => academyChatRef.current?.scrollToEnd({ animated: true })}
                    >
                      {academyChat.map((msg) => (
                        <View key={msg.id} style={[styles.acChatBubble, msg.role === 'user' ? styles.acChatBubbleUser : styles.acChatBubbleCoach]}>
                          {msg.role === 'coach' && (
                            <Text style={styles.acChatLabel}>🤖 COACH</Text>
                          )}
                          <Text style={styles.acChatText}>{msg.text}</Text>
                        </View>
                      ))}
                      {academyChatLoading && (
                        <View style={styles.acChatBubbleCoach}>
                          <Text style={styles.acChatLabel}>🤖 COACH</Text>
                          <ActivityIndicator size="small" color={academyCourseAccent} />
                        </View>
                      )}
                    </ScrollView>
                    <View style={styles.acChatInputRow}>
                      <TextInput
                        style={styles.acChatInput}
                        value={academyChatInput}
                        onChangeText={setAcademyChatInput}
                        placeholder="Ask the coach anything…"
                        placeholderTextColor={C.muted}
                        returnKeyType="send"
                        onSubmitEditing={sendAcademyChat}
                        multiline
                      />
                      <Pressable
                        style={[styles.acChatSend, { backgroundColor: academyCourseAccent }]}
                        onPress={sendAcademyChat}
                        disabled={!academyChatInput.trim() || academyChatLoading}
                      >
                        <Text style={styles.acChatSendText}>↑</Text>
                      </Pressable>
                    </View>
                  </>

                ) : (
                  /* ── QUIZ tab ── */
                  <ScrollView style={styles.commentList} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
                    {activeModule.quiz ? (
                      <>
                        <Text style={styles.acQuizQuestion}>{activeModule.quiz.question}</Text>
                        {activeModule.quiz.options.map((opt, i) => {
                          const isSelected = academyQuizAnswer === i;
                          const isCorrect = i === activeModule.quiz!.correctIndex;
                          const answered = academyQuizAnswer !== null;
                          let bgColor = 'transparent';
                          let borderColor: string = C.border;
                          if (answered && isSelected && isCorrect) { bgColor = `${accent}12`; borderColor = accent; }
                          else if (answered && isSelected && !isCorrect) { bgColor = 'rgba(255,107,53,0.12)'; borderColor = C.orange; }
                          else if (answered && isCorrect) { bgColor = `${accent}06`; borderColor = accent; }
                          return (
                            <Pressable
                              key={i}
                              style={[styles.acQuizOption, { backgroundColor: bgColor, borderColor }]}
                              onPress={async () => {
                                if (academyQuizAnswer !== null) return;
                                await Haptics.selectionAsync();
                                setAcademyQuizAnswer(i);
                                const nextResults = {
                                  ...academyQuizResults,
                                  [activeModule.id]: {
                                    answerIndex: i,
                                    correctIndex: activeModule.quiz!.correctIndex,
                                    answeredAt: new Date().toISOString(),
                                  },
                                };
                                setAcademyQuizResults(nextResults);
                                await AsyncStorage.setItem(ACADEMY_QUIZ_RESULTS_KEY, JSON.stringify(nextResults)).catch(() => null);
                              }}
                            >
                              <Text style={[styles.acQuizOptionText, answered && isCorrect && { color: accent }, answered && isSelected && !isCorrect && { color: C.orange }]}>
                                {opt}
                              </Text>
                              {answered && isCorrect && <Text style={{ color: accent }}>✓</Text>}
                              {answered && isSelected && !isCorrect && <Text style={{ color: C.orange }}>✗</Text>}
                            </Pressable>
                          );
                        })}
                        {academyQuizAnswer !== null && (
                          <>
                            <View style={[styles.aiContextCard, { borderColor: academyQuizAnswer === activeModule.quiz.correctIndex ? accent + '44' : C.orange + '44' }]}>
                              <Text style={[styles.aiContextTitle, { color: academyQuizAnswer === activeModule.quiz.correctIndex ? accent : C.orange }]}>
                                {academyQuizAnswer === activeModule.quiz.correctIndex ? 'CORRECT ✓' : 'NOT QUITE'}
                              </Text>
                              <Text style={styles.aiContextBody}>
                                {academyQuizAnswer === activeModule.quiz.correctIndex
                                  ? `Score: 100%. Great answer. Now go apply it — tap "Ask Coach" to go deeper on this.`
                                  : `Score: 0%. You picked "${activeModule.quiz.options[academyQuizAnswer]}". The right answer is "${activeModule.quiz.options[activeModule.quiz.correctIndex]}".`}
                              </Text>
                            </View>
                            <View style={[styles.aiContextCard, { borderColor: C.border }]}>
                              <Text style={styles.aiContextTitle}>QUIZ ACTIONS</Text>
                              <Text style={styles.aiContextBody}>
                                {academyQuizAnswer === activeModule.quiz.correctIndex
                                  ? 'You can move on, or retake the quiz if you want to reinforce it.'
                                  : 'Review the wrong answer, ask the coach why it was off, or retake the quiz now.'}
                              </Text>
                              <Pressable style={[styles.btnGhost, { marginTop: 10 }]} onPress={() => handleRetakeQuiz().catch(() => null)}>
                                <Text style={styles.btnGhostText}>Retake Quiz</Text>
                              </Pressable>
                            </View>
                          </>
                        )}
                      </>
                    ) : (
                      <Text style={styles.commentEmpty}>No quiz for this module yet.</Text>
                    )}
                  </ScrollView>
                )}
              </>

            ) : (
              /* ── Module list ── */
              <ScrollView style={styles.commentList} contentContainerStyle={{ gap: 8 }}>
                {academyModules.map((module, index) => {
                  const done = completedModules.has(module.id);
                  return (
                    <Pressable key={module.id} style={[styles.moduleCard, done && { borderColor: academyCourseAccent + '66' }]} onPress={() => openModule(module)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={[styles.moduleIndex, { color: academyCourseAccent }]}>MODULE {index + 1}</Text>
                        {done && <Text style={[styles.moduleIndex, { color: academyCourseAccent }]}>✓ DONE</Text>}
                      </View>
                      <Text style={styles.moduleTitle}>{module.title}</Text>
                      <Text style={styles.moduleSummary}>{module.summary}</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                        <Text style={[styles.moduleAction, { color: academyCourseAccent }]}>📖 Lesson</Text>
                        <Text style={styles.moduleAction}>· 🤖 Coach</Text>
                        <Text style={styles.moduleAction}>· 🎯 Quiz</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Challenge Group Chat */}
      <ChallengeGroupModal
        visible={groupModalChallenge !== null}
        challenge={groupModalChallenge}
        displayName={displayName}
        myAvatarUrl={profile?.avatarUrl}
        onClose={() => setGroupModalChallenge(null)}
        onViewProfile={(name, inits) => {
          setGroupModalChallenge(null);
          // Small delay so the group modal has time to close before profile opens
          setTimeout(() => openUserProfile({ name, initials: inits }), 250);
        }}
      />

      {/* User profile viewer — tapping any non-"you" name/avatar opens this */}
      <UserProfileModal
        visible={profileModalTarget !== null}
        targetName={profileModalTarget?.name ?? ''}
        targetInitials={profileModalTarget?.initials ?? ''}
        targetAvatarUrl={profileModalTarget?.avatarUrl}
        targetBio={profileModalTarget?.bio}
        targetIsCoach={profileModalTarget?.isCoach}
        targetTitle={profileModalTarget?.title}
        onClose={() => setProfileModalTarget(null)}
      />

      {/* ── Off-screen story card for social sharing ─────────────────────────── */}
      {storyCardData && (
        <ViewShot
          ref={storyCardRef}
          options={{ format: 'png', quality: 1.0, width: 1080, height: 1920 }}
          style={styles.storyCardOffscreen}
        >
          <View style={styles.storyCard}>
            <View style={styles.storyBg} />
            {/* ── Top: branding ── */}
            <View style={styles.storyTop}>
              <Text style={styles.storyBrand}>APEX</Text>
              <Text style={styles.storyBrandSub}>FITNESS ACADEMY</Text>
            </View>
            {/* ── Middle: quote + course pill + streak ── */}
            <View style={styles.storyMiddle}>
              <View style={styles.storyQuoteWrap}>
                <Text style={styles.storyQuoteMark}>"</Text>
                <Text style={styles.storyQuoteText}>{storyCardData.snippet}</Text>
                <Text style={[styles.storyQuoteMark, { alignSelf: 'flex-end' }]}>"</Text>
              </View>
              <View style={styles.storyCoursePill}>
                <Text style={styles.storyCourseText}>📚 {storyCardData.courseName}</Text>
              </View>
              {stats.streak > 0 && (
                <Text style={styles.storyStreakText}>🔥 {stats.streak} day streak</Text>
              )}
            </View>
            {/* ── Bottom: CTA (always visible, never overlapping) ── */}
            <View style={styles.storyBottom}>
              <View style={styles.storyDivider} />
              <Text style={styles.storyFooterText}>Download APEX · Build the body you deserve</Text>
            </View>
          </View>
        </ViewShot>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 32 },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.black,
  },
  tabBtn: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBtnActive: { borderColor: C.border, backgroundColor: C.dark },
  tabBtnText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_500Medium' },
  tabBtnTextActive: { color: C.green },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontFamily: 'SpaceMono_400Regular' },
  postCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  postHead: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 },
  postAva: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postAvaText: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  postAvaImage: { width: '100%', height: '100%', borderRadius: 19 },
  postAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  postAuthor: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 13 },
  postAuthorTitle: { color: C.subtle, fontFamily: 'DMSans_400Regular', fontSize: 10, marginTop: 1 },
  postTime: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 11 },
  coachChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.45)',
    backgroundColor: 'rgba(255,107,53,0.12)',
  },
  coachChipText: { color: C.orange, fontFamily: 'SpaceMono_400Regular', fontSize: 9 },
  postBody: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20 },
  postVideo: { width: '100%', height: 200, borderRadius: 10, marginTop: 10, backgroundColor: '#000' },
  postActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  postAction: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: C.dark,
  },
  postActionLiked: { borderWidth: 1, borderColor: C.greenStrongBorder },
  aiContextCard: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  aiContextTitle: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  aiContextBody: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 19,
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    marginBottom: 8,
  },
  lbRowMe: { borderColor: C.green },
  lbRank: { color: C.green, fontFamily: 'BebasNeue_400Regular', fontSize: 22, width: 24, textAlign: 'center' },
  lbAva: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbAvaText: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 11 },
  lbAvaImage: { width: '100%', height: '100%' },
  lbNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lbName: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 13 },
  lbProPill: {
    backgroundColor: C.greenSoft,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.green,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  lbProPillText: { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 9, fontWeight: '700' },
  lbStreak: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 11 },
  lbMeta: { color: C.subtle, fontFamily: 'DMSans_400Regular', fontSize: 10, marginTop: 2 },
  lbPts: { color: C.green, fontFamily: 'SpaceMono_400Regular', fontSize: 12 },
  sectionLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 10,
  },
  chalCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  chalHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  chalTitle: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 18, letterSpacing: 1 },
  chalMeta: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 11, marginTop: 2 },
  chalProgress: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 11, marginTop: 5 },
  chalGroupBtn: {
    marginTop: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  chalGroupBtnText: { fontSize: 13, fontFamily: 'DMSans_700Bold' },
  barTrack: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden', marginBottom: 5 },
  barFill: { height: '100%', borderRadius: 2 },
  progCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
    flexDirection: 'column',
  },
  progThumb: { height: 70, alignItems: 'center', justifyContent: 'center' },
  progBody: { padding: 12 },
  progName: { fontSize: 14, color: C.text, fontFamily: 'DMSans_500Medium', marginBottom: 3 },
  progMeta: { fontSize: 11, color: C.muted, fontFamily: 'SpaceMono_400Regular' },
  progTag: { fontSize: 10, color: C.muted, marginTop: 5, fontFamily: 'SpaceMono_400Regular' },
  btnPrimarySmall: {
    backgroundColor: C.green,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  btnPrimarySmallText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 12 },
  btnGhostSmall: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  btnGhostSmallText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 12 },
  btnPrimary: {
    backgroundColor: C.green,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  btnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnGhostText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 32,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, letterSpacing: 2, color: C.text, marginBottom: 16 },
  formLabel: { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'SpaceMono_400Regular', marginBottom: 5 },
  formInput: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
  },
  modalBtns: { flexDirection: 'row', gap: 8 },
  commentList: {
    maxHeight: 220,
    marginBottom: 12,
  },
  commentCard: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
  },
  commentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  commentAvatarText: {
    fontSize: 11,
    fontFamily: 'DMSans_700Bold',
  },
  commentAuthor: {
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  commentBody: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  commentEmpty: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 8,
  },
  academyLoadingWrap: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 12,
  },
  moduleCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
  },
  moduleIndex: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 6,
  },
  moduleTitle: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    marginBottom: 4,
  },
  moduleSummary: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  moduleAction: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
  },

  // ── Academy interactive styles ────────────────────────────────────────────
  acHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  // ── Story card (off-screen, captured by ViewShot for social sharing) ─────────
  storyCardOffscreen: { position: 'absolute', left: -2000, top: 0, width: 390, height: 693 },
  storyCard: { flex: 1, backgroundColor: '#0a0a0a', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 32, paddingTop: 40, paddingBottom: 28 },
  storyBg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0a0a0a' },
  storyTop: { alignItems: 'center', width: '100%' },
  storyMiddle: { alignItems: 'center', width: '100%', gap: 14, flex: 1, justifyContent: 'center' },
  storyBottom: { alignItems: 'center', width: '100%', gap: 10 },
  storyDivider: { width: 40, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  storyBrand: { color: '#00FF87', fontFamily: 'BebasNeue_400Regular', fontSize: 52, letterSpacing: 8, textAlign: 'center' },
  storyBrandSub: { color: 'rgba(255,255,255,0.4)', fontFamily: 'DMSans_500Medium', fontSize: 12, letterSpacing: 4, textAlign: 'center', marginTop: -10 },
  storyQuoteWrap: { width: '100%', backgroundColor: 'rgba(0,255,135,0.06)', borderWidth: 1, borderColor: 'rgba(0,255,135,0.25)', borderRadius: 20, padding: 24, gap: 4 },
  storyQuoteMark: { color: '#00FF87', fontFamily: 'BebasNeue_400Regular', fontSize: 56, lineHeight: 48, alignSelf: 'flex-start' },
  storyQuoteText: { color: '#fff', fontFamily: 'BebasNeue_400Regular', fontSize: 30, lineHeight: 36, letterSpacing: 0.5, textAlign: 'center' },
  storyCoursePill: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  storyCourseText: { color: 'rgba(255,255,255,0.7)', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  storyStreakText: { color: '#FF6B35', fontFamily: 'DMSans_700Bold', fontSize: 16, letterSpacing: 0.5 },
  storyFooterText: { color: 'rgba(255,255,255,0.35)', fontFamily: 'DMSans_400Regular', fontSize: 13, textAlign: 'center', letterSpacing: 0.3 },
  // ── Academy modal handle ───────────────────────────────────────────────────
  acHandleArea: { alignItems: 'center', paddingVertical: 6, marginTop: -6, marginHorizontal: -24 },
  acBackBtn: { width: 70 },
  acBackText: { fontSize: 14, color: C.green, fontFamily: 'DMSans_500Medium' },
  acShareBtn: { width: 70, alignItems: 'flex-end' },
  acShareText: { fontSize: 13, color: C.green, fontFamily: 'DMSans_500Medium' },
  acTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginBottom: 10,
  },
  acTab: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  acTabText: {
    fontSize: 10,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 0.5,
  },
  acBulletRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  acBulletDot: {
    fontSize: 14,
    marginTop: 1,
    flexShrink: 0,
  },
  acBulletText: {
    flex: 1,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
  },
  acApplyBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  acApplyText: {
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
  },
  acVoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: C.card,
  },
  acVoiceBtnActive: {
    borderColor: C.green,
    backgroundColor: 'rgba(0,255,135,0.06)',
  },
  acVoiceIcon: {
    fontSize: 16,
    color: C.muted,
  },
  acVoiceText: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: C.muted,
  },
  acChatBubble: {
    borderRadius: 12,
    padding: 12,
    maxWidth: '90%',
  },
  acChatBubbleUser: {
    backgroundColor: 'rgba(0,255,135,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.2)',
    alignSelf: 'flex-end',
  },
  acChatBubbleCoach: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    alignSelf: 'flex-start',
    minWidth: 80,
  },
  acChatLabel: {
    fontSize: 9,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    marginBottom: 4,
  },
  acChatText: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
  },
  acChatInputRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  acChatInput: {
    flex: 1,
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    maxHeight: 80,
  },
  acChatSend: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  acChatSendText: {
    color: '#000',
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
  },
  acQuizQuestion: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    letterSpacing: 0.8,
    lineHeight: 26,
    marginBottom: 4,
  },
  acQuizOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  acQuizOptionText: {
    flex: 1,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  acBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  acBadgeText: {
    fontSize: 8,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 0.5,
  },
  academyModuleTitle: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 26,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  academyBullet: {
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
  },
  achieveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  achieveCard: {
    width: '30.5%',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  achieveCardLocked: { borderColor: C.border, backgroundColor: C.dark },
  achieveIcon: { fontSize: 26 },
  achieveLabel: {
    fontSize: 9,
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    textAlign: 'center',
    lineHeight: 13,
  },
  achieveMeta: {
    fontSize: 8,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    textAlign: 'center',
    lineHeight: 11,
  },
  achieveLock: { fontSize: 9 },
  achieveShare: { fontSize: 8, color: C.green, fontFamily: 'SpaceMono_400Regular' },
  // Badge chip selector in PostModal
  badgeChooser: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  badgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  badgeChipIcon: {
    fontSize: 14,
  },
  badgeChipLabel: {
    fontSize: 12,
    color: C.subtle,
    fontFamily: 'DMSans_400Regular',
  },
  feedLimitCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    gap: 4,
  },
  feedLimitTitle: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
  feedLimitText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },

  // ── Feature Voting styles ────────────────────────────────────────────────
  votingSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
  },
  votingSectionTitle: {
    fontSize: 10,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  votingSuggestBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  votingSuggestBtnText: {
    fontSize: 11,
    color: C.green,
    fontFamily: 'DMSans_500Medium',
  },
  votingComposeCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  votingComposeInput: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  votingPinnedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  votingPinnedEyebrow: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  votingPinnedTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 2,
  },
  votingPinnedMeta: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  votingPinnedBtn: {
    minWidth: 76,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  votingPinnedBtnActive: {
    backgroundColor: C.green,
    borderColor: C.greenStrongBorder,
  },
  votingPinnedBtnText: {
    color: C.text,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  votingPinnedBtnTextActive: {
    color: '#000',
  },
  votingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  votingCardTitle: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 2,
  },
  votingCardMeta: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
  },
  votingVoteBtn: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.dark,
    minWidth: 64,
    alignItems: 'center',
  },
  votingVoteBtnActive: {
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
  },
  votingVoteBtnText: {
    fontSize: 11,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
  },
  votingVoteBtnTextActive: {
    color: C.green,
  },
  votingEmptyCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  votingEmptyText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  votingDivider: {
    height: 1,
    backgroundColor: C.border,
    marginBottom: 14,
  },
});
