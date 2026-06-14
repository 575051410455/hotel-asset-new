import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap, TOKEN_KEY } from './api';
import type { AuthUser, HotelAccess, MeResponse, PermLevel, Resource } from './types';

const ACTIVE_HOTEL_KEY = 'om-active-hotel';

type AuthContextValue = {
  user: AuthUser | null;
  hotels: HotelAccess[];
  activeHotelId: string | null;
  activeHotel: HotelAccess | null;
  setActiveHotelId: (id: string) => void;
  isLoading: boolean;
  isAuthed: boolean;
  /** Highest permission level the user has for a resource on the active hotel. */
  permFor: (resource: Resource) => PermLevel;
  can: (resource: Resource, level: 'read' | 'crud') => boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function rank(p: PermLevel): number {
  return p === 'crud' ? 2 : p === 'read' ? 1 : 0;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const hasToken = !!localStorage.getItem(TOKEN_KEY);

  const { data, isLoading, isFetching } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.auth.me.$get().then(unwrap),
    enabled: hasToken,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const hotels = useMemo(() => data?.hotels ?? [], [data]);

  const [activeHotelId, setActiveHotelIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_HOTEL_KEY)
  );

  // Default the active hotel to the first accessible one once data loads.
  const resolvedActiveId = useMemo(() => {
    if (hotels.length === 0) return null;
    if (activeHotelId && hotels.some((h) => h.id === activeHotelId)) return activeHotelId;
    return hotels[0].id;
  }, [hotels, activeHotelId]);

  const setActiveHotelId = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_HOTEL_KEY, id);
    setActiveHotelIdState(id);
  }, []);

  const activeHotel = useMemo(
    () => hotels.find((h) => h.id === resolvedActiveId) ?? null,
    [hotels, resolvedActiveId]
  );

  const permFor = useCallback(
    (resource: Resource): PermLevel => activeHotel?.perms?.[resource] ?? 'none',
    [activeHotel]
  );

  const can = useCallback(
    (resource: Resource, level: 'read' | 'crud') => rank(permFor(resource)) >= rank(level),
    [permFor]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    queryClient.clear();
    window.location.href = '/login';
  }, [queryClient]);

  const value: AuthContextValue = {
    user: data?.user ?? null,
    hotels,
    activeHotelId: resolvedActiveId,
    activeHotel,
    setActiveHotelId,
    isLoading: hasToken && (isLoading || isFetching) && !data,
    isAuthed: hasToken,
    permFor,
    can,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
