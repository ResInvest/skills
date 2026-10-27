import { describe, expect, it } from "vitest";
import { dayRange, opTonnage, plannerDays, plannerDrivers, plannerMonths, plannerTotals, type PlannerOp, type PlannerPlan } from "./planner.js";

const run = (o: Partial<PlannerOp["runs"][number]> = {}) => ({ qty: null, weightT: null, km: "0", cost: "0", driver: "Jan Nowak", registration: "SGL 4T821", company: null, ...o });
const op = (o: Partial<PlannerOp>): PlannerOp => ({ id: "op", warehouseId: "zab", date: "2026-09-28", mp: "0", purchaseCost: "0", place: null, runs: [], documents: [], ...o });

describe("planer zakupów — reguły", () => {
  it("dayRange: kolejne dni włącznie, także przez koniec miesiąca", () => {
    expect(dayRange("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });
  it("tony: waga zważonych kursów + reszta × 0,33 t/MP; bez kursów — całość z przelicznika", () => {
    const t = opTonnage(op({ mp: "200", runs: [run({ qty: "100", weightT: "35,5".replace(",", ".") }), run({ qty: "100" })] }));
    expect([t.weighed.toString(), t.auto.toString()]).toEqual(["35.5", "33"]);
    const none = opTonnage(op({ mp: "60" }));
    expect([none.weighed.toString(), none.auto.toString()]).toEqual(["0", "19.8"]);
  });
  it("dzień: suma operacji i planów wielu magazynów, km / transport / kursy z kursów, miejsca bez powtórzeń", () => {
    const ops = [
      op({ id: "a", mp: "200", purchaseCost: "8000", place: "Nadl. Rudziniec", runs: [run({ qty: "100", weightT: "34", km: "40", cost: "200" }), run({ qty: "100", km: "40", cost: "200" })] }),
      op({ id: "b", warehouseId: "bra", mp: "60", purchaseCost: "2700", place: "Nadl. Rudziniec" }),
      op({ id: "c", date: "2026-09-29", mp: "10" }),
    ];
    const plans: PlannerPlan[] = [{ warehouseId: "zab", date: "2026-09-28", planMp: "250", note: "las" }, { warehouseId: "bra", date: "2026-09-28", planMp: "60", note: null }];
    const [d] = plannerDays("2026-09-28", "2026-09-28", ops, plans, "2026-10-01");
    expect(d).toMatchObject({ plan: "310", note: "las", act: "260", tWeighed: "34", tAuto: "52.8", t: "86.8", purchaseCost: "10700.00", km: "80", transportCost: "400.00", trips: 2, places: ["Nadl. Rudziniec"], opIds: ["a", "b"], future: false });
  });
  it("realizacja wobec planu DO DZIŚ — przyszłe dni nie zaniżają; średnia cena i transport na MP; udział wagi", () => {
    const days = plannerDays("2026-09-30", "2026-10-02", [op({ date: "2026-09-30", mp: "180", purchaseCost: "7200", runs: [run({ qty: "180", weightT: "60", cost: "540" })] })],
      [{ warehouseId: "zab", date: "2026-09-30", planMp: "200", note: null }, { warehouseId: "zab", date: "2026-10-02", planMp: "200", note: null }], "2026-10-01");
    expect(days.map(d => d.future)).toEqual([false, false, true]);
    expect(plannerTotals(days)).toMatchObject({ plan: "400", planToDate: "200", act: "180", realization: "90", avgPrice: "40.00", transportPerMp: "3.00", weighedShare: "100", productionDays: 1, trips: 1 });
    expect(plannerTotals(days.slice(2))).toMatchObject({ realization: null, avgPrice: null });
  });
  it("miesiące roku: 12 sum; dane trafiają do właściwego miesiąca", () => {
    const days = plannerDays("2026-01-30", "2026-02-02", [op({ date: "2026-01-31", mp: "40" }), op({ date: "2026-02-01", mp: "60" })], [], "2026-10-01");
    const m = plannerMonths(days, 2026);
    expect(m).toHaveLength(12);
    expect([m[0]!.act, m[1]!.act, m[2]!.act]).toEqual(["40", "60", "0"]);
  });
  it("kierowcy: kursy po kierowcy i pojeździe, liczba kursów na dzień, sortowanie malejąco", () => {
    const d = plannerDrivers([
      op({ date: "2026-09-28", runs: [run({ qty: "30", km: "42", cost: "210" }), run({ qty: "30", km: "42", cost: "210" }), run({ driver: "Piotr Lis", registration: "SGL 7K310", qty: "20", km: "10", cost: "50" })] }),
      op({ date: "2026-09-29", runs: [run({ qty: "30", km: "40", cost: "200" })] }),
    ]);
    expect(d.map(x => [x.driver, x.trips, x.qty, x.km, x.cost])).toEqual([["Jan Nowak", 3, "90", "124", "620.00"], ["Piotr Lis", 1, "20", "10", "50.00"]]);
    expect(d[0]!.perDay).toEqual({ "2026-09-28": 2, "2026-09-29": 1 });
  });
});
