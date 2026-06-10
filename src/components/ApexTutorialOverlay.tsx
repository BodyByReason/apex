/**
 * ApexTutorialOverlay
 *
 * A quick, one-time interactive walkthrough of the Apex 101 home screen. It
 * explains what each bottom tab (and the profile button) does WITHOUT navigating
 * the user away from Home. Shown the first time someone lands in the Apex app
 * (e.g. a Walk & Water user who just switched over) and never again once dismissed.
 *
 * Self-contained: reads the current user via useAuth, checks/sets its own
 * "tutorial done" flag, and renders nothing when already completed.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { isApexTutorialDone, markApexTutorialDone } from '@/lib/apexAccess';

type Step = { emoji: string; title: string; body: string };

// Order mirrors the bottom tab bar (Dashboard, Train, Fuel, Tribe, Coach, Plans),
// then the profile button in the header.
const STEPS: Step[] = [
  { emoji: '🏠', title: 'Home', body: 'Your daily snapshot — protein, calories, steps, weight trend, and today’s plan, all at a glance.' },
  { emoji: '🏋️', title: 'Train', body: 'Your workouts. Log your sets, watch quick form videos, and train with Coach Josh live in your ear.' },
  { emoji: '🍎', title: 'Fuel', body: 'Log your food and water. Hit your protein and calorie targets without the guesswork.' },
  { emoji: '👥', title: 'Tribe', body: 'Your community. Share wins, ask questions, and stay accountable with the group.' },
  { emoji: '💬', title: 'Coach', body: 'Chat with Coach Josh anytime — form, food, mindset, or anything about your plan.' },
  { emoji: '📋', title: 'Plans', body: 'Your full training + nutrition plan. See what’s programmed and adjust as you progress.' },
  { emoji: '👤', title: 'Profile', body: 'Tap your photo in the top corner for settings, goals, your coach voice, and account.' },
];

interface ApexTutorialOverlayProps {
  accent?: string;
}

export default function ApexTutorialOverlay({ accent = '#0EA5E9' }: ApexTutorialOverlayProps) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let active = true;
    if (!userId) return;
    isApexTutorialDone(userId)
      .then((done) => { if (active && !done) setVisible(true); })
      .catch(() => null);
    return () => { active = false; };
  }, [userId]);

  const finish = useCallback(() => {
    setVisible(false);
    markApexTutorialDone(userId).catch(() => null);
  }, [userId]);

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={[styles.scrim, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.card}>
          <View style={styles.topRow}>
            <Text style={styles.eyebrow}>QUICK TOUR · {step + 1}/{STEPS.length}</Text>
            <Pressable hitSlop={10} onPress={finish}>
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
          </View>

          <Text style={styles.emoji}>{current.emoji}</Text>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>

          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, { backgroundColor: i === step ? accent : 'rgba(255,255,255,0.18)' }]}
              />
            ))}
          </View>

          <View style={styles.navRow}>
            <Pressable
              style={[styles.backBtn, step === 0 && styles.hidden]}
              disabled={step === 0}
              onPress={() => setStep((s) => Math.max(0, s - 1))}
            >
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.nextBtn, { backgroundColor: accent }]}
              onPress={() => (isLast ? finish() : setStep((s) => s + 1))}
            >
              <Text style={styles.nextText}>{isLast ? 'Got it' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(3,7,18,0.86)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#0D1B2A',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 22,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 11, color: '#6B8BA4', fontWeight: '800', letterSpacing: 1.4 },
  skip: { fontSize: 13, color: '#6B8BA4', fontWeight: '700' },
  emoji: { fontSize: 40, marginTop: 16 },
  title: { fontSize: 24, color: '#F0F8FF', fontWeight: '900', marginTop: 8, letterSpacing: -0.4 },
  body: { fontSize: 15, color: '#AFC4D6', fontWeight: '500', lineHeight: 22, marginTop: 8 },
  dots: { flexDirection: 'row', gap: 7, marginTop: 22 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 },
  backBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  backText: { fontSize: 15, color: '#6B8BA4', fontWeight: '700' },
  hidden: { opacity: 0 },
  nextBtn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 36, alignItems: 'center' },
  nextText: { fontSize: 16, color: '#031018', fontWeight: '900' },
});
