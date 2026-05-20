/**
 * AchievementShareCard
 *
 * A 9:16 portrait story card (same ratio as Instagram / TikTok / Facebook
 * Stories) captured by ViewShot in ProfileScreen and shared via expo-sharing.
 */

import React from 'react';

import { Dimensions, StyleSheet, Text, View } from 'react-native';

import type { UserAchievement } from '@/lib/achievements';
import { apexColors as C } from '@/theme/colors';

// ─── Card dimensions (9:16 story ratio) ───────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
export const STORY_CARD_W = Math.min(340, SCREEN_W - 32);
export const STORY_CARD_H = Math.round(STORY_CARD_W * (16 / 9));

// ─── Component ────────────────────────────────────────────────────────────────

export function AchievementShareCard({
  achievement,
  displayName,
  level,
  title,
}: {
  achievement: UserAchievement;
  displayName: string;
  level: number;
  title?: string;
}) {
  // Trim whitespace, cap length to avoid overflow
  const cleanName = (displayName || 'Athlete').trim().slice(0, 20);

  return (
    <View style={styles.card}>
      {/* ── Top bar: brand + pill ── */}
      <View style={styles.topBar}>
        <Text style={styles.brand}>APEX</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>ACHIEVEMENT UNLOCKED</Text>
        </View>
      </View>

      {/* ── Centre content ── */}
      <View style={styles.centreWrap}>
        {/* Icon ring */}
        <View style={styles.iconRing}>
          <View style={styles.iconInner}>
            <Text style={styles.icon}>{achievement.icon}</Text>
          </View>
        </View>

        <Text style={styles.achievementTitle}>{achievement.name.toUpperCase()}</Text>
        <Text style={styles.achievementDesc}>{achievement.description}</Text>

        <View style={styles.divider} />

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {cleanName}
            </Text>
            <Text style={styles.statLabel}>ATHLETE</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>L{level}</Text>
            <Text style={styles.statLabel}>LEVEL</Text>
          </View>
          {title ? (
            <>
              <View style={styles.statSep} />
              <View style={styles.statCell}>
                <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                  {title.toUpperCase()}
                </Text>
                <Text style={styles.statLabel}>TITLE</Text>
              </View>
            </>
          ) : null}
        </View>
      </View>

      {/* ── Bottom bar ── */}
      <View style={styles.bottomBar}>
        <Text style={styles.tagline}>TRAIN HARD. EAT SMART. STAY LOCKED IN.</Text>
        <Text style={styles.appTag}>apex.fitness</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    width: STORY_CARD_W,
    height: STORY_CARD_H,
    backgroundColor: '#040d08',
    borderRadius: 24,
    overflow: 'hidden',
    justifyContent: 'space-between',
    paddingVertical: 28,
    paddingHorizontal: 22,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: C.green,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    letterSpacing: 5,
  },
  pill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,255,135,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,135,0.35)',
  },
  pillText: {
    color: C.green,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 0.8,
  },

  // Centre
  centreWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  // Icon
  iconRing: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: 'rgba(0,255,135,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    backgroundColor: 'rgba(0,255,135,0.06)',
  },
  iconInner: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: 'rgba(0,255,135,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 56,
    textAlign: 'center',
  },

  achievementTitle: {
    color: '#ffffff',
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 44,
    letterSpacing: 2,
    textAlign: 'center',
    lineHeight: 48,
    marginBottom: 10,
  },
  achievementDesc: {
    color: 'rgba(255,255,255,0.60)',
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 6,
  },

  divider: {
    width: 48,
    height: 1,
    backgroundColor: 'rgba(0,255,135,0.40)',
    marginVertical: 24,
  },

  // Stats row
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
    fontSize: 20,
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

  // Bottom bar
  bottomBar: {
    alignItems: 'center',
    gap: 5,
  },
  tagline: {
    color: 'rgba(0,255,135,0.65)',
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
