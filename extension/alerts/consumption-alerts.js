import { ADAPTATION_POLICY } from "../knowledge/adaptation-policy.js";

export const CONSUMPTION_NOTIFICATION_ID = "navega-consumption-alert";
const levels = [
  ADAPTATION_POLICY.economyPercent,
  ADAPTATION_POLICY.restrictedPercent,
  100,
];
const bytesLabel = (value) => {
  const units = ["B", "kB", "MB", "GB"];
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index++;
  }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[index]}`;
};
export function consumptionAlert(analysis) {
  if (!analysis?.configured || analysis.cycle?.active === false) return null;
  const level = levels.findLast(
    (value) =>
      analysis.consumedBytes >= Math.ceil((analysis.totalBytes * value) / 100),
  );
  if (!level) return null;
  return {
    level,
    severity: level >= 90 ? "critical" : "warning",
    title:
      level === 100
        ? "Franquia estimada atingida"
        : level >= 90
          ? "Poucos dados restantes no ciclo"
          : "Atenção ao consumo da franquia",
    message: `${analysis.usedPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da franquia observada neste ciclo: ${bytesLabel(analysis.consumedBytes)} de ${bytesLabel(analysis.totalBytes)}. Saldo estimado: ${bytesLabel(analysis.remainingBytes)}.`,
  };
}

// The controller is called through the background mutation queue. Delivery marks
// are committed before calling the OS to avoid repeated toasts after a restart.
export function createConsumptionAlerts({ store, notifications, iconUrl }) {
  let saved = null;
  let current = null;
  let currentToken = null;
  let error = null;
  let clearKey = null;
  function base(usage) {
    const renewal = usage?.lastRenewedAt ?? null;
    return saved && saved.renewal === renewal
      ? { ...saved }
      : {
          schemaVersion: 1,
          renewal,
          token: String(renewal ?? usage.cycle.startsAt),
          notifiedLevel: 0,
          dismissedLevel: 0,
          normalDismissed: false,
          notificationError: null,
        };
  }
  async function clearNotification(key) {
    if (clearKey === key) return;
    await notifications.clear(CONSUMPTION_NOTIFICATION_ID).catch(() => {});
    clearKey = key;
  }
  return {
    async load() {
      saved = await store.load();
    },
    get snapshot() {
      return {
        current,
        normalVisible: !saved?.normalDismissed,
        visible: Boolean(
          current &&
          current.level >
            (saved?.token === currentToken ? saved.dismissedLevel : 0),
        ),
        token: currentToken,
        error: error ?? saved?.notificationError ?? null,
      };
    },
    async synchronize(analysis, usage, settings, canPersist = true) {
      current = consumptionAlert(analysis);
      if (!usage) return;
      const next = base(usage);
      currentToken = next.token;
      const notify = Boolean(
        settings.notificationsEnabled &&
        current &&
        current.level > Math.max(next.notifiedLevel, next.dismissedLevel),
      );
      if (notify) {
        // Crossing multiple thresholds at once emits only the highest alert.
        next.notifiedLevel = current.level;
        next.notificationError = null;
      }
      if (!settings.notificationsEnabled || !current)
        next.notificationError = null;
      if (!canPersist) return;
      try {
        if (JSON.stringify(next) !== JSON.stringify(saved))
          await store.save(next);
        saved = next;
        error = null;
      } catch {
        error =
          "Não foi possível salvar os avisos de consumo. A notificação no computador não foi enviada; o aviso continua disponível no painel.";
        return;
      }
      if (
        !current ||
        !settings.notificationsEnabled ||
        current.level <= saved.dismissedLevel
      ) {
        await clearNotification(
          `${saved.token}/${current?.level ?? 0}/${settings.notificationsEnabled}/${saved.dismissedLevel}`,
        );
      }
      if (!notify) return;
      clearKey = null;
      try {
        if ((await notifications.getPermissionLevel()) !== "granted")
          throw new Error("notifications denied");
        await notifications.create(CONSUMPTION_NOTIFICATION_ID, {
          type: "basic",
          iconUrl,
          title: `Navega · ${current.title}`,
          message: current.message,
          priority: 0,
        });
      } catch {
        saved = {
          ...saved,
          notificationError:
            "A notificação no computador não pôde ser exibida. O aviso de consumo continua disponível neste painel.",
        };
        await store.save(saved).catch(() => {});
      }
    },
    async acknowledge(level, token) {
      if (
        level === 0 &&
        saved &&
        token === currentToken &&
        token === saved.token &&
        !current
      ) {
        const next = { ...saved, normalDismissed: true };
        await store.save(next);
        saved = next;
        return;
      }
      if (
        !saved ||
        token !== currentToken ||
        token !== saved.token ||
        !levels.includes(level) ||
        !current ||
        level > current.level
      )
        return;
      const next = {
        ...saved,
        dismissedLevel: Math.max(saved.dismissedLevel, level),
      };
      await store.save(next);
      saved = next;
      if (level >= current.level)
        await clearNotification(`${token}/ack/${level}`);
    },
  };
}
