import React, { useEffect } from 'react';

import { useTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Image, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DashboardScreen from '@/screens/DashboardScreen';

// ConversationProvider is required by useConversation (ElevenLabs) which is
// called inside TrainScreen via useWorkoutRealtimeAudio → useWorkoutElevenLabsCoach.
function TrainTab() {
  const ConversationProvider = React.useMemo(() => {
    try {
      return require('@elevenlabs/react-native').ConversationProvider as React.ComponentType<{
        children: React.ReactNode;
      }>;
    } catch {
      return React.Fragment;
    }
  }, []);

  const TrainScreen = React.useMemo(
    () => require('../screens/TrainScreen').default as React.ComponentType,
    [],
  );

  return (
    <ConversationProvider>
      <TrainScreen />
    </ConversationProvider>
  );
}
import FuelScreen from '@/screens/FuelScreen';
import TribeScreen from '@/screens/TribeScreen';
import CoachScreen from '@/screens/CoachScreen';
import PlansScreen from '@/screens/PlansScreen';
import { apexColors } from '@/theme/colors';
import { typography } from '@/theme';
import { getSelectedCoachVoice, type CoachVoiceOption } from '@/lib/coachVoice';

type MainTabParamList = {
  Dashboard: undefined;
  Train: undefined;
  Fuel: undefined;
  Tribe: undefined;
  Coach: undefined;
  Plans: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<Exclude<keyof MainTabParamList, 'Coach'>, string> = {
  Dashboard: '⚡',
  Train: '🏋️',
  Fuel: '🥗',
  Tribe: '🔥',
  Plans: '📋',
};

export default function MainTabNavigator() {
  const { colors: navigationColors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [activeCoachVoice, setActiveCoachVoice] = React.useState<CoachVoiceOption | null>(null);

  useEffect(() => {
    getSelectedCoachVoice().then(setActiveCoachVoice).catch(() => null);
  }, []);

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: apexColors.tabBar,
            borderTopColor: apexColors.border,
            borderTopWidth: 1,
            height: 68 + insets.bottom,
            paddingBottom: Math.max(insets.bottom, 8),
            paddingTop: 6,
          },
          tabBarLabelStyle: {
            fontFamily: typography.mono.regular,
            fontSize: 9,
            marginTop: 4,
            paddingBottom: 0,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
          },
          tabBarActiveTintColor: navigationColors.primary,
          tabBarInactiveTintColor: apexColors.muted,
          tabBarItemStyle: {
            paddingVertical: 1,
          },
          tabBarIcon: ({ color, focused, size }) => {
            return (
              <View
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 12,
                  marginTop: 0,
                  shadowColor: focused ? navigationColors.primary : 'transparent',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: focused ? 0.6 : 0,
                  shadowRadius: focused ? 6 : 0,
                  elevation: focused ? 4 : 0,
                }}
              >
                <Text
                  style={{
                    color,
                    fontSize: size + 2,
                  lineHeight: size + 4,
                  textAlignVertical: 'center',
                }}
              >
                  {route.name === 'Coach' ? '' : TAB_ICONS[route.name as Exclude<keyof MainTabParamList, 'Coach'>]}
                </Text>
                {route.name === 'Coach' && activeCoachVoice?.avatar ? (
                  <View
                    style={{
                      width: size + 6,
                      height: size + 6,
                      borderRadius: (size + 6) / 2,
                      overflow: 'hidden',
                      transform: [{ translateY: -16 }],
                    }}
                  >
                    <Image
                      source={activeCoachVoice.avatar}
                      resizeMode="cover"
                      style={{
                        width: '100%',
                        height: '100%',
                      }}
                    />
                  </View>
                ) : null}
              </View>
            );
          },
        })}
      >
        <Tab.Screen component={DashboardScreen} name="Dashboard" options={{ tabBarLabel: t('tabs.dashboard') }} />
        <Tab.Screen component={TrainTab} name="Train" options={{ tabBarLabel: t('tabs.train') }} />
        <Tab.Screen component={FuelScreen} name="Fuel" options={{ tabBarLabel: t('tabs.fuel') }} />
        <Tab.Screen component={TribeScreen} name="Tribe" options={{ tabBarLabel: t('tabs.tribe') }} />
        <Tab.Screen component={CoachScreen} name="Coach" options={{ tabBarLabel: t('tabs.coach') }} />
        <Tab.Screen component={PlansScreen} name="Plans" options={{ tabBarLabel: t('tabs.plans') }} />
      </Tab.Navigator>

    </>
  );
}
