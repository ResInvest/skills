import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { ENV, type Env } from "../config/env.js";
import { ipInNetworks, parseCidr, type Cidr } from "./network.js";

/**
 * Dostęp do API tylko z sieci firmy (LAN) i puli adresów FortiClient VPN (ALLOWED_NETWORKS).
 * Pusta lista = brak ograniczenia (wyłącznie środowisko deweloperskie — produkcja jej wymaga, patrz env.ts).
 * To druga linia obrony — pierwszą są reguły FortiGate i zapora Windows.
 */
@Injectable()
export class NetworkGuard implements CanActivate {
  private readonly nets: Cidr[];
  constructor(@Inject(ENV) env: Env) { this.nets = env.ALLOWED_NETWORKS.map(parseCidr); }
  canActivate(ctx: ExecutionContext): boolean {
    if (!this.nets.length) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (ipInNetworks(req.ip, this.nets)) return true;
    throw new ForbiddenException({ code: "NETWORK", error: "Dostęp do systemu możliwy tylko z sieci firmowej lub przez VPN." });
  }
}
