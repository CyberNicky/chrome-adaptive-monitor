import {
  ADAPTATION_RULE_IDS,
  translatePlan,
} from "../execution/rule-translator.js";

// All callers are serialized by the controller. Only our own session rules are replaced.
export function createRequestEffector(api) {
  let signature = null;
  let applied = { mode: "normal", tabId: null, ruleCount: 0 };
  return {
    async apply(plan) {
      const rules = translatePlan(plan);
      const next = JSON.stringify(rules);
      if (next !== signature) {
        await api.updateSessionRules({
          removeRuleIds: ADAPTATION_RULE_IDS,
          addRules: rules,
        });
        signature = next;
      }
      // Report success only after Chrome confirms the atomic rule update.
      applied = { mode: plan.mode, tabId: plan.tabId, ruleCount: rules.length };
      return applied;
    },
    get applied() {
      return applied;
    },
  };
}
