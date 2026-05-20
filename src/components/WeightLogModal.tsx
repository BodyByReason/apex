/**
 * WeightLogModal
 *
 * Bottom-sheet modal for logging body weight. Supports:
 *   1. Manual numeric entry
 *   2. 📷 Camera — take a photo of scale → AI reads the number
 *   3. 🖼  Photo library — pick existing scale photo → AI reads it
 *   4. ⌚ Smart scale / Apple Health (future hook — shows placeholder for now)
 *
 * Props:
 *   visible       — controls visibility
 *   session       — 'morning' | 'evening' | 'manual'  (pre-selects the session toggle)
 *   onClose       — called when the modal is dismissed
 *   onLogged      — called with the new entry after successful save
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { apexColors as C } from '@/theme/colors';
import { addWeightEntry, type WeightEntry, type WeighSession } from '@/lib/weightLog';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  session?: WeighSession;
  onClose: () => void;
  onLogged: (entry: WeightEntry) => void;
};

// ─── AI scale-reader helper ───────────────────────────────────────────────────

async function readWeightFromPhoto(imageUri: string): Promise<number | null> {
  try {
    // Convert local URI → base64
    const res = await fetch(imageUri);
    const blob = await res.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] ?? '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // Call Claude via Supabase edge function
    const { data, error } = await supabase.functions.invoke('anthropic', {
      body: {
        model: 'claude-opus-4-6',
        max_tokens: 64,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
              },
              {
                type: 'text',
                text: 'This is a photo of a digital scale display. Read the weight shown and respond with ONLY the numeric value in pounds (e.g. "182.4"). If you cannot read a clear number, respond with "null".',
              },
            ],
          },
        ],
      },
    });

    if (error) return null;
    const text: string = (data as { content: Array<{ text: string }> }).content?.[0]?.text?.trim() ?? '';
    if (text === 'null' || !text) return null;
    const parsed = parseFloat(text.replace(/[^0-9.]/g, ''));
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeightLogModal({ visible, session: initSession = 'manual', onClose, onLogged }: Props) {
  const [weightInput, setWeightInput] = useState('');
  const [session, setSession] = useState<WeighSession>(initSession);
  const [note, setNote] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [aiReading, setAiReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const slideAnim = useRef(new Animated.Value(400)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setSession(initSession);
      setWeightInput('');
      setNote('');
      setPhotoUri(undefined);
      slideAnim.setValue(400);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 5 }),
      ]).start();
    }
  }, [visible, initSession, slideAnim, fadeAnim]);

  const dismiss = () => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 400, duration: 220, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  // Swipe-down-to-dismiss gesture on the drag handle
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 8,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) slideAnim.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 0.8) {
          dismiss();
        } else {
          Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
        }
      },
    }),
  ).current;

  const handlePhotoAI = async (fromCamera: boolean) => {
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });

    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    setAiReading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const detected = await readWeightFromPhoto(uri);
    setAiReading(false);

    if (detected !== null) {
      setWeightInput(String(detected));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Alert.alert('Could not read scale', 'Make sure the display is well-lit and clearly visible, then enter the number manually.');
    }
  };

  const handleSave = async () => {
    const w = parseFloat(weightInput);
    if (!weightInput || isNaN(w) || w < 50 || w > 600) {
      Alert.alert('Invalid weight', 'Enter a weight between 50 and 600 lbs.');
      return;
    }
    setSaving(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const entry = await addWeightEntry({
        weightLbs: w,
        session,
        note: note.trim() || undefined,
        photoUri,
      });
      onLogged(entry);
      dismiss();
    } catch {
      Alert.alert('Error', 'Could not save weight. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  const sessions: Array<{ key: WeighSession; icon: string; label: string }> = [
    { key: 'morning', icon: '🌅', label: 'Morning' },
    { key: 'evening', icon: '🌙', label: 'Evening' },
    { key: 'manual',  icon: '⚡', label: 'Now'     },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <Animated.View style={[s.overlay, { opacity: fadeAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />

          <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
            {/* Drag handle — swipe down to dismiss */}
            <View {...panResponder.panHandlers} style={s.handleArea}>
              <View style={s.handle} />
            </View>

            {/* Header row with close button */}
            <View style={s.headerRow}>
              <View style={{ flex: 1 }} />
              <Text style={s.title}>LOG YOUR WEIGHT</Text>
              <Pressable style={s.closeBtn} onPress={dismiss} hitSlop={12}>
                <Text style={s.closeBtnText}>✕</Text>
              </Pressable>
            </View>
            <Text style={s.sub}>Track progress, spot trends, stay accountable</Text>

            {/* Session selector */}
            <View style={s.sessionRow}>
              {sessions.map((opt) => (
                <Pressable
                  key={opt.key}
                  style={[s.sessionBtn, session === opt.key && s.sessionBtnActive]}
                  onPress={async () => { await Haptics.selectionAsync(); setSession(opt.key); }}
                >
                  <Text style={s.sessionIcon}>{opt.icon}</Text>
                  <Text style={[s.sessionLabel, session === opt.key && s.sessionLabelActive]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Weight input */}
            <View style={s.inputRow}>
              <TextInput
                style={s.weightInput}
                value={weightInput}
                onChangeText={(v) => setWeightInput(v.replace(/[^0-9.]/g, ''))}
                placeholder="0.0"
                placeholderTextColor={C.muted}
                keyboardType="decimal-pad"
                maxLength={6}
              />
              <Text style={s.unit}>lbs</Text>
            </View>

            {/* AI photo buttons */}
            <View style={s.photoRow}>
              <Pressable
                style={[s.photoBtn, aiReading && { opacity: 0.5 }]}
                onPress={() => handlePhotoAI(true)}
                disabled={aiReading}
              >
                <Text style={s.photoBtnIcon}>📷</Text>
                <Text style={s.photoBtnText}>Scan Scale</Text>
              </Pressable>
              <Pressable
                style={[s.photoBtn, aiReading && { opacity: 0.5 }]}
                onPress={() => handlePhotoAI(false)}
                disabled={aiReading}
              >
                <Text style={s.photoBtnIcon}>🖼</Text>
                <Text style={s.photoBtnText}>Photo Library</Text>
              </Pressable>
              <Pressable style={[s.photoBtn, { opacity: 0.4 }]} disabled>
                <Text style={s.photoBtnIcon}>⌚</Text>
                <Text style={s.photoBtnText}>Smart Scale</Text>
              </Pressable>
            </View>

            {aiReading ? (
              <View style={s.aiReadingRow}>
                <ActivityIndicator size="small" color={C.green} />
                <Text style={s.aiReadingText}>AI reading scale…</Text>
              </View>
            ) : null}

            {photoUri && !aiReading ? (
              <Text style={s.photoConfirm}>📷 Scale photo attached {weightInput ? `· ${weightInput} lbs detected` : ''}</Text>
            ) : null}

            {/* Optional note */}
            <TextInput
              style={s.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Optional note (e.g. post-workout, morning fasted…)"
              placeholderTextColor={C.muted}
              maxLength={120}
            />

            {/* Save */}
            <Pressable
              style={[s.saveBtn, (!weightInput || saving) && { opacity: 0.45 }]}
              onPress={handleSave}
              disabled={!weightInput || saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={s.saveBtnText}>Save Weight →</Text>}
            </Pressable>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: -8,
    marginHorizontal: -24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: -4,
  },
  closeBtn: {
    flex: 1,
    alignItems: 'flex-end',
  },
  closeBtnText: {
    fontSize: 18,
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
  },
  title: {
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  sub: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    textAlign: 'center',
    marginTop: -6,
  },
  sessionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sessionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'transparent',
    gap: 4,
  },
  sessionBtnActive: {
    borderColor: C.green,
    backgroundColor: 'rgba(0,255,135,0.08)',
  },
  sessionIcon: { fontSize: 18 },
  sessionLabel: {
    fontSize: 11,
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
  },
  sessionLabelActive: { color: C.green },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  weightInput: {
    width: 140,
    textAlign: 'center',
    fontSize: 52,
    color: C.text,
    fontFamily: 'BebasNeue_400Regular',
    borderBottomWidth: 2,
    borderBottomColor: C.green,
    paddingVertical: 4,
  },
  unit: {
    fontSize: 20,
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
    alignSelf: 'flex-end',
    marginBottom: 8,
  },
  photoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  photoBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 4,
  },
  photoBtnIcon: { fontSize: 20 },
  photoBtnText: {
    fontSize: 10.5,
    color: C.muted,
    fontFamily: 'DMSans_500Medium',
    textAlign: 'center',
  },
  aiReadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  aiReadingText: {
    color: C.green,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  photoConfirm: {
    color: C.green,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    textAlign: 'center',
  },
  noteInput: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  saveBtn: {
    backgroundColor: C.green,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 16,
  },
});
