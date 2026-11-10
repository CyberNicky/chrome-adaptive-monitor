const KEY = "monitorSession";

export const sessionStore = {
  async load() {
    return (await chrome.storage.session.get(KEY))[KEY] ?? null;
  },
  async save(session) {
    await chrome.storage.session.set({ [KEY]: session });
  },
};
