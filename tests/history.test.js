import test from "node:test";
import assert from "node:assert/strict";
import {
  createHistoryStore,
  HISTORY_KEY,
  MAX_HISTORY_SESSIONS,
  MAX_HISTORY_BYTES,
  retainHistory,
} from "../extension/knowledge/history-store.js";
import {
  createSession,
  stopSession,
} from "../extension/monitoring/request-collector.js";

function fixture() {
  let value = {};
  let fail = false;
  const storage = {
    async get(key) {
      return { [key]: structuredClone(value[key]) };
    },
    async set(update) {
      if (fail) throw new Error("disk failed");
      value = { ...value, ...structuredClone(update) };
    },
  };
  return {
    store: createHistoryStore(storage),
    storage,
    value: () => value,
    fail: () => {
      fail = true;
    },
  };
}
function capture(now = Date.now()) {
  const session = createSession({ id: 1, url: "https://example.com" }, now);
  session.recording = true;
  session.requests = [
    {
      id: 1,
      tabId: 1,
      url: "https://example.com/file",
      domain: "example.com",
      pageUrl: "https://example.com",
      type: "image",
      state: "complete",
      transferredBytes: 400,
      decodedBytes: 800,
      startedAt: now,
    },
  ];
  return session;
}
test("sessão encerrada preserva detalhes, ranking e orçamento sem ser sobrescrita", async () => {
  const f = fixture();
  await f.store.load();
  const session = capture();
  await f.store.saveSession(
    session,
    { budgetSettings: { planName: "Plano original" } },
    true,
  );
  assert.deepEqual(
    f.store.summaries(session),
    [],
    "captura ativa não aparece como anterior",
  );
  stopSession(session, "", session.startedAt + 1000);
  await f.store.saveSession(
    session,
    { budgetSettings: { planName: "Plano original" } },
    true,
  );
  const entry = f.store.get(session.id);
  assert.equal(entry.metrics.transferredBytes, 400);
  assert.equal(entry.metrics.byTab[0].bytes, 400);
  assert.equal(entry.session.requests.length, 1);
  assert.deepEqual(entry.session.active, {});
  await f.store.saveSession(
    session,
    { budgetSettings: { planName: "Plano alterado" } },
    true,
  );
  assert.equal(
    f.store.get(session.id).budgetSettings.planName,
    "Plano original",
  );
  session.requests[0].transferredBytes = 999;
  assert.equal(
    f.store.get(session.id).metrics.transferredBytes,
    400,
    "snapshot isolado da captura",
  );
  const restored = createHistoryStore(f.storage);
  await restored.load();
  assert.equal(restored.summaries().length, 1);
  assert.equal(restored.get(session.id).metrics.transferredBytes, 400);
});
test("reinício recupera checkpoint ativo, marca pendências como interrompidas e congela no ponto salvo", async () => {
  const f = fixture();
  await f.store.load();
  const session = capture();
  session.requests[0].state = "pending";
  await f.store.saveSession(session, {}, true);
  const savedAt = f.store.get(session.id).savedAt;
  const restored = createHistoryStore(f.storage);
  await restored.load();
  const entry = restored.get(session.id);
  assert.equal(entry.recovered, true);
  assert.equal(entry.session.recording, false);
  assert.equal(entry.session.stoppedAt, savedAt);
  assert.equal(entry.metrics.pending, 0);
  assert.equal(entry.session.requests[0].state, "interrupted");
  assert.equal(entry.metrics.transferredBytes, 400);
  assert.match(entry.session.notice, /último ponto salvo/);
});
test("reiniciar só o worker preserva a captura ativa sem duplicar o histórico", async () => {
  const f = fixture();
  await f.store.load();
  const session = capture();
  await f.store.saveSession(session, {}, true);
  const restored = createHistoryStore(f.storage);
  await restored.load(session);
  assert.equal(restored.get(session.id).session.recording, true);
  assert.equal(restored.summaries(session).length, 0);
  stopSession(session);
  await restored.saveSession(session, {}, true);
  assert.equal(restored.summaries().length, 1);
});
test("retenção limita quantidade e bytes, mantendo as sessões mais recentes", async () => {
  const f = fixture();
  await f.store.load();
  for (let index = 0; index < MAX_HISTORY_SESSIONS + 2; index++) {
    const session = capture(1000 + index);
    stopSession(session, "", 2000 + index);
    await f.store.saveSession(session, {}, true);
  }
  const summaries = f.store.summaries();
  assert.equal(summaries.length, MAX_HISTORY_SESSIONS);
  assert.equal(summaries[0].startedAt, 1011);
  assert.equal(summaries.at(-1).startedAt, 1002);
  const entries = f.value()[HISTORY_KEY].entries;
  const big = entries
    .slice(0, 2)
    .map((entry) => ({ ...entry, large: "x".repeat(2_100_000) }));
  const retained = retainHistory(big);
  assert.equal(retained.length, 1);
  assert.ok(
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, entries: retained }),
    ).byteLength < MAX_HISTORY_BYTES,
  );
  assert.throws(
    () =>
      retainHistory([{ ...entries[0], large: "x".repeat(MAX_HISTORY_BYTES) }]),
    /Exporte/,
  );
});
test("falha ao persistir não anuncia uma sessão salva e exclusão remove apenas o registro escolhido", async () => {
  const f = fixture();
  await f.store.load();
  const session = capture();
  stopSession(session);
  await f.store.saveSession(session, {}, true);
  await f.store.remove(session.id);
  assert.deepEqual(f.store.summaries(), []);
  assert.throws(() => f.store.get(session.id), /não encontrada/);
  f.fail();
  const another = capture();
  stopSession(another);
  await assert.rejects(f.store.saveSession(another, {}, true));
  assert.deepEqual(f.store.summaries(), []);
});
