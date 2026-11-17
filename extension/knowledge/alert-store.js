const KEY = "consumptionAlertState";
export const alertStore = {
  async load() {
    return (await chrome.storage.local.get(KEY))[KEY] ?? null;
  },
  async save(state) {
    await chrome.storage.local.set({ [KEY]: state });
  },
};
