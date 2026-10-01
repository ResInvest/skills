import { useState } from "react";
import { ApiRequestError, errorText, sessionEvents, type ApiErrorBody } from "../api/client";
import { useSession } from "../auth/session";
import { Alert } from "./components";

/** Nazwa pliku z nagłówka Content-Disposition (wersja UTF-8 ma pierwszeństwo). */
export function filenameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf?.[1]) { try { return decodeURIComponent(utf[1]); } catch { /* zła sekwencja — wersja ASCII */ } }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

/**
 * Pobranie pliku z API (sesja w ciasteczku, nagłówek CSRF jak w kliencie REST). Błąd serwera (JSON) → ApiRequestError
 * z polskim komunikatem; plik → zapis przez przeglądarkę. Treść nie jest przechowywana w aplikacji.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { credentials: "include", headers: { "X-Requested-With": "ResInvestERP" } });
  } catch {
    throw new ApiRequestError(0, { ok: false, code: "OFFLINE", error: "Brak połączenia z serwerem. Sprawdź połączenie VPN (FortiClient) i sieć." });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    if (res.status === 401) sessionEvents.dispatchEvent(new Event("unauthorized"));
    throw new ApiRequestError(res.status, body);
  }
  const name = filenameFrom(res.headers.get("Content-Disposition"), fallbackName);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

const FORMATS = [["csv", "CSV"], ["xlsx", "Excel"], ["pdf", "PDF"], ["docx", "Word"]] as const;

/** Przyciski eksportu raportu (uprawnienie „Eksport”); `query` — parametry raportu bez formatu. */
export function ExportButtons({ query, label = "Eksport", disabled }: { query: Record<string, string | number | undefined>; label?: string; disabled?: boolean }) {
  const { can } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!can("reports.export")) return null;
  const run = async (format: string) => {
    setBusy(format); setErr(null); setDone(null);
    const qs = new URLSearchParams(Object.entries({ ...query, format }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    try { setDone(await downloadFile(`/reports/export?${qs.toString()}`, `raport.${format}`)); }
    catch (e) { setErr(errorText(e)); }
    finally { setBusy(null); }
  };
  return (
    <div className="export" role="group" aria-label={label}>
      <span className="muted small">{label}:</span>
      {FORMATS.map(([f, l]) => <button key={f} type="button" className="btn sm" data-export={f} disabled={disabled || !!busy} onClick={() => void run(f)}>{busy === f ? "…" : l}</button>)}
      {err && <Alert kind="err">{err}</Alert>}
      {done && <small className="muted" data-export-done>Pobrano: {done}</small>}
    </div>
  );
}
