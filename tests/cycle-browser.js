import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";
import { localDate } from "../extension/knowledge/billing-cycle.js";

const profile = await mkdtemp(resolve(tmpdir(), "navega-cycles-"));
const extension = resolve("extension");
const server = createDemoServer().listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let context, worker, panel, page, lastState;
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
  const id = new URL(worker.url()).hostname;
  page = await context.newPage();
  await page.goto(base);
  const tabId = await worker.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((t) => t.url === `${url}/`).id,
    base,
  );
  panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.goto(`chrome-extension://${id}/ui/panel.html?tabId=${tabId}`);
}
async function state() {
  lastState = await panel.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  });
  return lastState;
}
try {
  await launch();
  await panel.getByRole("button", { name: /Configurar orçamento/ }).click();
  await panel
    .getByLabel("Plano", { exact: true })
    .fill("Franquia diária de teste");
  await panel.getByLabel("Quantidade de dados").fill("1");
  await panel.getByLabel("Unidade", { exact: true }).selectOption("MB");
  await panel.getByLabel("Data de início da franquia").fill(localDate());
  await panel.getByLabel("Renovação da franquia").selectOption("days");
  await panel.getByLabel("Duração do ciclo em dias").fill("1");
  await until(
    async () =>
      (await panel.locator("#cycle-preview").innerText()).includes(
        "1 dia no ciclo",
      ),
    "prévia da duração",
  );
  await panel
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await until(
    async () => (await state()).budgetSettings?.cycleDays === 1,
    "salvar período",
  );
  await panel
    .getByRole("button", { name: "Iniciar captura", exact: true })
    .click();
  await page.reload();
  await page.evaluate(async () =>
    (await fetch("/api/payload?size=930000")).arrayBuffer(),
  );
  await until(async () => {
    const value = await state();
    return (
      value.adaptation.mode === "restricted" &&
      !value.adaptation.error &&
      value.metrics.pending === 0
    );
  }, "consumo do ciclo ativa Restritivo");
  const captured = await state();
  assert.ok(captured.adaptation.consumedBytes >= 930000);
  await panel
    .getByRole("button", { name: "Encerrar captura", exact: true })
    .click();
  const stopped = await state();
  assert.equal(
    stopped.adaptation.consumedBytes,
    captured.adaptation.consumedBytes,
  );
  await panel.getByRole("button", { name: "Limpar", exact: true }).click();
  const cleared = await state();
  assert.equal(cleared.session, null);
  assert.equal(
    cleared.adaptation.consumedBytes,
    captured.adaptation.consumedBytes,
    "limpar captura não limpa franquia",
  );
  await context.close();
  await launch();
  const restored = await state();
  assert.equal(
    restored.adaptation.consumedBytes,
    captured.adaptation.consumedBytes,
    "reinício do navegador preserva ciclo",
  );
  assert.equal(restored.budgetSettings.cycleDays, 1);
  await panel
    .getByRole("button", { name: /Iniciar (captura|nova sessão)/ })
    .click();
  await until(
    async () => (await state()).adaptation.mode === "restricted",
    "nova captura usa consumo anterior",
  );
  const beforeRenewal = await state();
  const nextCycleTime = beforeRenewal.adaptation.cycle.endsAt + 1000;
  // Test-only clock injection: no production simulation command or reset button.
  // The real Chrome alarm fires while the worker clock is after the boundary.
  await worker.evaluate(async (now) => {
    const actualNow = Date.now.bind(Date);
    Date.now = () => now;
    await chrome.alarms.create("budget-cycle-renewal", {
      when: actualNow() + 200,
    });
  }, nextCycleTime);
  await until(
    async () =>
      worker.evaluate(async (oldKey) => {
        const value = (await chrome.storage.local.get("dataBudgetUsage"))
          .dataBudgetUsage;
        return value.cycle.key !== oldKey && value.consumedBytes === 0;
      }, beforeRenewal.adaptation.cycle.key),
    "alarme renova ciclo sem consulta do painel",
  );
  const renewed = await state();
  assert.equal(renewed.adaptation.mode, "normal");
  assert.equal(renewed.adaptation.consumedBytes, 0);
  assert.notEqual(
    renewed.adaptation.cycle.key,
    beforeRenewal.adaptation.cycle.key,
  );
  assert.equal(
    renewed.session.requests.length,
    beforeRenewal.session.requests.length,
    "renovação preserva tabela da captura",
  );
  assert.deepEqual(
    await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()),
    [],
    "renovação remove bloqueios",
  );
  assert.equal(renewed.usageError, null);
  await panel.setViewportSize({ width: 420, height: 1000 });
  await panel.getByRole("button", { name: /Configurar orçamento/ }).click();
  assert.equal(
    await panel.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mkdir("artifacts", { recursive: true });
  await panel.screenshot({
    path: "artifacts/ciclo-configuracao.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Cancelar", exact: true }).click();
  await panel.screenshot({
    path: "artifacts/ciclo-renovado.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/cycle-verification.json",
    JSON.stringify(
      {
        result: "passed",
        checkedAt: new Date().toISOString(),
        browser: context.browser().version(),
        persistedBytes: captured.adaptation.consumedBytes,
        renewedBytes: renewed.adaptation.consumedBytes,
        confirmed:
          "Configuração por dias, persistência após reinício, limpeza sem zerar franquia, nova captura e renovação por alarme com retirada de bloqueios.",
      },
      null,
      2,
    ),
  );
  console.log(
    "Ciclo aprovado em Chrome real: persistência entre reinícios e renovação por alarme.",
  );
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/cycle-failure.json",
    JSON.stringify({ error: error.message, state: lastState, errors }, null, 2),
  );
  await panel
    ?.screenshot({ path: "artifacts/cycle-failure.png", fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
