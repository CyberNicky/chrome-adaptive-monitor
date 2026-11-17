import test from "node:test";
import assert from "node:assert/strict";
import { createPageAlertEffector } from "../extension/effectors/chrome-page-alert-effector.js";

function fixture() {
  const calls = [];
  let fail = false;
  const effector = createPageAlertEffector({
    async sendCommand(source, method, params) {
      calls.push({ source, method, params });
      if (fail && method === "Runtime.evaluate") throw new Error("detached");
      if (method === "Page.getFrameTree")
        return {
          frameTree: {
            frame: { id: `root-${source.tabId}` },
            childFrames: [{ frame: { id: "iframe" } }],
          },
        };
      if (method === "Page.createIsolatedWorld")
        return { executionContextId: 1 };
      return {};
    },
  });
  return {
    effector,
    calls,
    fail: () => {
      fail = true;
    },
  };
}
const alert = {
  current: { level: 70, title: "Atenção", message: "Consumo alto" },
  token: "cycle",
  visible: true,
};
const analysis = { usedPercent: 72 };
test("aviso usa apenas frame principal e binding de mundo isolado; troca limpa a aba anterior", async () => {
  const { effector, calls } = fixture();
  await effector.apply(1, alert, analysis);
  assert.deepEqual(
    calls
      .filter((c) => c.method === "Page.createIsolatedWorld")
      .map((c) => c.params.frameId),
    ["root-1"],
  );
  const binding = calls.find((c) => c.method === "Runtime.addBinding");
  assert.equal(binding.params.executionContextName, "navega-consumption-alert");
  await effector.apply(2, alert, analysis);
  const removed = calls.findIndex(
    (c) => c.method === "Runtime.removeBinding" && c.source.tabId === 1,
  );
  const installed = calls.findIndex(
    (c) => c.method === "Runtime.addBinding" && c.source.tabId === 2,
  );
  assert.ok(removed >= 0 && removed < installed);
  await effector.apply(null, alert, analysis);
  assert.ok(
    calls.some(
      (c) => c.method === "Runtime.removeBinding" && c.source.tabId === 2,
    ),
  );
});
test("falha no aviso é isolada e uma nova aplicação pode recuperar sem anunciar sucesso falso", async () => {
  const { effector, fail } = fixture();
  await effector.apply(1, alert, analysis);
  assert.equal(effector.error, null);
  fail();
  effector.invalidate(1);
  await effector.apply(1, alert, analysis);
  assert.match(effector.error, /não pôde/);
  await effector.apply(null, null, analysis);
  assert.equal(effector.error, null);
});
