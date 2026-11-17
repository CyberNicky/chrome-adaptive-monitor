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
  const economyPercent = Number(value?.economyPercent ?? 70);
  const restrictedPercent = Number(value?.restrictedPercent ?? 90);
  if (
    !Number.isFinite(economyPercent) ||
    !Number.isFinite(restrictedPercent) ||
    economyPercent <= 0 ||
    economyPercent >= restrictedPercent ||
    restrictedPercent > 100
  )
    throw new Error("Defina limites válidos: 0 < X < Y ≤ 100%.");

  return {
    schemaVersion: 2,
    planName,
    dataAmount,
    dataUnit,
    economyPercent,
    restrictedPercent,
    adaptiveEnabled: value?.adaptiveEnabled !== false,
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
