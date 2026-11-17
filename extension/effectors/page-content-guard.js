// Runs in a dedicated isolated world. It does not patch the site's JavaScript.
export function installContentGuard(mode) {
  const key = "__navegaContentGuardV1";
  if (globalThis[key]) {
    globalThis[key].setMode(mode);
    return;
  }
  if (mode === "normal") return;

  const media = new Map();
  const hidden = new Map();
  const roots = new Map();
  const pause = HTMLMediaElement.prototype.pause;
  let current = mode;
  let expiresAt = Date.now() + 6000;
  let scanning = false;
  const hide = (element) => {
    if (!hidden.has(element))
      hidden.set(element, {
        value: element.style.getPropertyValue("visibility"),
        priority: element.style.getPropertyPriority("visibility"),
      });
    element.style.setProperty("visibility", "hidden", "important");
  };
  const restore = (element) => {
    const previous = hidden.get(element);
    if (!previous) return;
    if (
      element.style.getPropertyValue("visibility") === "hidden" &&
      element.style.getPropertyPriority("visibility") === "important"
    ) {
      if (previous.value)
        element.style.setProperty(
          "visibility",
          previous.value,
          previous.priority,
        );
      else element.style.removeProperty("visibility");
    }
    hidden.delete(element);
  };
  const blockMedia = (element) => {
    if (!(element instanceof HTMLMediaElement)) return;
    if (!media.has(element)) media.set(element, { muted: element.muted });
    if (!element.muted) element.muted = true;
    if (!element.paused) pause.call(element);
    hide(element);
  };
  const guardEvent = (event) => {
    if (Date.now() > expiresAt) globalThis[key]?.setMode("normal");
    if (current !== "normal") blockMedia(event.target);
  };
  const events = ["play", "playing", "volumechange", "loadedmetadata"];
  function watch(root) {
    if (roots.has(root)) return;
    for (const event of events) root.addEventListener(event, guardEvent, true);
    const observer = new MutationObserver(scan);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "autoplay"],
    });
    roots.set(root, observer);
  }
  function scan(discoverShadows = true) {
    if (scanning || current === "normal") return;
    scanning = true;
    try {
      watch(document);
      for (const root of roots.keys()) {
        for (const element of root.querySelectorAll("audio, video"))
          blockMedia(element);
        if (current === "restricted")
          for (const element of root.querySelectorAll(
            'img, picture, svg, input[type="image"]',
          ))
            hide(element);
        if (discoverShadows)
          for (const element of root.querySelectorAll("*"))
            if (element.shadowRoot) watch(element.shadowRoot);
      }
      // Release detached elements instead of retaining an unbounded page history.
      for (const element of media.keys())
        if (!element.isConnected) {
          restore(element);
          element.muted = media.get(element).muted;
          media.delete(element);
        }
      for (const element of hidden.keys())
        if (!element.isConnected) restore(element);
      for (const [root, observer] of roots)
        if (root.host && !root.host.isConnected) {
          observer.disconnect();
          for (const event of events)
            root.removeEventListener(event, guardEvent, true);
          roots.delete(root);
        }
    } finally {
      scanning = false;
    }
  }
  let tick = 0;
  // A lease prevents permanent page changes after the extension is reloaded/detached.
  const timer = setInterval(() => {
    if (Date.now() > expiresAt) globalThis[key]?.setMode("normal");
    else scan(++tick % 4 === 0);
  }, 500);
  globalThis[key] = {
    setMode(next) {
      current = next;
      expiresAt = Date.now() + 6000;
      if (next === "normal") {
        clearInterval(timer);
        for (const [root, observer] of roots) {
          observer.disconnect();
          for (const event of events)
            root.removeEventListener(event, guardEvent, true);
        }
        for (const element of hidden.keys()) restore(element);
        for (const [element, previous] of media) element.muted = previous.muted;
        media.clear();
        roots.clear();
        delete globalThis[key];
        // Restoring the mode never starts playback automatically.
      } else {
        if (next === "economy")
          for (const element of hidden.keys())
            if (!(element instanceof HTMLMediaElement)) restore(element);
        scan();
      }
    },
  };
  scan();
}
