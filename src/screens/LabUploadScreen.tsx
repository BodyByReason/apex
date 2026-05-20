/**
 * LabUploadScreen — Pro only
 *
 * Allows users to photograph or pick images of blood panels, genetic reports,
 * vitamin/mineral tests, and hormone panels. The image is sent as base64 to
 * the Supabase/Claude function which returns a structured analysis:
 *   • Biomarkers detected and their status (optimal / borderline / deficient)
 *   • Nutritional deficiencies + specific food recommendations
 *   • Supplement suggestions
 *   • Meal plan adjustments
 *   • Workout intensity / type adjustments
 *
 * Results are stored in AsyncStorage so they persist across sessions and are
 * surfaced to the AI Coach system prompt automatically.
 */

import React, { useCallback, useEffect, useState } from 'react';

import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { usePro } from '@/hooks/usePro';
import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { getSelectedCoachVoice } from '@/lib/coachVoice';

// ─── Storage ──────────────────────────────────────────────────────────────────

const LAB_RESULTS_KEY = 'apex.lab.analysisResults.v1';

export type LabBiomarker = {
  name: string;
  value: string;
  unit: string;
  status: 'optimal' | 'borderline' | 'deficient' | 'elevated' | 'unknown';
  note: string;
};

export type LabAnalysis = {
  id: string;
  analysedAt: number;
  summary: string;
  biomarkers: LabBiomarker[];
  deficiencies: string[];
  supplements: string[];
  mealAdjustments: string[];
  workoutAdjustments: string[];
  rawText: string;
};

export async function getSavedLabAnalyses(): Promise<LabAnalysis[]> {
  try {
    const raw = await AsyncStorage.getItem(LAB_RESULTS_KEY);
    return raw ? (JSON.parse(raw) as LabAnalysis[]) : [];
  } catch { return []; }
}

async function saveLabAnalysis(analysis: LabAnalysis): Promise<void> {
  const existing = await getSavedLabAnalyses();
  const next = [analysis, ...existing].slice(0, 5); // keep last 5
  await AsyncStorage.setItem(LAB_RESULTS_KEY, JSON.stringify(next));
}

// ─── System prompt ────────────────────────────────────────────────────────────

const LAB_SYSTEM_PROMPT = `You are an expert clinical nutritionist and exercise physiologist analysing a user's lab work inside the APEX Fitness app.

Your task is to analyse the provided lab report image and return a structured JSON object with these exact keys:
{
  "summary": "2-3 sentence plain-English overview of the most important findings",
  "biomarkers": [
    { "name": "Vitamin D", "value": "18", "unit": "ng/mL", "status": "deficient", "note": "Below optimal range of 40-80 ng/mL" }
  ],
  "deficiencies": ["Vitamin D", "Iron", "Magnesium"],
  "supplements": ["Vitamin D3 5000 IU daily", "Magnesium glycinate 400mg before bed"],
  "mealAdjustments": ["Increase fatty fish (salmon, sardines) 3x/week for omega-3", "Add leafy greens daily for iron"],
  "workoutAdjustments": ["Avoid high-intensity training until Vitamin D normalises — fatigue risk", "Focus on mobility and moderate strength during this period"]
}

Status values: "optimal" | "borderline" | "deficient" | "elevated" | "unknown"

Be specific. Name exact nutrients and dosages. Reference the user's values vs reference ranges.
If the image is not a lab report, return: { "error": "Image does not appear to be a lab report. Please upload a blood panel, vitamin test, or genetic report." }
Return ONLY valid JSON — no markdown fences, no prose.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<LabBiomarker['status'], string> = {
  optimal: '#00ff87',
  borderline: '#f59e0b',
  deficient: '#ef4444',
  elevated: '#f97316',
  unknown: '#6b7280',
};

const STATUS_LABEL: Record<LabBiomarker['status'], string> = {
  optimal: '✓ Optimal',
  borderline: '⚠ Borderline',
  deficient: '↓ Deficient',
  elevated: '↑ Elevated',
  unknown: '? Unknown',
};

type Tab = 'overview' | 'biomarkers' | 'nutrition' | 'plan';

// ─── Component ────────────────────────────────────────────────────────────────

export default function LabUploadScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isPro } = usePro();

  const [analyses, setAnalyses] = useState<LabAnalysis[]>([]);
  const [activeAnalysis, setActiveAnalysis] = useState<LabAnalysis | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [uploading, setUploading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [coachName, setCoachName] = useState('Your coach');
  const [coachAvatar, setCoachAvatar] = useState<any>(null);

  useFocusEffect(
    useCallback(() => {
      getSavedLabAnalyses().then((a) => {
        setAnalyses(a);
        if (a.length && !activeAnalysis) setActiveAnalysis(a[0]);
      }).catch(() => {});
      AsyncStorage.getItem(PROFILE_STORAGE_KEY)
        .then((r) => setProfile(r ? JSON.parse(r) as UserProfile : null))
        .catch(() => {});
      getSelectedCoachVoice()
        .then((v) => {
          if (v?.label) setCoachName(v.label);
          if (v?.avatar) setCoachAvatar(v.avatar);
        })
        .catch(() => {});
    }, []),
  );

  const pickAndAnalyse = async (fromCamera: boolean) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, base64: true, allowsMultipleSelection: true });

    if (result.canceled || !result.assets?.[0]) return;

    const assets = result.assets;

    setUploading(true);

    try {
      const healthCtx = profile?.healthConditions?.length
        ? `\n\nUser health conditions: ${profile.healthConditions.join(', ')}.`
        : '';
      const medCtx = profile?.medications ? `\nMedications: ${profile.medications}.` : '';

      const imageContent = await Promise.all(
        assets.map(async (asset) => {
          let base64 = asset.base64;
          if (!base64 && asset.uri) {
            base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' as any });
          }
          return base64
            ? { type: 'image' as const, source: { type: 'base64' as const, media_type: (asset.mimeType ?? 'image/jpeg') as string, data: base64 } }
            : null;
        })
      );

      const validImages = imageContent.filter(Boolean);
      if (!validImages.length) {
        Alert.alert('Error', 'Could not read image. Please try again.');
        return;
      }

      const { data, error } = await supabase.functions.invoke('anthropic', {
        body: {
          max_tokens: 4096,
          system: LAB_SYSTEM_PROMPT + healthCtx + medCtx,
          messages: [
            {
              role: 'user',
              content: [
                ...validImages,
                { type: 'text', text: 'Please analyse this lab report and return the structured JSON.' },
              ],
            },
          ],
        },
      });

      if (error) throw error;

      const rawText: string =
        data?.content?.map((b: { text?: string }) => b.text ?? '').join('') ?? '';

      let parsed: Partial<LabAnalysis> & { error?: string } = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // Claude sometimes wraps in markdown — strip fences and retry
        const stripped = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        try { parsed = JSON.parse(stripped); } catch {
          if (__DEV__) Alert.alert('Parse Error (dev)', rawText.slice(0, 300));
          parsed = {};
        }
      }

      if (parsed.error) {
        Alert.alert('Not a Lab Report', parsed.error);
        return;
      }

      const analysis: LabAnalysis = {
        id: `lab-${Date.now()}`,
        analysedAt: Date.now(),
        summary: parsed.summary ?? 'Analysis complete — see tabs for details.',
        biomarkers: parsed.biomarkers ?? [],
        deficiencies: parsed.deficiencies ?? [],
        supplements: parsed.supplements ?? [],
        mealAdjustments: parsed.mealAdjustments ?? [],
        workoutAdjustments: parsed.workoutAdjustments ?? [],
        rawText,
      };

      await saveLabAnalysis(analysis);
      const fresh = await getSavedLabAnalyses();
      setAnalyses(fresh);
      setActiveAnalysis(analysis);
      setTab('overview');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      const isExpoGo = (await import('expo-constants')).default.executionEnvironment === 'storeClient';
      if (isExpoGo) {
        // Demo mode
        const demo: LabAnalysis = {
          id: `lab-demo-${Date.now()}`,
          analysedAt: Date.now(),
          summary: 'Demo: Vitamin D severely deficient at 14 ng/mL. Iron low-normal. B12 optimal. Testosterone slightly below optimal for age.',
          biomarkers: [
            { name: 'Vitamin D', value: '14', unit: 'ng/mL', status: 'deficient', note: 'Optimal range 40-80 ng/mL — supplements strongly advised' },
            { name: 'Iron (Serum)', value: '68', unit: 'μg/dL', status: 'borderline', note: 'Low-normal — monitor and increase dietary iron' },
            { name: 'B12', value: '520', unit: 'pg/mL', status: 'optimal', note: 'Within healthy range' },
            { name: 'Testosterone', value: '380', unit: 'ng/dL', status: 'borderline', note: 'Below optimal for age — lifestyle factors may help' },
            { name: 'Cortisol (AM)', value: '22', unit: 'μg/dL', status: 'elevated', note: 'Slightly elevated — may indicate chronic stress' },
          ],
          deficiencies: ['Vitamin D', 'Iron (borderline)'],
          supplements: ['Vitamin D3 5000 IU daily with K2', 'Magnesium glycinate 400mg before bed', 'Iron bisglycinate 25mg with Vitamin C — if confirmed by GP'],
          mealAdjustments: ['Add fatty fish (salmon, mackerel) 3× per week for Vitamin D', 'Red meat or lentils 4× per week to support iron', 'Avoid calcium within 2 hrs of iron-rich meals', 'Ashwagandha or phosphatidylserine to support cortisol regulation'],
          workoutAdjustments: ['Reduce HIIT frequency to 2×/week until Vitamin D normalises — fatigue and injury risk elevated', 'Prioritise sleep and recovery; high cortisol impairs muscle repair', 'Resistance training is fine — supports testosterone naturally'],
          rawText: '{}',
        };
        await saveLabAnalysis(demo);
        const fresh = await getSavedLabAnalyses();
        setAnalyses(fresh);
        setActiveAnalysis(demo);
        setTab('overview');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Analysis Failed', 'Could not connect to AI analysis. Please try again.');
      }
    } finally {
      setUploading(false);
    }
  };

  // ── Paywall guard ────────────────────────────────────────────────────────

  if (!isPro) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.headerTitle}>LAB ANALYSIS</Text>
          <View style={{ width: 64 }} />
        </View>
        <View style={styles.paywallWrap}>
          <Text style={styles.paywallEmoji}>🧬</Text>
          <Text style={styles.paywallTitle}>Lab Work Analysis</Text>
          <Text style={styles.paywallBody}>
            Upload your blood panels, genetic reports, or vitamin tests. The AI Coach analyses your biomarkers and creates a personalised meal plan and workout strategy based on your exact deficiencies.
          </Text>
          <View style={styles.paywallFeatures}>
            {[
              '🩸  Biomarker status — deficient, borderline, optimal',
              '💊  Specific supplement stack with dosages',
              '🥗  Meal plan adjustments for your deficiencies',
              '🏋️  Workout intensity tuned to your lab results',
              '🧬  Genetics & hormone panel support',
            ].map((f) => (
              <Text key={f} style={styles.paywallFeatureRow}>{f}</Text>
            ))}
          </View>
          <Pressable
            style={styles.upgradeBtn}
            onPress={() => navigation.navigate('Upgrade')}
          >
            <Text style={styles.upgradeBtnText}>Unlock with APEX Pro ⚡</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Pro UI ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>LAB ANALYSIS</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Upload card */}
        <View style={styles.uploadCard}>
          <Text style={styles.uploadTitle}>🧬  Upload Lab Work</Text>
          <Text style={styles.uploadBody}>
            Photograph or select an image of your blood panel, genetics report, vitamin test, or hormone panel. {coachName} will extract every biomarker and build a personalised plan.
          </Text>
          <View style={styles.uploadBtnRow}>
            <Pressable
              style={({ pressed }) => [styles.uploadBtn, pressed && { opacity: 0.75 }]}
              onPress={() => pickAndAnalyse(true)}
              disabled={uploading}
            >
              <Text style={styles.uploadBtnEmoji}>📷</Text>
              <Text style={styles.uploadBtnLabel}>Take Photo</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.uploadBtn, pressed && { opacity: 0.75 }]}
              onPress={() => pickAndAnalyse(false)}
              disabled={uploading}
            >
              <Text style={styles.uploadBtnEmoji}>🖼️</Text>
              <Text style={styles.uploadBtnLabel}>Pick from Library</Text>
            </Pressable>
          </View>
          {uploading && (
            <View style={styles.analysingRow}>
              <ActivityIndicator color={C.green} size="small" />
              <Text style={styles.analysingText}>Analysing biomarkers…</Text>
            </View>
          )}
        </View>

        {/* Past analyses selector */}
        {analyses.length > 1 && (
          <View style={styles.historyRow}>
            {analyses.map((a, i) => (
              <Pressable
                key={a.id}
                style={[styles.historyChip, activeAnalysis?.id === a.id ? styles.historyChipActive : null]}
                onPress={() => { setActiveAnalysis(a); setTab('overview'); }}
              >
                <Text style={[styles.historyChipText, activeAnalysis?.id === a.id ? styles.historyChipTextActive : null]}>
                  {i === 0 ? 'Latest' : new Date(a.analysedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Analysis results */}
        {activeAnalysis && (
          <View style={styles.resultsWrap}>
            {/* Tabs */}
            <View style={styles.tabRow}>
              {([
                { key: 'overview',   label: 'Overview' },
                { key: 'biomarkers', label: 'Biomarkers' },
                { key: 'nutrition',  label: 'Nutrition' },
                { key: 'plan',       label: 'My Plan' },
              ] as { key: Tab; label: string }[]).map((t) => (
                <Pressable
                  key={t.key}
                  style={[styles.tabBtn, tab === t.key ? styles.tabBtnActive : null]}
                  onPress={() => setTab(t.key)}
                >
                  <Text style={[styles.tabBtnText, tab === t.key ? styles.tabBtnTextActive : null]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* ── Overview tab ── */}
            {tab === 'overview' && (
              <View style={styles.tabContent}>
                <Text style={styles.analysedDate}>
                  Analysed {new Date(activeAnalysis.analysedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
                <View style={styles.summaryCard}>
                  <View style={styles.summaryTitleRow}>
                    {coachAvatar
                      ? <Image source={coachAvatar} style={styles.summaryAvatar} />
                      : <Text style={styles.summaryAvatarEmoji}>👤</Text>}
                    <Text style={styles.summaryTitle}>Coach Summary</Text>
                  </View>
                  <Text style={styles.summaryBody}>{activeAnalysis.summary}</Text>
                </View>

                {/* Quick deficiency pills */}
                {activeAnalysis.deficiencies.length > 0 && (
                  <View style={styles.pillWrap}>
                    <Text style={styles.sectionLabel}>DEFICIENCIES DETECTED</Text>
                    <View style={styles.pillRow}>
                      {activeAnalysis.deficiencies.map((d) => (
                        <View key={d} style={styles.defPill}>
                          <Text style={styles.defPillText}>↓ {d}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Status summary bar */}
                {activeAnalysis.biomarkers.length > 0 && (
                  <View style={styles.statusBar}>
                    {(['optimal', 'borderline', 'deficient', 'elevated'] as LabBiomarker['status'][]).map((s) => {
                      const count = activeAnalysis.biomarkers.filter((b) => b.status === s).length;
                      if (!count) return null;
                      return (
                        <View key={s} style={styles.statusBarItem}>
                          <Text style={[styles.statusBarCount, { color: STATUS_COLOR[s] }]}>{count}</Text>
                          <Text style={styles.statusBarLabel}>{s}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* ── Biomarkers tab ── */}
            {tab === 'biomarkers' && (
              <View style={styles.tabContent}>
                {activeAnalysis.biomarkers.length === 0 ? (
                  <Text style={styles.emptyText}>No individual biomarkers extracted. Try uploading a clearer image.</Text>
                ) : (
                  activeAnalysis.biomarkers.map((b) => (
                    <View key={b.name} style={styles.biomarkerRow}>
                      <View style={styles.biomarkerLeft}>
                        <Text style={styles.biomarkerName}>{b.name}</Text>
                        <Text style={styles.biomarkerNote}>{b.note}</Text>
                      </View>
                      <View style={styles.biomarkerRight}>
                        <Text style={styles.biomarkerVal}>{b.value} <Text style={styles.biomarkerUnit}>{b.unit}</Text></Text>
                        <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLOR[b.status]}22`, borderColor: `${STATUS_COLOR[b.status]}55` }]}>
                          <Text style={[styles.statusBadgeText, { color: STATUS_COLOR[b.status] }]}>
                            {STATUS_LABEL[b.status]}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* ── Nutrition tab ── */}
            {tab === 'nutrition' && (
              <View style={styles.tabContent}>
                {activeAnalysis.supplements.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>💊  SUPPLEMENT STACK</Text>
                    {activeAnalysis.supplements.map((s, i) => (
                      <View key={i} style={styles.listRow}>
                        <Text style={styles.listBullet}>•</Text>
                        <Text style={styles.listText}>{s}</Text>
                      </View>
                    ))}
                  </>
                )}
                {activeAnalysis.mealAdjustments.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 20 }]}>🥗  MEAL ADJUSTMENTS</Text>
                    {activeAnalysis.mealAdjustments.map((m, i) => (
                      <View key={i} style={styles.listRow}>
                        <Text style={styles.listBullet}>•</Text>
                        <Text style={styles.listText}>{m}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            )}

            {/* ── Plan tab ── */}
            {tab === 'plan' && (
              <View style={styles.tabContent}>
                {activeAnalysis.workoutAdjustments.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>🏋️  WORKOUT ADJUSTMENTS</Text>
                    {activeAnalysis.workoutAdjustments.map((w, i) => (
                      <View key={i} style={styles.listRow}>
                        <Text style={styles.listBullet}>•</Text>
                        <Text style={styles.listText}>{w}</Text>
                      </View>
                    ))}
                  </>
                )}
                <View style={styles.planNote}>
                  <View style={styles.summaryTitleRow}>
                    {coachAvatar
                      ? <Image source={coachAvatar} style={styles.summaryAvatar} />
                      : <Text style={styles.summaryAvatarEmoji}>👤</Text>}
                    <Text style={[styles.planNoteText, { flex: 1 }]}>
                      These adjustments are automatically included in your {coachName}'s conversations and meal plan suggestions.
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Empty state */}
        {!activeAnalysis && !uploading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🩺</Text>
            <Text style={styles.emptyTitle}>No Lab Results Yet</Text>
            <Text style={styles.emptyBody}>
              Upload your first lab report above. Supported formats include blood panels, vitamin/mineral tests, hormone panels, and genetic health reports.
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { width: 64 },
  backText: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  headerTitle: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 20, letterSpacing: 3 },
  scroll: { padding: 16 },

  // Paywall
  paywallWrap: { flex: 1, padding: 24, alignItems: 'center', paddingTop: 40 },
  paywallEmoji: { fontSize: 56, marginBottom: 16 },
  paywallTitle: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 32, letterSpacing: 2, marginBottom: 12 },
  paywallBody: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  paywallFeatures: { alignSelf: 'stretch', gap: 10, marginBottom: 32 },
  paywallFeatureRow: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20 },
  upgradeBtn: {
    backgroundColor: C.green, borderRadius: 14, paddingVertical: 16,
    paddingHorizontal: 32, alignItems: 'center',
  },
  upgradeBtnText: { color: '#000', fontFamily: 'DMSans_700Bold', fontSize: 16 },

  // Upload card
  uploadCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  uploadTitle: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 22, letterSpacing: 1.5, marginBottom: 8 },
  uploadBody: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  uploadBtnRow: { flexDirection: 'row', gap: 10 },
  uploadBtn: {
    flex: 1,
    backgroundColor: 'rgba(0,255,135,0.08)',
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  uploadBtnEmoji: { fontSize: 26 },
  uploadBtnLabel: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 13 },
  analysingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  analysingText: { color: C.green, fontFamily: 'DMSans_400Regular', fontSize: 14 },

  // History
  historyRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  historyChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  historyChipActive: { borderColor: C.green, backgroundColor: C.greenSoft },
  historyChipText: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 12 },
  historyChipTextActive: { color: C.green },

  // Results
  resultsWrap: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: C.green },
  tabBtnText: { color: C.muted, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  tabBtnTextActive: { color: C.green },
  tabContent: { padding: 16, gap: 10 },

  analysedDate: { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 10, letterSpacing: 0.5, marginBottom: 4 },
  summaryCard: {
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.2)',
    padding: 14,
    gap: 6,
  },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  summaryAvatar: { width: 28, height: 28, borderRadius: 14 },
  summaryAvatarEmoji: { fontSize: 20 },
  summaryTitle: { color: C.green, fontFamily: 'DMSans_500Medium', fontSize: 13 },
  summaryBody: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21 },

  pillWrap: { gap: 8, marginTop: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  defPill: {
    paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20,
    backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
  },
  defPillText: { color: '#ef4444', fontFamily: 'DMSans_500Medium', fontSize: 12 },

  statusBar: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: C.black,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  statusBarItem: { alignItems: 'center', gap: 3 },
  statusBarCount: { fontFamily: 'BebasNeue_400Regular', fontSize: 22 },
  statusBarLabel: { color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 9, letterSpacing: 0.5 },

  // Biomarkers
  biomarkerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  biomarkerLeft: { flex: 1, gap: 3 },
  biomarkerName: { color: C.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  biomarkerNote: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 16 },
  biomarkerRight: { alignItems: 'flex-end', gap: 5 },
  biomarkerVal: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 18 },
  biomarkerUnit: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 11 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
  },
  statusBadgeText: { fontFamily: 'SpaceMono_400Regular', fontSize: 9.5, letterSpacing: 0.3 },

  // Nutrition / Plan
  sectionLabel: {
    color: C.muted, fontFamily: 'SpaceMono_400Regular',
    fontSize: 10, letterSpacing: 1.5, marginBottom: 8,
  },
  listRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  listBullet: { color: C.green, fontSize: 16, lineHeight: 22 },
  listText: { flex: 1, color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21 },

  planNote: {
    backgroundColor: 'rgba(0,255,135,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.2)',
    padding: 14,
    marginTop: 12,
  },
  planNoteText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19 },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 40, gap: 12 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { color: C.text, fontFamily: 'BebasNeue_400Regular', fontSize: 26, letterSpacing: 1.5 },
  emptyBody: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  emptyText: { color: C.text, fontFamily: 'DMSans_400Regular', fontSize: 14, textAlign: 'center', paddingVertical: 20 },
});
