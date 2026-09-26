/**
 * Authenticated user state.
 *
 * The signed-in user comes from the session cookie via `getCurrentUser`, so a
 * refresh keeps you signed in and there is no hardcoded account anywhere.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  changePassword as changePasswordFn,
  getCurrentUser,
  requestPasswordOtp,
  resetPasswordWithOtp,
  signIn as signInFn,
  signOut as signOutFn,
  signUp as signUpFn,
  updateProfile as updateProfileFn,
  type AuthUser,
  type OtpRequestResult,
} from './auth-api';

export type { AuthUser };
export type Role = AuthUser['role'];

type AuthStore = {
  user: AuthUser | null;
  /** True until the session has been checked, so guards do not redirect too early. */
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: { name: string; email: string; password: string }) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  requestPasswordOtp: (email: string) => Promise<OtpRequestResult>;
  resetPassword: (input: { email: string; code: string; password: string }) => Promise<void>;
  updateProfile: (input: { name: string; lowStockAlerts: boolean }) => Promise<void>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
};

const AUTH_KEY = ['auth', 'currentUser'] as const;

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: AUTH_KEY,
    queryFn: () => getCurrentUser(),
    // The cookie is the source of truth; don't refetch on every focus.
    staleTime: 60_000,
    retry: false,
  });

  const setUser = useCallback(
    (user: AuthUser | null) => {
      queryClient.setQueryData(AUTH_KEY, user);
    },
    [queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const user = await signInFn({ data: { email, password } });
      setUser(user);
      // Inventory visibility can depend on who is signed in.
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      return user;
    },
    [queryClient, setUser],
  );

  const signUp = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      const user = await signUpFn({ data: input });
      setUser(user);
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      return user;
    },
    [queryClient, setUser],
  );

  const signOut = useCallback(async () => {
    await signOutFn();
    setUser(null);
    // Drop cached inventory so nothing from the previous session lingers.
    queryClient.removeQueries({ queryKey: ['stock'] });
  }, [queryClient, setUser]);

  const updateProfile = useCallback(
    async (input: { name: string; lowStockAlerts: boolean }) => {
      const user = await updateProfileFn({ data: input });
      setUser(user);
    },
    [setUser],
  );

  const value = useMemo<AuthStore>(
    () => ({
      user: query.data ?? null,
      isLoading: query.isPending,
      signIn,
      signUp,
      signOut,
      requestPasswordOtp: (email: string) => requestPasswordOtp({ data: { email } }),
      resetPassword: (input: { email: string; code: string; password: string }) =>
        resetPasswordWithOtp({ data: input }),
      updateProfile,
      changePassword: (input: { currentPassword: string; newPassword: string }) =>
        changePasswordFn({ data: input }),
    }),
    [query.data, query.isPending, signIn, signUp, signOut, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider missing');
  return context;
};
