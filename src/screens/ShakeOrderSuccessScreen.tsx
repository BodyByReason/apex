import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { WalkWaterStackParamList } from '@/navigation/WalkWaterNavigator';

const C = {
  bg: '#050A14',
  text: '#F0F8FF',
  muted: '#87A3BF',
  blue: '#53B7FF',
  gold: '#F6B53D',
  goldSoft: 'rgba(246,181,61,0.16)',
  goldBorder: 'rgba(246,181,61,0.35)',
};

type Nav = NativeStackNavigationProp<WalkWaterStackParamList, 'ShakeOrderSuccess'>;
type OrderSuccessRoute = RouteProp<WalkWaterStackParamList, 'ShakeOrderSuccess'>;

export default function ShakeOrderSuccessScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<OrderSuccessRoute>();
  const insets = useSafeAreaInsets();

  const flavorLabel = route.params.flavor === 'vanilla' ? 'vanilla' : 'chocolate';
  const paid = route.params.paid ?? false;

  const handleContinue = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
    navigation.replace('WalkWaterQuiz', { mode: 'upgrade' });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.badge}>
        <Text style={styles.badgeEmoji}>📦</Text>
      </View>
      <Text style={styles.eyebrow}>{paid ? 'ORDER CONFIRMED' : 'ORDER RECEIVED'}</Text>
      <Text style={styles.headline}>{paid ? 'Your order is confirmed.' : 'Your order is in.'}</Text>
      <Text style={styles.body}>
        We&apos;ve got your {flavorLabel} shakes and your shipping info. We&apos;ll take it from here.
      </Text>
      <Pressable style={styles.primaryBtn} onPress={handleContinue}>
        <Text style={styles.primaryBtnText}>Continue to my upgraded plan →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  badge: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.goldSoft,
    borderWidth: 2,
    borderColor: C.goldBorder,
  },
  badgeEmoji: {
    fontSize: 52,
  },
  eyebrow: {
    color: C.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.2,
  },
  headline: {
    color: C.text,
    fontSize: 36,
    fontWeight: '900',
    textAlign: 'center',
  },
  body: {
    color: C.muted,
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: C.blue,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 28,
    marginTop: 6,
  },
  primaryBtnText: {
    color: C.bg,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
});
