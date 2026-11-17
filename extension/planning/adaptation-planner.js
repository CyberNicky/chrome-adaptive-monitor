export function planAdaptation(analysis, session) {
  const active = Boolean(session?.recording && session.tabId !== null);
  const mode =
    active && analysis.enabled
      ? analysis.need === "restrict"
        ? "restricted"
        : analysis.need === "save"
          ? "economy"
          : "normal"
      : "normal";
  return {
    mode,
    tabId: active ? session.tabId : null,
    reason: !analysis.configured
      ? "Configure o orçamento para ativar a economia automática."
      : !analysis.enabled
        ? "Economia automática desativada nas configurações."
        : !session?.recording
          ? "Inicie a captura para ativar a adaptação."
          : !active
            ? "Aguardando uma aba HTTP(S)."
            : mode === "restricted"
              ? "Limite Y atingido: novas imagens, áudios e vídeos serão bloqueados."
              : mode === "economy"
                ? "Limite X atingido: novos áudios e vídeos serão bloqueados. Texto e imagens continuam permitidos."
                : "Consumo abaixo do limite X: recursos permitidos.",
  };
}
