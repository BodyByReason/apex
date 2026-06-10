/**
 * WalkWaterCommunityScreen — Walk & Water Challenge Edition
 *
 * Leaderboard: backed by Supabase ww_daily_stats.
 * Chat: backed by Supabase ww_chat_messages with Realtime subscription
 *       so all users see each other's messages live.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getWaterOzToday, getWalkWaterStreak } from '@/lib/walkWaterMode';
import { upsertMyStats, fetchLeaderboard, fetch3DayLeaderboard, mostRecentTuesdayAZ, type LeaderboardEntry } from '@/lib/wwLeaderboard';
import { getDailyWalkTotals } from '@/lib/walkRecords';
import { useHealth } from '@/hooks/useHealth';

const GROUP_URL = 'https://www.facebook.com/groups/3daywalkandwaterchallenge';
const CHAT_LIMIT = 100;

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black:      '#050A14',
  card:       '#0D1B2A',
  border:     '#1A2E45',
  blue:       '#0EA5E9',
  blueSoft:   'rgba(14,165,233,0.08)',
  blueBorder: 'rgba(14,165,233,0.2)',
  text:       '#F0F8FF',
  muted:      '#6B8BA4',
};

function toInitials(username: string): string {
  const parts = username.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ChatMsg = {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
};

type Tab = 'leaderboard' | 'chat';
type LeaderboardMode = '3day' | 'global';

// ─── WalkWaterCommunityScreen ─────────────────────────────────────────────────

export default function WalkWaterCommunityScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const myUserId    = session?.user?.id;
  const displayName = (session?.user?.user_metadata?.display_name as string | undefined) ?? 'Anonymous';

  const [tab, setTab] = useState<Tab>('leaderboard');

  // ── Leaderboard ──────────────────────────────────────────────────────────────
  const [leaderboardMode, setLeaderboardMode] = useState<LeaderboardMode>('3day');
  const [globalBoard, setGlobalBoard]   = useState<LeaderboardEntry[]>([]);
  const [weekBoard, setWeekBoard]       = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const { steps: mySteps } = useHealth();

  // Label for the active 3-day challenge week
  const challengeWeekLabel = (() => {
    const tuesday = mostRecentTuesdayAZ();
    const d = new Date(`${tuesday}T12:00:00Z`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  })();

  useFocusEffect(useCallback(() => {
    let cancelled = false;

    async function syncAndLoad() {
      const [oz, streak, walkTotals] = await Promise.all([
        getWaterOzToday(),
        getWalkWaterStreak(),
        getDailyWalkTotals(),
      ]);
      const waterGlasses  = Math.round(oz / 8);
      const combinedSteps = Math.max(mySteps, walkTotals.steps);

      // Upsert is best-effort — a failure (e.g. auth timing after sign-in)
      // must not prevent the board from loading.
      try {
        await upsertMyStats(combinedSteps, waterGlasses, streak, displayName);
      } catch (e) {
        console.warn('[Community] upsertMyStats failed (non-fatal):', e);
      }

      // Fetch both boards independently so one failure can't blank both.
      const [globalEntries, weekEntries] = await Promise.all([
        fetchLeaderboard().catch((e) => { console.warn('[Community] fetchLeaderboard threw:', e); return [] as LeaderboardEntry[]; }),
        fetch3DayLeaderboard().catch((e) => { console.warn('[Community] fetch3DayLeaderboard threw:', e); return [] as LeaderboardEntry[]; }),
      ]);
      if (!cancelled) {
        setGlobalBoard(globalEntries);
        setWeekBoard(weekEntries);
        setLeaderboardLoading(false);
      }
    }

    setLeaderboardLoading(true);
    syncAndLoad().catch((e) => {
      console.warn('[Community] syncAndLoad error:', e?.message ?? e);
      setLeaderboardLoading(false);
    });

    return () => { cancelled = true; };
  }, [displayName, mySteps, myUserId]));

  // Boards arrive pre-sorted by composite score from wwLeaderboard.ts
  const activeBoard = leaderboardMode === '3day' ? weekBoard : globalBoard;
  const requiresAccount = !myUserId;

  // ── Chat ─────────────────────────────────────────────────────────────────────
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [input, setInput] = useState('');

  // ── Likes (double-tap to ❤️) ───────────────────────────────────────────────
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [myLikes, setMyLikes] = useState<Set<string>>(new Set());
  // Tracks the last tap to detect a double-tap without an extra dependency.
  const lastTapRef = useRef<{ id: string; t: number } | null>(null);

  useEffect(() => {
    // Initial load
    supabase
      .from('ww_chat_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(CHAT_LIMIT)
      .then(({ data }) => {
        if (data) setMsgs(data as ChatMsg[]);
        setChatLoading(false);
      })
      .catch(() => setChatLoading(false));

    // Realtime — new messages from any user appear instantly
    const channel = supabase
      .channel('ww_chat_messages_feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ww_chat_messages' },
        (payload) => {
          setMsgs((prev) => {
            // Deduplicate in case our own insert fires before the subscription
            if (prev.some((m) => m.id === (payload.new as ChatMsg).id)) return prev;
            return [...prev, payload.new as ChatMsg];
          });
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Load existing likes + subscribe to live like changes.
  useEffect(() => {
    supabase
      .from('ww_chat_message_reactions')
      .select('message_id, user_id')
      .then(({ data }) => {
        if (!data) return;
        const counts: Record<string, number> = {};
        const mine = new Set<string>();
        for (const r of data as { message_id: string; user_id: string }[]) {
          counts[r.message_id] = (counts[r.message_id] ?? 0) + 1;
          if (r.user_id === myUserId) mine.add(r.message_id);
        }
        setLikeCounts(counts);
        setMyLikes(mine);
      })
      .catch(() => null);

    const channel = supabase
      .channel('ww_chat_reactions_feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ww_chat_message_reactions' },
        (payload) => {
          const r = payload.new as { message_id: string; user_id: string };
          // Our own likes are already applied optimistically — skip the echo.
          if (r.user_id === myUserId) return;
          setLikeCounts((prev) => ({ ...prev, [r.message_id]: (prev[r.message_id] ?? 0) + 1 }));
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'ww_chat_message_reactions' },
        (payload) => {
          const r = payload.old as { message_id?: string; user_id?: string };
          if (!r?.message_id || r.user_id === myUserId) return;
          setLikeCounts((prev) => ({
            ...prev,
            [r.message_id!]: Math.max(0, (prev[r.message_id!] ?? 0) - 1),
          }));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [myUserId]);

  const toggleLike = useCallback(async (messageId: string) => {
    const uid = myUserId ?? (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) {
      Alert.alert('Account required', 'Log in to like messages in the group chat.');
      return;
    }
    const liked = myLikes.has(messageId);

    // Optimistic update.
    setMyLikes((prev) => {
      const next = new Set(prev);
      if (liked) next.delete(messageId); else next.add(messageId);
      return next;
    });
    setLikeCounts((prev) => ({
      ...prev,
      [messageId]: Math.max(0, (prev[messageId] ?? 0) + (liked ? -1 : 1)),
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);

    const revert = () => {
      setMyLikes((prev) => {
        const next = new Set(prev);
        if (liked) next.add(messageId); else next.delete(messageId);
        return next;
      });
      setLikeCounts((prev) => ({
        ...prev,
        [messageId]: Math.max(0, (prev[messageId] ?? 0) + (liked ? 1 : -1)),
      }));
    };

    if (liked) {
      const { error } = await supabase
        .from('ww_chat_message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', uid);
      if (error) revert();
    } else {
      const { error } = await supabase
        .from('ww_chat_message_reactions')
        .insert({ message_id: messageId, user_id: uid });
      // A duplicate (23505) means it's already liked — keep the optimistic state.
      if (error && error.code !== '23505') revert();
    }
  }, [myLikes, myUserId]);

  const handleBubbleTap = useCallback((messageId: string) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && last.id === messageId && now - last.t < 300) {
      lastTapRef.current = null;
      toggleLike(messageId);
    } else {
      lastTapRef.current = { id: messageId, t: now };
    }
  }, [toggleLike]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    const activeUserId = myUserId ?? (await supabase.auth.getSession()).data.session?.user?.id;
    if (!activeUserId) {
      Alert.alert(
        'Account required',
        'Create an account or log in to post in the group chat and appear on the leaderboard.',
      );
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { error, data: inserted } = await supabase.from('ww_chat_messages').insert({
      user_id:      activeUserId,
      display_name: displayName,
      body:         text,
    }).select().single();
    if (error) {
      Alert.alert('Could not post', error.message);
      return;
    }
    setInput('');
    // Fan out push notifications to all other users (best-effort, non-blocking).
    supabase.functions.invoke('ww-chat-notify', {
      body: { type: 'INSERT', table: 'ww_chat_messages', record: inserted },
    }).catch(() => null);
  }, [input, myUserId, displayName]);

  // ── Misc ─────────────────────────────────────────────────────────────────────
  const openGroup = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    Linking.openURL(GROUP_URL).catch(() => null);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Challenge Community</Text>
      </View>

      {/* Group join card */}
      <Pressable
        style={({ pressed }) => [styles.groupCard, pressed && { opacity: 0.8 }]}
        onPress={openGroup}
      >
        <View style={styles.groupCardLeft}>
          <Text style={styles.groupCardEmoji}>🔥</Text>
          <View style={styles.groupCardInfo}>
            <Text style={styles.groupCardTitle}>Join the Walk & Water Challenge Group</Text>
            <Text style={styles.groupCardSub}>Daily wins, tips, and accountability.</Text>
          </View>
        </View>
        <Text style={styles.groupCardArrow}>→</Text>
      </Pressable>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['leaderboard', 'chat'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.tabItem, tab === t && styles.tabItemActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'leaderboard' ? '🏆 Leaderboard' : '💬 Group Chat'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Leaderboard tab ── */}
      {tab === 'leaderboard' && (
        <>
          {/* Leaderboard sub-tabs */}
          <View style={styles.subTabBar}>
            <Pressable
              style={[styles.subTabItem, leaderboardMode === '3day' && styles.subTabItemActive]}
              onPress={() => setLeaderboardMode('3day')}
            >
              <Text style={[styles.subTabLabel, leaderboardMode === '3day' && styles.subTabLabelActive]}>
                🗓 3-Day Challenge
              </Text>
              {leaderboardMode === '3day' && (
                <Text style={styles.subTabMeta}>Week of {challengeWeekLabel}</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.subTabItem, leaderboardMode === 'global' && styles.subTabItemActive]}
              onPress={() => setLeaderboardMode('global')}
            >
              <Text style={[styles.subTabLabel, leaderboardMode === 'global' && styles.subTabLabelActive]}>
                🌍 All-Time
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionLabel}>
              {leaderboardMode === '3day' ? '3-DAY CHALLENGE RANKINGS' : 'ALL-TIME GLOBAL RANKINGS'}
            </Text>
            {requiresAccount ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateEmoji}>🔐</Text>
                <Text style={styles.emptyStateText}>Log in to view the leaderboard.</Text>
                <Text style={styles.emptyStateSub}>Leaderboard rankings are available after your account is active.</Text>
              </View>
            ) : leaderboardLoading ? (
              <ActivityIndicator color={WW.blue} style={{ marginTop: 32 }} />
            ) : activeBoard.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateEmoji}>{leaderboardMode === '3day' ? '🏅' : '🏃'}</Text>
                <Text style={styles.emptyStateText}>
                  {leaderboardMode === '3day'
                    ? 'No challenge stats yet this week.'
                    : 'No one has logged stats yet.'}
                </Text>
                <Text style={styles.emptyStateSub}>Start your walk to appear on the board!</Text>
              </View>
            ) : (
              activeBoard.map((entry, i) => (
                <View
                  key={entry.userId}
                  style={[
                    styles.leaderRow,
                    entry.isMe && styles.leaderRowMe,
                    i === 0 && styles.leaderRowFirst,
                  ]}
                >
                  <Text style={[
                    styles.leaderRank,
                    i === 0 ? styles.leaderRankGold : i === 1 ? styles.leaderRankSilver : i === 2 ? styles.leaderRankBronze : null,
                  ]}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </Text>
                  <View style={[styles.leaderAvatar, entry.isMe && styles.leaderAvatarMe]}>
                    <Text style={styles.leaderAvatarText}>
                      {entry.isMe ? '⭐' : toInitials(entry.username)}
                    </Text>
                  </View>
                  <View style={styles.leaderInfo}>
                    <Text style={styles.leaderName}>
                      {entry.isMe ? `${entry.username} (You)` : entry.username}
                    </Text>
                    <Text style={styles.leaderMeta}>
                      {entry.steps.toLocaleString()} steps · {entry.waterGlasses} glasses · {entry.streak}d streak
                    </Text>
                  </View>
                  <Text style={styles.leaderScore}>{entry.score.toLocaleString()}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </>
      )}

      {/* ── Chat tab ── */}
      {tab === 'chat' && (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 8, flexGrow: 1, justifyContent: 'flex-end' }]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {chatLoading ? (
              <ActivityIndicator color={WW.blue} style={{ marginTop: 32 }} />
            ) : msgs.length === 0 ? (
              <View style={styles.chatEmptyState}>
                <Text style={styles.chatEmptyEmoji}>💬</Text>
                <Text style={styles.chatEmptyTitle}>Be the first to share!</Text>
                <Text style={styles.chatEmptyText}>
                  Post your steps, water, or a quick win.{'\n'}Everyone in the challenge can see it.
                </Text>
              </View>
            ) : (
              msgs.map((m) => {
                const isMe = m.user_id === myUserId;
                const likes = likeCounts[m.id] ?? 0;
                const liked = myLikes.has(m.id);
                return (
                  <View key={m.id} style={[styles.chatBubble, isMe && styles.chatBubbleMe]}>
                    {!isMe && (
                      <Text style={styles.chatAuthor}>{m.display_name} · {fmtTime(m.created_at)}</Text>
                    )}
                    <Pressable
                      onPress={() => handleBubbleTap(m.id)}
                      style={[styles.chatInner, isMe && styles.chatInnerMe]}
                    >
                      <Text style={[styles.chatText, isMe && styles.chatTextMe]}>{m.body}</Text>
                    </Pressable>
                    <View style={[styles.chatMetaRow, isMe && styles.chatMetaRowMe]}>
                      {likes > 0 && (
                        <Pressable onPress={() => toggleLike(m.id)} hitSlop={6} style={styles.likePill}>
                          <Text style={styles.likePillText}>{liked ? '❤️' : '🤍'} {likes}</Text>
                        </Pressable>
                      )}
                      <Text style={styles.chatAuthor}>
                        {isMe ? `You · ${fmtTime(m.created_at)}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.chatInputRow, { paddingBottom: 10 }]}>
            <TextInput
              style={styles.chatInput}
              placeholder="Share your progress…"
              placeholderTextColor={WW.muted}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={280}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={send}
            />
            <Pressable
              style={[styles.chatSendBtn, !input.trim() && styles.chatSendBtnDisabled]}
              onPress={send}
              disabled={!input.trim()}
            >
              <Text style={styles.chatSendText}>→</Text>
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WW.black },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: WW.border,
  },
  headerTitle: { fontSize: 18, color: WW.text, fontWeight: '800' },

  groupCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: WW.card, borderWidth: 1, borderColor: 'rgba(14,165,233,0.2)',
    borderRadius: 14, padding: 14, gap: 12,
  },
  groupCardLeft:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupCardEmoji: { fontSize: 28 },
  groupCardInfo:  { flex: 1, gap: 2 },
  groupCardTitle: { fontSize: 14, color: WW.text, fontWeight: '700' },
  groupCardSub:   { fontSize: 12, color: WW.muted, lineHeight: 17 },
  groupCardArrow: { fontSize: 18, color: WW.blue },

  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: WW.border },
  tabItem: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive:  { borderBottomColor: WW.blue },
  tabLabel:       { fontSize: 12, color: WW.muted, fontWeight: '700' },
  tabLabelActive: { color: WW.blue },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  sectionLabel:  { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },

  // Leaderboard sub-tabs
  subTabBar: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: WW.border,
  },
  subTabItem: {
    flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 10, backgroundColor: WW.card,
    borderWidth: 1, borderColor: WW.border,
  },
  subTabItemActive: { borderColor: WW.blue, backgroundColor: WW.blueSoft },
  subTabLabel:      { fontSize: 12, color: WW.muted, fontWeight: '700' },
  subTabLabelActive:{ color: WW.blue },
  subTabMeta:       { fontSize: 9, color: WW.muted, marginTop: 2, letterSpacing: 0.3 },

  // Leaderboard
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 14, padding: 14,
  },
  leaderRowMe:    { borderColor: WW.blueBorder, backgroundColor: WW.blueSoft },
  leaderRowFirst: { borderColor: 'rgba(255,215,0,0.3)', backgroundColor: 'rgba(255,215,0,0.06)' },
  leaderRank:     { fontSize: 18, width: 32, textAlign: 'center' },
  leaderRankGold:   { color: '#FFD700' },
  leaderRankSilver: { color: '#C0C0C0' },
  leaderRankBronze: { color: '#CD7F32' },
  leaderAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: WW.border,
    alignItems: 'center', justifyContent: 'center',
  },
  leaderAvatarMe:   { backgroundColor: WW.blueSoft, borderWidth: 1, borderColor: WW.blue },
  leaderAvatarText: { fontSize: 13, color: WW.text, fontWeight: '700' },
  leaderInfo:  { flex: 1 },
  leaderName:  { fontSize: 14, color: WW.text, fontWeight: '700' },
  leaderMeta:  { fontSize: 11, color: WW.muted, marginTop: 2 },
  leaderScore: { fontSize: 11, color: WW.blue, fontWeight: '800', minWidth: 44, textAlign: 'right' },

  // Empty states
  emptyState: { alignItems: 'center', paddingTop: 48, gap: 8 },
  emptyStateEmoji: { fontSize: 36, marginBottom: 4 },
  emptyStateText: { fontSize: 15, color: WW.text, fontWeight: '700' },
  emptyStateSub:  { fontSize: 13, color: WW.muted },

  chatEmptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 10,
  },
  chatEmptyEmoji: { fontSize: 48, marginBottom: 4 },
  chatEmptyTitle: { fontSize: 17, color: WW.text, fontWeight: '800', textAlign: 'center' },
  chatEmptyText:  { fontSize: 14, color: WW.muted, lineHeight: 20, textAlign: 'center' },

  // Chat messages
  chatBubble:   { gap: 3 },
  chatBubbleMe: { alignItems: 'flex-end' },
  chatAuthor:   { fontSize: 10, color: WW.muted, fontWeight: '600', paddingHorizontal: 4 },
  chatInner: {
    maxWidth: '80%', backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 14, borderBottomLeftRadius: 4, padding: 12,
  },
  chatInnerMe: {
    backgroundColor: WW.blue, borderColor: 'transparent',
    borderRadius: 14, borderBottomRightRadius: 4,
  },
  chatText:   { fontSize: 14, color: WW.text, lineHeight: 20 },
  chatTextMe: { color: '#000', fontWeight: '500' },
  chatMetaRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, marginTop: 2 },
  chatMetaRowMe: { justifyContent: 'flex-end' },
  likePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WW.blueSoft,
    borderWidth: 1,
    borderColor: WW.blueBorder,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  likePillText: { fontSize: 11, color: WW.text, fontWeight: '600' },

  // Chat input
  chatInputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: WW.border,
  },
  chatInput: {
    flex: 1, backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    color: WW.text, fontSize: 14, maxHeight: 100,
  },
  chatSendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: WW.blue, alignItems: 'center', justifyContent: 'center',
  },
  chatSendBtnDisabled: { opacity: 0.35 },
  chatSendText: { color: '#000', fontSize: 18, fontWeight: '800' },
});
