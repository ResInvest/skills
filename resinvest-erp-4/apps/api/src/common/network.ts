import { isIP } from "node:net";

/** Dopasowanie adresu IPv4/IPv6 do listy sieci CIDR (np. LAN 10.10.0.0/16 i pula FortiClient 10.212.134.0/24). */
export interface Cidr { family: 4 | 6; bits: bigint; prefix: number }

function toBigInt(ip: string): { family: 4 | 6; value: bigint } | null {
  const clean = ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const fam = isIP(clean);
  if (fam === 4) return { family: 4, value: clean.split(".").reduce((a, o) => (a << 8n) + BigInt(Number(o)), 0n) };
  if (fam === 6) {
    const [head = "", tail = ""] = clean.split("::");
    const h = head ? head.split(":") : [], t = clean.includes("::") ? (tail ? tail.split(":") : []) : [];
    const parts = clean.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
    if (parts.length !== 8) return null;
    return { family: 6, value: parts.reduce((a, p) => (a << 16n) + BigInt(parseInt(p || "0", 16)), 0n) };
  }
  return null;
}

export function parseCidr(spec: string): Cidr {
  const [addr = "", pre] = spec.trim().split("/");
  const ip = toBigInt(addr);
  if (!ip) throw new Error(`Nieprawidłowy adres sieci: ${spec}`);
  const max = ip.family === 4 ? 32 : 128;
  const prefix = pre === undefined ? max : Number(pre);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`Nieprawidłowa maska sieci: ${spec}`);
  const shift = BigInt(max - prefix);
  return { family: ip.family, bits: (ip.value >> shift) << shift, prefix };
}

export function ipInNetworks(ip: string | undefined, nets: Cidr[]): boolean {
  if (!ip) return false;
  const v = toBigInt(ip);
  if (!v) return false;
  return nets.some(n => {
    if (n.family !== v.family) return false;
    const shift = BigInt((n.family === 4 ? 32 : 128) - n.prefix);
    return ((v.value >> shift) << shift) === n.bits;
  });
}
