import React, { useEffect, useMemo, useState } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { DeviceEventEmitter, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import {
  getWalkWaterPlan,
  isWalkWaterModeEnabled,
  WALK_WATER_QUIZ_DONE_EVENT,
} from '@/lib/walkWaterMode';
import ViewShot from 'react-native-view-shot';

import { AchievementShareCard } from '@/components/AchievementShareCard';
import { useAuth } from '@/contexts/AuthContext';
import { useGamification } from '@/contexts/GamificationContext';
import { useAchievements } from '@/hooks/useAchievements';
import { getAchievementShareMessage, type UserAchievement } from '@/lib/achievements';
import { supabase } from '@/lib/supabase';
import { addAchievementPostToFeed } from '@/lib/tribeFeed';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { apexColors as C } from '@/theme/colors';

function getSeenKey(userId: string) {
  return `apex.achievements.seen.${userId}`;
}

export function AchievementCelebration() {
  const { session } = useAuth();
  const { level } = useGamification();
  const { achievements, loading } = useAchievements();
  const [currentAchievement, setCurrentAchievement] = useState<UserAchievement | null>(null);
  const [queue, setQueue] = useState<UserAchievement[]>([]);
  const [seenIds, setSeenIds] = useState<string[] | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [wwOnboarding, setWwOnboarding] = useState(false);
  const shareCardRef = React.useRef<ViewShot>(null);

  // Load fresh display name from cache + Supabase so the share card
  // always shows the current profile name, never the old email fragment.
  useEffect(() => {
    const loadName = async () => {
      const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY).catch(() => null);
      const cached: UserProfile | null = raw ? (JSON.parse(raw) as UserProfile) : null;
      if (cached) setProfile(cached);

      if (session?.user?.id) {
        let remoteData: { display_name?: string | null; username?: string | null } | null = null;
        try {
          const { data } = await supabase
            .from('profiles')
            .select('display_name, username')
            .eq('user_id', session.user.id)
            .single();
          remoteData = data as unknown as { display_name?: string | null; username?: string | null } | null;
        } catch {
          // ignore network errors
        }
        const remoteName = remoteData?.display_name ?? null;
        if (remoteName) {
          const merged: UserProfile = { ...(cached ?? ({} as UserProfile)), displayName: remoteName };
          setProfile(merged);
          await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(merged)).catch(() => null);
        }
      }
    };
    loadName().catch(() => null);
  }, [session?.user?.id]);

  const displayName = useMemo(
    () => profile?.displayName || session?.user?.email?.split('@')[0] || 'Athlete',
    [profile?.displayName, session?.user?.email],
  );

  useEffect(() => {
    setCurrentAchievement(null);
    setQueue([]);
    setSeenIds(null);
  }, [session?.user?.id]);

  useEffect(() => {
    Promise.all([isWalkWaterModeEnabled(), getWalkWaterPlan()])
      .then(([ww, plan]) => setWwOnboarding(ww && !plan))
      .catch(() => setWwOnboarding(false));
    const sub = DeviceEventEmitter.addListener(WALK_WATER_QUIZ_DONE_EVENT, () => setWwOnboarding(false));
    return () => sub.remove();
  }, [session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || loading || seenIds !== null) {
      return;
    }

    AsyncStorage.getItem(getSeenKey(userId))
      .then((raw) => {
        if (!raw) {
          const baseline = achievements.filter((item) => item.earned).map((item) => item.id);
          setSeenIds(baseline);
          return AsyncStorage.setItem(getSeenKey(userId), JSON.stringify(baseline));
        }

        try {
          setSeenIds(JSON.parse(raw) as string[]);
        } catch {
          setSeenIds([]);
        }
      })
      .catch(() => setSeenIds([]));
  }, [achievements, loading, seenIds, session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || loading || seenIds === null) {
      return;
    }

    const unseenEarned = achievements.filter((item) => item.earned && !seenIds.includes(item.id));
    if (!unseenEarned.length) {
      return;
    }

    const nextSeenIds = [...new Set([...seenIds, ...unseenEarned.map((item) => item.id)])];
    setSeenIds(nextSeenIds);
    setQueue((currentQueue) => [...currentQueue, ...unseenEarned]);
    AsyncStorage.setItem(getSeenKey(userId), JSON.stringify(nextSeenIds)).catch(() => null);
  }, [achievements, loading, seenIds, session?.user?.id]);

  useEffect(() => {
    if (currentAchievement || queue.length === 0) {
      return;
    }

    const [nextAchievement, ...rest] = queue;
    setCurrentAchievement(nextAchievement);
    setQueue(rest);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
  }, [currentAchievement, queue]);

  const handleClose = () => {
    setCurrentAchievement(null);
  };

  const handleShareSocial = async () => {
    if (!currentAchievement) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const uri = await shareCardRef.current?.capture?.();
      if (uri && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri);
        return;
      }
    } catch {
      // Fall back to text share below.
    }

    await Share.share({ message: getAchievementShareMessage(currentAchievement) });
  };

  const handlePostToTribe = async () => {
    if (!currentAchievement) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await addAchievementPostToFeed({
      achievement: currentAchievement,
      author: displayName,
    });
    handleClose();
  };

  if (!currentAchievement || wwOnboarding) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.kicker}>ACHIEVEMENT UNLOCKED</Text>
          <Text style={styles.icon}>{currentAchievement.icon}</Text>
          <Text style={styles.title}>{currentAchievement.name}</Text>
          <Text style={styles.description}>{currentAchievement.description}</Text>
          <Text style={styles.progress}>Unlocked</Text>

          <View style={styles.actions}>
            <Pressable style={styles.ghostBtn} onPress={handleClose}>
              <Text style={styles.ghostText}>Nice</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => handlePostToTribe().catch(() => null)}>
              <Text style={styles.secondaryText}>Post to Tribe</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={() => handleShareSocial().catch(() => null)}>
              <Text style={styles.primaryText}>Share</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.hiddenCaptureWrap} pointerEvents="none">
          <ViewShot ref={shareCardRef} options={{ format: 'png', quality: 1 }}>
            {currentAchievement ? (
              <AchievementShareCard
                achievement={currentAchievement}
                displayName={displayName}
                level={level}
              />
            ) : (
              <View />
            )}
          </ViewShot>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    padding: 22,
    alignItems: 'center',
  },
  kicker: {
    fontSize: 10,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  icon: {
    fontSize: 50,
    marginBottom: 10,
  },
  title: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  description: {
    marginTop: 6,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  progress: {
    marginTop: 12,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 11,
  },
  actions: {
    width: '100%',
    marginTop: 18,
    gap: 8,
  },
  ghostBtn: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
  secondaryBtn: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
  primaryBtn: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#000',
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
  },
  hiddenCaptureWrap: {
    position: 'absolute',
    left: -9999,
    top: -9999,
    opacity: 0,
  },
});
