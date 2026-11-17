import { ADAPTATION_POLICY } from "../knowledge/adaptation-policy.js";

export function analyzeBudget(settings, consumedBytes, cycle = null) {
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
  return {
    cycle,
    policy: ADAPTATION_POLICY,
    configured: totalBytes > 0,
    enabled: Boolean(settings?.adaptiveEnabled) && cycle?.active !== false,
    totalBytes,
    consumedBytes: consumed,
    remainingBytes: Math.max(0, totalBytes - consumed),
    usedPercent: totalBytes ? (consumed / totalBytes) * 100 : 0,
    economyBytes,
    restrictedBytes,
    need:
      !totalBytes || !settings.adaptiveEnabled || cycle?.active === false
        ? "none"
        : consumed >= restrictedBytes
          ? "restrict"
          : consumed >= economyBytes
            ? "save"
            : "none",
  };
}
