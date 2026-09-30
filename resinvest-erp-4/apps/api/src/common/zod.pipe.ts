import { type PipeTransform } from "@nestjs/common";
import { type ZodType } from "zod";
import { badRequest } from "./errors.js";

/** Walidacja danych wejściowych schematem zod — backend zawsze waliduje, niezależnie od frontendu. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    const details = r.error.issues.map(i => ({ field: i.path.join("."), message: i.message }));
    throw badRequest("VALIDATION", details[0]?.message ?? "Nieprawidłowe dane", details);
  }
}
export const zbody = <T>(schema: ZodType<T>) => new ZodPipe(schema);
