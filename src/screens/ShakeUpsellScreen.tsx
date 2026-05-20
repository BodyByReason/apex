import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { WalkWaterStackParamList } from '@/navigation/WalkWaterNavigator';
import { SHAKE_DELIVERED_PRICE, type ShakeFlavor } from '@/lib/shakeOrders';

const C = {
  bg: '#050A14',
  card: '#0D1A2B',
  cardSoft: '#101D31',
  border: 'rgba(83,183,255,0.18)',
  borderStrong: 'rgba(83,183,255,0.32)',
  text: '#F0F8FF',
  muted: '#87A3BF',
  blue: '#53B7FF',
  blueSoft: 'rgba(83,183,255,0.12)',
  gold: '#F6B53D',
  goldSoft: 'rgba(246,181,61,0.14)',
  line: 'rgba(255,255,255,0.08)',
  whiteSoft: 'rgba(240,248,255,0.8)',
};

type Nav = NativeStackNavigationProp<WalkWaterStackParamList, 'ShakeUpsell'>;

const FLAVORS: Array<{ key: ShakeFlavor; label: string }> = [
  { key: 'vanilla', label: 'Vanilla' },
  { key: 'chocolate', label: 'Chocolate' },
];

const BENEFITS = [
  '20g plant-based protein',
  '25 vitamins & minerals',
  'Easy grab-and-go support for busy days',
];

const SHAKES_PER_PACK = 12;

export default function ShakeUpsellScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [flavor, setFlavor] = useState<ShakeFlavor>('vanilla');

  const flavorDescription = useMemo(() => {
    if (flavor === 'vanilla') {
      return 'Smooth, classic, and easy to enjoy any time of day.';
    }
    return 'Rich, chocolatey, and satisfying when you want something more indulgent.';
  }, [flavor]);

  const perShakePrice = useMemo(
    () => (SHAKE_DELIVERED_PRICE / SHAKES_PER_PACK).toFixed(2),
    []
  );

  const handleContinue = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    navigation.navigate('ShakeCheckout', { flavor });
  };

  const handleSkip = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    navigation.replace('WalkWaterQuiz', { mode: 'upgrade' });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>OPTIONAL DAILY ADD-ON</Text>
        <Text style={styles.headline}>Add daily shakes to keep your plan easy</Text>
        <Text style={styles.subhead}>
          Pick vanilla or chocolate and we&apos;ll ship a 12-pack of ready-to-drink shakes straight to your door.
        </Text>

        <View style={styles.heroCard}>
          <View style={styles.heroGlow} />
          <Image
            source={require('../../assets/shake-upsell.jpg')}
            style={styles.heroImage}
            resizeMode="cover"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PICK YOUR FLAVOR</Text>
          <View style={styles.selectorShell}>
            {FLAVORS.map((item) => {
              const active = item.key === flavor;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setFlavor(item.key)}
                  style={[styles.flavorPill, active ? styles.flavorPillActive : null]}
                >
                  <Text style={[styles.flavorPillText, active ? styles.flavorPillTextActive : null]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.flavorHint}>{flavorDescription}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHY PEOPLE ADD THEM</Text>
          <View style={styles.benefitsCard}>
            {BENEFITS.map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <View style={styles.benefitDot} />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>12-pack delivered</Text>
          <Text style={styles.price}>${SHAKE_DELIVERED_PRICE.toFixed(2)}</Text>
          <Text style={styles.priceSub}>One-time add-on to today&apos;s order</Text>
          <Text style={styles.priceSub}>About ${perShakePrice} per shake</Text>
          <Text style={styles.priceSub}>Includes shipping + handling</Text>
          <Text style={styles.priceTertiary}>
            Pay over time with Klarna or Affirm at checkout, if eligible
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TRUSTED BY CUSTOMERS</Text>
          <View style={styles.reviewCard}>
            <Text style={styles.rating}>4.9 ★ from 209 reviews</Text>
            <Text style={styles.reviewText}>
              Perfect for busy days when I need something quick and filling.
            </Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={handleContinue}>
          <Text style={styles.primaryBtnText}>Add shakes to my plan</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={handleSkip}>
          <Text style={styles.secondaryBtnText}>No thanks, continue without shakes</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 18,
  },
  eyebrow: {
    color: C.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.3,
  },
  headline: {
    color: C.text,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 38,
    marginTop: 4,
  },
  subhead: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 26,
    marginTop: 10,
  },
  heroCard: {
    backgroundColor: C.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: C.borderStrong,
    padding: 14,
    overflow: 'hidden',
    marginTop: 6,
  },
  heroGlow: {
    position: 'absolute',
    top: -30,
    right: -18,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: C.goldSoft,
  },
  heroImage: {
    width: '100%',
    height: 250,
    borderRadius: 20,
  },
  section: {
    gap: 12,
  },
  sectionLabel: {
    color: '#7F9AB4',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.3,
    marginTop: 2,
  },
  selectorShell: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: C.cardSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 6,
  },
  flavorPill: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  flavorPillActive: {
    backgroundColor: C.blueSoft,
    borderWidth: 1,
    borderColor: C.blue,
  },
  flavorPillText: {
    color: C.whiteSoft,
    fontSize: 17,
    fontWeight: '800',
  },
  flavorPillTextActive: {
    color: C.blue,
  },
  flavorHint: {
    color: C.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  benefitsCard: {
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    gap: 14,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  benefitDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.blue,
  },
  benefitText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  priceCard: {
    backgroundColor: C.cardSoft,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.borderStrong,
    padding: 20,
    gap: 4,
  },
  priceLabel: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
  },
  price: {
    color: C.text,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  priceSub: {
    color: C.muted,
    fontSize: 15,
    lineHeight: 21,
  },
  priceTertiary: {
    color: '#7391AE',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  reviewCard: {
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    gap: 10,
  },
  rating: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
  },
  reviewText: {
    color: C.whiteSoft,
    fontSize: 15,
    lineHeight: 23,
  },
  primaryBtn: {
    backgroundColor: C.blue,
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryBtnText: {
    color: C.bg,
    fontSize: 21,
    fontWeight: '900',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: C.muted,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
