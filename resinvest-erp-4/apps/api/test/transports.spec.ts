import { describe, expect, it } from "vitest";
import { createTransport, FallbackTransport, type MailMessage, type MailTransport } from "../src/mail/transports.js";
import { loadEnv } from "../src/config/env.js";

const msg: MailMessage = { to: "a@resinvest.group", from: "ResInvest ERP <erp@resinvest.group>", subject: "T", text: "t", html: "<p>t</p>" };
const okT = (name: string, log: string[]): MailTransport => ({ name, send: async () => { log.push(name); return `${name}-id`; } });
const badT = (name: string, log: string[]): MailTransport => ({ name, send: async () => { log.push(name); throw new Error(`${name} niedostępny`); } });
const env = (o: Record<string, string>) => loadEnv({ DATABASE_URL: "postgresql://x:y@127.0.0.1:5432/db", ...o } as NodeJS.ProcessEnv);

/** F7/F8 — kanał zapasowy poczty (Resend API → SMTP) i walidacja konfiguracji. */
describe("poczta — kanał główny i zapasowy", () => {
  it("główny działa — zapasowy nieużyty; główny pada — wysyła zapasowy; oba padają — błąd z oboma komunikatami", async () => {
    const log: string[] = [];
    expect(await new FallbackTransport(okT("resend", log), okT("smtp", log)).send(msg)).toBe("resend-id");
    expect(log).toEqual(["resend"]);
    expect(await new FallbackTransport(badT("resend", log), okT("smtp", log)).send(msg)).toBe("smtp-id");
    await expect(new FallbackTransport(badT("resend", log), badT("smtp", log)).send(msg)).rejects.toThrow("resend: resend niedostępny; smtp: smtp niedostępny");
  });
  it("konfiguracja: Resend + zapasowy SMTP Resend → kanał „resend+smtp”; brak klucza / hosta / ten sam kanał — błąd", () => {
    const t = createTransport(env({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test", EMAIL_FALLBACK_TRANSPORT: "smtp", SMTP_HOST: "smtp.resend.com", SMTP_PORT: "465", SMTP_USER: "resend", SMTP_PASS: "re_test" }));
    expect(t.name).toBe("resend+smtp");
    expect(() => env({ EMAIL_TRANSPORT: "resend" })).toThrow(/RESEND_API_KEY/);
    expect(() => env({ EMAIL_TRANSPORT: "file", EMAIL_FALLBACK_TRANSPORT: "smtp" })).toThrow(/SMTP_HOST/);
    expect(() => env({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "x", EMAIL_FALLBACK_TRANSPORT: "smtp" })).toThrow(/inny niż główny/);
  });
});
