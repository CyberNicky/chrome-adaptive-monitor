import { localDate, parseDate } from "./billing-cycle.js";

const KEY = "dataBudgetSettings";

export const BUDGET_UNITS = ["MB", "GB"];

export function createBudgetSettings(value, now = Date.now()) {
  const planName =
    typeof value?.planName === "string" ? value.planName.trim() : "";
  const dataAmount = Number(value?.dataAmount);
  const dataUnit = value?.dataUnit;

  if (!planName) throw new Error("Informe o nome do plano.");
  if (planName.length > 80)
    throw new Error("O nome do plano deve ter no máximo 80 caracteres.");
  if (!Number.isFinite(dataAmount) || dataAmount <= 0)
    throw new Error("Informe uma franquia de dados maior que zero.");
  if (!BUDGET_UNITS.includes(dataUnit))
    throw new Error("Selecione uma unidade válida para a franquia.");
  const totalBytes = Math.round(dataAmount * (dataUnit === "GB" ? 1e9 : 1e6));
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 1)
    throw new Error(
      "A franquia deve representar uma quantidade válida de bytes.",
    );
  const cycleStartDate = value?.cycleStartDate ?? localDate(now);
  parseDate(cycleStartDate);
  const cycleType = value?.cycleType ?? "monthly";
  if (!["monthly", "days"].includes(cycleType))
    throw new Error("Selecione um período mensal ou por dias.");
  const cycleDays = cycleType === "days" ? Number(value?.cycleDays) : null;
  if (
    cycleType === "days" &&
    (!Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > 366)
  )
    throw new Error("A duração deve ser um número inteiro entre 1 e 366 dias.");
  return {
    schemaVersion: 4,
    planName,
    dataAmount,
    dataUnit,
    cycleStartDate,
    cycleType,
    cycleDays,
    adaptiveEnabled: value?.adaptiveEnabled !== false,
    updatedAt: now,
  };
}

export const budgetStore = {
  async load() {
    const saved = (await chrome.storage.local.get(KEY))[KEY];
    if (!saved) return null;
    try {
      const normalized = createBudgetSettings(
        { cycleStartDate: localDate(), ...saved },
        saved.updatedAt,
      );
      if (saved.schemaVersion !== 4)
        await chrome.storage.local.set({ [KEY]: normalized });
      return normalized;
    } catch {
      return null;
    }
  },

  async save(value) {
    const settings = createBudgetSettings(value);
    await chrome.storage.local.set({ [KEY]: settings });
    return settings;
  },
};
