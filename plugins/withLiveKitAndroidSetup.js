/**
 * Expo config plugin - withLiveKitAndroidSetup
 *
 * @livekit/react-native requires LiveKitReactNative.setup(...) to run from
 * MainApplication.onCreate before React Native starts. android/ is generated
 * and gitignored, so a manual MainApplication.kt edit will not survive EAS
 * prebuild. This plugin injects the setup call into the generated file.
 */

const { withMainApplication } = require('@expo/config-plugins');

function addImport(contents, importLine) {
  if (contents.includes(importLine)) return contents;
  return contents.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
}

function addLiveKitSetup(contents) {
  if (contents.includes('LiveKitReactNative.setup(')) return contents;

  let next = addImport(contents, 'import com.livekit.reactnative.LiveKitReactNative');
  next = addImport(next, 'import com.livekit.reactnative.audio.AudioType');

  return next.replace(
    /(\boverride fun onCreate\(\) \{\s*\n\s*super\.onCreate\(\)\s*)/,
    `$1\n    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())\n    `,
  );
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withLiveKitAndroidSetup = (config) =>
  withMainApplication(config, (mod) => {
    mod.modResults.contents = addLiveKitSetup(mod.modResults.contents);
    return mod;
  });

module.exports = withLiveKitAndroidSetup;
