// Only observation commands. No Fetch interception, DOM injection or blocking rules.
const AUTO_ATTACH = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: true,
  filter: [
    { type: "iframe", exclude: false },
    { type: "worker", exclude: false },
    { exclude: true },
  ],
};

export async function enableTarget(debuggee) {
  await chrome.debugger.sendCommand(debuggee, "Network.enable");
  await chrome.debugger.sendCommand(
    debuggee,
    "Target.setAutoAttach",
    AUTO_ATTACH,
  );
}

export async function attachSensor(tabId) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await enableTarget({ tabId });
  } catch (error) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
    throw error;
  }
}

export async function detachSensor(tabId) {
  await chrome.debugger.detach({ tabId });
}
