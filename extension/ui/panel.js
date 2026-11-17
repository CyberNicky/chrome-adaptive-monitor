import { RESOURCE_TYPES } from "../monitoring/resource-classifier.js";
import { sanitizeUrl } from "../monitoring/consumption-estimator.js";

import { getBillingCycle, localDate } from "../knowledge/billing-cycle.js";

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
let budgetSettings = null;

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

function renderBudgetSettings() {
  const total = budgetSettings
    ? `${budgetSettings.dataAmount.toLocaleString("pt-BR")} ${budgetSettings.dataUnit}`
    : "—";
  const planLabel = budgetSettings
    ? `Plano total: ${budgetSettings.planName}, ${total}`
    : "Plano total ainda não configurado";
  $("plan-total").textContent = total;
  $("plan-indicator").classList.toggle("configured", Boolean(budgetSettings));
  $("plan-indicator").setAttribute("aria-label", planLabel);
  $("plan-indicator").title = planLabel;
  $("open-settings").setAttribute(
    "aria-label",
    budgetSettings
      ? `Configurar orçamento. Atual: ${budgetSettings.planName}, ${total}`
      : "Configurar orçamento",
  );
}

function renderAdaptation() {
  const a = state.adaptation;
  const names = {
    normal: "Normal",
    economy: "Econômico",
    restricted: "Restritivo",
  };
  const mode = a?.mode ?? "normal";
  const label = a?.error ? "Falha ao aplicar" : names[mode];
  $("mode-indicator").querySelector("strong").textContent = label;
  $("mode-indicator").dataset.mode = mode;
  $("mode-indicator").setAttribute(
    "aria-label",
    `Modo de economia atual: ${label}`,
  );
  $("mode-indicator").title = a?.error ?? a?.reason ?? "Recursos permitidos";
  $("adaptation-summary").textContent = a?.error
    ? "Falha ao aplicar a adaptação. O modo pretendido pode não estar ativo; confira a mensagem abaixo."
    : (a?.reason ?? "Configure o orçamento para ativar a economia automática.");
  $("adaptation-usage").textContent = a?.configured
    ? `${formatBytes(a.consumedBytes)} de ${formatBytes(a.totalBytes)} · ${a.usedPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% utilizado neste ciclo · saldo estimado ${formatBytes(a.remainingBytes)}`
    : "Sem orçamento configurado.";
  $("billing-cycle-status").textContent = a?.cycle
    ? describeCycle(a.cycle)
    : "";
  $("usage-error").hidden = !state.usageError;
  $("usage-error").textContent = state.usageError ?? "";
  $("adaptation-progress").value = Math.min(100, a?.usedPercent ?? 0);
  $("adaptation-error").hidden = !a?.error;
  $("adaptation-error").textContent = a?.error ?? "";
}

function renderConsumptionAlert() {
  const alert = state.consumptionAlert;
  $("consumption-alert").hidden = !alert?.visible;
  $("consumption-alert").dataset.severity =
    alert?.current?.severity ?? "warning";
  $("consumption-alert-title").textContent = alert?.current?.title ?? "";
  $("consumption-alert-message").textContent = alert?.current?.message ?? "";
  $("acknowledge-consumption-alert").disabled = busy;
  $("notification-error").hidden = !alert?.error;
  $("notification-error").textContent = alert?.error ?? "";
}

function describeCycle(cycle) {
  const date = (value) => value.split("-").reverse().join("/");
  const days = (value) => `${value} ${value === 1 ? "dia" : "dias"}`;
  return cycle.active
    ? `Ciclo iniciado em ${date(cycle.startDate)} · renova em ${date(cycle.endDate)} · ${days(cycle.durationDays)} no ciclo · ${days(cycle.remainingDays)} até renovar`
    : `Franquia começa em ${date(cycle.startDate)} · renova em ${date(cycle.endDate)} · ${days(cycle.durationDays)} no ciclo`;
}
function previewCycle() {
  const fixed = $("cycle-type").value === "days";
  $("cycle-days-field").hidden = !fixed;
  $("cycle-days").disabled = !fixed;
  $("cycle-days").required = fixed;
  try {
    const cycle = getBillingCycle({
      cycleStartDate: $("cycle-start-date").value,
      cycleType: $("cycle-type").value,
      cycleDays: Number($("cycle-days").value),
    });
    $("cycle-preview").textContent = describeCycle(cycle);
  } catch {
    $("cycle-preview").textContent =
      "Informe uma data e uma duração válidas para visualizar o ciclo.";
  }
}
function fillSettingsForm() {
  $("plan-name").value = budgetSettings?.planName ?? "";
  $("data-amount").value = budgetSettings?.dataAmount ?? "";
  $("data-unit").value = budgetSettings?.dataUnit ?? "GB";
  $("cycle-start-date").value = budgetSettings?.cycleStartDate ?? localDate();
  $("cycle-type").value = budgetSettings?.cycleType ?? "monthly";
  $("cycle-days").value = budgetSettings?.cycleDays ?? 30;
  previewCycle();
  $("notifications-enabled").checked =
    budgetSettings?.notificationsEnabled ?? true;
  $("adaptive-enabled").checked = budgetSettings?.adaptiveEnabled ?? true;
  $("settings-error").hidden = true;
}

function openSettings() {
  fillSettingsForm();
  $("settings-dialog").showModal();
  $("plan-name").focus();
}

function closeSettings() {
  $("settings-dialog").close();
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
  $("acknowledge-consumption-alert").disabled = busy;
  const session = state.session;
  const recording = Boolean(session?.recording);
  $("start").hidden = recording;
  $("stop").hidden = !recording;
  $("start").disabled = busy || !targetTab;
  $("start").textContent = session ? "Iniciar nova sessão" : "Iniciar captura";
  $("stop").disabled = busy;
  $("reload").disabled = busy || !recording || session.tabId === null;
  $("export").disabled = !session?.requests.length;
  $("clear").disabled = busy || recording || !session;
  $("target").textContent =
    (recording ? session.pageUrl : (targetTab?.url ?? session?.pageUrl)) ??
    (recording
      ? "Aguardando uma aba HTTP(S)…"
      : "Abra uma página HTTP(S) para começar.");
  $("target").title = $("target").textContent;
  document.querySelector(".target .label").textContent = recording
    ? "ABA MONITORADA AUTOMATICAMENTE"
    : "ABA SELECIONADA";
  $("status").textContent = recording
    ? session.tabId === null
      ? "Aguardando página"
      : "Captura automática ativa"
    : session
      ? "Captura encerrada"
      : "Pronto para iniciar";
  $("status").classList.toggle("live", recording);
  $("guidance").textContent = recording
    ? "Troque de aba: a captura acompanha você automaticamente. O histórico permanece nesta sessão; só a aba ativa é observada. Recursos já carregados exigem recarregar."
    : "Inicie a captura e recarregue a página para observar o carregamento completo. Uma nova sessão substitui os registros anteriores.";
  $("notice").hidden = !session?.notice;
  $("notice").textContent = session?.notice ?? "";
  $("expand").href =
    `panel.html${session ? `?tabId=${session.tabId}` : targetTab ? `?tabId=${targetTab.id}` : ""}`;
}

function render() {
  budgetSettings = state.budgetSettings ?? null;
  renderBudgetSettings();
  renderAdaptation();
  renderConsumptionAlert();
  renderControls();
  const { session, metrics: m } = state;
  $("bytes").textContent = formatBytes(m.transferredBytes ?? 0);
  $("count").textContent = (m.requests ?? 0).toLocaleString("pt-BR");
  $("rate").textContent = `${formatBytes(m.bytesPerMinute ?? 0)}/min`;
  $("pending").textContent = m.pending
    ? `${m.pending} em andamento`
    : "Nenhuma em andamento";
  $("failures").textContent = m.failures ?? 0;
  $("cache").textContent =
    `${m.cached ?? 0} em cache · ${m.blocked ?? 0} bloqueadas`;
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
  const chosen = $("tab-filter").value;
  const tabs = session?.tabs ?? [];
  $("tab-filter").replaceChildren(
    new Option("Todas as abas", "all"),
    ...tabs.map(
      (tab, index) =>
        new Option(
          `Aba ${index + 1} · ${new URL(tab.url).hostname}`,
          String(tab.id),
        ),
    ),
  );
  if ([...$("tab-filter").options].some((option) => option.value === chosen))
    $("tab-filter").value = chosen;
  renderTabRanking();
  renderRows();
  $("coverage").textContent = session
    ? `${session.tabs?.length ?? 1} abas visitadas · ${session.requests.length} registros · ${m.unknownSizes} sem tamanho · limite de 3.000${session.ignored ? ` · ${session.ignored} não registrados` : ""}`
    : "Aguardando uma sessão.";
}

function renderTabRanking() {
  const ranking = state.metrics.byTab ?? [];
  const total = state.metrics.transferredBytes ?? 0;
  const maximum = ranking[0]?.bytes ?? 0;
  const tied =
    maximum > 0 && ranking.filter((tab) => tab.bytes === maximum).length > 1;
  $("tab-ranking-empty").hidden = ranking.length > 0;
  $("tab-ranking").replaceChildren(
    ...ranking.map((tab, index) => {
      const item = text("li", "", "tab-ranking-item");
      item.dataset.tabId = tab.tabId ?? "unknown";
      item.dataset.bytes = String(tab.bytes);
      const position = text(
        "span",
        String(index + 1).padStart(2, "0"),
        "tab-position",
      );
      const details = text("div", "", "tab-details");
      const title = text("div", "", "tab-heading");
      title.append(
        text(
          "strong",
          tab.tabId === null ? "Aba sem identificação" : `Aba ${tab.tabNumber}`,
        ),
      );
      if (maximum > 0 && tab.bytes === maximum)
        title.append(
          text(
            "span",
            tied ? "Maior consumo · empate" : "Maior consumo",
            "tab-leader",
          ),
        );
      let domain = "Endereço indisponível";
      try {
        domain = new URL(tab.url).hostname;
      } catch {
        /* Older sessions may not include a URL. */
      }
      const address = text("span", `Último site: ${domain}`, "tab-domain");
      address.title = tab.url ?? "";
      details.append(
        title,
        address,
        text(
          "span",
          `${tab.requests} requisições${tab.pending ? ` · ${tab.pending} em andamento` : ""}${tab.unknownSizes ? ` · ${tab.unknownSizes} sem tamanho` : ""}`,
          "tab-meta",
        ),
      );
      const amount = text("div", "", "tab-amount");
      const unknown = tab.requests > 0 && tab.unknownSizes === tab.requests;
      amount.append(text("strong", formatBytes(unknown ? null : tab.bytes)));
      amount.append(
        text(
          "span",
          unknown
            ? "Tamanho indisponível"
            : total > 0
              ? `${((tab.bytes / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da sessão`
              : "Sem bytes observados",
          "tab-meta",
        ),
      );
      if (tab.tabId !== null) {
        const button = text("button", "Ver requisições", "tab-open");
        button.setAttribute(
          "aria-label",
          `Ver requisições da Aba ${tab.tabNumber}`,
        );
        button.addEventListener("click", () => {
          $("tab-filter").value = String(tab.tabId);
          $("search").value = "";
          $("filter").value = "all";
          limit = 100;
          renderRows();
          $("requests-title").scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          $("tab-filter").focus({ preventScroll: true });
        });
        amount.append(button);
      }
      item.append(position, details, amount);
      return item;
    }),
  );
}

function renderRows() {
  const query = $("search").value.toLowerCase();
  const kind = $("filter").value;
  const tab = $("tab-filter").value;
  const rows = (state.session?.requests ?? []).filter(
    (row) =>
      (tab === "all" || String(row.tabId) === tab) &&
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
        text(
          "span",
          `${row.method} · ${row.domain} · Aba ${Math.max(0, state.session.tabs?.findIndex((tab) => tab.id === row.tabId) ?? 0) + 1}`,
          "resource-domain",
        ),
      );
      resource.title = row.url;
      const type = document.createElement("td");
      type.append(text("span", labels[row.type], "type-tag"));
      const status = document.createElement("td");
      status.append(
        text(
          "span",
          row.state === "failed"
            ? row.blocked
              ? "Bloqueada"
              : "Falha"
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
$("clear").addEventListener("click", () => action(() => send("CLEAR")));
$("acknowledge-consumption-alert").addEventListener("click", () => {
  const alert = state.consumptionAlert;
  if (alert?.current)
    action(() =>
      send("ACKNOWLEDGE_CONSUMPTION_ALERT", {
        level: alert.current.level,
        token: alert.token,
      }),
    );
});
$("open-settings").addEventListener("click", openSettings);
$("close-settings").addEventListener("click", closeSettings);
$("cancel-settings").addEventListener("click", closeSettings);
$("settings-dialog").addEventListener("click", (event) => {
  if (event.target === $("settings-dialog")) closeSettings();
});
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = $("save-settings");
  const error = $("settings-error");
  error.hidden = true;
  save.disabled = true;
  try {
    const form = new FormData(event.currentTarget);
    await send("SAVE_BUDGET", {
      settings: {
        planName: form.get("planName"),
        dataAmount: form.get("dataAmount"),
        dataUnit: form.get("dataUnit"),
        cycleStartDate: form.get("cycleStartDate"),
        cycleType: form.get("cycleType"),
        cycleDays: form.get("cycleDays"),
        notificationsEnabled: $("notifications-enabled").checked,
        adaptiveEnabled: $("adaptive-enabled").checked,
      },
    });
    renderBudgetSettings();
    closeSettings();
  } catch (cause) {
    error.textContent =
      cause.message || "Não foi possível salvar a configuração.";
    error.hidden = false;
  } finally {
    save.disabled = false;
  }
});
for (const id of ["cycle-start-date", "cycle-type", "cycle-days"])
  $(id).addEventListener("input", previewCycle);
for (const id of ["search", "filter", "sort", "tab-filter"])
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
    budgetSettings,
    adaptation: state.adaptation,
    consumptionAlert: state.consumptionAlert,
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
    const tab = await chrome.tabs.get(requestedId).catch(() => null);
    targetTab =
      tab && sanitizeUrl(tab.url)
        ? { id: tab.id, url: sanitizeUrl(tab.url) }
        : null;
  } else await selectTarget();
  await send("GET_STATE");
});
connect();
