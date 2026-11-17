import { aggregateMetrics } from "../monitoring/metrics-aggregator.js";
import { stopSession } from "../monitoring/request-collector.js";

export const HISTORY_KEY = "captureHistory";
export const MAX_HISTORY_SESSIONS = 10;
export const MAX_HISTORY_BYTES = 4_000_000;
export const historySessionId = (session) =>
  session ? String(session.id ?? session.startedAt) : null;
const documentFor = (entries) => ({ schemaVersion: 1, entries });
export function retainHistory(entries) {
  const kept = [...entries]
    .sort((a, b) => b.session.startedAt - a.session.startedAt)
    .slice(0, MAX_HISTORY_SESSIONS);
  const size = () =>
    new TextEncoder().encode(JSON.stringify(documentFor(kept))).byteLength;
  while (kept.length > 1 && size() > MAX_HISTORY_BYTES) kept.pop();
  if (size() > MAX_HISTORY_BYTES)
    throw new Error(
      "Esta sessão excede o espaço do histórico. Exporte o JSON antes de limpar ou iniciar outra captura.",
    );
  return kept;
}

export function createHistoryStore(storage) {
  let entries = [];
  const revisions = new Map();
  async function commit(next) {
    const retained = retainHistory(next);
    await storage.set({ [HISTORY_KEY]: documentFor(retained) });
    entries = retained;
    const ids = new Set(entries.map((entry) => entry.id));
    for (const id of revisions.keys()) if (!ids.has(id)) revisions.delete(id);
  }
  return {
    async load(activeSession = null) {
      const saved = (await storage.get(HISTORY_KEY))[HISTORY_KEY];
      entries = Array.isArray(saved?.entries) ? saved.entries : [];
      const activeId = activeSession?.recording
        ? historySessionId(activeSession)
        : null;
      let changed = false;
      const recovered = entries.map((entry) => {
        if (!entry.session.recording || entry.id === activeId) return entry;
        const copy = structuredClone(entry);
        stopSession(
          copy.session,
          "Captura interrompida ao fechar ou recarregar o navegador. Dados preservados até o último ponto salvo.",
          entry.savedAt,
        );
        copy.recovered = true;
        copy.metrics = aggregateMetrics(copy.session, entry.savedAt);
        changed = true;
        return copy;
      });
      if (changed) await commit(recovered);
    },
    summaries(activeSession = null) {
      const activeId = activeSession?.recording
        ? historySessionId(activeSession)
        : null;
      return entries
        .filter((entry) => entry.id !== activeId && !entry.session.recording)
        .map((entry) => ({
          id: entry.id,
          startedAt: entry.session.startedAt,
          stoppedAt: entry.session.stoppedAt,
          savedAt: entry.savedAt,
          recovered: Boolean(entry.recovered),
          transferredBytes: entry.metrics.transferredBytes,
          requests: entry.metrics.requests,
          tabs: entry.session.tabs?.length ?? 1,
        }));
    },
    async saveSession(session, context = {}, force = false) {
      if (!session) return false;
      const id = historySessionId(session);
      const previous = entries.find((entry) => entry.id === id);
      if (previous && !previous.session.recording && !session.recording)
        return false;
      const now = Date.now();
      // Save live checkpoints at most once a second; always persist an end/clear.
      if (
        !force &&
        session.recording &&
        previous &&
        now - previous.savedAt < 1000
      )
        return false;
      const { active, ...publicSession } = session;
      const entry = {
        id,
        session: structuredClone({ ...publicSession, active: {} }),
        metrics: aggregateMetrics(session, now),
        ...structuredClone(context),
      };
      const revision = JSON.stringify(entry);
      if (revisions.get(id) === revision) return false;
      entry.savedAt = now;
      await commit([entry, ...entries.filter((item) => item.id !== id)]);
      revisions.set(id, revision);
      return true;
    },
    get(id) {
      const entry = entries.find((item) => item.id === id);
      if (!entry)
        throw new Error(
          "Sessão não encontrada no histórico. Ela pode ter sido excluída ou removida pelo limite de armazenamento.",
        );
      return structuredClone(entry);
    },
    async remove(id) {
      if (!entries.some((item) => item.id === id))
        throw new Error("Sessão não encontrada no histórico.");
      await commit(entries.filter((item) => item.id !== id));
      revisions.delete(id);
    },
  };
}
