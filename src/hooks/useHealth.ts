import { useCallback, useEffect, useState } from 'react';

import Constants from 'expo-constants';
import { AppState, type AppStateStatus, Platform } from 'react-native';

export type SleepBreakdown = {
  /** Total sleep in hours (all stages) */
  totalHours: number;
  /** REM sleep in minutes */
  remMinutes: number;
  /** Deep (slow-wave) sleep in minutes */
  deepMinutes: number;
  /** Core / light sleep in minutes */
  lightMinutes: number;
};

type HealthState = {
  activeEnergy: number;
  available: boolean;
  loading: boolean;
  steps: number;
  sleep: SleepBreakdown | null;
};

const initialState: HealthState = {
  activeEnergy: 0,
  available: false,
  loading: Platform.OS === 'ios' || Platform.OS === 'android',
  steps: 0,
  sleep: null,
};

// ─── Android: Health Connect ──────────────────────────────────────────────────

/**
 * Request Health Connect Steps read permission from a user interaction (button press).
 * MUST NOT be called from a hook effect — the Activity result contract is only
 * registered after the first user interaction, otherwise the app crashes.
 * Returns true if Steps read permission was granted after the request.
 * Returns false (instead of crashing) if Health Connect is unavailable or the
 * native request fails — caller shows the HC app fallback in that case.
 */
export async function requestAndroidHealthPermission(): Promise<boolean> {
  try {
    const hc = await import('react-native-health-connect');

    // SDK_AVAILABLE = 3. Bail early with a meaningful log if HC isn't ready.
    const sdkStatus = await hc.getSdkStatus();
    if (sdkStatus !== 3) {
      console.warn('[Health] Health Connect SDK not available, status:', sdkStatus);
      return false;
    }

    const isInitialized = await hc.initialize();
    if (!isInitialized) {
      console.warn('[Health] Health Connect initialize() returned false');
      return false;
    }

    const result = await hc.requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
    return result.some(
      (p: { accessType: string; recordType: string }) =>
        p.recordType === 'Steps' && p.accessType === 'read',
    );
  } catch (err) {
    // The native patch in scripts/patch-health-connect-crash.js converts any
    // UninitializedPropertyAccessException (and other native throws) into a
    // Promise rejection so we can catch it here instead of crashing the app.
    console.warn('[Health] requestPermission failed:', err);
    return false;
  }
}

/**
 * Read today's step count from Android Health Connect.
 * Returns 0 if Health Connect is unavailable or permission is denied.
 * Uses dynamic import so the module is never loaded on iOS.
 */
async function getAndroidSteps(): Promise<{ steps: number; available: boolean }> {
  try {
    const hc = await import('react-native-health-connect');

    const isInitialized = await hc.initialize();
    if (!isInitialized) return { steps: 0, available: false };

    // Use getGrantedPermissions instead of requestPermission — calling
    // requestPermission from a hook crashes on Android because the Activity
    // permission contract (registerForActivityResult) may not be initialized yet.
    const granted = await hc.getGrantedPermissions();

    const stepsGranted = granted.some(
      (p: { accessType: string; recordType: string }) =>
        p.recordType === 'Steps' && p.accessType === 'read',
    );

    if (!stepsGranted) {
      // Do NOT call requestPermission here — it crashes if called outside a user
      // interaction because the Activity Result contract isn't registered yet.
      // The "Connect Steps +" button calls requestAndroidHealthPermission() instead.
      return { steps: 0, available: false };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // aggregateRecord deduplicates across all Health Connect data sources
    // (e.g. Samsung Health + native Android pedometer both write Steps records;
    // readRecords + manual sum would double-count them — aggregateRecord does not).
    const result = await hc.aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: {
        operator: 'between',
        startTime: startOfDay.toISOString(),
        endTime: new Date().toISOString(),
      },
    });

    const total = (result as { COUNT_TOTAL?: number }).COUNT_TOTAL ?? 0;

    return { steps: Math.round(total), available: true };
  } catch {
    return { steps: 0, available: false };
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHealth() {
  const [health, setHealth] = useState<HealthState>(initialState);

  const refresh = useCallback(async () => {
    // ── Android ──────────────────────────────────────────────────────────────
    if (Platform.OS === 'android') {
      const { steps, available } = await getAndroidSteps();
      setHealth({ activeEnergy: 0, available, loading: false, steps, sleep: null });
      return;
    }

    // ── iOS ──────────────────────────────────────────────────────────────────
    if (Platform.OS !== 'ios' || Constants.executionEnvironment === 'storeClient') {
      setHealth({ activeEnergy: 0, available: false, loading: false, steps: 0, sleep: null });
      return;
    }

    try {
      const healthkit = await import('@kingstinct/react-native-healthkit');
      const isAvailable = await healthkit.isHealthDataAvailableAsync();

      if (!isAvailable) {
        setHealth({ activeEnergy: 0, available: false, loading: false, steps: 0, sleep: null });
        return;
      }

      await healthkit.requestAuthorization({
        toRead: [
          'HKQuantityTypeIdentifierStepCount',
          'HKQuantityTypeIdentifierActiveEnergyBurned',
          'HKCategoryTypeIdentifierSleepAnalysis',
        ],
      });

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // For sleep we look at the past 24 hrs so we catch last night's sleep
      const sleepStart = new Date();
      sleepStart.setHours(sleepStart.getHours() - 24);

      const [stepsStats, activeEnergyStats, sleepSamples] = await Promise.all([
        healthkit.queryStatisticsForQuantity(
          'HKQuantityTypeIdentifierStepCount',
          ['cumulativeSum'],
          {
            filter: { date: { endDate: new Date(), startDate: startOfDay } },
            unit: 'count',
          },
        ),
        healthkit.queryStatisticsForQuantity(
          'HKQuantityTypeIdentifierActiveEnergyBurned',
          ['cumulativeSum'],
          {
            filter: { date: { endDate: new Date(), startDate: startOfDay } },
            unit: 'kcal',
          },
        ),
        // queryCategorySamples returns sleep stage samples
        healthkit.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
          filter: { date: { startDate: sleepStart, endDate: new Date() } },
          limit: 200,
        }).catch(() => [] as unknown[]),
      ]);

      // Sleep stage values (HKCategoryValueSleepAnalysis):
      //  0 = InBed, 1 = Asleep (generic), 2 = Awake
      //  3 = Asleep-Core (iOS 16+), 4 = Asleep-Deep, 5 = Asleep-REM
      let remMinutes = 0;
      let deepMinutes = 0;
      let lightMinutes = 0;
      let totalMinutes = 0;

      if (Array.isArray(sleepSamples)) {
        for (const s of sleepSamples as Array<{ value: number; startDate: string; endDate: string }>) {
          const durationMin =
            (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60_000;
          if (durationMin <= 0) continue;

          switch (s.value) {
            case 5: remMinutes += durationMin; totalMinutes += durationMin; break;
            case 4: deepMinutes += durationMin; totalMinutes += durationMin; break;
            case 3: lightMinutes += durationMin; totalMinutes += durationMin; break;
            case 1: lightMinutes += durationMin; totalMinutes += durationMin; break; // generic asleep
            default: break;
          }
        }
      }

      const sleep: SleepBreakdown | null = totalMinutes > 0
        ? {
            totalHours: Math.round((totalMinutes / 60) * 10) / 10,
            remMinutes: Math.round(remMinutes),
            deepMinutes: Math.round(deepMinutes),
            lightMinutes: Math.round(lightMinutes),
          }
        : null;

      setHealth({
        activeEnergy: Math.round(activeEnergyStats.sumQuantity?.quantity ?? 0),
        available: true,
        loading: false,
        steps: Math.round(stepsStats.sumQuantity?.quantity ?? 0),
        sleep,
      });
    } catch {
      setHealth({ activeEnergy: 0, available: false, loading: false, steps: 0, sleep: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') {
        refresh();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [refresh]);

  return {
    ...health,
    refresh,
  };
}
