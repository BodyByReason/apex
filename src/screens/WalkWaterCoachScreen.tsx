/**
 * WalkWaterCoachScreen — Walk & Water Challenge Edition
 *
 * Two-section coach tab:
 *   1. "Work with Coach Josh" card — Maria testimonial video + DM CTA
 *   2. AI coach chat — walk/water habit guidance
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Audio, Video, ResizeMode } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';
import { getWalkWaterPlan, getWaterOzToday, getWalkWaterStreak, saveWalkWaterPlan, setGroupWorkoutDone } from '@/lib/walkWaterMode';
import { getFoodLogToday } from '@/lib/wwFoodLog';
import { getWalkAllTimeRecords, getDailyWalkTotals } from '@/lib/walkRecords';
import { MARIA_TESTIMONIAL_URL, clearConversation } from '@/lib/coachDM';
import { verifyCoachAccessPassword } from '@/lib/adminMode';
import { useAuth } from '@/contexts/AuthContext';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black:      '#050A14',
  card:       '#0D1B2A',
  cardLight:  '#111E2E',
  border:     '#1A2E45',
  blue:       '#0EA5E9',
  teal:       '#06B6D4',
  blueSoft:   'rgba(14,165,233,0.1)',
  blueBorder: 'rgba(14,165,233,0.2)',
  text:       '#F0F8FF',
  muted:      '#6B8BA4',
};

type Message = { role: 'user' | 'assistant'; content: string };

const QUICK_REPLIES = [
  'How am I doing today?',
  'Tips for drinking more water',
  'What should I eat before my walk?',
  'I have low energy — what helps?',
  'Best time to go for a walk',
  'How to push through Day 2',
];

const SYSTEM_PROMPT = `You are an expert Walk + Water Challenge AI coach with deep knowledge of walking science, hydration physiology, nutrition timing, and habit formation. Be direct and specific — 2–3 sentences max per reply. Always end with one concrete, immediate action.

WALKING: Fasted morning walks burn more fat. After-dinner walks lower blood sugar and improve sleep. Sitting 8 hours largely cancels 30 minutes of walking — recommend movement breaks every 45–60 min. Nasal breathing keeps heart rate in fat-burning zone. 100 steps/min = brisk pace. Arms bent at 90° increase speed 15%. A 5% incline nearly doubles calorie burn.

HYDRATION: Thirst means already 1–2% dehydrated — drink before it hits. Target pale yellow urine. Cold water absorbs 20% faster than room temp. Post-walk: a pinch of sea salt in water helps the body retain hydration. Hunger is often thirst — drink 8oz first, wait 10 min. Drink 16oz before first meal every morning.

NUTRITION: Protein at every meal preserves muscle while moving more. Banana or oats 30–45 min before a walk for energy. Avoid high-sodium processed food — causes water retention that masks progress. Anti-inflammatory foods (berries, leafy greens, olive oil) reduce soreness from new movement. Eat protein within 30 min of finishing a walk.

MOVEMENT: Stretch hip flexors before walks — sitting tightens them and makes walking harder. Calf raises prime the legs. Stand during calls. Stairs burn 3–4× more calories than flat walking.

MINDSET: Day 2 is where most people quit — novelty gone, results not yet visible. That is exactly where the habit forms. 10-minute rule: commit to just 10 min — almost everyone keeps going. 60% of goal beats 0% every time. Consistency compounds.

Never give medical advice. Focus only on walking, hydration, nutrition timing, movement, and habit formation.`;

// ─────────────────────────────────────────────────────────────────────────────

const CARD_MINIMIZED_KEY = 'apex.ww.coachCardMinimized';
const ADMIN_TAP_THRESHOLD = 7;

// ─── Local fallback responses (used when edge function is unavailable) ─────────

function getLocalFallback(userMessage: string): string {
  const lower = userMessage.toLowerCase();
  if (lower.includes('eat') || lower.includes('food') || lower.includes('meal') || lower.includes('nutrition') || lower.includes('protein') || lower.includes('breakfast') || lower.includes('lunch') || lower.includes('dinner') || lower.includes('snack')) {
    return "Keep it simple: protein at every meal, a banana or oats 30–45 min before your walk, and protein again within 30 min after. Avoid salty processed food this week — it masks your progress on the scale. Berries, leafy greens, and olive oil help with soreness from new movement.";
  }
  if (lower.includes('water') || lower.includes('drink') || lower.includes('hydrat')) {
    return "Keep sipping throughout the day — don't wait until you're thirsty. A glass before each meal and one first thing in the morning covers most of your goal. Cold water absorbs 20% faster if you're behind.";
  }
  if (lower.includes('step') || lower.includes('walk') || lower.includes('move')) {
    return "Break it into chunks — a 10-minute walk after each meal adds up to 30 minutes without feeling like a workout. That alone can hit your step goal. After-dinner walks also lower blood sugar and improve sleep.";
  }
  if (lower.includes('tired') || lower.includes('energy') || lower.includes('low') || lower.includes('motivation')) {
    return "Drink a glass of water right now — dehydration is the most common cause of low energy. Then take a 5-minute walk outside. That combo works faster than coffee, with no crash after.";
  }
  if (lower.includes('consistent') || lower.includes('habit') || lower.includes('stick')) {
    return "Attach your walk to something you already do every day — after lunch, after work, before your morning coffee. Stack it onto an existing habit and it stops feeling optional.";
  }
  if (lower.includes('doing') || lower.includes('progress') || lower.includes('how am i')) {
    return "Check your steps and water cards on the home screen for today's numbers. Even partial progress counts — every glass and every step moves you forward.";
  }
  return "Stay focused on the two things that matter this challenge: steps and water. Hit both today and you're winning. What specifically can I help you with?";
}

// ─── DM Coach Josh card ───────────────────────────────────────────────────────

function CoachJoshCard({ onDMPress, isFocused }: { onDMPress: () => void; isFocused: boolean }) {
  const insets = useSafeAreaInsets();
  const [modalVisible, setModalVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [ready, setReady] = useState(false);

  // Load persisted minimized state
  React.useEffect(() => {
    AsyncStorage.getItem(CARD_MINIMIZED_KEY)
      .then((v) => { if (v === '1') setMinimized(true); })
      .catch(() => null)
      .finally(() => setReady(true));
  }, []);

  const toggleMinimized = (next: boolean) => {
    setMinimized(next);
    AsyncStorage.setItem(CARD_MINIMIZED_KEY, next ? '1' : '0').catch(() => null);
  };

  if (!ready) return null;

  // ── Minimized bar ──
  if (minimized) {
    return (
      <Pressable
        style={({ pressed }) => [card.miniBar, pressed && { opacity: 0.75 }]}
        onPress={() => toggleMinimized(false)}
      >
        <Image source={require('../../assets/josh-coach.png')} style={card.miniPhoto} />
        <Text style={card.miniLabel}>Need a push? DM Coach Josh</Text>
        <Text style={card.miniChevron}>›</Text>
      </Pressable>
    );
  }

  // ── Full card ──
  return (
    <View style={card.wrap}>
      {/* Header row: eyebrow + minimize button */}
      <View style={card.cardHeader}>
        <Text style={card.eyebrow}>PERSONAL COACHING</Text>
        <Pressable
          onPress={() => toggleMinimized(true)}
          hitSlop={12}
          style={card.minimizeBtn}
        >
          <Text style={card.minimizeBtnText}>−</Text>
        </Pressable>
      </View>

      {/* Body row: Josh info + Maria video */}
      <View style={card.body}>
        {/* Left: Josh photo + details */}
        <View style={card.joshCol}>
          <Image
            source={require('../../assets/josh-coach.png')}
            style={card.joshPhoto}
          />
          <Text style={card.joshName}>Coach Josh</Text>
          <Text style={card.joshSub}>1-on-1 DM Session</Text>
          <View style={card.starRow}>
            <Text style={card.stars}>★★★★★</Text>
            <Text style={card.starCount}>4.9</Text>
          </View>
        </View>

        {/* Right: Maria testimonial video — tap to full-screen */}
        <Pressable style={card.videoCol} onPress={() => {
          Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false }).catch(() => null);
          setModalVisible(true);
        }}>
          <Video
            source={{ uri: MARIA_TESTIMONIAL_URL }}
            style={card.video}
            resizeMode={ResizeMode.COVER}
            shouldPlay={isFocused}
            isLooping
            isMuted
            useNativeControls={false}
          />
          <View style={card.playOverlay}>
            <View style={card.playBtn}>
              <Text style={card.playIcon}>▶</Text>
            </View>
          </View>
          <View style={card.videoOverlay}>
            <Text style={card.videoLabel}>Maria's story</Text>
          </View>
        </Pressable>
      </View>

      {/* CTA */}
      <Pressable
        style={({ pressed }) => [card.dmBtn, pressed && { opacity: 0.85 }]}
        onPress={onDMPress}
      >
        <Text style={card.dmBtnText}>DM Coach Josh  →</Text>
      </Pressable>

      <Text style={card.disclaimer}>Free intro session · no commitment</Text>

      {/* Full-screen video modal */}
      <Modal
        visible={modalVisible}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={card.modalBg}>
          <Video
            source={{ uri: MARIA_TESTIMONIAL_URL }}
            style={card.modalVideo}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={isFocused}
            isLooping={false}
            isMuted={false}
            useNativeControls
          />
          <Pressable
            style={[card.modalClose, { top: insets.top + 12 }]}
            onPress={() => setModalVisible(false)}
            hitSlop={16}
          >
            <Text style={card.modalCloseText}>✕</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const card = StyleSheet.create({
  // ── Minimized bar ──
  miniBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: WW.card,
    borderWidth: 1,
    borderColor: WW.blueBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  miniPhoto: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: WW.blue,
  },
  miniLabel: {
    flex: 1,
    fontSize: 13,
    color: WW.text,
    fontWeight: '600',
  },
  miniChevron: {
    fontSize: 20,
    color: WW.blue,
    fontWeight: '700',
  },
  // ── Full card ──
  wrap: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: WW.card,
    borderWidth: 1,
    borderColor: WW.blueBorder,
    borderRadius: 18,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  minimizeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimizeBtnText: {
    fontSize: 18,
    color: WW.muted,
    lineHeight: 22,
    fontWeight: '600',
  },
  eyebrow: {
    fontSize: 9,
    color: WW.blue,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  body: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 14,
  },
  joshCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  joshPhoto: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: WW.blue,
    marginBottom: 4,
  },
  joshName: {
    fontSize: 13,
    color: WW.text,
    fontWeight: '700',
  },
  joshSub: {
    fontSize: 10,
    color: WW.muted,
    fontWeight: '500',
    textAlign: 'center',
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  stars: {
    fontSize: 10,
    color: '#FBBF24',
  },
  starCount: {
    fontSize: 10,
    color: WW.muted,
    fontWeight: '600',
  },
  videoCol: {
    flex: 2,
    height: 130,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoOverlay: {
    position: 'absolute',
    bottom: 6,
    left: 8,
  },
  videoLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  playIcon: {
    fontSize: 16,
    color: '#fff',
    marginLeft: 3, // optically centre the ▶ glyph
  },
  modalBg: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalVideo: {
    width: '100%',
    height: '100%',
  },
  modalClose: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  dmBtn: {
    backgroundColor: WW.blue,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 8,
  },
  dmBtnText: {
    fontSize: 15,
    color: '#000',
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  disclaimer: {
    fontSize: 10,
    color: WW.muted,
    textAlign: 'center',
    fontWeight: '500',
  },
});

// ─── WalkWaterCoachScreen ─────────────────────────────────────────────────────

export default function WalkWaterCoachScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const scrollRef = useRef<ScrollView>(null);
  const { signOut } = useAuth();
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, [])
  );

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTapCount, setAdminTapCount] = useState(0);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          // Reset the stack to the login screen immediately so the user sees
          // it right away. signOut() then clears the session in the background.
          // Without this reset, React Navigation restores the previous stack
          // state (WalkWaterTabs/CoachScreen) when the navigator remounts.
          navigation.reset({ index: 0, routes: [{ name: 'WalkWaterQuiz', params: { mode: 'signin' } }] });
          signOut().catch(() => null);
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    setShowAccountModal(false);
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              const { error } = await supabase.functions.invoke('delete-account', {});
              if (error) {
                Alert.alert('Error', 'Account deletion failed. Please try again or contact support.');
                return;
              }
              await AsyncStorage.clear().catch(() => null);
              await signOut().catch(() => null);
            } catch {
              Alert.alert('Error', 'Could not connect. Check your connection and try again.');
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    );
  };

  // Dev tools are session-only — never auto-restored from storage.

  const handleHeaderTap = useCallback(() => {
    if (isAdmin) return;
    const next = adminTapCount + 1;
    setAdminTapCount(next);
    if (next >= ADMIN_TAP_THRESHOLD) {
      setAdminTapCount(0);
      setPasswordInput('');
      setPasswordError('');
      setShowPasswordModal(true);
    }
  }, [isAdmin, adminTapCount]);

  const handlePasswordSubmit = useCallback(() => {
    if (verifyCoachAccessPassword(passwordInput)) {
      setIsAdmin(true);
      setShowPasswordModal(false);
      Alert.alert('Coach Tools Unlocked', 'You now have access to coach tools from this tab.');
    } else {
      setPasswordError('Incorrect password.');
    }
  }, [passwordInput]);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hey! I'm your Walk + Water coach. Tell me how today is going — steps, water, energy — and I'll give you a quick win to focus on right now. 💧🚶",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [coachContext, setCoachContext] = useState('');

  // Load rich context on every focus — injected into system prompt
  useFocusEffect(useCallback(() => {
    const load = async () => {
      const [plan, waterOz, streak, foodLog, walkRecords, todayWalks] = await Promise.all([
        getWalkWaterPlan(),
        getWaterOzToday(),
        getWalkWaterStreak(),
        getFoodLogToday(),
        getWalkAllTimeRecords(),
        getDailyWalkTotals(),
      ]);
      if (!plan) return;
      const day = Math.min(streak + 1, plan.challengeDays);
      const waterGlasses = Math.round(waterOz / 8);
      const waterGoalGlasses = Math.round(plan.dailyWaterGoalOz / 8);
      const caloriesLogged = foodLog.calories;
      const proteinLogged  = foodLog.protein;
      const foodItems      = foodLog.entries.map(e => e.name).join(', ') || 'nothing logged yet';
      setCoachContext(
        `User context: Day ${day} of ${plan.challengeDays}-day challenge. ` +
        `Primary goal: ${plan.goalLabel}. ` +
        `Water today: ${waterGlasses} of ${waterGoalGlasses} glasses. ` +
        `Steps today: ${todayWalks.steps.toLocaleString()} (goal: ${plan.dailyStepGoal.toLocaleString()}). ` +
        `Walks completed: ${todayWalks.walks} today, ${walkRecords.totalWalks} total. ` +
        `Food logged today: ${caloriesLogged} kcal, ${proteinLogged}g protein. Items: ${foodItems}. ` +
        `Preferred walk time: ${plan.walkTimeLabel}.`
      );

    };
    load().catch(() => null);
  }, []));

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    scrollRef.current?.scrollToEnd({ animated: true });

    // Build clean alternating message list for Anthropic:
    // - skip the display-only opening greeting (role: assistant at index 0)
    // - only include real user/assistant turns after that
    const apiMessages = next
      .slice(1)  // drop the opening assistant greeting
      .filter((m) => !m.content.startsWith('[Context:'));  // drop any legacy context messages

    try {
      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          model: 'claude-haiku-4-5-20251001',
          system: coachContext ? `${SYSTEM_PROMPT}\n\n${coachContext}` : SYSTEM_PROMPT,
          max_tokens: 250,
          messages: apiMessages.map((m) => ({ role: m.role, content: m.content })),
        },
      });
      if (error) {
        // Read the actual Anthropic error body for debugging
        try {
          const errBody = await (error as any).context?.json?.();
          console.warn('[WW Coach] Anthropic error body:', JSON.stringify(errBody));
        } catch { /* ignore */ }
        throw error;
      }
      const raw: string = data?.content?.map((b: { text?: string }) => b.text ?? '').join('') ?? '';
      const reply: Message = { role: 'assistant', content: raw.trim() || "Keep going — you're building a great habit!" };
      setMessages((prev) => [...prev, reply]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('[WW Coach] Edge function error:', errMsg);
      const fallback = getLocalFallback(trimmed);
      setMessages((prev) => [...prev, { role: 'assistant', content: fallback }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, loading]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header — tap 7× to unlock coach password prompt */}
      <Pressable onPress={handleHeaderTap} style={styles.header}>
        <View style={styles.coachMeta}>
          <Text style={styles.coachEmoji}>🤖</Text>
          <View>
            <Text style={styles.coachName}>Walk + Water Coach</Text>
            <Text style={styles.coachSub}>AI powered · always on</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => setShowAccountModal(true)}
            hitSlop={12}
            style={styles.accountBtn}
          >
            <Text style={styles.accountBtnText}>⚙️</Text>
          </Pressable>
          <View style={styles.liveDot} />
        </View>
      </Pressable>

      {/* Account modal */}
      <Modal
        visible={showAccountModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAccountModal(false)}
      >
        <Pressable style={styles.accountModalOverlay} onPress={() => setShowAccountModal(false)}>
          <Pressable style={styles.accountSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.accountSheetTitle}>Account</Text>
            <Pressable
              style={styles.accountSheetBtn}
              onPress={() => { setShowAccountModal(false); handleSignOut(); }}
            >
              <Text style={styles.accountSheetBtnText}>Sign Out</Text>
            </Pressable>
            <Pressable
              style={[styles.accountSheetBtn, styles.accountSheetBtnDanger]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
            >
              {deletingAccount
                ? <ActivityIndicator size="small" color="#EF4444" />
                : <Text style={[styles.accountSheetBtnText, { color: '#EF4444' }]}>Delete Account</Text>
              }
            </Pressable>
            <Pressable
              style={[styles.accountSheetBtn, { marginTop: 4 }]}
              onPress={() => setShowAccountModal(false)}
            >
              <Text style={[styles.accountSheetBtnText, { color: WW.muted }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Dev Tools — visible only when admin unlocked */}
      {isAdmin && (
        <View style={styles.coachTools}>
          <Text style={styles.coachToolsLabel}>DEV TOOLS</Text>
          <View style={styles.coachToolsRow}>
            <Pressable
              style={[styles.coachToolBtn, { borderColor: 'rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.06)' }]}
              onPress={async () => {
                Alert.alert(
                  'Reset to New User?',
                  'This clears the plan, quiz, upgrade status, water, and food log.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset', style: 'destructive',
                      onPress: async () => {
                        const today = new Date().toISOString().slice(0, 10);
                        await Promise.all([
                          AsyncStorage.removeItem('apex._edition.walkWaterPlan'),
                          AsyncStorage.removeItem('apex._edition.walkWaterQuiz'),
                          AsyncStorage.removeItem('apex._edition.wwUpgraded'),
                          AsyncStorage.removeItem('apex.ww.groupWorkoutDone'),
                          AsyncStorage.removeItem('apex.ww.groupWorkoutDoneAt'),
                          AsyncStorage.removeItem(`apex.ww.water.${today}`),
                          AsyncStorage.removeItem(`apex.ww.foodLog.${today}`),
                        ]);
                        Alert.alert('Reset', 'All WW data cleared. Restart the app or navigate to Home.');
                      },
                    },
                  ],
                );
              }}
            >
              <Text style={styles.coachToolBtnEmoji}>👤</Text>
              <Text style={styles.coachToolBtnText}>New User</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.coachToolBtn, { marginTop: 6, borderColor: 'rgba(16,185,129,0.4)', backgroundColor: 'rgba(16,185,129,0.06)' }]}
            onPress={async () => {
              const plan = await getWalkWaterPlan();
              if (!plan) { Alert.alert('No plan', 'Complete the quiz first, then come back.'); return; }
              const fakeStart = new Date();
              fakeStart.setDate(fakeStart.getDate() - 14);
              await saveWalkWaterPlan({ ...plan, challengeDays: 14, startDate: fakeStart.toISOString().slice(0, 10) });
              await setGroupWorkoutDone();
              navigation.navigate('ChallengeComplete');
            }}
          >
            <Text style={styles.coachToolBtnEmoji}>💰</Text>
            <Text style={[styles.coachToolBtnText, { color: '#10B981' }]}>$9.99 Offer</Text>
          </Pressable>
          <Pressable
            style={[styles.coachToolBtn, { marginTop: 6, borderColor: 'rgba(14,165,233,0.45)', backgroundColor: 'rgba(14,165,233,0.08)' }]}
            onPress={() => navigation.navigate('ShakeCheckout', { flavor: 'chocolate' })}
          >
            <Text style={styles.coachToolBtnEmoji}>🥤</Text>
            <Text style={[styles.coachToolBtnText, { color: WW.blue }]}>Buy Shakes Screen</Text>
          </Pressable>
          <Pressable
            style={[styles.coachToolBtn, { marginTop: 6, borderColor: 'rgba(6,182,212,0.45)', backgroundColor: 'rgba(6,182,212,0.08)' }]}
            onPress={() => navigation.navigate('CoachMode')}
          >
            <Text style={styles.coachToolBtnEmoji}>🎯</Text>
            <Text style={[styles.coachToolBtnText, { color: WW.teal }]}>Coach Mode</Text>
          </Pressable>
          <Pressable
            style={[styles.coachToolBtn, { marginTop: 6, borderColor: 'rgba(168,85,247,0.4)', backgroundColor: 'rgba(168,85,247,0.06)' }]}
            onPress={async () => {
              await clearConversation();
              Alert.alert('DM Reset', 'Coach DM conversation cleared. Reopen the DM to start fresh.');
            }}
          >
            <Text style={styles.coachToolBtnEmoji}>💬</Text>
            <Text style={styles.coachToolBtnText}>Reset DM</Text>
          </Pressable>
          <Pressable
            style={[styles.coachToolBtn, { marginTop: 6, borderColor: 'rgba(99,102,241,0.45)', backgroundColor: 'rgba(99,102,241,0.08)' }]}
            onPress={() => navigation.navigate('GoLiveTribe')}
          >
            <Text style={styles.coachToolBtnEmoji}>🎙️</Text>
            <Text style={[styles.coachToolBtnText, { color: '#818CF8' }]}>Go Live Tribe</Text>
          </Pressable>
          <Pressable
            style={[styles.coachToolBtn, { marginTop: 6, borderColor: 'rgba(255,255,255,0.1)' }]}
            onPress={() => setIsAdmin(false)}
          >
            <Text style={styles.coachToolBtnEmoji}>🔒</Text>
            <Text style={styles.coachToolBtnText}>Lock</Text>
          </Pressable>
        </View>
      )}

      {/* Password modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowPasswordModal(false)}
        >
          <Pressable style={styles.passwordSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.passwordTitle}>Coach Access</Text>
            <TextInput
              style={styles.passwordInput}
              placeholder="Enter coach password"
              placeholderTextColor={WW.muted}
              value={passwordInput}
              onChangeText={(t) => { setPasswordInput(t); setPasswordError(''); }}
              secureTextEntry
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handlePasswordSubmit}
            />
            {passwordError ? <Text style={styles.passwordError}>{passwordError}</Text> : null}
            <Pressable style={styles.passwordBtn} onPress={handlePasswordSubmit}>
              <Text style={styles.passwordBtnText}>Unlock →</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* DM Coach Josh card — fixed at top, never scrolls */}
      <CoachJoshCard onDMPress={() => navigation.navigate('CoachDM', { brand: 'ww' })} isFocused={isFocused} />

      {/* AI Chat section label */}
      <View style={styles.chatDivider}>
        <View style={styles.chatDividerLine} />
        <Text style={styles.chatDividerLabel}>AI COACH CHAT</Text>
        <View style={styles.chatDividerLine} />
      </View>

      {/* Scrollable messages only */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <View style={styles.messagesContent}>
          {messages
            .filter((m) => !m.content.startsWith('[Context:'))
            .map((msg, i) => (
              <View key={i} style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleCoach]}>
                {msg.role === 'assistant' && <Text style={styles.bubbleAvatar}>🤖</Text>}
                <View style={[styles.bubbleInner, msg.role === 'user' ? styles.bubbleInnerUser : styles.bubbleInnerCoach]}>
                  <Text style={[styles.bubbleText, msg.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextCoach]}>
                    {msg.content}
                  </Text>
                </View>
              </View>
            ))}
          {loading && (
            <View style={[styles.bubble, styles.bubbleCoach]}>
              <Text style={styles.bubbleAvatar}>🤖</Text>
              <View style={styles.bubbleInnerCoach}>
                <ActivityIndicator size="small" color={WW.blue} />
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Quick replies */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickRow}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 8 }}
      >
        {QUICK_REPLIES.map((q) => (
          <Pressable key={q} style={styles.quickChip} onPress={() => sendMessage(q)}>
            <Text style={styles.quickChipText}>{q}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Input */}
      <View style={[styles.inputRow, { paddingBottom: 8 }]}>
        <TextInput
          style={styles.input}
          placeholder="Ask your coach…"
          placeholderTextColor={WW.muted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={() => sendMessage(input)}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => sendMessage(input)}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.sendBtnText}>→</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WW.black },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: WW.border,
  },
  coachMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coachEmoji: { fontSize: 28 },
  coachName: { fontSize: 16, color: WW.text, fontWeight: '700' },
  coachSub: { fontSize: 11, color: WW.muted, marginTop: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: WW.teal },

  chatDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 6,
    gap: 8,
  },
  chatDividerLine: { flex: 1, height: 1, backgroundColor: WW.border },
  chatDividerLabel: {
    fontSize: 9,
    color: WW.muted,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  messages: { flex: 1 },
  messagesContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 12 },

  bubble: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleUser: { flexDirection: 'row-reverse' },
  bubbleCoach: {},
  bubbleAvatar: { fontSize: 20, marginBottom: 2 },
  bubbleInner: { maxWidth: '80%', borderRadius: 16, padding: 13 },
  bubbleInnerCoach: { backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border, borderBottomLeftRadius: 4 },
  bubbleInnerUser: { backgroundColor: WW.blue, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 21 },
  bubbleTextCoach: { color: WW.text },
  bubbleTextUser: { color: '#000', fontWeight: '500' },

  quickRow: { borderTopWidth: 1, borderTopColor: WW.border, maxHeight: 52 },
  quickChip: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.blueBorder,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  quickChipText: { fontSize: 12, color: WW.blue, fontWeight: '600' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 6,
    borderTopWidth: 1, borderTopColor: WW.border,
    backgroundColor: WW.black,
  },
  input: {
    flex: 1, backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    color: WW.text, fontSize: 14, maxHeight: 100,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: WW.blue, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#000', fontSize: 18, fontWeight: '800' },

  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accountBtn: { padding: 4 },
  accountBtnText: { fontSize: 18 },

  accountModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  accountSheet: {
    backgroundColor: WW.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: WW.border,
    padding: 24,
    gap: 10,
  },
  accountSheetTitle: {
    fontSize: 18,
    color: WW.text,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  accountSheetBtn: {
    backgroundColor: WW.cardLight,
    borderWidth: 1,
    borderColor: WW.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  accountSheetBtnDanger: {
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.06)',
  },
  accountSheetBtnText: {
    fontSize: 15,
    color: WW.text,
    fontWeight: '700',
  },

  adminBadge: { fontSize: 18 },

  coachTools: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 2,
    backgroundColor: 'rgba(14,165,233,0.06)',
    borderWidth: 1,
    borderColor: WW.blueBorder,
    borderRadius: 14,
    padding: 12,
  },
  coachToolsLabel: {
    fontSize: 9,
    color: WW.blue,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  coachToolsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  coachToolBtn: {
    flex: 1,
    backgroundColor: WW.card,
    borderWidth: 1,
    borderColor: WW.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
  },
  coachToolBtnEmoji: { fontSize: 22 },
  coachToolBtnText: { fontSize: 11, color: WW.text, fontWeight: '700', letterSpacing: 0.3 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  passwordSheet: {
    width: '100%',
    backgroundColor: WW.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: WW.border,
    padding: 24,
    gap: 12,
  },
  passwordTitle: {
    fontSize: 18,
    color: WW.text,
    fontWeight: '800',
    marginBottom: 4,
  },
  passwordInput: {
    backgroundColor: WW.black,
    borderWidth: 1,
    borderColor: WW.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: WW.text,
    fontSize: 15,
  },
  passwordError: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '500',
  },
  passwordBtn: {
    backgroundColor: WW.blue,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  passwordBtnText: { fontSize: 15, color: '#000', fontWeight: '800' },

});
