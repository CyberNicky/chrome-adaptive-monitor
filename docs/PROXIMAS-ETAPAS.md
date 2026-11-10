# Continuação do desenvolvimento

## 1. Consolidar o monitoramento

Comparar sessões controladas com o Network do DevTools em execuções separadas; registrar diferenças de cache, compressão, range requests, navegação, service workers e streaming. Medir o custo do sensor e avaliar alternativas como `webRequest` combinado com Resource Timing para reduzir a necessidade de depuração. Definir formalmente quais métricas são confiáveis para a análise.

Critério de conclusão: cenários reproduzíveis com cobertura documentada e diferenças quantificadas. Não exigir equivalência com a fatura da operadora.

## 2. Ampliar Conhecimento

Criar modelo de orçamento em bytes e período, preferências, prioridades e exceções por domínio. Definir retenção e consentimento para histórico permanente. Separar parâmetros de política, medições observadas e regras efetivamente aplicadas.

Critério de conclusão: configurar e recuperar orçamento e exceções, com testes das unidades, período e reinicialização do orçamento.

## 3. Implementar Análise

Criar verificador de orçamento, avaliador do ritmo de consumo e identificador da necessidade de economia. Definir limiares e histerese com a equipe/professor, evitando alternâncias frequentes de modo. Os percentuais discutidos no histórico eram exemplos, não requisitos aprovados. Perfis 2G/3G/5G não devem ser apresentados como identificação confiável da rede nem como alteração da tecnologia de conexão.

Critério de conclusão: dados de entrada conhecidos produzem necessidades de adaptação explicáveis; a incerteza de medição é considerada.

## 4. Implementar Planejamento

Selecionar os modos propostos: **Normal**, **Econômico** e **Restritivo**. Em princípio, Econômico restringe áudio/vídeo e Restritivo também imagens. Aplicar exceções prioritárias e produzir plano explícito com justificativa. Validar a classificação de mídia que chega via Fetch/XHR, já que MIME observado depois da resposta nem sempre corresponde ao tipo de regra disponível antes do download.

Critério de conclusão: um plano respeita prioridades, preserva recursos essenciais e não depende de baixar o recurso inteiro para decidir bloqueá-lo.

## 5. Implementar Execução e Efetor

Traduzir o plano para `chrome.declarativeNetRequest`, com regras limitadas ao escopo desejado e reversão segura. Considerar `updateSessionRules` com `tabIds` para políticas por aba, e avaliar regras dinâmicas somente quando a política for global. Solicitar apenas as permissões necessárias ao incremento.

Registrar separadamente plano emitido, atualização confirmada pela API e efeito observado nas requisições. Uma confirmação da API não comprova, sozinha, que todos os recursos pretendidos foram bloqueados.

Critério de conclusão: bloquear novas requisições conforme o modo e restaurar o carregamento ao voltar para Normal, sem afetar outras abas indevidamente.

## 6. Fechar e avaliar o ciclo MAPE-K

Após aplicar regras, continuar observando, analisar os resultados e replanejar quando necessário. Comparar a mesma página com e sem adaptação em cenários controlados, com cache e condições equivalentes, repetindo execuções. Medir economia, erros e impacto na experiência; não chamar diferença de estimativas de economia real sem uma referência de medição adequada.

Critério de conclusão: demonstrar uma sequência observável de **monitorar → analisar → planejar → executar → observar o resultado**, com testes que confirmem a atuação no navegador e o respeito às exceções.
