import { UNIT_LABEL, CATEGORY_LABEL } from "../../api/types";

/** Opis kartotek dla interfejsu: kolumny tabeli i pola formularza (walidacja właściwa — w API). */
export type Kind = "materials" | "partners" | "additional-operation-types" | "vehicles" | "chippers" | "drivers" | "operators" | "external-companies";
export type Row = Record<string, unknown> & { id: string; version: number };

export type FieldDef =
  | { key: string; label: string; type: "text"; required?: boolean; max?: number; hint?: string; upper?: boolean }
  | { key: string; label: string; type: "decimal"; hint?: string; suffix?: string }
  | { key: string; label: string; type: "select"; options: Array<[string, string]>; required?: boolean; hint?: string }
  | { key: string; label: string; type: "units" }
  | { key: string; label: string; type: "bool" }
  | { key: string; label: string; type: "tags"; hint?: string }
  | { key: string; label: string; type: "ref"; ref: Kind | "warehouses"; empty: string; hint?: string; when?: (f: Record<string, unknown>) => boolean };

export interface KindUi {
  kind: Kind; title: string; single: string; perm: "master.edit" | "fleet.edit"; group: "Materiały i kontrahenci" | "Flota";
  columns: Array<{ key: string; label: string; render?: (r: Row, ref: (k: Kind | "warehouses", id: unknown) => string) => string; num?: boolean }>;
  fields: FieldDef[];
  defaults: Record<string, unknown>;
  activeField: "active" | "status";
  label: (r: Row) => string;
}

const units: Array<[string, string]> = [["M3", UNIT_LABEL.M3], ["MP", UNIT_LABEL.MP], ["T", UNIT_LABEL.T]];
const STATUS: Array<[string, string]> = [["ACTIVE", "Aktywny"], ["SERVICE", "Serwis"], ["RETIRED", "Wycofany"]];
const OWN: Array<[string, string]> = [["OWN", "Własny"], ["EXTERNAL", "Firmy zewnętrznej"]];
export const statusLabel = (s: unknown) => STATUS.find(x => x[0] === s)?.[1] ?? String(s ?? "");
const yes = (v: unknown) => (v === false ? "nieaktywny" : "aktywny");
const ext = (f: Record<string, unknown>) => f.ownership === "EXTERNAL";

export const KIND_UI: KindUi[] = [
  {
    kind: "materials", title: "Materiały", single: "materiał", perm: "master.edit", group: "Materiały i kontrahenci", activeField: "active", label: r => String(r.name),
    columns: [
      { key: "name", label: "Nazwa", render: r => `${r.name}` }, { key: "code", label: "Kod" },
      { key: "category", label: "Grupa", render: r => CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? String(r.category) },
      { key: "stockUnit", label: "Jedn. magazynowa", render: r => UNIT_LABEL[r.stockUnit as keyof typeof UNIT_LABEL] },
      { key: "allowedUnits", label: "Jednostki na dokumentach", render: r => (r.allowedUnits as string[]).map(u => UNIT_LABEL[u as keyof typeof UNIT_LABEL]).join(", ") },
      { key: "active", label: "Status", render: r => yes(r.active) },
    ],
    fields: [
      { key: "name", label: "Nazwa", type: "text", required: true, max: 160 },
      { key: "code", label: "Kod", type: "text", required: true, max: 20, upper: true, hint: "Litery, cyfry i myślnik, np. ZR-PL" },
      { key: "category", label: "Grupa", type: "select", required: true, options: Object.entries(CATEGORY_LABEL) },
      { key: "stockUnit", label: "Jednostka magazynowa", type: "select", required: true, options: units, hint: "Nie zmienia się po pierwszym ruchu magazynowym" },
      { key: "allowedUnits", label: "Jednostki na dokumentach", type: "units" },
      { key: "mpPerM3", label: "MP z 1 m³ (puste = przelicznik firmowy 4)", type: "decimal" },
      { key: "tonPerUnit", label: "Masa 1 jednostki magazynowej [t] (puste = przelicznik firmowy)", type: "decimal" },
      { key: "tonPerM3", label: "Gęstość [t/m³] — dla materiałów w tonach przyjmowanych w m³ / MP", type: "decimal" },
      { key: "active", label: "Aktywny (widoczny w nowych dokumentach)", type: "bool" },
    ],
    defaults: { category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP", "M3", "T"], active: true },
  },
  {
    kind: "partners", title: "Kontrahenci", single: "kontrahenta", perm: "master.edit", group: "Materiały i kontrahenci", activeField: "active", label: r => String(r.name),
    columns: [
      { key: "name", label: "Nazwa" }, { key: "nip", label: "NIP", render: r => (r.nip ? String(r.nip) : "—") },
      { key: "role", label: "Rola", render: r => ({ SUPPLIER: "dostawca", BUYER: "odbiorca", BOTH: "dostawca i odbiorca" })[r.role as string] ?? "" },
      { key: "city", label: "Miejscowość", render: r => String(r.city ?? "—") }, { key: "active", label: "Status", render: r => yes(r.active) },
    ],
    fields: [
      { key: "name", label: "Nazwa", type: "text", required: true, max: 200 },
      { key: "nip", label: "NIP", type: "text", max: 20, hint: "10 cyfr — sprawdzana suma kontrolna" },
      { key: "role", label: "Rola", type: "select", required: true, options: [["SUPPLIER", "Dostawca"], ["BUYER", "Odbiorca"], ["BOTH", "Dostawca i odbiorca"]] },
      { key: "kind", label: "Rodzaj", type: "select", options: [["COMPANY", "Firma"], ["FOREST_DISTRICT", "Nadleśnictwo"]] },
      { key: "city", label: "Miejscowość", type: "text", max: 120 }, { key: "address", label: "Adres", type: "text", max: 250 },
      { key: "forestries", label: "Leśnictwa (nadleśnictwo)", type: "tags", hint: "Oddziel przecinkami" },
      { key: "active", label: "Aktywny", type: "bool" },
    ],
    defaults: { role: "SUPPLIER", kind: "COMPANY", forestries: [], active: true },
  },
  {
    kind: "additional-operation-types", title: "Dodatkowe operacje", single: "rodzaj operacji", perm: "master.edit", group: "Materiały i kontrahenci", activeField: "active", label: r => String(r.name),
    columns: [
      { key: "name", label: "Nazwa" }, { key: "description", label: "Opis", render: r => String(r.description ?? "—") },
      { key: "unit", label: "Jednostka", render: r => String(r.unit ?? "ryczałt") },
      { key: "defaultRate", label: "Stawka domyślna", num: true, render: r => (r.defaultRate ? `${String(r.defaultRate).replace(".", ",")} zł` : "—") },
      { key: "active", label: "Status", render: r => yes(r.active) },
    ],
    fields: [
      { key: "name", label: "Nazwa", type: "text", required: true, max: 120 }, { key: "description", label: "Opis", type: "text", max: 500 },
      { key: "unit", label: "Jednostka (puste = ryczałt)", type: "text", max: 20, hint: "np. h, km, szt." },
      { key: "defaultRate", label: "Stawka domyślna [zł]", type: "decimal" }, { key: "active", label: "Aktywny", type: "bool" },
    ],
    defaults: { active: true },
  },
  {
    kind: "vehicles", title: "Pojazdy", single: "pojazd", perm: "fleet.edit", group: "Flota", activeField: "status", label: r => `${r.registration} · ${r.name}`,
    columns: [
      { key: "registration", label: "Nr rej." }, { key: "name", label: "Nazwa" },
      { key: "ownership", label: "Właściciel", render: (r, ref) => (r.ownership === "EXTERNAL" ? ref("external-companies", r.externalCompanyId) : "własny") },
      { key: "warehouseId", label: "Magazyn", render: (r, ref) => (r.warehouseId ? ref("warehouses", r.warehouseId) : "wspólny") },
      { key: "defaultDriverId", label: "Kierowca", render: (r, ref) => (r.defaultDriverId ? ref("drivers", r.defaultDriverId) : "—") },
      { key: "status", label: "Status", render: r => statusLabel(r.status) },
    ],
    fields: [
      { key: "name", label: "Nazwa / opis", type: "text", required: true, max: 120 },
      { key: "registration", label: "Numer rejestracyjny", type: "text", required: true, upper: true, max: 20 },
      { key: "vehicleType", label: "Typ (np. ruchoma podłoga, wywrotka)", type: "text", max: 40 },
      { key: "ownership", label: "Właściciel", type: "select", options: OWN },
      { key: "externalCompanyId", label: "Firma — właściciel", type: "ref", ref: "external-companies", empty: "— wybierz firmę —", when: ext },
      { key: "warehouseId", label: "Magazyn", type: "ref", ref: "warehouses", empty: "wspólny dla wszystkich magazynów" },
      { key: "defaultDriverId", label: "Kierowca domyślny", type: "ref", ref: "drivers", empty: "— brak —" },
      { key: "status", label: "Status", type: "select", options: STATUS },
    ],
    defaults: { ownership: "OWN", status: "ACTIVE" },
  },
  {
    kind: "chippers", title: "Rębaki", single: "rębak", perm: "fleet.edit", group: "Flota", activeField: "status", label: r => String(r.name),
    columns: [
      { key: "name", label: "Rębak" },
      { key: "ownership", label: "Właściciel", render: (r, ref) => (r.ownership === "EXTERNAL" ? `firma: ${ref("external-companies", r.externalCompanyId)}` : "własny") },
      { key: "operatorId", label: "Operator", render: (r, ref) => (r.ownership === "EXTERNAL" ? String(r.externalOperator ?? "—") : r.operatorId ? ref("operators", r.operatorId) : "—") },
      { key: "registration", label: "Nr rej.", render: r => String(r.registration ?? "—") },
      { key: "warehouseId", label: "Magazyn", render: (r, ref) => (r.warehouseId ? ref("warehouses", r.warehouseId) : "wspólny") },
      { key: "status", label: "Status", render: r => statusLabel(r.status) },
    ],
    fields: [
      { key: "name", label: "Nazwa / model", type: "text", required: true, max: 120 },
      { key: "ownership", label: "Czyj jest rębak", type: "select", options: OWN },
      { key: "externalCompanyId", label: "Firma — właściciel rębaka", type: "ref", ref: "external-companies", empty: "— wybierz firmę —", when: ext },
      { key: "externalOperator", label: "Operator firmy zewnętrznej (opisowo)", type: "text", max: 120 },
      { key: "operatorId", label: "Operator (z kartoteki)", type: "ref", ref: "operators", empty: "— brak —", when: f => !ext(f) },
      { key: "registration", label: "Numer rejestracyjny (jeśli dotyczy)", type: "text", upper: true, max: 20 },
      { key: "warehouseId", label: "Magazyn", type: "ref", ref: "warehouses", empty: "wspólny dla wszystkich magazynów" },
      { key: "notes", label: "Informacje dodatkowe", type: "text", max: 500 },
      { key: "status", label: "Status", type: "select", options: STATUS },
    ],
    defaults: { ownership: "OWN", status: "ACTIVE" },
  },
  {
    kind: "drivers", title: "Kierowcy", single: "kierowcę", perm: "fleet.edit", group: "Flota", activeField: "active", label: r => String(r.name),
    columns: [{ key: "name", label: "Imię i nazwisko" }, { key: "phone", label: "Telefon", render: r => String(r.phone ?? "—") }, { key: "active", label: "Status", render: r => yes(r.active) }],
    fields: [{ key: "name", label: "Imię i nazwisko", type: "text", required: true, max: 120 }, { key: "phone", label: "Telefon", type: "text", max: 30 }, { key: "active", label: "Aktywny", type: "bool" }],
    defaults: { active: true },
  },
  {
    kind: "operators", title: "Operatorzy", single: "operatora", perm: "fleet.edit", group: "Flota", activeField: "active", label: r => String(r.name),
    columns: [{ key: "name", label: "Imię i nazwisko" }, { key: "phone", label: "Telefon", render: r => String(r.phone ?? "—") }, { key: "active", label: "Status", render: r => yes(r.active) }],
    fields: [{ key: "name", label: "Imię i nazwisko", type: "text", required: true, max: 120 }, { key: "phone", label: "Telefon", type: "text", max: 30 }, { key: "active", label: "Aktywny", type: "bool" }],
    defaults: { active: true },
  },
  {
    kind: "external-companies", title: "Firmy zewnętrzne", single: "firmę", perm: "fleet.edit", group: "Flota", activeField: "active", label: r => String(r.name),
    columns: [
      { key: "name", label: "Nazwa" }, { key: "kind", label: "Rodzaj", render: r => ({ TRANSPORT: "transport", CHIPPING: "rębanie", SERVICES: "usługi", OTHER: "inne" })[r.kind as string] ?? "" },
      { key: "nip", label: "NIP", render: r => String(r.nip ?? "—") }, { key: "contact", label: "Kontakt", render: r => String(r.contact ?? "—") }, { key: "active", label: "Status", render: r => yes(r.active) },
    ],
    fields: [
      { key: "name", label: "Nazwa", type: "text", required: true, max: 200 },
      { key: "kind", label: "Rodzaj", type: "select", required: true, options: [["TRANSPORT", "Transport"], ["CHIPPING", "Rębanie"], ["SERVICES", "Usługi"], ["OTHER", "Inne"]] },
      { key: "nip", label: "NIP", type: "text", max: 20 }, { key: "contact", label: "Kontakt", type: "text", max: 250 }, { key: "active", label: "Aktywna", type: "bool" },
    ],
    defaults: { kind: "TRANSPORT", active: true },
  },
];
export const kindUi = (k: string) => KIND_UI.find(x => x.kind === k) ?? KIND_UI[0]!;
