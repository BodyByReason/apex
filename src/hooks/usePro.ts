/**
 * usePro
 *
 * Returns whether the current user holds the RevenueCat "pro" entitlement.
 * Handles un-initialized Purchases gracefully — defaults to false so the app
 * still functions in environments where RevenueCat is unavailable (Expo Go /
 * web) without crashing.
 *
 * Admin override: if the developer has enabled "Pro Preview" via the in-app
 * developer tools, `isPro` is forced to true regardless of RevenueCat status.
 *
 * Apex 1-on-1 override (RECONCILED_DECISIONS_V2 §6.3): users running outside
 * of Walk-Water mode are paid 1-on-1 coaching clients by definition. They
 * have already paid for coaching outside the app and should never see Pro
 * upsell language or paywall gating in client-facing surfaces. We therefore
 * force `isPro = true` whenever `walkWaterMode` is disabled.
 */
import { useCallback, useEffect, useState } from 'react';

import { DeviceEventEmitter } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { isProPreview, PRO_PREVIEW_EVENT } from '@/lib/adminMode';
import { loadCachedProfile } from '@/lib/profileSync';
import { isProTrialActive } from '@/lib/proTrial';
import { initializeRevenueCat } from '@/lib/revenuecat';
import { isWalkWaterModeEnabled, WALK_WATER_MODE_EVENT } from '@/lib/walkWaterMode';

export function usePro() {
  const { session } = useAuth();
  const [isPro, setIsPro] = useState(false);
  const [isAdminPro, setIsAdminPro] = useState(false);
  const [isTrialPro, setIsTrialPro] = useState(false);
  // Apex 1-on-1 client (i.e. walkWaterMode=false). Treated as full-access at
  // launch per RECONCILED_DECISIONS_V2 §6.3.
  const [isApexClient, setIsApexClient] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check admin override once on mount
  useEffect(() => {
    isProPreview().then(setIsAdminPro).catch(() => null);
  }, []);

  // Resolve Apex 1-on-1 status from Walk-Water mode flag. False = MainNavigator
  // (paid 1-on-1 coaching client). Live-update if WW mode is toggled.
  useEffect(() => {
    isWalkWaterModeEnabled()
      .then((wwEnabled) => setIsApexClient(!wwEnabled))
      .catch(() => null);
    const sub = DeviceEventEmitter.addListener(WALK_WATER_MODE_EVENT, (enabled: boolean) => {
      setIsApexClient(!enabled);
    });
    return () => sub.remove();
  }, []);

  // Live-update when Pro Preview is toggled anywhere in the app
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(PRO_PREVIEW_EVENT, (enabled: boolean) => {
      setIsAdminPro(enabled);
      if (enabled) {
        setIsPro(true);
        setIsLoading(false);
      }
    });
    return () => sub.remove();
  }, []);

  const refresh = useCallback(async () => {
    // Admin Pro Preview bypasses RevenueCat check
    const adminOverride = await isProPreview();
    setIsAdminPro(adminOverride);
    const cachedProfile = await loadCachedProfile().catch(() => null);
    setIsTrialPro(isProTrialActive(cachedProfile));
    if (adminOverride) {
      setIsPro(true);
      setIsLoading(false);
      return;
    }

    try {
      await initializeRevenueCat(session?.user?.id);
      const Purchases = (await import('react-native-purchases')).default;
      const info = await Purchases.getCustomerInfo();
      setIsPro(!!info.entitlements.active['pro']);
    } catch {
      // RevenueCat unavailable (Expo Go, no key set, etc.) → treat as free
      setIsPro(false);
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    refresh().catch(() => setIsLoading(false));
  }, [refresh]);

  return {
    isPro: isPro || isAdminPro || isTrialPro || isApexClient,
    isAdminPro,
    isTrialPro,
    isApexClient,
    isLoading,
    refresh,
  };
}
