import Constants from 'expo-constants';
import { InteractionManager, Keyboard, Platform, TextInput } from 'react-native';

import { env } from '@/lib/env';
import { PRO_ANNUAL_FALLBACK_LABEL, PRO_MONTHLY_LABEL } from '@/lib/subscription';

let initialized = false;

async function settleKeyboardBeforePaywall() {
  try {
    const focusedInput = TextInput.State.currentlyFocusedInput?.();
    focusedInput?.blur?.();
  } catch {
    // Older RN runtimes can fail to expose the focused input safely.
  }

  Keyboard.dismiss();
  await new Promise((resolve) => setTimeout(resolve, 120));

  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });

  // Notification opens on iOS can briefly rehydrate the previous responder
  // after the first dismiss. One more blur/dismiss keeps the paywall clear.
  try {
    const focusedInput = TextInput.State.currentlyFocusedInput?.();
    focusedInput?.blur?.();
  } catch {
    // Ignore — we have already tried the safest path above.
  }

  Keyboard.dismiss();
  await new Promise((resolve) => setTimeout(resolve, 180));
}

const getApiKey = () => {
  if (Platform.OS === 'ios') {
    return env.revenueCatAppleApiKey;
  }

  if (Platform.OS === 'android') {
    return env.revenueCatGoogleApiKey;
  }

  return '';
};

export async function initializeRevenueCat(appUserId?: string) {
  const apiKey = getApiKey();

  if (!apiKey || initialized) {
    return;
  }

  const Purchases = (await import('react-native-purchases')).default;

  if (Purchases.isConfigured) {
    // Native SDK already configured (e.g. after a Metro hot reload) — sync the JS flag.
    initialized = true;
    return;
  }

  Purchases.configure({
    apiKey,
    appUserID: appUserId,
  });

  initialized = true;
}

export async function hasProEntitlement(appUserId?: string) {
  const apiKey = getApiKey();

  if (!apiKey) {
    return false;
  }

  if (Constants.executionEnvironment === 'storeClient' || Platform.OS === 'web') {
    return false;
  }

  const Purchases = (await import('react-native-purchases')).default;

  if (!initialized) {
    await initializeRevenueCat(appUserId);
  } else if (appUserId) {
    await Purchases.logIn(appUserId).catch(() => null);
  }

  const customerInfo = await Purchases.getCustomerInfo().catch(() => null);
  return Boolean(customerInfo?.entitlements?.active?.pro);
}

export async function maybeShowPaywall(appUserId?: string) {
  const apiKey = getApiKey();

  if (!apiKey) {
    return;
  }

  // RevenueCat paywall presentation needs a native runtime.
  // Skip it in Expo Go / store client and on web-like environments.
  if (Constants.executionEnvironment === 'storeClient' || Platform.OS === 'web') {
    return;
  }

  const Purchases = (await import('react-native-purchases')).default;
  const RevenueCatUI = (await import('react-native-purchases-ui')).default;

  if (!initialized) {
    await initializeRevenueCat(appUserId);
  } else if (appUserId) {
    await Purchases.logIn(appUserId).catch(() => null);
  }

  // If a text input is focused, iOS can keep the keyboard visible over the
  // native RevenueCat modal. Notification launches are especially sensitive,
  // so fully settle the responder + keyboard before presenting.
  await settleKeyboardBeforePaywall();

  await RevenueCatUI.presentPaywallIfNeeded({
    requiredEntitlementIdentifier: 'pro',
  }).catch(() => null);
}

export async function purchasePackageByType(
  planType: 'weekly' | 'monthly',
  appUserId?: string,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = getApiKey();
  if (!apiKey || Constants.executionEnvironment === 'storeClient' || Platform.OS === 'web') {
    return { success: false, error: 'Purchases not available in this environment.' };
  }

  const Purchases = (await import('react-native-purchases')).default;

  if (!initialized) {
    await initializeRevenueCat(appUserId);
  } else if (appUserId) {
    await Purchases.logIn(appUserId).catch(() => null);
  }

  const offerings = await Purchases.getOfferings().catch(() => null);
  const pkg = planType === 'weekly'
    ? (offerings?.current?.weekly ?? offerings?.current?.monthly)
    : (offerings?.current?.monthly ?? offerings?.current?.annual);

  if (!pkg) {
    return { success: false, error: 'No package available for this plan.' };
  }

  try {
    await Purchases.purchasePackage(pkg);
    return { success: true };
  } catch (e: any) {
    if (e?.userCancelled) return { success: false };
    return { success: false, error: e?.message ?? 'Purchase failed.' };
  }
}

const WW_UPGRADE_ENTITLEMENT_ID = 'ww_upgrade';
const WW_CHALLENGE_OFFERING_ID = 'challenge_finisher_3day';
const WW_DEFAULT_OFFERING_ID = 'default_upgrade';

export type WwUpgradeCohort = 'challenge_finisher' | 'default_upgrade';

export type WwUpgradeOfferingInfo = {
  available: boolean;
  priceString: string | null;
  resolvedOfferingId?: string | null;
  packageIdentifier?: string | null;
};

function logRevenueCat(event: string, details?: Record<string, unknown>) {
  console.log('[RevenueCat][WWUpgrade]', event, details ?? {});
}

function getPrimaryPackage(offering: any) {
  // Check standard RevenueCat package types first, then fall back to the first
  // available package so custom-identifier packages aren't silently missed.
  return (
    offering?.monthly ??
    offering?.annual ??
    offering?.weekly ??
    offering?.lifetime ??
    offering?.availablePackages?.[0] ??
    null
  );
}

async function getPurchasesClient(appUserId?: string) {
  const Purchases = (await import('react-native-purchases')).default;

  if (!initialized) {
    await initializeRevenueCat(appUserId);
  } else if (appUserId) {
    await Purchases.logIn(appUserId).catch(() => null);
  }

  return Purchases;
}

export async function getRevenueCatOfferingByIdentifier(
  offeringId: string,
  appUserId?: string,
): Promise<{ availablePackageIds: string[]; offering: any | null }> {
  const apiKey = getApiKey();
  if (!apiKey || Constants.executionEnvironment === 'storeClient' || Platform.OS === 'web') {
    return { availablePackageIds: [], offering: null };
  }

  try {
    const Purchases = await getPurchasesClient(appUserId);
    const offerings = await Purchases.getOfferings().catch(() => null);
    const allOfferings = Object.values(offerings?.all ?? {}) as any[];
    const availablePackageIds = allOfferings.flatMap((offering) =>
      (offering?.availablePackages ?? []).map((pkg: any) => pkg?.identifier).filter(Boolean)
    );
    const offering = offerings?.all?.[offeringId] ?? null;
    return { availablePackageIds, offering };
  } catch (e) {
    console.warn('[RevenueCat] getRevenueCatOfferingByIdentifier error:', e);
    return { availablePackageIds: [], offering: null };
  }
}

function offeringPriorityForWwUpgradeCohort(cohort: WwUpgradeCohort): string[] {
  return cohort === 'challenge_finisher'
    ? [WW_CHALLENGE_OFFERING_ID, WW_DEFAULT_OFFERING_ID]
    : [WW_DEFAULT_OFFERING_ID];
}

async function resolveWwUpgradeOffering(
  appUserId?: string,
  cohort: WwUpgradeCohort = 'default_upgrade',
): Promise<{ availablePackageIds: string[]; offeringId: string | null; pkg: any | null }> {
  const apiKey = getApiKey();
  if (!apiKey || Constants.executionEnvironment === 'storeClient' || Platform.OS === 'web') {
    return { availablePackageIds: [], offeringId: null, pkg: null };
  }

  logRevenueCat('select_cohort', { cohort });

  let availablePackageIds: string[] = [];
  for (const offeringId of offeringPriorityForWwUpgradeCohort(cohort)) {
    const { offering, availablePackageIds: ids } =
      await getRevenueCatOfferingByIdentifier(offeringId, appUserId);
    if (ids.length > 0) availablePackageIds = ids;
    const pkg = getPrimaryPackage(offering);
    logRevenueCat('offering_lookup', {
      availablePackages: ids,
      cohort,
      offeringId,
      resolved: Boolean(pkg),
    });
    if (!pkg) continue;
    return { availablePackageIds: ids, offeringId, pkg };
  }

  // Fall back to the active RevenueCat offering so the real WW purchase flow
  // still works when Apple/RevenueCat are configured but the dashboard uses
  // `current` instead of the legacy WW-specific offering identifiers.
  try {
    const Purchases = await getPurchasesClient(appUserId);
    const offerings = await Purchases.getOfferings().catch(() => null);
    const currentOffering = offerings?.current ?? null;
    const currentPackageIds = (currentOffering?.availablePackages ?? [])
      .map((pkg: any) => pkg?.identifier)
      .filter(Boolean);
    if (currentPackageIds.length > 0) {
      availablePackageIds = currentPackageIds;
    }
    const currentPkg = getPrimaryPackage(currentOffering);
    logRevenueCat('offering_lookup_current', {
      availablePackages: currentPackageIds,
      cohort,
      offeringId: currentOffering?.identifier ?? 'current',
      resolved: Boolean(currentPkg),
    });
    if (currentPkg) {
      return {
        availablePackageIds: currentPackageIds,
        offeringId: currentOffering?.identifier ?? 'current',
        pkg: currentPkg,
      };
    }
  } catch (e) {
    console.warn('[RevenueCat] current offering fallback error:', e);
  }

  return { availablePackageIds, offeringId: null, pkg: null };
}

export async function getWwUpgradeOfferingInfo(
  appUserId?: string,
  cohort: WwUpgradeCohort = 'default_upgrade',
): Promise<WwUpgradeOfferingInfo> {
  const { availablePackageIds, offeringId, pkg } = await resolveWwUpgradeOffering(appUserId, cohort);

  if (!pkg) {
    console.warn(
      `[RevenueCat] WW upgrade offering missing for cohort=${cohort}. Configure challenge_finisher_3day and default_upgrade.`,
    );
    return { available: false, priceString: null, resolvedOfferingId: null, packageIdentifier: null };
  }

  return {
    available: true,
    priceString: pkg.product.priceString ?? null,
    resolvedOfferingId: offeringId,
    packageIdentifier: pkg.identifier ?? availablePackageIds[0] ?? null,
  };
}

export async function purchaseWwUpgrade(
  appUserId?: string,
  cohort: WwUpgradeCohort = 'default_upgrade',
): Promise<{ success: boolean; error?: string; unavailable?: boolean; resolvedOfferingId?: string | null }> {
  const apiKey = getApiKey();
  if (!apiKey || Constants.executionEnvironment === 'storeClient' || Platform.OS === 'web') {
    return { success: false, error: 'Purchases not available in this environment.' };
  }

  const Purchases = await getPurchasesClient(appUserId);
  const { availablePackageIds, offeringId, pkg } = await resolveWwUpgradeOffering(appUserId, cohort);

  if (!pkg || !offeringId) {
    logRevenueCat('offering_missing', {
      availablePackages: availablePackageIds,
      cohort,
      selectedOfferingId: offeringId,
    });
    return {
      success: false,
      unavailable: true,
      error: 'WW upgrade is not available right now. Please try again later.',
    };
  }

  try {
    logRevenueCat('purchase_attempt', {
      availablePackages: availablePackageIds,
      cohort,
      packageIdentifier: pkg.identifier ?? null,
      selectedOfferingId: offeringId,
    });
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const unlocked = Boolean(customerInfo?.entitlements?.active?.[WW_UPGRADE_ENTITLEMENT_ID]);
    logRevenueCat('purchase_success', {
      cohort,
      entitlementUnlocked: unlocked,
      selectedOfferingId: offeringId,
    });
    if (!unlocked) {
      return {
        success: false,
        resolvedOfferingId: offeringId,
        error: `Purchase completed but ${WW_UPGRADE_ENTITLEMENT_ID} entitlement is not active.`,
      };
    }
    return { success: true, resolvedOfferingId: offeringId };
  } catch (e: any) {
    logRevenueCat('purchase_failure', {
      cohort,
      error: e?.message ?? 'Purchase failed.',
      selectedOfferingId: offeringId,
    });
    if (e?.userCancelled) return { success: false };
    return { success: false, resolvedOfferingId: offeringId, error: e?.message ?? 'Purchase failed.' };
  }
}

export async function getRevenueCatOfferingSummary(appUserId?: string) {
  const apiKey = getApiKey();

  if (!apiKey || Constants.executionEnvironment === 'storeClient' || Platform.OS === 'web') {
    return {
      annualLabel: PRO_ANNUAL_FALLBACK_LABEL,
      monthlyLabel: PRO_MONTHLY_LABEL,
      offeringId: null,
    };
  }

  const Purchases = (await import('react-native-purchases')).default;

  if (!initialized) {
    await initializeRevenueCat(appUserId);
  } else if (appUserId) {
    await Purchases.logIn(appUserId).catch(() => null);
  }

  const offerings = await Purchases.getOfferings().catch(() => null);
  const current = offerings?.current;

  return {
    annualLabel: current?.annual?.product?.priceString
      ? `${current.annual.product.priceString}/year`
      : PRO_ANNUAL_FALLBACK_LABEL,
    monthlyLabel: current?.monthly?.product?.priceString
      ? `${current.monthly.product.priceString}/month`
      : PRO_MONTHLY_LABEL,
    offeringId: current?.identifier ?? null,
  };
}
