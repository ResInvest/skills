import { Inject, Injectable } from "@nestjs/common";
import type { Response } from "express";
import { ENV, type Env } from "../config/env.js";
import type { RequestMeta } from "../common/request-meta.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "../prisma/tx.js";
import { loadAuthUser, type AuthUser } from "./auth-user.js";
import { hashToken, newToken } from "./tokens.js";

/**
 * Sesje: nieprzezroczysty token w ciasteczku HttpOnly (SameSite=Strict, Secure w produkcji, prefiks __Host-),
 * w bazie tylko skrót. Wygasa po SESSION_TTL_HOURS lub SESSION_IDLE_MINUTES bezczynności; można ją unieważnić zdalnie.
 */
@Injectable()
export class SessionService {
  readonly cookieName: string;
  constructor(@Inject(ENV) private readonly env: Env, private readonly db: PrismaService) {
    this.cookieName = env.NODE_ENV === "production" ? "__Host-riw_sid" : "riw_sid";
  }

  async create(db: Db, userId: string, meta: RequestMeta): Promise<{ token: string; id: string; expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000);
    const s = await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent } });
    return { token, id: s.id, expiresAt };
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.cookieName, token, { httpOnly: true, secure: this.env.NODE_ENV === "production", sameSite: "strict", path: "/", expires: expiresAt });
  }
  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, { httpOnly: true, secure: this.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  }

  /** Sesja z ciasteczka → zalogowany użytkownik (albo null: brak / wygasła / bezczynna / unieważniona / konto nieaktywne). */
  async resolve(token: string | undefined): Promise<AuthUser | null> {
    if (!token || token.length > 100) return null;
    const s = await this.db.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!s || s.revokedAt) return null;
    const now = Date.now();
    if (s.expiresAt.getTime() <= now) { await this.revoke(s.id, "EXPIRED"); return null; }
    if (now - s.lastSeenAt.getTime() > this.env.SESSION_IDLE_MINUTES * 60_000) { await this.revoke(s.id, "IDLE"); return null; }
    const user = await loadAuthUser(this.db, s.userId, s.id);
    if (!user || user.status !== "ACTIVE") { await this.revoke(s.id, "ACCOUNT_INACTIVE"); return null; }
    if (now - s.lastSeenAt.getTime() > 60_000) await this.db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(now) } });
    return user;
  }

  async revoke(id: string, reason: string, db: Db = this.db): Promise<void> {
    await db.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }
  async revokeAllForUser(db: Db, userId: string, reason: string, exceptId?: string): Promise<number> {
    const r = await db.session.updateMany({ where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { revokedAt: new Date(), revokedReason: reason } });
    return r.count;
  }
  /** Aktywne sesje użytkownika (bez tokenów). */
  active(userId: string) {
    return this.db.session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" },
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, ip: true, userAgent: true } });
  }
  purgeOld(): Promise<{ count: number }> {
    return this.db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 30 * 86_400_000) } }, { revokedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } }] } });
  }
}
