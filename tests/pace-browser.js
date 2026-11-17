import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";
import { localDate } from "../extension/knowledge/billing-cycle.js";

const profile = await mkdtemp(resolve(tmpdir(), "navega-pace-"));
const extension = resolve("extension");
const server = createDemoServer();
const received = [];
server.on("request", (req) => received.push(req.url));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let context, panel, lastState;
const errors = [];
const until = async (fn, label) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Tempo esgotado: ${label}`);
};
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  await page.goto(base);
  const tabId = await worker.evaluate(async (url) =>
    (await chrome.tabs.query({})).find((tab) => tab.url === `${url}/`).id, base);
  panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/ui/panel.html?tabId=${tabId}`);
  const state = async () => lastState = await panel.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: "GET_STATE" })).data);
  const waitMode = (mode) => until(async () => {
    const s = await state();
    return s.adaptation.mode === mode && !s.adaptation.error && s.metrics.pending === 0;
  }, mode);
  const date = new Date();
  date.setDate(date.getDate() - 10);
  await panel.getByRole("button", { name: /Configurar orçamento/ }).click();
  await panel.getByLabel("Plano", { exact: true }).fill("Teste de ritmo");
  await panel.getByLabel("Quantidade de dados").fill("10");
  await panel.getByLabel("Unidade", { exact: true }).selectOption("MB");
  await panel.getByLabel("Data de início da franquia").fill(localDate(date));
  await panel.getByLabel("Renovação da franquia").selectOption("days");
  await panel.getByLabel("Duração do ciclo em dias").fill("30");
  await panel.getByRole("button", { name: "Salvar configuração", exact: true }).click();
  await panel.locator("#start").click();
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await page.reload();
  await waitMode("normal");
  const consume = async (bytes) => {
    await page.evaluate(async (bytes) => {
      while (bytes > 0) {
        const size = Math.min(bytes, 1000000);
        await (await fetch(`/api/payload?size=${size}&probe=${crypto.randomUUID()}`)).arrayBuffer();
        bytes -= size;
      }
    }, bytes);
  };
  const probe = (kind, tag) => page.evaluate(async ({ kind, tag }) => {
    try {
      const path = kind === "image" ? "/image.svg" : "/video.webm";
      await (await fetch(`${path}?probe=${tag}`)).arrayBuffer();
      return "loaded";
    } catch { return "blocked"; }
  }, { kind, tag });
  await consume(4200000);
  await waitMode("economy");
  const economy = await state();
  assert.ok(economy.adaptation.usedPercent < 70);
  assert.equal(economy.adaptation.decisionSource, "pace");
  assert.match(await panel.locator("#adaptation-summary").innerText(), /Ritmo de consumo elevado/);
  assert.match(await panel.locator("#consumption-pace").innerText(), /saldo permite/);
  assert.equal(await probe("video", "pace-economy-video"), "blocked");
  assert.equal(received.some((url) => url.includes("pace-economy-video")), false);
  assert.equal(await probe("image", "pace-economy-image"), "loaded");
  await until(async () => (await page.locator("navega-consumption-alert").getAttribute("data-mode")) === "economy", "aviso econômico");
  assert.match(await page.locator("navega-consumption-alert p").innerText(), /Ritmo de consumo elevado/);

  await mkdir("artifacts", { recursive: true });
  await panel.screenshot({ path: "artifacts/ritmo-painel.png", fullPage: true });
  await panel.setViewportSize({ width: 420, height: 1000 });
  assert.equal(await panel.evaluate(() =>
    document.documentElement.scrollWidth > innerWidth), false);
  await panel.screenshot({ path: "artifacts/ritmo-lateral.png", fullPage: true });
  await page.screenshot({ path: "artifacts/ritmo-na-pagina.png" });

  await consume(1800000);
  await waitMode("restricted");
  const restricted = await state();
  assert.ok(restricted.adaptation.usedPercent < 70);
  assert.equal(restricted.adaptation.decisionSource, "pace");
  assert.equal(await probe("image", "pace-restricted-image"), "blocked");
  assert.equal(received.some((url) => url.includes("pace-restricted-image")), false);
  await panel.reload();
  await waitMode("restricted");
  await panel.locator("#stop").click();
  await panel.locator("#start").click();
  await waitMode("restricted");
  assert.equal((await state()).adaptation.consumedBytes, restricted.adaptation.consumedBytes);

  // Only this isolated test's worker clock changes. No production override.
  const later = new Date();
  later.setDate(later.getDate() + 10);
  await worker.evaluate(async (now) => {
    const realNow = Date.now.bind(Date);
    Date.now = () => now;
    await chrome.alarms.create("budget-cycle-renewal", { when: realNow() + 100 });
  }, later.getTime());
  await waitMode("normal");
  const sustainable = await state();
  assert.equal(sustainable.adaptation.consumedBytes, restricted.adaptation.consumedBytes);
  assert.equal(await probe("video", "pace-restored-video"), "loaded");
  assert.equal(await probe("image", "pace-restored-image"), "loaded");
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/pace-verification.json", JSON.stringify({
    result: "passed", checkedAt: new Date().toISOString(),
    browser: context.browser().version(),
    economy: economy.adaptation, restricted: restricted.adaptation,
    sustainable: sustainable.adaptation,
  }, null, 2));
  console.log("Ritmo aprovado em Chrome real: antecipação dos modos, bloqueios confirmados no servidor, persistência entre sessões e retorno a Normal com mais dias decorridos.");
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/pace-failure.json", JSON.stringify({ error: error.message, state: lastState, errors }, null, 2));
  throw error;
} finally {
  await context?.close();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
