import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { hashPassword } from "../src/auth/password.js";
import { seedReferenceData } from "../src/seed/seed.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { MailService } from "../src/mail/mail.service.js";

export const PW = "Plac-Zrebki-2026";
export const ORIGIN = "http://localhost:5173";

/** Klient HTTP z ciasteczkiem sesji (jak przeglądarka) i nagłówkami CSRF. */
export function client(app: INestApplication) {
  const agent = request.agent(app.getHttpServer());
  const h = { "X-Requested-With": "ResInvestERP", Origin: ORIGIN };
  return {
    agent,
    get: (url: string) => agent.get(`/api/v1${url}`),
    post: (url: string, body: object = {}) => agent.post(`/api/v1${url}`).set(h).send(body),
    patch: (url: string, body: object = {}) => agent.patch(`/api/v1${url}`).set(h).send(body),
    put: (url: string, body: object = {}) => agent.put(`/api/v1${url}`).set(h).send(body),
    del: (url: string) => agent.delete(`/api/v1${url}`).set(h),
    login: (email: string, password = PW) => agent.post("/api/v1/auth/login").set(h).send({ email, password }),
  };
}
export type Client = ReturnType<typeof client>;

/**
 * Konta testowe (unikalne dla pliku testów): administrator (globalny), kierownik Zabrze + Brąszewice,
 * magazynier Brąszewice, obserwator Zabrze, audytor. Hasło: PW.
 */
export async function fixture(app: INestApplication, tag: string) {
  const db = app.get(PrismaService);
  await seedReferenceData(db as never);
  const wh = Object.fromEntries((await db.warehouse.findMany()).map(w => [w.code, w.id])) as Record<string, string>;
  const role = Object.fromEntries((await db.role.findMany()).map(r => [r.code, r.id])) as Record<string, string>;
  const hash = await hashPassword(PW);
  const mk = async (key: string, roleCode: string, whs: string[], extra: Record<string, unknown> = {}) => {
    const email = `${key}.${tag}@resinvest.group`;
    return db.user.create({ data: { email, firstName: key, lastName: tag, roleId: role[roleCode]!, status: "ACTIVE", passwordHash: hash, defaultWarehouseId: whs[0] ?? null,
      warehouses: { create: whs.map(warehouseId => ({ warehouseId })) }, ...extra } });
  };
  const users = {
    admin: await mk("admin", "ADMINISTRATOR", []),
    mgr: await mk("kierownik", "MANAGER", [wh.ZAB!, wh.BRA!]),
    mag: await mk("magazynier", "MAGAZYNIER", [wh.BRA!]),
    view: await mk("obserwator", "OBSERWATOR", [wh.ZAB!]),
    aud: await mk("audytor", "AUDYTOR", []),
  };
  return { db, wh, role, users, mail: app.get(MailService) };
}

/** Ostatni link z wiadomości w kolejce do danego adresu (przed wysyłką treść jest w bazie). */
export async function lastMailLink(db: PrismaService, to: string, path: string): Promise<string> {
  const m = await db.mailOutbox.findFirst({ where: { toAddress: to }, orderBy: { createdAt: "desc" } });
  const text = (m?.payload as { text?: string } | null)?.text ?? "";
  const hit = text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!hit?.[1]) throw new Error(`Brak linku ${path} w poczcie do ${to}`);
  return decodeURIComponent(hit[1]);
}
