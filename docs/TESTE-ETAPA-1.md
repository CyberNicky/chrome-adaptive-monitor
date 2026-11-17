# Etapa 1 — teste incremental dos modos (0.4.0)

Este incremento atende somente ao primeiro item solicitado em 17/11/2026. Configuração de período e renovação (item 2), alertas/contador persistente (item 3) e histórico anterior (item 4) aguardam os testes do usuário.

1. Recarregue o cartão do Navega em `chrome://extensions`. Se o Chrome solicitar a nova permissão de bloqueio, conceda-a para testar. Feche/reabra o painel.
2. Execute `npm run demo` na raiz do projeto e abra `http://127.0.0.1:4173`.
3. Na engrenagem, informe um plano, **1 MB**, **X = 70%**, **Y = 90%** e deixe a economia automática ativa. Salve.
4. Inicie a captura e clique em **Recarregar página**. Observe **Normal** no cabeçalho: imagem, áudio e vídeo devem carregar.
5. Na página, use **Consumir 100 kB de teste** até o cabeçalho indicar **Econômico**. Teste **Carregar 3 imagens** (permitido) e **Carregar mídia** (bloqueado).
6. Continue consumindo texto até aparecer **Restritivo**. Novas imagens, áudio e vídeo devem falhar. Recarregue a página: o texto e seus recursos essenciais continuam funcionando.
7. Troque de aba: o mesmo consumo acumulado determina o modo na nova aba monitorada. Os bloqueios da extensão não permanecem nas abas inativas.
8. Abra a engrenagem e altere para **10 MB**. Como o consumo estará abaixo de X, o modo retorna a Normal. As próximas imagens e mídias voltam a carregar. Alternativamente, desmarque a economia automática.
9. Encerre a captura: os bloqueios devem ser removidos. Exporte o JSON se quiser guardar a evidência; ele inclui orçamento e estado da adaptação.

Os números do teste são decimais: 1 MB = 1.000.000 bytes, com limites em 700.000 e 900.000 bytes. O HTML, os scripts e outros recursos também consomem bytes, por isso o modo pode mudar antes de completar sete/nove cliques. Espere a indicação confirmada no cabeçalho antes de testar novos recursos.

Os bloqueios valem para próximas requisições; não removem conteúdo já baixado. Teste novamente ou recarregue para verificar o efeito. Nesta etapa, iniciar uma nova captura zera o consumo usado para decidir os modos, e reiniciar o Chrome elimina a captura temporária. As configurações permanecem salvas, mas ainda não existe saldo mensal persistente.

Validação automatizada: `npm test`, `npm run check`, `npm run test:e2e`. O teste real dos modos observa as requisições no servidor para confirmar que o bloqueio aconteceu antes da transferência, testa a preservação de texto/CSS/JavaScript, o escopo por aba e a remoção das regras. Screenshots e relatório são salvos em `artifacts/`.
