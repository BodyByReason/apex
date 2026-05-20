import React, { useState } from 'react';

import * as Haptics from 'expo-haptics';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { apexColors as C } from '@/theme/colors';

type VerifyEmailBannerProps = {
  body?: string;
  title?: string;
};

export function VerifyEmailBanner({
  body = 'Verify your email so password recovery, billing, and coach support stay secure.',
  title = 'Verify your email',
}: VerifyEmailBannerProps) {
  const { isEmailVerified, resendVerificationEmail, userEmail } = useAuth();
  const { accent, accentBorder, accentSoft } = useTheme();
  const [resending, setResending] = useState(false);

  if (!userEmail || isEmailVerified) {
    return null;
  }

  const handleResend = async () => {
    await Haptics.selectionAsync().catch(() => null);
    setResending(true);
    try {
      const error = await resendVerificationEmail(userEmail);
      if (error) {
        Alert.alert('Could not resend email', error);
        return;
      }
      Alert.alert(
        'Verification sent',
        `We sent a verification email to ${userEmail}. Tap the link there and APEX should bring you right back in.`,
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: accent }]}>ACCOUNT SECURITY</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Text style={styles.email}>{userEmail}</Text>
      </View>
      <Pressable
        style={[styles.button, { borderColor: accentBorder, backgroundColor: accentSoft }]}
        onPress={() => handleResend().catch(() => null)}
        disabled={resending}
      >
        <Text style={[styles.buttonText, { color: accent }]}>{resending ? 'Sending…' : 'Resend Email'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    marginBottom: 14,
    padding: 14,
  },
  copy: {
    gap: 4,
  },
  eyebrow: {
    fontFamily: 'SpaceMono-Regular',
    fontSize: 11,
    letterSpacing: 1.4,
  },
  title: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 17,
  },
  body: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  email: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    marginTop: 2,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
  },
});
