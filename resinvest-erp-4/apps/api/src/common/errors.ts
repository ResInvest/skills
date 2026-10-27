import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Błąd biznesowy API: kod (stały, do obsługi w kliencie) + komunikat dla użytkownika (PL).
 * Filtr ApiErrorFilter zamienia go na { ok: false, code, error, details?, requestId }.
 */
export class AppError extends HttpException {
  constructor(status: HttpStatus, readonly code: string, message: string, details?: unknown) {
    super({ code, error: message, ...(details !== undefined ? { details } : {}) }, status);
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(HttpStatus.BAD_REQUEST, code, msg, details);
export const unauthorized = (msg = "Sesja wygasła lub nie jesteś zalogowany. Zaloguj się ponownie.") => new AppError(HttpStatus.UNAUTHORIZED, "AUTH", msg);
export const forbidden = (msg = "Nie masz uprawnień do wykonania tej operacji.", code = "FORBIDDEN") => new AppError(HttpStatus.FORBIDDEN, code, msg);
export const notFound = (msg = "Nie znaleziono.") => new AppError(HttpStatus.NOT_FOUND, "NOT_FOUND", msg);
export const conflict = (code: string, msg: string) => new AppError(HttpStatus.CONFLICT, code, msg);
export const tooMany = (msg = "Zbyt wiele prób. Spróbuj ponownie za kilka minut.") => new AppError(HttpStatus.TOO_MANY_REQUESTS, "RATE", msg);
