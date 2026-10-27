import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { AuditService } from "../audit/audit.service.js";
import { badRequest, conflict, forbidden, tooMany, AppError } from "../common/errors.js";
import { SlidingWindowLimiter } from "../common/rate-limit.js";
import type { RequestMeta } from "../common/request-meta.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { SettingsService } from "../settings/settings.service.js";
import { displayName, type AuthUser } from "./auth-user.js";
import { hashPassword, passwordProblem, verifyPassword } from "./password.js";
import { SessionService } from "./session.service.js";
import { hashToken, isTokenShape, newToken } from "./tokens.js";
import { HttpStatus } from "@nestjs/common";

export const BAD_CREDENTIALS = "Nieprawidłowy e-mail lub hasło.";
const INACTIVE = "Twoje konto jest nieaktywne.";
const NOT_ACTIVATED = "Twoje konto nie zostało jeszcze aktywowane.";
const SAME_RESPONSE = "Jeśli konto istnieje, wysłaliśmy wiadomość z linkiem do ustawienia hasła.";

export const normalizeEmail = (e: unknown): string => String(e ?? "").replace(/\s+/g, "").toLowerCase();

/** Logowanie, sesje, hasła, zaproszenia, rejestracja — reguły identyczne z ResInvest ERP 3.x (§34/§35), na PostgreSQL. */
@Injectable()
export class AuthService {
  private readonly ipLimiter: SlidingWindowLimiter;
  private readonly emailLimiter: SlidingWindowLimiter;
  private readonly mailLimiter: SlidingWindowLimiter;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {
    this.ipLimiter = new SlidingWindowLimiter(env.LOGIN_RATE_PER_IP, 5 * 60_000);
    this.emailLimiter = new SlidingWindowLimiter(env.LOGIN_RATE_PER_EMAIL, 5 * 60_000);
    this.mailLimiter = new SlidingWindowLimiter(Math.max(5, Math.ceil(env.LOGIN_RATE_PER_IP / 4)), 15 * 60_000);
  }

  /** Adres firmowy: poprawna składnia i domena DOKŁADNIE z listy (bez subdomen) — sprawdzane na serwerze. */
  companyEmail(raw: unknown): string {
    const email = normalizeEmail(raw);
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || email.length > 254) throw badRequest("EMAIL", "Podaj poprawny adres e-mail");
    const domain = email.split("@")[1] ?? "";
    if (this.env.COMPANY_DOMAINS.length && !this.env.COMPANY_DOMAINS.includes(domain))
      throw badRequest("EMAIL_DOMAIN", `Wymagany e-mail firmowy (${this.env.COMPANY_DOMAINS.map(d => "@" + d).join(", ")})`);
    return email;
  }

  async login(rawEmail: unknown, password: unknown, meta: RequestMeta): Promise<{ user: AuthUser; token: string; expiresAt: Date }> {
    const email = normalizeEmail(rawEmail);
    if (this.ipLimiter.hit(`ip:${meta.ip}`) || this.emailLimiter.hit(`em:${email}`)) {
      await this.db.loginEvent.create({ data: { email: email.slice(0, 254), success: false, reason: "RATE", ip: meta.ip, userAgent: meta.userAgent } });
      throw tooMany("Zbyt wiele prób logowania. Spróbuj ponownie za kilka minut.");
    }
    const fail = async (reason: string, userId: string | null = null, err: AppError = new AppError(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS", BAD_CREDENTIALS)) => {
      await this.db.loginEvent.create({ data: { email: email.slice(0, 254), userId, success: false, reason, ip: meta.ip, userAgent: meta.userAgent } });
      return err;
    };
    const pw = typeof password === "string" ? password : "";
    try { this.companyEmail(email); } catch (e) { await verifyPassword(null, pw); throw await fail("DOMAIN", null, e as AppError); }
    const u = await this.db.user.findUnique({ where: { email } });
    if (u?.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
      const min = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60_000);
      throw await fail("LOCKED", u.id, new AppError(HttpStatus.FORBIDDEN, "LOCKED", `Konto tymczasowo zablokowane po nieudanych próbach logowania. Spróbuj za ${min} min albo poproś administratora o odblokowanie.`));
    }
    const ok = await verifyPassword(u?.passwordHash, pw);
    if (!u || !ok) {
      if (u) {
        const failed = u.failedLogins + 1, lock = failed >= this.env.LOGIN_MAX_FAILS;
        await this.db.$transaction(async tx => {
          await tx.user.update({ where: { id: u.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60_000) : undefined } });
          if (lock) await this.audit.log(tx, { id: u.id, email: u.email }, meta, { action: "ACCOUNT_LOCKED", entity: "user", entityId: u.id, after: { minuty: this.env.LOGIN_LOCK_MINUTES } });
        });
      }
      throw await fail("BAD_PASSWORD", u?.id ?? null);
    }
    // status ujawniany dopiero po poprawnym haśle
    if (u.status === "INVITED") throw await fail("NOT_ACTIVATED", u.id, forbidden(NOT_ACTIVATED, "NOT_ACTIVATED"));
    if (u.status !== "ACTIVE") throw await fail("INACTIVE", u.id, forbidden(INACTIVE, "INACTIVE"));
    const s = await this.db.$transaction(async tx => {
      await tx.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
      await tx.loginEvent.create({ data: { email, userId: u.id, success: true, ip: meta.ip, userAgent: meta.userAgent } });
      const created = await this.sessions.create(tx, u.id, meta);
      await this.audit.log(tx, { id: u.id, email: u.email }, meta, { action: "LOGIN", entity: "session", entityId: created.id });
      return created;
    });
    this.emailLimiter.reset(`em:${email}`);
    const user = await this.sessions.resolve(s.token);
    if (!user) throw forbidden(INACTIVE, "INACTIVE");
    return { user, token: s.token, expiresAt: s.expiresAt };
  }

  async logout(user: AuthUser, meta: RequestMeta): Promise<void> {
    await this.db.$transaction(async tx => {
      await this.sessions.revoke(user.sessionId, "LOGOUT", tx);
      await this.audit.log(tx, user, meta, { action: "LOGOUT", entity: "session", entityId: user.sessionId });
    });
  }

  async changePassword(user: AuthUser, oldPw: unknown, newPw: unknown, meta: RequestMeta): Promise<void> {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(u.passwordHash, typeof oldPw === "string" ? oldPw : ""))) throw badRequest("BAD_PASSWORD", "Obecne hasło jest nieprawidłowe");
    const problem = passwordProblem(newPw, u.email);
    if (problem) throw badRequest("PASSWORD_POLICY", problem);
    if (await verifyPassword(u.passwordHash, newPw as string)) throw badRequest("PASSWORD_SAME", "Nowe hasło musi się różnić od obecnego");
    const hash = await hashPassword(newPw as string);
    await this.db.$transaction(async tx => {
      await tx.user.update({ where: { id: u.id }, data: { passwordHash: hash, passwordChangedAt: new Date(), mustChangePassword: false, version: { increment: 1 } } });
      const n = await this.sessions.revokeAllForUser(tx, u.id, "PASSWORD_CHANGED", user.sessionId);
      await this.audit.log(tx, user, meta, { action: "PASSWORD_CHANGED", entity: "user", entityId: u.id, after: { wylogowane_inne_sesje: n } });
      await this.mail.enqueue(tx, "password-changed", u.email, { email: u.email, when: new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }) }, `user:${u.id}`);
    });
  }

  /** Tworzy jednorazowy token (poprzednie niewykorzystane tokeny tego rodzaju wygasają). Zwraca token (tylko do wysłania). */
  async issueToken(db: Db, userId: string, kind: "INVITE" | "PASSWORD_RESET", email: string, createdById: string | null): Promise<string> {
    await db.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
    const token = newToken();
    const ttl = kind === "INVITE" ? this.env.INVITE_HOURS * 3_600_000 : this.env.RESET_MINUTES * 60_000;
    await db.authToken.create({ data: { tokenHash: hashToken(token), userId, kind, email, createdById, expiresAt: new Date(Date.now() + ttl) } });
    return token;
  }
  link(path: string, token: string): string { return `${this.env.APP_URL.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`; }

  /** Zawsze ta sama odpowiedź (nie zdradza, czy konto istnieje). */
  async forgot(rawEmail: unknown, meta: RequestMeta): Promise<string> {
    const email = normalizeEmail(rawEmail);
    if (this.mailLimiter.hit(`ip:${meta.ip}`) || this.mailLimiter.hit(`em:${email}`)) throw tooMany();
    const u = await this.db.user.findUnique({ where: { email } });
    if (u && u.status === "ACTIVE") {
      await this.db.$transaction(async tx => {
        const token = await this.issueToken(tx, u.id, "PASSWORD_RESET", u.email, null);
        await this.mail.enqueue(tx, "password-reset", u.email, { url: this.link("/reset-hasla", token), minutes: String(this.env.RESET_MINUTES) }, `user:${u.id}`);
        await this.audit.log(tx, { id: u.id, email: u.email }, meta, { action: "PASSWORD_RESET_REQUESTED", entity: "user", entityId: u.id });
      });
    }
    return SAME_RESPONSE;
  }

  private async useToken(token: unknown, kind: "INVITE" | "PASSWORD_RESET") {
    if (!isTokenShape(token)) throw badRequest("TOKEN_INVALID", "Link jest nieprawidłowy.");
    const t = await this.db.authToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!t || t.kind !== kind) throw badRequest("TOKEN_INVALID", "Link jest nieprawidłowy.");
    if (t.usedAt) throw badRequest("TOKEN_USED", "Link został już wykorzystany. Poproś o nowy.");
    if (t.expiresAt.getTime() < Date.now()) throw badRequest("TOKEN_EXPIRED", "Link wygasł. Poproś o nowy.");
    return t;
  }

  async checkToken(token: unknown, kind: "INVITE" | "PASSWORD_RESET"): Promise<{ email: string; name: string }> {
    const t = await this.useToken(token, kind);
    return { email: t.user.email, name: displayName(t.user) };
  }

  async resetPassword(token: unknown, pw: unknown, meta: RequestMeta): Promise<void> {
    const t = await this.useToken(token, "PASSWORD_RESET");
    if (t.user.status !== "ACTIVE") throw forbidden(INACTIVE, "INACTIVE");
    const problem = passwordProblem(pw, t.user.email);
    if (problem) throw badRequest("PASSWORD_POLICY", problem);
    const hash = await hashPassword(pw as string);
    await this.db.$transaction(async tx => {
      const used = await tx.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!used.count) throw badRequest("TOKEN_USED", "Link został już wykorzystany. Poproś o nowy.");
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash: hash, passwordChangedAt: new Date(), mustChangePassword: false, failedLogins: 0, lockedUntil: null, version: { increment: 1 } } });
      const n = await this.sessions.revokeAllForUser(tx, t.userId, "PASSWORD_RESET");
      await this.audit.log(tx, { id: t.userId, email: t.user.email }, meta, { action: "PASSWORD_RESET", entity: "user", entityId: t.userId, after: { wylogowane_sesje: n } });
      await this.mail.enqueue(tx, "password-changed", t.user.email, { email: t.user.email, when: new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }) }, `user:${t.userId}`);
    });
  }

  async acceptInvite(token: unknown, pw: unknown, meta: RequestMeta): Promise<void> {
    const t = await this.useToken(token, "INVITE");
    if (t.user.status !== "INVITED") throw conflict("ALREADY_ACTIVE", "Konto zostało już aktywowane — zaloguj się.");
    const problem = passwordProblem(pw, t.user.email);
    if (problem) throw badRequest("PASSWORD_POLICY", problem);
    const hash = await hashPassword(pw as string);
    await this.db.$transaction(async tx => {
      const used = await tx.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!used.count) throw badRequest("TOKEN_USED", "Link został już wykorzystany. Poproś o nowy.");
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash: hash, passwordChangedAt: new Date(), status: "ACTIVE", selfRegistered: false, version: { increment: 1 } } });
      await this.audit.log(tx, { id: t.userId, email: t.user.email }, meta, { action: "INVITE_ACCEPTED", entity: "user", entityId: t.userId, before: { status: "INVITED" }, after: { status: "ACTIVE" } });
    });
  }

  /** Samodzielna rejestracja (domyślnie wyłączona): zgłoszenie czeka na administratora — bez hasła i bez uprawnień. */
  async register(dto: { email: unknown; firstName: string; lastName: string }, meta: RequestMeta): Promise<string> {
    if (!(await this.settings.get("auth.allowSelfRegistration"))) throw forbidden("Rejestracja jest wyłączona — konto zakłada administrator (zaproszenie e-mailem).", "DISABLED");
    if (this.mailLimiter.hit(`reg:${meta.ip}`)) throw tooMany();
    const email = this.companyEmail(dto.email);
    const exists = await this.db.user.findUnique({ where: { email } });
    if (!exists) {
      const role = await this.db.role.findUniqueOrThrow({ where: { code: "OBSERWATOR" } });
      await this.db.$transaction(async tx => {
        const u = await tx.user.create({ data: { email, firstName: dto.firstName, lastName: dto.lastName, roleId: role.id, status: "INVITED", selfRegistered: true } });
        await this.audit.log(tx, { id: u.id, email }, meta, { action: "USER_SELF_REGISTERED", entity: "user", entityId: u.id, after: { email, status: "INVITED" } });
        const admins = await tx.user.findMany({ where: { status: "ACTIVE", role: { code: "ADMINISTRATOR" } }, select: { email: true } });
        for (const a of admins) await this.mail.enqueue(tx, "self-registration", a.email, { name: `${dto.firstName} ${dto.lastName}`, email, url: `${this.env.APP_URL.replace(/\/$/, "")}/uzytkownicy` }, `user:${u.id}`);
      });
    }
    return "Zgłoszenie przyjęte. Administrator nada rolę i magazyny, a następnie wyśle zaproszenie e-mailem.";
  }
}
