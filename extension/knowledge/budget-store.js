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

  return {
    schemaVersion: 2,
    planName,
    dataAmount,
    dataUnit,
    updatedAt: now,
  };
}

export const budgetStore = {
  async load() {
    const saved = (await chrome.storage.local.get(KEY))[KEY];
    if (!saved) return null;
    try {
      return createBudgetSettings(saved, saved.updatedAt);
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
