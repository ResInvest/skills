import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDbUrl } from "./helpers.js";

/**
 * Gwarancje na poziomie bazy (niezależne od kodu API): dane niezmienne, brak stanu ujemnego,
 * spójność MM, unikalność numerów dokumentów, poprawność kartotek.
 */
let pool: Pool;
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
const ids = { zab: "", bra: "", role: "", user: "", mat: "", op: "" };

beforeAll(async () => {
  pool = new Pool({ connectionString: testDbUrl(), max: 5 });
  const wh = async (code: string) => (await q(`INSERT INTO warehouses(id, code, name, updated_at) VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id`, [code, `Test ${code}`])).rows[0].id as string;
  ids.zab = await wh("TST1"); ids.bra = await wh("TST2");
  ids.role = (await q(`INSERT INTO roles(id, code, name, updated_at) VALUES (gen_random_uuid(), 'TEST_CONSTRAINTS', 'Rola testowa', now()) RETURNING id`)).rows[0].id;
  ids.user = (await q(`INSERT INTO users(id, email, first_name, last_name, role_id, updated_at) VALUES (gen_random_uuid(), 'jan.kowalski@resinvest.group', 'Jan', 'Kowalski', $1, now()) RETURNING id`, [ids.role])).rows[0].id;
  ids.mat = (await q(`INSERT INTO materials(id, code, name, category, stock_unit, allowed_units, updated_at) VALUES (gen_random_uuid(), 'TST-ZR', 'Zrębka testowa', 'CHIPS', 'MP', '{MP,T}', now()) RETURNING id`)).rows[0].id;
  ids.op = (await q(`INSERT INTO operations(id, type, warehouse_id, operation_date, idempotency_key, created_by_id, updated_at) VALUES (gen_random_uuid(), 'OPENING_BALANCE', $1, '2026-10-01', 'bo-zab', $2, now()) RETURNING id`, [ids.zab, ids.user])).rows[0].id;
});
afterAll(async () => { await pool.end(); });

describe("dane tylko do dopisywania", () => {
  it("audit_log: UPDATE, DELETE i TRUNCATE zabronione", async () => {
    await q(`INSERT INTO audit_log(action, entity) VALUES ('TEST', 'system')`);
    await expect(q(`UPDATE audit_log SET action = 'X'`)).rejects.toThrow(/tylko do dopisywania/);
    await expect(q(`DELETE FROM audit_log`)).rejects.toThrow(/tylko do dopisywania/);
    await expect(q(`TRUNCATE audit_log`)).rejects.toThrow(/tylko do dopisywania/);
  });
  it("stock_movements: ruch zerowy odrzucony, zapisany ruch niezmienny", async () => {
    await expect(q(`INSERT INTO stock_movements(id, warehouse_id, material_id, operation_id, kind, qty, movement_date, created_by_id) VALUES (gen_random_uuid(), $1, $2, $3, 'OPENING', 0, '2026-10-01', $4)`, [ids.zab, ids.mat, ids.op, ids.user])).rejects.toThrow(/stock_movements_qty_chk/);
    await q(`INSERT INTO stock_movements(id, warehouse_id, material_id, operation_id, kind, qty, movement_date, created_by_id) VALUES (gen_random_uuid(), $1, $2, $3, 'OPENING', 100, '2026-10-01', $4)`, [ids.zab, ids.mat, ids.op, ids.user]);
    await expect(q(`UPDATE stock_movements SET qty = 1`)).rejects.toThrow(/tylko do dopisywania/);
    await expect(q(`DELETE FROM stock_movements`)).rejects.toThrow(/tylko do dopisywania/);
  });
});

describe("stan magazynu nie może spaść poniżej zera", () => {
  it("dwie równoczesne sprzedaże tego samego towaru — druga odrzucona", async () => {
    await q(`INSERT INTO stock_balances(warehouse_id, material_id, qty, updated_at) VALUES ($1, $2, 100, now())`, [ids.zab, ids.mat]);
    const sell = async (qty: number) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SELECT qty FROM stock_balances WHERE warehouse_id = $1 AND material_id = $2 FOR UPDATE`, [ids.zab, ids.mat]);
        await new Promise(r => setTimeout(r, 50));                    // okno wyścigu
        await c.query(`UPDATE stock_balances SET qty = qty - $3, updated_at = now() WHERE warehouse_id = $1 AND material_id = $2`, [ids.zab, ids.mat, qty]);
        await c.query("COMMIT");
        return "ok";
      } catch (e) { await c.query("ROLLBACK"); return (e as Error).message; } finally { c.release(); }
    };
    const res = await Promise.all([sell(70), sell(70)]);
    expect(res.filter(r => r === "ok")).toHaveLength(1);
    expect(res.find(r => r !== "ok")).toMatch(/stock_balances_non_negative_chk/);
    expect(Number((await q(`SELECT qty FROM stock_balances WHERE warehouse_id = $1 AND material_id = $2`, [ids.zab, ids.mat])).rows[0].qty)).toBe(30);
  });
});

describe("spójność operacji i dokumentów", () => {
  it("MM wymaga magazynu docelowego innego niż źródłowy i stanu przesunięcia", async () => {
    const ins = (target: string | null, state: string | null, key: string) => q(`INSERT INTO operations(id, type, warehouse_id, target_warehouse_id, transfer_state, operation_date, idempotency_key, created_by_id, updated_at) VALUES (gen_random_uuid(), 'TRANSFER', $1, $2, $3, '2026-10-02', $4, $5, now())`, [ids.zab, target, state, key, ids.user]);
    await expect(ins(null, "IN_TRANSIT", "mm-1")).rejects.toThrow(/operations_transfer_target_chk/);
    await expect(ins(ids.zab, "IN_TRANSIT", "mm-2")).rejects.toThrow(/operations_transfer_target_chk/);
    await expect(ins(ids.bra, "IN_TRANSIT", "mm-3")).resolves.toBeDefined();
  });
  it("klucz idempotencji operacji jest unikalny (brak podwójnego zapisu)", async () => {
    await expect(q(`INSERT INTO operations(id, type, warehouse_id, operation_date, idempotency_key, created_by_id, updated_at) VALUES (gen_random_uuid(), 'SALE', $1, '2026-10-02', 'bo-zab', $2, now())`, [ids.zab, ids.user])).rejects.toThrow(/idempotency_key/);
  });
  it("numer PZ unikalny w magazynie i roku; rok zgodny z datą dokumentu", async () => {
    const doc = (wh: string, no: string, year: number, date: string) => q(`INSERT INTO documents(id, operation_id, type, number, year, warehouse_id, document_date, movement_date, created_by_id, updated_at) VALUES (gen_random_uuid(), $1, 'PZ', $2, $3, $4, $5, $5, $6, now())`, [ids.op, no, year, wh, date, ids.user]);
    await doc(ids.zab, "PZ/11", 2026, "2026-09-07");
    await expect(doc(ids.zab, "PZ/11", 2026, "2026-09-08")).rejects.toThrow(/documents_type_warehouse_id_year_number_key/);
    await expect(doc(ids.bra, "PZ/11", 2026, "2026-09-08")).resolves.toBeDefined();
    await expect(doc(ids.zab, "PZ/12", 2025, "2026-09-08")).rejects.toThrow(/documents_year_chk/);
    await expect(doc(ids.zab, "  ", 2026, "2026-09-08")).rejects.toThrow(/documents_number_chk/);
  });
});

describe("kartoteki", () => {
  it("e-mail użytkownika zapisany małymi literami", async () => {
    await expect(q(`INSERT INTO users(id, email, first_name, last_name, role_id, updated_at) VALUES (gen_random_uuid(), 'Anna@resinvest.group', 'A', 'B', $1, now())`, [ids.role])).rejects.toThrow(/users_email_normalized_chk/);
  });
  it("jednostka magazynowa materiału musi być dozwolona", async () => {
    await expect(q(`INSERT INTO materials(id, code, name, category, stock_unit, allowed_units, updated_at) VALUES (gen_random_uuid(), 'X', 'X', 'OTHER', 'T', '{MP}', now())`)).rejects.toThrow(/materials_stock_unit_allowed_chk/);
  });
  it("rębak firmy zewnętrznej wymaga firmy", async () => {
    await expect(q(`INSERT INTO chippers(id, name, ownership, updated_at) VALUES (gen_random_uuid(), 'Rębak obcy', 'EXTERNAL', now())`)).rejects.toThrow(/chippers_external_company_chk/);
    const co = (await q(`INSERT INTO external_companies(id, name, kind, updated_at) VALUES (gen_random_uuid(), 'Usługi Leśne Nowak', 'CHIPPING', now()) RETURNING id`)).rows[0].id;
    await expect(q(`INSERT INTO chippers(id, name, ownership, external_company_id, external_operator, updated_at) VALUES (gen_random_uuid(), 'Jenz 583', 'EXTERNAL', $1, 'P. Nowak', now())`, [co])).resolves.toBeDefined();
  });
  it("jeden zatwierdzony bilans otwarcia na magazyn", async () => {
    const batch = (status: string) => q(`INSERT INTO opening_balance_batches(id, warehouse_id, effective_date, status, created_by_id, approved_at, approved_by_id) VALUES (gen_random_uuid(), $1, '2026-10-01', $2::"OpeningBatchStatus", $3, CASE WHEN $2::text = 'APPROVED' THEN now() END, CASE WHEN $2::text = 'APPROVED' THEN $3::uuid END)`, [ids.bra, status, ids.user]);
    await batch("APPROVED");
    await expect(batch("APPROVED")).rejects.toThrow(/opening_balance_batches_one_approved_per_wh/);
    await expect(batch("DRAFT")).resolves.toBeDefined();
  });
});
