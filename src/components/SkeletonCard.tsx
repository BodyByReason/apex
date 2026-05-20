/**
 * SkeletonCard — reusable animated loading placeholder.
 *
 * Usage:
 *   <SkeletonCard height={80} />                    // single block
 *   <SkeletonCard rows={[80, 20, 20]} gap={8} />    // multi-row layout
 *   <SkeletonCard height={120} borderRadius={20} />
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { apexColors as C } from '@/theme/colors';

interface SkeletonCardProps {
  /** Single block height (used when `rows` is not provided) */
  height?: number;
  /** Width — defaults to '100%' */
  width?: number | string;
  borderRadius?: number;
  style?: ViewStyle;
  /** Multi-row mode: array of row heights rendered with a gap between them */
  rows?: number[];
  /** Gap between rows when using multi-row mode */
  gap?: number;
}

function ShimmerBlock({
  height,
  width = '100%',
  borderRadius = 12,
  style,
  pulseAnim,
}: {
  height: number;
  width?: number | string;
  borderRadius?: number;
  style?: ViewStyle;
  pulseAnim: Animated.Value;
}) {
  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.7],
  });

  return (
    <Animated.View
      style={[
        {
          height,
          width: width as any,
          borderRadius,
          backgroundColor: C.border,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCard({
  height = 80,
  width,
  borderRadius = 12,
  style,
  rows,
  gap = 8,
}: SkeletonCardProps) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  if (rows && rows.length > 0) {
    return (
      <View style={[styles.multiContainer, style]}>
        {rows.map((rowHeight, i) => (
          <ShimmerBlock
            key={i}
            height={rowHeight}
            width={i === rows.length - 1 ? '60%' : '100%'}
            borderRadius={borderRadius}
            pulseAnim={pulseAnim}
            style={i < rows.length - 1 ? { marginBottom: gap } : undefined}
          />
        ))}
      </View>
    );
  }

  return (
    <ShimmerBlock
      height={height}
      width={width ?? '100%'}
      borderRadius={borderRadius}
      pulseAnim={pulseAnim}
      style={style}
    />
  );
}

/** Convenience wrapper — renders a card-shaped skeleton with padding */
export function SkeletonCardContainer({
  rows = [20, 14],
  gap = 8,
  style,
}: {
  rows?: number[];
  gap?: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      <SkeletonCard rows={rows} gap={gap} />
    </View>
  );
}

const styles = StyleSheet.create({
  multiContainer: {
    width: '100%',
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 12,
  },
});
