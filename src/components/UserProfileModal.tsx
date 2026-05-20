/**
 * UserProfileModal
 *
 * Displays another user's public profile when their name/avatar is tapped.
 * Shows: name, title, streak, XP, goal, badges.
 * Actions: Send Friend Request · Send Private Message
 *
 * Both actions are gated by the target user's privacy settings (looked up
 * from the viewer's own profile for now; in production this would be a server
 * lookup). Privacy levels: 'everyone' | 'friends' | 'nobody'.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
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
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apexColors as C } from '@/theme/colors';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import {
  type PublicProfile,
  type PrivacySetting,
  lookupProfile,
  isFriend,
  hasPendingRequest,
  sendFriendRequest,
  sendDirectMessage,
  getConversation,
  type DirectMessage,
} from '@/lib/socialGraph';

// ─── Props ───────────────────────────────────────────────────────────────────

export type UserProfileModalProps = {
  visible: boolean;
  /** Display name of the user whose profile to show */
  targetName: string;
  /** Initials (2 chars) used as the avatar */
  targetInitials: string;
  targetAvatarUrl?: string;
  targetBio?: string;
  targetIsCoach?: boolean;
  targetTitle?: string;
  onClose: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INITIALS_COLORS: Record<string, { bg: string; text: string }> = {
  MT: { bg: '#3B82F6', text: '#fff' },
  AR: { bg: '#EC4899', text: '#fff' },
  JD: { bg: '#A855F7', text: '#fff' },
  SK: { bg: '#10B981', text: '#fff' },
  JR: { bg: '#F59E0B', text: '#000' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function UserProfileModal({
  visible,
  targetName,
  targetInitials,
  targetAvatarUrl,
  targetBio,
  targetIsCoach = false,
  targetTitle,
  onClose,
}: UserProfileModalProps) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [friendStatus, setFriendStatus] = useState<'none' | 'pending' | 'friends'>('none');
  const [dmInput, setDmInput] = useState('');
  const [showDmInput, setShowDmInput] = useState(false);
  const [dmSent, setDmSent] = useState(false);
  const [conversation, setConversation] = useState<DirectMessage[]>([]);
  // Target user's effective privacy settings (resolved from profile/mock data)
  const [targetPrivacy, setTargetPrivacy] = useState<{
    allowMessages: PrivacySetting;
    allowFriendRequests: PrivacySetting;
  }>({ allowMessages: 'everyone', allowFriendRequests: 'everyone' });
  const slideAnim = useRef(new Animated.Value(300)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    // Load the viewed user's profile and your own profile (for privacy checks)
    const p = lookupProfile(targetName, targetInitials);
    setProfile(p);
    setDmInput('');
    setDmSent(false);
    setShowDmInput(false);

    Promise.all([
      AsyncStorage.getItem(PROFILE_STORAGE_KEY),
      isFriend(targetName),
      hasPendingRequest(targetName),
      getConversation(targetName),
    ]).then(([myRaw, friend, pending, convo]) => {
      const mine = myRaw ? (JSON.parse(myRaw) as UserProfile) : null;
      setMyProfile(mine);
      setFriendStatus(friend ? 'friends' : pending ? 'pending' : 'none');
      setConversation(convo?.messages ?? []);

      // Resolve target's privacy settings:
      // • If the target is the current user themselves, use their stored prefs
      //   (this covers the edge-case of viewing your own card from feed/leaderboard).
      // • For community mock profiles, default to 'everyone' (open).
      // • In production this would be a server look-up of the target's profile.
      const isMe = mine?.displayName === targetName;
      setTargetPrivacy({
        allowMessages:       isMe ? (mine?.privacyMessages       ?? 'everyone') : 'everyone',
        allowFriendRequests: isMe ? (mine?.privacyFriendRequests ?? 'everyone') : 'everyone',
      });
    }).catch(() => null);

    // Slide-up entrance animation
    slideAnim.setValue(300);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 6 }),
    ]).start();
  }, [visible, targetName, targetInitials, slideAnim, fadeAnim]);

  if (!visible) return null;

  const { allowFriendRequests, allowMessages } = targetPrivacy;
  const canFriend = allowFriendRequests !== 'nobody' && friendStatus !== 'friends';
  const canMessage = allowMessages !== 'nobody';

  const avaColors = INITIALS_COLORS[targetInitials] ?? { bg: C.green, text: '#000' };

  const handleFriendRequest = async () => {
    if (!profile) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await sendFriendRequest({ name: targetName, initials: targetInitials });
    setFriendStatus('pending');
  };

  const handleSendDm = async () => {
    const text = dmInput.trim();
    if (!text) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await sendDirectMessage({ name: targetName, initials: targetInitials }, text);
    setConversation((prev) => [...prev, {
      id: `dm-${Date.now()}`,
      fromName: myProfile?.displayName ?? 'Me',
      fromInitials: (myProfile?.displayName ?? 'ME').slice(0, 2).toUpperCase(),
      body: text,
      sentAt: new Date().toISOString(),
      read: true,
    }]);
    setDmInput('');
    setDmSent(true);
    setTimeout(() => setDmSent(false), 3000);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[s.overlay, { opacity: fadeAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {/*
          KeyboardAvoidingView wraps the sheet so the DM input lifts above the
          keyboard instead of hiding behind it. behavior="padding" is correct for
          a bottom-anchored sheet — it grows the sheet upward when keyboard appears.
        */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.kavWrap}
        >
        <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={s.handle} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Avatar + name ── */}
            <View style={s.heroRow}>
              <View style={[s.avatarLarge, { backgroundColor: avaColors.bg }]}>
                {targetAvatarUrl ? (
                  <Image source={{ uri: targetAvatarUrl }} style={s.avatarImage} />
                ) : (
                  <Text style={[s.avatarText, { color: avaColors.text }]}>{targetInitials}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.displayName}>{profile?.name ?? targetName}</Text>
                <View style={s.titleBadgeRow}>
                  {targetIsCoach ? (
                    <View style={[s.titleBadge, s.coachBadge]}>
                      <Text style={[s.titleBadgeText, s.coachBadgeText]}>✓ Coach</Text>
                    </View>
                  ) : null}
                  {(targetTitle || profile?.title) ? (
                    <View style={s.titleBadge}>
                      <Text style={s.titleBadgeText}>✦ {targetTitle || profile?.title}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.goalText}>{profile?.goal ?? 'Fitness'}</Text>
                {targetIsCoach && targetBio ? (
                  <Text style={s.coachBioText}>{targetBio}</Text>
                ) : null}
              </View>
            </View>

            {/* ── Stats row ── */}
            {profile ? (
              <View style={s.statsRow}>
                {[
                  { label: 'STREAK', value: `${profile.streak}d`, icon: '🔥' },
                  { label: 'WORKOUTS', value: profile.totalWorkouts, icon: '🏋️' },
                  { label: 'XP', value: profile.xp.toLocaleString(), icon: '⚡' },
                ].map((stat) => (
                  <View key={stat.label} style={s.statChip}>
                    <Text style={s.statIcon}>{stat.icon}</Text>
                    <Text style={s.statValue}>{stat.value}</Text>
                    <Text style={s.statLabel}>{stat.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* ── Badges ── */}
            {profile?.badges && profile.badges.length > 0 ? (
              <View style={s.section}>
                <Text style={s.sectionLabel}>BADGES</Text>
                <View style={s.badgeRow}>
                  {profile.badges.map((b) => (
                    <View key={b.name} style={s.badge}>
                      <Text style={s.badgeIcon}>{b.icon}</Text>
                      <Text style={s.badgeName}>{b.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* ── DM history (if any) ── */}
            {conversation.length > 0 ? (
              <View style={s.section}>
                <Text style={s.sectionLabel}>MESSAGES</Text>
                {conversation.slice(-3).map((msg) => (
                  <View key={msg.id} style={[s.dmBubble, msg.fromName === 'Me' ? s.dmBubbleMe : null]}>
                    <Text style={[s.dmText, msg.fromName === 'Me' ? { color: '#000' } : null]}>{msg.body}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* ── Actions ── */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>CONNECT</Text>

              {/* Friend request */}
              {friendStatus === 'friends' ? (
                <View style={s.friendsBadge}>
                  <Text style={s.friendsBadgeText}>✓ You're friends</Text>
                </View>
              ) : canFriend ? (
                <Pressable
                  style={({ pressed }) => [s.btnPrimary, pressed && { opacity: 0.85 }]}
                  onPress={handleFriendRequest}
                >
                  <Text style={s.btnPrimaryText}>
                    {friendStatus === 'pending' ? '⏳ Friend Request Sent' : '👋 Send Friend Request'}
                  </Text>
                </Pressable>
              ) : (
                <View style={s.privacyNote}>
                  <Text style={s.privacyNoteText}>🔒 This user isn't accepting friend requests</Text>
                </View>
              )}

              {/* Direct message */}
              {canMessage ? (
                <>
                  {showDmInput ? (
                    <View style={s.dmInputWrap}>
                      <TextInput
                        style={s.dmInput}
                        value={dmInput}
                        onChangeText={setDmInput}
                        placeholder={`Message ${profile?.name ?? targetName}…`}
                        placeholderTextColor={C.muted}
                        multiline
                        maxLength={500}
                        autoFocus
                      />
                      <View style={s.dmActions}>
                        <Pressable style={s.btnGhost} onPress={() => setShowDmInput(false)}>
                          <Text style={s.btnGhostText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          style={[s.btnSend, !dmInput.trim() && { opacity: 0.4 }]}
                          onPress={handleSendDm}
                          disabled={!dmInput.trim()}
                        >
                          <Text style={s.btnSendText}>{dmSent ? '✓ Sent!' : 'Send →'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [s.btnSecondary, pressed && { opacity: 0.85 }]}
                      onPress={() => setShowDmInput(true)}
                    >
                      <Text style={s.btnSecondaryText}>
                        {conversation.length > 0 ? '💬 Continue Conversation' : '💬 Send a Message'}
                      </Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <View style={[s.privacyNote, { marginTop: 8 }]}>
                  <Text style={s.privacyNoteText}>🔒 This user isn't accepting messages</Text>
                </View>
              )}
            </View>

            <View style={{ height: 20 }} />
          </ScrollView>
        </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  // KeyboardAvoidingView sits between overlay and sheet so it can push
  // the sheet up when the keyboard appears
  kavWrap: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.black,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(0,255,136,0.25)',
    maxHeight: '85%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginTop: 12, marginBottom: 4,
  },
  content: { padding: 20, paddingBottom: 40, gap: 16 },

  // Hero
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatarLarge: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(0,255,136,0.3)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 36,
  },
  avatarText: { fontSize: 26, fontFamily: 'DMSans_700Bold' },
  displayName: { fontSize: 22, color: C.text, fontFamily: 'DMSans_700Bold', marginBottom: 4 },
  titleBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  titleBadge: {
    backgroundColor: 'rgba(0,255,136,0.1)',
    borderWidth: 1, borderColor: 'rgba(0,255,136,0.35)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  titleBadgeText: { fontSize: 11, color: C.green, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5 },
  coachBadge: {
    backgroundColor: 'rgba(255,107,53,0.12)',
    borderColor: 'rgba(255,107,53,0.45)',
  },
  coachBadgeText: { color: C.orange },
  goalText: { fontSize: 12, color: C.muted, fontFamily: 'DMSans_400Regular' },
  coachBioText: {
    fontSize: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
    marginTop: 8,
  },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10 },
  statChip: {
    flex: 1, backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 10, alignItems: 'center', gap: 3,
  },
  statIcon: { fontSize: 18 },
  statValue: { fontSize: 16, color: C.text, fontFamily: 'DMSans_700Bold' },
  statLabel: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1 },

  // Section
  section: { gap: 10 },
  sectionLabel: { fontSize: 9, color: C.muted, fontFamily: 'SpaceMono_400Regular', letterSpacing: 1.5 },

  // Badges
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  badgeIcon: { fontSize: 16 },
  badgeName: { fontSize: 12, color: C.text, fontFamily: 'DMSans_500Medium' },

  // DM bubbles
  dmBubble: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 10, alignSelf: 'flex-start', maxWidth: '80%',
  },
  dmBubbleMe: { backgroundColor: 'rgba(0,255,136,0.15)', borderColor: 'rgba(0,255,136,0.3)', alignSelf: 'flex-end' },
  dmText: { fontSize: 14, color: C.text, fontFamily: 'DMSans_400Regular', lineHeight: 20 },

  // Actions
  friendsBadge: {
    backgroundColor: 'rgba(0,255,136,0.1)',
    borderWidth: 1, borderColor: 'rgba(0,255,136,0.3)',
    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  friendsBadgeText: { color: C.green, fontSize: 14, fontFamily: 'DMSans_700Bold' },
  btnPrimary: {
    backgroundColor: C.green, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  btnPrimaryText: { color: '#000', fontSize: 15, fontFamily: 'DMSans_700Bold' },
  btnSecondary: {
    borderWidth: 1.5, borderColor: C.green, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  btnSecondaryText: { color: C.green, fontSize: 15, fontFamily: 'DMSans_700Bold' },
  privacyNote: {
    backgroundColor: C.card, borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  privacyNoteText: { fontSize: 13, color: C.muted, fontFamily: 'DMSans_400Regular' },

  // DM input
  dmInputWrap: { gap: 8 },
  dmInput: {
    backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12,
    color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14,
    minHeight: 80, textAlignVertical: 'top',
  },
  dmActions: { flexDirection: 'row', gap: 8 },
  btnGhost: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, alignItems: 'center',
  },
  btnGhostText: { color: C.muted, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  btnSend: {
    flex: 2, paddingVertical: 12, borderRadius: 10,
    backgroundColor: C.green, alignItems: 'center',
  },
  btnSendText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 14 },
});
