/**
 * ApexUnlockScreen
 *
 * Full-screen celebration shown immediately after a successful WW → APEX purchase.
 * Loads the user's first name, fires confetti particles, sets the upgrade flag,
 * and lets the user tap "Let's build →" to proceed to the 6-tab navigator.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';

import { setWWUpgraded } from '@/lib/walkWaterMode';
import { PROFILE_STORAGE_KEY } from '@/screens/GoalSetupScreen';

const { width, height } = Dimensions.get('window');

// ─── Theme ────────────────────────────────────────────────────────────────────

const C = {
  black:      '#050A14',
  blue:       '#0EA5E9',
  teal:       '#06B6D4',
  text:       '#F0F8FF',
  muted:      '#6B8BA4',
  blueSoft:   'rgba(14,165,233,0.12)',
  blueBorder: 'rgba(14,165,233,0.3)',
  gold:       '#F59E0B',
};

// ─── Confetti particles ───────────────────────────────────────────────────────

const EMOJIS = ['🎉', '🔥', '💪', '⚡', '💧', '🏆', '✨', '🎊', '💥', '🙌', '🎯', '🌊'];

const PARTICLES = Array.from({ length: 16 }, (_, i) => ({
  emoji: EMOJIS[i % EMOJIS.length],
  x:     10 + Math.random() * (width - 60),
  delay: Math.random() * 800,
  size:  18 + Math.random() * 16,
}));

function ConfettiParticle({ emoji, x, delay, size }: { emoji: string; x: number; delay: number; size: number }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -(height * 0.55 + Math.random() * 100),
          duration: 2200 + Math.random() * 800,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 600, delay: 1200, useNativeDriver: true }),
        ]),
      ]).start();
    }, delay);
    return () => clearTimeout(t);
  }, []);

  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: x,
        bottom: height * 0.18,
        fontSize: size,
        opacity,
        transform: [{ translateY }],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}

// ─── ApexUnlockScreen ─────────────────────────────────────────────────────────

export default function ApexUnlockScreen() {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [firstName, setFirstName] = useState('');

  const heroScale       = useRef(new Animated.Value(0.6)).current;
  const heroOpacity     = useRef(new Animated.Value(0)).current;
  const contentOpacity  = useRef(new Animated.Value(0)).current;
  const btnOpacity      = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Load name
    AsyncStorage.getItem(PROFILE_STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const p = JSON.parse(raw);
          if (p.displayName) setFirstName(p.displayName.split(' ')[0]);
        }
      })
      .catch(() => null);

    // Set upgrade flag immediately
    setWWUpgraded(true).catch(() => null);

    // Haptic burst
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
    setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => null);
    }, 300);

    // Hero stamps in
    Animated.spring(heroScale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 7 }).start();
    Animated.timing(heroOpacity, { toValue: 1, duration: 350, useNativeDriver: true }).start();

    // Content fades in
    setTimeout(() => {
      Animated.timing(contentOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }, 400);

    // Button fades in last
    setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }, 900);
  }, []);

  const handleContinue = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    navigation.replace('ShakeUpsell');
  }, [navigation]);

  const UNLOCKS = [
    { icon: '📅', text: 'Choose a 7, 14, or 21-day challenge to keep your momentum going.' },
    { icon: '💪', text: 'Add bodyweight, dumbbell, and resistance workouts to your routine - no gym required.' },
    { icon: '🥗', text: 'Get simple meals for your goal + your A.I. food scanner.' },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

      {/* Confetti */}
      {PARTICLES.map((p, i) => (
        <ConfettiParticle key={i} {...p} />
      ))}

      {/* Ambient glow */}
      <View style={styles.glowOuter} />
      <View style={styles.glowInner} />

      {/* Hero trophy */}
      <Animated.View style={[styles.trophy, { opacity: heroOpacity, transform: [{ scale: heroScale }] }]}>
        <Text style={styles.trophyEmoji}>🏆</Text>
      </Animated.View>

      {/* Main copy */}
      <Animated.View style={[styles.copy, { opacity: contentOpacity }]}>
        <Text style={styles.eyebrow}>APEX UNLOCKED</Text>
        <Text style={styles.headline}>
          {firstName ? `You did it,\n${firstName}! 🎉` : 'You did it! 🎉'}
        </Text>
        <Text style={styles.sub}>Your challenge proved you can build a habit.{'\n'}Now let's build a body.</Text>
      </Animated.View>

      {/* Unlock checklist */}
      <Animated.View style={[styles.unlocks, { opacity: contentOpacity }]}>
        {UNLOCKS.map((u) => (
          <View key={u.icon} style={styles.unlockRow}>
            <View style={styles.unlockCheck}>
              <Text style={styles.unlockCheckText}>✓</Text>
            </View>
            <Text style={styles.unlockText}>{u.icon}  {u.text}</Text>
          </View>
        ))}
      </Animated.View>

      {/* CTA */}
      <Animated.View style={[styles.btnWrap, { opacity: btnOpacity }]}>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.88 }]}
          onPress={handleContinue}
        >
          <Text style={styles.btnText}>Let's build  →</Text>
        </Pressable>
      </Animated.View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.black,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    overflow: 'hidden',
  },

  glowOuter: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(14,165,233,0.07)',
    borderWidth: 1,
    borderColor: C.blueBorder,
  },
  glowInner: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(14,165,233,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(14,165,233,0.4)',
  },

  trophy: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(245,158,11,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trophyEmoji: { fontSize: 48 },

  copy: { alignItems: 'center', paddingHorizontal: 32, gap: 8 },
  eyebrow: {
    fontSize: 10,
    color: C.blue,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  headline: {
    fontSize: 34,
    color: C.text,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.5,
    lineHeight: 42,
  },
  sub: {
    fontSize: 14,
    color: C.muted,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 4,
  },

  unlocks: {
    width: '100%',
    paddingHorizontal: 32,
    gap: 12,
  },
  unlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  unlockCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(14,165,233,0.2)',
    borderWidth: 1,
    borderColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockCheckText: {
    fontSize: 12,
    color: C.blue,
    fontWeight: '800',
  },
  unlockText: {
    fontSize: 14,
    color: C.text,
    fontWeight: '600',
    flex: 1,
  },

  btnWrap: { width: '100%', paddingHorizontal: 32 },
  btn: {
    backgroundColor: C.blue,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnText: {
    fontSize: 17,
    color: '#000',
    fontWeight: '900',
    letterSpacing: 0.2,
  },
});
