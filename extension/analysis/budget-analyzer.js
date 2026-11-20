import { ADAPTATION_POLICY } from "../knowledge/adaptation-policy.js";
import { analyzeConsumptionPace } from "./consumption-pace.js";

export function analyzeBudget(
  settings, consumedBytes, cycle = null, now = Date.now(),
) {
  const totalBytes = settings
    ? Math.round(settings.dataAmount * (settings.dataUnit === "GB" ? 1e9 : 1e6))
    : 0;
  const consumed = Math.max(0, consumedBytes);
  const economyBytes = Math.ceil(
    (totalBytes * ADAPTATION_POLICY.economyPercent) / 100,
  );
  const restrictedBytes = Math.ceil(
    (totalBytes * ADAPTATION_POLICY.restrictedPercent) / 100,
  );
  const pace = analyzeConsumptionPace(totalBytes, consumed, cycle, now);
  const enabled = Boolean(settings?.adaptiveEnabled) && cycle?.active !== false;
  const quotaNeed = consumed >= restrictedBytes ? "restrict"
    : consumed >= economyBytes ? "save" : "none";
  const rank = { none: 0, save: 1, restrict: 2 };
  let decisionSource = "none";
  if (totalBytes > 0 && enabled) {
    if (quotaNeed !== "none" && rank[quotaNeed] >= rank[pace.need])
      decisionSource = "quota";
    else if (pace.need !== "none") decisionSource = "pace";
  }
  return {
    cycle,
    pace,
    decisionSource,
    policy: ADAPTATION_POLICY,
    configured: totalBytes > 0,
    enabled,
    totalBytes,
    consumedBytes: consumed,
    remainingBytes: Math.max(0, totalBytes - consumed),
    exhausted: totalBytes > 0 && consumed >= totalBytes,
    usedPercent: totalBytes ? (consumed / totalBytes) * 100 : 0,
    economyBytes,
    restrictedBytes,
    need: decisionSource === "quota" ? quotaNeed
      : decisionSource === "pace" ? pace.need : "none",
  };
}
