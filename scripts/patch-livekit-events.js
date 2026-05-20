/**
 * Patches @livekit/react-native-webrtc's EventEmitter.js to prevent a fatal
 * crash on startup caused by a mismatch between the JS NATIVE_EVENTS array
 * and the events actually registered in the native WebRTCModule binary.
 *
 * ── Root cause ────────────────────────────────────────────────────────────
 * @livekit/react-native-webrtc's JS lists 'frameCryptionStateChanged' in
 * NATIVE_EVENTS, but the prebuilt WebRTC-SDK XCFramework binary (both
 * 137.x and 144.x) does NOT include it in WebRTCModule.supportedEvents.
 *
 * When setupNativeEvents() calls nativeEmitter.addListener('frameCryptionStateChanged', ...)
 * the call travels: JS → TurboModule bridge (ObjCTurboModule::performVoidMethodInvocation)
 * → [RCTEventEmitter addListener:] → @throw NSException.
 *
 * The NSException is an Objective-C exception thrown INSIDE the C++ TurboModule
 * bridge. It propagates up the native call stack and crashes the app BEFORE
 * control ever returns to JavaScript. A JS try/catch cannot catch it —
 * the catch block is never reached.
 *
 * ── Fix ───────────────────────────────────────────────────────────────────
 * Remove 'frameCryptionStateChanged' from NATIVE_EVENTS so addListener is
 * never called for it. This is safe for APEX — E2E frame encryption is not
 * used. If a future native build adds the event, this filter can be removed.
 *
 * Run automatically via the "postinstall" npm script.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(
  __dirname,
  '../node_modules/@livekit/react-native-webrtc/lib/commonjs/EventEmitter.js'
);

// Events the native WebRTC-SDK binary actually supports (confirmed at runtime).
// 'frameCryptionStateChanged' is intentionally absent — it is in the JS source
// but missing from WebRTCModule.supportedEvents in all shipping binary versions.
const UNSUPPORTED_NATIVE_EVENTS = ['frameCryptionStateChanged'];

if (!fs.existsSync(TARGET)) {
  console.warn('[patch-livekit-events] File not found, skipping:', TARGET);
  process.exit(0);
}

let src = fs.readFileSync(TARGET, 'utf8');

// Idempotency check — already patched
if (src.includes('// [APEX patch]')) {
  console.log('[patch-livekit-events] Already patched, nothing to do.');
  process.exit(0);
}

// ── Patch 1: Filter unsupported events out of NATIVE_EVENTS ───────────────
// The NATIVE_EVENTS constant is defined as a flat array literal on one line.
// We strip the events that the native binary doesn't support so addListener
// is never called for them (a JS try/catch is NOT sufficient — the native
// NSException thrown by RCTEventEmitter crashes the app before JS catches it).
const eventsPattern = /const NATIVE_EVENTS = \[([^\]]+)\];/;
if (eventsPattern.test(src)) {
  src = src.replace(eventsPattern, (match, eventsList) => {
    const filtered = eventsList
      .split(',')
      .map(e => e.trim())
      .filter(e => {
        const name = e.replace(/['"]/g, '');
        return !UNSUPPORTED_NATIVE_EVENTS.includes(name);
      })
      .join(', ');
    return `const NATIVE_EVENTS = [${filtered}]; // [APEX patch] removed: ${UNSUPPORTED_NATIVE_EVENTS.join(', ')}`;
  });
} else {
  console.error('[patch-livekit-events] Could not locate NATIVE_EVENTS array — manual patch required.');
  process.exit(1);
}

fs.writeFileSync(TARGET, src, 'utf8');
console.log(
  `[patch-livekit-events] Removed [${UNSUPPORTED_NATIVE_EVENTS.join(', ')}] from NATIVE_EVENTS. App will no longer crash on startup.`
);
