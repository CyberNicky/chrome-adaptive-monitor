import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";

const profile = await mkdtemp(resolve(tmpdir(), "navega-restart-"));
const extension = resolve("extension");
const server = createDemoServer().listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let context;
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
  const panel = await context.newPage();
  const errors = [];
  panel.on("pageerror", (error) => errors.push(error.message));
  const panelUrl = `chrome-extension://${new URL(worker.url()).hostname}/ui/panel.html`;
  const state = () => panel.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: "GET_STATE" })).data);
  await panel.goto(`${panelUrl}?tabId=${tabId}`);
  await panel.locator("#start").click();
  await until(async () => (await state()).session?.recording, "iniciar captura");

  // Reopening without a tabId during capture used to leave targetTab null.
  await panel.goto(panelUrl);
  await panel.locator("#stop").click();
  await until(() => panel.locator("#start").isEnabled(), "reiniciar após reabrir painel");
  const first = (await state()).session.id;
  await panel.locator("#start").click();
  await until(async () => (await state()).session?.recording, "nova sessão");
  assert.notEqual((await state()).session.id, first);
  assert.ok((await state()).history.some((entry) => entry.id === first));

  const secondPage = await context.newPage();
  await secondPage.goto(`${base}/?second`);
  const secondId = await worker.evaluate(async (url) =>
    (await chrome.tabs.query({})).find((tab) => tab.url === url).id, `${base}/?second`);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), secondId);
  await until(async () => (await state()).session?.tabId === secondId, "seguir segunda aba");
  await panel.bringToFront();
  await panel.locator("#stop").click();
  await until(() => panel.locator("#start").isEnabled(), "reiniciar após trocar aba");
  await panel.locator("#start").click();
  await until(async () => (await state()).session?.recording, "captura reiniciada");
  assert.equal((await state()).session.tabId, secondId);
  await panel.locator("#stop").click();

  await page.close();
  await secondPage.close();
  await until(() => panel.locator("#start").isDisabled(), "não usar aba fechada");
  await panel.goto(`${panelUrl}?tabId=${tabId}`);
  assert.equal(await panel.locator("#start").isEnabled(), false);
  const replacement = await context.newPage();
  await replacement.goto(base);
  await until(() => panel.locator("#start").isEnabled(), "selecionar nova aba apesar do parâmetro antigo");
  await replacement.goto("about:blank");
  await until(() => panel.locator("#start").isDisabled(), "não capturar página interna");
  assert.deepEqual(errors, []);
  console.log("Reinício aprovado em Chrome real: painel reaberto, troca de aba, histórico preservado e abas fechadas/internas.");
} finally {
  await context?.close();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
