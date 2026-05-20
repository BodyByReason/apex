import React, { useEffect, useState } from 'react';

import * as Haptics from 'expo-haptics';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { setAdminEnabled, verifyCoachAccessPassword } from '@/lib/adminMode';
import { loadCachedProfile, syncProfileToSupabase } from '@/lib/profileSync';
import type { MainStackParamList } from '@/navigation/MainNavigator';
import { apexColors as C } from '@/theme/colors';
import type { UserProfile } from '@/screens/GoalSetupScreen';

function buildCoachProfile(email?: string | null): UserProfile {
  const emailName = email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim() || 'Coach';
  return {
    activePlanId: 'body-recomp-pro',
    age: '',
    displayName: emailName
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    experience: 'advanced',
    gender: 'other',
    goal: 'performance',
    goalWeightLbs: '',
    heightFt: '',
    isCoach: true,
    mealsPerDay: '3',
    username: emailName.toLowerCase().replace(/\s+/g, '') || 'coach',
    weightLbs: '',
  };
}

export default function CoachAccessScreen() {
  const { accent } = useTheme();
  const { session } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) {
      Alert.alert('Sign in required', 'Coach Access is only available after signing in.');
      navigation.goBack();
    }
  }, [navigation, session?.user?.id]);

  const handleUnlock = async () => {
    if (!session?.user?.id || submitting) return;

    if (!verifyCoachAccessPassword(password)) {
      Alert.alert('Access denied', 'That coach password is not correct.');
      return;
    }

    setSubmitting(true);
    try {
      const cachedProfile = await loadCachedProfile().catch(() => null);
      const nextProfile: UserProfile = {
        ...(cachedProfile ?? buildCoachProfile(session.user.email)),
        isCoach: true,
      };

      await syncProfileToSupabase(session.user.id, nextProfile);
      await setAdminEnabled(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
      navigation.replace('CoachMode');
    } catch (error) {
      Alert.alert(
        'Could not unlock coach access',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
    >
      <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={[styles.backBtnText, { color: accent }]}>← Back</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={[styles.eyebrow, { color: accent }]}>COACH TOOLS</Text>
        <Text style={styles.title}>Coach Access</Text>
        <Text style={styles.body}>
          Enter the coach password to access GoLive for the 3-Day Finale, manage clients, and use coaching tools.
        </Text>

        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Enter coach password"
          placeholderTextColor={C.muted}
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => handleUnlock().catch(() => null)}
        />

        <Pressable
          disabled={!password.trim() || submitting}
          onPress={() => handleUnlock().catch(() => null)}
          style={[
            styles.primaryBtn,
            { backgroundColor: accent },
            (!password.trim() || submitting) && styles.primaryBtnDisabled,
          ]}
        >
          <Text style={styles.primaryBtnText}>{submitting ? 'Unlocking…' : 'Unlock Coach Mode'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.black,
    paddingHorizontal: 20,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 18,
    paddingVertical: 8,
  },
  backBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
  },
  card: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 22,
  },
  eyebrow: {
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.4,
  },
  title: {
    color: C.text,
    fontFamily: 'DMSans_700Bold',
    fontSize: 28,
  },
  body: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 22,
  },
  input: {
    backgroundColor: C.surface2,
    borderColor: C.border,
    borderRadius: 16,
    borderWidth: 1,
    color: C.text,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  primaryBtnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: '#050A14',
    fontFamily: 'DMSans_700Bold',
    fontSize: 15,
  },
});
