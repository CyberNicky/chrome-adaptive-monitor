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
  let exhaustionScreen = null;
  const coveredBodies = new Set();
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
  function clearExhaustionScreen() {
    exhaustionScreen?.remove();
    exhaustionScreen = null;
    for (const body of coveredBodies) restore(body);
    coveredBodies.clear();
  }
  function showExhaustionScreen() {
    if (document.body) {
      coveredBodies.add(document.body);
      hide(document.body);
    }
    // The main frame owns the explanation; child frames only hide their content.
    if (window !== window.top || !document.documentElement) return;
    if (!exhaustionScreen) {
      exhaustionScreen = document.createElement("navega-budget-exhausted");
      for (const [name, value] of Object.entries({
        all: "initial", position: "fixed", inset: "0", display: "block",
        visibility: "visible", "z-index": "2147483647",
        background: "#fff7f3", "pointer-events": "auto",
      })) exhaustionScreen.style.setProperty(name, value, "important");
      const root = exhaustionScreen.attachShadow({ mode: "open" });
      const style = new CSSStyleSheet();
      style.replaceSync(`
        :host{color-scheme:light}
        dialog{box-sizing:border-box;position:fixed;inset:0;margin:0;
          width:100vw;height:100dvh;max-width:none;max-height:none;border:0;outline:0;
          padding:32px;background:#fff7f3;color:#632d21;overflow:auto;
          font:16px/1.6 system-ui,sans-serif}
        dialog::backdrop{background:#fff7f3}
        section{max-width:560px;margin:15vh auto}
        small{font-weight:750;letter-spacing:.08em}
        h1{font-size:clamp(28px,6vw,40px);line-height:1.2;margin:20px 0}
        p{margin:16px 0}
      `);
      root.adoptedStyleSheets = [style];
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-labelledby", "exhausted-title");
      dialog.addEventListener("cancel", (event) => event.preventDefault());
      const section = document.createElement("section");
      const brand = document.createElement("small");
      brand.textContent = "NAVEGA · SALDO ESTIMADO ZERO";
      const title = document.createElement("h1");
      title.id = "exhausted-title";
      title.textContent = "Franquia estimada esgotada";
      const message = document.createElement("p");
      message.textContent = "O conteúdo desta página foi ocultado e novos carregamentos foram bloqueados para preservar seus dados, incluindo texto, imagens, áudio e vídeo.";
      const guidance = document.createElement("p");
      guidance.textContent = "Abra o painel do Navega pelo ícone da extensão para consultar o consumo e a renovação ou ajustar sua franquia. Esta tela é gerada localmente pela extensão.";
      section.append(brand, title, message, guidance);
      dialog.append(section);
      root.append(dialog);
      document.exitFullscreen?.().catch(() => {});
    }
    if (!exhaustionScreen.isConnected)
      document.documentElement.append(exhaustionScreen);
    const dialog = exhaustionScreen.shadowRoot.querySelector("dialog");
    if (!dialog.open) dialog.showModal();
  }
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
      if (current === "exhausted") showExhaustionScreen();
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
      if (next !== "exhausted") clearExhaustionScreen();
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
