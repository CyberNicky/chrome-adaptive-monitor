import { ADAPTATION_POLICY } from "../knowledge/adaptation-policy.js";

// A linear projection of observed cycle consumption, not a forecast of all
// device traffic. Fractional days use the actual cycle interval (including DST).
export function analyzeConsumptionPace(
  totalBytes, consumedBytes, cycle, now = Date.now(),
) {
  const unavailable = { status: "unavailable", need: "none" };
  if (
    !cycle || !totalBytes || !cycle.active ||
    !Number.isFinite(now) || !Number.isFinite(cycle.startsAt) ||
    !Number.isFinite(cycle.endsAt) || !(cycle.durationDays > 0) ||
    cycle.endsAt <= cycle.startsAt || now < cycle.startsAt || now >= cycle.endsAt
  ) return unavailable;
  const elapsedDays = cycle.durationDays *
    ((now - cycle.startsAt) / (cycle.endsAt - cycle.startsAt));
  const remainingDays = cycle.durationDays - elapsedDays;
  const averageDailyBytes = elapsedDays > 0 ? consumedBytes / elapsedDays : null;
  const projectedBytes = averageDailyBytes === null
    ? null : averageDailyBytes * cycle.durationDays;
  const projectedPercent = projectedBytes === null ? null : projectedBytes / totalBytes * 100;
  const ready = elapsedDays >= ADAPTATION_POLICY.paceMinimumDays;
  return {
    status: ready ? "ready" : "collecting",
    elapsedDays,
    remainingDays,
    averageDailyBytes,
    sustainableDailyBytes: Math.max(0, totalBytes - consumedBytes) / remainingDays,
    projectedBytes,
    projectedPercent,
    need: !ready ? "none"
      : projectedPercent >= ADAPTATION_POLICY.paceRestrictedPercent ? "restrict"
        : projectedPercent >= ADAPTATION_POLICY.paceEconomyPercent ? "save" : "none",
  };
}
