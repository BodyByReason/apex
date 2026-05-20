import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '@/contexts/AuthContext';
import { fetchActiveSession, type TribeLiveSession } from '@/lib/tribeLive';
import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import type { MainStackParamList } from '@/navigation/MainNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Nav = NativeStackNavigationProp<MainStackParamList>;

export function TribeLiveBanner() {
  const { session } = useAuth();
  const navigation = useNavigation<Nav>();
  const [liveSession, setLiveSession] = useState<TribeLiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCoach, setIsCoach] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const p = JSON.parse(raw) as UserProfile;
          setIsCoach(p.isCoach ?? false);
        }
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    fetchActiveSession()
      .then(setLiveSession)
      .finally(() => setLoading(false));

    const channel = supabase
      .channel('tribe-live-banner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tribe_live_sessions' },
        () => { fetchActiveSession().then(setLiveSession); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  if (loading) return null;

  if (isCoach && !liveSession) {
    return (
      <Pressable
        style={styles.coachCta}
        onPress={() => navigation.navigate('GoLiveTribe')}
      >
        <View style={styles.dot} />
        <Text style={styles.coachCtaText}>Go Live in Tribe</Text>
        <Text style={styles.coachCtaArrow}>→</Text>
      </Pressable>
    );
  }

  if (!liveSession) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.left}>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>LIVE</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.coachName} numberOfLines={1}>{liveSession.coachName}</Text>
          <Text style={styles.title} numberOfLines={1}>{liveSession.title}</Text>
          <Text style={styles.viewers}>{liveSession.viewerCount} watching</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {isCoach ? (
          <Pressable
            style={styles.btnPrimary}
            onPress={() => navigation.navigate('GoLiveTribe', { sessionId: liveSession.id })}
          >
            <Text style={styles.btnPrimaryText}>Manage</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.btnPrimary}
            onPress={() => navigation.navigate('TribeLiveViewer', { sessionId: liveSession.id })}
          >
            <Text style={styles.btnPrimaryText}>Watch Live</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A0A00',
    borderWidth: 1,
    borderColor: C.orange,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 10 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.orange,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  livePillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  info: { flex: 1 },
  coachName: { color: C.text, fontSize: 13, fontWeight: '700' },
  title: { color: '#aaa', fontSize: 12, marginTop: 1 },
  viewers: { color: C.orange, fontSize: 11, marginTop: 2 },
  actions: {},
  btnPrimary: {
    backgroundColor: C.orange,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  coachCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.orangeSoft,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.orange },
  coachCtaText: { color: C.orange, fontWeight: '700', fontSize: 14, flex: 1 },
  coachCtaArrow: { color: C.orange, fontSize: 16, fontWeight: '700' },
});
