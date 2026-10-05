# Limites de execução e decisão a partir do Android

Pesquisa de 2026-10-05, solicitada por Pedro. Escopo: interação autorizada com
um sistema por interface visual/toque ou por uma API, comparando Host↔Android
com Android apenas. FNaF 2 retail no Moto g56 é o caso medido do projeto.

**Resultado:** não há um valor universal de latência mínima, frequência máxima
de ações ou garantia de deadline para Android. Existem limites condicionados
à observabilidade, ao canal autorizado, à semântica do alvo e aos recursos
sustentáveis. O teto numérico do ciclo completo deste projeto é **UNKNOWN**.
Esta síntese não executou o telefone, não qualificou um backend e não fecha S4.
O registro gerado fica em
[`android-execution-decision-limits-20261005/result.json`](../evidence/android-execution-decision-limits-20261005/result.json).

## O que “absoluto” pode significar

| Classe | Limite | Como demonstrar |
|---|---|---|
| Causal/informacional | Uma decisão não distingue estados que produzem o mesmo histórico disponível antes do prazo | Construir dois estados indistinguíveis que exigem respostas incompatíveis |
| Interface/autoridade | Só é possível observar e executar o que o canal autorizado expõe | Contrato da API, permissões e testes positivos no alvo |
| Semântica do alvo | Entrada entregue pode ser rejeitada, coalescida ou chegar durante uma animação que bloqueia o controle | Registro da aplicação ou resposta observável causalmente atribuída |
| Temporal | A reação precisa terminar antes da última oportunidade de aceitação | Medir toda a cadeia no mesmo domínio de relógio ou com erro de mapeamento limitado |
| Computacional | A política precisa caber no orçamento de CPU, memória e energia em operação sustentada | Medição do workload real, quente e concorrendo com o alvo |
| Garantia | Um máximo observado não é um limite superior demonstrado | Análise de pior caso e hipóteses explícitas; ensaios fornecem evidência estatística |

A impossibilidade informacional independe da localização da CPU. Se dois
estados exigem ações diferentes e não admitem ação comum segura, nenhum
controlador pode garantir ambos usando o mesmo histórico. A formulação por
estado de crença é a de [Kaelbling, Littman e Cassandra, 1998](https://www.cassandra.org/arc/papers/aij98.pdf);
a impossibilidade acima é uma dedução para este problema, não um resultado
medido no telefone. Prever um estado provável não o torna observado.

Uma API cooperativa pode expor estado e comandos sem passar por pixels,
compositor ou toque. Nesse caso, o deadline e a capacidade da API/rede/alvo
substituem essas parcelas. Modificar/instrumentar o jogo também muda o
problema: um solver com estado interno não certifica um jogador de retail.

## A cadeia que precisa caber no prazo

Para um evento imprevisível do alvo, defina:

```text
L_local = atraso até a evidência observável
        + aquisição/entrega da observação
        + percepção e estimativa
        + decisão
        + envio e despacho da entrada
        + espera até a aplicação aceitar a ação

L_host  = mesmas parcelas, com percepção/decisão no host
        + transporte Android→host e host→Android
        + serialização e filas adicionais no caminho crítico
```

São parcelas causais de uma reação, não uma soma de todos os tempos de CPU
de um pipeline. Trabalhos independentes podem sobrepor-se. A confirmação
visual posterior tem uma latência própria: a ação pode ser aceita antes de
sua animação aparecer. Nunca contar a mesma fila ou transporte duas vezes.

Se `D` é o prazo do evento até a última aceitação útil, a condição operacional
é `P(L_aceitação <= D) >= confiabilidade exigida`. Uma garantia determinística
exige um limite superior demonstrado de L, incluindo pausas e falhas cobertas
pelo contrato. Somar p99 de cada parcela não produz o p99 do total; medir a
distribuição conjunta ou construir um orçamento probabilístico explícito.

Para observações perfeitamente periódicas a 60 Hz, um evento visível que
chega em fase arbitrária espera de aproximadamente 0 a 16,67 ms pela próxima
amostra; a média é 8,33 ms **se a fase for uniforme**. A 120 Hz, esses valores
são 0 a 8,33 ms e 4,17 ms. É aritmética condicional, não uma medição nem um
limite garantido do Android. Frames perdidos, renderização e filas aumentam
a espera. Capturar mais vezes uma imagem repetida não acrescenta informação.
Display, produção do jogo, captura e consumo de inputs podem ter taxas distintas.
O [pipeline gráfico AOSP](https://source.android.com/docs/core/graphics/architecture)
explica as fronteiras entre buffers, composição e apresentação.

Para uma aplicação que apenas amostra o estado do contato a cada `Tg`, um
pulso menor que Tg pode desaparecer entre amostras. Cobrir qualquer fase
exige duração no alvo maior que o maior intervalo de amostragem, com margem
para o jitter diferencial entre DOWN e UP. Essa dedução não vale para todo
consumidor: uma aplicação que processa eventos enfileirados pode aceitar
DOWN/UP mesmo dentro de um frame. Não há “máximo de cliques Android” derivável
apenas do refresh do display.

Agendamento antecipado pode compensar um atraso previsível e tirar a rede
do prazo de cada ação. Não permite reagir antecipadamente a informação nova
nem elimina a incerteza residual da fase ou do despacho.

## Autoridade: “Android apenas” tem três significados diferentes

| Ambiente | O que permite | Fronteira principal |
|---|---|---|
| APK comum, grants normais | MediaProjection consentida; serviço de acessibilidade habilitado; APIs expostas pelo alvo | Não ganha acesso arbitrário à memória, aos dispositivos de input ou à injeção privilegiada |
| Telefone sem PC, mas com serviço em identidade shell/ADB | Pode manter uma ponte local para operações permitidas ao shell | Continua dependente da autorização, disponibilidade e lifecycle dessa ponte |
| Dispositivo com root/serviço privilegiado/sistema controlado | Pode ampliar sensores e atuadores conforme a política efetiva | Root não concede por si só todas as operações SELinux nem prova deadline ou aceitação |

Código nativo/JNI dentro de um APK não muda sua autoridade: o
[sandbox AOSP](https://source.android.com/docs/security/app-sandbox) abrange
código nativo. [SELinux](https://source.android.com/docs/security/features/selinux)
também restringe processos root. O
[InputManagerService AOSP](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/services/core/java/com/android/server/input/InputManagerService.java)
verifica `INJECT_EVENTS` na injeção geral. Esse código de referência não é
uma medição da implementação instalada no Moto.

No código deste projeto, [`TermuxBridge.java`](../../android/companion/src/com/ppvaz/fnafcompanion/TermuxBridge.java)
abre localhost e encaminha o stream para `adb shell /system/bin/hid`.
Portanto, a rota sem PC continua usando ADB; “hostless” não significa APK
comum autossuficiente. O runner compila e transmite o stream antes de
supervisionar a noite; seu loop de supervisão dorme até 250 ms. Esse intervalo
é uma escolha de implementação e não constitui um reflexo local de 1–5 ms.

MediaProjection exige consentimento por sessão e serviço foreground adequado;
o token de criação é de uso único nas condições documentadas. A captura pode
parar por bloqueio da tela, revogação ou morte do processo. Ver
[documentação de MediaProjection](https://developer.android.com/media/grow/media-projection).
Conteúdo [`FLAG_SECURE`](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE)
não é um sensor disponível pela captura normal. A
[captura de áudio](https://developer.android.com/media/platform/av-capture)
também depende de política do produtor e outras condições da API. A árvore
atual do Companion não tem esse canal; o áudio do projeto passa por A2DP/host.
Uma arquitetura local que precise desse áudio ainda tem trabalho de qualificação.

## Atuadores e o que suas respostas realmente provam

**AccessibilityService.** A API permite multitoque e um novo gesto cancela
gestos em andamento. A continuação de contatos precisa respeitar o contrato
de strokes; multitoque declarado não certifica todos os padrões reativos de
adição/remoção. Ver [API oficial](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService).
O [AOSP atual](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/accessibilityservice/AccessibilityService.java)
usa, para targets modernos, `floor(1000 / refreshHz)` ms na amostragem do
caminho, com fallbacks. Em 120 Hz isso é 8 ms; em 60 Hz, 16 ms. Os 100 ms
do caminho legado não são um atraso obrigatório de todo toque. Tampouco os
8 ms são uma garantia de recepção. A
[GestureDescription do AOSP main](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/accessibilityservice/GestureDescription.java)
limita uma descrição a 20 strokes e 60 s; consultar os getters da versão
instalada antes de depender desses valores. Não são 20 contatos garantidos
pela aplicação nem limite de duração de toda a campanha.

**UHID.** O [driver Linux](https://docs.kernel.org/hid/uhid.html) permite
criar um dispositivo HID através de transporte userspace. Os reports
sintéticos evitam a detecção física do dedo no digitizer, mas ainda passam
pela interpretação de input e pelo consumo do alvo. Escrever um report,
receber UHID_OPEN e receber um toque no app são eventos diferentes.
O descriptor do projeto representa dois contatos; isso não é um teto de
todos os dispositivos Android. Sua disponibilidade em identidade shell não
implica acesso por qualquer APK.

**ACK, callback e aceitação.** Um ACK pode provar somente que um transporte
ou framework aceitou trabalho. No teste retail de 2026-09-06, acessibilidade
retornou `accepted=true` e `completed`, mas a transição não foi observada;
UHID no mesmo ponto produziu a transição. O serviço havia sido habilitado
temporariamente por ADB, sem onboarding normal. Isso refuta a promoção desse
backend naquela condição, sem estabelecer que todo Clickteam rejeita
acessibilidade ou que a causa foi um filtro de flags. Registro:
[`accessibility-game-acceptance`](../device/accessibility-game-acceptance-20260906.json).

## O que o projeto efetivamente mediu

| Resultado retido | Categoria e condição | O que não demonstra |
|---|---|---|
| REGION: 481 frames/8 s com e sem frame trace; 60,1 fps; maior gap observado 20,3 ms | DEVICE_MEASURED, Companion 16, menu animado | Latência do evento oculto até a ação; operação de uma noite inteira |
| Captura rowcopy-16: 60 fps; 3,52–5,17 ms de CPU/frame em condições light/warm | DEVICE_MEASURED, menu; thread usa 0,211–0,310 de um core nessas janelas | WCET, tempo wall de reação, desempenho sob qualquer temperatura |
| UHID: p50 4–5 ms, maior valor 13 ms; acessibilidade p50 1–4 ms, maior valor 7 ms | FIXTURE sintética medida no telefone; 100 eventos por célula, atraso receiveUptime−eventTime | Comando→aceitação no jogo; p99.9; custo de startup |
| Contatos de 33 ms aceitaram controles selecionados; sweep com espaçamento de 100 ms foi observado | DEVICE_MEASURED, controles e protocolos históricos específicos | Um mínimo absoluto de 33 ms; 10 ações/s universais; confiabilidade de qualquer sequência |
| Botão de máscara plenamente visível por volta de 382,5 ms depois de monitor-down | DEVICE_MEASURED, trace que ancora o gate | Um atraso de transporte; tempo geral de resposta de todas as ações |
| Clock map helper→host: erro 24 ms na validade declarada | DEVICE_MEASURED, uma sessão de 2026-09-05 | Erro permanente de todo link; números abaixo desse erro em relógios cruzados |
| Release 15–30 ms inferido por reconstrução; press 81,6/85,5 ms usado em replays de noites específicas | MODEL_ONLY sobre frames/relógios/outcomes DEVICE_MEASURED | Medição direta de despacho; simetria DOWN/UP; equivalente fidelidade de encontros |
| Census host: quatro workers 2,56× serial; seis 2,63×, RSS 322,4→476,9 MiB | MODEL_ONLY, Apple M1/Node e bloco de 512 seeds | Custo da política Android, teto ótimo global ou deadline do aparelho |

Fontes locais: [REGION](../evidence/companion16-region-under-trace-20261001.json),
[CPU](../evidence/companion-capture-cpu-20261001.json),
[piloto](../device/accessibility-hid-pilot-20260906.json),
[contatos e a ressalva de polling](../device/HID-MULTITOUCH.md),
[gate de animação](../../packages/propose/bin/plans/artifact-commands.ts),
[clock map](../evidence/clock-map-20260905-moto-g56-helper.json),
[releases](../evidence/phone-release-latency-20261001.json),
[recursos host](../evidence/runtime-cost-20261005/result.json).
O piloto é uma fixture no telefone, não uma medição do jogo. Seus números
permanecem registrados como tais, sem promoção entre os dois alvos.

**Não usar `FUSION_POLL_MS=33` para concluir que o jogo aceita só 30 ações/s.**
[`recipe.ts`](../../packages/propose/bin/plans/recipe.ts) afirma polling a
30 Hz, mas a seção de timing de HID-MULTITOUCH mantém sua medição aberta.
Capture fps, contato aceito e polling são quantidades diferentes. Também não
usar metas L1 de 1–5 ms da
[arquitetura proposta](../device/REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md)
como resultados de dispositivo. Comentários e metas não fecham esse experimento.

## Comparação das arquiteturas

| Aspecto | Host↔Android, decisão por evento no host | Host↔Android, plano/reflexo local | Android apenas |
|---|---|---|---|
| Prazo da reação nova | Inclui ida e volta pelo link | Link sai do reflexo se a decisão necessária está local | Não depende do link externo |
| Busca pesada | CPU/GPU/RAM do host | Host pode preparar/revisar políticas | Compete com o jogo por CPU/GPU/memória/energia |
| Observabilidade | Canais que Android expõe ao host | Mesmos canais, processamento distribuído | Mesmos canais disponíveis localmente; pode perder áudio hoje dependente do host |
| Relógio das ações | Sincronização/erro se tempo cruza máquinas | Ações executadas em relógio local | Relógio local; ainda distinguir uptime, elapsedRealtime e timestamps do produtor |
| Falha | Link/host além dos componentes locais | Executor precisa sobreviver de forma definida ao link perdido | Processo, serviços, grants, bateria e thermal continuam relevantes |
| Evidência neste projeto | Supervisão host e execução local já usadas | É a forma da rota HID atual | Companion+Termux existe como candidato limitado, sem equivalência completa qualificada |

O [`hid-schedule.ts`](../../packages/play/src/campaign/hid-schedule.ts) já
compila um stream limitado de delays/reports executado no telefone. A troca
de localização da supervisão não remove automaticamente uma viagem de rede
por toque: essa viagem já não integra cada ação pré-programada. Seu atraso
de readiness de 7 s é startup medido/conservador do perfil, não 7 s por toque.
Gates host e reações novas ainda podem trazer o link ao caminho crítico.

Para comparar decisões remotas e locais equivalentes, mantendo as demais
parcelas, o host ajuda em latência se:

```text
custo_local(percepção+decisão)
  > transporte_de_ida+volta + serialização/filas + custo_host(percepção+decisão)
```

É uma condição de crossover, não uma medição. Avaliar também qualidade da
decisão sob o mesmo deadline e o custo térmico. O trabalho
[MAUI, MobiSys 2010](https://www.microsoft.com/en-us/research/wp-content/uploads/2010/06/maui.pdf)
mostra particionamento dependente de computação e transferência; seus
benchmarks históricos não calibram este telefone. A
[API térmica Android](https://developer.android.com/games/optimize/adpf/thermal)
explicita a variabilidade por estado térmico.

Android não oferece ao APK comum uma garantia geral de pior caso para toda
essa cadeia. Prioridade de thread e timestamps de nanossegundos não provam
execução pontual. A [documentação PREEMPT_RT](https://docs.kernel.org/core-api/real-time/theory.html)
explica mecanismos de redução de latência do kernel; root ou PREEMPT_RT
isoladamente não certificam o pipeline gráfico, a política e o app.

**Recomendação inferida:** no alvo retail, manter aquisição, estimativa
necessária ao prazo, arbitragem e execução críticas no telefone; usar o host
para busca/census, compilação, replay, análise e propostas assíncronas. Uma
política pesada que comprovadamente caiba melhor remotamente pode ser
particionada. Essa direção coincide com o contrato do projeto, mas sua
superioridade numérica sobre todas as alternativas permanece não medida.

## Literatura: precedentes não são tetos

[scrcpy](https://github.com/Genymobile/scrcpy) anuncia 35–70 ms para sua
experiência de mirroring; não é benchmark pareado do loop deste solver.
[RERAN, ICSE 2013](https://web.cs.ucla.edu/~todd/research/icse13.pdf) demonstra
replay de eventos de baixo nível, usa root para as permissões necessárias e
relata precisão temporal fina. Replay de um trace conhecido não mede
see→decide→accept de um controlador reativo.
[AndroidEnv](https://arxiv.org/abs/2105.13231) é um ambiente de pesquisa sobre
Android em execução; não deve ser transplantado para hardware físico como
um benchmark do Moto. O estudo de
[latência de aplicações de vídeo móvel](https://arxiv.org/abs/1611.08520)
analisa parcelas do pipeline e a influência de buffers; não qualifica estes
atuadores. A busca desta sessão não localizou um comparativo pareado completo
que permita declarar um teto de Accessibility versus UHID para este jogo.
Isso é uma limitação da busca, não uma prova de inexistência de literatura.

## Experimento mínimo para obter os limites que faltam

Comparar três placements com detector/política equivalentes, no mesmo perfil:
decisão host por evento, host com executor/reflexo local e decisão toda local.
Congelar APK/jogo/versionCode, regiões, geometria, contatos, modo de display,
condição térmica e workload. Preflight de capabilities deve decidir quais
timestamps realmente são observáveis antes de propor um instrumento.

Retenção por tentativa: evento/estímulo, aquisição, chegada da observação,
decisão concluída, entrada enviada, app recebido **se disponível**, efeito
observado, DOWN e UP separados, deadline, sequência, perdas e UNKNOWN.
Usar uma fixture própria para recepção direta e o retail para aceitação;
registrar o intervalo entre eles, sem promover a fixture. Quando o evento
interno retail não é observável, medir resposta desde um estímulo observável
e declarar a parcela oculta, em vez de anunciar latência total.

Medir p50/p95/p99, intervalos, deadline misses, contatos perdidos e condições
de cancelamento, quente/frio, com/sem trace/gravação, em operação sustentada.
Timestamps de clocks diferentes exigem mapa com erro e validade; o
[SystemClock](https://developer.android.com/reference/android/os/SystemClock)
distingue relógios que incluem ou excluem suspensão. Frames de um produtor
também precisam de domínio explícito. Uma release enviada não retira uma
ação já aceita, nem prova que cancelou ações futuras já enfileiradas.

Não chamar o máximo de três repetições de uma garantia p99.9. Sob ensaios
IID estacionários e zero falhas, o limite binomial unilateral de 95% para a
probabilidade de falha é `1 - 0.05^(1/n)`: aproximadamente 0,30% em n=1000.
São necessários pelo menos 2995 ensaios sem falha para esse limite cair a
0,10%. É uma derivação binomial, não uma garantia sobre novos estados,
temperaturas ou falhas correlacionadas.

Permanecem **UNKNOWN**: deadline de reação retail por controle; polling real;
distribuição evento→aceitação; ganho pareado da migração local; custos Android
da política; operação sustentada sob concorrência; actuator/onboarding
autossuficiente; e teto global da política. Um resultado válido pode ser
DISPROVEN ou INCONCLUSIVE. Nenhum desses itens é resolvido por trocar o host
por um APK mais rápido.
