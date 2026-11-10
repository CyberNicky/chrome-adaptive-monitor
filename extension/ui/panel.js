import { RESOURCE_TYPES } from "../monitoring/resource-classifier.js";
import { sanitizeUrl } from "../monitoring/consumption-estimator.js";

const $ = (id) => document.getElementById(id);
const labels = {
  document: "HTML",
  stylesheet: "CSS",
  script: "JavaScript",
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  media: "Mídia",
  font: "Fonte",
  fetch: "Fetch / XHR",
  other: "Outros",
};
let state = { session: null, metrics: {} };
let targetTab = null;
let limit = 100;
let busy = false;
let connection;
let reconnect;
let disposed = false;

export function formatBytes(value) {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return `${Math.round(value)} B`;
  const units = ["kB", "MB", "GB"];
  let unit = -1;
  do {
    value /= 1000;
    unit++;
  } while (value >= 1000 && unit < units.length - 1);
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok)
    throw new Error(
      response?.error ??
        "Não foi possível acessar a extensão. Reabra o painel.",
    );
  state = response.data;
  render();
}

async function action(callback) {
  busy = true;
  $("error").hidden = true;
  renderControls();
  try {
    await callback();
  } catch (error) {
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    busy = false;
    renderControls();
  }
}

async function selectTarget() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  targetTab =
    tab && sanitizeUrl(tab.url)
      ? { id: tab.id, url: sanitizeUrl(tab.url) }
      : null;
  render();
}

function renderControls() {
  const session = state.session;
  const recording = Boolean(session?.recording);
  $("start").hidden = recording;
  $("stop").hidden = !recording;
  $("start").disabled = busy || !targetTab;
  $("start").textContent = session ? "Iniciar nova sessão" : "Iniciar captura";
  $("stop").disabled = busy;
  $("reload").disabled = busy || !recording;
  $("select").disabled = busy || recording;
  $("export").disabled = !session?.requests.length;
  $("clear").disabled = busy || recording || !session;
  $("target").textContent =
    (recording ? session.pageUrl : (targetTab?.url ?? session?.pageUrl)) ??
    "Abra uma página HTTP(S) e clique em “Usar aba atual”.";
  $("target").title = $("target").textContent;
  document.querySelector(".target .label").textContent = recording
    ? "ABA DA SESSÃO"
    : "ABA SELECIONADA";
  $("status").textContent = recording
    ? "Capturando ao vivo"
    : session
      ? "Captura encerrada"
      : "Pronto para iniciar";
  $("status").classList.toggle("live", recording);
  $("guidance").textContent = recording
    ? "A captura continua ao navegar nesta aba. Recarregar mantém os registros; encerrar preserva a sessão."
    : "Inicie a captura e recarregue a página para observar o carregamento completo. Uma nova sessão substitui os registros anteriores.";
  $("notice").hidden = !session?.notice;
  $("notice").textContent = session?.notice ?? "";
  $("expand").href =
    `panel.html${session ? `?tabId=${session.tabId}` : targetTab ? `?tabId=${targetTab.id}` : ""}`;
}

function render() {
  renderControls();
  const { session, metrics: m } = state;
  $("bytes").textContent = formatBytes(m.transferredBytes ?? 0);
  $("count").textContent = (m.requests ?? 0).toLocaleString("pt-BR");
  $("rate").textContent = `${formatBytes(m.bytesPerMinute ?? 0)}/min`;
  $("pending").textContent = m.pending
    ? `${m.pending} em andamento`
    : "Nenhuma em andamento";
  $("failures").textContent = m.failures ?? 0;
  $("cache").textContent = `${m.cached ?? 0} recursos em cache`;
  const types = Object.entries(m.byType ?? {}).sort(
    (a, b) => b[1].bytes - a[1].bytes,
  );
  $("types").replaceChildren(
    ...types.map(([type, values]) => {
      const item = text("div", "", "type-item");
      const meta = text("div", "", "type-meta");
      meta.append(
        text("span", `${labels[type]} · ${values.requests}`),
        text("b", formatBytes(values.bytes)),
      );
      const bar = text("div", "", "bar");
      const fill = text("i", "");
      fill.style.width = `${m.transferredBytes ? (values.bytes / m.transferredBytes) * 100 : 0}%`;
      bar.append(fill);
      item.append(meta, bar);
      return item;
    }),
  );
  if (!types.length)
    $("types").append(
      text(
        "p",
        "A distribuição aparece assim que os recursos são carregados.",
        "muted",
      ),
    );
  renderRows();
  $("coverage").textContent = session
    ? `${session.requests.length} registros · ${m.unknownSizes} sem tamanho · limite de 3.000${session.ignored ? ` · ${session.ignored} não registrados` : ""}`
    : "Aguardando uma sessão.";
}

function renderRows() {
  const query = $("search").value.toLowerCase();
  const kind = $("filter").value;
  const rows = (state.session?.requests ?? []).filter(
    (row) =>
      (kind === "all" || row.type === kind) &&
      row.url.toLowerCase().includes(query),
  );
  const sort = $("sort").value;
  rows.sort((a, b) =>
    sort === "size"
      ? (b.transferredBytes ?? -1) - (a.transferredBytes ?? -1)
      : sort === "duration"
        ? (b.durationMs ?? -1) - (a.durationMs ?? -1)
        : b.id - a.id,
  );
  $("visible-count").textContent = rows.length;
  $("more").hidden = rows.length <= limit;
  $("empty").hidden = rows.length > 0;
  $("empty").querySelector("h3").textContent = state.session?.requests.length
    ? "Nenhum recurso para este filtro."
    : "Sua próxima navegação, em detalhes.";
  $("empty").querySelector("p").textContent = state.session?.requests.length
    ? "Experimente outro tipo ou termo de busca."
    : "Inicie a captura e recarregue a página para acompanhar as requisições.";
  $("rows").replaceChildren(
    ...rows.slice(0, limit).map((row) => {
      const tr = document.createElement("tr");
      const resource = document.createElement("td");
      const url = new URL(row.url);
      let name = url.pathname.split("/").filter(Boolean).at(-1) || url.hostname;
      try {
        name = decodeURIComponent(name);
      } catch {
        /* Encoded URL can be malformed. */
      }
      resource.append(
        text("span", name, "resource-name"),
        text("span", `${row.method} · ${row.domain}`, "resource-domain"),
      );
      resource.title = row.url;
      const type = document.createElement("td");
      type.append(text("span", labels[row.type], "type-tag"));
      const status = document.createElement("td");
      status.append(
        text(
          "span",
          row.state === "failed"
            ? "Falha"
            : row.state === "interrupted"
              ? "Interrompida"
              : (row.status ?? "…"),
          `http-status${row.error || row.status >= 400 ? " bad" : ""}`,
        ),
      );
      status.title =
        row.error ||
        (row.state === "redirect" ? "Redirecionamento" : row.state);
      const size = text("td", formatBytes(row.transferredBytes));
      if (row.fromCache || row.fromServiceWorker || row.state !== "complete")
        size.append(
          text(
            "span",
            row.fromCache
              ? "cache"
              : row.fromServiceWorker
                ? "service worker"
                : row.state === "pending"
                  ? "parcial"
                  : row.state === "redirect"
                    ? "redirecionamento"
                    : "parcial / interrompida",
            "transfer-note",
          ),
        );
      const duration = text(
        "td",
        row.durationMs === null ? "…" : `${Math.round(row.durationMs)} ms`,
      );
      tr.append(resource, type, status, size, duration);
      return tr;
    }),
  );
}

for (const type of RESOURCE_TYPES)
  $("filter").append(new Option(labels[type], type));
$("start").addEventListener("click", () =>
  action(() => send("START", { tabId: targetTab?.id })),
);
$("stop").addEventListener("click", () => action(() => send("STOP")));
$("reload").addEventListener("click", () => action(() => send("RELOAD")));
$("select").addEventListener("click", () => action(selectTarget));
$("clear").addEventListener("click", () => action(() => send("CLEAR")));
for (const id of ["search", "filter", "sort"])
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    limit = 100;
    renderRows();
  });
$("more").addEventListener("click", () => {
  limit += 100;
  renderRows();
});
$("export").addEventListener("click", () => {
  const { session, metrics } = state;
  if (!session) return;
  const data = {
    exportedAt: new Date().toISOString(),
    note: "Estimativa CDP de respostas HTTP(S); não representa todo o tráfego do dispositivo. URLs sem query/fragmento/credenciais. Caminhos podem conter dados pessoais.",
    session,
    metrics,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `navega-sessao-${new Date(session.startedAt).toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function connect() {
  connection = chrome.runtime.connect({ name: "monitor-panel" });
  connection.onMessage.addListener((value) => {
    state = value;
    render();
  });
  connection.onDisconnect.addListener(() => {
    if (!disposed) reconnect = setTimeout(connect, 1000);
  });
}
const rateTimer = setInterval(() => {
  if (!state.session?.recording) return;
  const elapsedMinutes = Math.max(
    1 / 60,
    (Date.now() - state.session.startedAt) / 60000,
  );
  $("rate").textContent =
    `${formatBytes((state.metrics.transferredBytes ?? 0) / elapsedMinutes)}/min`;
}, 1000);
window.addEventListener("pagehide", () => {
  disposed = true;
  clearInterval(rateTimer);
  clearTimeout(reconnect);
  connection?.disconnect();
});
chrome.tabs.onActivated.addListener(() => {
  if (
    !state.session?.recording &&
    !new URLSearchParams(location.search).has("tabId")
  )
    void selectTarget();
});
const requestedId = Number(new URLSearchParams(location.search).get("tabId"));
await action(async () => {
  if (requestedId) {
    const tab = await chrome.tabs.get(requestedId);
    targetTab = sanitizeUrl(tab.url)
      ? { id: tab.id, url: sanitizeUrl(tab.url) }
      : null;
  } else await selectTarget();
  await send("GET_STATE");
});
connect();
