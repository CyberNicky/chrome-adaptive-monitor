import {
  collectEvent,
  createSession,
  stopSession,
} from "./monitoring/request-collector.js";
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
  if (session?.recording) {
    try {
      await chrome.debugger.sendCommand(
        { tabId: session.tabId },
        "Network.enable",
      );
    } catch {
      stopSession(
        session,
        "A conexão anterior não está mais ativa. Inicie uma nova sessão para continuar.",
      );
      await sessionStore.save(session);
    }
  }
});

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
        "Não foi possível salvar a sessão na memória do navegador. Exporte os registros disponíveis.";
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
    .setBadgeText({ text: session?.recording ? "ON" : "" })
    .catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: "#147a69" }).catch(() => {});
}

function schedulePublish() {
  if (!timer)
    timer = setTimeout(() => {
      void publish();
    }, 250);
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
  await ready;
  switch (message.type) {
    case "GET_STATE":
      return snapshot();
    case "START": {
      if (session?.recording)
        throw new Error("Encerre a captura atual antes de iniciar outra.");
      const tab = await chrome.tabs.get(message.tabId);
      if (!/^https?:\/\//.test(tab.url ?? ""))
        throw new Error(
          "Escolha uma página HTTP ou HTTPS. Páginas internas do Chrome não podem ser monitoradas.",
        );
      const previous = session;
      // The session exists before Network.enable starts emitting events.
      session = createSession(tab);
      session.recording = true;
      try {
        await attachSensor(tab.id);
      } catch {
        session = previous;
        throw new Error(
          "Não foi possível conectar à aba. Feche o DevTools dessa aba e tente novamente. Páginas protegidas podem impedir a captura.",
        );
      }
      await publish();
      return snapshot();
    }
    case "STOP": {
      if (session?.recording) {
        const tabId = session.tabId;
        stopSession(session);
        await detachSensor(tabId).catch(() => {});
        await publish();
      }
      return snapshot();
    }
    case "RELOAD": {
      if (!session?.recording)
        throw new Error("Inicie o monitoramento antes de recarregar.");
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
  mutation = mutation.catch(() => {}).then(() => handle(message));
  mutation.then(
    (data) => respond({ ok: true, data }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  void ready.then(async () => {
    if (!session?.recording || source.tabId !== session.tabId) return;
    if (method === "Target.attachedToTarget") {
      const child = { tabId: source.tabId, sessionId: params.sessionId };
      try {
        await enableTarget(child);
      } catch {
        session.notice =
          "Um iframe ou worker não pôde ser instrumentado. A cobertura dessa sessão é parcial.";
        schedulePublish();
      } finally {
        await chrome.debugger
          .sendCommand(child, "Runtime.runIfWaitingForDebugger")
          .catch(() => {});
      }
      return;
    }
    if (collectEvent(session, method, params, source.sessionId ?? "root"))
      schedulePublish();
  });
});

chrome.debugger.onDetach.addListener((source) => {
  void ready.then(async () => {
    if (source.tabId === session?.tabId && session.recording) {
      stopSession(
        session,
        "Captura desconectada pelo Chrome. Os registros foram preservados; inicie uma nova sessão para continuar.",
      );
      await publish();
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void ready.then(async () => {
    if (tabId === session?.tabId && session.recording) {
      stopSession(
        session,
        "A aba monitorada foi fechada. Os registros foram preservados.",
      );
      await publish();
    }
  });
});
