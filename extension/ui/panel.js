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
let targetSelection = 0;
let selectionKey = "";
const requestedId = Number(new URLSearchParams(location.search).get("tabId"));
let limit = 100;
let busy = false;
let connection;
let reconnect;
let disposed = false;
let budgetSettings = null;
let selectedHistory = null;
let historySignature = null;
const displayedState = () => selectedHistory ?? state;
const dateTime = (value) => new Date(value).toLocaleString("pt-BR");

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
  $("page-alert-error").hidden = !state.pageAlertError;
  $("page-alert-error").textContent = state.pageAlertError ?? "";
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
    if ($("history-dialog").open) {
      $("history-dialog-error").textContent = error.message;
      $("history-dialog-error").hidden = false;
    }
  } finally {
    busy = false;
    renderControls();
  }
}

async function selectTarget() {
  const selection = ++targetSelection;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = active;
  // An expanded panel is itself the active tab. Keep the monitored page as
  // the target, but validate its ID: closed tabs must never enable Start.
  if (active?.url?.startsWith(chrome.runtime.getURL(""))) {
    tab = null;
    for (const id of new Set([state.session?.tabId, targetTab?.id, requestedId])) {
      if (!Number.isInteger(id) || id <= 0) continue;
      const candidate = await chrome.tabs.get(id).catch(() => null);
      if (candidate && sanitizeUrl(candidate.url)) {
        tab = candidate;
        break;
      }
    }
  }
  if (selection !== targetSelection || disposed) return;
  targetTab = tab && sanitizeUrl(tab.url)
    ? { id: tab.id, url: sanitizeUrl(tab.url) }
    : null;
  renderControls();
}

function renderControls() {
  $("open-history").disabled = busy;
  $("back-to-current").disabled = busy;
  for (const button of $("history-list").querySelectorAll("button"))
    button.disabled = busy;
  $("acknowledge-consumption-alert").disabled = busy;
  const session = state.session;
  const recording = Boolean(session?.recording);
  $("start").hidden = recording;
  $("stop").hidden = !recording;
  $("start").disabled = busy || !targetTab;
  $("start").textContent = session ? "Iniciar nova sessão" : "Iniciar captura";
  $("stop").disabled = busy;
  $("reload").disabled = busy || !recording || session.tabId === null;
  $("export").disabled = !displayedState().session?.requests.length;
  $("clear").hidden = Boolean(selectedHistory);
  $("clear").disabled = busy || recording || !session;
  $("target").textContent =
    (recording ? session.pageUrl : targetTab?.url) ??
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
    : "Inicie a captura e recarregue a página para observar o carregamento completo. As sessões anteriores ficam disponíveis no histórico.";
  $("notice").hidden = !session?.notice;
  $("notice").textContent = session?.notice ?? "";
  $("expand").href =
    `panel.html${session ? `?tabId=${session.tabId}` : targetTab ? `?tabId=${targetTab.id}` : ""}`;
}

async function requestHistoryEntry(id) {
  const response = await chrome.runtime.sendMessage({
    type: "GET_HISTORY_SESSION",
    id,
  });
  if (!response?.ok)
    throw new Error(
      response?.error ?? "Não foi possível abrir a sessão salva.",
    );
  return response.data.entry;
}
function resetFilters() {
  $("search").value = "";
  $("filter").value = "all";
  $("tab-filter").value = "all";
  limit = 100;
}
function renderHistory() {
  const list = state.history ?? [];
  if (
    selectedHistory &&
    !list.some((entry) => entry.id === selectedHistory.id)
  ) {
    selectedHistory = null;
    resetFilters();
  }
  $("history-error").hidden = !state.historyError;
  $("history-error").textContent = state.historyError ?? "";
  $("selected-history").hidden = !selectedHistory;
  $("selected-history-title").textContent = selectedHistory
    ? `Sessão de ${dateTime(selectedHistory.session.startedAt)}`
    : "";
  $("selected-history-info").textContent = selectedHistory
    ? `${selectedHistory.recovered ? "Interrompida · último ponto salvo" : "Encerrada"} em ${dateTime(selectedHistory.session.stoppedAt ?? selectedHistory.savedAt)}. ${state.session?.recording ? "A captura atual continua ativa." : "Consulta ao histórico salvo."}`
    : "";
  const signature = JSON.stringify(list);
  if (signature === historySignature) return;
  historySignature = signature;
  $("history-empty").hidden = list.length > 0;
  $("history-list").replaceChildren(
    ...list.map((entry) => {
      const item = text("li", "", "history-item");
      item.dataset.sessionId = entry.id;
      const meta = text("div", "", "history-meta");
      meta.append(
        text("strong", dateTime(entry.startedAt)),
        text(
          "span",
          `${formatBytes(entry.transferredBytes)} · ${entry.requests} requisições · ${entry.tabs} abas`,
        ),
        text(
          "span",
          entry.recovered
            ? "Interrompida · último ponto salvo"
            : "Captura encerrada",
        ),
      );
      const buttons = text("div", "", "history-actions");
      const open = text("button", "Ver detalhes");
      open.type = "button";
      open.disabled = busy;
      open.setAttribute(
        "aria-label",
        `Ver sessão de ${dateTime(entry.startedAt)}`,
      );
      open.addEventListener("click", () =>
        action(async () => {
          selectedHistory = await requestHistoryEntry(entry.id);
          resetFilters();
          $("history-dialog").close();
          render();
          $("selected-history").scrollIntoView({ block: "start" });
        }),
      );
      const remove = text("button", "Excluir sessão");
      remove.type = "button";
      remove.disabled = busy;
      remove.setAttribute(
        "aria-label",
        `Excluir sessão de ${dateTime(entry.startedAt)}`,
      );
      remove.addEventListener("click", () =>
        action(async () => {
          await send("DELETE_HISTORY_SESSION", { id: entry.id });
          if (selectedHistory?.id === entry.id) {
            selectedHistory = null;
            resetFilters();
            render();
          }
        }),
      );
      buttons.append(open, remove);
      item.append(meta, buttons);
      return item;
    }),
  );
}
function render() {
  const key = JSON.stringify([
    state.session?.id,
    state.session?.tabId,
    state.session?.recording,
  ]);
  if (key !== selectionKey) {
    selectionKey = key;
    void selectTarget();
  }
  budgetSettings = state.budgetSettings ?? null;
  renderBudgetSettings();
  renderAdaptation();
  renderConsumptionAlert();
  renderHistory();
  renderControls();
  const { session, metrics: m } = displayedState();
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
  const ranking = displayedState().metrics.byTab ?? [];
  const total = displayedState().metrics.transferredBytes ?? 0;
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
  const displayedSession = displayedState().session;
  const query = $("search").value.toLowerCase();
  const kind = $("filter").value;
  const tab = $("tab-filter").value;
  const rows = (displayedSession?.requests ?? []).filter(
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
  $("empty").querySelector("h3").textContent = displayedSession?.requests.length
    ? "Nenhum recurso para este filtro."
    : "Sua próxima navegação, em detalhes.";
  $("empty").querySelector("p").textContent = displayedSession?.requests.length
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
          `${row.method} · ${row.domain} · Aba ${Math.max(0, displayedSession.tabs?.findIndex((tab) => tab.id === row.tabId) ?? 0) + 1}`,
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
  action(async () => {
    await selectTarget();
    if (!targetTab) throw new Error("Abra uma página HTTP(S) para começar.");
    await send("START", { tabId: targetTab.id });
  }),
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
$("open-history").addEventListener("click", () => {
  renderHistory();
  $("history-dialog-error").textContent = state.historyError ?? "";
  $("history-dialog-error").hidden = !state.historyError;
  $("history-dialog").showModal();
});
$("close-history").addEventListener("click", () => $("history-dialog").close());
$("history-dialog").addEventListener("click", (event) => {
  if (event.target === $("history-dialog")) $("history-dialog").close();
});
$("back-to-current").addEventListener("click", () => {
  selectedHistory = null;
  resetFilters();
  render();
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
  const { session, metrics } = displayedState();
  if (!session) return;
  const data = {
    exportedAt: new Date().toISOString(),
    note: "Estimativa CDP de respostas HTTP(S); não representa todo o tráfego do dispositivo. URLs sem query/fragmento/credenciais. Caminhos podem conter dados pessoais.",
    session,
    metrics,
    budgetSettings: selectedHistory
      ? selectedHistory.budgetSettings
      : budgetSettings,
    adaptation: selectedHistory ? selectedHistory.adaptation : state.adaptation,
    historical: Boolean(selectedHistory),
    consumptionAlert: selectedHistory ? undefined : state.consumptionAlert,
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
  if (selectedHistory || !state.session?.recording) return;
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
chrome.tabs.onActivated.addListener(() => void selectTarget());
chrome.tabs.onUpdated.addListener((_id, changes) => {
  if (changes.url || changes.status === "complete") void selectTarget();
});
chrome.tabs.onRemoved.addListener(() => void selectTarget());
chrome.windows.onFocusChanged.addListener(() => void selectTarget());
await action(async () => {
  await send("GET_STATE");
  await selectTarget();
});
connect();
