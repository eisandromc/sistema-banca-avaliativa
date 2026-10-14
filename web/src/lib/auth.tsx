import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import type { User } from './types.ts';

interface AuthState {
  user: User | null;
  primaryDayIds: number[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [primaryDayIds, setPrimary] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User | null; primaryDayIds?: number[] }>('/api/auth/me');
      setUser(r.user);
      setPrimary(r.primaryDayIds ?? []);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post('/api/auth/login', { email, password });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setUser(null);
    setPrimary([]);
  }, []);

  return <AuthContext.Provider value={{ user, primaryDayIds, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  teacher: 'Professor',
  viewer: 'Visualização do cronômetro',
};
