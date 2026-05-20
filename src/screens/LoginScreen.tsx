import React, { useState } from 'react';

import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
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
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/theme';

type Mode = 'login' | 'reset' | 'reset-sent';

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { signIn } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<Mode>('login');
  const [showPassword, setShowPassword] = useState(false);

  React.useEffect(() => {
    const prefilledEmail = route.params?.email;
    if (typeof prefilledEmail === 'string' && prefilledEmail.trim()) {
      setEmail(prefilledEmail.trim());
    }
  }, [route.params?.email]);

  const handleSignIn = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    const error = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      Alert.alert(t('auth.signInFailed'), error);
    }
  };

  const handleResetPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert('Email required', 'Please enter your email address.');
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      // Deep-link back into the app after clicking the email link.
      // Configure this redirect URL in your Supabase project's Auth settings.
      redirectTo: 'apex://auth/reset-password',
    });
    setSubmitting(false);
    if (error) {
      Alert.alert('Reset failed', error.message);
    } else {
      setMode('reset-sent');
    }
  };

  // ── Reset-sent confirmation ──────────────────────────────────────────────────
  if (mode === 'reset-sent') {
    return (
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Check your inbox</Text>
            <Text style={styles.subtitle}>
              We sent a password reset link to{'\n'}
              <Text style={{ color: colors.accent }}>{email.trim()}</Text>
              {'\n\n'}Click the link in that email to set a new password. Check your spam folder if you don't see it.
            </Text>
          </View>
          <View style={styles.form}>
            <Pressable
              onPress={() => { setMode('login'); setEmail(''); }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            >
              <Text style={styles.primaryButtonText}>Back to Sign In</Text>
            </Pressable>
          </View>
        </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Forgot-password form ─────────────────────────────────────────────────────
  if (mode === 'reset') {
    return (
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Reset password</Text>
            <Text style={styles.subtitle}>
              Enter your email and we'll send you a link to set a new password.
            </Text>
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
              autoFocus
            />
            <Pressable
              disabled={submitting}
              onPress={handleResetPassword}
              style={({ pressed }) => [
                styles.primaryButton,
                (pressed || submitting) && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {submitting ? 'Sending…' : 'Send Reset Link'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setMode('login')}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>← Back to Sign In</Text>
            </Pressable>
          </View>
        </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Standard login form ──────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('auth.welcomeBack')}</Text>
          <Text style={styles.subtitle}>{t('auth.loginSubtitle')}</Text>
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
          <View>
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
              onPress={() => setMode('reset')}
              style={styles.forgotBtn}
              hitSlop={8}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          </View>
          <Pressable
            disabled={submitting}
            onPress={handleSignIn}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || submitting) && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {submitting ? t('auth.signingIn') : t('auth.signIn')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('SignUp')}
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>{t('auth.needAccount')}</Text>
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
  forgotBtn: {
    alignSelf: 'flex-end',
    marginTop: 6,
    paddingVertical: 2,
  },
  forgotText: {
    color: colors.textSecondary,
    fontFamily: typography.body.medium,
    fontSize: 13,
  },
});
