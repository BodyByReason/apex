/**
 * Wearable / Health data integration
 *
 * iOS: @kingstinct/react-native-healthkit (uses NitroModules — NOT compatible
 * with Expo Go. Requires a dev build via `expo prebuild` / EAS.)
 *
 * All HealthKit calls use dynamic import() so that importing this module in
 * Expo Go does NOT crash the app — everything gracefully returns false / {}.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type WearableMetrics = {
  heartRateBpm?: number;
  hrv?: number;
  restingHrBpm?: number;
  sleepHours?: number;
  stepsToday?: number;
  activeCaloriesToday?: number;
  readinessScore?: number; // 0-100 derived
};

/**
 * Dynamically load the HealthKit module.
 * Returns null in Expo Go (storeClient), on Android, or on simulator.
 * NitroModules crash hard in Expo Go — we must bail before the import.
 */
async function loadHK() {
  if (Platform.OS !== 'ios' || Constants.executionEnvironment === 'storeClient') {
    return null;
  }
  try {
    return await import('@kingstinct/react-native-healthkit');
  } catch {
    return null;
  }
}

/**
 * Request HealthKit read permissions.
 * Returns false if HealthKit is unavailable (Expo Go, Android, simulator).
 */
export async function requestWearablePermissions(): Promise<boolean> {
  try {
    const HK = await loadHK();
    if (!HK) return false;

    await HK.requestAuthorization({
      toRead: [
        'HKQuantityTypeIdentifierHeartRate',
        'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
        'HKQuantityTypeIdentifierRestingHeartRate',
        'HKQuantityTypeIdentifierActiveEnergyBurned',
        'HKQuantityTypeIdentifierStepCount',
        'HKCategoryTypeIdentifierSleepAnalysis',
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read today's health metrics from HealthKit.
 * Returns {} if HealthKit is unavailable or permissions were denied.
 */
export async function readWearableMetrics(): Promise<WearableMetrics> {
  try {
    const HK = await loadHK();
    if (!HK) return {};

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [hr, hrv, restingHr, steps, activeCal] = await Promise.allSettled([
      HK.getMostRecentQuantitySample('HKQuantityTypeIdentifierHeartRate'),
      HK.getMostRecentQuantitySample(
        'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
      ),
      HK.getMostRecentQuantitySample(
        'HKQuantityTypeIdentifierRestingHeartRate',
      ),
      HK.queryStatisticsForQuantity(
        'HKQuantityTypeIdentifierStepCount',
        ['cumulativeSum'],
        { filter: { date: { startDate: startOfDay, endDate: now } } },
      ),
      HK.queryStatisticsForQuantity(
        'HKQuantityTypeIdentifierActiveEnergyBurned',
        ['cumulativeSum'],
        { filter: { date: { startDate: startOfDay, endDate: now } } },
      ),
    ]);

    const metrics: WearableMetrics = {};

    if (hr.status === 'fulfilled' && hr.value?.quantity != null) {
      metrics.heartRateBpm = Math.round(hr.value.quantity);
    }
    if (hrv.status === 'fulfilled' && hrv.value?.quantity != null) {
      metrics.hrv = Math.round(hrv.value.quantity);
    }
    if (restingHr.status === 'fulfilled' && restingHr.value?.quantity != null) {
      metrics.restingHrBpm = Math.round(restingHr.value.quantity);
    }
    if (
      steps.status === 'fulfilled' &&
      steps.value?.sumQuantity?.quantity != null
    ) {
      metrics.stepsToday = Math.round(steps.value.sumQuantity.quantity);
    }
    if (
      activeCal.status === 'fulfilled' &&
      activeCal.value?.sumQuantity?.quantity != null
    ) {
      metrics.activeCaloriesToday = Math.round(
        activeCal.value.sumQuantity.quantity,
      );
    }

    // Derive a simple readiness score from HRV + resting HR
    if (metrics.hrv !== undefined && metrics.restingHrBpm !== undefined) {
      const hrvScore = Math.min((metrics.hrv / 80) * 50, 50); // 0-50 from HRV
      const hrScore = Math.min((60 / metrics.restingHrBpm) * 50, 50); // 0-50 from resting HR
      metrics.readinessScore = Math.round(hrvScore + hrScore);
    }

    return metrics;
  } catch {
    return {};
  }
}
