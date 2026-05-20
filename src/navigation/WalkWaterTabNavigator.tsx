/**
 * WalkWaterTabNavigator
 *
 * Bottom tab navigator for the Walk & Water Challenge Edition.
 *
 * Pre-upgrade  (5 tabs): Home · Walk · Water · Community · Coach
 * Post-upgrade (6 tabs): Home · Walk · Train · Fuel · Community · Coach
 *
 * Listens for WALK_WATER_UPGRADE_EVENT — when fired the navigator
 * swaps to the 6-tab APEX layout in place, no navigator flip required.
 * The dark navy shell stays identical; Train and Fuel tabs appear,
 * Water tab is replaced by Fuel. Community stays unchanged.
 */

import React, { useEffect, useState } from 'react';
import { DeviceEventEmitter, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import WalkWaterDashboardScreen from '@/screens/WalkWaterDashboardScreen';
import WalkTrackerScreen from '@/screens/WalkTrackerScreen';
import WaterLogScreen from '@/screens/WaterLogScreen';
import WalkWaterCoachScreen from '@/screens/WalkWaterCoachScreen';
import WalkWaterCommunityScreen from '@/screens/WalkWaterCommunityScreen';
import WalkWaterTrainScreen from '@/screens/WalkWaterTrainScreen';
import WalkWaterFuelScreen from '@/screens/WalkWaterFuelScreen';

import {
  isWWUpgraded,
  WALK_WATER_UPGRADE_EVENT,
} from '@/lib/walkWaterMode';

// ─── Theme ────────────────────────────────────────────────────────────────────

const WW = {
  black:  '#050A14',
  tabBar: '#080F1A',
  border: '#1A2E45',
  blue:   '#0EA5E9',
  teal:   '#06B6D4',
  muted:  '#3D5A73',
};

// ─── Tab param lists ──────────────────────────────────────────────────────────

type BaseTabParamList = {
  Home:      undefined;
  Walk:      undefined;
  Water:     undefined;
  Community: undefined;
  Coach:     undefined;
};

type ApexTabParamList = {
  Home:      undefined;
  Walk:      undefined;
  Train:     undefined;
  Fuel:      undefined;
  Community: undefined;
  Coach:     undefined;
};

const BaseTab = createBottomTabNavigator<BaseTabParamList>();
const ApexTab = createBottomTabNavigator<ApexTabParamList>();

// ─── Shared tab bar options ───────────────────────────────────────────────────

function tabBarOptions(insets: ReturnType<typeof useSafeAreaInsets>) {
  return {
    headerShown: false,
    tabBarStyle: {
      backgroundColor: WW.tabBar,
      borderTopColor:  WW.border,
      borderTopWidth:  1,
      height:          68 + insets.bottom,
      paddingBottom:   Math.max(insets.bottom, 8),
      paddingTop:      6,
    },
    tabBarLabelStyle: {
      fontSize:      9,
      marginTop:     4,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.3,
      fontWeight:    '700' as const,
    },
    tabBarActiveTintColor:   WW.blue,
    tabBarInactiveTintColor: WW.muted,
  };
}

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <View
      style={{
        alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, borderRadius: 12,
        shadowColor:   focused ? WW.blue : 'transparent',
        shadowOffset:  { width: 0, height: 0 },
        shadowOpacity: focused ? 0.55 : 0,
        shadowRadius:  focused ? 6 : 0,
      }}
    >
      <Text style={{ fontSize: focused ? 20 : 18, opacity: focused ? 1 : 0.55 }}>
        {emoji}
      </Text>
    </View>
  );
}

// ─── Pre-upgrade navigator (5 tabs) ──────────────────────────────────────────

function BaseWWNavigator() {
  const insets = useSafeAreaInsets();
  const opts = tabBarOptions(insets);

  return (
    <BaseTab.Navigator screenOptions={opts}>
      <BaseTab.Screen name="Home"      component={WalkWaterDashboardScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="⚡" focused={focused} /> }} />
      <BaseTab.Screen name="Walk"      component={WalkTrackerScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🚶" focused={focused} /> }} />
      <BaseTab.Screen name="Water"     component={WaterLogScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="💧" focused={focused} /> }} />
      <BaseTab.Screen name="Community" component={WalkWaterCommunityScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🔥" focused={focused} /> }} />
      <BaseTab.Screen name="Coach"     component={WalkWaterCoachScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🤖" focused={focused} /> }} />
    </BaseTab.Navigator>
  );
}

// ─── Post-upgrade navigator (6 tabs) ─────────────────────────────────────────

function ApexWWNavigator() {
  const insets = useSafeAreaInsets();
  const opts = tabBarOptions(insets);

  return (
    <ApexTab.Navigator screenOptions={opts}>
      <ApexTab.Screen name="Home"  component={WalkWaterDashboardScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="⚡" focused={focused} /> }} />
      <ApexTab.Screen name="Walk"  component={WalkTrackerScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🚶" focused={focused} /> }} />
      <ApexTab.Screen name="Train" component={WalkWaterTrainScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="💪" focused={focused} /> }} />
      <ApexTab.Screen name="Fuel"  component={WalkWaterFuelScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🥗" focused={focused} /> }} />
      <ApexTab.Screen name="Community" component={WalkWaterCommunityScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🔥" focused={focused} /> }} />
      <ApexTab.Screen name="Coach" component={WalkWaterCoachScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="🤖" focused={focused} /> }} />
    </ApexTab.Navigator>
  );
}

// ─── WalkWaterTabNavigator ────────────────────────────────────────────────────

export default function WalkWaterTabNavigator() {
  const [upgraded, setUpgraded] = useState(false);

  useEffect(() => {
    isWWUpgraded().then(setUpgraded).catch(() => null);
    const sub = DeviceEventEmitter.addListener(
      WALK_WATER_UPGRADE_EVENT,
      () => setUpgraded(true),
    );
    return () => sub.remove();
  }, []);

  return upgraded ? <ApexWWNavigator /> : <BaseWWNavigator />;
}
