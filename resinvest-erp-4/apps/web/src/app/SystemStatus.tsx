import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiRequestError, type HealthReport } from "../api/client";

/** Stan połączenia: serwer aplikacji → baza danych. Pierwszy ekran diagnostyczny (VPN, serwer, baza). */
export function SystemStatus() {
  const q = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => apiGet<HealthReport>("/health", { signal }),
    retry: false,
    refetchInterval: 60_000,
  });
  const err = q.error instanceof ApiRequestError ? q.error : null;
  const busy = q.isFetching;

  return (
    <section className="card" aria-labelledby="status-h" aria-live="polite">
      <header className="card-h">
        <h2 id="status-h">Stan systemu</h2>
        <button type="button" className="btn" onClick={() => void q.refetch()} disabled={busy}>{busy ? "Sprawdzanie…" : "Sprawdź ponownie"}</button>
      </header>
      {q.isPending && <p className="muted">Sprawdzanie połączenia…</p>}
      {q.isError && (
        <div className="alert err" role="alert">
          <strong>{err?.body?.code === "NETWORK" ? "Brak dostępu z tej sieci" : "Serwer niedostępny"}</strong>
          <span>{err?.message ?? "Nieznany błąd"}</span>
        </div>
      )}
      {q.isSuccess && (
        <dl className="kv">
          <dt>Serwer aplikacji</dt><dd><span className="badge ok">działa</span> wersja {q.data.version}</dd>
          <dt>Baza danych</dt>
          <dd>{q.data.database.ok
            ? <><span className="badge ok">połączona</span> {q.data.database.latencyMs} ms · migracje: {q.data.database.migrations}</>
            : <span className="badge err">niedostępna</span>}</dd>
          <dt>Czas serwera</dt><dd>{new Date(q.data.time).toLocaleString("pl-PL")}</dd>
        </dl>
      )}
    </section>
  );
}
