/**
 * FoodScanModal
 * Modes:
 *   📷 Photo   — user takes a picture of food → Anthropic vision estimates macros
 *   🖼️ Upload  — pick from library → AI estimates macros
 *   📊 Barcode — user scans a product barcode → Open Food Facts returns macros
 *   ✏️ Manual  — user types a food name → AI estimates macros
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { maybeShowPaywall } from '@/lib/revenuecat';
import type { MainStackParamList } from '@/navigation/MainNavigator';
import { supabase } from '@/lib/supabase';
import { usePro } from '@/hooks/usePro';
import { apexColors as C } from '@/theme/colors';

export type ScannedFood = {
  calories: number;
  carbs: number;
  fat: number;
  name: string;
  protein: number;
  recommendation?: string;
  source?: 'barcode' | 'camera' | 'upload' | 'manual';
};

type Mode = 'choose' | 'photo' | 'upload' | 'barcode' | 'manual' | 'result';
type ScanContext = {
  caloriesRemaining: number;
  carbsRemaining: number;
  fatRemaining: number;
  goal?: string;
  proteinRemaining: number;
};

// ─── Open Food Facts ─────────────────────────────────────────────────────────
async function lookupBarcode(barcode: string): Promise<ScannedFood> {
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
    {
      headers: {
        Accept: 'application/json',
      },
    },
  );

  const rawBody = await res.text();
  let json: {
    status: number;
    product?: {
      product_name?: string;
      nutriments?: {
        'energy-kcal_100g'?: number;
        proteins_100g?: number;
        carbohydrates_100g?: number;
        fat_100g?: number;
      };
      serving_size?: string;
    };
  };

  try {
    json = JSON.parse(rawBody) as typeof json;
  } catch {
    throw new Error('Could not read that barcode result. Please scan again or enter it manually.');
  }

  if (json.status !== 1 || !json.product) {
    throw new Error('Product not found. Try scanning again or enter manually.');
  }

  const p = json.product;
  const n = p.nutriments ?? {};
  const name = p.product_name ?? 'Unknown product';

  // Nutriments are per 100g — assume 1 serving ≈ 100g if no serving size
  const factor = 1;

  return {
    calories: Math.round((n['energy-kcal_100g'] ?? 0) * factor),
    carbs: Math.round((n['carbohydrates_100g'] ?? 0) * factor),
    fat: Math.round((n['fat_100g'] ?? 0) * factor),
    name,
    protein: Math.round((n['proteins_100g'] ?? 0) * factor),
    source: 'barcode',
  };
}

// ─── Anthropic vision ────────────────────────────────────────────────────────
async function analysePhoto(base64: string, context?: ScanContext): Promise<ScannedFood> {
  const contextText = context
    ? `User goal: ${context.goal ?? 'general fitness'}.
Calories remaining today: ${Math.max(0, context.caloriesRemaining)} kcal.
Protein remaining: ${Math.max(0, context.proteinRemaining)} g.
Carbs remaining: ${Math.max(0, context.carbsRemaining)} g.
Fat remaining: ${Math.max(0, context.fatRemaining)} g.`
    : 'No daily nutrition context provided.';

  const { data, error } = await supabase.functions.invoke('anthropic', {
    body: {
      max_tokens: 300,
      model: 'claude-sonnet-4-6',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { data: base64, media_type: 'image/jpeg', type: 'base64' },
            },
            {
              type: 'text',
              text: `Look at this food image and estimate the nutritional content for the main food shown.
${contextText}
Reply with ONLY valid JSON, no extra text:
{"name":"<food name>","calories":<number>,"protein":<number>,"carbs":<number>,"fat":<number>,"recommendation":"<1-2 sentence recommendation for the user's next meal or rest of day>"}
All numbers are integers. Calories are kcal. Macros are grams for a typical serving shown. Recommendation must be short, practical, and tied to the user's goal and remaining macros.`,
            },
          ],
        },
      ],
    },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const errorBody = await error.context.json();
        if (errorBody?.error) {
          throw new Error(String(errorBody.error));
        }
        throw new Error(JSON.stringify(errorBody));
      } catch (parseError) {
        if (parseError instanceof Error) {
          throw parseError;
        }
      }
    }

    throw new Error(error.message || 'Vision analysis failed. Try again.');
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  const raw: string =
    (data?.content as Array<{ text?: string }>)
      ?.map((b) => b.text ?? '')
      .join('') ?? '';

  // Extract JSON even if surrounded by markdown fences
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error('Could not parse food data. Try again.');

  const parsed = JSON.parse(jsonMatch[0]) as ScannedFood;
  return {
    calories: Math.round(Number(parsed.calories) || 0),
    carbs: Math.round(Number(parsed.carbs) || 0),
    fat: Math.round(Number(parsed.fat) || 0),
    name: String(parsed.name || 'Scanned food'),
    protein: Math.round(Number(parsed.protein) || 0),
    recommendation: parsed.recommendation ? String(parsed.recommendation) : undefined,
  };
}

// ─── AI text search ──────────────────────────────────────────────────────────
async function searchFoodByText(query: string, context?: ScanContext): Promise<ScannedFood> {
  const contextText = context
    ? `User goal: ${context.goal ?? 'general fitness'}.
Calories remaining today: ${Math.max(0, context.caloriesRemaining)} kcal.
Protein remaining: ${Math.max(0, context.proteinRemaining)} g.`
    : '';

  const { data, error } = await supabase.functions.invoke('anthropic', {
    body: {
      max_tokens: 300,
      model: 'claude-haiku-4-5-20251001',
      messages: [
        {
          role: 'user',
          content: `Estimate nutritional info for: "${query}".
${contextText}
Reply with ONLY valid JSON, no extra text:
{"name":"<food name>","calories":<number>,"protein":<number>,"carbs":<number>,"fat":<number>,"recommendation":"<1-2 sentence tip based on the user's remaining macros>"}
All numbers are integers. Calories are kcal. Macros are grams for a typical serving.`,
        },
      ],
    },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const errorBody = await error.context.json();
        if (errorBody?.error) throw new Error(String(errorBody.error));
        throw new Error(JSON.stringify(errorBody));
      } catch (parseError) {
        if (parseError instanceof Error) throw parseError;
      }
    }
    throw new Error(error.message || 'AI lookup failed. Try again.');
  }

  if (data?.error) throw new Error(String(data.error));

  const raw: string =
    (data?.content as Array<{ text?: string }>)?.map((b) => b.text ?? '').join('') ?? '';

  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error('Could not parse food data. Try again.');

  const parsed = JSON.parse(jsonMatch[0]) as ScannedFood;
  return {
    calories: Math.round(Number(parsed.calories) || 0),
    carbs: Math.round(Number(parsed.carbs) || 0),
    fat: Math.round(Number(parsed.fat) || 0),
    name: String(parsed.name || query),
    protein: Math.round(Number(parsed.protein) || 0),
    recommendation: parsed.recommendation ? String(parsed.recommendation) : undefined,
    source: 'manual',
  };
}

// ─── WW theme ────────────────────────────────────────────────────────────────
const WW = {
  bg:          '#0D1B2A',
  card:        '#0A1929',
  border:      '#1A2E45',
  accent:      '#0EA5E9',
  accentSoft:  'rgba(14,165,233,0.10)',
  accentBorder:'rgba(14,165,233,0.28)',
  text:        '#F0F8FF',
  muted:       'rgba(240,248,255,0.45)',
};

// ─── Component ───────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
  onResult: (food: ScannedFood) => void;
  scanContext?: ScanContext;
  variant?: 'apex' | 'ww';
  visible: boolean;
}

export default function FoodScanModal({ onClose, onResult, scanContext, variant = 'apex', visible }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { isPro } = usePro();
  const isWW = variant === 'ww';
  const accent      = isWW ? WW.accent : C.green;
  const sheetBg     = isWW ? WW.bg     : '#111';
  const cardBg      = isWW ? WW.card   : C.card;
  const borderColor = isWW ? WW.border : C.border;
  const textColor   = isWW ? WW.text   : C.text;
  const mutedColor  = isWW ? WW.muted  : C.muted;
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('choose');
  const [analysing, setAnalysing] = useState(false);
  const [barcodeLocked, setBarcodeLocked] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const closingRef = useRef(false);
  const barcodeScanInFlightRef = useRef(false);
  // Manual entry state
  const [manualQuery, setManualQuery] = useState('');
  const [manualResult, setManualResult] = useState<ScannedFood | null>(null);
  // Confirmation step (barcode + photo)
  const [pendingResult, setPendingResult] = useState<ScannedFood | null>(null);
  const [servingCount, setServingCount] = useState('1');

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      barcodeScanInFlightRef.current = false;
    }
  }, [visible]);

  const reset = useCallback(() => {
    setMode('choose');
    setAnalysing(false);
    setBarcodeLocked(false);
    setManualQuery('');
    setManualResult(null);
    setPendingResult(null);
    setServingCount('1');
    barcodeScanInFlightRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    closingRef.current = true;
    reset();
    onClose();
  }, [onClose, reset]);

  const handleModeSelect = async (selected: Mode) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Photo and upload modes use AI analysis — Pro feature (skipped in WW variant)
    if (!isWW && (selected === 'photo' || selected === 'upload') && !isPro) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await maybeShowPaywall().catch(() => null);
      handleClose();
      navigation.navigate('Upgrade');
      return;
    }

    if (selected === 'upload') {
      const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!mediaPermission.granted) {
        Alert.alert('Photos needed', 'Please allow photo library access in Settings to upload food pictures.');
        return;
      }
      setMode(selected);
      return;
    }

    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera needed', 'Please allow camera access in Settings to use food scanning.');
        return;
      }
    }
    setMode(selected);
  };

  const handlePickPhoto = async () => {
    if (analysing) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAnalysing(true);

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        base64: true,
        mediaTypes: ['images'],
        quality: 0.5,
      });

      if (result.canceled) {
        setAnalysing(false);
        return;
      }

      const asset = result.assets?.[0];
      // Android gallery photos (e.g. Google Photos) sometimes return null for
      // base64 — fall back to reading the file directly from disk.
      let base64 = asset?.base64;
      if (!base64 && asset?.uri) {
        base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      }
      if (!base64) {
        throw new Error('Could not read that photo. Try another image.');
      }

      const analysed = await analysePhoto(base64, scanContext);
      analysed.source = 'upload';
      setPendingResult(analysed);
      setServingCount('1');
      setAnalysing(false);
      setMode('result');
    } catch (err) {
      Alert.alert('Scan failed', err instanceof Error ? err.message : 'Try again.');
      setAnalysing(false);
    }
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current || analysing) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAnalysing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.5, // lower quality = smaller payload
        exif: false,
      });
      if (!photo?.base64) throw new Error('Could not capture photo.');
      const result = await analysePhoto(photo.base64, scanContext);
      result.source = 'camera';
      setPendingResult(result);
      setServingCount('1');
      setAnalysing(false);
      setMode('result');
    } catch (err) {
      Alert.alert('Scan failed', err instanceof Error ? err.message : 'Try again.');
      setAnalysing(false);
    }
  };

  const handleBarcodeScan = useCallback(
    async ({ data: barcode }: { data: string }) => {
      if (barcodeLocked || analysing || closingRef.current || barcodeScanInFlightRef.current) {
        return;
      }
      barcodeScanInFlightRef.current = true;
      setBarcodeLocked(true);
      setAnalysing(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      try {
        const result = await lookupBarcode(barcode);
        setPendingResult(result);
        setServingCount('1');
        setAnalysing(false);
        setMode('result');
      } catch (err) {
        Alert.alert('Barcode not found', err instanceof Error ? err.message : 'Try again.');
        setAnalysing(false);
        setBarcodeLocked(false);
        barcodeScanInFlightRef.current = false;
      }
    },
    [analysing, barcodeLocked, handleClose, onResult],
  );

  const handleManualSearch = async () => {
    const q = manualQuery.trim();
    if (!q || analysing) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAnalysing(true);
    setManualResult(null);
    try {
      const result = await searchFoodByText(q, scanContext);
      setManualResult(result);
    } catch (err) {
      Alert.alert('Search failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setAnalysing(false);
    }
  };

  const handleManualLog = async () => {
    if (!manualResult) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onResult(manualResult);
    handleClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: sheetBg, borderColor }]}>
          <View style={[styles.handle, { backgroundColor: borderColor }]} />

          {/* ── Choose mode ─────────────────────────────────── */}
          {mode === 'choose' ? (
            isWW ? (
              /* ── WW simplified layout ── */
              <>
                <Text style={[styles.title, { color: textColor }]}>WHAT DID YOU EAT?</Text>
                {/* Primary: Photo */}
                <Pressable
                  style={[styles.wwPrimaryBtn, { backgroundColor: accent }]}
                  onPress={() => handleModeSelect('photo')}
                >
                  <Text style={styles.wwPrimaryIcon}>📷</Text>
                  <View style={styles.wwPrimaryText}>
                    <Text style={styles.wwPrimaryTitle}>Point at it</Text>
                    <Text style={styles.wwPrimarySub}>AI reads the macros instantly</Text>
                  </View>
                </Pressable>
                {/* Secondary: Barcode */}
                <Pressable
                  style={[styles.wwSecondaryBtn, { borderColor: WW.accentBorder, backgroundColor: WW.accentSoft }]}
                  onPress={() => handleModeSelect('barcode')}
                >
                  <Text style={styles.wwSecondaryIcon}>📊</Text>
                  <View style={styles.wwPrimaryText}>
                    <Text style={[styles.wwSecondaryTitle, { color: textColor }]}>Scan the package</Text>
                    <Text style={[styles.wwPrimarySub, { color: mutedColor }]}>Exact nutrition from the barcode</Text>
                  </View>
                </Pressable>
                {/* Tertiary: Search by name */}
                <Pressable
                  style={[styles.wwTertiaryBtn, { borderColor: borderColor }]}
                  onPress={() => { setManualQuery(''); setManualResult(null); setMode('manual'); }}
                >
                  <Text style={[styles.wwTertiaryText, { color: mutedColor }]}>✏️  Search by name instead</Text>
                </Pressable>
                <Pressable style={[styles.cancelBtn, { borderColor }]} onPress={handleClose}>
                  <Text style={[styles.cancelText, { color: mutedColor }]}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              /* ── APEX original layout ── */
              <>
                <Text style={styles.title}>SCAN FOOD</Text>
                <Text style={styles.sub}>
                  Point your camera at a meal to auto-fill macros, or scan a product barcode.
                </Text>
                <Pressable
                  style={[styles.optionCard, !isPro ? styles.optionCardLocked : null]}
                  onPress={() => handleModeSelect('photo')}
                >
                  <Text style={styles.optionIcon}>📷</Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.optionTitleRow}>
                      <Text style={styles.optionTitle}>Take a Photo</Text>
                      {!isPro ? <Text style={styles.proTag}>🔒 PRO</Text> : null}
                    </View>
                    <Text style={styles.optionMeta}>AI identifies the food and estimates calories + macros</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={[styles.optionCard, !isPro ? styles.optionCardLocked : null]}
                  onPress={() => handleModeSelect('upload')}
                >
                  <Text style={styles.optionIcon}>🖼️</Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.optionTitleRow}>
                      <Text style={styles.optionTitle}>Upload a Photo</Text>
                      {!isPro ? <Text style={styles.proTag}>🔒 PRO</Text> : null}
                    </View>
                    <Text style={styles.optionMeta}>Choose a saved meal photo and let AI estimate macros</Text>
                  </View>
                </Pressable>
                <Pressable style={styles.optionCard} onPress={() => handleModeSelect('barcode')}>
                  <Text style={styles.optionIcon}>📊</Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.optionTitleRow}>
                      <Text style={styles.optionTitle}>Scan Barcode</Text>
                      <Text style={styles.freeTag}>FREE</Text>
                    </View>
                    <Text style={styles.optionMeta}>Instant lookup from Open Food Facts database</Text>
                  </View>
                </Pressable>
                <Pressable style={styles.optionCard} onPress={() => { setManualQuery(''); setManualResult(null); setMode('manual'); }}>
                  <Text style={styles.optionIcon}>✏️</Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.optionTitleRow}>
                      <Text style={styles.optionTitle}>Manual Entry</Text>
                      <Text style={styles.freeTag}>FREE</Text>
                    </View>
                    <Text style={styles.optionMeta}>Type a food name and AI estimates macros instantly</Text>
                  </View>
                </Pressable>
                <Pressable style={styles.cancelBtn} onPress={handleClose}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </>
            )
          ) : null}

          {/* ── Photo mode ──────────────────────────────────── */}
          {mode === 'photo' ? (
            <>
              <Text style={[styles.title, { color: textColor }]}>{isWW ? 'POINT AT YOUR MEAL' : 'POINT AT YOUR FOOD'}</Text>
              <View style={styles.cameraWrap}>
                <CameraView ref={cameraRef} style={styles.camera} facing="back" />
                {analysing ? (
                  <View style={styles.analysing}>
                    <ActivityIndicator size="large" color={accent} />
                    <Text style={[styles.analysingText, { color: accent }]}>Reading macros...</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.cameraActions}>
                <Pressable style={[styles.cancelBtn, { borderColor }]} onPress={() => setMode('choose')}>
                  <Text style={[styles.cancelText, { color: mutedColor }]}>← Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.captureBtn, { backgroundColor: accent }, analysing ? { opacity: 0.5 } : null]}
                  onPress={handleTakePhoto}
                  disabled={analysing}
                >
                  <Text style={styles.captureBtnText}>📸 {isWW ? 'Scan' : 'Analyse'}</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {/* ── Upload mode ─────────────────────────────────── */}
          {mode === 'upload' ? (
            <>
              <Text style={[styles.title, { color: textColor }]}>{isWW ? 'CHOOSE A PHOTO' : 'UPLOAD FOOD PHOTO'}</Text>
              <Text style={[styles.sub, { color: mutedColor }]}>
                {isWW ? 'Pick a saved meal photo — AI figures out the macros.' : 'Pick a saved meal photo and APEX will estimate calories, macros, and what to eat next.'}
              </Text>
              <Pressable
                style={[styles.captureBtn, { backgroundColor: accent }, analysing ? { opacity: 0.5 } : null]}
                onPress={handlePickPhoto}
                disabled={analysing}
              >
                {analysing ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.captureBtnText}>🖼️ Choose Photo</Text>
                )}
              </Pressable>
              <Pressable style={[styles.cancelBtn, { borderColor }]} onPress={() => setMode('choose')}>
                <Text style={[styles.cancelText, { color: mutedColor }]}>← Back</Text>
              </Pressable>
            </>
          ) : null}

          {/* ── Barcode mode ────────────────────────────────── */}
          {mode === 'barcode' ? (
            <>
              <Text style={[styles.title, { color: textColor }]}>{isWW ? 'SCAN THE PACKAGE' : 'SCAN BARCODE'}</Text>
              <View style={styles.cameraWrap}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  onBarcodeScanned={analysing ? undefined : handleBarcodeScan}
                  barcodeScannerSettings={{
                    barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
                  }}
                />
                <View style={styles.barcodeOverlay}>
                  <View style={[styles.barcodeTarget, { borderColor: accent }]} />
                </View>
                {analysing ? (
                  <View style={styles.analysing}>
                    <ActivityIndicator size="large" color={accent} />
                    <Text style={[styles.analysingText, { color: accent }]}>Looking up product...</Text>
                  </View>
                ) : null}
              </View>
              <Pressable style={[styles.cancelBtn, { marginTop: 12, borderColor }]} onPress={() => setMode('choose')}>
                <Text style={[styles.cancelText, { color: mutedColor }]}>← Back</Text>
              </Pressable>
            </>
          ) : null}

          {/* ── Result confirmation mode ────────────────────── */}
          {mode === 'result' && pendingResult ? (() => {
            const mult = Math.max(0.25, parseFloat(servingCount) || 1);
            const scaled: ScannedFood = {
              ...pendingResult,
              calories: Math.round(pendingResult.calories * mult),
              protein:  Math.round(pendingResult.protein  * mult),
              carbs:    Math.round(pendingResult.carbs    * mult),
              fat:      Math.round(pendingResult.fat      * mult),
            };
            return (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={[styles.title, { color: textColor }]}>CONFIRM & LOG</Text>
                <View style={[styles.manualResultCard, { backgroundColor: cardBg, borderColor }]}>
                  <Text style={[styles.manualResultName, { color: textColor }]}>{pendingResult.name}</Text>
                  <View style={styles.manualMacroRow}>
                    {([['calories','kcal'],['protein','protein'],['carbs','carbs'],['fat','fat']] as const).map(([key, label]) => (
                      <View key={key} style={styles.manualMacro}>
                        <Text style={[styles.manualMacroVal, { color: accent }]}>{key === 'calories' ? scaled.calories : `${scaled[key]}g`}</Text>
                        <Text style={[styles.manualMacroLabel, { color: mutedColor }]}>{label}</Text>
                      </View>
                    ))}
                  </View>
                  {pendingResult.recommendation ? (
                    <Text style={[styles.manualRecommendation, { color: mutedColor }]}>💡 {pendingResult.recommendation}</Text>
                  ) : null}

                  {/* Serving size row */}
                  <View style={[styles.servingRow, { borderTopColor: borderColor }]}>
                    <Text style={[styles.servingLabel, { color: mutedColor }]}>Servings</Text>
                    <TextInput
                      style={[styles.servingInput, { borderColor, color: textColor }]}
                      value={servingCount}
                      onChangeText={setServingCount}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                    <Text style={[styles.servingHint, { color: mutedColor }]}>× {pendingResult.calories} kcal base</Text>
                  </View>

                  <Pressable
                    style={[styles.manualLogBtn, { backgroundColor: accent }]}
                    onPress={async () => {
                      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      onResult(scaled);
                      handleClose();
                    }}
                  >
                    <Text style={[styles.manualLogBtnText, isWW ? { color: '#fff' } : null]}>✓ Log This Food</Text>
                  </Pressable>
                </View>
                <Pressable style={[styles.cancelBtn, { marginTop: 8, borderColor }]} onPress={() => { setPendingResult(null); setMode('choose'); }}>
                  <Text style={[styles.cancelText, { color: mutedColor }]}>← Try Again</Text>
                </Pressable>
              </ScrollView>
            );
          })() : null}

          {/* ── Manual entry mode ───────────────────────────── */}
          {mode === 'manual' ? (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={[styles.title, { color: textColor }]}>{isWW ? 'SEARCH BY NAME' : 'MANUALLY INPUT FOOD'}</Text>
              <Text style={[styles.sub, { color: mutedColor }]}>
                {isWW ? 'Type a food or meal — AI estimates the macros instantly.' : 'Type any food, meal, or ingredient — AI will estimate the calories and macros.'}
              </Text>

              {/* Search row */}
              <View style={styles.manualRow}>
                <TextInput
                  style={[styles.manualInput, { borderColor, color: textColor }]}
                  placeholder={isWW ? 'e.g. chicken rice bowl' : 'e.g. grilled chicken breast, 6oz'}
                  placeholderTextColor={mutedColor}
                  value={manualQuery}
                  onChangeText={setManualQuery}
                  returnKeyType="search"
                  onSubmitEditing={handleManualSearch}
                  autoFocus
                  editable={!analysing}
                />
                <TouchableOpacity
                  style={[styles.manualSearchBtn, { backgroundColor: accent }, (!manualQuery.trim() || analysing) && { opacity: 0.4 }]}
                  onPress={handleManualSearch}
                  disabled={!manualQuery.trim() || analysing}
                  activeOpacity={0.7}
                >
                  {analysing
                    ? <ActivityIndicator size="small" color={isWW ? '#fff' : '#000'} />
                    : <Text style={[styles.manualSearchBtnText, isWW ? { color: '#fff' } : null]}>Search</Text>
                  }
                </TouchableOpacity>
              </View>

              {/* Results card */}
              {manualResult && !analysing ? (
                <View style={[styles.manualResultCard, { backgroundColor: cardBg, borderColor }]}>
                  <Text style={[styles.manualResultName, { color: textColor }]}>{manualResult.name}</Text>
                  <View style={styles.manualMacroRow}>
                    <View style={styles.manualMacro}>
                      <Text style={[styles.manualMacroVal, { color: accent }]}>{manualResult.calories}</Text>
                      <Text style={[styles.manualMacroLabel, { color: mutedColor }]}>kcal</Text>
                    </View>
                    <View style={styles.manualMacro}>
                      <Text style={[styles.manualMacroVal, { color: accent }]}>{manualResult.protein}g</Text>
                      <Text style={[styles.manualMacroLabel, { color: mutedColor }]}>protein</Text>
                    </View>
                    <View style={styles.manualMacro}>
                      <Text style={[styles.manualMacroVal, { color: accent }]}>{manualResult.carbs}g</Text>
                      <Text style={[styles.manualMacroLabel, { color: mutedColor }]}>carbs</Text>
                    </View>
                    <View style={styles.manualMacro}>
                      <Text style={[styles.manualMacroVal, { color: accent }]}>{manualResult.fat}g</Text>
                      <Text style={[styles.manualMacroLabel, { color: mutedColor }]}>fat</Text>
                    </View>
                  </View>
                  {manualResult.recommendation ? (
                    <Text style={[styles.manualRecommendation, { color: mutedColor }]}>💡 {manualResult.recommendation}</Text>
                  ) : null}
                  <Pressable style={[styles.manualLogBtn, { backgroundColor: accent }]} onPress={handleManualLog}>
                    <Text style={[styles.manualLogBtnText, isWW ? { color: '#fff' } : null]}>✓ Log This Food</Text>
                  </Pressable>
                  <Pressable style={[styles.cancelBtn, { marginTop: 8, borderColor }]} onPress={() => { setManualResult(null); setManualQuery(''); }}>
                    <Text style={[styles.cancelText, { color: mutedColor }]}>Search Again</Text>
                  </Pressable>
                </View>
              ) : null}

              <Pressable style={[styles.cancelBtn, { marginTop: manualResult ? 4 : 16, borderColor }]} onPress={() => setMode('choose')}>
                <Text style={[styles.cancelText, { color: mutedColor }]}>← Back</Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 36,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    letterSpacing: 2,
    color: C.text,
    marginBottom: 6,
  },
  sub: {
    fontSize: 12,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    lineHeight: 18,
    marginBottom: 16,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  optionIcon: { fontSize: 28 },
  optionTitle: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    marginBottom: 2,
  },
  optionMeta: { fontSize: 11, color: C.muted, fontFamily: 'DMSans_400Regular', lineHeight: 16 },
  cancelBtn: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelText: { color: C.muted, fontFamily: 'DMSans_400Regular', fontSize: 13 },
  cameraWrap: {
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
  },
  camera: { flex: 1 },
  analysing: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  analysingText: {
    color: C.green,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
  cameraActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  captureBtn: {
    flex: 2,
    backgroundColor: C.green,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnText: { color: '#000', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  barcodeOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeTarget: {
    width: 240,
    height: 100,
    borderWidth: 2,
    borderColor: C.green,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  optionCardLocked: { opacity: 0.7 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  proTag: {
    fontSize: 9,
    color: C.orange,
    fontFamily: 'SpaceMono_400Regular',
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  freeTag: {
    fontSize: 9,
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    borderWidth: 1,
    borderColor: C.greenStrongBorder,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  // ── Manual entry ──────────────────────────────────────
  manualRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
    alignItems: 'center',
  },
  manualInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  manualSearchBtn: {
    backgroundColor: C.green,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  manualSearchBtnText: {
    color: '#000',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 13,
  },
  manualResultCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 8,
  },
  manualResultName: {
    color: C.text,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 15,
    marginBottom: 12,
  },
  manualMacroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  manualMacro: {
    alignItems: 'center',
    flex: 1,
  },
  manualMacroVal: {
    color: C.green,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    letterSpacing: 1,
  },
  manualMacroLabel: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    marginTop: 2,
  },
  manualRecommendation: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  manualLogBtn: {
    backgroundColor: C.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualLogBtnText: {
    color: '#000',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 15,
  },
  servingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  servingLabel: {
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    width: 62,
  },
  servingInput: {
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 60,
    textAlign: 'center',
  },
  servingHint: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    flex: 1,
  },
  // ── WW variant buttons ────────────────────────────────
  wwPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    padding: 18,
    marginBottom: 10,
  },
  wwPrimaryIcon: { fontSize: 32 },
  wwPrimaryText: { flex: 1 },
  wwPrimaryTitle: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 15,
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  wwPrimarySub: {
    color: 'rgba(0,0,0,0.65)',
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  wwSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  wwSecondaryIcon: { fontSize: 26 },
  wwSecondaryTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  wwTertiaryBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  wwTertiaryText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
