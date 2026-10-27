import { Inject, Injectable } from "@nestjs/common";
import { isOfferedEvent, NOTIFICATION_EVENTS, NOTIFICATION_LABEL, notificationSubject, type NotificationEvent } from "@resinvest/domain";
import type { Prisma } from "../generated/prisma/client.js";
import { badRequest, conflict, notFound } from "../common/errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { ENV, type Env } from "../config/env.js";
import { AuditService } from "../audit/audit.service.js";
import { MailService } from "../mail/mail.service.js";
import { LINK_TEMPLATES } from "../mail/templates.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { displayName, type AuthUser } from "../auth/auth-user.js";

export interface NotifyEvent {
  /** Zdarzenia, które wywołuje zmiana (odbiorca dostaje jedną wiadomość z tymi, które włączył). */
  events: NotificationEvent[];
  /** Magazyny, których dotyczy zmiana — odbiorca musi mieć dostęp do co najmniej jednego. */
  warehouseIds: string[];
  numbers: string[];
  /** Linie treści „Pole: wartość”. */
  lines: string[];
  /** Odnośnik (ścieżka w aplikacji) i identyfikator zdarzenia (np. operation:<id>). */
  path: string; ref: string;
}

/**
 * F7 — powiadomienia e-mail. `notify` działa WEWNĄTRZ transakcji operacji i tylko dopisuje wiadomości do kolejki
 * (mail_outbox): błąd serwera poczty nie cofa operacji, a operacja zapisana = powiadomienie zapisane.
 * Odbiorca: konto aktywne, dostęp do magazynu zmiany (rola globalna albo przydział), zdarzenie włączone przez
 * użytkownika I dozwolone przez administratora; autor zmiany nie dostaje powiadomienia o własnej operacji.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(ENV) private readonly env: Env, private readonly db: PrismaService, private readonly mail: MailService, private readonly audit: AuditService) {}

  async notify(tx: Db, actor: AuthUser, e: NotifyEvent): Promise<number> {
    const events = e.events.filter(isOfferedEvent);
    if (!events.length) return 0;
    const users = await tx.user.findMany({
      where: {
        status: "ACTIVE", id: { not: actor.id },
        notificationSettings: { some: { event: { in: events }, enabled: true, allowedByAdmin: true } },
        OR: [{ role: { global: true } }, { warehouses: { some: { warehouseId: { in: e.warehouseIds } } } }],
      },
      select: { id: true, email: true, firstName: true, lastName: true, notificationSettings: { where: { event: { in: events }, enabled: true, allowedByAdmin: true }, select: { event: true } } },
    });
    const url = `${this.env.APP_URL.replace(/\/$/, "")}${e.path}`;
    const lines = [...e.lines, `Wprowadził: ${displayName(actor)}`].join("\n");
    for (const u of users) {
      const mine = events.filter(ev => u.notificationSettings.some(s => s.event === ev));
      const subject = notificationSubject(mine, e.numbers);
      await this.mail.enqueue(tx, "notification", u.email, { name: displayName(u), title: mine.map(ev => NOTIFICATION_LABEL[ev]).join(", "), subject, lines, url }, e.ref);
    }
    return users.length;
  }

  /** Ustawienia użytkownika: każde oferowane zdarzenie z „włączone” i „dozwolone przez administratora”. */
  async settings(userId: string) {
    const rows = await this.db.notificationSetting.findMany({ where: { userId } });
    return NOTIFICATION_EVENTS.map(x => {
      const r = rows.find(s => s.event === x.event);
      return { ...x, enabled: !!r?.enabled, allowed: !!r?.allowedByAdmin };
    });
  }

  /** Użytkownik włącza / wyłącza zdarzenia — tylko te, na które administrator wyraził zgodę. */
  async setOwn(actor: AuthUser, changes: Record<string, boolean>, meta: RequestMeta) {
    const current = await this.settings(actor.id);
    const before: Record<string, boolean> = {}, after: Record<string, boolean> = {};
    await this.db.$transaction(async tx => {
      for (const [ev, on] of Object.entries(changes)) {
        if (!isOfferedEvent(ev)) throw badRequest("VALIDATION", "Nieznany rodzaj powiadomienia.");
        const c = current.find(x => x.event === ev)!;
        if (on && !c.allowed) throw badRequest("NOT_ALLOWED", `Powiadomienie „${c.label}” nie zostało włączone przez administratora.`);
        if (c.enabled === on) continue;
        before[c.label] = c.enabled; after[c.label] = on;
        await tx.notificationSetting.upsert({ where: { userId_event: { userId: actor.id, event: ev } }, update: { enabled: on }, create: { userId: actor.id, event: ev, enabled: on } });
      }
      if (Object.keys(after).length) await this.audit.log(tx, actor, meta, { action: "NOTIFICATIONS_CHANGED", entity: "user", entityId: actor.id, before, after });
    });
    return this.settings(actor.id);
  }

  /** Administrator zezwala / odbiera zgodę na zdarzenia dla użytkownika (odebranie zgody wyłącza też wysyłkę). */
  async setAllowed(actor: AuthUser, userId: string, changes: Record<string, boolean>, meta: RequestMeta) {
    const u = await this.db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!u) throw notFound("Nie znaleziono użytkownika.");
    const current = await this.settings(userId);
    const before: Record<string, boolean> = {}, after: Record<string, boolean> = {};
    await this.db.$transaction(async tx => {
      for (const [ev, on] of Object.entries(changes)) {
        if (!isOfferedEvent(ev)) throw badRequest("VALIDATION", "Nieznany rodzaj powiadomienia.");
        const c = current.find(x => x.event === ev)!;
        if (c.allowed === on) continue;
        before[c.label] = c.allowed; after[c.label] = on;
        await tx.notificationSetting.upsert({ where: { userId_event: { userId, event: ev } },
          update: on ? { allowedByAdmin: true } : { allowedByAdmin: false, enabled: false }, create: { userId, event: ev, allowedByAdmin: on, enabled: false } });
      }
      if (Object.keys(after).length) await this.audit.log(tx, actor, meta, { action: "NOTIFICATIONS_ALLOWED", entity: "user", entityId: userId, before, after: { konto: u.email, ...after } });
    });
    return this.settings(userId);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Dziennik wysyłki (administrator)
  // ---------------------------------------------------------------------------------------------------------

  async outbox(q: { status?: string; q?: string; page: number; pageSize: number }) {
    const where: Prisma.MailOutboxWhereInput = {
      ...(q.status ? { status: q.status as Prisma.EnumMailStatusFilter["equals"] } : {}),
      ...(q.q?.trim() ? { OR: [{ toAddress: { contains: q.q.trim(), mode: "insensitive" } }, { subject: { contains: q.q.trim(), mode: "insensitive" } }] } : {}),
    };
    const [total, rows, counts] = await Promise.all([
      this.db.mailOutbox.count({ where }),
      this.db.mailOutbox.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        select: { id: true, template: true, toAddress: true, subject: true, status: true, attempts: true, nextAttemptAt: true, lastError: true, createdAt: true, sentAt: true, eventRef: true, payload: true } }),
      this.db.mailOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    return {
      transport: this.mail.transport.name, worker: this.env.MAIL_WORKER, total,
      counts: Object.fromEntries(counts.map(c => [c.status, c._count._all])),
      rows: rows.map(({ payload, ...r }) => ({ ...r, retryable: (r.status === "FAILED" || r.status === "DEAD") && hasContent(payload) })),
    };
  }

  /** Ponowienie wiadomości nieudanej / porzuconej: od razu do kolejki, licznik prób od zera; wysyłka natychmiast. */
  async retry(actor: AuthUser, id: string, meta: RequestMeta) {
    const m = await this.db.mailOutbox.findUnique({ where: { id } });
    if (!m) throw notFound("Nie znaleziono wiadomości.");
    if (m.status !== "FAILED" && m.status !== "DEAD") throw conflict("NOT_RETRYABLE", "Ponowić można tylko wiadomość nieudaną albo porzuconą.");
    if (!hasContent(m.payload)) throw conflict("NO_CONTENT", LINK_TEMPLATES.has(m.template)
      ? "Treść zawierała jednorazowy link i została usunięta — wyślij nowe zaproszenie / link resetu z karty użytkownika."
      : "Treść wiadomości nie jest już dostępna.");
    await this.db.$transaction(async tx => {
      await tx.mailOutbox.update({ where: { id }, data: { status: "QUEUED", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
      await this.audit.log(tx, actor, meta, { action: "MAIL_RETRIED", entity: "mail", entityId: id, before: { status: m.status, proby: m.attempts, blad: m.lastError }, after: { do: m.toAddress, temat: m.subject } });
    });
    await this.mail.drain();
    return this.db.mailOutbox.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, attempts: true, lastError: true, sentAt: true } });
  }

  /** Wiadomość testowa na adres administratora i natychmiastowa próba wysyłki kolejki. */
  async test(actor: AuthUser, meta: RequestMeta) {
    const when = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
    const id = await this.db.$transaction(async tx => {
      const mid = await this.mail.enqueue(tx, "test", actor.email, { by: displayName(actor), when, transport: this.mail.transport.name }, `test:${actor.id}`);
      await this.audit.log(tx, actor, meta, { action: "MAIL_TEST", entity: "mail", entityId: mid, after: { do: actor.email, kanal: this.mail.transport.name } });
      return mid;
    });
    await this.mail.drain();
    return this.db.mailOutbox.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, attempts: true, lastError: true, sentAt: true } });
  }

  /** „Wyślij teraz” — przetworzenie kolejki bez czekania na cykl procesu wysyłki. */
  async drainNow() { return { processed: await this.mail.drain(50) }; }
}

const hasContent = (p: Prisma.JsonValue) => !!p && typeof p === "object" && !Array.isArray(p) && typeof (p as Record<string, unknown>).text === "string";
