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
    byTab: [],
    bytesPerMinute: 0,
  };
  const tabs = new Map();
  const addTab = (tabId, url) => {
    if (!tabs.has(tabId))
      tabs.set(tabId, {
        tabId,
        url: url ?? null,
        tabNumber: tabs.size + 1,
        requests: 0,
        bytes: 0,
        unknownSizes: 0,
        pending: 0,
      });
    return tabs.get(tabId);
  };
  for (const tab of session?.tabs ?? []) addTab(tab.id, tab.url);
  for (const row of session?.requests ?? []) {
    const size = estimateConsumption(row);
    const bytes = size.transferredBytes ?? 0;
    // Sessions created before tab attribution belong to their original target.
    const tabId = row.tabId ?? session.tabs?.[0]?.id ?? session.tabId ?? null;
    const tab = addTab(tabId, row.pageUrl ?? session.pageUrl);
    tab.requests++;
    tab.bytes += bytes;
    tab.unknownSizes += Number(size.transferredBytes === null);
    tab.pending += Number(row.state === "pending");
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
  metrics.byTab = [...tabs.values()].sort(
    (a, b) => b.bytes - a.bytes || a.tabNumber - b.tabNumber,
  );
  if (session) {
    const elapsed = Math.max(
      1,
      ((session.stoppedAt ?? now) - session.startedAt) / 1000,
    );
    metrics.bytesPerMinute = (metrics.transferredBytes / elapsed) * 60;
  }
  return metrics;
}
