import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";

const profile = await mkdtemp(resolve(tmpdir(), "navega-history-"));
const extension = resolve("extension");
const server = createDemoServer().listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let context, worker, panel, page, tabId, lastState;
const errors = [];
const until = async (fn, label) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Tempo esgotado: ${label}`);
};
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  page = await context.newPage();
  await page.goto(base);
  tabId = await worker.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((t) => t.url === `${url}/`).id,
    base,
  );
  panel = await context.newPage();
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(
    `chrome-extension://${new URL(worker.url()).hostname}/ui/panel.html?tabId=${tabId}`,
  );
}
async function state() {
  lastState = await panel.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  });
  return lastState;
}
async function activate() {
  await worker.evaluate(
    (id) => chrome.tabs.update(id, { active: true }),
    tabId,
  );
  await until(
    async () => (await state()).session?.tabId === tabId,
    "aba ativa",
  );
}
async function payload(size) {
  await activate();
  const before = (await state()).metrics.transferredBytes;
  await page.evaluate(
    async (bytes) => (await fetch(`/api/payload?size=${bytes}`)).text(),
    size,
  );
  await until(async () => {
    const s = await state();
    return (
      s.metrics.pending === 0 && s.metrics.transferredBytes >= before + size
    );
  }, "recursos contabilizados");
}
try {
  await launch();
  await panel.getByRole("button", { name: /Configurar orçamento/ }).click();
  await panel.getByLabel("Plano", { exact: true }).fill("Plano original");
  await panel.getByLabel("Quantidade de dados").fill("25");
  await panel.getByLabel("Unidade", { exact: true }).selectOption("GB");
  await panel
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await until(
    async () => (await state()).budgetSettings?.planName === "Plano original",
    "salvar plano",
  );
  await panel
    .getByRole("button", { name: "Iniciar captura", exact: true })
    .click();
  await page.reload();
  await payload(80000);
  await panel
    .getByRole("button", { name: "Encerrar captura", exact: true })
    .click();
  const first = await state();
  const firstId = first.session.id;
  assert.equal(first.history.length, 1);
  assert.equal(
    first.history[0].transferredBytes,
    first.metrics.transferredBytes,
  );
  await panel
    .getByRole("button", { name: "Iniciar nova sessão", exact: true })
    .click();
  await payload(300000);
  const second = await state();
  const secondId = second.session.id;
  assert.notEqual(firstId, secondId);
  const protectedReply = await panel.evaluate(
    (id) => chrome.runtime.sendMessage({ type: "DELETE_HISTORY_SESSION", id }),
    secondId,
  );
  assert.equal(
    protectedReply.ok,
    false,
    "exclusão da captura ativa é rejeitada",
  );
  assert.equal(
    second.history.length,
    1,
    "captura atual não entra na lista de anteriores",
  );
  await panel
    .getByRole("button", { name: "Histórico de sessões", exact: true })
    .click();
  const firstRow = panel.locator(
    `#history-list li[data-session-id="${firstId}"]`,
  );
  await firstRow.getByRole("button", { name: /Ver sessão/ }).click();
  await panel.locator("#selected-history").waitFor({ state: "visible" });
  assert.equal(
    Number((await panel.locator("#count").innerText()).replaceAll(".", "")),
    first.metrics.requests,
  );
  const historicalBytes = await panel.locator("#bytes").innerText();
  await payload(50000);
  assert.equal(
    await panel.locator("#bytes").innerText(),
    historicalBytes,
    "consulta antiga não recebe bytes da captura atual",
  );
  assert.equal((await state()).session.id, secondId);
  assert.equal((await state()).session.recording, true);
  assert.ok(
    (await state()).metrics.transferredBytes > second.metrics.transferredBytes,
    "captura segue durante consulta",
  );
  await panel
    .getByLabel("Tipo de recurso", { exact: true })
    .selectOption("fetch");
  assert.equal(
    await panel.locator("#rows tr").count(),
    first.metrics.byType.fetch.requests,
    "filtro usa requisições da sessão antiga",
  );
  await panel
    .getByLabel("Tipo de recurso", { exact: true })
    .selectOption("all");
  const settings = (await state()).budgetSettings;
  await panel.evaluate(
    async (value) =>
      chrome.runtime.sendMessage({
        type: "SAVE_BUDGET",
        settings: { ...value, planName: "Plano atual alterado" },
      }),
    settings,
  );
  const downloadPromise = panel.waitForEvent("download");
  await panel.getByRole("button", { name: /Exportar JSON/ }).click();
  await mkdir("artifacts", { recursive: true });
  await (await downloadPromise).saveAs("artifacts/history-session.json");
  const exported = JSON.parse(
    await readFile("artifacts/history-session.json", "utf8"),
  );
  assert.equal(exported.historical, true);
  assert.equal(exported.session.id, firstId);
  assert.equal(
    exported.metrics.transferredBytes,
    first.metrics.transferredBytes,
  );
  assert.equal(
    exported.budgetSettings.planName,
    "Plano original",
    "exportação usa orçamento da época",
  );
  await panel.setViewportSize({ width: 1280, height: 1100 });
  await panel.screenshot({
    path: "artifacts/historico-detalhes.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Voltar à captura atual", exact: true })
    .click();
  assert.equal(await panel.locator("#selected-history").isVisible(), false);
  const beforeDelete = await state();
  await panel
    .getByRole("button", { name: "Histórico de sessões", exact: true })
    .click();
  await panel.screenshot({
    path: "artifacts/historico-lista.png",
    fullPage: true,
  });
  await panel.setViewportSize({ width: 420, height: 1000 });
  assert.equal(
    await panel.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await panel.screenshot({ path: "artifacts/historico-lateral.png" });
  await firstRow.getByRole("button", { name: /Excluir sessão/ }).click();
  await until(
    async () => (await state()).history.length === 0,
    "excluir sessão salva",
  );
  const afterDelete = await state();
  assert.equal(
    afterDelete.adaptation.consumedBytes,
    beforeDelete.adaptation.consumedBytes,
    "excluir histórico não reduz consumo da franquia",
  );
  assert.equal(afterDelete.session.id, secondId);
  await panel
    .getByRole("button", { name: "Fechar histórico", exact: true })
    .click();
  await until(
    async () =>
      worker.evaluate(async (id) => {
        const entries = (await chrome.storage.local.get("captureHistory"))
          .captureHistory.entries;
        return entries.some(
          (entry) =>
            entry.id === id && entry.metrics.transferredBytes >= 350000,
        );
      }, secondId),
    "checkpoint persistido da captura ativa",
  );
  const beforeRestart = await state();
  await context.close();
  await launch();
  const restored = await state();
  assert.equal(
    restored.session,
    null,
    "recuperação não reinicia captura sozinha",
  );
  assert.equal(
    restored.adaptation.consumedBytes,
    beforeRestart.adaptation.consumedBytes,
    "consulta histórica não reconta bytes",
  );
  assert.equal(restored.history.length, 1);
  assert.equal(restored.history[0].id, secondId);
  assert.equal(restored.history[0].recovered, true);
  assert.equal(
    restored.history[0].transferredBytes,
    beforeRestart.metrics.transferredBytes,
  );
  await panel
    .getByRole("button", { name: "Histórico de sessões", exact: true })
    .click();
  await panel
    .locator(`#history-list li[data-session-id="${secondId}"]`)
    .getByRole("button", { name: /Ver sessão/ })
    .click();
  await panel.locator("#selected-history").waitFor({ state: "visible" });
  assert.match(
    await panel.locator("#selected-history-info").innerText(),
    /Interrompida/,
  );
  assert.equal(
    Number((await panel.locator("#count").innerText()).replaceAll(".", "")),
    beforeRestart.metrics.requests,
  );
  await panel.reload();
  assert.equal(
    (await state()).history.length,
    1,
    "reabrir não duplica histórico",
  );
  assert.equal((await state()).historyError, null);
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/history-verification.json",
    JSON.stringify(
      {
        result: "passed",
        checkedAt: new Date().toISOString(),
        browser: context.browser().version(),
        firstSessionBytes: first.metrics.transferredBytes,
        recoveredSessionBytes: restored.history[0].transferredBytes,
        confirmed:
          "Consulta durante captura, filtros, exportação com contexto original, exclusão sem alterar franquia e recuperação após fechar Chrome com captura ativa.",
      },
      null,
      2,
    ),
  );
  console.log(
    "Histórico aprovado em Chrome real: consulta, exportação, exclusão e recuperação após reinício.",
  );
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/history-failure.json",
    JSON.stringify({ error: error.message, state: lastState, errors }, null, 2),
  );
  await panel
    ?.screenshot({ path: "artifacts/history-failure.png", fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
