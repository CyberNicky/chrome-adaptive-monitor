# Navega • Monitor de recursos

Primeira implementação da **Extensão Autoadaptativa para Gestão de Orçamento de Dados na Navegação Web com MAPE-K**, da disciplina de Sistemas Adaptativos. Esta entrega implementa o monitoramento; as decisões e regras de adaptação ficam para as próximas etapas.

Abra uma página, inicie a captura uma vez e alterne entre as abas: o monitoramento acompanha automaticamente a aba ativa. Veja as requisições HTTP(S), seus tipos, status, duração e bytes recebidos informados pelo Chrome. O painel mostra totais, distribuição por recurso, ritmo médio e falhas. É possível buscar, filtrar por tipo e aba de origem, ordenar e exportar a sessão em JSON. Os totais abrangem todas as abas visitadas durante a sessão.

![Painel com requisições reais da demonstração local](docs/painel.png)

## Apresentar em cinco minutos

**Requisitos:** Google Chrome 125 ou superior. Node.js 22 ou superior somente para a página local de demonstração. A extensão funciona sem instalação de pacotes e sem build.

1. No Chrome, acesse `chrome://extensions`.
2. Ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta [`extension/`](extension).
3. Fixe a extensão **Navega • Monitor de recursos** na barra do navegador.
4. No terminal do VS Code, na raiz deste repositório, execute:

   ```sh
   npm run demo
   ```

5. Abra **http://127.0.0.1:4173** no Chrome.
6. Clique no ícone da extensão, depois em **Iniciar captura** e **Recarregar página**.
7. Experimente os botões da página e observe o painel. Troque de aba para testar a captura automática, sem encerrar nem iniciar outra sessão. Use **Abrir painel amplo** para projetar a tabela em uma aba maior.
8. Use **Encerrar captura** e **Exportar JSON** para guardar a evidência. Encerrar interrompe o sensor e preserva os registros. **Iniciar nova sessão** substitui a anterior.

O aviso de depuração do Chrome é esperado: o sensor usa `chrome.debugger` para acessar o domínio Network do Chrome DevTools Protocol. Não abra o DevTools da **aba monitorada** durante a demonstração: ele pode desconectar a captura. Se isso acontecer, os registros são preservados e o painel informa a desconexão.

Veja o [roteiro de apresentação](docs/DEMONSTRACAO.md), o [mapeamento da arquitetura](docs/ARQUITETURA.md) e as [próximas etapas](docs/PROXIMAS-ETAPAS.md).

## Escopo desta entrega

| Parte da arquitetura                     | Implementação                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Sensor                                   | Adaptador CDP que acompanha automaticamente a aba ativa e instrumenta iframes/workers dedicados |
| Coletor de requisições                   | Registra o ciclo de vida, erros, redirecionamentos e contextos                                  |
| Classificador de recursos                | HTML, CSS, JavaScript, imagem, áudio, vídeo, mídia, fonte, Fetch/XHR e outros                   |
| Estimador de consumo                     | Usa bytes recebidos informados pelo Chrome; mantém valores parciais ou desconhecidos explícitos |
| Agregador de métricas                    | Totais, tipos, domínios, ritmo médio, cache, pendências e falhas                                |
| Conhecimento                             | Uma sessão temporária em `chrome.storage.session`, com exportação manual                        |
| Análise, Planejamento, Execução e Efetor | Planejados; sem decisões automáticas ou regras de bloqueio nesta versão                         |

O sistema gerenciado continua sendo **o carregamento de recursos no Chrome**. Os sensores são implementados na extensão e interagem com as APIs do navegador. A extensão não injeta scripts na página nem modifica o HTML/DOM.

## Interpretar os tamanhos

- **Transferência observada:** `Network.loadingFinished.encodedDataLength`, total recebido informado pelo Chrome. Enquanto a requisição está em andamento, usamos os dados parciais disponíveis; o total final os substitui.
- **Tamanho descomprimido:** soma de `Network.dataReceived.dataLength`, disponível no JSON como `decodedBytes`. É diferente dos bytes transferidos e pode estar indisponível.
- **Cache:** recursos servidos de memória/disco podem ter transferência de **0 B**, embora tenham conteúdo. Respostas de service worker são identificadas; seu eventual tráfego de origem não é contabilizado como uma medição independente.
- **“—”:** valor desconhecido, não zero. Falhas e capturas interrompidas podem ter somente bytes parciais.
- **Ritmo médio:** bytes observados divididos pelo tempo da sessão, em bytes/minuto. Não mede a velocidade da conexão e congela ao encerrar.

São unidades decimais: **1 kB = 1.000 B; 1 MB = 1.000.000 B**. O total não equivale ao consumo cobrado pela operadora: não inclui uploads, overhead completo de rede, abas inativas/outros aplicativos ou frames de WebSocket. Streaming contínuo pode continuar parcial. A captura começa quando o usuário a inicia; recursos anteriores exigem recarregar a página.

## Dados e limites

- Uma sessão por vez, acompanhando automaticamente a aba ativa. Ao trocar de aba ou janela, o sensor muda de alvo e preserva os registros anteriores. As abas inativas deixam de ser observadas. Requisições ainda pendentes na troca são marcadas como interrompidas, preservando os bytes parciais; retornar à aba não recupera eventos perdidos enquanto ela estava inativa.
- Abas vazias e páginas internas entram em espera sem encerrar a sessão. Ao visitar uma página HTTP(S), a captura retoma automaticamente. O próprio painel amplo é uma exceção: abri-lo mantém o último alvo. Fechar a aba monitorada mantém a sessão ativa para acompanhar a próxima página. **Encerrar captura** desliga a automação.
- Ao ativar uma aba que já terminou de carregar, somente as próximas requisições serão observadas. Recarregue manualmente se quiser registrar o carregamento inicial completo; a extensão não recarrega páginas por conta própria.
- Até **3.000 requisições por sessão**. Ao atingir o limite, o painel informa que novos registros foram ignorados; os totais cobrem apenas os registros retidos. Exporte e inicie outra sessão.
- Registros na memória da sessão do navegador: reabrir o painel preserva os dados, reiniciar o navegador os remove. Não é um histórico permanente.
- Sem coleta de corpos das respostas, cookies ou cabeçalhos de autenticação. URLs são armazenadas sem query string, fragmento ou credenciais. Caminhos ainda podem conter informações pessoais; revise o JSON antes de compartilhar.
- Sem servidor de telemetria. O servidor da demo atende apenas no loopback `127.0.0.1`.
- Páginas internas e protegidas do Chrome não podem ser monitoradas. Iframes e workers instrumentados são observados, mas há limites de cobertura em transições de contexto, service workers e conexões de longa duração.
- Permissões: `debugger` observa a rede da aba selecionada; `tabs` identifica o alvo e detecta mudanças de aba; `sidePanel` apresenta o painel; `storage` mantém a sessão. A permissão de depuração é ampla, mas o código só habilita observação de rede e instrumentação de contextos.

## Desenvolvimento e verificação

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run test:e2e
```

O teste de navegador carrega a extensão real em um perfil temporário do Chrome for Testing. Verifica captura, tamanhos, cache, erro HTTP, redirecionamentos, mídia, contexto de iframe/worker, filtros, exportação, reabertura do painel e encerramento, além de troca automática de abas, trocas rápidas, retomada após uma aba vazia e fechamento do alvo. As evidências ficam em `artifacts/` e não entram no Git. O perfil temporário é removido após o teste; o Chrome pessoal não é alterado.

Para empacotar somente a extensão: `npm run package`. O ZIP fica em `dist/navega-extension.zip`; extraia antes de usar **Carregar sem compactação**. A página demo não faz parte do pacote da extensão.

O áudio, as imagens e o vídeo da demo são gerados para o projeto. O vídeo já está versionado; regeneração opcional: `node scripts/generate-demo-video.js` (requer Playwright e Chromium). Os preenchimentos dos SVGs criam tamanhos controlados para demonstração, não uma representação de imagens comprimidas reais.

## Referências

O escopo e a separação entre sistema gerenciador/gerenciado seguem a [conversa de referência fornecida pela equipe](https://chatgpt.com/share/6af33288-dfb4-83e9-b084-05b64c38edd6) e a [figura da arquitetura](docs/arquitetura-referencia.png). O histórico orienta a arquitetura; exemplos de políticas discutidos ali não foram tratados como funcionalidades obrigatórias desta primeira entrega.

Implementação baseada na documentação oficial de [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger), [Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage) e [Network do CDP](https://chromedevtools.github.io/devtools-protocol/tot/Network/). O uso de CDP é uma escolha do sensor deste protótipo; a arquitetura permite substituí-lo futuramente por uma estratégia menos intrusiva.

## Atualizar uma instalação existente

Em `chrome://extensions`, clique em **Recarregar** no cartão do Navega e reabra o painel. A versão **0.2.0** acompanha as abas automaticamente depois do primeiro clique em **Iniciar captura**. Sessões da versão anterior são preservadas como encerradas; inicie uma nova para ativar o novo comportamento.
