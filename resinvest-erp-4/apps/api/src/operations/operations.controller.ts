import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import type { OperationInput, ReceiptInput } from "@resinvest/domain";
import { Meta, type RequestMeta } from "../common/request-meta.js";
import { ZodPipe, zbody } from "../common/zod.pipe.js";
import type { AuthUser } from "../auth/auth-user.js";
import { CurrentUser, RequirePermissions } from "../auth/decorators.js";
import { OperationsService } from "./operations.service.js";

const val = z.union([z.string().max(40), z.number()]).nullable().optional();
const unit = z.enum(["M3", "MP", "T"], { message: "Wybierz jednostkę" });
const Extra = z.object({ typeId: z.string().max(40), vehicleId: z.string().max(40).nullable().optional(), qty: val, rate: val, cost: val, description: z.string().max(300).nullable().optional() });
const id40 = z.string().max(40).nullable().optional();
const txt = (n: number) => z.string().max(n).nullable().optional();
const Run = z.object({
  ownership: z.enum(["OWN", "EXTERNAL"], { message: "Wybierz: kurs własny albo zewnętrzny" }), vehicleId: id40, driverId: id40,
  registration: txt(20), driverName: txt(120), km: val, rate: val, freight: val, qty: val, weightT: val, waybillNo: txt(60), waybillM3: val,
});
const Transport = z.object({
  mode: z.enum(["NONE", "OWN", "EXTERNAL", "MIXED", "TRAIN", "SUPPLIER"], { message: "Nieznany tryb transportu" }),
  place: txt(250), externalCompanyId: id40, includedInPrice: z.boolean().optional(),
  runs: z.array(Run).max(60).optional(),
  train: z.object({ trainNo: txt(40), carrier: txt(120), wagonTons: z.array(val).max(80).optional(), priceUnit: unit.nullable().optional(), price: val }).nullable().optional(),
}).nullable().optional();
const Common = {
  warehouseId: z.string().uuid("Wybierz magazyn"), date: z.string().max(10), documentDate: z.string().max(10).nullable().optional(),
  externalNumber: z.string().max(60).nullable().optional(), notes: z.string().max(2000).nullable().optional(),
  numbering: z.object({ mode: z.enum(["AUTO", "MANUAL"]), number: z.string().max(60).nullable().optional() }).optional(),
  extras: z.array(Extra).max(50).optional(),
  transport: Transport,
};
const Input = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PURCHASE"), partnerId: z.string().max(40), materialId: z.string().max(40), qty: val, unit, price: val, priceUnit: unit.nullable().optional(), weightManual: val, ...Common }),
  z.object({ type: z.literal("SALE"), partnerId: z.string().max(40), materialId: z.string().max(40), qty: val, unit, price: val, weightManual: val, ...Common }),
  z.object({ type: z.literal("TRANSFER"), targetWarehouseId: z.string().max(40), materialId: z.string().max(40), qty: val, unit, weightManual: val, ...Common }),
  z.object({ type: z.literal("PRODUCTION"), rawMaterialId: z.string().max(40), outMaterialId: z.string().max(40), outQty: val, chipperId: z.string().max(40).nullable().optional(), operatorId: z.string().max(40).nullable().optional(), chipRate: val, ...Common }),
], { message: "Wybierz rodzaj operacji" });
const Key = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);
const Create = z.object({ idempotencyKey: Key, operation: Input });
const Receive = z.object({ idempotencyKey: Key, receipt: z.object({
  date: z.string().max(10).nullable().optional(), qty: val, unit: unit.nullable().optional(), weightManual: val,
  reason: z.string().max(40).nullable().optional(), note: z.string().max(300).nullable().optional(),
}) });
const RegisterQ = z.object({
  warehouseId: z.string().uuid("Wybierz magazyn"), type: z.enum(["PZ", "WZ", "MM", "RW", "PW", "TR", "BO", "IN"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), q: z.string().max(100).optional(),
  aux: z.enum(["0", "1"]).default("0"), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Operacje z dokumentami: POST /operations (zatwierdzenie; klucz idempotencji chroni przed podwójnym zapisem),
 * POST /operations/preview (podsumowanie przed zatwierdzeniem: numery, stan przed / po, braki), GET /operations/:id,
 * GET /documents (rejestr), GET /operations/form-data (kartoteki i stany do formularza).
 * Uprawnienia rodzaju operacji (receipts / issues / production .create) sprawdza serwis.
 */
@Controller()
export class OperationsController {
  constructor(private readonly svc: OperationsService) {}

  @Get("operations/form-data") @RequirePermissions("report.view")
  async formData(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ warehouseId: z.string().uuid() }))) q: { warehouseId: string }) {
    return { ok: true, ...(await this.svc.formData(u, q.warehouseId)) };
  }

  @Post("operations/preview") @HttpCode(200) @RequirePermissions("report.view")
  async preview(@CurrentUser() u: AuthUser, @Body(zbody(Input)) dto: z.infer<typeof Input>) {
    return { ok: true, ...(await this.svc.preview(u, dto as OperationInput)) };
  }

  @Post("operations") @RequirePermissions("report.view")
  async create(@CurrentUser() u: AuthUser, @Body(zbody(Create)) dto: z.infer<typeof Create>, @Meta() meta: RequestMeta) {
    return { ok: true, operation: await this.svc.create(u, dto.operation as OperationInput, dto.idempotencyKey, meta) };
  }

  /** Przyjęcie MM dwuetapowego w magazynie docelowym (uprawnienie mm.receive i dostęp do magazynu docelowego — w serwisie). */
  @Post("operations/:id/receive") @HttpCode(200) @RequirePermissions("report.view")
  async receive(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body(zbody(Receive)) dto: z.infer<typeof Receive>, @Meta() meta: RequestMeta) {
    return { ok: true, operation: await this.svc.receive(u, id, dto.receipt as ReceiptInput, dto.idempotencyKey, meta) };
  }

  @Get("transfers/in-transit") @RequirePermissions("report.view")
  async inTransit(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ warehouseId: z.string().uuid() }))) q: { warehouseId: string }) {
    return { ok: true, transfers: await this.svc.inTransit(u, q.warehouseId) };
  }

  @Get("operations/:id") @RequirePermissions("report.view")
  async get(@CurrentUser() u: AuthUser, @Param("id", new ParseUUIDPipe()) id: string) { return { ok: true, operation: await this.svc.get(u, id) }; }

  @Get("documents") @RequirePermissions("report.view")
  async register(@CurrentUser() u: AuthUser, @Query(new ZodPipe(RegisterQ)) q: z.infer<typeof RegisterQ>) {
    return { ok: true, ...(await this.svc.register(u, { ...q, aux: q.aux === "1" })) };
  }
}
