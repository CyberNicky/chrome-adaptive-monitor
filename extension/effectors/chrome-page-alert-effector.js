import { renderPageConsumptionAlert } from "./page-consumption-alert.js";

export const PAGE_ALERT_BINDING = "__navegaAcknowledgeConsumption";
const WORLD = "navega-consumption-alert";
export function createPageAlertEffector({ sendCommand }) {
  let activeTab = null;
  let lastPayload = null;
  let renewedAt = 0;
  let error = null;
  const bound = new Set();
  async function evaluate(tabId, payload) {
    const source = { tabId };
    if (payload && !bound.has(tabId)) {
      await sendCommand(source, "Runtime.enable");
      await sendCommand(source, "Runtime.addBinding", {
        name: PAGE_ALERT_BINDING,
        executionContextName: WORLD,
      });
      bound.add(tabId);
    }
    const { frameTree } = await sendCommand(source, "Page.getFrameTree");
    const world = await sendCommand(source, "Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: WORLD,
    });
    const result = await sendCommand(source, "Runtime.evaluate", {
      expression: `(${renderPageConsumptionAlert.toString()})(${JSON.stringify(payload)})`,
      contextId: world.executionContextId,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error("page alert rejected");
  }
  async function clear(tabId = activeTab) {
    if (tabId === null) return;
    try {
      await evaluate(tabId, null);
    } catch {
      /* The lease clears a detached page. */
    }
    if (bound.has(tabId))
      await sendCommand({ tabId }, "Runtime.removeBinding", {
        name: PAGE_ALERT_BINDING,
      }).catch(() => {});
    bound.delete(tabId);
    if (activeTab === tabId) {
      activeTab = null;
      lastPayload = null;
    }
  }
  return {
    get error() {
      return error;
    },
    clear,
    invalidate(tabId) {
      if (tabId === activeTab) lastPayload = null;
    },
    async apply(tabId, alert, analysis) {
      const target = tabId ?? null;
      if (activeTab !== null && activeTab !== target) await clear();
      if (target === null) {
        error = null;
        return;
      }
      const mode = analysis.mode ?? "normal";
      const modeLabel = {
        normal: "Normal",
        economy: "Econômico",
        restricted: "Restritivo",
      }[mode];
      const percentLabel = analysis.usedPercent.toLocaleString("pt-BR", {
        maximumFractionDigits: 1,
      });
      const formatBytes = (value) => {
        const units = ["B", "kB", "MB", "GB"];
        let index = 0;
        while (value >= 1000 && index < units.length - 1) {
          value /= 1000;
          index++;
        }
        return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[index]}`;
      };
      const payload = {
        ...alert,
        current: alert?.current ?? {
          level: 0,
          title: `Modo ${modeLabel} · monitoramento ativo`,
          message: analysis.configured
            ? `${percentLabel}% da franquia observada neste ciclo: ${formatBytes(analysis.consumedBytes)} de ${formatBytes(analysis.totalBytes)}. Saldo estimado: ${formatBytes(analysis.remainingBytes)}.`
            : "Captura de recursos ativa. Configure a franquia no Navega para acompanhar o consumo do seu plano.",
        },
        visible: alert?.current
          ? alert.visible
          : (alert?.normalVisible ?? true),
        token: alert?.token ?? "monitoring",
        mode,
        modeLabel,
        percentLabel: analysis.usedPercent.toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
        }),
      };
      const serialized = JSON.stringify(payload);
      if (
        activeTab === target &&
        serialized === lastPayload &&
        Date.now() - renewedAt < 1800
      )
        return;
      activeTab = target;
      try {
        await evaluate(target, payload);
        lastPayload = serialized;
        renewedAt = Date.now();
        error = null;
      } catch {
        bound.delete(target);
        error =
          "O aviso sobre a página não pôde ser exibido. O consumo permanece disponível no painel do Navega.";
      }
    },
  };
}
