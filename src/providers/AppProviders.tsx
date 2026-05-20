import type { PropsWithChildren } from 'react';

import { StripeProvider } from '@stripe/stripe-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { env } from '@/lib/env';

export function AppProviders({ children }: PropsWithChildren) {
  const wrappedChildren = env.stripePublishableKey ? (
    <StripeProvider
      publishableKey={env.stripePublishableKey}
      merchantIdentifier={env.stripeMerchantIdentifier || undefined}
      urlScheme="apex"
    >
      {children}
    </StripeProvider>
  ) : children;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>{wrappedChildren}</SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
