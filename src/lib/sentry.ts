import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const DSN: string = Constants.expoConfig?.extra?.sentryDsn ?? '';

export function initSentry() {
  if (!DSN) return; // skip in local dev if DSN not set

  Sentry.init({
    dsn: DSN,
    // Only capture errors in production / preview
    enabled: !__DEV__,
    // Sample 100% of errors, 10% of performance traces
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Strip any accidental PII from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          const data = { ...b.data };
          for (const key of ['email', 'password', 'token', 'api_key']) {
            if (data[key]) data[key] = '[REDACTED]';
          }
          return { ...b, data };
        });
      }
      return event;
    },
  });
}

export const captureError = (error: unknown, context?: Record<string, unknown>) => {
  if (__DEV__) {
    console.error('[Sentry]', error, context);
    return;
  }
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(error);
  });
};
