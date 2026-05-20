/**
 * MealShareCard
 *
 * A 9:16 portrait story card (Instagram / TikTok / Facebook Stories ratio)
 * captured by ViewShot and shared via expo-sharing so that social apps appear
 * in the iOS share sheet (plain-text Share.share does NOT trigger them).
 */

import React from 'react';

import { Dimensions, StyleSheet, Text, View } from 'react-native';

import { apexColors as C } from '@/theme/colors';

// ─── Card dimensions (9:16 story ratio) ───────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
export const MEAL_CARD_W = Math.min(340, SCREEN_W - 32);
export const MEAL_CARD_H = Math.round(MEAL_CARD_W * (16 / 9));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MealShareData {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  displayName?: string;
  accent?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MealShareCard({
  foodName,
  calories,
  protein,
  carbs,
  fat,
  displayName,
  accent = C.green,
}: MealShareData) {
  const cleanName = (displayName || 'Athlete').trim().slice(0, 20);

  // Total macros for % bar
  const macroTotal = protein * 4 + carbs * 4 + fat * 9 || 1;
  const proteinPct = Math.round((protein * 4 / macroTotal) * 100);
  const carbsPct = Math.round((carbs * 4 / macroTotal) * 100);
  const fatPct = 100 - proteinPct - carbsPct;

  // Derive subtle bg tint from accent
  const accentAlpha10 = accent + '1a';
  const accentAlpha30 = accent + '4d';

  return (
    <View style={[styles.card, { backgroundColor: '#040d08' }]}>
      {/* ── Top bar: brand + pill ── */}
      <View style={styles.topBar}>
        <Text style={[styles.brand, { color: accent }]}>APEX</Text>
        <View style={[styles.pill, { backgroundColor: accentAlpha10, borderColor: accentAlpha30 }]}>
          <Text style={[styles.pillText, { color: accent }]}>NUTRITION WIN</Text>
        </View>
      </View>

      {/* ── Centre content ── */}
      <View style={styles.centreWrap}>
        {/* Calorie ring */}
        <View style={[styles.iconRing, { borderColor: accentAlpha30, backgroundColor: accentAlpha10 }]}>
          <View style={[styles.iconInner, { backgroundColor: accentAlpha10 }]}>
            <Text style={styles.kcalValue}>{calories}</Text>
            <Text style={[styles.kcalLabel, { color: accent }]}>KCAL</Text>
          </View>
        </View>

        <Text style={styles.foodName} numberOfLines={2} adjustsFontSizeToFit>
          {foodName.toUpperCase()}
        </Text>
        <Text style={styles.loggedLabel}>JUST LOGGED</Text>

        <View style={[styles.divider, { backgroundColor: accentAlpha30 }]} />

        {/* Macro bar */}
        <View style={styles.macroBarWrap}>
          <View style={[styles.macroBarSegment, { flex: proteinPct, backgroundColor: accent }]} />
          <View style={[styles.macroBarSegment, { flex: carbsPct, backgroundColor: accent + '88' }]} />
          <View style={[styles.macroBarSegment, { flex: fatPct, backgroundColor: accent + '44' }]} />
        </View>

        {/* Macro stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: accent }]}>{protein}g</Text>
            <Text style={styles.statLabel}>PROTEIN</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{carbs}g</Text>
            <Text style={styles.statLabel}>CARBS</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{fat}g</Text>
            <Text style={styles.statLabel}>FAT</Text>
          </View>
        </View>

        {/* Athlete name */}
        <Text style={styles.athleteTag}>
          {cleanName.toUpperCase()} • FUELLING THE WORK
        </Text>
      </View>

      {/* ── Bottom bar ── */}
      <View style={styles.bottomBar}>
        <Text style={[styles.tagline, { color: accent + 'a6' }]}>TRAIN HARD. EAT SMART. STAY LOCKED IN.</Text>
        <Text style={styles.appTag}>apex.fitness</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    width: MEAL_CARD_W,
    height: MEAL_CARD_H,
    borderRadius: 24,
    overflow: 'hidden',
    justifyContent: 'space-between',
    paddingVertical: 28,
    paddingHorizontal: 22,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    letterSpacing: 5,
  },
  pill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 0.8,
  },

  centreWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  iconInner: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kcalValue: {
    color: '#ffffff',
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 36,
    letterSpacing: 1,
    lineHeight: 38,
  },
  kcalLabel: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.2,
    marginTop: 2,
  },

  foodName: {
    color: '#ffffff',
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 40,
    letterSpacing: 2,
    textAlign: 'center',
    lineHeight: 44,
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  loggedLabel: {
    color: 'rgba(255,255,255,0.38)',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 1.4,
    marginBottom: 6,
  },

  divider: {
    width: 48,
    height: 1,
    marginVertical: 18,
  },

  macroBarWrap: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    width: '100%',
    marginBottom: 16,
    gap: 2,
  },
  macroBarSegment: {
    borderRadius: 2,
    height: 4,
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    width: '100%',
    marginBottom: 14,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  statSep: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  statValue: {
    color: '#ffffff',
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.38)',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 0.6,
    marginTop: 3,
  },

  athleteTag: {
    color: 'rgba(255,255,255,0.28)',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 0.8,
    textAlign: 'center',
  },

  bottomBar: {
    alignItems: 'center',
    gap: 5,
  },
  tagline: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 0.7,
    textAlign: 'center',
  },
  appTag: {
    color: 'rgba(255,255,255,0.22)',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 9,
    letterSpacing: 0.5,
  },
});
