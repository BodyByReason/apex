/**
 * WalkWaterTribeScreen
 *
 * Post-upgrade replacement for WalkWaterCommunityScreen.
 * Same dark navy shell, same leaderboard + group chat users already know.
 * Adds the "APEX TRIBE" identity and a group join card at the top.
 * Intentionally familiar — the goal is "oh, my community just got a name."
 */

import React, { useCallback, useRef, useState } from 'react';
import {
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

import { getWaterOzToday, getWalkWaterStreak } from '@/lib/walkWaterMode';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black:      '#050A14',
  card:       '#0D1B2A',
  border:     '#1A2E45',
  blue:       '#0EA5E9',
  teal:       '#06B6D4',
  blueSoft:   'rgba(14,165,233,0.08)',
  blueBorder: 'rgba(14,165,233,0.2)',
  tealSoft:   'rgba(6,182,212,0.08)',
  tealBorder: 'rgba(6,182,212,0.2)',
  text:       '#F0F8FF',
  muted:      '#6B8BA4',
};

// ─── Config ───────────────────────────────────────────────────────────────────

const GROUP_URL = 'https://www.facebook.com/groups/3daywalkandwaterchallenge';

// ─── Leaderboard seed ─────────────────────────────────────────────────────────
// Per RECONCILED_DECISIONS_V2 §6.1 + audit "Trust and authenticity": these
// sample entries are clearly labeled "(sample)" + a banner above the
// leaderboard until the real Supabase community pipeline replaces them.

const LEADERBOARD_SEED: { name: string; initials: string; steps: number; water: number; streak: number }[] = [];

// ─── Chat ─────────────────────────────────────────────────────────────────────

type ChatMsg = { author: string; body: string; time: string; isMe?: boolean };

const CHAT_KEY = 'apex.ww.tribe.chat';

const SEED_MSGS: ChatMsg[] = [];

async function loadChat(): Promise<ChatMsg[]> {
  try {
    const raw = await AsyncStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed: ChatMsg[] = JSON.parse(raw);
    // Strip any legacy seed messages (no isMe flag and authored by known seed names)
    const seedNames = new Set(['Maria G.', 'James T.', 'Aisha K.', 'Chris R.', 'Priya S.', 'Devon L.', 'Yuki N.']);
    const real = parsed.filter((m) => m.isMe || !seedNames.has(m.author));
    if (real.length !== parsed.length) await AsyncStorage.setItem(CHAT_KEY, JSON.stringify(real));
    return real;
  } catch { return []; }
}

async function saveChat(msgs: ChatMsg[]): Promise<void> {
  await AsyncStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
}

type TabId = 'leaderboard' | 'chat';

// ─── WalkWaterTribeScreen ─────────────────────────────────────────────────────

export default function WalkWaterTribeScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [tab, setTab]         = useState<TabId>('leaderboard');
  const [msgs, setMsgs]       = useState<ChatMsg[]>(SEED_MSGS);
  const [input, setInput]     = useState('');
  const [myWater, setMyWater] = useState(0);
  const [myStreak, setMyStreak] = useState(0);

  useFocusEffect(useCallback(() => {
    loadChat().then(setMsgs);
    getWaterOzToday().then((oz) => setMyWater(Math.round(oz / 8)));
    getWalkWaterStreak().then(setMyStreak);
  }, []));

  const myEntry = {
    name: 'You', initials: '⭐', steps: 0,
    water: myWater, streak: myStreak, isMe: true,
  };

  const allEntries = [...LEADERBOARD_SEED, myEntry]
    .sort((a, b) =>
      (b.steps + b.water * 500 + b.streak * 200) -
      (a.steps + a.water * 500 + a.streak * 200),
    );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const msg: ChatMsg = {
      author: 'You',
      body:   text,
      time:   new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe:   true,
    };
    const next = [...msgs, msg];
    setMsgs(next);
    setInput('');
    saveChat(next).catch(() => null);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [input, msgs]);

  const openGroup = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    Linking.openURL(GROUP_URL).catch(() => null);
  }, []);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>WALK + WATER TRIBE</Text>
          <Text style={styles.headerTitle}>Your people.</Text>
        </View>
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
            <Text style={styles.groupCardSub}>
              Daily wins, accountability, and people who get it.
            </Text>
          </View>
        </View>
        <Text style={styles.groupCardArrow}>→</Text>
      </Pressable>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['leaderboard', 'chat'] as TabId[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.tabItem, tab === t && styles.tabItemActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'leaderboard' ? '🏆  Leaderboard' : '💬  Group Chat'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Leaderboard */}
      {tab === 'leaderboard' && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionLabel}>TODAY'S RANKINGS</Text>
          {allEntries.map((entry, i) => (
            <View
              key={entry.name}
              style={[
                styles.leaderRow,
                (entry as typeof entry & { isMe?: boolean }).isMe && styles.leaderRowMe,
                i === 0 && styles.leaderRowFirst,
              ]}
            >
              <Text style={[
                styles.leaderRank,
                i === 0 ? styles.rankGold : i === 1 ? styles.rankSilver : i === 2 ? styles.rankBronze : null,
              ]}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
              </Text>
              <View style={[
                styles.leaderAvatar,
                (entry as typeof entry & { isMe?: boolean }).isMe && styles.leaderAvatarMe,
              ]}>
                <Text style={styles.leaderAvatarText}>{entry.initials}</Text>
              </View>
              <View style={styles.leaderInfo}>
                <Text style={styles.leaderName}>{entry.name}</Text>
                <Text style={styles.leaderMeta}>
                  {entry.steps.toLocaleString()} steps · {entry.water} glasses · {entry.streak}d streak
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Chat */}
      {tab === 'chat' && (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 8 }]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {msgs.map((m, i) => (
              <View key={i} style={[styles.chatBubble, m.isMe && styles.chatBubbleMe]}>
                {!m.isMe && (
                  <Text style={styles.chatAuthor}>{m.author} · {m.time}</Text>
                )}
                <View style={[styles.chatInner, m.isMe && styles.chatInnerMe]}>
                  <Text style={[styles.chatText, m.isMe && styles.chatTextMe]}>
                    {m.body}
                  </Text>
                </View>
                {m.isMe && (
                  <Text style={[styles.chatAuthor, { textAlign: 'right' }]}>
                    You · {m.time}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
          <View style={[styles.chatInputRow, { paddingBottom: insets.bottom + 10 }]}>
            <TextInput
              style={styles.chatInput}
              placeholder="Share your win today…"
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
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  eyebrow:     { fontSize: 9, color: WW.teal, fontWeight: '700', letterSpacing: 2, marginBottom: 2 },
  headerTitle: { fontSize: 22, color: WW.text, fontWeight: '900', letterSpacing: -0.3 },
  memberBadge: {
    backgroundColor: WW.tealSoft, borderWidth: 1, borderColor: WW.tealBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  memberBadgeText: { fontSize: 11, color: WW.teal, fontWeight: '700' },

  // Group CTA card
  groupCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.tealBorder,
    borderRadius: 14, padding: 14, gap: 12,
  },
  groupCardLeft:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupCardEmoji: { fontSize: 28 },
  groupCardInfo:  { flex: 1, gap: 2 },
  groupCardTitle: { fontSize: 14, color: WW.text, fontWeight: '700' },
  groupCardSub:   { fontSize: 12, color: WW.muted, lineHeight: 17 },
  groupCardArrow: { fontSize: 18, color: WW.teal },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: WW.border,
  },
  tabItem: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: WW.blue },
  tabLabel:      { fontSize: 12, color: WW.muted, fontWeight: '700' },
  tabLabelActive: { color: WW.blue },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  sectionLabel:  { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },

  // Leaderboard
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 14, padding: 14,
  },
  leaderRowMe:    { borderColor: WW.blueBorder, backgroundColor: WW.blueSoft },
  leaderRowFirst: { borderColor: 'rgba(255,215,0,0.3)', backgroundColor: 'rgba(255,215,0,0.06)' },
  leaderRank:     { fontSize: 18, width: 32, textAlign: 'center', color: WW.muted },
  rankGold:       { color: '#FFD700' },
  rankSilver:     { color: '#C0C0C0' },
  rankBronze:     { color: '#CD7F32' },
  leaderAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: WW.border, alignItems: 'center', justifyContent: 'center',
  },
  leaderAvatarMe:   { backgroundColor: WW.blueSoft, borderWidth: 1, borderColor: WW.blue },
  leaderAvatarText: { fontSize: 13, color: WW.text, fontWeight: '700' },
  leaderInfo:       { flex: 1 },
  leaderName:       { fontSize: 14, color: WW.text, fontWeight: '700' },
  leaderMeta:       { fontSize: 11, color: WW.muted, marginTop: 2 },

  // Chat
  chatBubble:   { gap: 3 },
  chatBubbleMe: { alignItems: 'flex-end' },
  chatAuthor:   { fontSize: 10, color: WW.muted, fontWeight: '600', paddingHorizontal: 4 },
  chatInner: {
    maxWidth: '80%', backgroundColor: WW.card,
    borderWidth: 1, borderColor: WW.border,
    borderRadius: 14, borderBottomLeftRadius: 4, padding: 12,
  },
  chatInnerMe:  {
    backgroundColor: WW.blue, borderColor: 'transparent',
    borderRadius: 14, borderBottomRightRadius: 4,
  },
  chatText:     { fontSize: 14, color: WW.text, lineHeight: 20 },
  chatTextMe:   { color: '#000', fontWeight: '500' },

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
  chatSendText:        { color: '#000', fontSize: 18, fontWeight: '800' },
});
