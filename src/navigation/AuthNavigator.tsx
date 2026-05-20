import React from 'react';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '@/screens/LoginScreen';
import OnboardingScreen from '@/screens/OnboardingScreen';
import SignUpScreen from '@/screens/SignUpScreen';
import GoalSetupWrapper from '@/screens/GoalSetupWrapper';
import CoachAccessScreen from '@/screens/CoachAccessScreen';
import { colors } from '@/theme';

export type AuthStackParamList = {
  CoachAccess: undefined;
  Login: undefined;
  Onboarding: undefined;
  SignUp: undefined;
  GoalSetup: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Onboarding"
      screenOptions={{
        animation: 'fade',
        contentStyle: {
          backgroundColor: colors.background,
        },
        headerShown: false,
      }}
    >
      <Stack.Screen component={OnboardingScreen} name="Onboarding" />
      <Stack.Screen component={CoachAccessScreen} name="CoachAccess" />
      <Stack.Screen component={SignUpScreen} name="SignUp" />
      <Stack.Screen component={LoginScreen} name="Login" />
      <Stack.Screen
        component={GoalSetupWrapper}
        name="GoalSetup"
        options={{ animation: 'slide_from_right', gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}
