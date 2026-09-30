/**
 * Limiter przesuwnego okna w pamięci procesu (jedna instancja API na serwerze).
 * Pierwsza linia: Nginx (limit_req); ten limiter chroni też bezpośredni dostęp do API.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  /** true = limit przekroczony (żądanie należy odrzucić); rejestruje próbę. */
  hit(key: string, now = Date.now()): boolean {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter(t => t > from);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.sweep(now);
    return list.length > this.max;
  }
  reset(key: string): void { this.hits.delete(key); }
  private sweep(now: number): void { for (const [k, v] of this.hits) if (!v.some(t => t > now - this.windowMs)) this.hits.delete(k); }
}
