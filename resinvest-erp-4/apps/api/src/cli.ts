import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { AuditService } from "./audit/audit.service.js";
import { AuthService } from "./auth/auth.service.js";
import { SYSTEM_META } from "./common/request-meta.js";
import { ENV, type Env } from "./config/env.js";
import { MailService } from "./mail/mail.service.js";
import { PrismaService } from "./prisma/prisma.service.js";

/**
 * Polecenia administracyjne — uruchamiane WYŁĄCZNIE lokalnie na serwerze (konsola administratora systemu):
 *   node dist/cli.js bootstrap-admin            pierwszy administrator (BOOTSTRAP_ADMIN_EMAIL) + link aktywacyjny
 *   node dist/cli.js unlock <e-mail>            odblokowanie konta po nieudanych logowaniach
 *   node dist/cli.js reset-link <e-mail>        awaryjny link ustawienia hasła (np. administrator zapomniał hasła)
 * Link jest drukowany na konsoli i wysyłany e-mailem; jest jednorazowy i ma ograniczony czas ważności.
 */
export async function runCli(argv: string[], out: (s: string) => void = s => void process.stdout.write(s + "\n")): Promise<number> {
  process.env.MAIL_WORKER = "off";
  const [cmd, arg] = argv;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const db = app.get(PrismaService), auth = app.get(AuthService), mail = app.get(MailService), audit = app.get(AuditService), env = app.get<Env>(ENV);
  try {
    if (cmd === "bootstrap-admin") {
      const email = auth.companyEmail(arg ?? env.BOOTSTRAP_ADMIN_EMAIL);
      const active = await db.user.count({ where: { status: "ACTIVE", role: { code: "ADMINISTRATOR" } } });
      if (active > 0) { out("Aktywny administrator już istnieje — nic nie zmieniono. Kolejne konta zakłada się zaproszeniem w module Użytkownicy."); return 0; }
      const role = await db.role.findUnique({ where: { code: "ADMINISTRATOR" } });
      if (!role) throw new Error("Brak ról — najpierw uruchom dane słownikowe: node dist/seed/seed.js");
      const token = await db.$transaction(async tx => {
        const wh = await tx.warehouse.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
        const u = await tx.user.upsert({ where: { email }, update: { roleId: role.id, status: "INVITED" }, create: { email, firstName: "Administrator", lastName: "Systemu", roleId: role.id, status: "INVITED", defaultWarehouseId: wh?.id ?? null } });
        const t = await auth.issueToken(tx, u.id, "INVITE", email, null);
        await mail.enqueue(tx, "invite", email, { name: "Administratorze", invitedBy: "Instalator ResInvest ERP", role: role.name, url: auth.link("/aktywacja", t), hours: String(env.INVITE_HOURS) }, `user:${u.id}`);
        await audit.log(tx, null, SYSTEM_META, { action: "ADMIN_BOOTSTRAP", entity: "user", entityId: u.id, after: { email } });
        return t;
      });
      out(`Utworzono konto administratora: ${email}`);
      out(`Link aktywacyjny (jednorazowy, ważny ${env.INVITE_HOURS} godz.):`);
      out(auth.link("/aktywacja", token));
    } else if (cmd === "unlock" && arg) {
      const u = await db.user.update({ where: { email: auth.companyEmail(arg) }, data: { lockedUntil: null, failedLogins: 0 } });
      await audit.log(db, null, SYSTEM_META, { action: "ACCOUNT_UNLOCKED", entity: "user", entityId: u.id, reason: "CLI" });
      out(`Odblokowano konto ${u.email}`);
    } else if (cmd === "reset-link" && arg) {
      const u = await db.user.findUniqueOrThrow({ where: { email: auth.companyEmail(arg) } });
      if (u.status !== "ACTIVE") throw new Error(`Konto ${u.email} nie jest aktywne (status ${u.status})`);
      const token = await db.$transaction(async tx => {
        const t = await auth.issueToken(tx, u.id, "PASSWORD_RESET", u.email, null);
        await audit.log(tx, null, SYSTEM_META, { action: "PASSWORD_RESET_LINK_CLI", entity: "user", entityId: u.id });
        return t;
      });
      out(`Link ustawienia hasła dla ${u.email} (jednorazowy, ważny ${env.RESET_MINUTES} min):`);
      out(auth.link("/reset-hasla", token));
    } else {
      out("Użycie: node dist/cli.js bootstrap-admin [e-mail] | unlock <e-mail> | reset-link <e-mail>");
      return 2;
    }
    return 0;
  } finally { await app.close(); }
}

if (require.main === module) runCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
