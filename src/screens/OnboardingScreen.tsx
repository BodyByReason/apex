import React from 'react';

import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';

export default function OnboardingScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const handleNavigate = async (route: 'SignUp' | 'Login') => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate(route);
  };

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>{t('onboarding.kicker')}</Text>
          <Text style={styles.logo}>APEX</Text>
          <Text style={styles.subtitle}>
            {t('onboarding.logoSubtitle')}
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => handleNavigate('SignUp')}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>{t('onboarding.getStarted')}</Text>
          </Pressable>

          <Pressable
            onPress={() => handleNavigate('Login')}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryButtonPressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>{t('onboarding.signIn')}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    backgroundColor: colors.background,
  },
  hero: {
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  kicker: {
    color: colors.accent,
    fontFamily: typography.mono.regular,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  logo: {
    color: colors.accent,
    fontFamily: typography.display.regular,
    fontSize: 88,
    lineHeight: 88,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: typography.body.regular,
    fontSize: 18,
    lineHeight: 28,
    maxWidth: 320,
  },
  actions: {
    gap: spacing.md,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
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
  secondaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonPressed: {
    opacity: 0.88,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontFamily: typography.body.medium,
    fontSize: 16,
  },
});
