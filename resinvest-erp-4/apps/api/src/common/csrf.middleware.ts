import type { NextFunction, Request, Response } from "express";

/**
 * Ochrona CSRF (obok SameSite=Strict): żądania zmieniające dane muszą mieć nagłówek X-Requested-With
 * (wymusza preflight CORS dla obcych stron) i — jeśli przeglądarka podaje Origin — pochodzić z dozwolonego źródła.
 */
export function csrfGuard(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map(o => o.replace(/\/$/, "")));
  return (req: Request, res: Response, next: NextFunction): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.header("origin");
    if (req.header("x-requested-with") !== "ResInvestERP" || (origin && !allowed.has(origin))) {
      res.status(403).json({ ok: false, code: "CSRF", error: "Żądanie odrzucone przez zabezpieczenie CSRF. Odśwież stronę i spróbuj ponownie." });
      return;
    }
    next();
  };
}
