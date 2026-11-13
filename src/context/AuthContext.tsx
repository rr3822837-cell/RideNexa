import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AuthUser, DriverRecord, UserRole } from '../types/ridenexa';

const TOKEN_KEY = 'ridenexa_jwt_token';

function readInitialToken(): string | null {
  try {
    const tabToken = sessionStorage.getItem(TOKEN_KEY);
    if (tabToken) return tabToken;
    const sharedToken = localStorage.getItem(TOKEN_KEY);
    if (sharedToken) {
      sessionStorage.setItem(TOKEN_KEY, sharedToken);
    }
    return sharedToken;
  } catch {
    return null;
  }
}

function readActiveTabToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function persistTabAndSharedToken(nextToken: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(TOKEN_KEY, nextToken);
  } catch {
    // Ignore storage quota errors
  }
}

function clearStoredToken(matchingToken?: string | null) {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    if (!matchingToken || localStorage.getItem(TOKEN_KEY) === matchingToken) {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  driverProfile: DriverRecord | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    phone?: string;
    vehicleModel?: string;
    vehicleTier?: import('../types/ridenexa').VehicleTier;
    plateNumber?: string;
    vehicleCapacity?: number;
    licenseNumber?: string;
    licenseExpiry?: string;
    documents?: {
      docType: import('../types/ridenexa').DriverDocumentType;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      dataUrl: string;
    }[];
  }) => Promise<AuthUser>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  apiFetch: <T>(url: string, options?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readInitialToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const apiFetch = useCallback(
    async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }
      const activeToken = token || readActiveTabToken();
      if (activeToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }

      const response = await fetch(url, { ...options, headers });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        clearStoredToken(activeToken);
        setToken(null);
        setUser(null);
        setDriverProfile(null);
      }
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }
      return data as T;
    },
    [token]
  );

  const refreshProfile = useCallback(async () => {
    const stored = readActiveTabToken();
    if (!stored) {
      setUser(null);
      setDriverProfile(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${stored}` },
      });
      if (!res.ok) {
        clearStoredToken(stored);
        setToken(null);
        setUser(null);
        setDriverProfile(null);
      } else {
        const data = (await res.json()) as { user: AuthUser; driverProfile: DriverRecord | null };
        setUser(data.user);
        setDriverProfile(data.driverProfile);
      }
    } catch {
      // Keep current state on transient network glitch
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Unable to sign in.');
    }
    persistTabAndSharedToken(data.token);
    setToken(data.token);
    setUser(data.user);
    setDriverProfile(data.driverProfile || null);
    return data.user as AuthUser;
  }, []);

  const register = useCallback(
    async (payload: {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      phone?: string;
      vehicleModel?: string;
      plateNumber?: string;
    }): Promise<AuthUser> => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Unable to create account.');
      }
      persistTabAndSharedToken(data.token);
      setToken(data.token);
      setUser(data.user);
      setDriverProfile(data.driverProfile || null);
      return data.user as AuthUser;
    },
    []
  );

  const logout = useCallback(() => {
    clearStoredToken(token);
    setToken(null);
    setUser(null);
    setDriverProfile(null);
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        user,
        driverProfile,
        token,
        loading,
        login,
        register,
        logout,
        refreshProfile,
        apiFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
