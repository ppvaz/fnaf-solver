# Operador Android por IA e estúdio visual de automações

Pesquisa online de **2026-10-05**, solicitada por Pedro. Consolida as duas
levas da conversa: infraestrutura Android agent-first e, depois, autoria
visual de automações gerais e de jogos. O FNaF é um possível primeiro alvo
de qualificação; a proposta de produto tem escopo mais amplo.

**Resultado:** existem precedentes fortes para MCP, operação Android por IA,
autoria visual, automação por pixels, loops e validação. **Macro Automation
Studio (MAS)** e **Melaya** são os comparadores mais próximos encontrados.
O diferencial candidato é integrar autoria humana e por agente a execução
temporal qualificada para jogos, com verificação durante cada execução.
Essa diferenciação ainda é uma hipótese, não uma exclusividade demonstrada.

## Método, evidência e limites

Foram consultados sites oficiais, documentação e repositórios dos autores.
As buscas incluíram Android/MCP/agent automation, visual workflow builders,
game automation, recording, assertions e quality gates. A segunda leva
acrescentou canvas, editores de blocos, configuração e diagnóstico visual.

- **DOCUMENTADO:** o recurso foi descrito na fonte primária consultada.
  Verifica-se a existência da descrição; não sua eficácia operacional.
- **ALEGAÇÃO DO AUTOR:** desempenho, cobertura ou confiabilidade informados
  pelo fornecedor, sem reprodução independente nesta pesquisa.
- **INFERÊNCIA:** interpretação ou proposta derivada da comparação.
- **UNKNOWN:** não localizado nas fontes consultadas, ou não medido.

O teto desta síntese é **MODEL_ONLY**, como análise documental. Nenhum produto
foi instalado, nenhum MCP foi conectado e nenhum aparelho foi operado.
Não houve benchmark de latência, aceitação de toque ou taxa de sucesso.
Não encontrar uma função não prova sua ausência. As páginas são mutáveis;
as URLs e a data de consulta são retidas, mas não uma cópia integral dos sites.
Este relatório é bookkeeping, não evidência que fecha S4 ou S6. O
[registro bibliográfico gerado](../evidence/android-ai-operator-visual-studio-20261005.json)
retém hash do relatório, fontes consultadas e perguntas abertas.

A fundamentação local está na pesquisa
[Limites de execução e decisão](ANDROID-EXECUTION-DECISION-LIMITS-20261005.md)
e no seu
[registro gerado](../evidence/android-execution-decision-limits-20261005/result.json),
`android-execution-decision-limits-5f963707b037b4a6`. Ela distingue captura,
despacho, aceitação pelo alvo e confirmação visual, e não estabelece um teto
numérico universal para Android. Seus resultados não qualificam concorrentes.

## O produto em avaliação

A proposta combina quatro capacidades:

1. Operar aplicações e o sistema Android por observação e ações autorizadas.
2. Automatizar jogos com contatos, temporização e estados visuais próprios.
3. Permitir que uma pessoa monte, configure, execute e depure automações
   em uma interface visual.
4. Expor esses mesmos planos a agentes via MCP, com loops e gates definidos.

A extração de infraestrutura é distinta da extração da lógica do jogo:
transporte, captura, relógios, sessões e supervisão podem ser gerais;
mecânicas, detectores, estratégias e critérios de vitória pertencem ao alvo.
Essa é uma proposta de fronteira, não uma migração autorizada nesta pesquisa.

## Comparação dos estúdios e editores

Os recursos positivos da tabela são DOCUMENTADOS. As observações de adequação
são INFERÊNCIAS. A coluna de limites aponta UNKNOWNs nesta revisão.

| Projeto | Autoria/interface | IA, MCP e execução | Limites da comparação |
|---|---|---|---|
| [Macro Automation Studio](https://www.automationmacro.com/agent) | Studio com Python, imagens, parâmetros e dashboards | Agente explora, gera macro, valida e entrega projeto; MCP local/remoto | UI Builder não equivale a editor visual da lógica; qualificação temporal de jogos UNKNOWN |
| [Melaya](https://melaya.org/en/product/agentic-framework) | Canvas de agentes, ferramentas, modelos, gatilhos e gates | Autoria assistida, execução, rastros e controle Android por MCP | Canvas é de pipelines de agentes; resposta rápida em jogos UNKNOWN |
| [Maestro Studio + MCP](https://github.com/mobile-dev-inc/Maestro) | Construção visual de testes, gravação e inspector | Agente opera dispositivo e gera YAML reutilizável em CI | Base orientada a acessibilidade; adequação a jogos opacos e temporais UNKNOWN |
| [AirtestIDE](https://airtest.netease.com/tutorial/Tutorial.html) | Gravação, captura e scripts | Imagens, Poco, assertions e relatórios com screenshots | IDE de scripts; editor nodal e MCP oficial não estabelecidos |
| [Android Macro](https://androidmacro.com/) | Blocos, gravação, condições e repetição | OCR, templates, multitouch e esperas com timeout | Autoria por LLM e MCP não localizados |
| [Macrorify](https://www.kok-emm.com/docs) | Ações, funções, variáveis e interface configurável | Imagem/texto, callbacks e EMScript | Autoria por LLM e MCP não localizados |
| [Klick'r / Smart-AutoClicker](https://github.com/Nain57/Smart-AutoClicker/wiki) | Cenários com eventos, condições e ações | Motor orientado a imagens, timers e contadores | MCP e autoria por LLM não localizados |
| [MacroAI](https://sowe.com/macroai/docs/en/faq/getting-started) | Nós, loops, condições, funções e gravações | Reconhecimento visual, OCR e scripts; Windows e Android | Nome AI não comprova autoria por LLM; MCP não localizado |
| [Automate](https://llamalab.com/automate/) | Fluxogramas diretamente no Android | Ações do sistema, condições, integrações e entradas simuladas | Referência de OS usage; qualificação temporal de jogos e MCP UNKNOWN |

### Macro Automation Studio: autoria por agente e execução de macros

O MAS descreve uma arquitetura próxima da discutida: o agente explora o alvo,
captura templates/OCR e gera Python; as repetições posteriores executam a
macro sem chamadas ao modelo. O loop de autoria documenta as fases SCOUT,
PLAN, HARVEST, CODIFY, REVIEW, VALIDATE, REPAIR e DONE. Há validação em três
execuções e controle de reparos por progresso, com limite de 25 ciclos.

A ressalva central está no contrato: a validação é um **smoke test**, limita o
loop principal a duas iterações e usa `task.yaml` com precondição, timeout e
checks. **O runtime do Studio não lê esse arquivo.** Não se pode inferir que
os mesmos gates supervisionem cada repetição posterior.
[Documentação do agente](https://www.automationmacro.com/docs/agent).

Seu [MCP](https://www.automationmacro.com/mcp) expõe controle, observação,
macros e autoria; a documentação também descreve leases exclusivos para
dispositivos cloud. Isso já fornece precedentes para sessões e operações
acima de um simples tap. Não foi medida sua robustez em aparelho físico.

O [UI Builder](https://www.automationmacro.com/docs/ui-builder) monta
formulários de argumentos e dashboards de execução, com progressos, logs,
gráficos e controles. A lógica permanece em Python. Portanto, “interface
visual” precisa especificar se edita configuração, acompanhamento ou o
programa de automação. A alegação comercial de cobertura de qualquer jogo
não certifica controle reativo ou cumprimento de deadlines.

### Melaya: canvas de agentes e controle Android

O [canvas](https://melaya.org/en/product/agentic-framework) combina agentes,
modelos, ferramentas, contexto, gatilhos e gates, com autoria assistida e
rastros de execução. O
[MCP](https://github.com/melaya-labs/melaya-mcp) permite operar o telefone e
criar, validar, executar e cancelar pipelines. A plataforma descreve
allowlists de aplicações e um controle global de parada.

O repositório público do MCP contém manifestos, empacotamento e documentação;
o servidor executa na plataforma hospedada. A licença do pacote público não
é uma licença do serviço. A abertura dessa integração não comprova abertura
do runtime completo.

A [proposta para jogos](https://melaya.org/en/use-cases/gaming) inclui tarefas
diárias, coleta e agendamento. A própria página apresenta esses exemplos
como padrões que o operador configura, não automações prontas entregues.
Não foram localizadas medições de reação rápida, precisão de contatos ou
qualificação para FNaF. A proximidade de produto é alta; a equivalência
operacional permanece UNKNOWN.

### Maestro e AirtestIDE: testes e evidência visual

O [Maestro](https://github.com/mobile-dev-inc/Maestro) já combina Studio,
gravação/inspeção visual, MCP e fluxos YAML versionáveis. O agente pode
operar o dispositivo, verificar a aplicação e deixar um teste repetível.
O engine é aberto; o README esclarece que o Studio não é open source.
Seu foco na acessibilidade não estabelece controle temporal de jogos.

O [AirtestIDE](https://airtest.netease.com/tutorial/Tutorial.html) é um
precedente forte para jogos: gravação de scripts, reconhecimento de imagens,
Poco para hierarquias compatíveis, assertions e relatório com screenshot e
resultado de cada etapa. Sua interface é uma IDE de scripts; não foi
estabelecida uma experiência de composição nodal com IA. O
[repositório do IDE](https://github.com/AirtestProject/AirtestIDE) serve para
issues, não como publicação do código completo do editor. Não confundir isso
com a abertura dos frameworks Airtest/Poco.

### Macros visuais: recursos que já têm precedentes

[Android Macro](https://androidmacro.com/) documenta blocos, gravação,
templates, OCR, multitouch, caminhos de swipe e espera por aparecimento ou
desaparecimento de imagem com timeout. A autoria visual para jogos já tem
esse precedente mesmo sem integração por LLM estabelecida.

[Macrorify](https://www.kok-emm.com/docs) acrescenta funções, variáveis,
callbacks e formulários que alteram o comportamento em runtime. Seu
[Unit Test](https://www.kok-emm.com/docs/basic/unit-test) executa um grupo ou
ações selecionadas; esse nome não comprova assertions ou gate automático
de aceitação pelo jogo.

O motor do
[Klick'r](https://github.com/Nain57/Smart-AutoClicker/wiki/Smart-Scenario-%E2%80%90-Engine)
aguarda imagens, avalia eventos de gatilho e de tela, executa ações e repete.
A prioridade e a opção de continuar detectando influem no fluxo. É um
precedente para uma estrutura reativa explícita; o loop não prova latência.

[MacroAI](https://sowe.com/macroai/docs/en/faq/getting-started) combina
gravações com nós, condições, loops e subfluxos. Distingue modo de autoria de
modo de uso/configuração. Esses conceitos aproximam-se da experiência
proposta; o nome do produto não estabelece geração por LLM.

## Infraestrutura agent-first da primeira leva

Esta parte amplia o levantamento visual com as bases de execução pesquisadas
anteriormente. Presença de MCP não implica editor, gate runtime ou desempenho
adequado a jogos.

| Projeto/família | Precedente documentado | Questão que permanece aberta |
|---|---|---|
| [Android Remote Control MCP](https://github.com/danielealbano/android-remote-control-mcp) | Servidor no Android; acessibilidade, captura e ações; testes/CI do projeto | Gates do software não demonstram aceitação de cada ação no jogo |
| [android-agent-mcp](https://github.com/EF-Code/android-agent-mcp) | ADB, UIAutomator, scrcpy opcional, sessões visuais com ação e próxima imagem, evidência | Controle contínuo e resposta temporal qualificada UNKNOWN |
| [Mobile Next mobile-mcp](https://github.com/mobile-next/mobile-mcp) | Ferramentas de operação mobile para agentes | Interfaces nativas e jogos opacos precisam de qualificação distinta |
| [Droidrun](https://github.com/droidrun/droidrun) | Agentes de operação Android e Portal de interação | Método de observar/agir/verificar precisa ser separado de enforcement runtime |
| [mobile-mcp-opengl](https://github.com/antonpinchuk/mobile-mcp-opengl) | Automação visual para superfícies de jogos; gestos mantidos e observação | Generalidade, estabilidade e latência não foram medidas por esta pesquisa |
| [AndroidEnv](https://github.com/google-deepmind/android_env) | Ambiente Android para agentes, pixels e inputs, com dinâmica em tempo real | Ambiente experimental não equivale a estúdio ou operador qualificado em retail |
| [AndroidWorld](https://github.com/google-research/android_world) | Benchmark de tarefas Android com critérios de resultado | Sucesso em tarefas de apps não certifica deadlines de jogos |

Um novo achado da segunda leva é o
[ARTEMIS](https://github.com/google/artemis), no repositório do Google:
MCP, console web, tela ao vivo, trajetórias, histórico e replay. A interface
documentada permite despacho e acompanhamento por linguagem natural, sem
estabelecer editor nodal. O perfil Flash descreve 3–5 segundos por etapa e
limitações de verificação; o perfil Pro tem verificações prévias. O README
alega mais de 99% de conclusão no AndroidWorld; não reproduzimos esse número.
**INFERÊNCIA:** a adequação a respostas de jogo muito mais rápidas exige
medir outra camada de execução, inclusive seus action bursts.

## O que a comparação muda

**INFERÊNCIA:** adicionar canvas ou MCP, reconhecer jogos por pixels, compilar
rotinas com IA ou validar uma macro não basta para sustentar novidade.
MAS aproxima autoria por agente e execução repetível; Melaya aproxima
canvas, pipelines e Android. Não foi demonstrado que algum projeto reúne,
com medições publicadas, todos os requisitos temporais e de aceitação que
interessam aqui. Isso é uma lacuna desta busca, não prova de mercado vazio.

O diferencial candidato tem cinco compromissos verificáveis:

1. **Um plano executável comum:** pessoa e agente editam o mesmo artefato;
   UI e MCP preservam sua semântica, versão e identidade.
2. **Gates durante a execução:** cada bloco tem precondição, resultado
   esperado, deadline e recuperação limitada. Ambiguidade produz UNKNOWN.
3. **Execução temporal local:** contatos mantidos, simultaneidade quando
   suportada e reação sem esperar um turno de LLM por ação.
4. **Diagnóstico visual causal:** observação usada, ação, relógios, resposta
   e avaliação por etapa, inclusive falhas e observações ausentes.
5. **Qualificação por alvo:** aparelho, versão, geometria, backend e carga
   sustentável fazem parte do escopo de cada afirmação de robustez.

São requisitos propostos, não capacidades já entregues pelo projeto. A
escolha entre execução no host ou no Android depende de autoridade, custo
e medição; a pesquisa local citada não demonstrou um vencedor universal.

## Consequências para a interface visual

**INFERÊNCIA:** o editor pode combinar tela do dispositivo, seleção de regiões,
fluxo de decisões, parâmetros e revisão das execuções. Jogos temporais podem
precisar também de uma timeline de contatos e observações. Um canvas com
setas não expressa por si só duração, concorrência ou deadline.

Um bloco deveria permitir definir a condição de entrada, a ação, a observação
que confirma o efeito e as saídas por sucesso, falha, timeout e UNKNOWN.
Recuperações precisam de limite e critério observável. A IA pode propor e
revisar blocos, mas o formato comum precisa permitir inspeção e execução
independentes da conversa que os criou.

Formulários de uso, dashboards e edição da lógica são experiências distintas:
MAS, Macrorify e MacroAI fornecem referências úteis para essa distinção.
Maestro/AirtestIDE ajudam a estudar gravação e diagnóstico; Melaya, autoria
de pipelines de agentes; Android Macro, montagem por blocos.

## Experimento que separaria a hipótese dos precedentes

Uma próxima comparação deveria registrar previamente alvo, versões,
condições iniciais, orçamento, sucesso e critérios de interrupção. Comparar
MAS/Melaya e bases relevantes sob três cenários:

| Cenário | O que comparar | Evidência necessária |
|---|---|---|
| Aplicação Android com elementos semânticos | Autoria, edição, repetição e recuperação de interrupção | Estado final observado e rastros de cada tentativa |
| Jogo com menus/pixels e popups | Templates/OCR, transições, recovery e mudança visual | Referências e resultados por etapa; falhas retidas |
| Jogo com prazo e contatos contínuos | Idade da observação, jitter, simultaneidade e aceitação | Relógios mapeados, prazo medido e respostas atribuíveis |

Separar custo de criação da automação, custo de repetição e taxa de sucesso.
Validar também reexecução fora da condição inicial usada pela autoria;
três smoke runs não são uma afirmação de confiabilidade geral.
Nenhum desses experimentos foi executado ou autorizado como operação de
dispositivo por este relatório. Não foi decidido abrir outro repositório,
adotar fornecedor ou alterar o roadmap.

## Resultado e trabalho aberto

**Respondido documentalmente:** existem propostas semelhantes, inclusive
combinações próximas de IA, MCP, jogos e interface visual. A autoria visual
e os loops possuem precedentes suficientes para evitar alegações amplas de
originalidade. MAS e Melaya são os comparadores prioritários encontrados.

**UNKNOWN:** desempenho em nosso aparelho/alvo; cobertura de gates durante
repetições; precisão temporal sob carga; continuidade e aceitação de contatos;
reprodutibilidade entre versões/aparelhos; produtividade da autoria visual;
e vantagem de construir infraestrutura própria frente a integrar existentes.

S4/S6 permanecem abertos. As fontes não demonstram que a infraestrutura
extraída já seria um operador geral qualificado, nem refutam sua utilidade.
Elas tornam a justificativa mais específica e dão comparadores para testá-la.
