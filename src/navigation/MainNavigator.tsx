import React from 'react';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MainTabNavigator from '@/navigation/MainTabNavigator';
// SerenaProtoScreen (AI vision form review) removed at launch per
// RECONCILED_DECISIONS_V2 §5.3. The 15-second clip-to-coach flow lives in
// FormReviewScreen and is the only form-review path that ships.
import CoachAccessScreen from '@/screens/CoachAccessScreen';
import CoachModeScreen from '@/screens/CoachModeScreen';
import FormReviewScreen from '@/screens/FormReviewScreen';
import LabUploadScreen from '@/screens/LabUploadScreen';
import CoachInboxScreen from '@/screens/CoachInboxScreen';
import LiveCoachScreen from '@/screens/LiveCoachScreen';
import PDFViewerScreen from '@/screens/PDFViewerScreen';
import ProfileScreen from '@/screens/ProfileScreen';
import SuggestionsScreen from '@/screens/SuggestionsScreen';
import UpgradeScreen from '@/screens/UpgradeScreen';
import WalkTrackerScreen from '@/screens/WalkTrackerScreen';
import { apexColors as C } from '@/theme/colors';

export type MainStackParamList = {
  Tabs: undefined;
  CoachAccess: undefined;
  CoachMode: undefined;
  FormReview: { exerciseName: string; hasLiveCoach?: boolean };
  LabUpload: undefined;
  Profile: undefined;
  Suggestions: undefined;
  Upgrade: undefined;
  WalkTracker: undefined;
  LiveCoach: undefined;
  CoachInbox: undefined;
  GoLiveTribe: { sessionId?: string } | undefined;
  TribeLiveViewer: { sessionId: string };
  PDFViewer: { url: string; title: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: C.black },
      }}
    >
      <Stack.Screen name="Tabs" component={MainTabNavigator} />
      <Stack.Screen
        name="CoachAccess"
        component={CoachAccessScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="LabUpload"
        component={LabUploadScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen
        name="CoachMode"
        component={CoachModeScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen
        name="FormReview"
        component={FormReviewScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen name="Suggestions" component={SuggestionsScreen} />
      <Stack.Screen name="Upgrade" component={UpgradeScreen} />
      <Stack.Screen name="WalkTracker" component={WalkTrackerScreen} />
      <Stack.Screen
        name="LiveCoach"
        component={LiveCoachScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="CoachInbox"
        component={CoachInboxScreen}
        options={{ animation: 'slide_from_right', headerShown: false }}
      />
      {/* SerenaProto route removed at launch — see import comment above. */}
      <Stack.Screen
        name="GoLiveTribe"
        getComponent={() => require('../screens/GoLiveTribeScreen').default}
        options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="TribeLiveViewer"
        getComponent={() => require('../screens/TribeLiveViewerScreen').default}
        options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="PDFViewer"
        component={PDFViewerScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal', headerShown: false }}
      />
    </Stack.Navigator>
  );
}
