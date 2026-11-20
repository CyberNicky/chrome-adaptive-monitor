import { installContentGuard } from "./page-content-guard.js";

const WORLD = "navega-content-guard";
const guardMode = (plan) => plan.exhausted ? "exhausted" : plan.mode;
const key = (target) => `${target.tabId}:${target.sessionId ?? "root"}`;

export function createContentEffector({ sendCommand, tabs, runtimeId }) {
  const targets = new Map();
  let desired = { mode: "normal", tabId: null };
  let mutedTab = null;
  const expression = (mode) =>
    `(${installContentGuard.toString()})(${JSON.stringify(mode)})`;

  async function updateTarget(target, mode, refresh = false) {
    const sameMode = target.mode === mode;
    if (
      !refresh &&
      sameMode &&
      (mode === "normal" || Date.now() - (target.renewedAt ?? 0) < 1800)
    )
      return;
    if (mode === "normal" && !target.scriptId && target.mode === "normal")
      return;
    if (target.scriptId && (!sameMode || refresh)) {
      await sendCommand(
        target.source,
        "Page.removeScriptToEvaluateOnNewDocument",
        { identifier: target.scriptId },
      );
      target.scriptId = null;
    }
    if (mode !== "normal" && !target.scriptId) {
      const script = await sendCommand(
        target.source,
        "Page.addScriptToEvaluateOnNewDocument",
        { source: expression(mode), worldName: WORLD },
      );
      target.scriptId = script.identifier;
    }
    if (mode === "exhausted" && !target.source.sessionId && (!sameMode || refresh))
      await sendCommand(target.source, "Page.stopLoading");
    const { frameTree } = await sendCommand(target.source, "Page.getFrameTree");
    async function applyFrame(tree, root = false) {
      try {
        const world = await sendCommand(
          target.source,
          "Page.createIsolatedWorld",
          { frameId: tree.frame.id, worldName: WORLD },
        );
        const result = await sendCommand(target.source, "Runtime.evaluate", {
          expression: expression(mode),
          contextId: world.executionContextId,
          returnByValue: true,
        });
        if (result.exceptionDetails)
          throw new Error(
            "Não foi possível controlar a reprodução nesta página.",
          );
      } catch (error) {
        // OOPIFs have their own target and are configured separately.
        if (root) throw error;
      }
      for (const child of tree.childFrames ?? []) await applyFrame(child);
    }
    await applyFrame(frameTree, true);
    target.mode = mode;
    target.renewedAt = Date.now();
  }

  async function restoreMute() {
    if (!mutedTab) return;
    const previous = mutedTab;
    const tab = await tabs.get(previous.id).catch(() => null);
    if (
      previous.changed &&
      tab?.mutedInfo?.muted &&
      tab.mutedInfo.reason === "extension" &&
      tab.mutedInfo.extensionId === runtimeId
    ) {
      await tabs.update(previous.id, { muted: previous.wasMuted });
    }
    mutedTab = null;
  }

  return {
    async recover(blockedTab = null) {
      for (const tab of await tabs.query({})) {
        if (
          tab.mutedInfo?.muted &&
          tab.mutedInfo.reason === "extension" &&
          tab.mutedInfo.extensionId === runtimeId
        ) {
          if (tab.id === blockedTab)
            mutedTab = { id: tab.id, wasMuted: false, changed: true };
          else await tabs.update(tab.id, { muted: false });
        }
      }
    },
    async registerTarget(source, type = "page") {
      if (!["page", "iframe"].includes(type) || targets.has(key(source)))
        return;
      const target = { source, mode: "normal", scriptId: null };
      targets.set(key(source), target);
      await sendCommand(source, "Page.enable");
      await updateTarget(
        target,
        source.tabId === desired.tabId ? guardMode(desired) : "normal",
      );
    },
    forgetTarget(source) {
      targets.delete(key(source));
    },
    async refreshTarget(source) {
      const target = targets.get(key(source));
      if (target)
        await updateTarget(
          target,
          source.tabId === desired.tabId ? guardMode(desired) : "normal",
          true,
        );
    },
    async apply(plan) {
      desired = plan;
      const blockedTab = plan.mode === "normal" ? null : plan.tabId;
      // Tab muting also silences Web Audio and players outside ordinary media elements.
      if (blockedTab !== null) {
        if (mutedTab && mutedTab.id !== blockedTab) await restoreMute();
        const tab = await tabs.get(blockedTab);
        if (!mutedTab)
          mutedTab = {
            id: blockedTab,
            wasMuted: Boolean(tab.mutedInfo?.muted),
            changed: false,
          };
        if (!tab.mutedInfo?.muted) {
          await tabs.update(blockedTab, { muted: true });
          mutedTab.changed = true;
        }
      }
      try {
        for (const [id, target] of targets) {
          const tab = await tabs.get(target.source.tabId).catch(() => null);
          if (!tab) {
            targets.delete(id);
            continue;
          }
          await updateTarget(
            target,
            target.source.tabId === blockedTab ? guardMode(plan) : "normal",
          );
        }
      } finally {
        if (blockedTab === null) await restoreMute();
      }
      return {
        playbackBlocked: blockedTab !== null,
        imagesHidden: plan.mode === "restricted" && blockedTab !== null,
        contentHidden: Boolean(plan.exhausted && blockedTab !== null),
      };
    },
    forgetTab(tabId) {
      for (const [id, target] of targets)
        if (target.source.tabId === tabId) targets.delete(id);
    },
  };
}
