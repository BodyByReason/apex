// Big rep counter overlaid on the camera in vision mode. Bounces on each rep.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

type Props = { count: number };

export function RepCounter({ count }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (count <= 0) return;
    Animated.sequence([
      Animated.spring(scale, {
        toValue: 1.18,
        useNativeDriver: true,
        speed: 30,
        bounciness: 14,
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 18,
        bounciness: 8,
      }),
    ]).start();
  }, [count, scale]);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Animated.Text style={[styles.number, { transform: [{ scale }] }]}>
        {count}
      </Animated.Text>
      <Text style={styles.label}>REPS</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    alignItems: 'center',
  },
  number: {
    color: '#3DDC84',
    fontSize: 96,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    lineHeight: 100,
  },
  label: {
    color: '#fff',
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: '700',
    marginTop: -4,
  },
});
