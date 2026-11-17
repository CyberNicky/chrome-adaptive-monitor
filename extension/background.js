import {
  collectEvent,
  createSession,
  interruptTabRequests,
  stopSession,
} from "./monitoring/request-collector.js";
import { sanitizeUrl } from "./monitoring/consumption-estimator.js";
import { aggregateMetrics } from "./monitoring/metrics-aggregator.js";
import { sessionStore } from "./knowledge/session-store.js";
import {
  attachSensor,
  detachSensor,
  enableTarget,
} from "./sensors/chrome-network-sensor.js";

import { reconcileUsage, usageStore } from "./knowledge/budget-usage.js";
import { alertStore } from "./knowledge/alert-store.js";
import {
  createConsumptionAlerts,
  CONSUMPTION_NOTIFICATION_ID,
} from "./alerts/consumption-alerts.js";
import { budgetStore } from "./knowledge/budget-store.js";
import { analyzeBudget } from "./analysis/budget-analyzer.js";
import { planAdaptation } from "./planning/adaptation-planner.js";
import { createRequestEffector } from "./effectors/chrome-request-effector.js";

import {
  createPageAlertEffector,
  PAGE_ALERT_BINDING,
} from "./effectors/chrome-page-alert-effector.js";
import { createContentEffector } from "./effectors/chrome-content-effector.js";
const contentEffector = createContentEffector({
  sendCommand: (target, method, params) =>
    chrome.debugger.sendCommand(target, method, params),
  tabs: chrome.tabs,
  runtimeId: chrome.runtime.id,
});
const pageAlertEffector = createPageAlertEffector({
  sendCommand: (target, method, params) =>
    chrome.debugger.sendCommand(target, method, params),
});
const consumptionAlerts = createConsumptionAlerts({
  store: alertStore,
  notifications: chrome.notifications,
  iconUrl: chrome.runtime.getURL("icons/icon128.png"),
});
const CYCLE_ALARM = "budget-cycle-renewal";
let scheduledBoundary = null;
let budgetUsage = null;
let usageError = null;
let budgetSettings = null;
let adaptation = null;
const effector = createRequestEffector(chrome.declarativeNetRequest);
let session = null;
let timer;
let mutation = Promise.resolve();
const ports = new Set();
const ready = sessionStore.load().then(async (saved) => {
  session = saved;
  budgetSettings = await budgetStore.load();
  budgetUsage = await usageStore.load();
  await consumptionAlerts.load();
  updateUsage();
  if (session && session.schemaVersion !== 2) {
    session.tabs = [{ id: session.tabId, url: session.pageUrl }];
    // Previous sessions use a different request key format. Preserve their history.
    stopSession(
      session,
      "A extensão foi atualizada. Inicie uma nova sessão para ativar a troca automática de abas.",
    );
    session.schemaVersion = 2;
    await detachSensor(session.tabId).catch(() => {});
  }
  if (session?.recording && session.tabId !== null) {
    try {
      await chrome.debugger.sendCommand(
        { tabId: session.tabId },
        "Network.enable",
      );
      await contentEffector.registerTarget({ tabId: session.tabId });
    } catch {
      session.tabId = null;
      session.pageUrl = null;
      interruptTabRequests(session);
    }
  }
  const initialPlan = planAdaptation(
    analyzeBudget(
      budgetSettings,
      budgetUsage?.consumedBytes ?? 0,
      budgetUsage?.cycle,
    ),
    session,
  );
  await contentEffector.recover(
    initialPlan.mode === "normal" ? null : initialPlan.tabId,
  );
  await publish();
});

function updateUsage(now = Date.now()) {
  budgetUsage = reconcileUsage(budgetUsage, budgetSettings, session, now);
}
async function scheduleCycleRenewal() {
  const cycle = budgetUsage?.cycle;
  const nextMidnight = new Date(Date.now());
  nextMidnight.setHours(24, 0, 0, 0);
  const boundary = cycle
    ? Math.min(
        cycle.active ? cycle.endsAt : cycle.startsAt,
        nextMidnight.getTime(),
      )
    : null;
  if (boundary === scheduledBoundary) return;
  if (boundary) await chrome.alarms.create(CYCLE_ALARM, { when: boundary });
  else await chrome.alarms.clear(CYCLE_ALARM);
  scheduledBoundary = boundary;
}
async function synchronizeAdaptation() {
  updateUsage();
  const analysis = analyzeBudget(
    budgetSettings,
    budgetUsage?.consumedBytes ?? 0,
    budgetUsage?.cycle,
  );
  const plan = planAdaptation(analysis, session);
  try {
    const applied = await effector.apply(plan);
    const content = await contentEffector.apply(plan);
    adaptation = { ...analysis, ...plan, ...applied, ...content, error: null };
  } catch {
    adaptation = {
      ...analysis,
      ...plan,
      ...effector.applied,
      desiredMode: plan.mode,
      error:
        "Não foi possível confirmar toda a adaptação de rede e reprodução. O modo pretendido pode não estar completamente ativo. Tente salvar a configuração novamente.",
    };
  }
}

function enqueue(operation) {
  const result = mutation
    .catch(() => {})
    .then(async () => {
      await ready;
      return operation();
    });
  mutation = result;
  return result;
}
function snapshot() {
  if (!session)
    return {
      session: null,
      metrics: aggregateMetrics(null),
      budgetSettings,
      usageError,
      pageAlertError: pageAlertEffector.error,
      consumptionAlert: consumptionAlerts.snapshot,
      adaptation,
    };
  const { active, ...publicSession } = session;
  return {
    session: publicSession,
    metrics: aggregateMetrics(session),
    budgetSettings,
    usageError,
    pageAlertError: pageAlertEffector.error,
    consumptionAlert: consumptionAlerts.snapshot,
    adaptation,
  };
}
async function publish() {
  clearTimeout(timer);
  timer = null;
  await synchronizeAdaptation();
  await scheduleCycleRenewal();
  try {
    await usageStore.save(budgetUsage);
    usageError = null;
  } catch {
    usageError =
      "Não foi possível salvar o consumo do ciclo. Mantenha a extensão aberta e tente novamente antes de fechar o Chrome.";
  }
  try {
    await sessionStore.save(session);
  } catch {
    if (session)
      session.notice =
        "Não foi possível salvar a sessão. Exporte os registros disponíveis.";
  }
  await consumptionAlerts.synchronize(
    analyzeBudget(
      budgetSettings,
      budgetUsage?.consumedBytes ?? 0,
      budgetUsage?.cycle,
    ),
    budgetUsage,
    budgetSettings,
    !usageError,
  );
  await pageAlertEffector.apply(
    session?.recording ? session.tabId : null,
    consumptionAlerts.snapshot,
    analyzeBudget(
      budgetSettings,
      budgetUsage?.consumedBytes ?? 0,
      budgetUsage?.cycle,
    ),
  );
  const value = snapshot();
  for (const port of ports) {
    try {
      port.postMessage(value);
    } catch {
      ports.delete(port);
    }
  }
  chrome.action
    .setBadgeText({
      text: session?.recording ? (session.tabId === null ? "…" : "ON") : "",
    })
    .catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: "#147a69" }).catch(() => {});
}
function schedulePublish() {
  if (!timer)
    timer = setTimeout(() => {
      void enqueue(publish).catch(() => {});
    }, 250);
}

async function releaseCurrentTab() {
  const tabId = session.tabId;
  // Clear the target before detach so intentional detach cannot end the session.
  session.tabId = null;
  session.pageUrl = null;
  if (tabId !== null) {
    interruptTabRequests(session, tabId);
    await synchronizeAdaptation();
    await pageAlertEffector.clear(tabId);
    contentEffector.forgetTab(tabId);
    await detachSensor(tabId).catch(() => {});
  }
}
async function followTab(tab) {
  if (!session?.recording) return;
  // Opening this extension's full panel must not steal the monitored target.
  if (tab?.url?.startsWith(chrome.runtime.getURL(""))) return;
  const url = sanitizeUrl(tab?.url);
  if (session.tabId === tab?.id && url) {
    session.pageUrl = url;
    const existing = session.tabs.find((t) => t.id === tab.id);
    if (existing) existing.url = url;
    await publish();
    return;
  }
  await releaseCurrentTab();
  if (!url) {
    await publish();
    return;
  }
  session.tabId = tab.id;
  session.pageUrl = url;
  if (!session.tabs.some((t) => t.id === tab.id))
    session.tabs.push({ id: tab.id, url });
  else session.tabs.find((t) => t.id === tab.id).url = url;
  try {
    await synchronizeAdaptation();
    await attachSensor(tab.id);
    await contentEffector.registerTarget({ tabId: tab.id });
    if (session.notice.startsWith("Não foi possível observar esta aba"))
      session.notice = "";
  } catch {
    interruptTabRequests(session, tab.id);
    session.tabId = null;
    session.pageUrl = null;
    session.notice =
      "Não foi possível observar esta aba. Feche o DevTools ou visite outra página HTTP(S); a sessão continua ativa.";
  }
  await publish();
}
async function followActiveTab(windowId) {
  if (!session?.recording) return;
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (tab && (windowId === undefined || tab.windowId === windowId))
    await followTab(tab);
}
function automatic(operation) {
  void enqueue(operation).catch(() => {
    if (session?.recording) {
      session.notice =
        "A aba mudou antes de conectar. A captura continua disponível nas próximas abas.";
      schedulePublish();
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "monitor-panel") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  void enqueue(async () => {
    await publish();
    port.postMessage(snapshot());
  }).catch(() => ports.delete(port));
});

async function handle(message) {
  switch (message.type) {
    case "GET_STATE":
      await publish();
      return snapshot();
    case "ACKNOWLEDGE_CONSUMPTION_ALERT":
      await publish();
      await consumptionAlerts.acknowledge(message.level, message.token);
      await publish();
      return snapshot();
    case "SAVE_BUDGET":
      updateUsage();
      budgetSettings = await budgetStore.save(message.settings);
      await publish();
      return snapshot();
    case "START": {
      if (session?.recording) return snapshot();
      const tab = await chrome.tabs.get(message.tabId);
      if (!sanitizeUrl(tab.url))
        throw new Error(
          "Abra uma página HTTP(S) para iniciar a captura automática.",
        );
      updateUsage();
      const previous = session;
      session = createSession(tab);
      session.recording = true;
      try {
        await attachSensor(tab.id);
        await contentEffector.registerTarget({ tabId: tab.id });
      } catch {
        session = previous;
        throw new Error(
          "Não foi possível conectar. Feche o DevTools da aba e tente novamente.",
        );
      }
      await publish();
      return snapshot();
    }
    case "STOP": {
      if (session?.recording) {
        const tabId = session.tabId;
        stopSession(session);
        await publish();
        if (tabId !== null) {
          contentEffector.forgetTab(tabId);
          await detachSensor(tabId).catch(() => {});
        }
      }
      return snapshot();
    }
    case "RELOAD": {
      if (!session?.recording || session.tabId === null)
        throw new Error(
          "Visite uma página HTTP(S) com a captura ativa antes de recarregar.",
        );
      await chrome.tabs.reload(session.tabId);
      return snapshot();
    }
    case "CLEAR": {
      if (session?.recording)
        throw new Error("Encerre a captura antes de limpar os registros.");
      updateUsage();
      session = null;
      await publish();
      return snapshot();
    }
    default:
      throw new Error("Comando desconhecido.");
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  enqueue(() => handle(message)).then(
    (data) => respond({ ok: true, data }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});
chrome.tabs.onActivated.addListener(({ windowId }) =>
  automatic(() => followActiveTab(windowId)),
);
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE)
    automatic(() => followActiveTab(windowId));
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (
    change.mutedInfo?.muted === false &&
    session?.recording &&
    session.tabId === tabId &&
    adaptation?.playbackBlocked
  )
    automatic(publish);
  if (tab.active && (change.url || change.status === "loading"))
    automatic(async () => {
      const current = await chrome.tabs.get(tabId);
      if (current.active) await followActiveTab(current.windowId);
    });
});
chrome.debugger.onEvent.addListener((source, method, params) => {
  void ready.then(async () => {
    if (!session?.recording || source.tabId !== session.tabId) return;
    if (
      method === "Runtime.bindingCalled" &&
      params.name === PAGE_ALERT_BINDING &&
      !source.sessionId
    ) {
      if (typeof params.payload !== "string" || params.payload.length > 512)
        return;
      let acknowledgment;
      try {
        acknowledgment = JSON.parse(params.payload);
      } catch {
        return;
      }
      if (!acknowledgment || typeof acknowledgment.token !== "string") return;
      automatic(async () => {
        await publish();
        await consumptionAlerts.acknowledge(
          acknowledgment.level,
          acknowledgment.token,
        );
        await publish();
      });
      return;
    }
    if (method === "Target.attachedToTarget") {
      const child = { tabId: source.tabId, sessionId: params.sessionId };
      // Resume before evaluating the DOM: creating an isolated world in a
      // paused child can otherwise deadlock a parent navigation/refresh.
      try {
        await enableTarget(child);
      } catch {
        if (session?.recording && session.tabId === source.tabId) {
          session.notice =
            "Um contexto não pôde ser instrumentado. A cobertura é parcial.";
          schedulePublish();
        }
      } finally {
        await chrome.debugger
          .sendCommand(child, "Runtime.runIfWaitingForDebugger")
          .catch(() => {});
      }
      automatic(async () => {
        if (session?.recording && session.tabId === source.tabId)
          await contentEffector.registerTarget(child, params.targetInfo.type);
      });
      return;
    }
    if (method === "Target.detachedFromTarget") {
      contentEffector.forgetTarget({
        tabId: source.tabId,
        sessionId: params.sessionId,
      });
      return;
    }
    if (method === "Page.frameNavigated") {
      pageAlertEffector.invalidate(source.tabId);
      automatic(async () => {
        await contentEffector.refreshTarget(source);
        await publish();
      });
      return;
    }
    // Close the previous cycle before processing bytes received after midnight.
    updateUsage();
    if (
      collectEvent(
        session,
        method,
        params,
        source.sessionId ?? "root",
        source.tabId,
      )
    ) {
      updateUsage();
      schedulePublish();
    }
  });
});
chrome.debugger.onDetach.addListener((source, reason) => {
  automatic(async () => {
    if (source.tabId !== session?.tabId || !session.recording) return;
    if (reason === "target_closed") {
      await releaseCurrentTab();
      await followActiveTab();
      await publish();
    } else {
      stopSession(
        session,
        "Captura desconectada pelo Chrome. Os registros foram preservados; inicie uma nova sessão para continuar.",
      );
      await publish();
    }
  });
});
chrome.tabs.onRemoved.addListener((tabId) =>
  automatic(async () => {
    if (session?.recording && tabId === session.tabId) {
      await releaseCurrentTab();
      await followActiveTab();
      await publish();
    }
  }),
);

// Renew the page guard lease while the monitored tab is restricted.
setInterval(() => {
  if (
    session?.recording &&
    (adaptation?.playbackBlocked || consumptionAlerts.snapshot.current)
  )
    automatic(publish);
}, 2000);

// Alarms survive worker suspension. Recheck on every worker start as well.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CYCLE_ALARM) {
    scheduledBoundary = null;
    automatic(publish);
  }
});

chrome.notifications.onClicked.addListener((id) => {
  if (id !== CONSUMPTION_NOTIFICATION_ID) return;
  void (async () => {
    const url = chrome.runtime.getURL("ui/panel.html");
    const existing = (await chrome.tabs.query({})).find((tab) =>
      tab.url?.startsWith(url),
    );
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else await chrome.tabs.create({ url });
  })().catch(() => {});
});
