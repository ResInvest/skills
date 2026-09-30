import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Jednolity format błędów API: { ok: false, code, error, requestId }.
 * Użytkownik nigdy nie dostaje stack trace'u — szczegóły trafiają wyłącznie do logu serwera.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("API");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>(), req = ctx.getRequest<Request & { requestId?: string }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR, code = "INTERNAL", error = "Błąd wewnętrzny serwera — operacja nie została wykonana.";
    let details: unknown;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "object" && body !== null) {
        const b = body as Record<string, unknown>;
        code = typeof b.code === "string" ? b.code : HttpStatus[status] ?? "ERROR";
        error = typeof b.error === "string" && b.code ? b.error : typeof b.message === "string" ? b.message : exception.message;
        details = b.details;
      } else { code = HttpStatus[status] ?? "ERROR"; error = String(body); }
    } else {
      this.log.error(`${req.method} ${req.originalUrl} [${req.requestId ?? "-"}]`, exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json({ ok: false, code, error, ...(details !== undefined ? { details } : {}), requestId: req.requestId });
  }
}
