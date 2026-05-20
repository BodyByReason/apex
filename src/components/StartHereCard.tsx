/**
 * StartHereCard
 *
 * An interactive checklist shown on the Dashboard after a user first signs up.
 * Each action links to a different part of the app and checks itself off when
 * the user completes it.  The card disappears once all items are done (or the
 * user dismisses it).
 *
 * Completion state is persisted in AsyncStorage so it only shows once per
 * device install.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apexColors as C } from '@/theme/colors';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'apex_start_here_v1';

export type StartHereAction = {
  id: string;
  emoji: string;
  iconSource?: ImageSourcePropType;
  label: string;
  description: string;
  xpReward?: number;
  /** Call this when the item is tapped — navigate to the right screen */
  onPress: () => void;
};

// ── Subcomponents ─────────────────────────────────────────────────────────────

function CheckItem({
  action,
  accentColor,
  accentSoft,
  accentBorder,
  checked,
  onToggle,
}: {
  action: StartHereAction;
  accentColor?: string;
  accentSoft?: string;
  accentBorder?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const checkOpacity = useRef(new Animated.Value(checked ? 1 : 0)).current;

  const handlePress = useCallback(() => {
    // Bounce the row
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 18, bounciness: 10, useNativeDriver: true }),
    ]).start();

    if (!checked) {
      Animated.timing(checkOpacity, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }

    onToggle();
    action.onPress();
  }, [checked, scale, checkOpacity, onToggle, action]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable style={styles.item} onPress={handlePress}>
        {/* Check circle */}
        <View
          style={[
            styles.checkCircle,
            checked && styles.checkCircleDone,
            checked && accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : null,
          ]}
        >
          <Animated.Text style={[styles.checkMark, { opacity: checkOpacity }]}>✓</Animated.Text>
        </View>

        {/* Text */}
        <View style={styles.itemText}>
          <View style={styles.itemLabelRow}>
            <View style={styles.itemLabelWrap}>
              {action.iconSource ? (
                <Image source={action.iconSource} style={styles.inlineAvatar} />
              ) : (
                <Text style={[styles.itemLabel, checked && styles.itemLabelDone]}>{action.emoji}</Text>
              )}
              <Text style={[styles.itemLabel, checked && styles.itemLabelDone]}>{action.label}</Text>
            </View>
            {!checked && action.xpReward ? (
              <View
                style={[
                  styles.xpPill,
                  accentColor ? { backgroundColor: accentSoft ?? `${accentColor}1f`, borderColor: accentBorder ?? `${accentColor}55` } : null,
                ]}
              >
                <Text style={[styles.xpPillText, accentColor ? { color: accentColor } : null]}>+{action.xpReward} XP</Text>
              </View>
            ) : null}
          </View>
          {!checked && (
            <Text style={styles.itemDesc} numberOfLines={1}>{action.description}</Text>
          )}
        </View>

        {/* Arrow */}
        {!checked && <Text style={styles.itemArrow}>›</Text>}
      </Pressable>
    </Animated.View>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ pct, accentColor }: { pct: number; accentColor?: string }) {
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: pct,
      duration: 500,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [pct, width]);

  return (
    <View style={styles.progressTrack}>
      <Animated.View
        style={[
          styles.progressFill,
          accentColor ? { backgroundColor: accentColor } : null,
          {
            width: width.interpolate({
              inputRange: [0, 100],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  actions: StartHereAction[];
  accentColor?: string;
  accentSoft?: string;
  accentBorder?: string;
  /** Called when all items are checked or user dismisses */
  onDone?: () => void;
  onActionComplete?: (action: StartHereAction) => void;
};

export function StartHereCard({ actions, accentColor, accentSoft, accentBorder, onDone, onActionComplete }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardSlide = useRef(new Animated.Value(-12)).current;

  // ── Load persisted state ──────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const saved: { checked?: Record<string, boolean>; dismissed?: boolean } = JSON.parse(raw);
          if (saved.dismissed) {
            setDismissed(true);
          } else {
            setChecked(saved.checked ?? {});
          }
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // ── Entrance animation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded || dismissed) return;
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 400,
        delay: 200,
        useNativeDriver: true,
      }),
      Animated.timing(cardSlide, {
        toValue: 0,
        duration: 450,
        delay: 200,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
    ]).start();
  }, [loaded, dismissed, cardOpacity, cardSlide]);

  // ── Persist state on change ───────────────────────────────────────────────
  const persist = useCallback((nextChecked: Record<string, boolean>, isDismissed = false) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ checked: nextChecked, dismissed: isDismissed })).catch(() => null);
  }, []);

  const toggleItem = useCallback(
    (id: string) => {
      setChecked((prev) => {
        const next = { ...prev, [id]: true };
        const completedAction = actions.find((action) => action.id === id);
        persist(next);
        if (completedAction) {
          onActionComplete?.(completedAction);
        }
        // Auto-dismiss after a short delay when all done
        if (Object.keys(next).length === actions.length) {
          setTimeout(() => {
            setDismissed(true);
            persist(next, true);
            onDone?.();
          }, 1200);
        }
        return next;
      });
    },
    [actions, persist, onActionComplete, onDone],
  );

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(cardSlide, { toValue: -12, duration: 280, useNativeDriver: true }),
    ]).start(() => {
      setDismissed(true);
      persist(checked, true);
      onDone?.();
    });
  }, [cardOpacity, cardSlide, checked, persist, onDone]);

  if (!loaded || dismissed) return null;

  const doneCount = Object.keys(checked).length;
  const totalCount = actions.length;
  const pct = Math.round((doneCount / totalCount) * 100);

  return (
    <Animated.View
      style={[
        styles.card,
        accentColor ? { borderColor: accentBorder ?? `${accentColor}55`, shadowColor: accentColor } : null,
        { opacity: cardOpacity, transform: [{ translateY: cardSlide }] },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.badge, accentColor ? { color: accentColor } : null]}>START HERE</Text>
          <Text style={styles.title}>Get the most from APEX</Text>
        </View>
        <Pressable onPress={dismiss} hitSlop={12} style={styles.dismissBtn}>
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      </View>

      {/* Progress */}
      <View style={styles.progressRow}>
        <ProgressBar pct={pct} accentColor={accentColor} />
        <Text style={styles.progressLabel}>{doneCount}/{totalCount} done</Text>
      </View>

      {/* Items */}
      <View style={styles.itemList}>
        {actions.map((action) => (
          <CheckItem
            key={action.id}
            action={action}
            accentBorder={accentBorder}
            accentColor={accentColor}
            accentSoft={accentSoft}
            checked={!!checked[action.id]}
            onToggle={() => toggleItem(action.id)}
          />
        ))}
      </View>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.green + '55',
    padding: 18,
    gap: 14,
    marginBottom: 4,
    shadowColor: C.green,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    gap: 3,
  },
  badge: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 11,
    letterSpacing: 1.5,
    color: C.green,
  },
  title: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    color: C.text,
    letterSpacing: 0.5,
  },
  dismissBtn: {
    padding: 4,
  },
  dismissText: {
    color: C.muted,
    fontSize: 13,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    backgroundColor: C.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: C.green,
    borderRadius: 3,
  },
  progressLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: C.muted,
    minWidth: 44,
    textAlign: 'right',
  },
  itemList: {
    gap: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border + '66',
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleDone: {
    backgroundColor: C.green,
    borderColor: C.green,
  },
  checkMark: {
    color: '#000',
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    lineHeight: 16,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  itemLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  itemLabel: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    color: C.text,
    flexShrink: 1,
  },
  itemLabelDone: {
    color: C.muted,
    textDecorationLine: 'line-through',
  },
  itemDesc: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: C.muted,
  },
  inlineAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginRight: 8,
    verticalAlign: 'middle',
  },
  xpPill: {
    backgroundColor: 'rgba(0,255,135,0.12)',
    borderColor: 'rgba(0,255,135,0.32)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  xpPillText: {
    color: C.green,
    fontFamily: 'DMSans_700Bold',
    fontSize: 10,
  },
  itemArrow: {
    color: C.muted,
    fontSize: 18,
    lineHeight: 22,
  },
});
