import type { ExpoConfig } from 'expo/config';

const bundleIdentifier =
  process.env.EXPO_PUBLIC_APP_BUNDLE_ID ?? 'com.bodybyreason.apex';
const easProjectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
  '559c2858-00ff-4501-a270-1c4341868f17';

const config: ExpoConfig = {
  name: 'APEX',
  slug: 'apex',
  version: '1.0.7',
  orientation: 'default',
  icon: './assets/icon.png',
  scheme: 'apex',
  userInterfaceStyle: 'dark',
  jsEngine: 'hermes',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#050B08',
  },
  ios: {
    jsEngine: 'jsc',
    bundleIdentifier,
    supportsTablet: false,
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY ?? '',
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // ── Health ──────────────────────────────────────────────────────────
      NSHealthShareUsageDescription:
        'APEX reads your step count and active energy to show workout progress and daily activity.',
      NSHealthUpdateUsageDescription:
        'APEX writes workout sessions to Apple Health so all your fitness data stays in one place.',
      // ── Camera & Photos ─────────────────────────────────────────────────
      NSCameraUsageDescription:
        'APEX uses your camera to scan food barcodes and log meals instantly.',
      NSPhotoLibraryUsageDescription:
        'APEX accesses your photo library so you can upload progress photos and food images.',
      NSPhotoLibraryAddUsageDescription:
        'APEX saves your achievement share cards and progress photos to your photo library.',
      // ── Microphone (AI Voice Coach) ──────────────────────────────────────
      NSMicrophoneUsageDescription:
        'APEX uses your microphone for the AI Voice Coach to guide you through workouts hands-free.',
      // ── Location (background walk tracking) ─────────────────────────────
      NSLocationWhenInUseUsageDescription:
        'APEX uses your location to draw your walk route on the map.',
      NSLocationAlwaysUsageDescription:
        'APEX tracks your walk route in the background so the map and pace stay accurate when your screen locks.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'APEX tracks your walk route in the background so the map and pace stay accurate when your screen locks.',
      // ── Notifications ────────────────────────────────────────────────────
      // 'voip' keeps the LiveKit WebSocket alive for the AI Voice Coach and Live Finale.
      // 'audio' keeps the AI Voice Coach speaking when the screen locks mid-session.
      // 'location' keeps the walk tracker running when the screen locks.
      UIBackgroundModes: ['remote-notification', 'voip', 'audio', 'location'],
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#050B08',
    },
    package: bundleIdentifier,
    // Health Connect requires Android 8+ (API 26)
    minSdkVersion: 26,
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
    ],
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
      },
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  updates: {
    enabled: true,
    url: `https://u.expo.dev/${easProjectId}`,
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  plugins: [
    [
      'expo-build-properties',
      {
        android: {
          // Health Connect (react-native-health-connect) requires API 26+ (Android 8.0).
          // expo-build-properties is the only reliable way to set minSdkVersion
          // in an EAS build — direct edits to build.gradle are overwritten by prebuild.
          minSdkVersion: 26,
          // Required for Android 15 devices with 16 KB memory page sizes.
          // Prevents .so files from being compressed so the OS can map them
          // with 16 KB alignment. Without this, the app may fail to launch on
          // newer Android 15 hardware.
          useLegacyPackaging: false,
        },
      },
    ],
    'expo-asset',
    'expo-notifications',
    'expo-localization',
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'APEX reads your step count and active energy to show workout progress.',
      },
    ],
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG ?? '',
        project: process.env.SENTRY_PROJECT ?? 'apex',
        url: 'https://sentry.io/',
      },
    ],
    'expo-updates',
    [
      '@livekit/react-native-expo-plugin',
      {
        android: {
          audioType: 'communication',
        },
        ios: {
          enableMultitaskingCameraAccess: false,
        },
      },
    ],
    [
      '@config-plugins/react-native-webrtc',
      {
        cameraPermission:
          'APEX uses your camera to scan food, review workout form, and support live coaching.',
        microphonePermission:
          'APEX uses your microphone for the AI Voice Coach to guide you through workouts hands-free.',
      },
    ],
    [
      '@stripe/stripe-react-native',
      {
        merchantIdentifier: process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER || undefined,
        enableGooglePay: true,
      },
    ],
    // Must run AFTER @sentry/react-native/expo — fixes backtick path-with-spaces
    // bug in the "Upload Debug Symbols to Sentry" build phase on macOS paths
    // that contain spaces.
    './plugins/withSentryScriptFix',
    // Explicitly links @livekit/react-native — Expo autolinking skips it
    // because it has no expo-module.config.json (uses RN community autolinking).
    './plugins/withLiveKitPod',
    './plugins/withLiveKitAndroidSetup',
    // Android Health Connect — reads daily steps on Android 8+ (API 26+).
    // On Android 9-13 users need Health Connect installed from the Play Store;
    // on Android 14+ it is built into the OS.
    'react-native-health-connect',
    // Injects READ_STEPS permission, HC queries block, and the
    // ViewPermissionUsageActivity alias that makes APEX appear in the
    // Health Connect "Apps" list. The library's own plugin omits these.
    './plugins/withHealthConnectManifest',
  ],
  extra: {
    eas: {
      projectId: easProjectId,
    },
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  },
};

export default config;
