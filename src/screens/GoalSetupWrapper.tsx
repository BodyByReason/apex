import React from 'react';
import { useNavigation } from '@react-navigation/native';
import GoalSetupScreen from '@/screens/GoalSetupScreen';

// Bridges React Navigation with GoalSetupScreen's onComplete callback.
// After setup completes, navigate to Login so the user can sign in to the main app.
// (Supabase requires email confirmation before session is live, so we redirect to Login.)
export default function GoalSetupWrapper() {
  const navigation = useNavigation<any>();
  return (
    <GoalSetupScreen
      onComplete={() => {
        navigation.navigate('Login');
      }}
    />
  );
}
