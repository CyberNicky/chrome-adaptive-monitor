# Continuação do desenvolvimento

A versão 0.10.0 entrega os quatro incrementos solicitados: modos por metas internas, ciclo da franquia, alertas e consulta persistente às sessões anteriores. Aguardar os testes do usuário antes de ampliar o escopo.

O roteiro desta entrega está em [TESTE-ETAPA-4.md](TESTE-ETAPA-4.md). As evoluções abaixo continuam propostas para a arquitetura completa.

## 1. Consolidar o monitoramento

Comparar sessões controladas com o Network do DevTools em execuções separadas; registrar diferenças de cache, compressão, range requests, navegação, service workers e streaming. Medir o custo do sensor e avaliar alternativas como `webRequest` combinado com Resource Timing para reduzir a necessidade de depuração. Definir formalmente quais métricas são confiáveis para a análise.

Critério de conclusão: cenários reproduzíveis com cobertura documentada e diferenças quantificadas. Não exigir equivalência com a fatura da operadora.

## 2. Ampliar Conhecimento

A configuração básica de plano e franquia já é persistida localmente. As metas de adaptação são internas ao sistema. O período e seu contador já estão implementados. Faltam prioridades e exceções por domínio. O histórico local já usa retenção de até 10 sessões e 4 MB; avaliar políticas de retenção maiores e eventual sincronização somente se necessárias. Separar parâmetros de política, medições observadas e regras efetivamente aplicadas. O modo de economia será estado do ciclo autoadaptativo, e não uma preferência manual.

Critério de conclusão: configurar e recuperar orçamento e exceções, com testes das unidades, período e reinicialização do orçamento.

## 3. Ampliar Análise

O verificador de orçamento e a identificação da necessidade por X/Y estão implementados para o acumulado do ciclo. Falta avaliar o ritmo em relação ao período da franquia e definir histerese se os testes indicarem necessidade. Os valores internos de 70%/90% são experimentais e definidos pela política do sistema, sem edição na interface do usuário. Perfis 2G/3G/5G não devem ser apresentados como identificação confiável da rede nem como alteração da tecnologia de conexão.

Critério de conclusão: dados de entrada conhecidos produzem necessidades de adaptação explicáveis; a incerteza de medição é considerada.

## 4. Ampliar Planejamento

A seleção automática de **Normal**, **Econômico** e **Restritivo** e o plano com justificativa estão implementados. Econômico restringe áudio/vídeo e Restritivo também imagens. Falta aplicar exceções prioritárias. Validar a classificação de mídia que chega via Fetch/XHR, já que MIME observado depois da resposta nem sempre corresponde ao tipo de regra disponível antes do download.

Critério de conclusão: um plano respeita prioridades, preserva recursos essenciais e não depende de baixar o recurso inteiro para decidir bloqueá-lo.

## 5. Ampliar Execução e Efetor

O plano já é traduzido para `chrome.declarativeNetRequest` usando `updateSessionRules` com `tabIds`, remoção de regras ao trocar de aba/encerrar e retorno a Normal. Falta ampliar a cobertura de players e considerar uma política global somente se ela for explicitamente desejada. A permissão declarativa foi adicionada, sem permissões globais de hosts.

Registrar separadamente plano emitido, atualização confirmada pela API e efeito observado nas requisições. Uma confirmação da API não comprova, sozinha, que todos os recursos pretendidos foram bloqueados.

Critério de conclusão: bloquear novas requisições conforme o modo e restaurar o carregamento ao voltar para Normal, sem afetar outras abas indevidamente.

## 6. Fechar e avaliar o ciclo MAPE-K

Após aplicar regras, continuar observando, analisar os resultados e replanejar quando necessário. Comparar a mesma página com e sem adaptação em cenários controlados, com cache e condições equivalentes, repetindo execuções. Medir economia, erros e impacto na experiência; não chamar diferença de estimativas de economia real sem uma referência de medição adequada.

Critério de conclusão: demonstrar uma sequência observável de **monitorar → analisar → planejar → executar → observar o resultado**, com testes que confirmem a atuação no navegador e o respeito às exceções.
