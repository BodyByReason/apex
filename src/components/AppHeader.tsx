import React, { useEffect, useState } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet, Text, Pressable, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useAuth } from '@/contexts/AuthContext';
import { useGamification } from '@/contexts/GamificationContext';
import { setApexAccessPreviewEnabled } from '@/lib/apexAccess';
import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { setWalkWaterModeEnabled } from '@/lib/walkWaterMode';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';

function useStreak(userId?: string) {
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const { data } = await supabase
        .from('workouts')
        .select('workout_date')
        .eq('user_id', userId)
        .order('workout_date', { ascending: false })
        .limit(60);
      if (!data?.length) return;
      const dates = [...new Set(data.map((w) => w.workout_date?.slice(0, 10)))].sort().reverse();
      let s = 0;
      const today = new Date();
      for (let i = 0; i < dates.length; i++) {
        const expected = new Date(today);
        expected.setDate(today.getDate() - i);
        if (dates[i] === expected.toISOString().slice(0, 10)) s++;
        else break;
      }
      setStreak(s || 1);
    };
    load().catch(() => null);
  }, [userId]);

  return streak;
}

export function AppHeader() {
  const { accent, accentSoft, accentBorder, accentStrongBorder } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { session } = useAuth();
  const { level } = useGamification();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const streak = useStreak(session?.user?.id);

  const loadProfile = () => {
    AsyncStorage.getItem(PROFILE_STORAGE_KEY)
      .then((raw) => raw && setProfile(JSON.parse(raw)))
      .catch(() => null);
  };

  useEffect(() => {
    loadProfile();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadProfile();
    }, []),
  );

  const displayName = profile?.displayName || session?.user?.email?.split('@')[0] || 'You';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'AP';

  const streakDisplay = streak > 0 ? streak : 1;

  const handleLogoLongPress = React.useCallback(async () => {
    await setApexAccessPreviewEnabled(false).catch(() => null);
    await setWalkWaterModeEnabled(true).catch(() => null);
  }, []);

  return (
    <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 12) }]}>
      <Pressable
        onLongPress={() => { handleLogoLongPress().catch(() => null); }}
        delayLongPress={900}
        hitSlop={8}
      >
        <Text style={[styles.logo, { color: accent }]}>APEX</Text>
      </Pressable>
      <View style={styles.right}>
        <View style={styles.streak}>
          <Text style={styles.streakFire}>🔥</Text>
          <Text style={styles.streakValue}>{streakDisplay}</Text>
          <View style={styles.streakTextWrap}>
            <Text style={styles.streakText}>DAY</Text>
            <Text style={styles.streakText}>STREAK</Text>
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [styles.avatarWrap, pressed && { opacity: 0.8 }]}
          onPress={() => navigation.navigate('Profile')}
          hitSlop={8}
        >
          <View style={styles.avatarDot} />
          <View style={[styles.avatar, { backgroundColor: accent }]}>
            {profile?.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    backgroundColor: 'rgba(8,8,8,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  logo: {
    color: C.green,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 26,
    letterSpacing: 4,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    backgroundColor: C.orangeSoft,
  },
  streakFire: { fontSize: 14 },
  streakValue: {
    color: C.orange,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    lineHeight: 18,
    marginTop: 1,
  },
  streakText: {
    color: C.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 0.3,
    lineHeight: 10,
  },
  streakTextWrap: {
    justifyContent: 'center',
    gap: 0,
    marginTop: 1,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.orange,
    zIndex: 2,
    borderWidth: 1.5,
    borderColor: C.black,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: '#000',
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    fontWeight: '700',
  },
});
