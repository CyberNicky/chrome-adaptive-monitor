# Etapa 1 — teste incremental dos modos (atualizado para 0.6.0)

Este roteiro verifica os modos do item 1. O calendário e acumulado do item 2 já estão disponíveis: veja [TESTE-ETAPA-2.md](TESTE-ETAPA-2.md). Alertas (item 3) e histórico anterior (item 4) seguem pendentes.

1. Recarregue o cartão do Navega em `chrome://extensions`. Se o Chrome solicitar a nova permissão de bloqueio, conceda-a para testar. Feche/reabra o painel.
2. Execute `npm run demo` na raiz do projeto e abra `http://127.0.0.1:4173`.
3. Na engrenagem, informe um plano e **1 MB** e deixe a economia automática ativa. As metas de 70% e 90% são do sistema, sem edição de percentuais pelo usuário. Salve.
4. Inicie a captura e clique em **Recarregar página**. Observe **Normal** no cabeçalho: imagem, áudio e vídeo devem carregar. Clique em **Carregar mídia** e depois em play no áudio para começar a ouvi-lo antes da adaptação.
5. Na página, use **Consumir 100 kB de teste** até o cabeçalho indicar **Econômico**. O áudio que estava tocando deve parar imediatamente, e tentar tocar novamente o buffer não deve produzir som. Teste **Carregar 3 imagens** (permitido) e **Carregar mídia** (bloqueado).
6. Continue consumindo texto até aparecer **Restritivo**. Imagens já exibidas devem ficar ocultas, além do bloqueio de novas imagens, áudio e vídeo. O texto e seus recursos essenciais continuam funcionando.
7. Troque de aba: o mesmo consumo acumulado determina o modo na nova aba monitorada. Os bloqueios da extensão não permanecem nas abas inativas.
8. Abra a engrenagem e altere para **10 MB**. Como o consumo estará abaixo de X, o modo retorna a Normal. As imagens ocultadas reaparecem e as próximas mídias voltam a carregar. A música não começa automaticamente: clique em play para reproduzir novamente. Alternativamente, desmarque a economia automática.
9. Encerre a captura: os bloqueios devem ser removidos. Exporte o JSON se quiser guardar a evidência; ele inclui orçamento e estado da adaptação.

Os números do teste são decimais: 1 MB = 1.000.000 bytes, com limites em 700.000 e 900.000 bytes. O HTML, os scripts e outros recursos também consomem bytes, por isso o modo pode mudar antes de completar sete/nove cliques. Espere a indicação confirmada no cabeçalho antes de testar novos recursos.

As regras de rede bloqueiam próximos downloads; o controle complementar pausa a mídia já carregada e oculta imagens nos elementos suportados, sem precisar recarregar. Isso não recupera bytes já consumidos. Desde 0.6.0, iniciar uma nova captura ou reiniciar o Chrome preserva o consumo usado pelos modos no ciclo atual. Reiniciar ainda elimina os registros temporários da captura. Para repetir este teste em um ciclo já consumido, aumente a franquia ou use um perfil separado de teste; limpar a captura não zera a franquia.

Validação automatizada: `npm test`, `npm run check`, `npm run test:e2e`. O teste real dos modos observa as requisições no servidor para confirmar que o bloqueio aconteceu antes da transferência, testa a preservação de texto/CSS/JavaScript, o escopo por aba e a remoção das regras. Screenshots e relatório são salvos em `artifacts/`.
