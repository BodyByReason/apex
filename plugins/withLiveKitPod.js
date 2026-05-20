/**
 * Expo config plugin — withLiveKitPod
 *
 * @livekit/react-native uses React Native community autolinking (it has a
 * livekit-react-native.podspec but no expo-module.config.json). Expo's
 * autolinking step (use_expo_modules! / expo-modules-autolinking) only picks
 * up packages with expo-module.config.json, so @livekit/react-native is
 * silently skipped and its native module is never registered — causing the
 * "package doesn't seem to be linked" runtime error.
 *
 * This plugin injects an explicit `pod` declaration into the Podfile after
 * `use_native_modules!` so pod install always links it correctly.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withLiveKitPod = (config) =>
  withDangerousMod(config, [
    'ios',
    (mod) => {
      const podfilePath = path.join(mod.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      // Idempotent — skip if already present.
      if (podfile.includes('livekit-react-native')) return mod;

      // Inject the explicit pod declaration immediately after use_native_modules!
      podfile = podfile.replace(
        /^(\s*config = use_native_modules!.*)/m,
        "$1\n\n  # @livekit/react-native uses RN community autolinking (no expo-module.config.json)\n  # so Expo's autolinking misses it — declare it explicitly.\n  pod 'livekit-react-native', :path => '../node_modules/@livekit/react-native'"
      );

      fs.writeFileSync(podfilePath, podfile, 'utf8');
      return mod;
    },
  ]);

module.exports = withLiveKitPod;
