import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";

const profile = await mkdtemp(resolve(tmpdir(), "navega-alerts-"));
const extension = resolve("extension");
const server = createDemoServer().listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let context, worker, panel, page, probe, panelUrl, lastState;
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
  // Observe the adapter call but still invoke the real Chrome notification API.
  await worker.evaluate(() => {
    globalThis.notificationAttempts = [];
    const create = chrome.notifications.create.bind(chrome.notifications);
    chrome.notifications.create = async (id, options) => {
      globalThis.notificationAttempts.push({ id, options });
      return create(id, options);
    };
  });
  page = await context.newPage();
  await page.goto(base);
  const tabId = await worker.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((t) => t.url === `${url}/`).id,
    base,
  );
  panelUrl = `chrome-extension://${new URL(worker.url()).hostname}/ui/panel.html?tabId=${tabId}`;
  probe = await context.newPage();
  await probe.goto(
    `chrome-extension://${new URL(worker.url()).hostname}/icons/icon128.png`,
  );
  await openPanel();
}
async function openPanel() {
  panel = await context.newPage();
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(panelUrl);
}
async function state() {
  lastState = await probe.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  });
  return lastState;
}
async function activateDemo() {
  const tabId = await worker.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((t) => t.url === `${url}/`).id,
    base,
  );
  await worker.evaluate(
    (id) => chrome.tabs.update(id, { active: true }),
    tabId,
  );
  await until(
    async () => (await state()).session.tabId === tabId,
    "aba da demo monitorada",
  );
}
async function consumeTo(target) {
  await activateDemo();
  const value = await state();
  await page.evaluate(
    async (size) => (await fetch(`/api/payload?size=${size}`)).text(),
    Math.max(1, target - value.adaptation.consumedBytes),
  );
  await until(async () => {
    const s = await state();
    return s.metrics.pending === 0 && s.adaptation.consumedBytes >= target;
  }, "bytes contabilizados");
}
const attempts = () =>
  worker.evaluate(() => globalThis.notificationAttempts.length);
try {
  await launch();
  await panel.getByRole("button", { name: /Configurar orçamento/ }).click();
  await panel.getByLabel("Plano", { exact: true }).fill("Teste de alertas");
  await panel.getByLabel("Quantidade de dados").fill("1");
  await panel.getByLabel("Unidade", { exact: true }).selectOption("MB");
  await panel
    .getByLabel("Ativar economia automática durante a captura")
    .uncheck();
  await panel
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await until(
    async () => (await state()).budgetSettings?.dataAmount === 1,
    "salvar plano",
  );
  await panel
    .getByRole("button", { name: "Iniciar captura", exact: true })
    .click();
  await page.reload();
  await until(
    async () => (await state()).metrics.pending === 0,
    "carregamento inicial",
  );
  const initialNotice = page.locator("navega-consumption-alert");
  await initialNotice
    .getByRole("heading", { name: "Modo Normal · monitoramento ativo" })
    .waitFor();
  assert.equal(await initialNotice.getAttribute("data-mode"), "normal");
  assert.equal(
    await initialNotice
      .locator("aside")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(237, 248, 242)",
    "Normal é verde antes de qualquer alerta",
  );
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/monitor-normal.png" });
  assert.equal(await attempts(), 0, "monitor verde não emite alerta nativo");
  await initialNotice
    .getByRole("button", { name: "Recolher aviso de consumo" })
    .click();
  await initialNotice
    .getByRole("button", { name: /Abrir aviso de consumo/ })
    .waitFor();
  await until(
    async () => (await state()).consumptionAlert.normalVisible === false,
    "recolhimento do monitor normal salvo",
  );
  await page.reload();
  await initialNotice
    .getByRole("button", { name: /Abrir aviso de consumo/ })
    .waitFor();
  await panel.close();
  await consumeTo(720000);
  assert.equal((await state()).consumptionAlert.current.level, 70);
  assert.equal(await attempts(), 1, "alerta enviado com painel fechado");
  const pageNotice = page.locator("navega-consumption-alert");
  await pageNotice
    .getByRole("heading", { name: "Atenção ao consumo da franquia" })
    .waitFor();
  assert.equal(
    await pageNotice.count(),
    1,
    "aviso único sobre a própria página",
  );
  assert.equal(
    (await state()).adaptation.mode,
    "normal",
    "aviso independente do bloqueio",
  );
  await new Promise((resolve) => setTimeout(resolve, 6500));
  assert.equal(
    await pageNotice.isVisible(),
    true,
    "aviso se mantém sem painel e sem bloqueios",
  );
  await mkdir("artifacts", { recursive: true });
  const desktopBounds = await pageNotice.boundingBox();
  assert.ok(
    desktopBounds.width >= 430 &&
      desktopBounds.y + desktopBounds.height >= 690 &&
      desktopBounds.y + desktopBounds.height <= 704,
    "aviso maior no canto inferior da página",
  );
  await page.screenshot({ path: "artifacts/alerta-na-pagina.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const noticeBounds = await pageNotice.boundingBox();
  assert.ok(
    noticeBounds.x >= 0 && noticeBounds.x + noticeBounds.width <= 390,
    "aviso cabe em tela estreita",
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  const other = await context.newPage();
  await other.goto(`${base}/?overlay-test=1`);
  const otherId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    `${base}/?overlay-test=1`,
  );
  await worker.evaluate(
    (id) => chrome.tabs.update(id, { active: true }),
    otherId,
  );
  await until(
    async () => (await state()).session.tabId === otherId,
    "aviso acompanha nova aba",
  );
  await other.locator("navega-consumption-alert").waitFor({ state: "visible" });
  await pageNotice.waitFor({ state: "detached" });
  await activateDemo();
  await pageNotice.waitFor({ state: "visible" });
  await other
    .locator("navega-consumption-alert")
    .waitFor({ state: "detached" });
  await other.close();

  await openPanel();
  await panel.locator("#consumption-alert").waitFor({ state: "visible" });
  assert.match(
    await panel.locator("#consumption-alert-message").innerText(),
    /Saldo estimado/,
  );
  await panel.reload();
  await panel.locator("#consumption-alert").waitFor({ state: "visible" });
  assert.equal(await attempts(), 1, "reabrir painel não repete notificação");
  await panel.getByRole("button", { name: "Entendi", exact: true }).click();
  await panel.locator("#consumption-alert").waitFor({ state: "hidden" });
  await activateDemo();
  await pageNotice
    .getByRole("button", { name: /Abrir aviso de consumo/ })
    .waitFor();
  const chipBounds = await pageNotice
    .getByRole("button", { name: /Abrir aviso de consumo/ })
    .boundingBox();
  assert.ok(
    chipBounds.y >= 0 && chipBounds.y + chipBounds.height <= 720,
    "indicador recolhido permanece dentro da tela",
  );
  await page.screenshot({ path: "artifacts/indicador-na-pagina.png" });
  await pageNotice
    .getByRole("button", { name: /Abrir aviso de consumo/ })
    .click();
  assert.equal(
    await pageNotice.getByRole("heading").isVisible(),
    true,
    "indicador permite reabrir o aviso",
  );
  await pageNotice
    .getByRole("button", { name: "Recolher aviso de consumo" })
    .click();
  await pageNotice
    .getByRole("button", { name: /Abrir aviso de consumo/ })
    .waitFor();
  await panel.reload();
  await until(
    async () => !(await state()).consumptionAlert.visible,
    "confirmação persiste",
  );
  await consumeTo(920000);
  await panel.locator("#consumption-alert").waitFor({ state: "visible" });
  assert.equal((await state()).consumptionAlert.current.level, 90);
  assert.equal(await attempts(), 2, "faixa maior gera novo aviso");
  await panel.setViewportSize({ width: 420, height: 1000 });
  assert.equal(
    await panel.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mkdir("artifacts", { recursive: true });
  await panel.locator("#consumption-alert").scrollIntoViewIfNeeded();
  await panel.screenshot({ path: "artifacts/alerta-consumo.png" });
  await panel
    .getByRole("button", { name: "Encerrar captura", exact: true })
    .click();
  await page.locator("navega-consumption-alert").waitFor({ state: "detached" });
  const beforeRestart = await state();
  await context.close();
  await launch();
  const restored = await state();
  assert.equal(
    restored.adaptation.consumedBytes,
    beforeRestart.adaptation.consumedBytes,
  );
  assert.equal(restored.consumptionAlert.current.level, 90);
  assert.equal(
    restored.consumptionAlert.visible,
    true,
    "aviso não confirmado permanece após reinício",
  );
  assert.equal(await attempts(), 0, "reinício não repete alerta emitido");
  await panel.getByRole("button", { name: "Entendi", exact: true }).click();
  await panel.locator("#consumption-alert").waitFor({ state: "hidden" });
  await panel
    .getByRole("button", { name: /Iniciar (captura|nova sessão)/ })
    .click();
  await consumeTo(1030000);
  assert.equal((await state()).consumptionAlert.current.level, 100);
  const restartedNotice = page.locator("navega-consumption-alert");
  await restartedNotice
    .getByRole("heading", { name: "Franquia estimada atingida" })
    .waitFor();
  await restartedNotice
    .getByRole("button", { name: "Recolher aviso de consumo" })
    .click();
  await until(
    async () => !(await state()).consumptionAlert.visible,
    "recolher na página confirma o alerta no controlador",
  );
  await page.reload();
  await restartedNotice
    .getByRole("button", { name: /Abrir aviso de consumo/ })
    .waitFor();
  assert.equal(
    await restartedNotice.getAttribute("data-expanded"),
    "false",
    "recarregar mantém indicador sem repetir cartão confirmado",
  );
  assert.equal(
    await attempts(),
    1,
    "100% gera alerta mesmo depois do reinício",
  );
  await panel.getByRole("button", { name: /Configurar orçamento/ }).click();
  await panel.getByLabel("Notificações de consumo no computador").uncheck();
  await panel
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await until(
    async () => (await state()).budgetSettings.notificationsEnabled === false,
    "desativar notificações",
  );
  assert.equal(
    (await state()).consumptionAlert.visible,
    false,
    "confirmação da página permanece com notificações desligadas",
  );
  await panel.reload();
  assert.equal((await state()).budgetSettings.notificationsEnabled, false);
  await activateDemo();
  const beforeRenewal = await state();
  await worker.evaluate(async (now) => {
    const actualNow = Date.now.bind(Date);
    Date.now = () => now;
    await chrome.alarms.create("budget-cycle-renewal", {
      when: actualNow() + 200,
    });
  }, beforeRenewal.adaptation.cycle.endsAt + 1000);
  await until(
    async () => !(await state()).consumptionAlert.current,
    "renovação limpa aviso",
  );
  assert.equal((await state()).adaptation.consumedBytes, 0);
  await page
    .locator("navega-consumption-alert")
    .getByRole("heading", { name: "Modo Normal · monitoramento ativo" })
    .waitFor();
  assert.equal(
    await page.locator("navega-consumption-alert").getAttribute("data-mode"),
    "normal",
    "renovar preserva monitor verde",
  );
  const alertState = await worker.evaluate(
    async () =>
      (await chrome.storage.local.get("consumptionAlertState"))
        .consumptionAlertState,
  );
  assert.equal(alertState.notifiedLevel, 0);
  assert.equal(alertState.dismissedLevel, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/alerts-verification.json",
    JSON.stringify(
      {
        result: "passed",
        checkedAt: new Date().toISOString(),
        browser: context.browser().version(),
        levels: [70, 90, 100],
        confirmed:
          "Aviso sobre a página sem painel e sem bloqueios, indicador recolhível, confirmação por binding isolado, reinício sem repetição, notificações e renovação.",
        nativeNotificationError: beforeRenewal.consumptionAlert.error,
      },
      null,
      2,
    ),
  );
  console.log(
    "Alertas aprovados em Chrome real: 70/90/100%, confirmação e reinício sem repetição.",
  );
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/alerts-failure.json",
    JSON.stringify({ error: error.message, state: lastState, errors }, null, 2),
  );
  await panel
    ?.screenshot({ path: "artifacts/alerts-failure.png", fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
