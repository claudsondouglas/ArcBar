# ArcBar

Uma barra do topo minimalista para o GNOME Shell, de fundo chapado `#121212`. Ela **toma
conta** do painel do GNOME em vez de criar outro actor: esconde os indicadores nativos
(atividades, menu de data, ajustes rápidos) e põe os widgets dela no lugar. Assim struts,
overview, tela cheia e multi-monitor continuam se comportando como no GNOME original, e
desativar a extensão devolve tudo o que ela escondeu.

Faz parte do **Project Arc**, ao lado da [ArcDock](../ArcDock@claudson), da
[ArcTab](../ArcTab@claudson) e da [ArcDesk](../ArcDesk@claudson).

Na área de trabalho e no overview a barra é transparente; ela fica sólida assim que uma janela
da área de trabalho ativa encosta na faixa do painel, no monitor primário. Nem os ícones nem o
texto são branco puro: são levemente translúcidos, pra barra não gritar mais alto que as
janelas.

## Onde fica cada coisa

| Canto | Widgets, da esquerda para a direita |
|---|---|
| **esquerda** | CPU e memória, armazenamento, apps em segundo plano |
| **centro** | notificações |
| **direita** | relógio, rede, Bluetooth, som, energia |

A ordem vem do índice de inserção no `extension.js`, não do CSS. Quatro widgets somem da barra
quando não têm o que dizer: o de notificações sem nada pendente, o de apps em segundo plano sem
nenhum app escondido, o de Bluetooth sem adaptador e o de som sem saída de áudio. Como uma box
pula o filho invisível junto com o espaçamento que viria com ele, não sobra buraco no lugar.

## CPU e memória

Na ponta esquerda, o uso atual de cada uma, como ícone e porcentagem, sem legenda. Clicar em
qualquer uma das duas abre o Monitor do Sistema.

As duas saem do `/proc` a cada dois segundos, numa leitura síncrona (o arquivo é montado pelo
kernel na hora e não toca em disco, então ler assim custa menos que armar uma leitura
assíncrona duas vezes por segundo). O valor de CPU é sempre a média **desse** intervalo, porque
lá os números são contadores desde o boot, e o `iowait` conta como ocioso: esperar o disco é a
máquina parada, não calculando, e somá-lo faria uma cópia de arquivos parecer 100% de CPU. Na
primeira leitura, sem amostra anterior para subtrair, o que aparece é a média desde o boot,
substituída dois segundos depois. A memória é `MemTotal - MemAvailable`, ou seja, o cache de
disco conta como livre.

## Armazenamento

Logo depois das medidas, um ícone de disco e a porcentagem de uso somada de todos os sistemas
de arquivos locais montados. Clicar abre um menu de vidro com:

- um resumo no topo: quanto está usado, quanto está livre e de quanto no total;
- uma linha por sistema de arquivos, com ícone, nome, porcentagem, barra de uso, quanto está
  usado e livre, e o ponto de montagem.

A barra de cada linha muda de cor conforme o nível: azul até 74%, laranja a partir de 75% e
vermelha a partir de 90%. Nesses dois últimos casos a porcentagem da linha também fica
destacada, na mesma cor.

Os discos vêm do `GVolumeMonitor`, só as montagens nativas, e a raiz `/` entra sempre, mesmo
nas sessões em que o monitor não a enumera. A medida é refeita a cada meia hora, sempre que uma
montagem aparece, some ou muda, e toda vez que o menu é aberto. Se nenhum disco puder ser
medido, o menu diz "Armazenamento indisponível".

## Apps em segundo plano

Os ícones dos apps que estão rodando **sem nenhuma janela**, aqueles que foram fechados para
uma bandeja que o GNOME não desenha. Clicar num ícone traz o app de volta; o botão direito abre
um menu com **Encerrar**.

A lista não vem do portal `org.freedesktop.background.Monitor`, que só conhece o app que se
declarou por conta própria e responde vazio para quase tudo, e sim do **systemd**: todo app que
o shell lança ganha um escopo `app-*.scope` no `app.slice`, e esse escopo sobrevive a janelas,
ícones de bandeja e portais, morrendo só com o último processo do app. Os escopos ativos
cruzados com os apps sem janela são a definição inteira de "em segundo plano". Minimizada não
conta: uma janela minimizada ainda é uma janela.

Clicar chama o mesmo `activate()` da grade de aplicativos, então um app de instância única
mostra a janela que já tinha em vez de abrir uma segunda, e o ícone sai da barra sozinho assim
que ela aparece. **Encerrar** chama `StopUnit` em cada escopo do app, o que termina o cgroup
completo, inclusive os processos auxiliares e o ícone de bandeja, e não só o processo que o
abriu.

Um daemon de sessão também tem escopo, mas não vira ícone: o `.desktop` dele é `NoDisplay`, e
ninguém "deixou ele aberto".

## Notificações

No centro da barra, os ícones dos apps que têm notificação pendente (até três) ao lado do
total. Clicar abre um menu de vidro com o título "Notificações", o botão "Limpar tudo" e uma
lista rolável com uma linha por notificação: ícone do app, título, corpo, hora e um `x`.

- clicar na linha ativa a notificação (abre o app) e a dispensa;
- o `x` da direita dispensa sem abrir nada;
- "Limpar tudo" dispensa todas de uma vez.

A lista **é** a bandeja do shell, não uma cópia dela: dispensar aqui é o mesmo
`Notification.destroy(DISMISSED)` que o `x` do banner chama, então a notificação sai da barra,
da fila de banners e do menu de data do GNOME ao mesmo tempo, e vice-versa. Abrir o menu também
marca tudo como visto, senão a mesma notificação voltaria como banner depois de lida aqui.

O ícone de cada linha é o do **app**, resolvido pelo tema de ícones, e não a imagem que o app
mandou junto com a notificação: essa costuma ser o PNG embutido nele, e seria o único desenho
fora do tema numa tela inteira de ícones temáticos. Quando não há app instalado que responda
pela notificação, a última tentativa é um nome que o tema tenha, e só então a imagem crua.

Sem nada pendente o botão inteiro sai da barra, e o menu fecha junto: dispensar a última linha
sumiria com o botão embaixo de um menu ainda aberto.

## Relógio

Abrindo o canto direito, antes do ícone de rede: `Qui 20 de Ago 14:44`. O dia da semana e o mês
vêm do idioma do sistema, com a inicial maiúscula que a glibc não dá; o resto do formato é
fixo, então as chaves `clock-format` e `clock-show-*` da área de trabalho não têm nada a
decidir aqui. O rótulo se reprograma para o minuto cheio seguinte em vez de ficar sondando.

É um `St.Label` puro, sem menu: **não há calendário nem agenda**. Ver *Limitações conhecidas*.

## Rede

O ícone da conexão **cabeada**: conectada, obtendo endereço ou fora. Não tem menu; o clique
abre as Configurações direto na página de rede, pedindo o painel pelo `.desktop` dele (o mesmo
caminho que o próprio GNOME usa), com `gnome-control-center network` como reserva.

O estado vem do mesmo NetworkManager que o indicador do próprio GNOME lê, então os dois ícones
nunca discordam. O cliente é criado de forma assíncrona porque essa primeira conversa passa
pelo D-Bus dentro do `enable()`, e travar o laço principal ali é travar a sessão inteira
enquanto ela abre. Numa máquina com duas portas, a que está conectada é a resposta.

**Só placas Ethernet entram na conta**: não há Wi-Fi. Ver *Limitações conhecidas*.

## Bluetooth

Estado do adaptador e dispositivos, lidos da mesma biblioteca (`GnomeBluetooth`) que o GNOME
usa. Sem adaptador nenhum, o botão sai da barra.

O menu de vidro traz uma linha por dispositivo pareado, confiável ou conectado, com o ícone do
tipo, o nome, a bateria quando o aparelho a informa, e um ícone dizendo se está conectado.
Clicar na linha conecta ou desconecta aquele dispositivo. Sem nenhum, a linha diz "Nenhum
dispositivo pareado" ou "Bluetooth desligado", conforme o adaptador. No fim, um atalho para as
"Configurações de Bluetooth".

Aparelhos apenas descobertos por perto não entram na lista, do mesmo jeito que no submenu
nativo. O menu é reconstruído a cada abertura, para refletir conexão e bateria.

## Som

Rolar a roda sobre o ícone muda o volume do sistema sem abrir nada, com o mesmo OSD do GNOME (e
sem OSD quando o menu já está aberto, porque aí o slider é a resposta). Clicar abre um menu de
vidro com quatro partes:

- **Sistema**: a saída padrão, com ícone, porcentagem e slider;
- **Saída** e **Microfone**: submenus para escolher o dispositivo, com uma marca no que está
  ativo; cada um some quando não há nenhum;
- **Aplicativos**: uma linha e um slider por app tocando algo, pra abaixar um vídeo sem mexer
  na música.

Clicar no ícone de qualquer linha muta e desmuta só aquela linha, e o app mutado mantém o
ícone, apagado: trocá-lo por um alto-falante cortado apagaria a única coisa que a linha existe
para dizer, que é *de quem* é aquele som. Os apps entram e saem da lista sozinhos conforme
começam e param de tocar; sons de evento (o "pop" de uma notificação) e streams virtuais ficam
de fora, senão uma linha piscaria por meio segundo a cada aviso.

Tudo passa pelo mixer do próprio shell, então esses sliders, as teclas de volume e os ajustes
rápidos sempre mostram o mesmo número. Sem nenhuma saída de áudio o botão sai da barra.

## Energia

- Desligar
- Reiniciar
- Suspender
- Reiniciar sessão (encerra a sessão e volta para o GDM)

Os quatro passam pelo `SystemActions` do próprio shell, então os diálogos de confirmação, os
inibidores e as travas de administração se comportam como no GNOME original, e uma ação
indisponível some do menu em vez de falhar calada. No Wayland não existe reiniciar o shell no
lugar, e é por isso que a última é "Reiniciar sessão" e não "Reiniciar o GNOME".

## Os menus de vidro

Armazenamento, notificações, Bluetooth, som, energia e o menu de contexto dos apps em segundo
plano são todos a mesma superfície, montada por um único `applyGlassMenu()`: fundo claro quase
opaco, com um borrão por trás, uma borda de um fio e cantos arredondados. É o mesmo cinza do
menu de contexto da ArcDock, que é o único outro menu que nasce dessa mesma barra e dessa
mesma dock: dois cinzas parecidos lado a lado leriam como erro, não como estilo.

## Limitações conhecidas

São limitações reais, lidas no código, e não pendências com prazo. A extensão foi feita para
uma máquina específica e é simples porque é assim que ela funciona.

- **Nenhuma tela de preferências.** Não existe `prefs.js` nem `schemas/`: cor, espaçamento,
  quais widgets aparecem e em que ordem, nada disso muda pela interface. O que dá pra ajustar
  está no `local.css`; a presença e a ordem dos widgets, no `extension.js`.
- **A rede só enxerga cabo.** O modelo filtra por `NM.DeviceType.ETHERNET`, então numa máquina
  com Wi-Fi o ícone fica permanentemente desconectado e não há como escolher rede pela barra.
- **Sem calendário e sem agenda.** O relógio é um `St.Label` sem menu, e a tomada do painel
  esconde o menu de data do GNOME: a sessão fica sem os dois em lugar nenhum.
- **Sem bateria.** Nada lê o UPower, então em notebook não há indicador de carga, tempo
  restante nem aviso de bateria fraca.
- **O Bluetooth não liga nem desliga o adaptador.** O menu conecta e desconecta dispositivos
  já conhecidos; ligar o rádio, parear um aparelho novo ou desfazer um pareamento é nas
  Configurações.
- **Textos fixos em português.** Não há gettext nem `locale/`: as strings estão escritas no
  meio do código. Em sessão em inglês a interface fica misturada.
- **Só na sessão do usuário.** O `metadata.json` declara `session-modes: user`, então na tela
  de bloqueio a extensão é desativada e o painel do GNOME volta ao normal; o `enable()` roda de
  novo ao desbloquear.

## Requisitos

- **GNOME Shell 46 a 50**, que é o que o `metadata.json` declara
- Wayland ou Xorg
- NetworkManager e GnomeBluetooth 3.0, que já vêm com uma sessão GNOME padrão

## Instalação

O nome da pasta precisa ser exatamente o UUID declarado no `metadata.json`:

```bash
git clone https://github.com/claudsondouglas/ArcBar.git \
  ~/.local/share/gnome-shell/extensions/ArcBar@claudson
```

Não há esquema para compilar, porque não há `schemas/`. Recarregue o Shell (veja abaixo) e
ative:

```bash
gnome-extensions enable ArcBar@claudson
```

Ou pelo aplicativo **Extensões**.

## Recarregar depois de editar

- **Xorg:** `Alt+F2` → `r` → `Enter`. Reinicia o shell e força a reimportação dos módulos.
- **Wayland:** `disable` seguido de `enable` roda o `enable()` de novo, mas o GNOME 46+ mantém
  os módulos ESM em memória, então edições em `src/*.js` costumam ficar invisíveis. Se uma
  linha de log nova não aparecer depois do enable, você está rodando código velho: faça logout
  e login. Não existe atalho.
- **Extensão nova** no Wayland só é vista depois de logout e login.
- **CSS** recarrega junto com o shell, então um ajuste de estilo é barato.

```bash
journalctl --user -f -o cat _COMM=gnome-shell | grep -i arcbar
```

## Estilo

O `stylesheet.css` é **gerado** e não deve ser editado: ele é o `common.css` do ArcSuite
(`~/.local/share/arcsuite/`) concatenado com o `local.css` desta extensão. Mexa num dos dois e
rode o sincronizador:

```bash
~/.local/share/arcsuite/sync.sh ArcBar@claudson
```

## Licença

MIT. Veja o arquivo [LICENSE](LICENSE).
