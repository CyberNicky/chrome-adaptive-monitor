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
      : analysis.cycle?.active === false
        ? "A franquia ainda não começou. A contagem e os modos serão ativados na data de início."
        : !analysis.enabled
          ? "Economia automática desativada nas configurações."
          : !session?.recording
            ? "Inicie a captura para ativar a adaptação."
            : !active
              ? "Aguardando uma aba HTTP(S)."
              : mode === "restricted"
                ? "Meta de preservação atingida: imagens ocultas e reprodução de áudio e vídeo interrompida. Novos downloads também são bloqueados."
                : mode === "economy"
                  ? "Meta de economia atingida: reprodução de áudio e vídeo interrompida e novos downloads bloqueados. Texto e imagens continuam permitidos."
                  : "Consumo dentro da meta do sistema: recursos permitidos.",
  };
}
