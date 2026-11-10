# Demonstração para o professor Nelson — 11/11/2026

## Preparação

Abra a pasta do projeto no VS Code, carregue `extension/` em `chrome://extensions` e execute `npm run demo` no terminal. Abra `http://127.0.0.1:4173`. A página de teste e seus recursos são locais, então a demonstração não depende de sites externos.

Abra a extensão no ícone fixado. Comece com o DevTools da aba de teste fechado. Se estiver projetando, use o link **Abrir painel amplo**, mantendo a página da demo em outra aba ou janela.

## Roteiro de três a cinco minutos

1. **Contextualize:** “Professor, nosso projeto pretende adaptar o carregamento de recursos ao orçamento de dados usando MAPE-K. Nesta primeira implementação fizemos a parte de monitoramento para validar a coleta antes de começar a aplicar regras.”
2. **Inicie a captura e recarregue:** mostre HTML, CSS, JavaScript, imagem e Fetch na tabela. “O sensor observa as requisições do Chrome. O coletor registra, o classificador identifica os recursos, o estimador interpreta os bytes e o agregador reúne as métricas.”
3. **Clique em Carregar 3 imagens:** mostre o aumento de requisições e de transferência. Filtre por Imagem e ordene pela maior transferência. As novas imagens possuem corpos de aproximadamente 24, 80 e 160 kB; a transferência pode incluir cabeçalhos.
4. **Clique em Buscar dados:** mostre Fetch/XHR, redirecionamento e resposta comprimida. “O tamanho do conteúdo descomprimido não é o mesmo que o total transferido; por isso não podemos simplesmente somar tamanhos de arquivos.”
5. **Clique em Simular erro e Repetir recurso em cache:** mostre HTTP 404 e a indicação de cache. O navegador pode reaproveitar o recurso e registrar 0 B transferidos.
6. **Clique em Carregar mídia:** filtre por Áudio e depois Vídeo. Os dois arquivos são locais e válidos; a reprodução é opcional. Se o Chrome dividir em faixas, mais de uma requisição pode aparecer.
7. **Troque de aba:** abra outra página HTTP(S). Mostre que a captura muda de alvo automaticamente e preserva os registros anteriores. Use o filtro **Aba de origem** para separar as requisições. Páginas já carregadas exigem recarregar para observar o início.
8. **Encerre e exporte:** mostre que os registros permanecem no painel e podem ser salvos em JSON. Explique que reiniciar o Chrome remove a sessão em memória.
9. **Mostre a arquitetura:** “Aqui implementamos o Sensor, os quatro componentes do Monitoramento e um registro temporário em Conhecimento. Ainda vamos acrescentar orçamento, análise, escolha dos modos e aplicação de regras para fechar o ciclo de adaptação.”

## Respostas curtas para dúvidas

**Já é autoadaptativa?** Ainda não. Esta entrega valida a observação; a análise e a atuação serão os próximos incrementos.

**Mede exatamente o pacote de internet?** Não. Os bytes são informados pelo Chrome para as respostas observadas. Cache, uploads, service workers, outros aplicativos e overhead de rede tornam isso uma estimativa do consumo, não uma medição da operadora.

**O sistema gerenciado é o HTML?** É o carregamento de recursos no Chrome. No projeto completo, o efetor vai alterar regras de filtragem das próximas requisições, sem precisar modificar o HTML/DOM.

**Por que aparecem recursos depois de carregar a página?** Páginas também carregam conteúdo em resposta a interações, scripts e lazy loading. Os botões da demo mostram esse comportamento.

**As imagens já baixadas serão economizadas depois?** Não. Futuras regras atuarão em novas requisições. Esta versão não bloqueia recursos.

## Se algo não aparecer

- A captura não mostra o carregamento anterior: inicie e clique em **Recarregar página**.
- Captura desconectada: feche o DevTools da aba, confira o aviso do painel e inicie outra sessão. Exporte a sessão anterior antes, se quiser guardá-la.
- Página interna ou protegida: use a demo HTTP local.
- Porta ocupada: execute `PORT=4174 npm run demo` no macOS/Linux e abra a porta indicada.
- Alterações na extensão: use **Atualizar/Recarregar** no cartão de `chrome://extensions` e reabra o painel. Atualizar encerra a conexão de captura anterior.
- O limite de registros foi atingido: exporte e inicie outra sessão.
