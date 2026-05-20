import React, { useState } from 'react';

import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { PRO_ANNUAL_FALLBACK_LABEL, PRO_MONTHLY_LABEL, PRO_TRIAL_DAYS } from '@/lib/subscription';
import { colors, spacing, typography } from '@/theme';

export default function SignUpScreen() {
  const navigation = useNavigation<any>();
  const { resendVerificationEmail: resendVerificationEmailFromAuth, signUp } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();

  const handleResendVerificationEmail = async (targetEmail?: string) => {
    const safeEmail = (targetEmail ?? normalizedEmail).trim().toLowerCase();
    if (!safeEmail) {
      Alert.alert('Email required', 'Enter your email so we know where to resend the verification link.');
      return;
    }

    setResending(true);
    try {
      const error = await resendVerificationEmailFromAuth(safeEmail);
      if (error) {
        Alert.alert('Could not resend email', error);
        return;
      }

      setPendingVerificationEmail(safeEmail);
      Alert.alert('Verification sent', 'We sent another verification email. Check inbox, spam, and promotions, then tap the link to come straight back into APEX.');
    } finally {
      setResending(false);
    }
  };

  const handleSignUp = async () => {
    if (!normalizedEmail) {
      Alert.alert('Email required', 'Please enter your email address.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Password too short', 'Password must be at least 6 characters.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);

    const result = await signUp(normalizedEmail, password);

    if (result.error) {
      setSubmitting(false);
      const lowerError = result.error.toLowerCase();
      const looksLikeExistingAccount =
        lowerError.includes('already registered') ||
        lowerError.includes('already exists') ||
        lowerError.includes('user already') ||
        lowerError.includes('email already');

      if (looksLikeExistingAccount) {
        setPendingVerificationEmail(normalizedEmail);
        Alert.alert(
          'This email may already have an account',
          'If this account is already verified, sign in. If it is still waiting on verification, we can resend the email right now.',
          [
            { text: 'Sign In', onPress: () => navigation.navigate('Login', { email: normalizedEmail }) },
            { text: 'Resend Email', onPress: () => { handleResendVerificationEmail(normalizedEmail).catch(() => null); } },
          ],
        );
        return;
      }

      Alert.alert(t('auth.signUpFailed'), result.error);
      return;
    }

    setSubmitting(false);
    if (result.hasSession) {
      Alert.alert(
        'You’re in',
        'Your account is live. We’ll build your plan next, and you can handle email verification later inside the app if needed.',
      );
      return;
    }

    setPendingVerificationEmail(normalizedEmail);
    Alert.alert(
      'Check your email',
      'We created the account, but this project is still asking for email verification before the session goes live. Tap the link in your email and the app should sign you in automatically.',
      [
        {
          text: 'Resend Email',
          onPress: () => {
            handleResendVerificationEmail(normalizedEmail).catch(() => null);
          },
        },
        { text: 'Go to Sign In', onPress: () => navigation.navigate('Login', { email: normalizedEmail }) },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('auth.createAccount')}</Text>
              <Text style={styles.subtitle}>Create your account and jump into your {PRO_TRIAL_DAYS}-day Pro trial while APEX builds your plan.</Text>
              <View style={styles.fastStartCard}>
                <Text style={styles.fastStartEyebrow}>FAST START</Text>
                <Text style={styles.fastStartTitle}>Takes about 60 seconds to get in.</Text>
                <Text style={styles.fastStartBody}>
                  We get your login done first. Then we only ask for the details your coach needs to build workouts, nutrition, and your starting plan.
                </Text>
              </View>
              <View style={styles.trialBullets}>
                <Text style={styles.trialBullet}>• {PRO_TRIAL_DAYS}-day Pro trial starts as soon as your account session is live</Text>
                <Text style={styles.trialBullet}>• AI Coach, meal plans, premium programs, and live coaching previews</Text>
                <Text style={styles.trialBullet}>• Then {PRO_MONTHLY_LABEL}, with {PRO_ANNUAL_FALLBACK_LABEL}</Text>
                <Text style={styles.trialBullet}>• We only ask for the details needed to build your plan after signup</Text>
              </View>
            </View>

            <View style={styles.form}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder={t('auth.email')}
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                value={email}
              />

              {/* Password field with show/hide toggle */}
              <View style={styles.passwordRow}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="off"
                  onChangeText={setPassword}
                  placeholder={t('auth.password')}
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry={!showPassword}
                  style={[styles.input, styles.passwordInput]}
                value={password}
              />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eyeBtn}
                  hitSlop={8}
                >
                  <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
                </Pressable>
              </View>

              <Pressable
                disabled={submitting}
                onPress={handleSignUp}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || submitting) && styles.primaryButtonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {submitting ? t('auth.creatingAccount') : 'Create Account'}
                </Text>
              </Pressable>

              {pendingVerificationEmail ? (
                <View style={styles.verificationCard}>
                  <Text style={styles.verificationEyebrow}>EMAIL CHECK</Text>
                  <Text style={styles.verificationTitle}>We’re waiting on verification for {pendingVerificationEmail}</Text>
                  <Text style={styles.verificationBody}>
                    If you already created this account, the fastest path is either to resend the verification email or go straight to sign in.
                  </Text>
                  <View style={styles.verificationButtons}>
                    <Pressable
                      style={[styles.verificationSecondaryButton, resending ? styles.verificationButtonDisabled : null]}
                      disabled={resending}
                      onPress={() => handleResendVerificationEmail(pendingVerificationEmail).catch(() => null)}
                    >
                      <Text style={styles.verificationSecondaryText}>{resending ? 'Sending…' : 'Resend Email'}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.verificationPrimaryButton}
                      onPress={() => navigation.navigate('Login', { email: pendingVerificationEmail })}
                    >
                      <Text style={styles.verificationPrimaryText}>Sign In Instead</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <Pressable
                onPress={() => navigation.navigate('Login')}
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>{t('auth.alreadyHaveAccount')}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    backgroundColor: colors.background,
    gap: spacing.xl,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: typography.display.regular,
    fontSize: 52,
    lineHeight: 52,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: typography.body.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  fastStartCard: {
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  fastStartEyebrow: {
    color: colors.accent,
    fontFamily: typography.body.medium,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  fastStartTitle: {
    color: colors.textPrimary,
    fontFamily: typography.body.medium,
    fontSize: 15,
    lineHeight: 20,
  },
  fastStartBody: {
    color: colors.textSecondary,
    fontFamily: typography.body.regular,
    fontSize: 13,
    lineHeight: 20,
  },
  trialBullets: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  trialBullet: {
    color: colors.textSecondary,
    fontFamily: typography.body.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  form: {
    gap: spacing.md,
  },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: typography.body.regular,
    fontSize: 16,
    paddingHorizontal: spacing.lg,
  },
  passwordRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 52,
  },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeIcon: {
    fontSize: 18,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.accent,
  },
  primaryButtonPressed: {
    opacity: 0.88,
  },
  primaryButtonText: {
    color: colors.background,
    fontFamily: typography.body.medium,
    fontSize: 16,
  },
  verificationCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  verificationEyebrow: {
    color: colors.accent,
    fontFamily: typography.body.medium,
    fontSize: 11,
    letterSpacing: 1.1,
  },
  verificationTitle: {
    color: colors.textPrimary,
    fontFamily: typography.body.medium,
    fontSize: 15,
    lineHeight: 21,
  },
  verificationBody: {
    color: colors.textSecondary,
    fontFamily: typography.body.regular,
    fontSize: 13,
    lineHeight: 20,
  },
  verificationButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  verificationPrimaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  verificationPrimaryText: {
    color: colors.background,
    fontFamily: typography.body.medium,
    fontSize: 14,
  },
  verificationSecondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  verificationSecondaryText: {
    color: colors.textPrimary,
    fontFamily: typography.body.medium,
    fontSize: 14,
  },
  verificationButtonDisabled: {
    opacity: 0.65,
  },
  linkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    color: colors.accent,
    fontFamily: typography.body.medium,
    fontSize: 14,
  },
});
