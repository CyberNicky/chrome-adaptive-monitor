import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";

const profile = await mkdtemp(resolve(tmpdir(), "navega-browser-"));
const extension = resolve("extension");
const server = createDemoServer().listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let context;
const errors = [];
let lastState;
async function until(callback, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await callback();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Tempo esgotado: ${description}`);
}

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(base);
  const tabId = await worker.evaluate(
    async (baseUrl) =>
      (await chrome.tabs.query({})).find((t) => t.url?.startsWith(baseUrl)).id,
    base,
  );
  await worker.evaluate(() => {
    globalThis.testEvents = [];
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (method.startsWith("Network.") || method.startsWith("Target."))
        globalThis.testEvents.push({
          source,
          method,
          requestId: params.requestId,
          type: params.type,
          sessionId: params.sessionId,
          url: params.request?.url,
          target: params.targetInfo,
        });
    });
  });
  const panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.setViewportSize({ width: 1280, height: 1100 });
  await panel.goto(
    `chrome-extension://${extensionId}/ui/panel.html?tabId=${tabId}`,
  );
  await panel
    .getByRole("button", { name: "Iniciar captura", exact: true })
    .click();
  const getState = async () =>
    (lastState = await panel.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "GET_STATE" })).data,
    ));
  await until(
    async () => (await getState()).session?.recording,
    "iniciar sensor real",
  );
  await panel
    .getByRole("button", { name: "Recarregar página", exact: false })
    .click();
  await until(
    async () =>
      (await getState()).session.requests.some(
        (r) => r.url.endsWith("/api/data") && r.state === "complete",
      ),
    "coleta de carregamento",
  );
  await page.getByRole("button", { name: "Carregar 3 imagens" }).click();
  await page.getByRole("button", { name: "Buscar dados", exact: true }).click();
  await page.getByRole("button", { name: "Simular erro" }).click();
  await page.getByRole("button", { name: "Repetir recurso em cache" }).click();
  await page
    .getByRole("button", { name: "Carregar mídia", exact: true })
    .click();
  await page.getByRole("button", { name: "Carregar iframe e worker" }).click();
  await until(async () => {
    const s = await getState();
    return (
      s.session.requests.some(
        (r) => r.type === "video" && r.state === "complete",
      ) &&
      s.session.requests.some(
        (r) => r.type === "audio" && r.state === "complete",
      ) &&
      s.session.requests.filter(
        (r) => r.url.endsWith("/api/data") && r.state === "complete",
      ).length >= 4 &&
      s.metrics.pending === 0
    );
  }, "mídia, worker, iframe e requisições concluídas");
  const captured = await getState();
  await until(
    async () =>
      (await panel.locator("#pending").innerText()) === "Nenhuma em andamento",
    "painel atualizado após conclusão",
  );
  assert.ok(
    captured.metrics.transferredBytes > 264000,
    "bytes reais dos recursos",
  );
  assert.ok(captured.metrics.failures >= 1, "HTTP 404 contabilizado");
  assert.ok(
    captured.metrics.byType.image.requests >= 4,
    "imagens classificadas",
  );
  assert.ok(
    captured.metrics.byType.script.requests >= 1,
    "JavaScript classificado",
  );
  assert.ok(
    captured.session.requests.some((r) => r.state === "redirect"),
    "redirecionamento preservado",
  );
  assert.ok(
    captured.session.requests.some((r) => r.fromCache),
    "cache detectado",
  );
  assert.ok(
    captured.session.requests.some(
      (r) => r.domain === "localhost" && r.type === "image",
    ),
    "imagem de iframe em outro site",
  );
  assert.ok(
    captured.session.requests.every((r) => !r.url.includes("?")),
    "URLs sanitizadas",
  );
  const storage = await worker.evaluate(async () =>
    chrome.storage.session.get("monitorSession"),
  );
  assert.ok(storage.monitorSession.requests.length > 0, "sessão salva");
  await panel
    .getByLabel("Tipo de recurso", { exact: true })
    .selectOption("image");
  assert.ok(
    (await panel.locator("#rows tr").count()) >= 4,
    "filtro de imagens",
  );
  await panel.getByLabel("Buscar por URL ou domínio").fill("não-existe");
  assert.equal(
    await panel.locator("#rows tr").count(),
    0,
    "busca sem resultados",
  );
  await panel.getByLabel("Buscar por URL ou domínio").fill("");
  await panel
    .getByLabel("Tipo de recurso", { exact: true })
    .selectOption("all");
  const downloadPromise = panel.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Exportar JSON", exact: false })
    .click();
  const download = await downloadPromise;
  await mkdir("artifacts", { recursive: true });
  await download.saveAs("artifacts/session.json");
  await panel.screenshot({
    path: "artifacts/painel-desktop.png",
    fullPage: true,
  });
  await panel.setViewportSize({ width: 420, height: 1000 });
  assert.equal(
    await panel.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "sem overflow horizontal no painel estreito",
  );
  await panel.screenshot({ path: "artifacts/painel-lateral.png" });
  const beforeNavigation = (await getState()).session.requests.length;
  await page.reload();
  await until(async () => {
    const s = await getState();
    return (
      s.session.requests.length > beforeNavigation + 3 &&
      s.metrics.pending === 0
    );
  }, "navegação mantém a captura e o histórico");
  await panel
    .getByRole("button", { name: "Encerrar captura", exact: true })
    .click();
  await until(
    async () => !(await getState()).session.recording,
    "encerramento",
  );
  const stopped = await getState();
  await page.getByRole("button", { name: "Carregar 3 imagens" }).click();
  assert.equal(
    (await getState()).session.requests.length,
    stopped.session.requests.length,
    "não coleta após parar",
  );
  await panel.reload();
  await until(
    async () => (await panel.locator("#count").innerText()) !== "0",
    "reabrir painel preserva registros",
  );
  await panel
    .getByRole("button", { name: "Iniciar nova sessão", exact: true })
    .click();
  await until(
    async () => (await getState()).session.recording,
    "reiniciar captura",
  );
  await page.close();
  await until(
    async () => !(await getState()).session.recording,
    "fechamento da aba encerra captura",
  );
  await panel.getByRole("button", { name: "Limpar", exact: true }).click();
  assert.equal((await getState()).session, null, "limpeza da sessão");
  assert.deepEqual(errors, [], "sem erros JavaScript no painel");
  await writeFile(
    "artifacts/verification.json",
    JSON.stringify(
      {
        browser: context.browser().version(),
        checkedAt: new Date().toISOString(),
        requests: captured.metrics.requests,
        transferredBytes: captured.metrics.transferredBytes,
        types: Object.keys(captured.metrics.byType),
        failures: captured.metrics.failures,
        cached: captured.metrics.cached,
        result: "passed",
      },
      null,
      2,
    ),
  );
  console.log(
    `Teste real aprovado: ${captured.metrics.requests} requisições, ${captured.metrics.transferredBytes} bytes. Evidências em artifacts/.`,
  );
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/failure.json",
    JSON.stringify({ error: error.message, errors, state: lastState }, null, 2),
  );
  if (context?.serviceWorkers()[0])
    await writeFile(
      "artifacts/events.json",
      JSON.stringify(
        await context.serviceWorkers()[0].evaluate(() => globalThis.testEvents),
      ),
    );
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
