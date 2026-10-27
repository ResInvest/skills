import { QueryClient } from "@tanstack/react-query";

/** Dane serwera: cache w pamięci (nie w localStorage) — źródłem prawdy jest zawsze API / PostgreSQL. */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true }, mutations: { retry: false } } });
}
