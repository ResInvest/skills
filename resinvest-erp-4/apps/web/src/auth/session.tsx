import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, ApiRequestError, sessionEvents } from "../api/client";
import type { Me } from "../api/types";

interface SessionCtx {
  user: Me | null;
  loading: boolean;
  can: (perm: string) => boolean;
  setUser: (u: Me | null) => void;
  logout: () => Promise<void>;
}
const Ctx = createContext<SessionCtx | null>(null);
export const ME_KEY = ["auth", "me"] as const;

/**
 * Koniec sesji w interfejsie: profil = null i usunięcie wszystkich danych serwera z pamięci podręcznej.
 * Zapytanie profilu NIE jest usuwane (QueryClient.clear() odłączyłby obserwatora i interfejs pokazywałby
 * nadal zalogowanego użytkownika) — tylko ustawiane na null.
 */
function resetSession(qc: QueryClient): void {
  qc.setQueryData(ME_KEY, null);
  qc.removeQueries({ predicate: x => !(x.queryKey[0] === ME_KEY[0] && x.queryKey[1] === ME_KEY[1]) });
}

/** Zalogowany użytkownik z GET /auth/me (serwer jest źródłem prawdy o rolach i uprawnieniach). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      try { return (await api.get<{ user: Me }>("/auth/me", signal)).user; }
      catch (e) { if (e instanceof ApiRequestError && e.status === 401) return null; throw e; }
    },
    retry: false, staleTime: 60_000,
  });
  const setUser = useCallback((u: Me | null) => { qc.setQueryData(ME_KEY, u); }, [qc]);
  useEffect(() => {
    // sesja wygasła / odwołana w trakcie pracy — tylko gdy ktoś był zalogowany (401 na ekranach publicznych to norma)
    const onUnauth = () => { if (qc.getQueryData(ME_KEY)) resetSession(qc); };
    // administrator wymusił zmianę hasła w trakcie sesji — odśwież profil (ekran zmiany hasła)
    const onPw = () => { void qc.invalidateQueries({ queryKey: ME_KEY }); };
    sessionEvents.addEventListener("unauthorized", onUnauth);
    sessionEvents.addEventListener("password-required", onPw);
    return () => { sessionEvents.removeEventListener("unauthorized", onUnauth); sessionEvents.removeEventListener("password-required", onPw); };
  }, [qc]);
  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } finally { resetSession(qc); }
  }, [qc]);
  const user = q.data ?? null;
  const value = useMemo<SessionCtx>(() => ({ user, loading: q.isPending, can: p => !!user?.permissions.includes(p), setUser, logout }), [user, q.isPending, setUser, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession poza SessionProvider");
  return c;
}
