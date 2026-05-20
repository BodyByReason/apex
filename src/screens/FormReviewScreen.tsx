import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { getLinkedCoach } from '@/lib/coachInvites';
import { submitFormReviewClip } from '@/lib/formReview';
import type { MainStackParamList } from '@/navigation/MainNavigator';
import { apexColors as C } from '@/theme/colors';

const MAX_DURATION_SECONDS = 15;
const MIN_DURATION_SECONDS = 10;

export default function FormReviewScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'FormReview'>>();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [recording, setRecording] = useState(false);
  const [secondsRecorded, setSecondsRecorded] = useState(0);
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [linkedCoachId, setLinkedCoachId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const exerciseName = route.params?.exerciseName ?? 'Exercise';

  useEffect(() => {
    getLinkedCoach()
      .then((coach) => setLinkedCoachId(coach?.coachUserId ?? null))
      .catch(() => null);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const canSend = useMemo(
    () => !!clipUri && secondsRecorded >= MIN_DURATION_SECONDS && !sending,
    [clipUri, secondsRecorded, sending],
  );

  const stopRecording = useCallback(async () => {
    if (!recording) return;

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    try {
      await cameraRef.current?.stopRecording();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => null);
    } catch {
      // noop
    } finally {
      setRecording(false);
    }
  }, [recording]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recording) return;

    setClipUri(null);
    setSecondsRecorded(0);
    setRecording(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);

    timerRef.current = setInterval(() => {
      setSecondsRecorded((current) => {
        const next = current + 1;
        if (next >= MAX_DURATION_SECONDS) {
          stopRecording().catch(() => null);
        }
        return next;
      });
    }, 1000);

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
      }).catch(() => null);

      const result = await cameraRef.current.recordAsync({
        maxDuration: MAX_DURATION_SECONDS,
      });

      if (result?.uri) {
        setClipUri(result.uri);
      }
    } catch (error) {
      Alert.alert('Could not record video', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setRecording(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => null);
    }
  }, [recording, stopRecording]);

  const handleSend = useCallback(async () => {
    if (!session?.user?.id || !clipUri) return;

    if (secondsRecorded < MIN_DURATION_SECONDS) {
      Alert.alert('Record a little longer', `Send a clip that's at least ${MIN_DURATION_SECONDS} seconds so your coach can review a full movement.`);
      return;
    }

    setSending(true);
    try {
      await submitFormReviewClip({
        clipUri,
        coachUserId: linkedCoachId,
        exerciseName,
        metadata: {
          durationSeconds: secondsRecorded,
          source: route.params?.hasLiveCoach ? 'live_coach' : 'train_screen',
        },
        userId: session.user.id,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
      Alert.alert('Video sent', 'Your form video is in Coach Josh’s review queue now.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not send video', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }, [clipUri, exerciseName, linkedCoachId, navigation, route.params?.hasLiveCoach, secondsRecorded, session?.user?.id]);

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.permissionWrap, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.permissionEmoji}>📷</Text>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.subtitle}>
          Record a short 10–15 second clip and send it straight to Coach Josh for manual form review.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>Allow Camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>FORM REVIEW</Text>
          <Text style={styles.title}>Send Form Video to Coach Josh</Text>
          <Text style={styles.subtitle}>{exerciseName} · front camera by default · vertical video</Text>
        </View>
      </View>

      <View style={styles.cameraShell}>
        <CameraView
          ref={cameraRef}
          facing={cameraFacing}
          mode="video"
          mute={false}
          style={styles.camera}
        />

        <View style={styles.cameraTopRow}>
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>{recording ? 'RECORDING' : 'READY'}</Text>
          </View>
          <Pressable style={styles.flipBtn} onPress={() => setCameraFacing((current) => (current === 'front' ? 'back' : 'front'))}>
            <Text style={styles.flipBtnText}>↺ Flip</Text>
          </Pressable>
        </View>

        {recording ? (
          <View style={styles.timerWrap}>
            <Text style={styles.timerText}>{String(secondsRecorded).padStart(2, '0')}s / 15s</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>What to record</Text>
        <Text style={styles.infoBody}>Keep the full movement in frame, record one working set, and stop around 10–15 seconds.</Text>
      </View>

      <View style={styles.actionRow}>
        {recording ? (
          <Pressable style={[styles.primaryBtn, styles.stopBtn]} onPress={() => stopRecording().catch(() => null)}>
            <Text style={styles.primaryBtnText}>Stop Recording</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primaryBtn} onPress={() => startRecording().catch(() => null)}>
            <Text style={styles.primaryBtnText}>{clipUri ? 'Record Again' : 'Start Recording'}</Text>
          </Pressable>
        )}

        <Pressable
          disabled={!canSend}
          style={[styles.secondaryBtn, !canSend && styles.btnDisabled]}
          onPress={() => handleSend().catch(() => null)}
        >
          {sending ? <ActivityIndicator color={C.text} /> : <Text style={styles.secondaryBtnText}>Send to Coach Josh</Text>}
        </Pressable>
      </View>

      <Text style={styles.footerNote}>
        {clipUri
          ? secondsRecorded >= MIN_DURATION_SECONDS
            ? 'Clip ready. Sending uploads the video to Supabase and adds it to the coach review queue.'
            : `Keep recording until you hit at least ${MIN_DURATION_SECONDS} seconds.`
          : 'No AI grading, no tempo overlay, no rep counter. This goes directly to your coach.'}
      </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.black,
    paddingHorizontal: 16,
  },
  permissionWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  permissionEmoji: {
    fontSize: 48,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 16,
  },
  backBtn: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 24,
  },
  eyebrow: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  title: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 22,
  },
  subtitle: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 3,
  },
  cameraShell: {
    borderColor: C.border,
    borderRadius: 24,
    borderWidth: 1,
    height: 520,
    overflow: 'hidden',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  cameraTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 14,
    position: 'absolute',
    right: 14,
    top: 14,
  },
  liveBadge: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  liveBadgeText: {
    color: '#fff',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  flipBtn: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  flipBtnText: {
    color: '#fff',
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
  },
  timerWrap: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 999,
    bottom: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    position: 'absolute',
  },
  timerText: {
    color: '#fff',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 13,
    letterSpacing: 0.8,
  },
  infoCard: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  infoTitle: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 16,
    marginBottom: 6,
  },
  infoBody: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 22,
  },
  actionRow: {
    gap: 12,
    marginTop: 18,
  },
  primaryBtn: {
    alignItems: 'center',
    backgroundColor: C.green,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  stopBtn: {
    backgroundColor: '#ef4444',
  },
  primaryBtnText: {
    color: '#050A14',
    fontFamily: 'DMSans_700Bold',
    fontSize: 15,
  },
  secondaryBtn: {
    alignItems: 'center',
    backgroundColor: C.surface2,
    borderColor: C.border,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  secondaryBtnText: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 15,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  footerNote: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 16,
    textAlign: 'center',
  },
});
