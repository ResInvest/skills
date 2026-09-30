import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Identyfikator żądania (log, audyt, odpowiedź błędu); przyjmuje X-Request-Id z Nginx, jeśli poprawny. */
export function requestContext(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  req.requestId = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
