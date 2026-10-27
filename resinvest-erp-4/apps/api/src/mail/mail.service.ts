import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { LINK_TEMPLATES, renderMail, type MailTemplate } from "./templates.js";
import { createTransport, type MailTransport } from "./transports.js";

/** Odstępy kolejnych prób wysyłki (po błędzie): 1 min, 5 min, 15 min, 1 h, 6 h — potem DEAD. */
export const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
const SCRUBBED = { scrubbed: true, note: "Treść usunięta po wysyłce (zawierała jednorazowy link)" };

/**
 * Kolejka poczty (tabela mail_outbox). `enqueue` zapisuje wiadomość w transakcji operacji — błąd serwera poczty
 * nie cofa operacji. Wysyłka w tle, z ponowieniami; treść z linkami jest usuwana z bazy po wysłaniu lub porzuceniu.
 */
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Poczta");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  transport: MailTransport;

  constructor(@Inject(ENV) private readonly env: Env, private readonly db: PrismaService) { this.transport = createTransport(env); }

  onModuleInit(): void {
    if (this.env.MAIL_WORKER === "on") this.timer = setInterval(() => void this.drain(), 5_000);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async enqueue(db: Db, template: MailTemplate, to: string, data: Record<string, string>, eventRef?: string): Promise<string> {
    const m = renderMail(template, data);
    const row = await db.mailOutbox.create({ data: { template, toAddress: to, subject: m.subject, payload: { text: m.text, html: m.html }, eventRef: eventRef ?? null } });
    return row.id;
  }

  /** Wysyła oczekujące wiadomości (blokada SKIP LOCKED — bezpieczne przy wielu procesach). Zwraca liczbę przetworzonych. */
  async drain(limit = 20): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let n = 0;
    try {
      for (; n < limit; n++) {
        const rows = await this.db.$queryRaw<{ id: string }[]>`
          UPDATE mail_outbox SET status = 'SENDING', attempts = attempts + 1
          WHERE id = (SELECT id FROM mail_outbox WHERE status IN ('QUEUED','FAILED') AND next_attempt_at <= now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
          RETURNING id`;
        const id = rows[0]?.id;
        if (!id) break;
        await this.sendOne(id);
      }
    } finally { this.running = false; }
    return n;
  }

  private async sendOne(id: string): Promise<void> {
    const m = await this.db.mailOutbox.findUniqueOrThrow({ where: { id } });
    const p = m.payload as { text?: string; html?: string };
    try {
      if (!p.text || !p.html) throw new Error("Brak treści wiadomości");
      const providerId = await this.transport.send({ to: m.toAddress, from: this.env.EMAIL_FROM, subject: m.subject, text: p.text, html: p.html });
      await this.db.mailOutbox.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), providerId, lastError: null, payload: SCRUBBED } });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const dead = m.attempts > BACKOFF_MS.length;
      await this.db.mailOutbox.update({ where: { id }, data: dead
        // porzucona wiadomość z jednorazowym linkiem traci treść; powiadomienie zostaje — administrator może je ponowić
        ? { status: "DEAD", lastError: err.slice(0, 500), ...(LINK_TEMPLATES.has(m.template) ? { payload: SCRUBBED } : {}) }
        : { status: "FAILED", lastError: err.slice(0, 500), nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[m.attempts - 1] ?? BACKOFF_MS.at(-1)!)) } });
      this.log.warn(`Wysyłka do ${m.toAddress} nieudana (próba ${m.attempts}): ${err}`);
    }
  }
}
