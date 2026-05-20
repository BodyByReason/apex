// Pulsing "SERENA IS WATCHING" badge. Shown only while in vision mode.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const PULSE_MS = 900;

export function VisionIndicator() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });

  return (
    <View style={styles.wrap} accessibilityLabel="Serena is watching via camera">
      <Animated.View
        style={[styles.dot, { transform: [{ scale: dotScale }], opacity: dotOpacity }]}
      />
      <Text style={styles.label}>SERENA IS WATCHING</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3DDC84',
    marginRight: 8,
  },
  label: {
    color: '#fff',
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
});
