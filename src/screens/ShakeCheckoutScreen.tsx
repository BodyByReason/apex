import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';

import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '@/contexts/AuthContext';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { WalkWaterStackParamList } from '@/navigation/WalkWaterNavigator';
import { PROFILE_STORAGE_KEY, type UserProfile } from '@/screens/GoalSetupScreen';
import { createShakeOrder, SHAKE_DELIVERED_PRICE } from '@/lib/shakeOrders';

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
  whiteSoft: 'rgba(240,248,255,0.8)',
  input: '#0B1522',
  line: 'rgba(255,255,255,0.08)',
};

type Nav = NativeStackNavigationProp<WalkWaterStackParamList, 'ShakeCheckout'>;
type ShakeCheckoutRoute = RouteProp<WalkWaterStackParamList, 'ShakeCheckout'>;

type FormState = {
  city: string;
  country: string;
  email: string;
  fullName: string;
  line1: string;
  line2: string;
  phone: string;
  postalCode: string;
  state: string;
};

const EMPTY_FORM: FormState = {
  city: '',
  country: 'US',
  email: '',
  fullName: '',
  line1: '',
  line2: '',
  phone: '',
  postalCode: '',
  state: '',
};

type PaymentIntentResponse = {
  amount: number;
  clientSecret: string;
  currency: string;
  paymentIntentId: string;
};

function formatStripeError(error: { code?: string; message?: string; localizedMessage?: string }) {
  const message = error.localizedMessage || error.message || 'Please try again.';
  return error.code ? `${message} (${error.code})` : message;
}

export default function ShakeCheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ShakeCheckoutRoute>();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { initPaymentSheet, isPlatformPaySupported, presentPaymentSheet } = useStripe();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [paying, setPaying] = useState(false);
  const [payLabel, setPayLabel] = useState('Pay now');

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_STORAGE_KEY)
      .then((raw) => {
        const profile = raw ? (JSON.parse(raw) as UserProfile) : null;
        setForm((current) => ({
          ...current,
          email: session?.user?.email ?? current.email,
          fullName: profile?.displayName ?? current.fullName,
        }));
      })
      .catch(() => null);
  }, [session?.user?.email]);

  useEffect(() => {
    let mounted = true;

    const detectWallet = async () => {
      try {
        const supported = await isPlatformPaySupported({
          googlePay: { testEnv: true },
        });
        if (!mounted) return;
        if (supported) {
          setPayLabel(Platform.OS === 'ios' ? 'Pay with Apple Pay' : 'Pay with Google Pay');
          return;
        }
      } catch {
        // Fall through to card checkout copy.
      }
      if (mounted) {
        setPayLabel('Pay now');
      }
    };

    detectWallet().catch(() => null);
    return () => {
      mounted = false;
    };
  }, [isPlatformPaySupported]);

  const flavorLabel = useMemo(
    () => (route.params.flavor === 'vanilla' ? 'Vanilla' : 'Chocolate'),
    [route.params.flavor],
  );

  const flavorDescription = useMemo(
    () => (
      route.params.flavor === 'vanilla'
        ? 'Smooth, classic, and easy to enjoy any time of day.'
        : 'Rich, chocolatey, and satisfying when you want something more indulgent.'
    ),
    [route.params.flavor],
  );

  const updateField = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const validate = () => {
    if (!session?.user?.id) {
      Alert.alert('Sign in required', 'Please sign in again before placing your shake order.');
      return false;
    }

    if (!env.stripePublishableKey) {
      Alert.alert('Stripe not configured', 'Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY before testing payments.');
      return false;
    }

    const required: Array<[keyof FormState, string]> = [
      ['fullName', 'Full name'],
      ['email', 'Email'],
      ['line1', 'Shipping address'],
      ['city', 'City'],
      ['state', 'State'],
      ['postalCode', 'ZIP / postal code'],
    ];

    const missing = required.find(([key]) => !form[key].trim());
    if (missing) {
      Alert.alert('Almost there', `Please fill in ${missing[1].toLowerCase()} before paying.`);
      return false;
    }

    return true;
  };

  const createPaymentIntent = async (): Promise<PaymentIntentResponse> => {
    const { data, error } = await supabase.functions.invoke('create-shake-payment-intent', {
      body: {
        email: form.email,
        flavor: route.params.flavor,
        fullName: form.fullName,
        phone: form.phone,
        shippingCity: form.city,
        shippingCountry: form.country,
        shippingLine1: form.line1,
        shippingLine2: form.line2,
        shippingPostalCode: form.postalCode,
        shippingState: form.state,
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data?.clientSecret || !data?.paymentIntentId) {
      throw new Error('Stripe did not return a valid payment intent.');
    }

    return data as PaymentIntentResponse;
  };

  const handlePay = async () => {
    if (!validate() || !session?.user?.id) return;

    setPaying(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);

    try {
      const paymentIntent = await createPaymentIntent();
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'BodyByReason, LLC',
        paymentIntentClientSecret: paymentIntent.clientSecret,
        returnURL: 'apex://stripe-redirect',
        applePay: {
          merchantCountryCode: 'US',
        },
        googlePay: {
          merchantCountryCode: 'US',
          currencyCode: 'USD',
          testEnv: true,
        },
        allowsDelayedPaymentMethods: false,
        defaultBillingDetails: {
          email: form.email,
          name: form.fullName,
          phone: form.phone || undefined,
        },
        defaultShippingDetails: {
          address: {
            city: form.city,
            country: form.country.toUpperCase(),
            line1: form.line1,
            line2: form.line2 || undefined,
            postalCode: form.postalCode,
            state: form.state,
          },
          name: form.fullName,
          phoneNumber: form.phone || undefined,
        },
        primaryButtonLabel: 'Pay $84.49',
        style: 'alwaysDark',
      });

      if (initError) {
        throw new Error(formatStripeError(initError));
      }

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') {
          throw new Error(formatStripeError(presentError));
        }
        return;
      }

      await createShakeOrder({
        email: form.email,
        flavor: route.params.flavor,
        fullName: form.fullName,
        paymentReference: paymentIntent.paymentIntentId,
        paymentStatus: 'paid',
        phone: form.phone,
        shippingCity: form.city,
        shippingCountry: form.country,
        shippingLine1: form.line1,
        shippingLine2: form.line2,
        shippingPostalCode: form.postalCode,
        shippingState: form.state,
        userId: session.user.id,
      });

      navigation.replace('ShakeOrderSuccess', {
        flavor: route.params.flavor,
        paid: true,
      });
    } catch (error) {
      console.error('Shake checkout failed', error);
      Alert.alert('Checkout failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const handleSkip = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    navigation.replace('WalkWaterQuiz', { mode: 'upgrade' });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          <Text style={styles.eyebrow}>SHAKE ORDER</Text>
          <Text style={styles.headline}>Where should we send your daily shakes?</Text>
          <Text style={styles.subhead}>
            Your flavor is locked in. Add your shipping details below, then complete payment to confirm the order.
          </Text>

          <View style={styles.summaryCard}>
            <View style={styles.summaryGlow} />
            <Image
              source={require('../../assets/shake-upsell.jpg')}
              style={styles.summaryImage}
              resizeMode="cover"
            />
            <View style={styles.summaryContent}>
              <Text style={styles.summaryEyebrow}>ORDER SUMMARY</Text>
              <Text style={styles.summaryTitle}>Nutrilite Organics All-in-One Shakes</Text>
              <Text style={styles.summaryFlavor}>{flavorLabel}</Text>
              <Text style={styles.summaryFlavorHint}>{flavorDescription}</Text>
            </View>
          </View>

          <View style={styles.priceCard}>
            <Text style={styles.priceLabel}>12-pack delivered</Text>
            <Text style={styles.price}>${SHAKE_DELIVERED_PRICE.toFixed(2)}</Text>
            <Text style={styles.priceSub}>One-time add-on to today&apos;s order</Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.sectionLabel}>SHIPPING DETAILS</Text>
            <Field label="Full name" value={form.fullName} onChangeText={(value) => updateField('fullName', value)} autoCapitalize="words" />
            <Field label="Email" value={form.email} onChangeText={(value) => updateField('email', value)} autoCapitalize="none" keyboardType="email-address" />
            <Field label="Phone (optional)" value={form.phone} onChangeText={(value) => updateField('phone', value)} keyboardType="phone-pad" />
            <Field label="Address line 1" value={form.line1} onChangeText={(value) => updateField('line1', value)} autoCapitalize="words" />
            <Field label="Address line 2 (optional)" value={form.line2} onChangeText={(value) => updateField('line2', value)} autoCapitalize="words" />
            <Field label="City" value={form.city} onChangeText={(value) => updateField('city', value)} autoCapitalize="words" />
            <View style={styles.row}>
              <View style={styles.half}>
                <Field label="State" value={form.state} onChangeText={(value) => updateField('state', value)} autoCapitalize="characters" />
              </View>
              <View style={styles.half}>
                <Field label="ZIP / postal code" value={form.postalCode} onChangeText={(value) => updateField('postalCode', value)} keyboardType="numbers-and-punctuation" />
              </View>
            </View>
            <Field label="Country" value={form.country} onChangeText={(value) => updateField('country', value)} autoCapitalize="characters" />
          </View>

          <Pressable
            style={[styles.primaryBtn, paying ? styles.primaryBtnDisabled : null]}
            onPress={handlePay}
            disabled={paying}
          >
            <Text style={styles.primaryBtnText}>{paying ? 'Preparing checkout…' : payLabel}</Text>
          </Pressable>

          <Pressable style={styles.secondaryBtn} onPress={handleSkip}>
            <Text style={styles.secondaryBtnText}>No thanks, continue without shakes</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor="rgba(135,163,191,0.55)"
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 36,
    gap: 16,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  backText: {
    color: C.blue,
    fontSize: 18,
    fontWeight: '700',
  },
  eyebrow: {
    color: C.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.2,
  },
  headline: {
    color: C.text,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 38,
  },
  subhead: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 26,
  },
  summaryCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.borderStrong,
    overflow: 'hidden',
    marginTop: 4,
  },
  summaryGlow: {
    position: 'absolute',
    top: -20,
    right: -10,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: C.goldSoft,
  },
  summaryImage: {
    width: '100%',
    height: 160,
  },
  summaryContent: {
    padding: 18,
    gap: 6,
  },
  summaryEyebrow: {
    color: C.gold,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  summaryTitle: {
    color: C.text,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  summaryFlavor: {
    color: C.blue,
    fontSize: 16,
    fontWeight: '800',
  },
  summaryFlavorHint: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 21,
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
    lineHeight: 22,
  },
  formCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
  },
  sectionLabel: {
    color: '#7F9AB4',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.2,
    marginBottom: 12,
  },
  fieldWrap: {
    marginBottom: 14,
  },
  fieldLabel: {
    color: C.whiteSoft,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  half: {
    flex: 1,
  },
  primaryBtn: {
    backgroundColor: C.blue,
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
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
