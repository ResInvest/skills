import { useSyncExternalStore } from "react";

/**
 * Samouczek: opisy pod polami formularzy i pod kolumnami tabel. Włączony domyślnie; wybór użytkownika zapamiętuje
 * przeglądarka (to tylko wygoda widoku — żadne dane firmy nie są tu zapisywane). Brak dostępu do pamięci przeglądarki
 * (okno prywatne, blokada) = samouczek włączony.
 */
const KEY = "resinvest.tutorial";
const listeners = new Set<() => void>();
const read = (): boolean => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
let current = read();

export function setTutorial(on: boolean) {
  current = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* pamięć przeglądarki niedostępna — zostaje do odświeżenia */ }
  listeners.forEach(l => l());
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const useTutorial = () => useSyncExternalStore(subscribe, () => current, () => true);

/** Opis pola (pod kontrolką); bez tekstu albo przy wyłączonym samouczku nic nie rysuje. */
export function Hint({ text, id }: { text: string | undefined; id?: string }) {
  const on = useTutorial();
  if (!on || !text) return null;
  return <small className="tut" data-tut={id}>{text}</small>;
}

/** Opis kolumn tabeli — lista pod tabelą (na telefonie tabele są kartami, więc opis nie może siedzieć w nagłówku). */
export function ColumnHelp({ items, id }: { items: ReadonlyArray<readonly [string, string]>; id?: string }) {
  const on = useTutorial();
  if (!on) return null;
  return (
    <details className="tut-cols" id={id}>
      <summary>Opis kolumn</summary>
      <dl>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </details>
  );
}

export function TutorialToggle() {
  const on = useTutorial();
  return (
    <button type="button" className={`btn sm${on ? " on" : ""}`} id="tut-toggle" aria-pressed={on} onClick={() => setTutorial(!on)}
      title="Opisy pod polami i kolumnami">{on ? "Samouczek: włączony" : "Samouczek: wyłączony"}</button>
  );
}
