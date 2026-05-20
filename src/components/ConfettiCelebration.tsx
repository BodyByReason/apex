/**
 * ConfettiCelebration
 *
 * A reusable full-screen animated celebration overlay.
 * Fires confetti particles + a scale-in card with emoji, title, subtitle, and CTA.
 *
 * Usage:
 *   <ConfettiCelebration
 *     visible={showCelebration}
 *     emoji="🎉"
 *     title="WELCOME TO APEX"
 *     subtitle="Your profile is set up. Time to get to work."
 *     ctaLabel="Let's Go →"
 *     onDismiss={() => setShowCelebration(false)}
 *   />
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { apexColors as C } from '@/theme/colors';

const { width: W, height: H } = Dimensions.get('window');
const PARTICLE_COUNT = 60;

const COLORS = [
  C.green, '#FFD700', '#FF6B35', '#A855F7', '#3B82F6',
  '#EC4899', '#10B981', '#F59E0B', '#EF4444', '#FFFFFF',
];

type Particle = {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  rotate: Animated.Value;
  scale: Animated.Value;
  color: string;
  size: number;
  shape: 'rect' | 'circle' | 'line';
  /** Pre-computed final rotation string — avoids calling Math.random() on render */
  spinDeg: string;
};

function createParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }).map(() => ({
    x: new Animated.Value(W * 0.3 + Math.random() * W * 0.4),
    y: new Animated.Value(-20),
    opacity: new Animated.Value(1),
    rotate: new Animated.Value(0),
    scale: new Animated.Value(0.6 + Math.random() * 0.8),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 6 + Math.floor(Math.random() * 10),
    shape: (['rect', 'circle', 'line'] as const)[Math.floor(Math.random() * 3)],
    spinDeg: `${360 + Math.floor(Math.random() * 720)}deg`,
  }));
}

function ParticleView({ p, spinDeg }: { p: Particle; spinDeg: string }) {
  // All animated values must go through `transform` — the native driver
  // does not support `top` / `left` directly.
  const spin = p.rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', spinDeg] });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: p.shape === 'line' ? p.size * 3 : p.size,
        height: p.shape === 'circle' ? p.size : p.size * 0.6,
        borderRadius: p.shape === 'circle' ? p.size / 2 : 2,
        backgroundColor: p.color,
        opacity: p.opacity,
        transform: [
          { translateX: p.x },
          { translateY: p.y },
          { rotate: spin },
          { scale: p.scale },
        ],
      }}
    />
  );
}

type Props = {
  visible: boolean;
  emoji: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  accentColor?: string;
  onDismiss: () => void;
};

export function ConfettiCelebration({
  visible,
  emoji,
  title,
  subtitle,
  ctaLabel,
  accentColor = C.green,
  onDismiss,
}: Props) {
  const particles = useRef<Particle[]>(createParticles()).current;
  const cardScale = useRef(new Animated.Value(0.6)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const emojiScale = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);

    // Reset particles
    particles.forEach((p) => {
      p.x.setValue(W * 0.1 + Math.random() * W * 0.8);
      p.y.setValue(-30 - Math.random() * 60);
      p.opacity.setValue(1);
      p.rotate.setValue(0);
      p.scale.setValue(0.5 + Math.random() * 0.8);
    });
    cardScale.setValue(0.6);
    cardOpacity.setValue(0);
    emojiScale.setValue(0);
    overlayOpacity.setValue(0);

    // Overlay fade-in
    Animated.timing(overlayOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    // Confetti burst
    const particleAnims = particles.map((p, i) => {
      const delay = i * 18;
      const destX = W * 0.05 + Math.random() * W * 0.9;
      const destY = H * 0.3 + Math.random() * H * 0.65;
      const dur = 1200 + Math.random() * 800;
      return Animated.parallel([
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(p.x, { toValue: destX, duration: dur, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(p.y, { toValue: destY, duration: dur, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(delay + dur * 0.6),
          Animated.timing(p.opacity, { toValue: 0, duration: dur * 0.4, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(p.rotate, { toValue: 1, duration: dur, useNativeDriver: true }),
        ]),
      ]);
    });

    // Card pop-in (slight spring feel via sequence)
    const cardAnim = Animated.sequence([
      Animated.delay(180),
      Animated.parallel([
        Animated.spring(cardScale, { toValue: 1.06, useNativeDriver: true, speed: 16, bounciness: 10 }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]),
      Animated.spring(cardScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }),
    ]);

    // Emoji bounce
    const emojiAnim = Animated.sequence([
      Animated.delay(350),
      Animated.spring(emojiScale, { toValue: 1.2, useNativeDriver: true, speed: 14, bounciness: 14 }),
      Animated.spring(emojiScale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 4 }),
    ]);

    Animated.parallel([...particleAnims, cardAnim, emojiAnim]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        {/* Confetti particles */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {particles.map((p, i) => <ParticleView key={i} p={p} spinDeg={p.spinDeg} />)}
        </View>

        {/* Celebration card */}
        <Animated.View style={[styles.card, { borderColor: accentColor, transform: [{ scale: cardScale }], opacity: cardOpacity }]}>
          {/* Glow ring behind emoji */}
          <View style={[styles.emojiRing, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}40` }]}>
            <Animated.Text style={[styles.emoji, { transform: [{ scale: emojiScale }] }]}>
              {emoji}
            </Animated.Text>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <Pressable
            style={[styles.cta, { backgroundColor: accentColor }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
              onDismiss();
            }}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.card,
    borderRadius: 26,
    borderWidth: 1.5,
    padding: 28,
    alignItems: 'center',
    gap: 12,
  },
  emojiRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emoji: {
    fontSize: 52,
  },
  title: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 38,
    letterSpacing: 1.2,
    textAlign: 'center',
    lineHeight: 42,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.76)',
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    lineHeight: 25,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  cta: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  ctaText: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 17,
  },
});
