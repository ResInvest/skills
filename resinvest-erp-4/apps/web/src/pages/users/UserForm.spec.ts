import { describe, expect, it } from "vitest";
import type { Me, Role } from "../../api/types";
import { assignableRoles } from "./UserForm";

const role = (code: string, global = false): Role => ({ id: code, code, name: code, description: null, global, system: true, version: 1, users: 0, permissions: [] });
const ALL = [role("ADMINISTRATOR", true), role("AUDYTOR", true), role("MAGAZYNIER"), role("MANAGER"), role("OBSERWATOR")];
const session = (code: string, perms: string[]) => ({ user: { role: { code } } as Me, can: (p: string) => perms.includes(p) });

describe("assignableRoles (odbicie reguł serwera)", () => {
  it("administrator może nadać każdą rolę", () => {
    expect(assignableRoles(ALL, session("ADMINISTRATOR", ["roles.assign"])).map(r => r.code)).toEqual(ALL.map(r => r.code));
  });
  it("kierownik bez roles.assign — tylko MAGAZYNIER i OBSERWATOR", () => {
    expect(assignableRoles(ALL, session("MANAGER", ["users.manage"])).map(r => r.code)).toEqual(["MAGAZYNIER", "OBSERWATOR"]);
  });
  it("roles.assign bez roli administratora — bez ADMINISTRATOR", () => {
    expect(assignableRoles(ALL, session("MANAGER", ["roles.assign"])).map(r => r.code)).not.toContain("ADMINISTRATOR");
  });
  it("obecna rola edytowanego zawsze na liście (wyświetlenie)", () => {
    expect(assignableRoles(ALL, session("MANAGER", []), "MANAGER").map(r => r.code)).toContain("MANAGER");
  });
});
