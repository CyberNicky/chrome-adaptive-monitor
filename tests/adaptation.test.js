import test from "node:test";
import assert from "node:assert/strict";
import { createBudgetSettings } from "../extension/knowledge/budget-store.js";
import { analyzeBudget } from "../extension/analysis/budget-analyzer.js";
import { planAdaptation } from "../extension/planning/adaptation-planner.js";
import {
  translatePlan,
  ADAPTATION_RULE_IDS,
} from "../extension/execution/rule-translator.js";
import { createRequestEffector } from "../extension/effectors/chrome-request-effector.js";
const settings = createBudgetSettings({
  planName: "Teste",
  dataAmount: 1,
  dataUnit: "MB",
});
const session = { recording: true, tabId: 42 };

test("troca de modo exatamente nos limites X e Y, com unidades decimais", () => {
  for (const [bytes, mode] of [
    [0, "normal"],
    [699999, "normal"],
    [700000, "economy"],
    [899999, "economy"],
    [900000, "restricted"],
    [1200000, "restricted"],
  ]) {
    const analysis = analyzeBudget(settings, bytes);
    assert.equal(planAdaptation(analysis, session).mode, mode);
    assert.equal(analysis.remainingBytes, Math.max(0, 1e6 - bytes));
  }
  assert.equal(
    analyzeBudget(createBudgetSettings({ ...settings, dataUnit: "GB" }), 0)
      .totalBytes,
    1e9,
  );
});

test("metas são do sistema e ignoram antigos limites do usuário; desativação libera recursos", () => {
  const previous = createBudgetSettings({
    ...settings,
    economyPercent: 20,
    restrictedPercent: 60,
  });
  assert.equal(Object.hasOwn(previous, "economyPercent"), false);
  assert.equal(Object.hasOwn(previous, "restrictedPercent"), false);
  assert.equal(
    planAdaptation(analyzeBudget(previous, 200000), session).mode,
    "normal",
  );
  assert.equal(
    planAdaptation(
      analyzeBudget(
        { ...previous, economyPercent: 1, restrictedPercent: 2 },
        600000,
      ),
      session,
    ).mode,
    "normal",
  );
  assert.equal(
    planAdaptation(analyzeBudget(previous, 700000), session).mode,
    "economy",
  );
  const disabled = analyzeBudget({ ...settings, adaptiveEnabled: false }, 1e6);
  assert.equal(planAdaptation(disabled, session).mode, "normal");
  assert.equal(
    planAdaptation(analyzeBudget(settings, 1e6), {
      ...session,
      recording: false,
    }).mode,
    "normal",
  );
  assert.equal(
    planAdaptation(analyzeBudget(settings, 1e6), { ...session, tabId: null })
      .mode,
    "normal",
  );
  assert.equal(
    planAdaptation(analyzeBudget(null, 1e6), session).mode,
    "normal",
  );
});

test("regras têm escopo por aba e preservam HTML, CSS, scripts e fontes", () => {
  assert.deepEqual(translatePlan({ mode: "normal", tabId: 42 }), []);
  for (const mode of ["economy", "restricted"]) {
    const rules = translatePlan({ mode, tabId: 42 });
    assert.equal(rules.length, mode === "economy" ? 2 : 4);
    for (const rule of rules) {
      assert.deepEqual(rule.condition.tabIds, [42]);
      assert.equal(rule.action.type, "block");
      for (const essential of [
        "main_frame",
        "sub_frame",
        "stylesheet",
        "script",
        "font",
      ])
        assert.ok(!rule.condition.resourceTypes.includes(essential));
    }
    assert.equal(
      rules.some((r) => r.condition.resourceTypes.includes("image")),
      mode === "restricted",
    );
    const mediaRegex = new RegExp(rules[1].condition.regexFilter, "i");
    assert.ok(mediaRegex.test("https://example.com/video.webm?token=1"));
    assert.ok(!mediaRegex.test("https://example.com/api?filename=video.webm"));
  }
});

test("efetor confirma regras, substitui atomicamente, restaura Normal e não anuncia aplicação que falhou", async () => {
  const calls = [];
  let fail = false;
  const effector = createRequestEffector({
    async updateSessionRules(update) {
      if (fail) throw new Error("Chrome recusou");
      calls.push(update);
    },
  });
  await effector.apply({ mode: "economy", tabId: 42 });
  assert.equal(effector.applied.mode, "economy");
  await effector.apply({ mode: "economy", tabId: 42 });
  assert.equal(calls.length, 1, "regras iguais não são reinstaladas");
  fail = true;
  await assert.rejects(effector.apply({ mode: "restricted", tabId: 42 }));
  assert.equal(
    effector.applied.mode,
    "economy",
    "modo anterior continua sendo o confirmado",
  );
  fail = false;
  await effector.apply({ mode: "restricted", tabId: 99 });
  assert.deepEqual(calls.at(-1).removeRuleIds, ADAPTATION_RULE_IDS);
  assert.ok(calls.at(-1).addRules.every((r) => r.condition.tabIds[0] === 99));
  await effector.apply({ mode: "normal", tabId: null });
  assert.deepEqual(calls.at(-1).addRules, []);
  assert.equal(effector.applied.mode, "normal");
});
