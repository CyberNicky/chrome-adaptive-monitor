import { estimateConsumption } from "./consumption-estimator.js";

export function aggregateMetrics(session, now = Date.now()) {
  const metrics = {
    requests: 0,
    transferredBytes: 0,
    decodedBytes: 0,
    unknownSizes: 0,
    pending: 0,
    failures: 0,
    cached: 0,
    byType: {},
    byDomain: {},
    bytesPerMinute: 0,
  };
  for (const row of session?.requests ?? []) {
    const size = estimateConsumption(row);
    const bytes = size.transferredBytes ?? 0;
    metrics.requests++;
    metrics.transferredBytes += bytes;
    metrics.decodedBytes += size.decodedBytes ?? 0;
    metrics.unknownSizes += Number(size.transferredBytes === null);
    metrics.pending += Number(row.state === "pending");
    metrics.failures += Number(
      row.state === "failed" || (row.status ?? 0) >= 400,
    );
    metrics.cached += Number(size.cached);
    for (const [group, key] of [
      [metrics.byType, row.type],
      [metrics.byDomain, row.domain],
    ]) {
      // Null prototypes are unnecessary here: explicit own checks avoid special object keys.
      if (!Object.hasOwn(group, key))
        Object.defineProperty(group, key, {
          value: { requests: 0, bytes: 0 },
          enumerable: true,
        });
      group[key].requests++;
      group[key].bytes += bytes;
    }
  }
  if (session) {
    const elapsed = Math.max(
      1,
      ((session.stoppedAt ?? now) - session.startedAt) / 1000,
    );
    metrics.bytesPerMinute = (metrics.transferredBytes / elapsed) * 60;
  }
  return metrics;
}
