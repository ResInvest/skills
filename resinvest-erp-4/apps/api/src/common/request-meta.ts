import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Kontekst żądania do audytu: adres IP (z zaufanego proxy), przeglądarka, identyfikator żądania. */
export interface RequestMeta { ip: string | null; userAgent: string | null; requestId: string | null }

export function metaOf(req: Request & { requestId?: string }): RequestMeta {
  const ua = req.header("user-agent");
  return { ip: req.ip ?? null, userAgent: ua ? ua.slice(0, 300) : null, requestId: req.requestId ?? null };
}
export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => metaOf(ctx.switchToHttp().getRequest()));
export const SYSTEM_META: RequestMeta = { ip: null, userAgent: "system", requestId: null };
