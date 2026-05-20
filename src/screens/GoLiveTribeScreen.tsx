import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@/lib/livekitGlobals';
import { useKeepAwake } from 'expo-keep-awake';
import {
  ActivityIndicator,
  Alert,
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
  useRemoteParticipants,
  VideoView,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

import { useAuth } from '@/contexts/AuthContext';
import { apexColors as C } from '@/theme/colors';
import {
  createLiveSession,
  endLiveSession,
  fetchComments,
  fetchJoinRequests,
  fetchLiveToken,
  postComment,
  startEgress,
  stopEgress,
  updateJoinRequestStatus,
  type TribeLiveComment,
  type TribeLiveJoinRequest,
  type TribeLiveSession,
} from '@/lib/tribeLive';
import { addTextPostToFeed } from '@/lib/tribeFeed';
import { supabase } from '@/lib/supabase';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import type { MainStackParamList } from '@/navigation/MainNavigator';

type Phase = 'setup' | 'live';

type RouteParams = { sessionId?: string };

export default function GoLiveTribeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<MainStackParamList, 'GoLiveTribe'>>();
  const { session } = useAuth();

  const [phase, setPhase] = useState<Phase>('setup');
  const [title, setTitle] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [liveSession, setLiveSession] = useState<TribeLiveSession | null>(null);
  const [livekitToken, setLivekitToken] = useState<string | undefined>();
  const [livekitUrl, setLivekitUrl] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const [egressId, setEgressId] = useState<string | undefined>();
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as UserProfile;
        setProfile(parsed);
        setTitle((current) => current || 'Day 3 Live Group Workout');
      })
      .catch(() => null);
    requestCameraPermission();
    requestMicPermission();
  }, []);

  const handleGoLive = useCallback(async () => {
    if (!session?.user?.id || !profile) return;
    if (!title.trim()) { Alert.alert('Title required', 'Add a title for your live session.'); return; }
    setStarting(true);
    try {
      await AudioSession.startAudioSession();
      const sess = await createLiveSession({
        coachId: session.user.id,
        coachName: profile.displayName ?? 'Coach',
        coachAvatarUrl: profile.avatarUrl,
        title: title.trim(),
      });
      const { token, livekitUrl: url } = await fetchLiveToken({
        roomName: sess.livekitRoomName,
        participantIdentity: session.user.id,
        participantName: profile.displayName ?? 'Coach',
        canPublish: true,
      });
      setLiveSession(sess);
      setLivekitToken(token);
      setLivekitUrl(url);
      setPhase('live');
      startEgress({ roomName: sess.livekitRoomName, sessionId: sess.id })
        .then(({ egressId: eid, videoUrl: vurl }) => {
          setEgressId(eid);
          setVideoUrl(vurl);
        })
        .catch(() => null);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to start live session.');
    } finally {
      setStarting(false);
    }
  }, [session, profile, title]);

  const handleEndLive = useCallback(() => {
    Alert.alert('End Live Session', 'End the live for all viewers?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Live',
        style: 'destructive',
        onPress: async () => {
          if (liveSession) {
            if (egressId) await stopEgress(egressId).catch(() => null);
            await endLiveSession(liveSession.id).catch(() => null);
            await addTextPostToFeed({
              author: profile?.displayName ?? 'Coach',
              body: `🔴 Just wrapped a live session: "${liveSession.title}" — thanks to everyone who joined!`,
              badgeType: 'tip',
              videoUrl,
            }).catch(() => null);
          }
          AudioSession.stopAudioSession().catch(() => null);
          navigation.goBack();
        },
      },
    ]);
  }, [liveSession, navigation, egressId, videoUrl, profile]);

  const handleUnexpectedDisconnect = useCallback(async () => {
    if (!liveSession) return;
    if (egressId) await stopEgress(egressId).catch(() => null);
    await endLiveSession(liveSession.id).catch(() => null);
    await addTextPostToFeed({
      author: profile?.displayName ?? 'Coach',
      body: `🔴 Just wrapped a live session: "${liveSession.title}" — thanks to everyone who joined!`,
      badgeType: 'tip',
      videoUrl,
    }).catch(() => null);
    AudioSession.stopAudioSession().catch(() => null);
  }, [liveSession, egressId, videoUrl, profile]);

  if (phase === 'setup') {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
            <Text style={styles.backBtn}>✕</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Go Live in Tribe</Text>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {cameraPermission?.granted ? (
            <CameraView style={styles.cameraPreview} facing="front" />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Text style={styles.cameraPlaceholderText}>Camera permission required</Text>
              <Pressable onPress={requestCameraPermission} style={styles.permBtn}>
                <Text style={styles.permBtnText}>Grant Access</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.formSection}>
            <Text style={styles.label}>Session Title</Text>
            <TextInput
              style={styles.input}
              placeholder="Monday mindset reset…"
              placeholderTextColor="#555"
              value={title}
              onChangeText={setTitle}
              maxLength={80}
            />
          </View>

          <View style={styles.checklistCard}>
            <Text style={styles.checklistTitle}>Pre-live checklist</Text>
            {[
              { label: 'Camera ready', ok: cameraPermission?.granted ?? false },
              { label: 'Microphone ready', ok: micPermission?.granted ?? false },
              { label: 'Title added', ok: title.trim().length > 0 },
            ].map((item) => (
              <View key={item.label} style={styles.checkItem}>
                <Text style={[styles.checkDot, { color: item.ok ? C.green : '#555' }]}>
                  {item.ok ? '●' : '○'}
                </Text>
                <Text style={[styles.checkLabel, { color: item.ok ? C.text : '#666' }]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>

          <Pressable
            style={[styles.goLiveBtn, starting && styles.goLiveBtnDisabled]}
            onPress={handleGoLive}
            disabled={starting}
          >
            {starting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.goLiveBtnText}>● Go Live Now</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {livekitToken && livekitUrl && liveSession ? (
        <LiveKitRoom
          serverUrl={livekitUrl}
          token={livekitToken}
          audio
          video
          connect
          onConnected={() => console.log('[TribeLive] coach connected')}
          onDisconnected={handleUnexpectedDisconnect}
          onError={(e) => console.warn('[TribeLive] error', e.message)}
        >
          <BroadcastView
            session={liveSession}
            userId={session?.user?.id ?? ''}
            coachName={profile?.displayName ?? 'Coach'}
            coachAvatarUrl={profile?.avatarUrl}
            onEndLive={handleEndLive}
          />
        </LiveKitRoom>
      ) : (
        <ActivityIndicator color={C.green} style={{ flex: 1 }} />
      )}
    </View>
  );
}

type BroadcastViewProps = {
  session: TribeLiveSession;
  userId: string;
  coachName: string;
  coachAvatarUrl?: string;
  onEndLive: () => void;
};

function BroadcastView({ session, userId, coachName, coachAvatarUrl, onEndLive }: BroadcastViewProps) {
  useKeepAwake();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  const [comments, setComments] = useState<TribeLiveComment[]>([]);
  const [joinRequests, setJoinRequests] = useState<TribeLiveJoinRequest[]>([]);
  const [commentText, setCommentText] = useState('');
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

  const localVideoTrack = localParticipant?.getTrackPublication(Track.Source.Camera)?.track;
  const viewerCount = remoteParticipants.length;

  useEffect(() => {
    fetchComments(session.id).then(setComments);
    fetchJoinRequests(session.id).then(setJoinRequests);

    const commentCh = supabase
      .channel(`live-comments-${session.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tribe_live_comments', filter: `session_id=eq.${session.id}` },
        (payload) => {
          setComments((prev) => [...prev, {
            id: payload.new.id, sessionId: session.id, userId: payload.new.user_id,
            authorName: payload.new.author_name, authorAvatarUrl: payload.new.author_avatar_url ?? undefined,
            authorIsCoach: payload.new.author_is_coach, body: payload.new.body, createdAt: payload.new.created_at,
          }]);
        })
      .subscribe();

    const reqCh = supabase
      .channel(`live-requests-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tribe_live_join_requests', filter: `session_id=eq.${session.id}` },
        () => { fetchJoinRequests(session.id).then(setJoinRequests); })
      .subscribe();

    return () => {
      supabase.removeChannel(commentCh);
      supabase.removeChannel(reqCh);
    };
  }, [session.id]);

  const handleSendComment = useCallback(async () => {
    const body = commentText.trim();
    if (!body) return;
    setCommentText('');
    await postComment({ sessionId: session.id, userId, authorName: coachName, authorAvatarUrl: coachAvatarUrl, authorIsCoach: true, body });
  }, [commentText, session.id, userId, coachName, coachAvatarUrl]);

  const handleApprove = useCallback(async (req: TribeLiveJoinRequest) => {
    await updateJoinRequestStatus(req.id, 'approved');
    setJoinRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: 'approved' } : r));
  }, []);

  const handleDeny = useCallback(async (req: TribeLiveJoinRequest) => {
    await updateJoinRequestStatus(req.id, 'denied');
    setJoinRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: 'denied' } : r));
  }, []);

  const toggleMic = useCallback(() => {
    localParticipant?.setMicrophoneEnabled(micMuted);
    setMicMuted((m) => !m);
  }, [localParticipant, micMuted]);

  const toggleCam = useCallback(() => {
    localParticipant?.setCameraEnabled(camOff);
    setCamOff((c) => !c);
  }, [localParticipant, camOff]);

  const pendingRequests = joinRequests.filter((r) => r.status === 'pending');
  const displayTitle = session.title?.trim() || 'Live Group Workout';

  return (
    <View style={styles.broadcast}>
      {/* Video stage */}
      <View style={styles.stage}>
        {localVideoTrack ? (
          <VideoView style={StyleSheet.absoluteFill} videoTrack={localVideoTrack} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.stageEmpty]}>
            <Text style={styles.stageEmptyText}>Camera starting…</Text>
          </View>
        )}
        <View style={styles.stageBadge}>
          <View style={styles.liveBadgeDot} />
          <Text style={styles.liveBadgeText}>LIVE</Text>
        </View>
        <Text style={styles.viewerCount}>{viewerCount} watching</Text>
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

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable style={[styles.ctrlBtn, micMuted && styles.ctrlBtnOff]} onPress={toggleMic}>
          <Text style={styles.ctrlBtnText}>{micMuted ? '🔇' : '🎤'}</Text>
        </Pressable>
        <Pressable style={[styles.ctrlBtn, camOff && styles.ctrlBtnOff]} onPress={toggleCam}>
          <Text style={styles.ctrlBtnText}>{camOff ? '📵' : '📷'}</Text>
        </Pressable>
        <Pressable style={styles.endBtn} onPress={onEndLive}>
          <Text style={styles.endBtnText}>End Live</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.panels} contentContainerStyle={{ gap: 12, padding: 12 }}>
        {/* Join requests */}
        {pendingRequests.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Join Requests · <Text style={{ color: C.orange }}>{pendingRequests.length}</Text>
            </Text>
            {pendingRequests.map((req) => (
              <View key={req.id} style={styles.reqRow}>
                <Text style={styles.reqName}>{req.requesterName}</Text>
                <View style={styles.reqBtns}>
                  <Pressable style={styles.approveBtn} onPress={() => handleApprove(req)}>
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </Pressable>
                  <Pressable style={styles.denyBtn} onPress={() => handleDeny(req)}>
                    <Text style={styles.denyBtnText}>Deny</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Comments */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Live Comments · {comments.length}</Text>
          {comments.slice(-20).map((c) => (
            <View key={c.id} style={styles.comment}>
              <Text style={styles.commentAuthor}>{c.authorIsCoach ? '⚡ ' : ''}{c.authorName}</Text>
              <Text style={styles.commentBody}>{c.body}</Text>
            </View>
          ))}
          <View style={styles.commentInput}>
            <TextInput
              style={styles.commentTextInput}
              placeholder="Pin a message…"
              placeholderTextColor="#555"
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.black },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { color: C.text, fontSize: 20, width: 32, textAlign: 'center' },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },
  cameraPreview: { height: 220, borderRadius: 16, overflow: 'hidden' },
  cameraPlaceholder: { height: 220, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: 12 },
  cameraPlaceholderText: { color: '#666', fontSize: 14 },
  permBtn: { backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  permBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
  formSection: { gap: 8 },
  label: { color: '#888', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, color: C.text, fontSize: 15 },
  checklistCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, gap: 10 },
  checklistTitle: { color: C.text, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkDot: { fontSize: 14 },
  checkLabel: { fontSize: 14 },
  goLiveBtn: { backgroundColor: C.orange, borderRadius: 14, padding: 18, alignItems: 'center' },
  goLiveBtnDisabled: { opacity: 0.5 },
  goLiveBtnText: { color: '#fff', fontWeight: '800', fontSize: 17, letterSpacing: 0.3 },
  broadcast: { flex: 1 },
  stage: { flex: 2, backgroundColor: '#000', position: 'relative' },
  stageEmpty: { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  stageEmptyText: { color: '#555', fontSize: 14 },
  stageBadge: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.orange, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  liveBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveBadgeText: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  viewerCount: { position: 'absolute', top: 12, right: 12, color: '#fff', fontSize: 12, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  chatOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
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
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#0a0a0a' },
  ctrlBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  ctrlBtnOff: { backgroundColor: '#2a0000' },
  ctrlBtnText: { fontSize: 20 },
  endBtn: { flex: 1, backgroundColor: '#8B0000', borderRadius: 10, padding: 12, alignItems: 'center' },
  endBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  panels: { flex: 1 },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 10 },
  cardTitle: { color: C.text, fontWeight: '700', fontSize: 14 },
  reqRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  reqName: { color: C.text, fontSize: 14, flex: 1 },
  reqBtns: { flexDirection: 'row', gap: 8 },
  approveBtn: { backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  approveBtnText: { color: '#000', fontWeight: '700', fontSize: 12 },
  denyBtn: { backgroundColor: C.card, borderWidth: 1, borderColor: '#555', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  denyBtnText: { color: '#888', fontWeight: '700', fontSize: 12 },
  comment: { gap: 2 },
  commentAuthor: { color: C.green, fontSize: 11, fontWeight: '700' },
  commentBody: { color: C.text, fontSize: 13 },
  commentInput: { flexDirection: 'row', gap: 8, marginTop: 4 },
  commentTextInput: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: C.text, fontSize: 13 },
  sendBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#000', fontWeight: '700', fontSize: 16 },
});
