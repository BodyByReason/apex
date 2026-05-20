#!/usr/bin/env node
// Patches expo-sharing/src/ExpoSharing.ts to use requireOptionalNativeModule
// instead of requireNativeModule so it doesn't throw at bundle evaluation time
// before the expo bridge finishes initializing on Android.
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '../node_modules/expo-sharing/src/ExpoSharing.ts'
);

if (!fs.existsSync(filePath)) {
  console.log('[patch-expo-sharing] File not found, skipping.');
  process.exit(0);
}

const original = fs.readFileSync(filePath, 'utf8');
if (original.includes('requireOptionalNativeModule')) {
  console.log('[patch-expo-sharing] Already patched, skipping.');
  process.exit(0);
}

const patched = original.replace(
  "import { requireNativeModule } from 'expo-modules-core';\nexport default requireNativeModule('ExpoSharing');",
  "import { requireOptionalNativeModule } from 'expo-modules-core';\nexport default requireOptionalNativeModule('ExpoSharing');"
);

if (patched === original) {
  console.warn('[patch-expo-sharing] Pattern not matched — check ExpoSharing.ts for changes.');
  process.exit(0);
}

fs.writeFileSync(filePath, patched, 'utf8');
console.log('[patch-expo-sharing] Patched expo-sharing/src/ExpoSharing.ts');
