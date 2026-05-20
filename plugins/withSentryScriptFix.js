/**
 * Expo config plugin — withSentryScriptFix
 *
 * Two Xcode build phases use backtick command substitution to resolve script
 * paths at build time. When the project lives in a directory whose path
 * contains spaces (e.g. "New project"), the shell word-splits the substituted
 * path and exec fails with "No such file or directory".
 *
 * Phase 1 — "Bundle React Native code and images"
 *   Original (broken):
 *     /bin/sh `"$NODE_BINARY" --print "...sentry-xcode.sh"` \
 *             `"$NODE_BINARY" --print "...react-native-xcode.sh"`
 *   Fixed: capture each path in a quoted variable first.
 *
 * Phase 2 — "Upload Debug Symbols to Sentry"
 *   Original (broken):
 *     /bin/sh `node --print "...sentry-xcode-debug-files.sh"`
 *   Fixed: capture path in a quoted variable + disable auto-upload so the
 *   script exits quickly without needing sentry-cli credentials at dev time.
 *
 * Run this plugin AFTER @sentry/react-native/expo in app.config.ts so it can
 * overwrite what that plugin generated.
 */

const { withXcodeProject } = require('@expo/config-plugins');

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withSentryScriptFix = (config) =>
  withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const phases = project.hash.project.objects['PBXShellScriptBuildPhase'] ?? {};

    for (const [, phase] of Object.entries(phases)) {
      if (typeof phase !== 'object') continue;

      const name = phase.name ?? '';

      // ── Phase 1: Bundle React Native code and images ────────────────────
      if (name.includes('Bundle React Native code and images')) {
        const script = phase.shellScript ?? '';
        // Already patched if backtick invocation has been replaced.
        if (!script.includes('`')) continue;

        // Replace the double-backtick invocation at the end of the script with
        // quoted $() variable capture. The pbxproj string uses \" for literal
        // double-quotes and \n for newlines.
        phase.shellScript = script.replace(
          /`\\"?\$NODE_BINARY\\"? --print \\"require\('path'\)\.dirname\(require\.resolve\('@sentry\/react-native\/package\.json'\)\) \+ '\/scripts\/sentry-xcode\.sh'\\"`\s*`\\"?\$NODE_BINARY\\"? --print \\"require\('path'\)\.dirname\(require\.resolve\('react-native\/package\.json'\)\) \+ '\/scripts\/react-native-xcode\.sh'\\"`/,
          'SENTRY_XCODE=$(\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'@sentry/react-native/package.json\')) + \'/scripts/sentry-xcode.sh\'\\")\nRN_XCODE=$(\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'\\")\n/bin/sh \\"$SENTRY_XCODE\\" \\"$RN_XCODE\\"'
        );
        continue;
      }

      // ── Phase 2: Upload Debug Symbols to Sentry ─────────────────────────
      if (name.includes('Upload Debug Symbols to Sentry')) {
        const script = phase.shellScript ?? '';
        // Already patched.
        if (script.includes('SENTRY_DISABLE_AUTO_UPLOAD')) continue;

        phase.shellScript =
          '"export SENTRY_DISABLE_AUTO_UPLOAD=true\\n' +
          'SENTRY_DEBUG_FILES_SCRIPT=$(${NODE_BINARY:-node} --print \\"require(\'path\').dirname(require.resolve(\'@sentry/react-native/package.json\')) + \'/scripts/sentry-xcode-debug-files.sh\'\\")\\n' +
          '/bin/sh \\"$SENTRY_DEBUG_FILES_SCRIPT\\"\\n"';
        continue;
      }
    }

    return mod;
  });

module.exports = withSentryScriptFix;
