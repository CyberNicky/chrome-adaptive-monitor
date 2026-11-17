import { getBillingCycle } from "./billing-cycle.js";

const KEY = "dataBudgetUsage";
// Checkpoints contain only IDs and byte totals, never browsing URLs/history.
export function reconcileUsage(previous, settings, session, now = Date.now()) {
  if (!settings) return null;
  const cycle = getBillingCycle(settings, now);
  const sameSession = previous?.sessionId === (session?.startedAt ?? null);
  const renewed =
    previous &&
    previous.cycle.key !== cycle.key &&
    now >= previous.cycle.endsAt &&
    cycle.startsAt >= previous.cycle.endsAt;
  const usage = {
    schemaVersion: 1,
    cycle,
    consumedBytes: renewed ? 0 : (previous?.consumedBytes ?? 0),
    sessionId: session?.startedAt ?? null,
    checkpoints: sameSession ? previous.checkpoints : {},
    updatedAt: now,
    lastRenewedAt: renewed ? now : (previous?.lastRenewedAt ?? null),
  };
  if (renewed || previous?.cycle.key !== cycle.key)
    for (const checkpoint of Object.values(usage.checkpoints))
      checkpoint.cycleBytes = 0;
  for (const row of session?.requests ?? []) {
    const bytes = Number.isFinite(row.transferredBytes)
      ? Math.max(0, row.transferredBytes)
      : 0;
    let checkpoint = usage.checkpoints[row.id];
    if (!checkpoint) {
      // On migration, rows from earlier cycles establish a baseline only.
      const inCycle =
        row.startedAt >= cycle.startsAt && row.startedAt < cycle.endsAt;
      checkpoint = {
        bytes: inCycle && cycle.active ? 0 : bytes,
        cycleBytes: 0,
      };
      usage.checkpoints[row.id] = checkpoint;
    }
    if (cycle.active) {
      // Final CDP totals replace partial values. A correction cannot deduct bytes
      // from an earlier cycle or from another request.
      const delta = Math.max(-checkpoint.cycleBytes, bytes - checkpoint.bytes);
      usage.consumedBytes = Math.max(0, usage.consumedBytes + delta);
      checkpoint.cycleBytes = Math.max(0, checkpoint.cycleBytes + delta);
    }
    checkpoint.bytes = bytes;
  }
  return usage;
}
export const usageStore = {
  async load() {
    return (await chrome.storage.local.get(KEY))[KEY] ?? null;
  },
  async save(usage) {
    if (usage) await chrome.storage.local.set({ [KEY]: usage });
  },
};
