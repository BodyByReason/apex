/**
 * WaterLogScreen — Walk & Water Challenge Edition
 *
 * Full-screen water intake tracker with:
 *   • Animated fill visualization (glass that fills up)
 *   • Quick-add buttons (8, 12, 16 oz)
 *   • Custom oz input
 *   • Daily goal progress with streak data
 *   • History of today's logs
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addWaterOz,
  getWalkWaterPlan,
  getWaterOzToday,
  setWaterOz,
} from '@/lib/walkWaterMode';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black: '#050A14',
  dark: '#080F1A',
  card: '#0D1B2A',
  border: '#1A2E45',
  blue: '#0EA5E9',
  teal: '#06B6D4',
  blueSoft: 'rgba(14,165,233,0.08)',
  tealSoft: 'rgba(6,182,212,0.1)',
  tealBorder: 'rgba(6,182,212,0.25)',
  text: '#F0F8FF',
  muted: '#6B8BA4',
};

// ─── Log entry ────────────────────────────────────────────────────────────────

type LogEntry = { oz: number; time: string };

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function logHistoryKey(): string {
  return `apex.ww.waterHistory.${localDateStr()}`;
}

async function getTodayLog(): Promise<LogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(logHistoryKey());
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch { return []; }
}

async function appendLog(oz: number): Promise<LogEntry[]> {
  const key = logHistoryKey();
  const log = await getTodayLog();
  const next = [...log, { oz, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }];
  await AsyncStorage.setItem(key, JSON.stringify(next));
  return next;
}

// ─── Water glass SVG-style fill using RN views ────────────────────────────────

function WaterGlass({ pct }: { pct: number }) {
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: Math.min(1, pct),
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct, fillAnim]);

  return (
    <View style={glass.container}>
      {/* Water fill — rises from bottom */}
      <Animated.View
        style={[
          glass.fill,
          {
            height: fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            backgroundColor: pct >= 1 ? WW.teal : WW.blue,
          },
        ]}
      />
      {/* Wave shimmer on top of fill */}
      <View style={glass.glassOverlay} />
      {/* Percentage text */}
      <View style={glass.labelWrap}>
        <Text style={glass.pctText}>{Math.round(pct * 100)}%</Text>
        <Text style={glass.pctSub}>of daily goal</Text>
      </View>
    </View>
  );
}

const glass = StyleSheet.create({
  container: {
    width: 140, height: 200,
    backgroundColor: '#0a1929',
    borderWidth: 2, borderColor: WW.tealBorder,
    borderRadius: 20,
    overflow: 'hidden',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    borderRadius: 0,
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 18,
  },
  labelWrap: { alignItems: 'center', zIndex: 2 },
  pctText: { fontSize: 36, color: WW.text, fontWeight: '900', letterSpacing: -0.5 },
  pctSub: { fontSize: 11, color: 'rgba(240,248,255,0.6)', fontWeight: '600', marginTop: 2 },
});

// ─── WaterLogScreen ───────────────────────────────────────────────────────────

const QUICK_ADD = [
  { oz: 8,  label: '8 oz', sub: '1 glass' },
  { oz: 12, label: '12 oz', sub: 'Small bottle' },
  { oz: 16, label: '16 oz', sub: 'Large glass' },
  { oz: 20, label: '20 oz', sub: 'Water bottle' },
];

export default function WaterLogScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [waterOz, setWaterOzState] = useState(0);
  const [goalOz, setGoalOz] = useState(64);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [customOz, setCustomOz] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const load = useCallback(async () => {
    const [oz, plan, hist] = await Promise.all([
      getWaterOzToday(),
      getWalkWaterPlan(),
      getTodayLog(),
    ]);
    setWaterOzState(oz);
    if (plan) setGoalOz(plan.dailyWaterGoalOz);
    setLog(hist);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAdd = useCallback(async (oz: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = await addWaterOz(oz);
    const hist = await appendLog(oz);
    setWaterOzState(next);
    setLog(hist);
    if (next >= goalOz) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [goalOz]);

  const handleCustomAdd = useCallback(async () => {
    const oz = parseFloat(customOz);
    if (!oz || oz <= 0 || oz > 200) {
      Alert.alert('Invalid amount', 'Enter an amount between 1 and 200 oz.');
      return;
    }
    setShowCustom(false);
    setCustomOz('');
    await handleAdd(oz);
  }, [customOz, handleAdd]);

  const handleReset = useCallback(() => {
    Alert.alert('Reset today\'s water?', 'This will clear today\'s log.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await setWaterOz(0);
          await AsyncStorage.removeItem(logHistoryKey());
          setWaterOzState(0);
          setLog([]);
        },
      },
    ]);
  }, []);

  const pct = goalOz > 0 ? waterOz / goalOz : 0;
  const glassesLogged = Math.round(waterOz / 8);
  const glassesGoal = Math.round(goalOz / 8);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Water Log</Text>
        <Pressable onPress={handleReset} hitSlop={12}>
          <Text style={styles.resetBtn}>Reset</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Glass visual */}
        <View style={styles.glassSection}>
          <WaterGlass pct={pct} />
          <View style={styles.glassStats}>
            <Text style={styles.glassOz}>{waterOz} oz</Text>
            <Text style={styles.glassGoal}>of {goalOz} oz goal</Text>
            <View style={styles.glassesPill}>
              <Text style={styles.glassesPillText}>💧 {glassesLogged} / {glassesGoal} glasses</Text>
            </View>
          </View>
        </View>

        {pct >= 1 && (
          <View style={styles.goalBanner}>
            <Text style={styles.goalBannerText}>🎉 Daily water goal reached! Great work.</Text>
          </View>
        )}

        {/* Quick add */}
        <Text style={styles.sectionLabel}>QUICK ADD</Text>
        <View style={styles.quickGrid}>
          {QUICK_ADD.map((q) => (
            <Pressable key={q.oz} style={styles.quickBtn} onPress={() => handleAdd(q.oz)}>
              <Text style={styles.quickBtnOz}>{q.label}</Text>
              <Text style={styles.quickBtnSub}>{q.sub}</Text>
            </Pressable>
          ))}
        </View>

        {/* Custom amount */}
        {showCustom ? (
          <View style={styles.customRow}>
            <TextInput
              style={styles.customInput}
              placeholder="Custom oz"
              placeholderTextColor={WW.muted}
              value={customOz}
              onChangeText={setCustomOz}
              keyboardType="decimal-pad"
              returnKeyType="done"
              autoFocus
              onSubmitEditing={handleCustomAdd}
            />
            <Pressable style={styles.customAddBtn} onPress={handleCustomAdd}>
              <Text style={styles.customAddText}>Add</Text>
            </Pressable>
            <Pressable style={styles.customCancelBtn} onPress={() => { setShowCustom(false); setCustomOz(''); }}>
              <Text style={styles.customCancelText}>✕</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.customToggle} onPress={() => setShowCustom(true)}>
            <Text style={styles.customToggleText}>+ Custom amount</Text>
          </Pressable>
        )}

        {/* Today's log */}
        {log.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 8 }]}>TODAY'S LOG</Text>
            <View style={styles.logCard}>
              {[...log].reverse().map((entry, i) => (
                <View key={i} style={[styles.logRow, i < log.length - 1 && styles.logRowBorder]}>
                  <Text style={styles.logTime}>{entry.time}</Text>
                  <Text style={styles.logOz}>{entry.oz} oz</Text>
                  <Text style={styles.logGlass}>{(entry.oz / 8).toFixed(1)} glasses</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
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
  back: { fontSize: 22, color: WW.muted },
  title: { fontSize: 18, color: WW.text, fontWeight: '800' },
  resetBtn: { fontSize: 13, color: WW.muted, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 24, gap: 14 },

  glassSection: { alignItems: 'center', gap: 16, marginBottom: 8 },
  glassStats: { alignItems: 'center', gap: 4 },
  glassOz: { fontSize: 32, color: WW.teal, fontWeight: '900', letterSpacing: -0.5 },
  glassGoal: { fontSize: 13, color: WW.muted },
  glassesPill: {
    backgroundColor: WW.tealSoft, borderWidth: 1, borderColor: WW.tealBorder,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginTop: 4,
  },
  glassesPillText: { fontSize: 13, color: WW.teal, fontWeight: '700' },

  goalBanner: {
    backgroundColor: 'rgba(6,182,212,0.12)', borderWidth: 1, borderColor: WW.tealBorder,
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  goalBannerText: { fontSize: 14, color: WW.teal, fontWeight: '700' },

  sectionLabel: { fontSize: 9, color: WW.muted, fontWeight: '700', letterSpacing: 1.2 },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickBtn: {
    width: '47%',
    backgroundColor: WW.card, borderWidth: 1.5, borderColor: WW.tealBorder,
    borderRadius: 14, padding: 16, alignItems: 'center', gap: 4,
  },
  quickBtnOz: { fontSize: 18, color: WW.teal, fontWeight: '800' },
  quickBtnSub: { fontSize: 11, color: WW.muted, fontWeight: '500' },

  customRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  customInput: {
    flex: 1, backgroundColor: WW.card, borderWidth: 1.5, borderColor: WW.border,
    borderRadius: 12, padding: 14, color: WW.text, fontSize: 15,
  },
  customAddBtn: { backgroundColor: WW.teal, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14 },
  customAddText: { color: '#000', fontWeight: '800', fontSize: 14 },
  customCancelBtn: { paddingHorizontal: 10, paddingVertical: 14 },
  customCancelText: { color: WW.muted, fontSize: 16 },
  customToggle: {
    borderWidth: 1, borderColor: WW.border, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  customToggleText: { fontSize: 14, color: WW.muted, fontWeight: '600' },

  logCard: {
    backgroundColor: WW.card, borderWidth: 1, borderColor: WW.border, borderRadius: 14, overflow: 'hidden',
  },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  logRowBorder: { borderBottomWidth: 1, borderBottomColor: WW.border },
  logTime: { fontSize: 12, color: WW.muted, fontWeight: '600', width: 60 },
  logOz: { fontSize: 15, color: WW.teal, fontWeight: '800', flex: 1 },
  logGlass: { fontSize: 12, color: WW.muted },
});
