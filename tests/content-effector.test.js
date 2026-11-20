import test from "node:test";
import assert from "node:assert/strict";
import { createContentEffector } from "../extension/effectors/chrome-content-effector.js";

function fixture(muted = false) {
  const tab = { id: 7, mutedInfo: { muted, reason: "user" } };
  const calls = [];
  let fail = false;
  const controller = createContentEffector({
    runtimeId: "navega",
    tabs: {
      async get() {
        return structuredClone(tab);
      },
      async query() {
        return [structuredClone(tab)];
      },
      async update(id, change) {
        calls.push({ method: "mute", ...change });
        tab.mutedInfo = {
          muted: change.muted,
          reason: "extension",
          extensionId: "navega",
        };
      },
    },
    async sendCommand(source, method, params) {
      calls.push({ source, method, params });
      if (fail && method === "Page.removeScriptToEvaluateOnNewDocument")
        throw new Error("desconectado");
      if (method === "Page.getFrameTree")
        return { frameTree: { frame: { id: "frame" } } };
      if (method === "Page.createIsolatedWorld")
        return { executionContextId: 1 };
      if (method === "Page.addScriptToEvaluateOnNewDocument")
        return { identifier: "script" };
      return {};
    },
  });
  return {
    controller,
    tab,
    calls,
    fail: () => {
      fail = true;
    },
  };
}

test("efetor pausa conteúdo em mundo isolado e restaura apenas o som que ele alterou", async () => {
  const { controller, tab, calls } = fixture();
  await controller.registerTarget({ tabId: 7 });
  await controller.apply({ mode: "economy", tabId: 7 });
  assert.equal(tab.mutedInfo.muted, true);
  assert.ok(calls.some((c) => c.method === "Page.createIsolatedWorld"));
  assert.ok(
    calls.some(
      (c) =>
        c.method === "Runtime.evaluate" &&
        c.params.expression.includes("pause.call(element)"),
    ),
  );
  await controller.apply({ mode: "normal", tabId: null });
  assert.equal(tab.mutedInfo.muted, false);
  assert.ok(
    calls.some((c) => c.method === "Page.removeScriptToEvaluateOnNewDocument"),
  );
});

test("restaurar o modo não desfaz um silenciamento anterior do usuário", async () => {
  const { controller, tab } = fixture(true);
  await controller.registerTarget({ tabId: 7 });
  await controller.apply({ mode: "restricted", tabId: 7 });
  await controller.apply({ mode: "normal", tabId: null });
  assert.equal(tab.mutedInfo.muted, true);
  assert.equal(tab.mutedInfo.reason, "user");
});

test("falha ao remover o controle da página ainda restaura o silenciamento da extensão", async () => {
  const { controller, tab, fail } = fixture();
  await controller.registerTarget({ tabId: 7 });
  await controller.apply({ mode: "economy", tabId: 7 });
  fail();
  await assert.rejects(controller.apply({ mode: "normal", tabId: null }));
  assert.equal(tab.mutedInfo.muted, false);
});

test("ao reiniciar recupera silenciamento próprio sem alterar o do usuário", async () => {
  const { controller, tab } = fixture();
  tab.mutedInfo = { muted: true, reason: "extension", extensionId: "navega" };
  await controller.recover();
  assert.equal(tab.mutedInfo.muted, false);
  tab.mutedInfo = { muted: true, reason: "user" };
  await controller.recover();
  assert.equal(tab.mutedInfo.muted, true);
});


test("saldo zero interrompe o carregamento apenas no alvo principal e oculta também frames filhos", async () => {
  const { controller, calls } = fixture();
  await controller.registerTarget({ tabId: 7 });
  await controller.registerTarget({ tabId: 7, sessionId: "iframe" }, "iframe");
  const result = await controller.apply({ mode: "restricted", exhausted: true, tabId: 7 });
  assert.equal(result.contentHidden, true);
  const stopCalls = calls.filter((call) => call.method === "Page.stopLoading");
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0].source.sessionId, undefined);
  assert.ok(calls.some((call) => call.source?.sessionId === "iframe" &&
    call.method === "Runtime.evaluate" && call.params.expression.endsWith('("exhausted")')));
  await controller.apply({ mode: "restricted", exhausted: true, tabId: 7 });
  assert.equal(calls.filter((call) => call.method === "Page.stopLoading").length, 1);
  assert.equal((await controller.apply({ mode: "normal", tabId: null })).contentHidden, false);
});
