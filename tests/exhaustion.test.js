import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBudget } from "../extension/analysis/budget-analyzer.js";
import { planAdaptation } from "../extension/planning/adaptation-planner.js";
import { translatePlan, ALL_RESOURCE_TYPES } from "../extension/execution/rule-translator.js";

const settings = { dataAmount: 1, dataUnit: "MB", adaptiveEnabled: true };
const session = { recording: true, tabId: 9 };
const plan = (bytes, config = settings, capture = session) =>
  planAdaptation(analyzeBudget(config, bytes), capture);

test("saldo zero ativa bloqueio total somente em 100%, mantendo os três modos", () => {
  assert.equal(plan(999999).exhausted, false);
  for (const bytes of [1000000, 1500000]) {
    const result = plan(bytes);
    assert.equal(result.mode, "restricted");
    assert.equal(result.exhausted, true);
    assert.match(result.reason, /HTML, CSS, scripts e APIs/);
  }
});
test("regra de saldo zero inclui documentos, texto via API e todos os demais tipos somente na aba alvo", () => {
  const rules = translatePlan(plan(1000000));
  assert.equal(rules.length, 1);
  assert.equal(rules[0].action.type, "block");
  assert.deepEqual(rules[0].condition.tabIds, [9]);
  assert.deepEqual(rules[0].condition.resourceTypes, ALL_RESOURCE_TYPES);
  for (const type of ["main_frame", "sub_frame", "stylesheet", "script", "font", "xmlhttprequest", "websocket"])
    assert.ok(rules[0].condition.resourceTypes.includes(type));
  const match = new RegExp(rules[0].condition.regexFilter);
  for (const protocol of ["http", "https", "ws", "wss"])
    assert.ok(match.test(`${protocol}://example.com/`));
  assert.equal(match.test("chrome-extension://navega/ui/panel.html"), false);
});
test("desativar, encerrar ou aumentar a franquia remove o estado esgotado; ausência/futuro não bloqueia", () => {
  for (const result of [
    plan(1000000, { ...settings, adaptiveEnabled: false }),
    plan(1000000, settings, { ...session, recording: false }),
    plan(1000000, settings, { ...session, tabId: null }),
    plan(1000000, { ...settings, dataAmount: 10 }),
    plan(1000000, null),
    planAdaptation(analyzeBudget(settings, 1000000, { active: false }), session),
  ]) {
    assert.equal(result.exhausted, false);
    assert.deepEqual(translatePlan(result), []);
  }
  const merelyRestricted = translatePlan(plan(950000));
  assert.equal(merelyRestricted.length, 4);
  assert.ok(merelyRestricted.every((r) => !r.condition.resourceTypes.includes("main_frame")));
});
