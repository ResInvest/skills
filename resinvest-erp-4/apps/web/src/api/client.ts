/** Klient REST API ResInvest ERP (/api/v1). Sesja w ciasteczku HttpOnly — frontend nie przechowuje tokenów ani danych biznesowych. */
export interface ApiError { ok: false; code: string; error: string; requestId?: string }

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly body: ApiError | null) { super(body?.error ?? `Błąd połączenia (${status})`); this.name = "ApiRequestError"; }
}

const BASE = "/api/v1";

export async function apiGet<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, credentials: "include", headers: { "X-Requested-With": "ResInvestERP", ...(init.headers ?? {}) } });
  } catch {
    throw new ApiRequestError(0, { ok: false, code: "OFFLINE", error: "Brak połączenia z serwerem. Sprawdź połączenie VPN (FortiClient) i sieć." });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, body as ApiError | null);
  return body as T;
}

export interface HealthReport {
  ok: boolean;
  version: string;
  time: string;
  database: { ok: boolean; latencyMs: number | null; migrations: number | null; pendingCheck: string | null };
}
