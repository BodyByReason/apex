import type { PropsWithChildren } from 'react';

import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';

type ScreenTemplateProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  subtitle: string;
}>;

export function ScreenTemplate({
  children,
  eyebrow,
  subtitle,
  title,
}: ScreenTemplateProps) {
  return (
    <SafeAreaView edges={['top', 'right', 'left']} style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.content}>{children}</View>
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
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.accent,
    fontFamily: typography.body.medium,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: typography.display.regular,
    fontSize: 44,
    lineHeight: 44,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: typography.body.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  content: {
    flex: 1,
    gap: spacing.md,
  },
});
