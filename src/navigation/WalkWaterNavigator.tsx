/**
 * WalkWaterNavigator
 *
 * Root navigation for the Walk & Water Challenge Edition.
 * When Walk & Water mode is enabled and the user is not yet signed up,
 * shows WalkWaterQuizScreen. After sign-up, shows WalkWaterTabNavigator.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import WalkWaterQuizScreen from '@/screens/WalkWaterQuizScreen';
import WaterLogScreen from '@/screens/WaterLogScreen';
import ChallengeCompleteScreen from '@/screens/ChallengeCompleteScreen';
import ApexUnlockScreen from '@/screens/ApexUnlockScreen';
import WalkWaterTabNavigator from '@/navigation/WalkWaterTabNavigator';
import CoachDMScreen from '@/screens/CoachDMScreen';
import WalkWaterFinaleScreen from '@/screens/WalkWaterFinaleScreen';
import TribeLiveViewerScreen from '@/screens/TribeLiveViewerScreen';
import CoachModeScreen from '@/screens/CoachModeScreen';
import GoLiveTribeScreen from '@/screens/GoLiveTribeScreen';
import CoachInboxScreen from '@/screens/CoachInboxScreen';
import CoachAccessScreen from '@/screens/CoachAccessScreen';
import PDFViewerScreen from '@/screens/PDFViewerScreen';
import ShakeUpsellScreen from '@/screens/ShakeUpsellScreen';
import ShakeCheckoutScreen from '@/screens/ShakeCheckoutScreen';
import ShakeOrderSuccessScreen from '@/screens/ShakeOrderSuccessScreen';
import { getWalkWaterPlan } from '@/lib/walkWaterMode';

export type WalkWaterStackParamList = {
  // `mode: 'requiz'` is set when entering the quiz from the "Don't Stop Now"
  // banner — already-signed-in user, gender skipped, all durations unlocked,
  // no second auth gate. See RECONCILED_DECISIONS_V2 §2.2 / §4.3.
  // `mode: 'upgrade'` reuses the shorter quiz after the Day 4 unlock screen
  // and returns the user to upgraded WW tabs with Train/Fuel visible.
  // `mode: 'signin'` is used after sign-out for returning users — skips the
  // quiz and shows only the login screen so they can get back in without
  // re-answering questions they already answered.
  WalkWaterQuiz:     { mode?: 'requiz' | 'upgrade' | 'signin' } | undefined;
  WalkWaterTabs:     undefined;
  Water:             undefined;
  Walk:              undefined;
  Coach:             undefined;
  ChallengeComplete: undefined;
  ApexUnlock:        undefined;
  CoachDM:           { reschedule?: boolean; brand?: 'ww' };
  CoachAccess:       undefined;
  PDFViewer:         { url: string; title: string };
  Finale:            { devPhase?: 'pre' | 'live' | 'post' } | undefined;
  TribeLiveViewer:   { sessionId: string };
  CoachMode:         undefined;
  GoLiveTribe:       { sessionId?: string } | undefined;
  CoachInbox:        undefined;
  ShakeUpsell:       undefined;
  ShakeCheckout:     { flavor: 'vanilla' | 'chocolate' };
  ShakeOrderSuccess: { flavor: 'vanilla' | 'chocolate'; paid?: boolean };
};

const Stack = createNativeStackNavigator<WalkWaterStackParamList>();

type InitialRoute =
  | { name: 'WalkWaterQuiz'; params?: { mode?: 'signin' | 'requiz' | 'upgrade' } }
  | { name: 'WalkWaterTabs'; params?: undefined };

export default function WalkWaterNavigator({ forceQuiz = false }: { forceQuiz?: boolean }) {
  // forceQuiz=true (post sign-out): set synchronously so the navigator mounts
  // immediately on the login screen — no async blank flash.
  // forceQuiz=false (normal launch): start null and wait for the plan check so
  // initialRouteName is correct when the navigator first mounts.
  const [initialRoute, setInitialRoute] = React.useState<InitialRoute | null>(
    forceQuiz ? { name: 'WalkWaterQuiz', params: { mode: 'signin' } } : null,
  );

  React.useEffect(() => {
    if (forceQuiz) return;
    getWalkWaterPlan()
      .then((plan) => setInitialRoute(plan ? { name: 'WalkWaterTabs' } : { name: 'WalkWaterQuiz' }))
      .catch(() => setInitialRoute({ name: 'WalkWaterQuiz' }));
  }, [forceQuiz]);

  if (!initialRoute) return null;

  return (
    <Stack.Navigator
      initialRouteName={initialRoute.name}
      screenOptions={{
        animation: 'fade',
        contentStyle: { backgroundColor: '#050A14' },
        headerShown: false,
      }}
    >
      <Stack.Screen
        name="WalkWaterQuiz"
        component={WalkWaterQuizScreen}
        initialParams={initialRoute.name === 'WalkWaterQuiz' ? initialRoute.params : undefined}
      />
      <Stack.Screen name="WalkWaterTabs" component={WalkWaterTabNavigator} />
      <Stack.Screen name="Water" component={WaterLogScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="ChallengeComplete" component={ChallengeCompleteScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="ApexUnlock" component={ApexUnlockScreen} options={{ animation: 'fade', gestureEnabled: false }} />
      <Stack.Screen name="CoachDM"         component={CoachDMScreen}          options={{ animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="CoachAccess"     component={CoachAccessScreen}      options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal', headerShown: false }} />
      <Stack.Screen name="Finale"          component={WalkWaterFinaleScreen}  options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="TribeLiveViewer" component={TribeLiveViewerScreen}  options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="CoachMode"       component={CoachModeScreen}        options={{ animation: 'slide_from_right', gestureEnabled: false }} />
      <Stack.Screen name="GoLiveTribe"    component={GoLiveTribeScreen}      options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="CoachInbox"      component={CoachInboxScreen}       options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="PDFViewer"       component={PDFViewerScreen}        options={{ animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="ShakeUpsell"     component={ShakeUpsellScreen}      options={{ animation: 'slide_from_right', gestureEnabled: false }} />
      <Stack.Screen name="ShakeCheckout"   component={ShakeCheckoutScreen}    options={{ animation: 'slide_from_right', gestureEnabled: false }} />
      <Stack.Screen name="ShakeOrderSuccess" component={ShakeOrderSuccessScreen} options={{ animation: 'fade', gestureEnabled: false }} />
    </Stack.Navigator>
  );
}
