import { describe, expect, it } from "vitest";
import { ipInNetworks, parseCidr } from "./network.js";

describe("sieci dozwolone (LAN + VPN)", () => {
  const nets = ["10.10.0.0/16", "10.212.134.0/24", "fd00::/8"].map(parseCidr);
  it("przepuszcza adresy z LAN i puli FortiClient", () => {
    expect(ipInNetworks("10.10.5.20", nets)).toBe(true);
    expect(ipInNetworks("10.212.134.77", nets)).toBe(true);
    expect(ipInNetworks("::ffff:10.10.1.1", nets)).toBe(true);
    expect(ipInNetworks("fd12::1", nets)).toBe(true);
  });
  it("odrzuca adresy spoza list i niepoprawne", () => {
    expect(ipInNetworks("10.212.135.1", nets)).toBe(false);
    expect(ipInNetworks("192.168.1.10", nets)).toBe(false);
    expect(ipInNetworks("2001:db8::1", nets)).toBe(false);
    expect(ipInNetworks(undefined, nets)).toBe(false);
    expect(ipInNetworks("nie-adres", nets)).toBe(false);
  });
  it("waliduje zapis CIDR", () => {
    expect(() => parseCidr("10.0.0.0/33")).toThrow();
    expect(() => parseCidr("abc/8")).toThrow();
    expect(parseCidr("127.0.0.1").prefix).toBe(32);
  });
});
