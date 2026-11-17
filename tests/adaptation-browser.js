import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { createDemoServer } from "../demo/server.js";

const profile = await mkdtemp(resolve(tmpdir(), "navega-modes-"));
const server = createDemoServer();
const received = [];
server.on("request", (req) => received.push(req.url));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const extension = resolve("extension");
let context, panel, worker, lastState;
const errors = [];
const until = async (fn, label) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Tempo esgotado: ${label}`);
};
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(base);
  const tabId = await worker.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url)).id,
    base,
  );
  panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.setViewportSize({ width: 1280, height: 1050 });
  await panel.goto(`chrome-extension://${id}/ui/panel.html?tabId=${tabId}`);
  const state = async () =>
    (lastState = await panel.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "GET_STATE" })).data,
    ));
  const configure = async (amount = 1, enabled = true) => {
    await panel.getByRole("button", { name: /Configurar orçamento/ }).click();
    await panel
      .getByRole("textbox", { name: "Plano", exact: true })
      .fill("Teste dos três modos");
    await panel.getByLabel("Quantidade de dados").fill(String(amount));
    await panel.getByLabel("Unidade", { exact: true }).selectOption("MB");
    assert.equal(
      await panel.locator("#economy-percent, #restricted-percent").count(),
      0,
      "usuário não configura as metas",
    );
    await panel
      .getByLabel("Ativar economia automática durante a captura")
      .setChecked(enabled);
    await panel
      .getByRole("button", { name: "Salvar configuração", exact: true })
      .click();
    await until(
      async () =>
        !(await panel.locator("#settings-dialog").evaluate((d) => d.open)),
      "salvar orçamento",
    );
  };
  const waitMode = async (mode) =>
    until(async () => {
      const s = await state();
      return (
        s.adaptation.mode === mode &&
        !s.adaptation.error &&
        s.metrics.pending === 0
      );
    }, mode);
  const asset = async (target, kind, tag) =>
    target.evaluate(
      async ({ kind, tag }) => {
        const paths = {
          image: "/image.svg?size=24000",
          audio: "/audio.wav?",
          video: "/video.webm?",
        };
        const element =
          kind === "image" ? new Image() : document.createElement(kind);
        return await new Promise((resolve) => {
          const timer = setTimeout(() => resolve("timeout"), 5000);
          const finish = (value) => {
            clearTimeout(timer);
            resolve(value);
          };
          element.onload = () => finish("loaded");
          element.onloadeddata = () => finish("loaded");
          element.onerror = () => finish("blocked");
          if (kind !== "image") element.preload = "auto";
          element.dataset.probe = tag;
          document.body.append(element);
          element.src = paths[kind] + `&probe=${tag}`;
          if (kind !== "image") element.load();
        });
      },
      { kind, tag },
    );
  await configure();
  await panel
    .getByRole("button", { name: "Iniciar captura", exact: true })
    .click();
  await page.reload();
  await waitMode("normal");
  assert.equal(
    await page.locator("navega-consumption-alert").getAttribute("data-mode"),
    "normal",
  );
  assert.equal(
    await page
      .locator("navega-consumption-alert aside")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(237, 248, 242)",
    "cor acompanha modo normal",
  );
  for (const kind of ["image", "audio", "video"])
    assert.equal(
      await asset(page, kind, `normal-${kind}`),
      "loaded",
      `Normal permite ${kind}`,
    );
  await waitMode("normal");
  const music = page.locator('audio[data-probe="normal-audio"]');
  await music.evaluate(async (element) => {
    element.loop = true;
    await element.play();
  });
  assert.equal(
    await music.evaluate((element) => element.paused),
    false,
    "música toca normalmente antes da adaptação",
  );
  const consumeTo = async (bytes) => {
    const current = (await state()).metrics.transferredBytes;
    await page.evaluate(
      async (size) => {
        await (await fetch(`/api/payload?size=${size}`)).text();
      },
      Math.max(1, bytes - current),
    );
  };
  const cachedAudio = await page.evaluate(async () => {
    const bytes = new Uint8Array(
      await (await fetch("/audio.wav?cached-for-frame=1")).arrayBuffer(),
    );
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:audio/wav;base64,${btoa(binary)}`;
  });
  await consumeTo(720000);
  await waitMode("economy");
  assert.equal(
    await page.locator("navega-consumption-alert").getAttribute("data-mode"),
    "economy",
  );
  assert.equal(
    await page
      .locator("navega-consumption-alert aside")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(255, 248, 229)",
    "cor acompanha modo economy",
  );
  assert.equal(
    await panel.locator("#mode-indicator strong").innerText(),
    "Econômico",
  );
  assert.equal(
    await music.evaluate((element) => element.paused),
    true,
    "adaptação pausa áudio já carregado",
  );
  assert.equal(
    await music.evaluate((element) => element.muted),
    true,
    "áudio armazenado no buffer permanece sem som",
  );
  assert.equal(
    await worker.evaluate(
      async (id) => (await chrome.tabs.get(id)).mutedInfo.muted,
      tabId,
    ),
    true,
    "aba silenciada como proteção adicional",
  );
  await music.evaluate(async (element) => {
    await element.play().catch(() => {});
  });
  const pausedTime = await music.evaluate((element) => element.currentTime);
  await page.waitForTimeout(350);
  assert.equal(
    await music.evaluate((element) => element.paused),
    true,
    "clicar novamente não reproduz o áudio do buffer",
  );
  assert.ok(
    Math.abs(
      (await music.evaluate((element) => element.currentTime)) - pausedTime,
    ) < 0.1,
    "reprodução permanece parada",
  );
  assert.equal(await asset(page, "image", "economy-image"), "loaded");
  for (const kind of ["audio", "video"]) {
    const tag = `economy-${kind}`;
    assert.equal(
      await asset(page, kind, tag),
      "blocked",
      `Econômico bloqueia ${kind}`,
    );
    assert.ok(
      !received.some((url) => url.includes(`probe=${tag}`)),
      "bloqueado antes de chegar ao servidor",
    );
  }
  // The guard must also stop cached data without relying on a network failure.
  const frameUrl = base.replace("127.0.0.1", "localhost") + "/frame";
  await page.evaluate((url) => {
    const iframe = document.createElement("iframe");
    iframe.src = url;
    document.body.append(iframe);
  }, frameUrl);
  await until(
    async () =>
      Boolean(page.frames().find((frame) => frame.url() === frameUrl)),
    "iframe de outra origem",
  );
  const frame = page.frames().find((frame) => frame.url() === frameUrl);
  await frame.waitForLoadState();
  const checkCachedPlayback = async (target) =>
    target.evaluate(async (source) => {
      const player = document.createElement("audio");
      player.src = source;
      player.loop = true;
      player.id = "cached-player";
      document.body.append(player);
      await player.play().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { paused: player.paused, muted: player.muted };
    }, cachedAudio);
  assert.deepEqual(
    await checkCachedPlayback(frame),
    { paused: true, muted: true },
    "mídia em iframe também é interrompida",
  );
  await page.waitForTimeout(7000);
  await music.evaluate(async (player) => {
    await player.play().catch(() => {});
  });
  assert.equal(
    await music.evaluate((player) => player.paused),
    true,
    "controle permanece ativo após renovar sua duração",
  );
  await worker.evaluate(
    async (id) => chrome.tabs.update(id, { muted: false }),
    tabId,
  );
  await until(
    async () =>
      await worker.evaluate(
        async (id) => (await chrome.tabs.get(id)).mutedInfo.muted,
        tabId,
      ),
    "modo de economia mantém a aba sem som",
  );
  await mkdir("artifacts", { recursive: true });
  await until(
    async () =>
      (await panel.locator("#cache").innerText()).includes("2 bloqueadas"),
    "painel confirma bloqueios no modo Econômico",
  );
  await panel.screenshot({
    path: "artifacts/modo-economico.png",
    fullPage: true,
  });
  await consumeTo(940000);
  await waitMode("restricted");
  assert.equal(
    await page.locator("navega-consumption-alert").getAttribute("data-mode"),
    "restricted",
  );
  assert.equal(
    await page
      .locator("navega-consumption-alert aside")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(255, 241, 237)",
    "cor acompanha modo restricted",
  );
  assert.equal(
    await panel.locator("#mode-indicator strong").innerText(),
    "Restritivo",
  );
  for (const kind of ["image", "audio", "video"]) {
    const tag = `restricted-${kind}`;
    assert.equal(
      await asset(page, kind, tag),
      "blocked",
      `Restritivo bloqueia ${kind}`,
    );
    assert.ok(
      !received.some((url) => url.includes(`probe=${tag}`)),
      "não houve transferência para o servidor",
    );
  }
  // Fetch/XHR fallback matches file paths, preserving ordinary text APIs.
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("/video.webm?probe=fetch-video");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  assert.ok(!received.some((url) => url.includes("probe=fetch-video")));
  assert.equal(
    await page.evaluate(async () => {
      const response = await fetch("/api/data?filename=video.webm");
      await response.text();
      return response.status;
    }),
    200,
  );
  await configure(10);
  await waitMode("normal");
  assert.equal(
    await music.evaluate((player) => player.paused),
    true,
    "Normal não retoma música automaticamente",
  );
  assert.equal(
    await music.evaluate((player) => player.muted),
    false,
    "restaura o mute original do elemento",
  );
  await music.evaluate(async (player) => {
    await player.play();
  });
  assert.equal(
    await music.evaluate((player) => player.paused),
    false,
    "áudio do buffer volta a tocar por ação do usuário em Normal",
  );
  await configure(1);
  await waitMode("restricted");
  assert.equal(
    await music.evaluate((player) => player.paused),
    true,
    "nova adaptação interrompe novamente o áudio",
  );
  await page.reload();
  await waitMode("restricted");
  assert.equal(
    await page.locator("img").first().isVisible(),
    false,
    "Restritivo oculta imagem já presente no DOM",
  );
  const restricted = await state();
  assert.ok(
    restricted.session.requests.some(
      (r) => r.type === "document" && r.state === "complete",
    ),
  );
  assert.ok(
    restricted.session.requests.some(
      (r) => r.type === "stylesheet" && r.state === "complete",
    ),
  );
  assert.ok(
    restricted.session.requests.some(
      (r) => r.type === "script" && r.state === "complete",
    ),
  );
  assert.ok(restricted.metrics.blocked >= 6, "bloqueios são contabilizados");
  assert.ok(
    await page
      .getByRole("heading", { name: "Explore o monitoramento" })
      .isVisible(),
    "texto continua visível",
  );
  // The mode follows the monitored tab; inactive tabs are never included in the rule.
  const otherPromise = context.waitForEvent("page");
  const otherId = await worker.evaluate(
    async (url) => (await chrome.tabs.create({ url, active: false })).id,
    base,
  );
  const other = await otherPromise;
  const otherPage =
    other ??
    context
      .pages()
      .find((p) => p !== page && p !== panel && p.url().startsWith(base));
  if (!otherPage) throw new Error("Segunda aba de teste indisponível");
  await otherPage.waitForLoadState();
  assert.equal(
    await asset(otherPage, "image", "inactive-image"),
    "loaded",
    "outra aba não recebe bloqueios",
  );
  await worker.evaluate(
    async (tabId) => chrome.tabs.update(tabId, { active: true }),
    otherId,
  );
  await until(
    async () => (await state()).adaptation.tabId === otherId,
    "regras seguem nova aba",
  );
  assert.equal(await asset(otherPage, "image", "switched-image"), "blocked");
  assert.equal(
    await asset(page, "image", "previous-image"),
    "loaded",
    "regras removidas da aba anterior",
  );
  await worker.evaluate(
    async (tabId) => chrome.tabs.update(tabId, { active: true }),
    tabId,
  );
  await until(
    async () => (await state()).adaptation.tabId === tabId,
    "retorno à aba original",
  );
  await panel.screenshot({
    path: "artifacts/modo-restritivo.png",
    fullPage: true,
  });
  await panel.setViewportSize({ width: 420, height: 1000 });
  assert.equal(
    await panel.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "layout estreito sem overflow",
  );
  await panel.screenshot({ path: "artifacts/modos-lateral.png" });
  await configure(10);
  await waitMode("normal");
  assert.equal(
    await worker.evaluate(
      async (id) => (await chrome.tabs.get(id)).mutedInfo.muted,
      tabId,
    ),
    false,
    "Normal restaura o estado de som da aba",
  );
  for (const kind of ["image", "audio", "video"])
    assert.equal(
      await asset(page, kind, `restored-${kind}`),
      "loaded",
      "Normal restaura o carregamento",
    );
  await configure(1, false);
  await waitMode("normal");
  assert.deepEqual(
    await worker.evaluate(async () =>
      chrome.declarativeNetRequest.getSessionRules(),
    ),
    [],
    "desativar remove regras",
  );
  await configure(1, true);
  await waitMode("restricted");
  await panel
    .getByRole("button", { name: "Encerrar captura", exact: true })
    .click();
  await waitMode("normal");
  assert.deepEqual(
    await worker.evaluate(async () =>
      chrome.declarativeNetRequest.getSessionRules(),
    ),
    [],
    "encerrar remove regras",
  );
  assert.equal(await asset(page, "image", "stopped-image"), "loaded");
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/adaptation-verification.json",
    JSON.stringify(
      {
        result: "passed",
        checkedAt: new Date().toISOString(),
        browser: context.browser().version(),
        modes: ["normal", "economy", "restricted"],
        confirmed:
          "Bloqueios reais antes do servidor; áudio em buffer e iframe interrompidos; renovação da proteção, texto/CSS/JS, troca de aba e restauração verificadas.",
      },
      null,
      2,
    ),
  );
  console.log(
    "Três modos aprovados em navegador real, com bloqueios confirmados no servidor.",
  );
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/adaptation-failure.json",
    JSON.stringify({ error: error.message, state: lastState, errors }, null, 2),
  );
  if (panel)
    await panel
      .screenshot({ path: "artifacts/adaptation-failure.png", fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
