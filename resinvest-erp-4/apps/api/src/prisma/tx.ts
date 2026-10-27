import type { PrismaClient } from "../generated/prisma/client.js";

/** Klient Prisma albo klient transakcji ($transaction(async tx => …)) — serwisy działają w obu. */
export type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
