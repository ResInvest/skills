import { randomBytes } from "node:crypto";
import { Algorithm, hash, verify } from "@node-rs/argon2";

/**
 * Hasła: Argon2id (parametry zgodne z zaleceniami OWASP: 19 MiB, 2 iteracje, 1 wątek).
 * Polityka: 12–128 znaków, litera i cyfra, bez fragmentu adresu e-mail, spoza listy najczęstszych haseł.
 */
const OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const COMMON = new Set(["password1234", "qwerty123456", "123456789012", "haslo1234567", "resinvest123", "resinvest2026", "magazyn12345", "admin1234567", "zaq12wsxcde3", "1qaz2wsx3edc"]);

export const PASSWORD_RULES = "Hasło: co najmniej 12 znaków, w tym litera i cyfra; nie może zawierać nazwy konta z adresu e-mail.";

export function passwordProblem(pw: unknown, email?: string): string | null {
  if (typeof pw !== "string") return "Podaj hasło";
  if (pw.length < 12) return "Hasło musi mieć co najmniej 12 znaków";
  if (pw.length > 128) return "Hasło może mieć najwyżej 128 znaków";
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) return "Hasło musi zawierać co najmniej jedną literę i jedną cyfrę";
  const local = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const parts = local.split(/[._-]+/).filter(p => p.length >= 4);
  if (local && (pw.toLowerCase().includes(local) || parts.some(p => pw.toLowerCase().includes(p)))) return "Hasło nie może zawierać nazwy konta z adresu e-mail";
  if (COMMON.has(pw.toLowerCase())) return "To hasło jest zbyt popularne — wybierz inne";
  return null;
}

export const hashPassword = (pw: string): Promise<string> => hash(pw, OPTS);

export async function verifyPassword(stored: string | null | undefined, pw: string): Promise<boolean> {
  // brak konta / hasła: weryfikacja „na pusto”, aby czas odpowiedzi nie zdradzał istnienia konta
  const target = stored ?? await dummyHash();
  try { const ok = await verify(target, pw); return ok && !!stored; } catch { return false; }
}
// prawdziwy skrót Argon2id losowego hasła (tworzony raz) — pełny koszt weryfikacji także bez konta
let dummy: Promise<string> | null = null;
const dummyHash = (): Promise<string> => (dummy ??= hash(randomBytes(24).toString("base64url"), OPTS));
