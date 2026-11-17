# Testar adaptação pelo ritmo (0.11.0)

1. Atualize o projeto, recarregue a extensão em `chrome://extensions` e reabra o painel. Execute `npm run demo` e abra `http://127.0.0.1:4173`.
2. Para uma demonstração controlada, configure uma franquia pequena, como **1 MB**, renovação **a cada 30 dias** e início **10 dias antes de hoje**. Mantenha a economia automática ativada. Use um perfil de teste se quiser preservar seu plano e consumo atuais; editar o orçamento não zera o acumulado existente.
3. Inicie a captura e recarregue a página. Clique no botão de Fetch/XHR da demonstração para acrescentar cerca de 100 kB por clique. Acompanhe o consumo observado: perto de 40% do total, a projeção deve superar 110% e ativar **Econômico**, antes da meta de 70%. O ponto exato varia com o horário e os recursos já carregados.
4. Confira média diária, saldo por dia e projeção no painel. O motivo e o cartão na página devem indicar **Ritmo de consumo elevado**. Imagens continuam permitidas; novos áudios/vídeos são restringidos.
5. Continue até cerca de 60% do total: a projeção deve superar 150% e ativar **Restritivo**, ainda antes de 70%. Novas imagens também são bloqueadas.
6. Encerre e inicie outra sessão: o consumo do ciclo e a adaptação pelo ritmo devem permanecer. Consulte a sessão anterior para confirmar que o histórico foi preservado.
7. Para testar a liberação mantendo o mesmo consumo abaixo de 70%, altere apenas o início para **20 dias antes de hoje**, ainda com ciclo de 30 dias. A média e a projeção devem cair e permitir Normal. Essa edição muda o calendário, sem apagar o consumo; não equivale à renovação real.
8. Configure início hoje para testar o primeiro dia: o painel informa que a análise de ritmo ainda está aguardando. Nesse intervalo só as metas absolutas de 70%/90% decidem os modos. Uma data futura suspende a adaptação até o início.

Exemplo exato: 4 GB em 10 de 30 dias projetam 12 GB (120% de um plano de 10 GB), ativando Econômico. Em 20 de 30 dias, os mesmos 4 GB projetam 6 GB (60%), permitindo Normal. 5 GB em 10 dias projetam 15 GB (150%), ativando Restritivo. Sempre prevalece a restrição mais forte entre as metas de ritmo e as de consumo acumulado.

Validação automatizada: `npm run check`, `npm test`, `npm run test:e2e`. O teste `pace-browser.js` usa Chrome com perfil temporário, bloqueia recursos antes dos 70% e verifica no servidor que não foram recebidos. Também consulta/reabre o painel, reinicia a captura sem perder consumo e avança somente o relógio do worker de teste para comprovar liberação sem reduzir bytes. O produto não expõe comandos de relógio ou simulação. Evidências em `artifacts/pace-verification.json`, `ritmo-painel.png`, `ritmo-lateral.png` e `ritmo-na-pagina.png`.
