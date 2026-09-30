import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Role, Warehouse } from "../../api/types";
import type { useSession } from "../../auth/session";

export const useRoles = () => useQuery({ queryKey: ["roles"], queryFn: async ({ signal }) => (await api.get<{ roles: Role[] }>("/roles", signal)).roles, staleTime: 60_000 });

/**
 * Role, które zalogowany może nadać — odbicie reguł serwera (serwer i tak je sprawdza):
 * bez „roles.assign” tylko MAGAZYNIER / OBSERWATOR; ADMINISTRATOR wyłącznie przez administratora.
 */
export function assignableRoles(roles: Role[], session: Pick<ReturnType<typeof useSession>, "user" | "can">, current?: string): Role[] {
  const isAdmin = session.user?.role.code === "ADMINISTRATOR";
  return roles.filter(r => r.code === current || (r.code === "ADMINISTRATOR" ? isAdmin : session.can("roles.assign") || ["MAGAZYNIER", "OBSERWATOR"].includes(r.code)));
}

/** Wybór magazynów (pola wyboru) + magazyn domyślny spośród zaznaczonych. */
export function WarehousePicker({ warehouses, value, onChange, def, onDefault, disabled, error }: {
  warehouses: Warehouse[]; value: string[]; onChange: (ids: string[]) => void; def: string | null; onDefault: (id: string | null) => void; disabled?: boolean; error?: string | undefined;
}) {
  const id = useId();
  const toggle = (w: string, on: boolean) => {
    const next = on ? [...value, w] : value.filter(x => x !== w);
    onChange(next);
    if (!next.includes(def ?? "")) onDefault(next[0] ?? null);
  };
  return (
    <fieldset className={`field fs ${error ? "has-error" : ""}`} disabled={disabled} aria-describedby={error ? `${id}-e` : undefined}>
      <legend>Magazyny</legend>
      <div className="checks">
        {warehouses.map(w => (
          <label key={w.id} className="check"><input type="checkbox" checked={value.includes(w.id)} onChange={e => toggle(w.id, e.target.checked)} /> {w.name}</label>
        ))}
      </div>
      {value.length > 0 && (
        <label className="inline">Domyślny:{" "}
          <select className="ctrl" value={def ?? ""} onChange={e => onDefault(e.target.value || null)}>
            {warehouses.filter(w => value.includes(w.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
      )}
      {error && <small id={`${id}-e`} className="error" role="alert">{error}</small>}
    </fieldset>
  );
}
