# Nitro Indicator

Uma extensão do **GNOME Shell** que faz o papel do **NitroSense** da Acer no Linux,
direto da barra superior: troca o **modo de desempenho** (Eco, Silencioso,
Equilibrado, Performance), controla as **ventoinhas** (automático, máximo ou **curva por
temperatura**), liga o **limite de carga da bateria em 80%**, mostra **temperaturas** (com
histórico), a **GPU NVIDIA** e os **periféricos** (controle, mouse, teclado e bateria dos sem
fio, com o botão que está sendo apertado) ao vivo. Usa o driver `acer_wmi` do próprio kernel
(opção `predator_v4`); o que o kernel ainda não tem vem de dois módulos pequenos, recompilados
sozinhos pelo **DKMS** a cada kernel novo.

Feita e testada num **Acer Nitro V15 (ANV15-51)** com i5-13420H + RTX 3050 6 GB,
Fedora 44 / GNOME 50 (Wayland).

## Instalação

```bash
git clone https://github.com/eltobsjr/nitro-indicator.git
cd nitro-indicator
./install.sh
gnome-extensions enable nitro@eltobsjr.gmail.com
```

O `install.sh` pede a senha de administrador **uma vez** (só se algo mudou) para
instalar a parte do sistema. No **Wayland** é preciso fazer **logout/login** depois
de instalar ou atualizar (o `install.sh` não recarrega o Shell).

### Tema e opções (escolhidos na instalação)

O `./install.sh` pergunta no terminal, antes de copiar qualquer coisa:

- **Paleta**: Catppuccin Macchiato (padrão), Frappé ou Mocha, com uma prévia em cores.
- **Cor de destaque**: 12 opções, ou **seguir o destaque do GNOME** (47+).
- **Opções da extensão**: se deve instalar o helper do sistema (polkit + `acer_wmi`, pede senha).

Nenhuma cor fica escrita no código: o `stylesheet.css` é gerado na instalação a partir da paleta que você escolheu.
Para refazer as escolhas, rode `./install.sh --reconfigure`. Sem terminal (CI, `curl | bash`) ou com `--yes`,
vale o que já estava salvo ou o padrão. Também aceita `--palette macchiato|frappe|mocha`, `--accent blue|mauve|…` e `--system-accent`.
Detalhes do padrão visual em [`docs/DESIGN.md`](docs/DESIGN.md).

## O que o instalador faz

| Arquivo | Para quê |
|---|---|
| `/etc/modprobe.d/acer-nitro.conf` | `options acer_wmi predator_v4=1` — liga os modos térmicos e a leitura das ventoinhas da Acer (`/sys/firmware/acpi/platform_profile` e o hwmon `acer`) |
| `/usr/local/bin/nitro-profile` | Helper mínimo que só aceita um dos perfis listados em `platform_profile_choices` e grava no `platform_profile` |
| `/usr/share/polkit-1/actions/com.eltobsjr.nitro.policy` | Deixa a extensão chamar o helper via `pkexec` **sem senha** na sessão ativa (só esse executável) |
| `/usr/local/bin/nitro-boost` | Helper de root da GPU NVIDIA (NVML): offsets de clock, limite de potência e EPP do CPU. Confere tudo com a faixa que o driver informa |
| `/usr/local/bin/nitro-fan` | Helper de root das ventoinhas (`auto`, `max`, `custom CPU% GPU%`, `curve on/off/set`). Usa o `pwm` do hwmon `acer` quando o kernel já tem (acer-wmi com o quirk do ANV15-51, que entrou no kernel oficial em out/2026); senão o módulo `nitro_fan` |
| `/usr/local/bin/nitro-fancurve` + `nitro-fancurve.service` | Serviço root da **curva de ventoinha**: lê CPU/GPU a cada 2 s e ajusta a velocidade (sobe na hora, desce devagar; 100% acima de 92 °C). Ao parar, devolve as ventoinhas à BIOS. Curva em `/etc/nitro/fan-curve.json` |
| `/usr/local/bin/nitro-battery` | Helper de root do limite de carga (`on` = 80%, `off` = 100%) |
| `nitro_fan.ko` e `nitro_battery.ko` pelo **DKMS** (`nitro-kmod`) + `/etc/modules-load.d/nitro_fan.conf` | Módulos próprios (`system/kmod`). `nitro_fan`: mesmo comando WMI de ventoinhas do NitroSense (modo e velocidade), **só carrega nos modelos testados** (tabela DMI; `force=1` para arriscar). `nitro_battery`: "health mode" da Acer exposto como `charge_control_end_threshold` padrão do kernel. O DKMS recompila a cada kernel novo; sem DKMS o instalador compila só para o kernel atual |
| `/etc/tuned/profiles/nitro-performance` + `/etc/tuned/ppd.conf` | Integração com o **tuned-ppd**: o "Desempenho" das Configurações rápidas passa a pedir o perfil Acer que o firmware aceita (o original pedia `performance`, recusado com EIO). Backup em `ppd.conf.nitro-orig` |
| `~/.local/bin/nitro-mode` | Comando dos modos (sem root); também serve para lançadores de jogos |
| `~/.local/bin/nitro-input` | Leitor de controles (sem root; o systemd já dá acesso aos joysticks). Só roda com o menu ou o testador aberto |
| `~/.local/bin/nitro-gpuapps` | Lista os processos com a GPU NVIDIA aberta e encerra os seus (sem root) |
| `/etc/udev/hwdb.d/61-nitro-battery.hwdb` | Faz o UPower (e o GNOME) enxergar o limite de carga do `nitro_battery` |
| `~/.config/gamemode.ini` | Só se você não tiver um: o GameMode chama o `nitro-mode` ao abrir e fechar jogos |
| `~/.local/share/nitro/defaults.json` | Campos e modos de fábrica: fonte única para a extensão e o `nitro-mode` |
| `~/.local/share/gnome-shell/extensions/nitro@eltobsjr.gmail.com` | A extensão |

Se o `acer_wmi` já estiver carregado, ele é recarregado na hora com `predator_v4=1`.

## O que tem no menu

- **Ícone na barra** com a cor do modo atual + temperatura da CPU (fica vermelha a
  partir de 90 °C).
- **Cartão do topo**: modo atual e se está na tomada ou na bateria.
- Ordem do menu (padrão): Perfil, Ventoinhas, Limite de carga, Sensores, Histórico, Modos,
  Periféricos e GPU. O cartão do topo fica fixo e o resto **rola**. **Tudo isso é editável** em
  Preferências › Laboratório (veja abaixo).
- **Selo "LIMITANDO"** no canto do bloco da CPU quando o kernel registrou limitação por
  temperatura nos últimos 30 s; na GPU, também "NO LIMITE" quando ela está presa no limite de
  energia (motivos do `nvidia-smi`).
- **Na bateria**, o subtítulo do topo mostra consumo e tempo restante ("Na bateria · 11,8 W ·
  2 h 40 min"), e a linha do limite de carga mostra a saúde da bateria e os ciclos.
- **Apps usando a GPU**: a pílula "N apps" no cartão da GPU abre a lista de processos que estão
  com a placa aberta (lida em `/proc`, sem acordá-la), com **Fechar** (SIGTERM) e **Forçar**
  (SIGKILL) sempre à mão. Processos da sessão (`gnome-shell`, Xwayland) aparecem como
  "sistema" e sem botões; só dá para encerrar processos seus. Perfil e Ventoinhas são
  controles segmentados (só o item ativo recebe cor) e cada grupo tem o mesmo título em
  lavender.
- **Perfil** — os mesmos perfis do NitroSense:

  | Botão | `platform_profile` |
  |---|---|
  | Eco | `low-power` |
  | Silencioso | `quiet` |
  | Equilibrado | `balanced` |
  | Performance | `balanced-performance` |

  Trocar o modo mostra o OSD do GNOME. A **tecla Turbo/NitroSense** do teclado alterna
  entre **Performance** e o modo que você usava antes dele (veja abaixo). Se o modo mudar
  por fora (por exemplo, `pkexec nitro-profile quiet`), a extensão acompanha e mostra o OSD.

### Tecla Turbo

No ANV15-51 a tecla não passa pelo `acer_wmi`: o teclado a envia como `KEY_PROG1`
(`XF86Launch1`). A extensão registra esse atalho no Shell (sem root) e a tecla alterna
**Performance** ⇄ último modo. Se a captura falhar (por exemplo, outro atalho
já usar `XF86Launch1`), a extensão simplesmente não reage à tecla e o resto continua
funcionando; esse caso não foi testado. Detalhes e medições em
[`docs/ENGENHARIA-REVERSA.md`](docs/ENGENHARIA-REVERSA.md).
- **Ventoinhas**: *Automático* (a BIOS decide), *Máximo* (cerca de 7000 rpm, medido) ou
  *Curva* (serviço `nitro-fancurve`, editável nas preferências com prévia em gráfico). Fica
  salvo e é reaplicado no login. A legenda ao lado do título mostra quem controla.
- **Limite de carga em 80%**: interruptor que liga o "health mode" da bateria (o mesmo do
  Acer Care Center). Some do menu se o módulo `nitro_battery` não estiver carregado.
- **Histórico**: gráfico de CPU e GPU dos últimos 3 minutos (desligável).
- **Periféricos**: controles, mouses, teclados e touchpad conectados, bateria dos sem fio (UPower)
  e um ponto que acende no aparelho usado, com o último botão ou atalho apertado.
  **Testar periféricos…** abre um testador com mouse, controle (analógicos, gatilhos, direcional,
  todos os botões) e teclado ABNT2 desenhados, acendendo em tempo real. A entrada só é lida com
  o menu ou o testador aberto.
- **Modos**: conjuntos nomeados de ajustes que se ligam e desligam de uma vez. Vêm dois
  prontos, *Gamer* e *Silêncio*; dá para criar, renomear e excluir os seus nas
  **preferências** (engrenagem de cada linha ou *Editar modos…*). O modo ligado fica marcado com o indicador de seleção. Cada modo guarda (ou deixa em "—" para não mexer):

  | Ajuste | Opções |
  |---|---|
  | Perfil | Eco, Silencioso, Equilibrado, Performance |
  | Ventoinhas | Automático, Máximo, Curva |
  | Overclock da GPU | Padrão, Boost (+100/+500 MHz), Máximo (+150/+1000), Livre (núcleo e memória) |
  | Limite de potência da GPU | 30 a 65 W, **só se o driver deixar**: no ANV15-51 ele responde `Not Supported` e o limite fica fixo em 50 W |
  | CPU em performance | governor e EPP via `tuned` (`nitro-performance`, ou `throughput-performance` sem a integração) |
  | Só na tomada | ignora o modo na bateria |
  | Ligar ao abrir jogo | liga sozinho quando o GameMode registrar um jogo (só um modo por vez) |

  Ao desligar, tudo volta ao estado de antes de ligar. O que um modo ligado muda não
  sobrevive a um reboot (o hardware volta ao padrão), e o estado "ligado" é descartado.
  Na linha de comando: `nitro-mode on gamer`, `nitro-mode off`, `nitro-mode list`.
  Os modos ficam em `~/.config/nitro/modes.json`.
  Como os modos e as ventoinhas funcionam por dentro (e o que foi medido):
  [`docs/VENTOINHAS-E-MODOS.md`](docs/VENTOINHAS-E-MODOS.md).
- **Sensores**: temperatura da CPU (pacote, `coretemp`), da GPU e RPM das duas
  ventoinhas, em peças 2×2 com o número grande e uma barra verde/amarelo/vermelho.
- **GeForce RTX 3050**: consumo (W), clock, uso de VRAM (fica vermelho acima de 90 %)
  e uso da GPU. Quando a dGPU está em **repouso** (RTD3), a extensão **não** chama o
  `nvidia-smi` — senão ela acordaria a placa e gastaria bateria à toa.

O último modo escolhido fica em `~/.local/state/nitro/profile` e é **reaplicado no
login** (o firmware volta para `balanced` a cada boot); ventoinhas e limite de carga também,
mas só quando estão diferentes do salvo (nada de `pkexec` a cada desbloqueio de tela).

## Laboratório (Preferências › Laboratório)

O menu é uma **grade de 4 colunas** que você monta arrastando:

- **Layouts prontos**: Clássico (o menu de sempre), Compacto, Central de controle, Gamer e Mínimo.
- **Personalizado**: ao mexer na grade, o layout vira *Personalizado* sozinho e a sua edição fica
  guardada à parte; escolher um pronto não a apaga, e clicar em *Personalizado* a traz de volta.
- **Meus layouts**: *Salvar como…* guarda a grade com um nome (nome repetido substitui). No lápis
  de cada um: renomear, substituir pela grade atual ou apagar (pede um segundo clique). O layout em
  uso — pronto, salvo ou personalizado — fica com contorno.
- **Posição livre**: cada item vai na célula que você escolher. Soltar em cima de outro item
  **troca os dois** de lugar; se não der para trocar (vários itens no caminho, ou item novo vindo da
  gaveta), quem está no caminho **desce** para abrir espaço. Linhas que ficam vazias somem.
  A prévia fica verde quando dá para soltar e vermelha fora da grade.
- **Tamanhos**: ladrilhos 1×1, 2×1, 2×2 e 4×2 (CPU, GPU, cada ventoinha, bateria, perfil, limite de
  carga, 60 Hz, GameMode, histórico, curva, apps da GPU com Fechar/Forçar…) ou o **bloco clássico** de
  largura inteira, com as variantes de antes (faixa com ícones ou só nomes, sensores 2×2 ou em uma
  linha, histórico normal ou curto, GPU completa ou só o título).
- **Distância entre os itens**: 0 a 24 px.
- **Barra superior**: ícone, temperaturas, modo ligado, rotação e consumo, na ordem que quiser.
- Teclado: setas movem uma célula (em cima de outro item, trocam), + e − trocam o tamanho, Delete
  tira, Enter abre as opções.

Por baixo são as chaves `grid-items` (`id:tamanho:linha:coluna`, o que o menu mostra), `grid-custom`
(o Personalizado), `saved-layouts` (JSON `[{"name", "items"}]`), `grid-gap` e `panel-items`.
As regras da grade (soltar, trocar, empurrar, layouts com nome) ficam em `extension/layout.js`, com
testes em `tests/store.test.js`.

## Preferências

`gnome-extensions prefs nitro@eltobsjr.gmail.com` (ou *Editar modos…* no menu):

- **Geral**: tecla NitroSense, **perfil automático na tomada e na bateria**, **tela a 60 Hz
  na bateria** (só a tela do notebook; a taxa de antes volta na tomada), **modo de jogo pelo
  GameMode** (cria/apaga um `~/.config/gamemode.ini` que chama `nitro-mode auto-start` e
  `auto-stop`; funciona com a extensão desligada) e um **estado do sistema** (ventoinhas,
  limite de carga, integração com o PPD e com as Configurações do GNOME, thermald, ratbagd).
- **Modos**: editor completo dos modos (substitui o editor que ficava dentro do menu).
- **Curva de ventoinha**: pontos °C → % com gráfico; *Salvar curva* grava via `pkexec`.

## Perfis de energia do GNOME (tuned-ppd)

No Fedora o "Modo de energia" das Configurações rápidas é o `tuned-ppd`. Antes ele brigava
com a extensão: o "Desempenho" pedia um perfil que o firmware recusa, e ligar ou tirar da
tomada reaplicava o perfil dele por cima do escolhido. Agora:

- o instalador aponta o "Desempenho" para o `nitro-performance` (perfil Acer
  `balanced-performance`);
- com a integração, Eco, Equilibrado e Performance da extensão passam pelo próprio PPD, e as
  Configurações rápidas ficam em sincronia (Silencioso não tem equivalente e vai direto);
- ao trocar a fonte de energia, a extensão espera o tuned terminar e devolve o perfil
  escolhido (ou o automático da tomada/bateria, se configurado);
- o **Silencioso** não tem par no GNOME: a extensão põe o PPD em Equilibrado (o mais perto) e
  o Silencioso por cima, que o tuned-ppd não desfaz.

O **limite de carga** também entra nas Configurações do GNOME: o instalador põe uma entrada no
hwdb do UPower (`/etc/udev/hwdb.d/61-nitro-battery.hwdb`, `CHARGE_LIMIT=_,80`), e aí o
"Preservar a saúde da bateria" e o interruptor do menu mandam no mesmo limite (o menu passa a
usar o UPower quando ele reconhece a bateria).

## Periféricos

- **Controles**: os nomes dos botões vêm do banco de mapeamentos da SDL (o mesmo do Steam,
  `extension/data/gamecontrollerdb-linux.txt`) quando o controle está nele; senão, do kernel. O
  cartão do testador diz qual ("SDL" ou "kernel").
- **DPI do mouse**: com o `ratbagd` (pacote `libratbag-ratbagd`) e um mouse suportado, o
  testador mostra os níveis de DPI e troca o ativo.

## Limitações

- **Turbo** (`performance`): aparece em `platform_profile_choices`, mas o ANV15-51 não tem
  Turbo no firmware: a BIOS recusa (`EIO`) na bateria e na tomada. O **Performance** do
  NitroSense é o `balanced-performance`, o máximo que a máquina aceita, então o botão
  Turbo fica escondido. Subir o limite de potência da CPU (PL1) também não deu ganho: a
  máquina já trava por temperatura. Evidências em
  [`docs/ENGENHARIA-REVERSA.md`](docs/ENGENHARIA-REVERSA.md).
- **RGB do teclado**: não implementado. Para RGB existe o
  [DAMX](https://github.com/PXDiv/Div-Acer-Manager-Max), que troca o driver por um módulo próprio.
- **Limite de carga**: o firmware só tem liga/desliga em 80%; qualquer valor abaixo de 100
  escrito no `charge_control_end_threshold` vira 80.
- **Mapeamento do controle**: segue os códigos do kernel (`BTN_SOUTH` = A embaixo,
  `BTN_NORTH` = Y em cima). Drivers que trocam X/Y aparecem trocados no desenho; a lista de
  chips embaixo mostra sempre o código real.
- **Overclock da GPU** acima de +100/+500 MHz depende do silício e do calor: o helper só
  garante que o valor está dentro da faixa do driver, não que o jogo ficará estável.
- O sensor de "qual ventoinha é qual" não é rotulado pelo driver — por isso
  *Ventoinha 1* e *Ventoinha 2*.

## Solução de problemas

**"módulo nitro_fan não carregado (rode o install.sh)"** — aparece na faixa vermelha do
menu ao aplicar um modo com ventoinhas, e a seção *Ventoinhas* fica acinzentada (com um aviso
amarelo explicando). Os sensores e o resto do modo continuam funcionando; só o controle das
ventoinhas falha. As **Preferências › Geral › Estado do sistema** mostram o que falta.
Causas comuns:

- O módulo nunca foi instalado, ou foi instalado **sem DKMS** e o kernel foi atualizado.
  Rode `./install.sh` de novo: ele instala o `dkms` (Fedora), registra os módulos e dali em
  diante eles são recompilados sozinhos. Precisa de `kernel-devel` e senha de administrador.
  Conferir: `dkms status nitro-kmod`.
- **Secure Boot** ligado bloqueia módulos não assinados (`mokutil --sb-state`). O DKMS
  assina com a chave dele; registre-a uma vez: `sudo mokutil --import /var/lib/dkms/mok.pub`
  e confirme no próximo boot.
- **Modelo diferente do ANV15-51**: o `nitro_fan` recusa carregar (veja `sudo dmesg | grep
  nitro_fan`). Se você sabe o que está fazendo: `sudo modprobe nitro_fan force=1`.

Para conferir: `lsmod | grep nitro_fan` e `cat /sys/kernel/nitro_fan/mode` (`unknown` até
o primeiro modo ser aplicado; depois `auto` ou `max`). Se o `modprobe` falhar, veja
`sudo dmesg | tail`. Depois de instalar, aplique o modo de novo no menu; se a extensão
ainda mostrar o aviso antigo, faça logout/login (Wayland).

## Desenvolvimento

```bash
make test      # check + testes (nitro-mode, curva, nitro-input, store/utils/devices no gjs)
make check     # sintaxe JS/Python/shell, JSON, XML, schema, tradução e contraste do tema
make kmod      # compila os módulos para o kernel atual sem instalar
make po        # extrai as strings e regera po/pt_BR.po (traduções em po/translate-pt_BR.py)
make install   # = ./install.sh
make pack      # .zip só da extensão (tema, schema e traduções compilados)
make uninstall # = ./uninstall.sh (remove tudo; ~/.config/nitro/modes.json fica)
sudo system/kmod/teste.sh   # teste no hardware: ventoinhas (max/custom/auto) e limite de carga
```

As strings da interface ficam em inglês no código (padrão do gettext) e a tradução em
português vem de `po/pt_BR.po`.

Pelo terminal dá pra trocar o modo direto: `pkexec nitro-profile quiet`.

## Licença

MIT — veja [LICENSE](LICENSE).
