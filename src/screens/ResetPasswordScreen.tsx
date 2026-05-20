import React, { useState } from 'react';

import * as Haptics from 'expo-haptics';
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
import { colors, spacing, typography } from '@/theme';

export default function ResetPasswordScreen() {
  const { completePasswordReset, dismissPasswordReset } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (password.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Make sure both password fields match.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    setSubmitting(true);
    const error = await completePasswordReset(password);
    setSubmitting(false);

    if (error) {
      Alert.alert('Could not update password', error);
      return;
    }

    Alert.alert('Password updated', 'Your password has been reset. You can keep going inside APEX.', [
      { text: 'Continue', onPress: () => dismissPasswordReset() },
    ]);
  };

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <View style={styles.header}>
              <Text style={styles.title}>Set New Password</Text>
              <Text style={styles.subtitle}>
                You&apos;re back inside APEX. Pick a new password to finish the reset.
              </Text>
            </View>

            <View style={styles.form}>
              <TextInput
                secureTextEntry
                placeholder="New password"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                secureTextEntry
                placeholder="Confirm new password"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={handleSave}
                disabled={submitting}
                style={({ pressed }) => [styles.primaryButton, (pressed || submitting) && styles.primaryButtonPressed]}
              >
                <Text style={styles.primaryButtonText}>{submitting ? 'Saving…' : 'Update Password'}</Text>
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
    fontSize: 48,
    lineHeight: 48,
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
});
