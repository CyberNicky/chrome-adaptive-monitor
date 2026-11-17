import test from "node:test";
import assert from "node:assert/strict";
import { createBudgetSettings } from "../extension/knowledge/budget-store.js";
import {
  getBillingCycle,
  parseDate,
} from "../extension/knowledge/billing-cycle.js";
import { reconcileUsage } from "../extension/knowledge/budget-usage.js";
import { analyzeBudget } from "../extension/analysis/budget-analyzer.js";
import { planAdaptation } from "../extension/planning/adaptation-planner.js";

const at = (date, time = "12:00:00") => new Date(`${date}T${time}`).getTime();
const settings = (extra = {}) =>
  createBudgetSettings({
    planName: "Móvel",
    dataAmount: 1,
    dataUnit: "MB",
    cycleStartDate: "2026-11-17",
    ...extra,
  });
const capture = (date = "2026-11-17", bytes = 720000) => ({
  startedAt: at(date),
  recording: true,
  tabId: 1,
  requests: [{ id: 1, startedAt: at(date), transferredBytes: bytes }],
});
const mode = (usage, session) =>
  planAdaptation(
    analyzeBudget(settings(), usage.consumedBytes, usage.cycle),
    session,
  ).mode;

test("ciclo mensal renova na data contratada, não na virada do mês", () => {
  const cycle = getBillingCycle(settings(), at("2026-12-01"));
  assert.equal(cycle.startDate, "2026-11-17");
  assert.equal(cycle.endDate, "2026-12-17");
  assert.equal(cycle.durationDays, 30);
  assert.equal(cycle.remainingDays, 16);
  assert.equal(
    getBillingCycle(settings(), at("2026-12-17", "00:00:00")).startDate,
    "2026-12-17",
  );
});
test("dia 31 ajusta fevereiro e retoma o dia original, inclusive em ano bissexto", () => {
  for (const [year, last] of [
    [2027, "28"],
    [2028, "29"],
  ]) {
    const config = settings({ cycleStartDate: `${year}-01-31` });
    const feb = getBillingCycle(config, at(`${year}-02-${last}`));
    assert.equal(feb.startDate, `${year}-02-${last}`);
    assert.equal(feb.endDate, `${year}-03-31`);
    assert.equal(
      getBillingCycle(config, at(`${year}-03-30`)).startDate,
      `${year}-02-${last}`,
    );
  }
});
test("ciclos fixos seguem dias corridos e saltam períodos sem abrir o navegador", () => {
  const config = settings({ cycleType: "days", cycleDays: 7 });
  const cycle = getBillingCycle(config, at("2027-01-05"));
  assert.equal(cycle.startDate, "2027-01-05");
  assert.equal(cycle.endDate, "2027-01-12");
  assert.equal(cycle.durationDays, 7);
});
test("valida datas impossíveis e durações; início futuro não conta nem restringe", () => {
  for (const date of [
    "2026-02-29",
    "2026-13-01",
    "2026-11-31",
    "17/11/2026",
    "",
  ])
    assert.throws(() => parseDate(date));
  for (const days of [0, -1, 1.5, 367, ""])
    assert.throws(() => settings({ cycleType: "days", cycleDays: days }));
  assert.throws(() => settings({ cycleType: "yearly" }));
  const session = capture("2026-11-16", 990000);
  const usage = reconcileUsage(null, settings(), session, at("2026-11-16"));
  assert.equal(usage.cycle.active, false);
  assert.equal(usage.consumedBytes, 0);
  assert.equal(mode(usage, session), "normal");
});
test("renovação zera o ciclo, libera o modo e não recarrega bytes antigos", () => {
  const session = capture();
  let usage = reconcileUsage(null, settings(), session, at("2026-11-17"));
  assert.equal(mode(usage, session), "economy");
  usage = reconcileUsage(
    usage,
    settings(),
    session,
    at("2026-12-17", "00:00:00"),
  );
  assert.equal(usage.consumedBytes, 0);
  assert.equal(mode(usage, session), "normal");
  usage = reconcileUsage(usage, settings(), session, at("2026-12-18"));
  assert.equal(usage.consumedBytes, 0);
  assert.equal(
    session.requests[0].transferredBytes,
    720000,
    "tabela da captura preservada",
  );
});
test("requisição que atravessa a meia-noite contabiliza só novos bytes no ciclo novo", () => {
  const session = capture("2026-12-16", 600);
  let usage = reconcileUsage(
    null,
    settings(),
    session,
    at("2026-12-16", "23:59:59"),
  );
  usage = reconcileUsage(
    usage,
    settings(),
    session,
    at("2026-12-17", "00:00:00"),
  );
  session.requests[0].transferredBytes = 1000;
  usage = reconcileUsage(
    usage,
    settings(),
    session,
    at("2026-12-17", "00:00:01"),
  );
  assert.equal(usage.consumedBytes, 400);
  session.requests[0].transferredBytes = 900;
  usage = reconcileUsage(usage, settings(), session, at("2026-12-17"));
  assert.equal(
    usage.consumedBytes,
    300,
    "total final substitui parcial sem duplicar",
  );
  session.requests[0].transferredBytes = 0;
  usage = reconcileUsage(usage, settings(), session, at("2026-12-17"));
  assert.equal(
    usage.consumedBytes,
    0,
    "correção não subtrai consumo do ciclo anterior",
  );
});
test("consumo sobrevive a novas capturas, limpeza, serialização e edição do plano", () => {
  const first = capture();
  let usage = reconcileUsage(null, settings(), first, at("2026-11-17"));
  usage = JSON.parse(JSON.stringify(usage));
  usage = reconcileUsage(usage, settings(), null, at("2026-11-18"));
  assert.equal(usage.consumedBytes, 720000);
  const next = capture("2026-11-18", 100000);
  usage = reconcileUsage(usage, settings(), next, at("2026-11-18"));
  assert.equal(usage.consumedBytes, 820000);
  usage = reconcileUsage(
    usage,
    settings({ dataAmount: 2, cycleStartDate: "2026-11-01" }),
    next,
    at("2026-11-18"),
  );
  assert.equal(
    usage.consumedBytes,
    820000,
    "editar datas/quantidade não zera consumo",
  );
  usage = reconcileUsage(
    usage,
    settings({ dataAmount: 2, cycleStartDate: "2026-11-01" }),
    next,
    at("2026-11-18"),
  );
  assert.equal(
    usage.consumedBytes,
    820000,
    "reconciliar novamente não duplica",
  );
});
test("migração inclui apenas registros do ciclo atual e não inventa tráfego anterior", () => {
  const session = capture("2026-11-16", 500000);
  session.requests.push({
    id: 2,
    startedAt: at("2026-11-18"),
    transferredBytes: 200000,
  });
  const usage = reconcileUsage(null, settings(), session, at("2026-11-18"));
  assert.equal(usage.consumedBytes, 200000);
});
