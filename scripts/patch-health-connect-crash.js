/**
 * Patches react-native-health-connect's HealthConnectManager.kt to add
 * try-catch inside the coroutineScope.launch {} block in requestPermission.
 *
 * ── Root cause ────────────────────────────────────────────────────────────
 * HealthConnectPermissionDelegate.requestPermission is a lateinit property
 * initialized by setPermissionDelegate(activity). If it hasn't been
 * initialized before launchPermissionsDialog() is called, Kotlin throws:
 *   UninitializedPropertyAccessException: lateinit property requestPermission
 *   has not been initialized
 *
 * This exception is thrown INSIDE coroutineScope.launch {} with no try-catch.
 * The CoroutineScope(Dispatchers.IO) has no exception handler, so the
 * exception propagates to Android's UncaughtExceptionHandler and crashes the
 * app. The JavaScript try/catch in requestAndroidHealthPermission() CANNOT
 * intercept it — the native crash happens before the Promise is rejected.
 *
 * ── Fix ───────────────────────────────────────────────────────────────────
 * Wrap the body of coroutineScope.launch {} in requestPermission with
 * try { ... } catch (e: Exception) { promise.rejectWithException(e) }.
 * This converts any native crash into a Promise rejection, which the JS
 * try-catch then handles gracefully by falling back to opening the
 * Health Connect app.
 *
 * Note: MainActivity.kt also calls setPermissionDelegate(this) in onCreate(),
 * so under normal operation requestPermission IS initialized. This patch is
 * defense-in-depth against any edge case where that initialization is missed.
 *
 * Run automatically via the "postinstall" npm script.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(
  __dirname,
  '../node_modules/react-native-health-connect/android/src/main/java/dev/matinzd/healthconnect/HealthConnectManager.kt'
);

if (!fs.existsSync(TARGET)) {
  console.warn('[patch-health-connect-crash] File not found, skipping:', TARGET);
  process.exit(0);
}

let src = fs.readFileSync(TARGET, 'utf8');

// Idempotency check — already patched
if (src.includes('// [APEX patch]')) {
  console.log('[patch-health-connect-crash] Already patched, nothing to do.');
  process.exit(0);
}

// ── Patch: Wrap the coroutine body in requestPermission with try-catch ────────
// Original (crashes on UninitializedPropertyAccessException):
//   coroutineScope.launch {
//     val granted = HealthConnectPermissionDelegate.launchPermissionsDialog(...)
//     promise.resolve(PermissionUtils.mapPermissionResult(granted))
//   }
//
// Patched (rejects promise instead of crashing):
//   coroutineScope.launch {
//     try {
//       val granted = HealthConnectPermissionDelegate.launchPermissionsDialog(...)
//       promise.resolve(PermissionUtils.mapPermissionResult(granted))
//     } catch (e: Exception) { promise.rejectWithException(e) }
//   }

const originalBlock = `    coroutineScope.launch {
        val granted = HealthConnectPermissionDelegate.launchPermissionsDialog(PermissionUtils.parsePermissions(reactPermissions))
        promise.resolve(PermissionUtils.mapPermissionResult(granted))
      }`;

const patchedBlock = `    coroutineScope.launch { // [APEX patch] try-catch prevents UninitializedPropertyAccessException crash
        try {
          val granted = HealthConnectPermissionDelegate.launchPermissionsDialog(PermissionUtils.parsePermissions(reactPermissions))
          promise.resolve(PermissionUtils.mapPermissionResult(granted))
        } catch (e: Exception) {
          promise.rejectWithException(e)
        }
      }`;

if (!src.includes(originalBlock)) {
  console.error('[patch-health-connect-crash] Could not locate requestPermission coroutine block — manual patch required.');
  console.error('Expected to find:\n' + originalBlock);
  process.exit(1);
}

src = src.replace(originalBlock, patchedBlock);
fs.writeFileSync(TARGET, src, 'utf8');
console.log('[patch-health-connect-crash] Added try-catch to requestPermission coroutine. App will no longer crash on UninitializedPropertyAccessException.');
