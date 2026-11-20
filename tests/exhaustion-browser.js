import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";

const profile = await mkdtemp(resolve(tmpdir(), "navega-exhausted-"));
const extension = resolve("extension");
const server = createDemoServer();
const received = [];
server.on("request", (req) => received.push(req.url));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let context, panel, page, lastState;
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
  page = await context.newPage();
  await page.goto(base);
  const tabId = await worker.evaluate(async (url) =>
    (await chrome.tabs.query({})).find((tab) => tab.url === `${url}/`).id, base);
  panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(error.message));
  const panelUrl = `chrome-extension://${new URL(worker.url()).hostname}/ui/panel.html?tabId=${tabId}`;
  await panel.goto(panelUrl);
  const state = async () => lastState = await panel.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: "GET_STATE" })).data);
  const waitState = (check, label) => until(async () => {
    const s = await state();
    return check(s.adaptation) && !s.adaptation.error && s.metrics.pending === 0;
  }, label);
  const configure = async (amount, enabled = true) => {
    await panel.getByRole("button", { name: /Configurar orçamento/ }).click();
    await panel.getByLabel("Plano", { exact: true }).fill("Teste sem saldo");
    await panel.getByLabel("Quantidade de dados").fill(String(amount));
    await panel.getByLabel("Unidade", { exact: true }).selectOption("MB");
    await panel.getByLabel("Ativar economia automática durante a captura").setChecked(enabled);
    await panel.getByRole("button", { name: "Salvar configuração", exact: true }).click();
    await until(async () => !(await panel.locator("#settings-dialog").evaluate((d) => d.open)), "configuração salva");
  };
  const consumeTo = async (bytes) => {
    const consumed = (await state()).adaptation.consumedBytes;
    await page.evaluate(async (size) =>
      (await fetch(`/api/payload?size=${size}`)).arrayBuffer(), Math.max(1, bytes - consumed));
  };
  const fetchProbe = (path) => page.evaluate(async (path) => {
    try { return (await fetch(path)).status; } catch { return "blocked"; }
  }, path);
  await configure(1);
  await panel.locator("#start").click();
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await page.reload();
  await consumeTo(940000);
  await waitState((a) => a.mode === "restricted" && !a.exhausted, "restritivo com saldo");
  assert.equal(await page.locator("body").isVisible(), true);
  assert.equal(await fetchProbe("/api/data?probe=before-exhaustion"), 200);
  // The local screen must remain styled on sites forbidding inline styles.
  await page.evaluate(() => {
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "style-src 'none'";
    document.head.append(policy);
  });
  await consumeTo(1050000);
  await waitState((a) => a.exhausted && a.contentHidden, "saldo zero bloqueia tudo");
  const exhausted = await state();
  await page.getByRole("heading", { name: "Franquia estimada esgotada", exact: true }).waitFor();
  assert.equal(await page.locator("body").isVisible(), false);
  assert.equal(await page.locator("navega-budget-exhausted dialog").evaluate((d) =>
    getComputedStyle(d).backgroundColor), "rgb(255, 247, 243)");
  assert.equal(await panel.locator("#mode-indicator strong").innerText(), "Franquia esgotada");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("navega-budget-exhausted dialog").isVisible(), true);
  for (const path of ["/api/data", "/style.css", "/app.js", "/image.svg", "/video.webm", "/test.woff2"]) {
    assert.equal(await fetchProbe(`${path}?probe=zero-balance`), "blocked");
  }
  for (const kind of ["script", "stylesheet", "iframe", "font"]) {
    const result = await page.evaluate(async (kind) => {
      const path = `/blocked-${kind}?probe=zero-balance-native`;
      if (kind === "font") {
        try { await new FontFace("probe", `url(${path})`).load(); return "loaded"; }
        catch { return "blocked"; }
      }
      return new Promise((resolve) => {
        const element = document.createElement(kind === "stylesheet" ? "link" : kind);
        const timer = setTimeout(() => resolve("timeout"), 3000);
        const finish = (value) => { clearTimeout(timer); resolve(value); };
        element.onload = () => finish("loaded");
        element.onerror = () => finish("blocked");
        if (kind === "stylesheet") { element.rel = "stylesheet"; element.href = path; }
        else element.src = path;
        document.body.append(element);
      });
    }, kind);
    // Chromium may emit load for an iframe containing its local error page.
    assert.ok(result === "blocked" || (kind === "iframe" && result === "loaded"), kind);
  }
  assert.equal(received.some((url) => url.includes("zero-balance")), false);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/franquia-esgotada.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator("navega-budget-exhausted dialog").evaluate((d) => d.scrollWidth > d.clientWidth), false);
  await page.screenshot({ path: "artifacts/franquia-esgotada-mobile.png" });
  await panel.reload();
  await waitState((a) => a.exhausted, "reabrir não libera quota");
  await panel.locator("#stop").click();
  await panel.locator("#start").click();
  await waitState((a) => a.exhausted, "nova sessão conserva bloqueio");
  assert.equal((await state()).adaptation.consumedBytes, exhausted.adaptation.consumedBytes);

  // Actual main-frame navigation must be blocked before reaching the server.
  await page.goto(`${base}/?probe=exhausted-navigation`).catch(() => {});
  assert.equal(received.some((url) => url.includes("exhausted-navigation")), false);
  await until(async () => (await state()).adaptation.exhausted, "navegação continua protegida");
  await page.getByRole("heading", { name: "Franquia estimada esgotada", exact: true }).waitFor();
  await configure(10);
  await waitState((a) => a.mode === "normal" && !a.exhausted, "aumentar franquia libera rede");
  await page.goto(base);
  assert.equal(await page.locator("body").isVisible(), true);
  assert.equal(await page.locator("navega-budget-exhausted").count(), 0);
  assert.equal(await fetchProbe("/api/data?probe=restored-balance"), 200);
  await configure(1);
  await waitState((a) => a.exhausted, "reaplica saldo zero");
  await configure(1, false);
  await waitState((a) => a.mode === "normal" && !a.exhausted, "desativar restaura página");
  assert.equal(await page.locator("body").isVisible(), true);
  assert.equal(await page.locator("navega-budget-exhausted").count(), 0);
  await configure(1);
  await waitState((a) => a.exhausted, "saldo zero antes da renovação");
  const beforeRenewal = await state();
  await worker.evaluate(async (now) => {
    const realNow = Date.now.bind(Date);
    Date.now = () => now;
    await chrome.alarms.create("budget-cycle-renewal", { when: realNow() + 100 });
  }, beforeRenewal.adaptation.cycle.endsAt + 1000);
  await waitState((a) => a.mode === "normal" && a.consumedBytes === 0, "renovação libera saldo zero");
  assert.equal(await page.locator("body").isVisible(), true);
  assert.equal(await page.locator("navega-budget-exhausted").count(), 0);
  assert.deepEqual(errors, []);
  await writeFile("artifacts/exhaustion-verification.json", JSON.stringify({
    result: "passed", checkedAt: new Date().toISOString(),
    browser: context.browser().version(), consumedBytes: exhausted.adaptation.consumedBytes,
    checked: "Texto/API/CSS/JS/fontes/mídia bloqueados no servidor, conteúdo oculto, navegação principal, Escape, painel, sessões e restauração.",
  }, null, 2));
  console.log("Saldo zero aprovado em Chrome real: conteúdo oculto, novas requisições e navegação bloqueadas, controles acessíveis e restauração.");
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/exhaustion-failure.json", JSON.stringify({ error: error.message, state: lastState, errors }, null, 2));
  await page?.screenshot({ path: "artifacts/exhaustion-failure.png" }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
