// Jest setup — stubs for React Native modules that aren't needed in unit tests.
// This file runs before each test suite via the "setupFiles" jest config entry.

// AsyncStorage crashes in Node because the native module is null.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

// URL polyfill tries to patch global.URL which is fine, but some bundles also
// do native bridging — mock at the module level to keep it silent.
jest.mock('react-native-url-polyfill/auto', () => {}, { virtual: true });

// Supabase client is not needed for pure-logic unit tests.
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

// The app's own supabase singleton — return a no-op client so imports resolve.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(() => ({ insert: jest.fn(), select: jest.fn() })),
  },
}));

// Native-only modules
jest.mock('react-native-worklets', () => ({}), { virtual: true });
jest.mock('@elevenlabs/react-native', () => ({}), { virtual: true });
jest.mock('expo-camera', () => ({}), { virtual: true });
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn() }), { virtual: true });
jest.mock('expo-file-system', () => ({}), { virtual: true });
