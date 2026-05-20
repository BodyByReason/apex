import React, { useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Theme ────────────────────────────────────────────────────────────────────

const C = {
  black:      '#050A14',
  dark:       '#080F1A',
  card:       '#0D1B2A',
  cardAlt:    '#111E2E',
  border:     '#1A2E45',
  blue:       '#0EA5E9',
  teal:       '#06B6D4',
  blueSoft:   'rgba(14,165,233,0.10)',
  blueBorder: 'rgba(14,165,233,0.25)',
  text:       '#F0F8FF',
  muted:      '#6B8BA4',
  accent:     '#38BDF8',
};

// ─── Types ────────────────────────────────────────────────────────────────────

type DeviceId = 'phone' | 'apple_watch' | 'samsung' | 'garmin' | 'other';

type Device = {
  id: DeviceId;
  icon: string;
  label: string;
  platform?: 'ios' | 'android';
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onConnect: () => Promise<void>;
};

// ─── Device definitions ───────────────────────────────────────────────────────

const DEVICES: Device[] = [
  { id: 'phone',       icon: '📱', label: 'Just my phone' },
  { id: 'apple_watch', icon: '⌚', label: 'Apple Watch',    platform: 'ios' },
  { id: 'samsung',     icon: '⌚', label: 'Samsung Watch',  platform: 'android' },
  { id: 'garmin',      icon: '⌚', label: 'Garmin',         },
  { id: 'other',       icon: '⌚', label: 'Other watch',    },
];

// ─── Per-device instruction content ──────────────────────────────────────────

type InstructionConfig = {
  title: string;
  subtitle: string;
  steps: string[];
  primaryLabel: string;
  primaryAction: () => void;
  secondaryLabel?: string;
  secondaryAction?: () => void;
};

function buildInstructions(device: DeviceId, onConnect: () => Promise<void>): InstructionConfig {
  const openUrl = (url: string) => Linking.openURL(url).catch(() => null);

  switch (device) {
    case 'apple_watch':
      return {
        title: 'Apple Watch',
        subtitle: 'Apple Watch syncs steps to iPhone automatically through Apple Health.',
        steps: [
          'Make sure your Apple Watch is paired and worn.',
          'Open the Health app → Browse → Activity → Steps.',
          'If Steps are missing, open Watch app → Health → turn on Apple Watch as source.',
          'Come back here and tap Refresh below.',
        ],
        primaryLabel: 'Open Apple Health',
        primaryAction: () => openUrl('x-apple-health://'),
        secondaryLabel: 'Done — Refresh Steps',
        secondaryAction: onConnect,
      };

    case 'samsung':
      return {
        title: 'Samsung Watch',
        subtitle: 'Samsung Watch syncs steps through Samsung Health → Health Connect → APEX.',
        steps: [
          'Open the Samsung Health app.',
          'Tap the ⊕ menu → Connected services.',
          'Tap Health Connect and enable sync.',
          'Tap Manage permissions → find Walk + Water → allow Steps.',
          'Come back here and tap Connect below.',
        ],
        primaryLabel: 'Open Samsung Health',
        primaryAction: () =>
          openUrl('com.sec.android.app.shealth://').catch
            ? openUrl('com.sec.android.app.shealth://')
            : openUrl('market://details?id=com.sec.android.app.shealth'),
        secondaryLabel: 'Already done — Connect Steps',
        secondaryAction: onConnect,
      };

    case 'garmin':
      if (Platform.OS === 'ios') {
        return {
          title: 'Garmin',
          subtitle: 'Garmin Connect syncs your steps to Apple Health, which APEX reads.',
          steps: [
            'Open the Garmin Connect app.',
            'Tap More (⋯) → Settings → Health & Wellness.',
            'Enable "Sync with Apple Health".',
            'Open Apple Health → Sources → confirm Garmin is listed.',
            'Come back here and tap Refresh below.',
          ],
          primaryLabel: 'Open Garmin Connect',
          primaryAction: () => openUrl('gcm-ios://'),
          secondaryLabel: 'Done — Refresh Steps',
          secondaryAction: onConnect,
        };
      }
      return {
        title: 'Garmin',
        subtitle: 'Garmin Connect syncs your steps to Health Connect, which APEX reads.',
        steps: [
          'Open the Garmin Connect app.',
          'Tap More (⋯) → Settings → Health & Wellness.',
          'Enable "Sync with Android Health Connect".',
          'Come back here and tap Connect below.',
        ],
        primaryLabel: 'Open Garmin Connect',
        primaryAction: () => openUrl('gcm://'),
        secondaryLabel: 'Already done — Connect Steps',
        secondaryAction: onConnect,
      };

    case 'other':
      return {
        title: 'Other watch',
        subtitle:
          Platform.OS === 'ios'
            ? 'Most watches sync steps through Apple Health. Check your watch app\'s settings to enable Apple Health sync.'
            : 'Most watches sync steps through Health Connect. Check your watch app\'s settings to enable Health Connect sync.',
        steps: [
          'Open your watch companion app (e.g. Fitbit, Fossil, Wear OS).',
          Platform.OS === 'ios'
            ? 'Find the Apple Health or HealthKit sync setting and enable it.'
            : 'Find the Health Connect or Google Fit sync setting and enable it.',
          'Come back here and tap Connect below.',
        ],
        primaryLabel: 'Connect Steps',
        primaryAction: onConnect,
      };

    default: // 'phone'
      return {
        title: 'Phone pedometer',
        subtitle:
          Platform.OS === 'ios'
            ? 'APEX reads your step count from Apple Health, which uses your iPhone\'s built-in motion sensor.'
            : 'APEX reads your step count from Health Connect, which uses your phone\'s built-in pedometer.',
        steps: [],
        primaryLabel: 'Grant Steps Permission',
        primaryAction: onConnect,
      };
  }
}

// ─── ConnectStepsModal ────────────────────────────────────────────────────────

export default function ConnectStepsModal({ visible, onClose, onConnect }: Props) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<DeviceId | null>(null);
  const [connecting, setConnecting] = useState(false);

  const visibleDevices = DEVICES.filter(
    (d) => !d.platform || d.platform === Platform.OS,
  );

  const instructions = selected ? buildInstructions(selected, onConnect) : null;

  const handleBack = () => setSelected(null);

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  const handlePrimary = async () => {
    if (!instructions) return;
    setConnecting(true);
    try {
      await instructions.primaryAction();
    } finally {
      setConnecting(false);
    }
  };

  const handleSecondary = async () => {
    if (!instructions?.secondaryAction) return;
    setConnecting(true);
    try {
      await instructions.secondaryAction();
      handleClose();
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          {selected ? (
            <Pressable onPress={handleBack} hitSlop={12} style={styles.backBtn}>
              <Text style={styles.backBtnText}>← Back</Text>
            </Pressable>
          ) : (
            <View style={{ width: 60 }} />
          )}
          <Text style={styles.headerTitle}>
            {selected ? instructions?.title : 'Connect Steps'}
          </Text>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        {/* ── Step 1: Device picker ── */}
        {!selected && (
          <>
            <Text style={styles.subheading}>What device tracks your steps?</Text>
            <View style={styles.deviceGrid}>
              {visibleDevices.map((device) => (
                <Pressable
                  key={device.id}
                  style={styles.deviceCard}
                  onPress={() => setSelected(device.id)}
                >
                  <Text style={styles.deviceIcon}>{device.icon}</Text>
                  <Text style={styles.deviceLabel}>{device.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* ── Step 2: Instructions ── */}
        {selected && instructions && (
          <ScrollView
            style={styles.instructionsScroll}
            contentContainerStyle={styles.instructionsContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.instructionSubtitle}>{instructions.subtitle}</Text>

            {instructions.steps.length > 0 && (
              <View style={styles.stepsList}>
                {instructions.steps.map((step, i) => (
                  <View key={i} style={styles.stepRow}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{step}</Text>
                  </View>
                ))}
              </View>
            )}

            <Pressable
              style={[styles.primaryBtn, connecting && styles.btnDisabled]}
              onPress={handlePrimary}
              disabled={connecting}
            >
              <Text style={styles.primaryBtnText}>{instructions.primaryLabel}</Text>
            </Pressable>

            {instructions.secondaryLabel && (
              <Pressable
                style={[styles.secondaryBtn, connecting && styles.btnDisabled]}
                onPress={handleSecondary}
                disabled={connecting}
              >
                <Text style={styles.secondaryBtnText}>{instructions.secondaryLabel}</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: C.dark,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
  },
  backBtn: { width: 60 },
  backBtnText: { color: C.accent, fontSize: 14, fontWeight: '600' },
  closeBtn: { width: 60, alignItems: 'flex-end' },
  closeBtnText: { color: C.muted, fontSize: 18 },

  subheading: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 16,
    textAlign: 'center',
  },
  deviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 8,
  },
  deviceCard: {
    width: '47%',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  deviceIcon: { fontSize: 28 },
  deviceLabel: {
    color: C.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },

  instructionsScroll: {},
  instructionsContent: { paddingBottom: 8, gap: 16 },
  instructionSubtitle: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  stepsList: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    gap: 14,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.blueSoft,
    borderWidth: 1,
    borderColor: C.blueBorder,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepBadgeText: {
    color: C.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  stepText: {
    color: C.text,
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },

  primaryBtn: {
    backgroundColor: C.blue,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.blueBorder,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: C.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  btnDisabled: { opacity: 0.5 },
});
