import React, { useCallback, useEffect, useState } from 'react';
import '@/lib/livekitGlobals';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AudioSession,
  LiveKitRoom,
  useLocalParticipant,
  useParticipantTracks,
  useRemoteParticipants,
  VideoView,
} from '@livekit/react-native';
import { Track } from 'livekit-client';

import { useAuth } from '@/contexts/AuthContext';
import { apexColors as C } from '@/theme/colors';
import {
  fetchActiveSession,
  fetchComments,
  fetchLiveToken,
  fetchMyJoinRequest,
  postComment,
  sendJoinRequest,
  type TribeLiveComment,
  type TribeLiveSession,
} from '@/lib/tribeLive';
import { supabase } from '@/lib/supabase';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import type { MainStackParamList } from '@/navigation/MainNavigator';

type JoinStatus = 'none' | 'pending' | 'approved' | 'denied';

export default function TribeLiveViewerScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<MainStackParamList, 'TribeLiveViewer'>>();
  const { session } = useAuth();
  const { sessionId } = route.params;

  const [liveSession, setLiveSession] = useState<TribeLiveSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [livekitToken, setLivekitToken] = useState<string | undefined>();
  const [livekitUrl, setLivekitUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await AudioSession.startAudioSession();
        const profileRaw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
        const p = profileRaw ? (JSON.parse(profileRaw) as UserProfile) : null;
        setProfile(p);

        const sess = await fetchActiveSession();
        if (!sess || sess.id !== sessionId) {
          setError('This session has ended.');
          return;
        }
        setLiveSession(sess);

        const { token, livekitUrl: url } = await fetchLiveToken({
          roomName: sess.livekitRoomName,
          participantIdentity: session?.user?.id ?? 'anon',
          participantName: p?.displayName ?? 'Member',
          canPublish: false,
        });
        setLivekitToken(token);
        setLivekitUrl(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to connect.');
      } finally {
        setLoading(false);
      }
    };
    init();
    return () => { AudioSession.stopAudioSession().catch(() => null); };
  }, [sessionId, session?.user?.id]);

  // Called when the coach approves the member's join request.
  // We fetch a publisher token and update the LiveKitRoom prop so it reconnects
  // with publish permissions.
  const handleApproved = useCallback(async () => {
    if (!liveSession || !session?.user?.id) return;
    try {
      const { token } = await fetchLiveToken({
        roomName: liveSession.livekitRoomName,
        participantIdentity: session.user.id,
        participantName: profile?.displayName ?? 'Member',
        canPublish: true,
      });
      setLivekitToken(token);
    } catch {
      // stay as subscriber if token fetch fails
    }
  }, [liveSession, session?.user?.id, profile]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={C.green} />
      </View>
    );
  }

  if (error || !liveSession || !livekitToken || !livekitUrl) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error ?? 'Session not available.'}</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <LiveKitRoom
        serverUrl={livekitUrl}
        token={livekitToken}
        audio={false}
        video={false}
        connect
        onDisconnected={() => navigation.goBack()}
      >
        <ViewerContent
          session={liveSession}
          userId={session?.user?.id ?? ''}
          profile={profile}
          onClose={() => navigation.goBack()}
          onApproved={handleApproved}
        />
      </LiveKitRoom>
    </View>
  );
}

type ViewerContentProps = {
  session: TribeLiveSession;
  userId: string;
  profile: UserProfile | null;
  onClose: () => void;
  onApproved: () => Promise<void>;
};

function ViewerContent({ session, userId, profile, onClose, onApproved }: ViewerContentProps) {
  const insets = useSafeAreaInsets();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const [comments, setComments] = useState<TribeLiveComment[]>([]);
  const [joinStatus, setJoinStatus] = useState<JoinStatus>('none');
  const [commentText, setCommentText] = useState('');
  const [onStage, setOnStage] = useState(false);
  const [connectionTimedOut, setConnectionTimedOut] = useState(false);

  const coachParticipant = remoteParticipants.find(p => p.identity === session.coachId) ?? remoteParticipants[0];
  const displayCoachName = session.coachName?.trim() || 'Coach Josh';
  const displayTitle = session.title?.trim() || 'Live Group Workout';
  const coachVideoTracks = useParticipantTracks(
    [Track.Source.Camera],
    coachParticipant?.identity,
  );
  const coachVideoTrack = coachVideoTracks[0]?.track;

  useEffect(() => {
    setConnectionTimedOut(false);
    if (coachVideoTrack) return;
    const timer = setTimeout(() => setConnectionTimedOut(true), 15_000);
    return () => clearTimeout(timer);
  }, [coachVideoTrack]);

  useEffect(() => {
    fetchComments(session.id).then(setComments);
    fetchMyJoinRequest(session.id, userId).then((req) => {
      if (req) setJoinStatus(req.status as JoinStatus);
    });

    const commentCh = supabase
      .channel(`viewer-comments-${session.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tribe_live_comments', filter: `session_id=eq.${session.id}` },
        (payload) => {
          setComments((prev) => [
            ...prev,
            {
              id: payload.new.id as string,
              sessionId: session.id,
              userId: payload.new.user_id as string,
              authorName: payload.new.author_name as string,
              authorAvatarUrl: payload.new.author_avatar_url as string | undefined,
              authorIsCoach: payload.new.author_is_coach as boolean,
              body: payload.new.body as string,
              createdAt: payload.new.created_at as string,
            },
          ]);
        },
      )
      .subscribe();

    const reqCh = supabase
      .channel(`my-join-req-${session.id}-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tribe_live_join_requests', filter: `session_id=eq.${session.id}` },
        async (payload) => {
          if ((payload.new.user_id as string) !== userId) return;
          const status = payload.new.status as JoinStatus;
          setJoinStatus(status);
          if (status === 'approved') {
            await onApproved();
            await localParticipant?.setCameraEnabled(true);
            await localParticipant?.setMicrophoneEnabled(true);
            setOnStage(true);
          }
        },
      )
      .subscribe();

    const sessionCh = supabase
      .channel(`session-watch-${session.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tribe_live_sessions', filter: `id=eq.${session.id}` },
        (payload) => { if ((payload.new.status as string) === 'ended') onClose(); },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(commentCh);
      supabase.removeChannel(reqCh);
      supabase.removeChannel(sessionCh);
    };
  }, [session.id, userId]);

  const handleRequestJoin = useCallback(async () => {
    if (!userId) return;
    await sendJoinRequest({ sessionId: session.id, userId, requesterName: profile?.displayName ?? 'Member' });
    setJoinStatus('pending');
  }, [session.id, userId, profile]);

  const handleSendComment = useCallback(async () => {
    const body = commentText.trim();
    if (!body || !userId) return;
    setCommentText('');
    await postComment({
      sessionId: session.id, userId,
      authorName: profile?.displayName ?? 'Member',
      authorAvatarUrl: profile?.avatarUrl,
      authorIsCoach: false, body,
    });
  }, [commentText, session.id, userId, profile]);

  const handleLeaveStage = useCallback(async () => {
    await localParticipant?.setCameraEnabled(false);
    await localParticipant?.setMicrophoneEnabled(false);
    setOnStage(false);
    setJoinStatus('none');
  }, [localParticipant]);

  return (
    <KeyboardAvoidingView style={styles.viewer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.viewerHeader}>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>LIVE</Text>
        </View>
        <Text style={styles.sessionTitle} numberOfLines={1}>{displayTitle}</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.videoStage}>
        {coachVideoTrack ? (
          <VideoView style={StyleSheet.absoluteFill} videoTrack={coachVideoTrack} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.videoPlaceholder]}>
            {!connectionTimedOut && <ActivityIndicator color={C.orange} />}
            <Text style={styles.videoPlaceholderText}>
              {connectionTimedOut
                ? "Coach's camera isn't on yet"
                : coachParticipant
                  ? 'Camera starting…'
                  : 'Connecting to live…'}
            </Text>
            {connectionTimedOut && (
              <Pressable style={styles.retryBtn} onPress={onClose}>
                <Text style={styles.retryBtnText}>Leave session</Text>
              </Pressable>
            )}
          </View>
        )}
        <Text style={styles.coachLabel}>{displayCoachName}</Text>
        <View style={styles.chatOverlay}>
          <Text style={styles.chatOverlayTitle}>{displayTitle}</Text>
          {comments.slice(-3).map((c) => (
            <View key={c.id} style={styles.chatOverlayMessage}>
              <Text style={[styles.chatOverlayAuthor, c.authorIsCoach && styles.chatOverlayAuthorCoach]}>
                {c.authorIsCoach ? '⚡ ' : ''}{c.authorName}
              </Text>
              <Text style={styles.chatOverlayBody} numberOfLines={2}>{c.body}</Text>
            </View>
          ))}
        </View>
      </View>

      {onStage && (
        <View style={styles.stageBar}>
          <View style={styles.stageOnBadge}>
            <Text style={styles.stageOnText}>You're on stage</Text>
          </View>
          <Pressable style={styles.leaveStageBtn} onPress={handleLeaveStage}>
            <Text style={styles.leaveStageBtnText}>Leave stage</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.commentsPanel}>
        <ScrollView style={styles.commentsList} contentContainerStyle={{ padding: 12, gap: 8 }}>
          {comments.slice(-30).map((c) => (
            <View key={c.id} style={styles.comment}>
              <Text style={[styles.commentAuthor, c.authorIsCoach && { color: C.orange }]}>
                {c.authorIsCoach ? '⚡ ' : ''}{c.authorName}
              </Text>
              <Text style={styles.commentBody}>{c.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={[styles.commentBar, { paddingBottom: insets.bottom + 10 }]}>
          {joinStatus === 'none' && !onStage && (
            <Pressable style={styles.joinStageBtn} onPress={handleRequestJoin}>
              <Text style={styles.joinStageBtnText}>Request stage</Text>
            </Pressable>
          )}
          {joinStatus === 'pending' && (
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>⏳ Waiting…</Text>
            </View>
          )}
          {joinStatus === 'denied' && (
            <View style={[styles.statusPill, styles.statusPillDenied]}>
              <Text style={styles.statusPillText}>Declined</Text>
            </View>
          )}
          <TextInput
            style={styles.commentInput}
            placeholder="Comment…"
            placeholderTextColor="#444"
            value={commentText}
            onChangeText={setCommentText}
            onSubmitEditing={handleSendComment}
            returnKeyType="send"
          />
          <Pressable style={styles.sendBtn} onPress={handleSendComment}>
            <Text style={styles.sendBtnText}>→</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.black },
  center: { alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#888', fontSize: 15, marginBottom: 20 },
  backBtn: { backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backBtnText: { color: C.text, fontWeight: '700' },
  viewer: { flex: 1 },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.orange, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  livePillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  sessionTitle: { flex: 1, color: C.text, fontSize: 14, fontWeight: '600' },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#888', fontSize: 18 },
  videoStage: { height: 260, backgroundColor: '#000', position: 'relative' },
  videoPlaceholder: { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', gap: 12 },
  videoPlaceholderText: { color: '#555', fontSize: 13 },
  retryBtn: { marginTop: 4, backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryBtnText: { color: '#888', fontSize: 12 },
  coachLabel: { position: 'absolute', bottom: 10, left: 12, color: '#fff', fontSize: 12, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chatOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 42,
    backgroundColor: 'rgba(5,10,20,0.68)',
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  chatOverlayTitle: { color: '#fff', fontSize: 12, fontWeight: '800' },
  chatOverlayMessage: { gap: 1 },
  chatOverlayAuthor: { color: C.green, fontSize: 11, fontWeight: '700' },
  chatOverlayAuthorCoach: { color: C.orange },
  chatOverlayBody: { color: C.text, fontSize: 12, lineHeight: 16 },
  stageBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, backgroundColor: '#0d1a0d', borderTopWidth: 1, borderColor: C.green },
  stageOnBadge: { backgroundColor: C.greenSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  stageOnText: { color: C.green, fontWeight: '700', fontSize: 12 },
  leaveStageBtn: { borderWidth: 1, borderColor: '#555', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  leaveStageBtnText: { color: '#888', fontSize: 12, fontWeight: '600' },
  commentsPanel: { flex: 1, backgroundColor: C.dark },
  commentsList: { flex: 1 },
  comment: { gap: 1 },
  commentAuthor: { color: C.green, fontSize: 11, fontWeight: '700' },
  commentBody: { color: C.text, fontSize: 13 },
  commentBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderColor: C.border },
  joinStageBtn: { backgroundColor: C.orangeSoft, borderWidth: 1, borderColor: C.orangeBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  joinStageBtnText: { color: C.orange, fontWeight: '700', fontSize: 12 },
  statusPill: { backgroundColor: '#1a1500', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  statusPillDenied: { backgroundColor: '#1a0000' },
  statusPillText: { color: '#888', fontSize: 11 },
  commentInput: { flex: 1, backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: C.text, fontSize: 13 },
  sendBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#000', fontWeight: '700', fontSize: 16 },
});
