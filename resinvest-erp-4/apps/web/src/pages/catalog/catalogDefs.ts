import { UNIT_LABEL, CATEGORY_LABEL } from "../../api/types";
import { fmtMoney, m, t } from "../../i18n";

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
const STATUS: Array<[string, string]> = [["ACTIVE", m("Aktywny")], ["SERVICE", m("Serwis")], ["RETIRED", m("Wycofany")]];
const OWN: Array<[string, string]> = [["OWN", m("Własny")], ["EXTERNAL", m("Firmy zewnętrznej")]];
export const statusLabel = (s: unknown) => { const x = STATUS.find(y => y[0] === s)?.[1]; return x ? t(x) : String(s ?? ""); };
const yes = (v: unknown) => (v === false ? t("nieaktywny") : t("aktywny"));
/** Nazwy grup kartotek (typ `group` niżej) — do tłumaczenia przy wyświetlaniu. */
export const GROUP_NAMES = [m("Materiały i kontrahenci"), m("Flota")] as const;
const ext = (f: Record<string, unknown>) => f.ownership === "EXTERNAL";

export const KIND_UI: KindUi[] = [
  {
    kind: "materials", title: m("Materiały"), single: m("materiał"), perm: "master.edit", group: "Materiały i kontrahenci", activeField: "active", label: r => String(r.name),
    columns: [
      { key: "name", label: m("Nazwa"), render: r => `${r.name}` }, { key: "code", label: m("Kod") },
      { key: "category", label: m("Grupa"), render: r => CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? String(r.category) },
      { key: "stockUnit", label: m("Jedn. magazynowa"), render: r => UNIT_LABEL[r.stockUnit as keyof typeof UNIT_LABEL] },
      { key: "allowedUnits", label: m("Jednostki na dokumentach"), render: r => (r.allowedUnits as string[]).map(u => UNIT_LABEL[u as keyof typeof UNIT_LABEL]).join(", ") },
      { key: "active", label: m("Status"), render: r => yes(r.active) },
    ],
    fields: [
      { key: "name", label: m("Nazwa"), type: "text", required: true, max: 160 },
      { key: "code", label: m("Kod"), type: "text", required: true, max: 20, upper: true, hint: m("Litery, cyfry i myślnik, np. ZR-PL") },
      { key: "category", label: m("Grupa"), type: "select", required: true, options: Object.entries(CATEGORY_LABEL) },
      { key: "stockUnit", label: m("Jednostka magazynowa"), type: "select", required: true, options: units, hint: m("Nie zmienia się po pierwszym ruchu magazynowym") },
      { key: "allowedUnits", label: m("Jednostki na dokumentach"), type: "units" },
      { key: "mpPerM3", label: m("MP z 1 m³ (puste = przelicznik firmowy 4)"), type: "decimal" },
      { key: "tonPerUnit", label: m("Masa 1 jednostki magazynowej [t] (puste = przelicznik firmowy)"), type: "decimal" },
      { key: "tonPerM3", label: m("Gęstość [t/m³] — dla materiałów w tonach przyjmowanych w m³ / MP"), type: "decimal" },
      { key: "active", label: m("Aktywny (widoczny w nowych dokumentach)"), type: "bool" },
    ],
    defaults: { category: "CHIPS", stockUnit: "MP", allowedUnits: ["MP", "M3", "T"], active: true },
  },
  {
    kind: "partners", title: m("Kontrahenci"), single: m("kontrahenta"), perm: "master.edit", group: "Materiały i kontrahenci", activeField: "active", label: r => String(r.name),
    columns: [
      { key: "name", label: m("Nazwa") }, { key: "nip", label: m("NIP"), render: r => (r.nip ? String(r.nip) : "—") },
      { key: "role", label: m("Rola"), render: r => ({ SUPPLIER: t("dostawca"), BUYER: t("odbiorca"), BOTH: t("dostawca i odbiorca") })[r.role as string] ?? "" },
      { key: "city", label: m("Miejscowość"), render: r => String(r.city ?? "—") }, { key: "active", label: m("Status"), render: r => yes(r.active) },
    ],
    fields: [
      { key: "name", label: m("Nazwa"), type: "text", required: true, max: 200 },
      { key: "nip", label: m("NIP"), type: "text", max: 20, hint: m("10 cyfr — sprawdzana suma kontrolna") },
      { key: "role", label: m("Rola"), type: "select", required: true, options: [["SUPPLIER", m("Dostawca")], ["BUYER", m("Odbiorca")], ["BOTH", m("Dostawca i odbiorca")]] },
      { key: "kind", label: m("Rodzaj"), type: "select", options: [["COMPANY", m("Firma")], ["FOREST_DISTRICT", m("Nadleśnictwo")]] },
      { key: "city", label: m("Miejscowość"), type: "text", max: 120 }, { key: "address", label: m("Adres"), type: "text", max: 250 },
      { key: "forestries", label: m("Leśnictwa (nadleśnictwo)"), type: "tags", hint: m("Oddziel przecinkami") },
      { key: "active", label: m("Aktywny"), type: "bool" },
    ],
    defaults: { role: "SUPPLIER", kind: "COMPANY", forestries: [], active: true },
  },
  {
    kind: "additional-operation-types", title: m("Dodatkowe operacje"), single: m("rodzaj operacji"), perm: "master.edit", group: "Materiały i kontrahenci", activeField: "active", label: r => String(r.name),
    columns: [
      { key: "name", label: m("Nazwa") }, { key: "description", label: m("Opis"), render: r => String(r.description ?? "—") },
      { key: "unit", label: m("Jednostka"), render: r => String(r.unit ?? t("ryczałt")) },
      { key: "defaultRate", label: m("Stawka domyślna"), num: true, render: r => (r.defaultRate ? fmtMoney(String(r.defaultRate)) : "—") },
      { key: "active", label: m("Status"), render: r => yes(r.active) },
    ],
    fields: [
      { key: "name", label: m("Nazwa"), type: "text", required: true, max: 120 }, { key: "description", label: m("Opis"), type: "text", max: 500 },
      { key: "unit", label: m("Jednostka (puste = ryczałt)"), type: "text", max: 20, hint: m("np. h, km, szt.") },
      { key: "defaultRate", label: m("Stawka domyślna [zł]"), type: "decimal" }, { key: "active", label: m("Aktywny"), type: "bool" },
    ],
    defaults: { active: true },
  },
  {
    kind: "vehicles", title: m("Pojazdy"), single: m("pojazd"), perm: "fleet.edit", group: "Flota", activeField: "status", label: r => `${r.registration} · ${r.name}`,
    columns: [
      { key: "registration", label: m("Nr rej.") }, { key: "name", label: m("Nazwa") },
      { key: "ownership", label: m("Właściciel"), render: (r, ref) => (r.ownership === "EXTERNAL" ? ref("external-companies", r.externalCompanyId) : t("własny")) },
      { key: "warehouseId", label: m("Magazyn"), render: (r, ref) => (r.warehouseId ? ref("warehouses", r.warehouseId) : t("wspólny")) },
      { key: "defaultDriverId", label: m("Kierowca"), render: (r, ref) => (r.defaultDriverId ? ref("drivers", r.defaultDriverId) : "—") },
      { key: "status", label: m("Status"), render: r => statusLabel(r.status) },
    ],
    fields: [
      { key: "name", label: m("Nazwa / opis"), type: "text", required: true, max: 120 },
      { key: "registration", label: m("Numer rejestracyjny"), type: "text", required: true, upper: true, max: 20 },
      { key: "vehicleType", label: m("Typ (np. ruchoma podłoga, wywrotka)"), type: "text", max: 40 },
      { key: "ownership", label: m("Właściciel"), type: "select", options: OWN },
      { key: "externalCompanyId", label: m("Firma — właściciel"), type: "ref", ref: "external-companies", empty: m("— wybierz firmę —"), when: ext },
      { key: "warehouseId", label: m("Magazyn"), type: "ref", ref: "warehouses", empty: m("wspólny dla wszystkich magazynów") },
      { key: "defaultDriverId", label: m("Kierowca domyślny"), type: "ref", ref: "drivers", empty: m("— brak —") },
      { key: "status", label: m("Status"), type: "select", options: STATUS },
    ],
    defaults: { ownership: "OWN", status: "ACTIVE" },
  },
  {
    kind: "chippers", title: m("Rębaki"), single: m("rębak"), perm: "fleet.edit", group: "Flota", activeField: "status", label: r => String(r.name),
    columns: [
      { key: "name", label: m("Rębak") },
      { key: "ownership", label: m("Właściciel"), render: (r, ref) => (r.ownership === "EXTERNAL" ? t("firma: {name}", { name: ref("external-companies", r.externalCompanyId) }) : t("własny")) },
      { key: "operatorId", label: m("Operator"), render: (r, ref) => (r.ownership === "EXTERNAL" ? String(r.externalOperator ?? "—") : r.operatorId ? ref("operators", r.operatorId) : "—") },
      { key: "registration", label: m("Nr rej."), render: r => String(r.registration ?? "—") },
      { key: "warehouseId", label: m("Magazyn"), render: (r, ref) => (r.warehouseId ? ref("warehouses", r.warehouseId) : t("wspólny")) },
      { key: "status", label: m("Status"), render: r => statusLabel(r.status) },
    ],
    fields: [
      { key: "name", label: m("Nazwa / model"), type: "text", required: true, max: 120 },
      { key: "ownership", label: m("Czyj jest rębak"), type: "select", options: OWN },
      { key: "externalCompanyId", label: m("Firma — właściciel rębaka"), type: "ref", ref: "external-companies", empty: m("— wybierz firmę —"), when: ext },
      { key: "externalOperator", label: m("Operator firmy zewnętrznej (opisowo)"), type: "text", max: 120 },
      { key: "operatorId", label: m("Operator (z kartoteki)"), type: "ref", ref: "operators", empty: m("— brak —"), when: f => !ext(f) },
      { key: "registration", label: m("Numer rejestracyjny (jeśli dotyczy)"), type: "text", upper: true, max: 20 },
      { key: "warehouseId", label: m("Magazyn"), type: "ref", ref: "warehouses", empty: m("wspólny dla wszystkich magazynów") },
      { key: "notes", label: m("Informacje dodatkowe"), type: "text", max: 500 },
      { key: "status", label: m("Status"), type: "select", options: STATUS },
    ],
    defaults: { ownership: "OWN", status: "ACTIVE" },
  },
  {
    kind: "drivers", title: m("Kierowcy"), single: m("kierowcę"), perm: "fleet.edit", group: "Flota", activeField: "active", label: r => String(r.name),
    columns: [{ key: "name", label: m("Imię i nazwisko") }, { key: "phone", label: m("Telefon"), render: r => String(r.phone ?? "—") }, { key: "active", label: m("Status"), render: r => yes(r.active) }],
    fields: [{ key: "name", label: m("Imię i nazwisko"), type: "text", required: true, max: 120 }, { key: "phone", label: m("Telefon"), type: "text", max: 30 }, { key: "active", label: m("Aktywny"), type: "bool" }],
    defaults: { active: true },
  },
  {
    kind: "operators", title: m("Operatorzy"), single: m("operatora"), perm: "fleet.edit", group: "Flota", activeField: "active", label: r => String(r.name),
    columns: [{ key: "name", label: m("Imię i nazwisko") }, { key: "phone", label: m("Telefon"), render: r => String(r.phone ?? "—") }, { key: "active", label: m("Status"), render: r => yes(r.active) }],
    fields: [{ key: "name", label: m("Imię i nazwisko"), type: "text", required: true, max: 120 }, { key: "phone", label: m("Telefon"), type: "text", max: 30 }, { key: "active", label: m("Aktywny"), type: "bool" }],
    defaults: { active: true },
  },
  {
    kind: "external-companies", title: m("Firmy zewnętrzne"), single: m("firmę"), perm: "fleet.edit", group: "Flota", activeField: "active", label: r => String(r.name),
    columns: [
      { key: "name", label: m("Nazwa") }, { key: "kind", label: m("Rodzaj"), render: r => ({ TRANSPORT: t("transport"), CHIPPING: t("rębanie"), SERVICES: t("usługi"), OTHER: t("inne") })[r.kind as string] ?? "" },
      { key: "nip", label: m("NIP"), render: r => String(r.nip ?? "—") }, { key: "contact", label: m("Kontakt"), render: r => String(r.contact ?? "—") }, { key: "active", label: m("Status"), render: r => yes(r.active) },
    ],
    fields: [
      { key: "name", label: m("Nazwa"), type: "text", required: true, max: 200 },
      { key: "kind", label: m("Rodzaj"), type: "select", required: true, options: [["TRANSPORT", m("Transport")], ["CHIPPING", m("Rębanie")], ["SERVICES", m("Usługi")], ["OTHER", m("Inne")]] },
      { key: "nip", label: m("NIP"), type: "text", max: 20 }, { key: "contact", label: m("Kontakt"), type: "text", max: 250 }, { key: "active", label: m("Aktywna"), type: "bool" },
    ],
    defaults: { kind: "TRANSPORT", active: true },
  },
];
export const kindUi = (k: string) => KIND_UI.find(x => x.kind === k) ?? KIND_UI[0]!;
