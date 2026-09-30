/**
 * Klient REST API ResInvest ERP (/api/v1). Sesja w ciasteczku HttpOnly — frontend nie przechowuje tokenów
 * ani danych biznesowych (tylko pamięć podręczna zapytań w RAM). Nagłówek X-Requested-With = ochrona CSRF.
 */
export interface ApiErrorBody { ok: false; code: string; error: string; details?: { field: string; message: string }[]; requestId?: string }

export class ApiRequestError extends Error {
  readonly code: string;
  constructor(readonly status: number, readonly body: ApiErrorBody | null) {
    super(body?.error ?? (status === 0 ? "Brak połączenia z serwerem." : `Błąd serwera (${status})`));
    this.name = "ApiRequestError";
    this.code = body?.code ?? (status === 0 ? "OFFLINE" : "ERROR");
  }
  /** Komunikat błędu dla konkretnego pola formularza (walidacja serwera). */
  field(name: string): string | undefined { return this.body?.details?.find(d => d.field === name)?.message; }
}

const BASE = "/api/v1";
/** Zdarzenie „sesja wygasła” — aplikacja przechodzi do logowania. */
export const sessionEvents = new EventTarget();

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method, credentials: "include", signal,
      headers: { "X-Requested-With": "ResInvestERP", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiRequestError(0, { ok: false, code: "OFFLINE", error: "Brak połączenia z serwerem. Sprawdź połączenie VPN (FortiClient) i sieć." });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiRequestError(res.status, data as ApiErrorBody | null);
    // 401 z logowania to zły login, z /auth/me — brak sesji (obsługuje SessionProvider); pozostałe = sesja wygasła
    if (res.status === 401 && !path.startsWith("/auth/login") && path !== "/auth/me") sessionEvents.dispatchEvent(new Event("unauthorized"));
    if (err.code === "PASSWORD_CHANGE_REQUIRED") sessionEvents.dispatchEvent(new Event("password-required"));
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};


export const errorText = (e: unknown): string => (e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Nieznany błąd");

export interface HealthReport {
  ok: boolean;
  version: string;
  time: string;
  database: { ok: boolean; latencyMs: number | null; migrations: number | null; pendingCheck: string | null };
}
