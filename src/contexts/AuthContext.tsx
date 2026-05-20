import type { PropsWithChildren } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { Linking } from 'react-native';

import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  clearPendingAppLink: () => void;
  completePasswordReset: (password: string) => Promise<string | null>;
  dismissPasswordReset: () => void;
  isEmailVerified: boolean;
  initializing: boolean;
  pendingAppLink: PendingAppLink | null;
  passwordResetMode: boolean;
  resendVerificationEmail: (targetEmail?: string) => Promise<string | null>;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; hasSession: boolean; needsEmailVerification: boolean }>;
  userEmail: string | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const SESSION_CACHE_KEYS = ['apex.user.profile', 'apex.onboarding.firstActionPending'];
const WW_STATIC_RESET_KEYS = [
  'apex._edition.walkWater',
  'apex._edition.walkWaterQuiz',
  'apex._edition.walkWaterPlan',
  'apex._edition.wwUpgraded',
  'apex.user.profile',
  '@apex.coach_dm.v1',
  'apex.ww.coachCardMinimized',
  'apex.ww.challengeOfferExpiry',
  'apex.ww.community.chat',
  'apex.ww.tribe.chat',
  'apex.walk.completedWalks.v1',
  'apex.inapp.seenWalkStreakMilestones',
];

export type PendingAppLink =
  | { type: 'coach_access' }
  | { token: string | null; type: 'apex_client_migration' | 'apex_ww_upgrade' };

function readAuthParams(url: string) {
  const [base, hash = ''] = url.split('#');
  const parsed = new URL(base);
  const hashParams = new URLSearchParams(hash);
  const searchParams = parsed.searchParams;

  const accessToken = hashParams.get('access_token') ?? searchParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token') ?? searchParams.get('refresh_token');
  const code = hashParams.get('code') ?? searchParams.get('code');
  const type = hashParams.get('type') ?? searchParams.get('type');

  return { accessToken, code, refreshToken, type };
}

function isInvalidRefreshTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /invalid refresh token|refresh token not found/i.test(message);
}

async function clearLocalRestartState() {
  const allKeys = await AsyncStorage.getAllKeys().catch(() => [] as string[]);
  const dynamicKeys = allKeys.filter(
    (key) =>
      key.startsWith('sb-') ||
      key.startsWith('apex.ww.water.') ||
      key.startsWith('apex.checklist.') ||
      key.startsWith('apex.walk.') ||
      key.startsWith('apex.user.profile'),
  );

  const keysToRemove = [...new Set([...SESSION_CACHE_KEYS, ...WW_STATIC_RESET_KEYS, ...dynamicKeys])];
  if (keysToRemove.length > 0) {
    await AsyncStorage.multiRemove(keysToRemove).catch(() => null);
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [pendingAppLink, setPendingAppLink] = useState<PendingAppLink | null>(null);
  const [passwordResetMode, setPasswordResetMode] = useState(false);
  const userEmail = session?.user?.email ?? null;
  const isEmailVerified = Boolean(session?.user?.email_confirmed_at ?? session?.user?.confirmed_at);

  useEffect(() => {
    let isMounted = true;

    const hydrateSession = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error && isInvalidRefreshTokenError(error)) {
        await clearLocalRestartState();
        await supabase.auth.signOut().catch(() => null);
        if (isMounted) {
          setSession(null);
        }
      } else if (!error && isMounted) {
        setSession(data.session);
      }

      if (isMounted) {
        setInitializing(false);
      }
    };

    const handleIncomingUrl = async (url: string | null) => {
      if (!url) return;

      const { accessToken, refreshToken, code, type } = readAuthParams(url);

      if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (type === 'recovery') {
          setPasswordResetMode(true);
        }
        return;
      }

      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        if (type === 'recovery') {
          setPasswordResetMode(true);
        }
        return;
      }

      try {
        const parsed = new URL(url);
        const host = parsed.host.toLowerCase();
        const path = parsed.pathname.replace(/^\/+/, '').toLowerCase();
        const fullPath = [host, path].filter(Boolean).join('/');
        const token = parsed.searchParams.get('token');

        if (host === 'coach-access' || path === 'coach-access' || fullPath === 'apex/coach-access') {
          setPendingAppLink({ type: 'coach_access' });
          return;
        }

        if (fullPath === 'apex/client-migration') {
          setPendingAppLink({ type: 'apex_client_migration', token });
          return;
        }

        if (fullPath === 'apex/ww-upgrade') {
          setPendingAppLink({ type: 'apex_ww_upgrade', token });
        }
      } catch {
        return;
      }
    };

      hydrateSession();
    Linking.getInitialURL().then(handleIncomingUrl).catch(() => null);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        await AsyncStorage.multiRemove(SESSION_CACHE_KEYS).catch(() => null);
        setPasswordResetMode(false);
      }
      setSession(nextSession);
      setInitializing(false);
    });

    const linkingSubscription = Linking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url).catch(() => null);
    });

    return () => {
      isMounted = false;
      linkingSubscription.remove();
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      initializing,
      pendingAppLink,
      isEmailVerified,
      passwordResetMode,
      clearPendingAppLink: () => setPendingAppLink(null),
      resendVerificationEmail: async (targetEmail?: string) => {
        const safeEmail = (targetEmail ?? userEmail ?? '').trim().toLowerCase();
        if (!safeEmail) {
          return 'Missing email address.';
        }

        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: safeEmail,
          options: {
            emailRedirectTo: 'apex://auth/callback',
          },
        });

        return error?.message ?? null;
      },
      session,
      signUp: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: 'apex://auth/callback',
          },
        });
        return {
          error: error?.message ?? null,
          hasSession: !!data.session,
          needsEmailVerification: !error && !data.session,
        };
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        return error?.message ?? null;
      },
      completePasswordReset: async (password) => {
        const { error } = await supabase.auth.updateUser({ password });
        if (!error) {
          setPasswordResetMode(false);
        }
        return error?.message ?? null;
      },
      dismissPasswordReset: () => {
        setPasswordResetMode(false);
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
          // Remote revocation failed (network issue). Clear local session anyway so
          // the UI always reflects the signed-out state regardless of connectivity.
          await supabase.auth.signOut({ scope: 'local' }).catch(() => null);
        }
        // Always clear session immediately — don't wait for onAuthStateChange,
        // which can be delayed and leave the user stuck on the current screen.
        setSession(null);
        setPasswordResetMode(false);
        await AsyncStorage.multiRemove(SESSION_CACHE_KEYS).catch(() => null);
        return error?.message ?? null;
      },
      userEmail,
    }),
    [initializing, isEmailVerified, passwordResetMode, pendingAppLink, session, userEmail],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }

  return context;
}
