import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../config/env.js";
import type { RenderedMail } from "./templates.js";

export interface MailMessage extends RenderedMail { to: string; from: string }
export interface MailTransport { readonly name: string; send(m: MailMessage): Promise<string | null> }

/** Zapis do pliku .eml (test, instalacja bez poczty) — administrator może otworzyć wiadomość w kliencie poczty. */
class FileTransport implements MailTransport {
  readonly name = "file";
  constructor(private readonly dir: string) {}
  async send(m: MailMessage): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
    const b = `riw_${id}`;
    const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
    const body = [`From: ${m.from}`, `To: ${m.to}`, `Subject: ${enc(m.subject)}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${b}"`, "", `--${b}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      Buffer.from(m.text).toString("base64"), `--${b}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      Buffer.from(m.html).toString("base64"), `--${b}--`, ""].join("\r\n");
    const file = join(this.dir, `${id}.eml`);
    await writeFile(file, body, { mode: 0o600 });
    return file;
  }
}

/** Resend (API HTTPS) — klucz tylko w konfiguracji serwera. */
class ResendTransport implements MailTransport {
  readonly name = "resend";
  constructor(private readonly key: string) {}
  async send(m: MailMessage): Promise<string | null> {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }), signal: AbortSignal.timeout(15_000),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!r.ok) throw new Error(`Resend ${r.status}: ${body.message ?? "błąd wysyłki"}`);
    return body.id ?? null;
  }
}

class SmtpTransport implements MailTransport {
  readonly name = "smtp";
  private readonly t: Transporter;
  constructor(env: Env) {
    this.t = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, requireTLS: env.SMTP_PORT !== 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined, connectionTimeout: 15_000 });
  }
  async send(m: MailMessage): Promise<string | null> {
    const info = await this.t.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return info.messageId ?? null;
  }
}

export function createTransport(env: Env): MailTransport {
  if (env.EMAIL_TRANSPORT === "resend") return new ResendTransport(env.RESEND_API_KEY);
  if (env.EMAIL_TRANSPORT === "smtp") return new SmtpTransport(env);
  return new FileTransport(resolve(env.MAIL_FILE_DIR));
}
