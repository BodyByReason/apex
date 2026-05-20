/**
 * Expo config plugin — withGradleWrapper
 *
 * Pins the Gradle wrapper to a version that EAS build servers have cached.
 * Gradle 8.14.3 is too new for EAS to have pre-fetched, causing the build
 * to timeout trying to download it from services.gradle.org.
 *
 * 8.13.1 is compatible with React Native 0.81.x and AGP 8.x, and has been
 * in general release long enough for EAS infra to have it cached.
 *
 * android/ is gitignored and regenerated on every EAS prebuild, so manual
 * edits to gradle-wrapper.properties don't survive — this plugin is the only
 * reliable way to pin the version.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const GRADLE_VERSION = '8.10.2';
const DISTRIBUTION_URL = `https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`;

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withGradleWrapper = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const wrapperPropsPath = path.join(
        mod.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties',
      );

      if (!fs.existsSync(wrapperPropsPath)) return mod;

      let content = fs.readFileSync(wrapperPropsPath, 'utf8');

      content = content.replace(
        /^distributionUrl=.+$/m,
        `distributionUrl=${DISTRIBUTION_URL}`,
      );

      fs.writeFileSync(wrapperPropsPath, content, 'utf8');
      return mod;
    },
  ]);

module.exports = withGradleWrapper;
