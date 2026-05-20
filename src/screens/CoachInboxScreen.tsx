/**
 * CoachInboxScreen
 *
 * Admin-only inbox for the coach (Joshua) to view and reply to
 * messages from users. Shows conversation threads sorted by
 * client status: active clients first, then linked, then prospects.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { apexColors as C } from '@/theme/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

type LinkStatus = 'active' | 'linked' | 'cancelled' | null;

interface CoachMessage {
  id: string;
  user_id: string;
  coach_id: string;
  sender_role: 'user' | 'coach';
  content: string;
  created_at: string;
}

interface Profile {
  id: string;
  display_name: string | null;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface ClientLink {
  user_id: string;
  link_status: LinkStatus;
  package_id: string | null;
}

interface Thread {
  user_id: string;
  profile: Profile | null;
  link_status: LinkStatus;
  last_message: CoachMessage;
  unread: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function initials(profile: Profile | null): string {
  if (!profile) return '?';
  const name = profile.display_name || profile.username || profile.email || '?';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function displayName(profile: Profile | null): string {
  if (!profile) return 'Unknown User';
  return profile.display_name || profile.username || profile.email || 'Unknown User';
}

function sortThreads(threads: Thread[]): Thread[] {
  const order: Record<string, number> = { active: 0, linked: 1, cancelled: 3 };
  const rank = (t: Thread) => (t.link_status ? (order[t.link_status] ?? 2) : 2);
  return [...threads].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return new Date(b.last_message.created_at).getTime() -
      new Date(a.last_message.created_at).getTime();
  });
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: LinkStatus }) {
  if (status === 'active') {
    return (
      <View style={styles.badgeGreen}>
        <Text style={styles.badgeTextGreen}>CLIENT</Text>
      </View>
    );
  }
  if (status === 'linked') {
    return (
      <View style={styles.badgeBlue}>
        <Text style={styles.badgeTextBlue}>LINKED</Text>
      </View>
    );
  }
  return (
    <View style={styles.badgeOrange}>
      <Text style={styles.badgeTextOrange}>PROSPECT</Text>
    </View>
  );
}

// ─── Thread Card ──────────────────────────────────────────────────────────────

function ThreadCard({ thread, onPress }: { thread: Thread; onPress: () => void }) {
  const preview =
    thread.last_message.content.length > 60
      ? thread.last_message.content.slice(0, 60) + '…'
      : thread.last_message.content;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={onPress}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(thread.profile)}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardRow}>
          <Text style={styles.cardName} numberOfLines={1}>{displayName(thread.profile)}</Text>
          <View style={styles.cardMeta}>
            {thread.unread && <View style={styles.unreadDot} />}
            <Text style={styles.cardTime}>{relativeTime(thread.last_message.created_at)}</Text>
          </View>
        </View>
        <View style={styles.cardRow}>
          <StatusBadge status={thread.link_status} />
          <Text style={styles.cardPreview} numberOfLines={1}>{preview}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Chat Modal ───────────────────────────────────────────────────────────────

interface ChatModalProps {
  visible: boolean;
  userId: string;
  profile: Profile | null;
  coachId: string;
  onClose: () => void;
}

function ChatModal({ visible, userId, profile, coachId, onClose }: ChatModalProps) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('coach_messages')
      .select('id, user_id, coach_id, sender_role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as CoachMessage[]);
  }, [userId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');
    const { error } = await supabase.from('coach_messages').insert({
      user_id: userId,
      coach_id: coachId,
      sender_role: 'coach',
      content: text,
    });
    if (!error) await load();
    setSending(false);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  }, [input, sending, userId, coachId, load]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.chatSheet, { paddingBottom: insets.bottom }]}
        >
          {/* Header */}
          <View style={styles.chatHeader}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.chatBack}>← Back</Text>
            </Pressable>
            <Text style={styles.chatTitle} numberOfLines={1}>
              {displayName(profile).toUpperCase()}
            </Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Messages */}
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              const isCoach = item.sender_role === 'coach';
              return (
                <View style={[styles.bubble, isCoach ? styles.bubbleCoach : styles.bubbleUser]}>
                  <Text style={[styles.bubbleText, isCoach && styles.bubbleTextCoach]}>
                    {item.content}
                  </Text>
                  <Text style={styles.bubbleTime}>{relativeTime(item.created_at)}</Text>
                </View>
              );
            }}
          />

          {/* Input */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="Type a message…"
              placeholderTextColor={C.subtle}
              multiline
              returnKeyType="send"
              onSubmitEditing={send}
            />
            <Pressable
              style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!input.trim() || sending}
            >
              <Text style={styles.sendBtnText}>↑</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CoachInboxScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { session } = useAuth();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch all messages — latest first
      const { data: msgs } = await supabase
        .from('coach_messages')
        .select('id, user_id, sender_role, content, created_at')
        .order('created_at', { ascending: false });

      if (!msgs || msgs.length === 0) {
        setThreads([]);
        return;
      }

      // 2. Group by user_id — keep latest message per user
      const latestByUser = new Map<string, CoachMessage>();
      for (const m of msgs as CoachMessage[]) {
        if (!latestByUser.has(m.user_id)) latestByUser.set(m.user_id, m);
      }
      const userIds = Array.from(latestByUser.keys());

      // 3. Fetch client links
      const { data: links } = await supabase
        .from('coach_client_links')
        .select('user_id, link_status, package_id')
        .in('user_id', userIds);

      const linkMap = new Map<string, ClientLink>();
      for (const l of (links ?? []) as ClientLink[]) {
        linkMap.set(l.user_id, l);
      }

      // 4. Fetch profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, username, email, avatar_url')
        .in('id', userIds);

      const profileMap = new Map<string, Profile>();
      for (const p of (profiles ?? []) as Profile[]) {
        profileMap.set(p.id, p);
      }

      // 5. Build thread list
      const built: Thread[] = userIds.map((uid) => {
        const last = latestByUser.get(uid)!;
        const link = linkMap.get(uid) ?? null;
        return {
          user_id: uid,
          profile: profileMap.get(uid) ?? null,
          link_status: link?.link_status ?? null,
          last_message: last,
          unread: last.sender_role === 'user',
        };
      });

      setThreads(sortThreads(built));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const handleOpenThread = useCallback((thread: Thread) => {
    setActiveThread(thread);
  }, []);

  const handleCloseThread = useCallback(async () => {
    setActiveThread(null);
    await loadThreads();
  }, [loadThreads]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>COACH INBOX</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : threads.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📬</Text>
          <Text style={styles.emptyText}>
            No messages yet. When users message you, they'll appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.user_id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <ThreadCard thread={item} onPress={() => handleOpenThread(item)} />
          )}
        />
      )}

      {/* Chat Modal */}
      {activeThread && (
        <ChatModal
          visible={!!activeThread}
          userId={activeThread.user_id}
          profile={activeThread.profile}
          coachId={session?.user.id ?? ''}
          onClose={handleCloseThread}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.black,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { width: 60 },
  backText: { fontFamily: 'DMSans_400Regular', color: C.green, fontSize: 14 },
  title: {
    fontFamily: 'SpaceMono_400Regular',
    color: C.text,
    fontSize: 13,
    letterSpacing: 1.5,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  loadingText: { fontFamily: 'DMSans_400Regular', color: C.subtle, fontSize: 15 },
  emptyEmoji: { fontSize: 36, marginBottom: 12 },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    color: C.subtle,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  list: { paddingVertical: 8 },
  separator: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },

  // Thread card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  cardPressed: { opacity: 0.7 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { fontFamily: 'DMSans_700Bold', color: C.text, fontSize: 15 },
  cardBody: { flex: 1, gap: 5 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: {
    fontFamily: 'DMSans_500Medium',
    color: C.text,
    fontSize: 14,
    flex: 1,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.green,
  },
  cardTime: { fontFamily: 'SpaceMono_400Regular', color: C.subtle, fontSize: 11 },
  cardPreview: {
    fontFamily: 'DMSans_400Regular',
    color: C.subtle,
    fontSize: 13,
    flex: 1,
  },

  // Badges
  badgeGreen: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,255,135,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.3)',
    flexShrink: 0,
  },
  badgeTextGreen: {
    fontFamily: 'SpaceMono_400Regular',
    color: C.green,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  badgeBlue: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    flexShrink: 0,
  },
  badgeTextBlue: {
    fontFamily: 'SpaceMono_400Regular',
    color: C.blue,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  badgeOrange: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,107,53,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.2)',
    flexShrink: 0,
  },
  badgeTextOrange: {
    fontFamily: 'SpaceMono_400Regular',
    color: C.orange,
    fontSize: 9,
    letterSpacing: 0.8,
    opacity: 0.8,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  chatSheet: {
    backgroundColor: C.black,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    flex: 0.92,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  chatBack: { fontFamily: 'DMSans_400Regular', color: C.green, fontSize: 14, width: 60 },
  chatTitle: {
    fontFamily: 'SpaceMono_400Regular',
    color: C.text,
    fontSize: 12,
    letterSpacing: 1.5,
    flex: 1,
    textAlign: 'center',
  },
  messageList: { padding: 16, gap: 8 },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  bubbleCoach: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0,255,135,0.08)',
    borderColor: 'rgba(0,255,135,0.2)',
  },
  bubbleText: { fontFamily: 'DMSans_400Regular', color: C.text, fontSize: 14, lineHeight: 20 },
  bubbleTextCoach: { color: C.text },
  bubbleTime: {
    fontFamily: 'SpaceMono_400Regular',
    color: C.subtle,
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  textInput: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: C.border },
  sendBtnText: { fontFamily: 'DMSans_700Bold', color: C.black, fontSize: 16 },
});
