import { useQuery } from "@tanstack/react-query";
import { api, ApiRequestError, type HealthReport } from "../api/client";
import { fmtDateTime, t, tm } from "../i18n";

/** Stan połączenia: serwer aplikacji → baza danych. Pierwszy ekran diagnostyczny (VPN, serwer, baza). */
export function SystemStatus() {
  const q = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.get<HealthReport>("/health", signal),
    retry: false,
    refetchInterval: 60_000,
  });
  const err = q.error instanceof ApiRequestError ? q.error : null;
  const busy = q.isFetching;

  return (
    <section className="card" aria-labelledby="status-h" aria-live="polite">
      <header className="card-h">
        <h2 id="status-h">{t("Stan systemu")}</h2>
        <button type="button" className="btn" onClick={() => void q.refetch()} disabled={busy}>{busy ? t("Sprawdzanie…") : t("Sprawdź ponownie")}</button>
      </header>
      {q.isPending && <p className="muted">{t("Sprawdzanie połączenia…")}</p>}
      {q.isError && (
        <div className="alert err" role="alert">
          <strong>{err?.body?.code === "NETWORK" ? t("Brak dostępu z tej sieci") : t("Serwer niedostępny")}</strong>
          <span>{err ? tm(err.message) : t("Nieznany błąd")}</span>
        </div>
      )}
      {q.isSuccess && (
        <dl className="kv">
          <dt>{t("Serwer aplikacji")}</dt><dd><span className="badge ok">{t("działa")}</span> {t("wersja {v}", { v: q.data.version })}</dd>
          <dt>{t("Baza danych")}</dt>
          <dd>{q.data.database.ok
            ? <><span className="badge ok">{t("połączona")}</span> {q.data.database.latencyMs} ms · {t("migracje: {n}", { n: q.data.database.migrations ?? "—" })}</>
            : <span className="badge err">{t("niedostępna")}</span>}</dd>
          <dt>{t("Czas serwera")}</dt><dd>{fmtDateTime(q.data.time)}</dd>
        </dl>
      )}
    </section>
  );
}
