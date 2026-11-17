// Self-contained: serialized into the main frame's isolated CDP world.
export function renderPageConsumptionAlert(payload) {
  const key = "__navegaPageAlertV1";
  if (!payload?.current) {
    globalThis[key]?.destroy();
    return;
  }
  if (globalThis[key]) {
    globalThis[key].update(payload);
    return;
  }
  const host = document.createElement("navega-consumption-alert");
  for (const [name, value] of Object.entries({
    all: "initial",
    position: "fixed",
    right: "16px",
    bottom: "20px",
    "z-index": "2147483647",
    width: "min(440px, calc(100vw - 32px))",
    visibility: "visible",
    display: "block",
    "pointer-events": "auto",
  }))
    host.style.setProperty(name, value, "important");
  const root = host.attachShadow({ mode: "open" });
  const css = new CSSStyleSheet();
  css.replaceSync(`
    :host{font:14px/1.5 system-ui,sans-serif;color:#183d33;color-scheme:light}
    *{box-sizing:border-box} [hidden]{display:none!important}
    .card{font:16px/1.5 system-ui,sans-serif;color:#145b47;padding:22px;border:2px solid #39967a;border-left-width:6px;border-radius:14px;background:#edf8f2;box-shadow:0 12px 40px #142b2240;max-height:calc(100dvh - 40px);overflow:auto}
    .card.economy{background:#fff8e5;border-color:#d5a944;color:#6e4c0c}
    .card.critical{background:#fff1ed;border-color:#c95b4b;color:#8e3026}
    .heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .brand{font-weight:750;font-size:12px;letter-spacing:.06em}
    h2{font:750 20px/1.4 system-ui,sans-serif;margin:12px 0 10px}
    p{margin:0;font-size:15px}
    button{font:600 13px/1.5 system-ui,sans-serif;cursor:pointer;border:1px solid #bfd7cb;background:#fff;color:#183d33;border-radius:8px;padding:7px 12px}
    button:focus-visible{outline:3px solid #167c69;outline-offset:3px}
    .close{font-size:24px;line-height:1;padding:8px 10px;border-color:transparent;background:transparent;color:inherit}
    .chip{display:block;margin-left:auto;font-size:15px;font-weight:750;padding:12px 18px;min-height:48px;box-shadow:0 8px 24px #142b2240;border:2px solid #39967a;background:#edf8f2;color:#145b47;max-width:100%;white-space:normal;text-align:left}
    .chip.economy{background:#fff8e5;border-color:#d5a944;color:#6e4c0c}
    .chip.critical{background:#fff1ed;border-color:#c95b4b;color:#8e3026}
  `);
  root.adoptedStyleSheets = [css];
  const card = document.createElement("aside");
  card.className = "card";
  card.setAttribute("aria-label", "Aviso de consumo do Navega");
  const heading = document.createElement("div");
  heading.className = "heading";
  const brand = document.createElement("span");
  brand.className = "brand";
  brand.textContent = "NAVEGA · CONSUMO DO CICLO";
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Recolher aviso de consumo");
  const title = document.createElement("h2");
  const message = document.createElement("p");
  const announcement = document.createElement("div");
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  heading.append(brand, close);
  announcement.append(title, message);
  card.append(heading, announcement);
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.type = "button";
  root.append(card, chip);
  let data;
  let identity;
  let expandedOverride = null;
  let expiresAt;
  function paint() {
    const expanded = expandedOverride ?? data.visible;
    card.hidden = !expanded;
    chip.hidden = expanded;
    host.dataset.level = String(data.current.level);
    host.dataset.expanded = String(expanded);
    host.dataset.mode = data.mode;
    brand.textContent = `NAVEGA · MODO ${data.modeLabel.toLocaleUpperCase("pt-BR")}`;
    const critical = data.mode === "restricted";
    card.classList.toggle("economy", data.mode === "economy");
    chip.classList.toggle("economy", data.mode === "economy");
    card.classList.toggle("critical", critical);
    chip.classList.toggle("critical", critical);
    // Do not mutate unchanged live-region text on every lease renewal.
    if (title.textContent !== data.current.title)
      title.textContent = data.current.title;
    if (message.textContent !== data.current.message)
      message.textContent = data.current.message;
    chip.textContent = `Navega · ${data.modeLabel} · ${data.percentLabel}% da franquia`;
    chip.setAttribute(
      "aria-label",
      `Abrir aviso de consumo: ${data.percentLabel}% da franquia`,
    );
    if (!host.isConnected) document.documentElement?.append(host);
  }
  close.addEventListener("click", () => {
    expandedOverride = false;
    paint();
    try {
      globalThis.__navegaAcknowledgeConsumption(
        JSON.stringify({ level: data.current.level, token: data.token }),
      );
    } catch {
      expandedOverride = null;
      paint();
    }
  });
  chip.addEventListener("click", () => {
    expandedOverride = true;
    paint();
  });
  const timer = setInterval(() => {
    if (Date.now() > expiresAt) globalThis[key]?.destroy();
  }, 500);
  globalThis[key] = {
    update(next) {
      const nextIdentity = `${next.token}/${next.current.level}/${next.mode}`;
      if (identity !== nextIdentity) expandedOverride = null;
      identity = nextIdentity;
      data = next;
      expiresAt = Date.now() + 6000;
      paint();
    },
    destroy() {
      clearInterval(timer);
      host.remove();
      delete globalThis[key];
    },
  };
  globalThis[key].update(payload);
}
