import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { Express } from "express";
import { ENV, type Env } from "./config/env.js";
import { requestContext } from "./common/request-context.middleware.js";

/** Wspólna konfiguracja aplikacji (serwer i testy): prefiks, nagłówki, CORS, proxy, ciasteczka. */
export function configureApp(app: INestApplication): Env {
  const env = app.get<Env>(ENV);
  const http = app.getHttpAdapter().getInstance() as Express;
  http.disable("x-powered-by");
  // adres klienta z X-Forwarded-For tylko od zaufanego proxy (Nginx)
  http.set("trust proxy", env.TRUSTED_PROXIES.length ? env.TRUSTED_PROXIES : false);
  app.setGlobalPrefix("api/v1");
  app.use(requestContext);
  app.use(helmet({
    // API zwraca wyłącznie JSON — polityka minimalna; stronę aplikacji zabezpiecza Nginx
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    frameguard: { action: "deny" },
    strictTransportSecurity: env.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-origin" },
  }));
  app.use(cookieParser());
  const origins = [env.APP_URL, ...env.CORS_ORIGINS];
  app.enableCors({ origin: origins, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "X-Requested-With", "Idempotency-Key", "X-Request-Id", "If-Match"], maxAge: 600 });
  app.enableShutdownHooks();
  return env;
}
