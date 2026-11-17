import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBudget } from "../extension/analysis/budget-analyzer.js";
import { planAdaptation } from "../extension/planning/adaptation-planner.js";
import { getBillingCycle } from "../extension/knowledge/billing-cycle.js";

const settings = {
  dataAmount: 1, dataUnit: "MB", adaptiveEnabled: true,
  cycleStartDate: "2026-01-01", cycleType: "days", cycleDays: 30,
};
const session = { recording: true, tabId: 7 };
const analyze = (bytes, now, config = settings) => analyzeBudget(
  config, bytes, getBillingCycle(config, now), now,
);
const day10 = new Date(2026, 0, 11).getTime();

test("mesmo consumo exige economia no início, mas é sustentável perto da renovação", () => {
  const early = analyze(400000, day10);
  const late = analyze(400000, new Date(2026, 0, 21).getTime());
  assert.equal(early.decisionSource, "pace");
  assert.equal(planAdaptation(early, session).mode, "economy");
  assert.equal(early.pace.averageDailyBytes, 40000);
  assert.equal(early.pace.sustainableDailyBytes, 30000);
  assert.equal(early.pace.projectedBytes, 1200000);
  assert.equal(late.pace.projectedBytes, 600000);
  assert.equal(planAdaptation(late, session).mode, "normal");
  assert.match(planAdaptation(early, session).reason, /Ritmo de consumo elevado/);
});

test("projeções cruzam os limites internos de 110% e 150%, antes das metas absolutas", () => {
  for (const [bytes, mode] of [
    [366666, "normal"], [366667, "economy"],
    [499999, "economy"], [500000, "restricted"],
  ]) {
    const result = analyze(bytes, day10);
    assert.equal(planAdaptation(result, session).mode, mode);
    assert.ok(result.usedPercent < 70);
  }
});

test("primeiro dia não usa projeção; metas 70/90 continuam protegendo o saldo", () => {
  for (const now of [new Date(2026, 0, 1).getTime(), new Date(2026, 0, 1, 23).getTime()]) {
    assert.equal(analyze(400000, now).pace.status, "collecting");
    assert.equal(analyze(400000, now).need, "none");
    assert.equal(analyze(700000, now).need, "save");
    assert.equal(analyze(900000, now).need, "restrict");
  }
  const ready = analyze(60000, new Date(2026, 0, 2).getTime());
  assert.equal(ready.pace.status, "ready");
  assert.equal(ready.need, "restrict");
});

test("aplica a maior proteção e restaura Normal na renovação, sem orçamento ou com adaptação desligada", () => {
  const late = analyze(900000, new Date(2026, 0, 30).getTime());
  assert.equal(late.decisionSource, "quota");
  assert.equal(late.need, "restrict");
  const disabled = analyze(600000, day10, { ...settings, adaptiveEnabled: false });
  assert.equal(planAdaptation(disabled, session).mode, "normal");
  assert.equal(planAdaptation(analyze(600000, day10), { ...session, recording: false }).mode, "normal");
  assert.equal(analyzeBudget(null, 600000).need, "none");
  const renewed = analyze(0, new Date(2026, 0, 31).getTime());
  assert.equal(renewed.pace.status, "collecting");
  assert.equal(renewed.need, "none");
});

test("ciclo futuro, ausente ou vencido não produz projeção; zero consumo e último instante permanecem finitos", () => {
  assert.equal(analyze(400000, new Date(2025, 11, 31).getTime()).pace.status, "unavailable");
  assert.equal(analyzeBudget(settings, 0).pace.status, "unavailable");
  const cycle = getBillingCycle(settings, day10);
  assert.equal(analyzeBudget(settings, 0, cycle, cycle.endsAt).pace.status, "unavailable");
  const zero = analyze(0, day10);
  assert.equal(zero.pace.projectedBytes, 0);
  assert.equal(zero.need, "none");
  const end = analyze(100, cycle.endsAt - 1);
  assert.ok(Number.isFinite(end.pace.sustainableDailyBytes));
  assert.ok(Number.isFinite(end.pace.projectedBytes));
});

test("ciclos mensais usam a duração real, incluindo fevereiro bissexto e dias fracionários", () => {
  const config = { ...settings, cycleType: "monthly", cycleStartDate: "2024-02-01" };
  const result = analyze(500000, new Date(2024, 1, 15, 12).getTime(), config);
  assert.equal(result.cycle.durationDays, 29);
  assert.ok(Math.abs(result.pace.elapsedDays - 14.5) < 0.001);
  assert.ok(Math.abs(result.pace.projectedBytes - 1000000) < 1);
  assert.equal(result.need, "none");
});
