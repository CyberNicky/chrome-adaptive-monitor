# Testar bloqueio com saldo zero (0.12.1)

1. Atualize o projeto, recarregue a extensão em `chrome://extensions` e reabra o painel.
2. Execute `npm run demo` e abra `http://127.0.0.1:4173`. Para um cenário controlado, use um perfil Chrome separado se quiser preservar seu plano/consumo atual. Editar o plano ou iniciar outra captura não zera o acumulado.
3. Configure **1 MB**, data inicial **hoje** e economia automática ativada. Inicie a captura e recarregue a página.
4. Use **Consumir 100 kB de teste**, aguardando a atualização entre cliques. Em 70%, entra em Econômico; em 90%, Restritivo. Até antes de 100%, texto/HTML/CSS/scripts/APIs continuam permitidos.
5. Continue até atingir 100%. A página deve permanecer no mesmo endereço, com o texto já recebido visível e sem modal/tela de bloqueio. O painel deve mostrar **Franquia esgotada**, saldo zero e a nova justificativa. O cartão de consumo continua no canto inferior direito. Novas buscas de texto via rede devem falhar.
6. Recarregue ou navegue para outro endereço na mesma aba. O documento principal também deve ser bloqueado. O Chrome pode mostrar sua própria página de erro de rede; a extensão não redireciona para uma tela própria. Não espere que a nova página carregue normalmente.
7. Abra o painel pelo ícone da extensão. Encerre e inicie outra captura: o consumo permanece e o bloqueio volta a ser aplicado. Encerrar desliga a atuação enquanto a captura estiver parada, como nas versões anteriores.
8. Aumente a franquia para **10 MB**. O saldo deve ficar positivo e a política recalcular o modo; recarregue a página para buscar recursos que não chegaram a carregar. O conteúdo deve voltar, sem retomar mídia automaticamente. A franquia maior não apaga o consumo nem o histórico.
9. Desativar a economia automática também libera a política, mesmo com aviso de consumo alto. Na renovação real, o acumulado do ciclo volta a zero e os novos carregamentos são liberados automaticamente. Não altere o relógio do computador para testar isso.

Validação: `npm run check`, `npm test`, `npm run test:e2e`. O teste `exhaustion-browser.js` usa Chrome com perfil temporário para verificar limite, texto já recebido visível sem modal/redirecionamento, requisições bloqueadas antes de chegar ao servidor, navegação principal, painel acessível, persistência entre sessões, liberação por orçamento/desativação e renovação via alarme real com relógio controlado somente no worker de teste. Evidências em `artifacts/exhaustion-verification.json`, `franquia-esgotada.png` e `franquia-esgotada-mobile.png`.

O bloqueio vale para o alvo da captura e usa a estimativa observada, sem integração com a operadora. Há atraso entre receber bytes, analisar e aplicar a regra; requisições já em andamento e conexões existentes podem produzir tráfego residual. O texto já recebido permanece disponível; bloquear novas transferências é a ação de economia. As restrições anteriores de áudio, vídeo e imagens continuam valendo.
