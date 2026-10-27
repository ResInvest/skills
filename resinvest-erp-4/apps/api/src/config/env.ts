import { z } from "zod";

/** Lista po przecinku → tablica bez pustych wpisów. */
const csv = (def = "") => z.string().default(def).transform(s => s.split(",").map(x => x.trim()).filter(Boolean));

/**
 * Konfiguracja środowiska — walidowana przy starcie; błąd = API się nie uruchamia (fail fast).
 * Sekrety pochodzą wyłącznie ze zmiennych środowiskowych (plik .env lokalnie / konfiguracja usługi na serwerze).
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().refine(u => /^postgres(ql)?:\/\//.test(u), "DATABASE_URL musi wskazywać PostgreSQL"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.string().url().default("http://localhost:5173"),
  CORS_ORIGINS: csv(),
  ALLOWED_NETWORKS: csv(),
  TRUSTED_PROXIES: csv(),
  COMPANY_DOMAINS: csv("resinvest.group").transform(a => a.map(d => d.toLowerCase())),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("magazyn@resinvest.group"),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(168).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().max(1440).default(60),
  LOGIN_MAX_FAILS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Limit prób logowania w 5 min: z jednego adresu IP i na jeden adres e-mail. */
  LOGIN_RATE_PER_IP: z.coerce.number().int().min(1).max(100_000).default(20),
  LOGIN_RATE_PER_EMAIL: z.coerce.number().int().min(1).max(100_000).default(8),
  EMAIL_TRANSPORT: z.enum(["resend", "smtp", "file"]).default("file"),
  /** Kanał zapasowy: przy błędzie kanału głównego ta sama wiadomość idzie od razu drugim kanałem (np. Resend API → SMTP). */
  EMAIL_FALLBACK_TRANSPORT: z.enum(["none", "resend", "smtp"]).default("none"),
  EMAIL_FROM: z.string().default("ResInvest ERP <erp@resinvest.group>"),
  RESEND_API_KEY: z.string().default(""),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  /** Katalog plików .eml (transport "file": test, instalacja bez poczty). */
  MAIL_FILE_DIR: z.string().default("./data/mail"),
  /** Czy uruchamiać wysyłkę kolejki poczty w tym procesie (testy: false). */
  MAIL_WORKER: z.enum(["on", "off"]).default("on"),
  INVITE_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  RESET_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
}).superRefine((e, ctx) => {
  if (e.NODE_ENV === "production" && !e.APP_URL.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "W produkcji APP_URL musi używać HTTPS" });
  if (e.EMAIL_TRANSPORT === "resend" && !e.RESEND_API_KEY) ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "Transport resend wymaga klucza RESEND_API_KEY" });
  if (e.EMAIL_TRANSPORT === "smtp" && !e.SMTP_HOST) ctx.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "Transport smtp wymaga SMTP_HOST" });
  if (e.EMAIL_FALLBACK_TRANSPORT === "resend" && !e.RESEND_API_KEY) ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "Kanał zapasowy resend wymaga klucza RESEND_API_KEY" });
  if (e.EMAIL_FALLBACK_TRANSPORT === "smtp" && !e.SMTP_HOST) ctx.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "Kanał zapasowy smtp wymaga SMTP_HOST" });
  if (e.EMAIL_FALLBACK_TRANSPORT !== "none" && e.EMAIL_FALLBACK_TRANSPORT === e.EMAIL_TRANSPORT) ctx.addIssue({ code: "custom", path: ["EMAIL_FALLBACK_TRANSPORT"], message: "Kanał zapasowy musi być inny niż główny" });
  if (e.NODE_ENV === "production" && e.ALLOWED_NETWORKS.length === 0) ctx.addIssue({ code: "custom", path: ["ALLOWED_NETWORKS"], message: "W produkcji podaj sieci LAN i pulę VPN (ALLOWED_NETWORKS)" });
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = EnvSchema.safeParse(source);
  if (!r.success) {
    const lines = r.error.issues.map(i => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new Error(`Nieprawidłowa konfiguracja środowiska:\n${lines.join("\n")}`);
  }
  return r.data;
}

export const ENV = Symbol("ENV");
