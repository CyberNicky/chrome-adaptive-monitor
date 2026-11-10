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

let session = null;
let timer;
let mutation = Promise.resolve();
const ports = new Set();
const ready = sessionStore.load().then(async (saved) => {
  session = saved;
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
    } catch {
      session.tabId = null;
      session.pageUrl = null;
      interruptTabRequests(session);
    }
  }
});

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
  if (!session) return { session: null, metrics: aggregateMetrics(null) };
  const { active, ...publicSession } = session;
  return { session: publicSession, metrics: aggregateMetrics(session) };
}
async function publish() {
  clearTimeout(timer);
  timer = null;
  try {
    await sessionStore.save(session);
  } catch {
    if (session)
      session.notice =
        "Não foi possível salvar a sessão. Exporte os registros disponíveis.";
  }
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
      void publish();
    }, 250);
}

async function releaseCurrentTab() {
  const tabId = session.tabId;
  // Clear the target before detach so intentional detach cannot end the session.
  session.tabId = null;
  session.pageUrl = null;
  if (tabId !== null) {
    interruptTabRequests(session, tabId);
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
    await attachSensor(tab.id);
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
  void ready
    .then(() => port.postMessage(snapshot()))
    .catch(() => ports.delete(port));
});

async function handle(message) {
  switch (message.type) {
    case "GET_STATE":
      return snapshot();
    case "START": {
      if (session?.recording) return snapshot();
      const tab = await chrome.tabs.get(message.tabId);
      if (!sanitizeUrl(tab.url))
        throw new Error(
          "Abra uma página HTTP(S) para iniciar a captura automática.",
        );
      const previous = session;
      session = createSession(tab);
      session.recording = true;
      try {
        await attachSensor(tab.id);
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
        if (tabId !== null) await detachSensor(tabId).catch(() => {});
        await publish();
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
  if (tab.active && (change.url || change.status === "loading"))
    automatic(async () => {
      const current = await chrome.tabs.get(tabId);
      if (current.active) await followActiveTab(current.windowId);
    });
});
chrome.debugger.onEvent.addListener((source, method, params) => {
  void ready.then(async () => {
    if (!session?.recording || source.tabId !== session.tabId) return;
    if (method === "Target.attachedToTarget") {
      const current = session;
      const child = { tabId: source.tabId, sessionId: params.sessionId };
      try {
        await enableTarget(child);
      } catch {
        if (
          session === current &&
          session.recording &&
          session.tabId === source.tabId
        ) {
          session.notice =
            "Um iframe ou worker não pôde ser instrumentado. A cobertura é parcial.";
          schedulePublish();
        }
      } finally {
        await chrome.debugger
          .sendCommand(child, "Runtime.runIfWaitingForDebugger")
          .catch(() => {});
      }
      return;
    }
    if (
      collectEvent(
        session,
        method,
        params,
        source.sessionId ?? "root",
        source.tabId,
      )
    )
      schedulePublish();
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
