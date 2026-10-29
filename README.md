# Nitro Indicator

Uma extensão do **GNOME Shell** que faz o papel do **NitroSense** da Acer no Linux,
direto da barra superior: troca o **modo de desempenho** (Eco, Silencioso,
Equilibrado, Performance) e mostra **ventoinhas**, **temperaturas** e a **GPU NVIDIA**
ao vivo. Usa o driver `acer_wmi` do próprio kernel (opção `predator_v4`) — nada de
módulo de terceiros pra recompilar a cada atualização.

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
| `/usr/local/bin/nitro-fan` | Helper de root das ventoinhas (`auto` ou `max`) via módulo `nitro_fan` |
| `/lib/modules/<kernel>/extra/nitro_fan.ko` + `/etc/modules-load.d/nitro_fan.conf` | Módulo próprio (`system/kmod`) que manda à BIOS o mesmo comando WMI de ventoinhas do NitroSense. Compilado para o kernel atual: **depois de atualizar o kernel, rode `./install.sh` de novo** (precisa de `kernel-devel`, `gcc` e `make`) |
| `~/.local/bin/nitro-mode` | Comando dos modos (sem root); também serve para lançadores de jogos |
| `~/.local/share/gnome-shell/extensions/nitro@eltobsjr.gmail.com` | A extensão |

Se o `acer_wmi` já estiver carregado, ele é recarregado na hora com `predator_v4=1`.

## O que tem no menu

- **Ícone na barra** com a cor do modo atual + temperatura da CPU (fica vermelha a
  partir de 90 °C).
- **Cartão do topo**: modo atual e se está na tomada ou na bateria.
- Ordem do menu: Perfil, Ventoinhas, Sensores, Modos e GPU. Perfil e Ventoinhas são
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
- **Ventoinhas**: *Automático* (a BIOS decide) ou *Máximo* (cerca de 7000 rpm, medido). Fica
  salvo e é reaplicado no login. A legenda ao lado do título mostra quem controla
  ("BIOS no controle" ou "Rotação máxima fixa").
- **Modos**: conjuntos nomeados de ajustes que se ligam e desligam de uma vez. Vêm dois
  prontos, *Gamer* e *Silêncio*; dá para criar, renomear e excluir os seus pela engrenagem
  de cada linha. O modo ligado fica marcado com o indicador de seleção. Cada modo guarda (ou deixa em "—" para não mexer):

  | Ajuste | Opções |
  |---|---|
  | Perfil | Eco, Silencioso, Equilibrado, Performance |
  | Ventoinhas | Automático, Máximo |
  | Overclock da GPU | Padrão, Boost (+100/+500 MHz), Máximo (+150/+1000), Livre (núcleo e memória) |
  | Limite de potência da GPU | 30 a 65 W, **só se o driver deixar**: no ANV15-51 ele responde `Not Supported` e o limite fica fixo em 50 W |
  | CPU em performance | governor e EPP via `tuned` (`throughput-performance`) |
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
login** (o firmware volta para `balanced` a cada boot).

## Limitações

- **Turbo** (`performance`): aparece em `platform_profile_choices`, mas o ANV15-51 não tem
  Turbo no firmware: a BIOS recusa (`EIO`) na bateria e na tomada. O **Performance** do
  NitroSense é o `balanced-performance`, o máximo que a máquina aceita, então o botão
  Turbo fica escondido. Subir o limite de potência da CPU (PL1) também não deu ganho: a
  máquina já trava por temperatura. Evidências em
  [`docs/ENGENHARIA-REVERSA.md`](docs/ENGENHARIA-REVERSA.md).
- **Ventoinha em porcentagem** (curva personalizada) e **RGB do teclado**: o `acer_wmi` do
  kernel não expõe e o `nitro_fan` só implementa os modos *Automático* e *Máximo* (o
  comando de velocidade ainda não foi mapeado). Para RGB existe o
  [DAMX](https://github.com/PXDiv/Div-Acer-Manager-Max), que troca o driver por um módulo próprio.
- **Overclock da GPU** acima de +100/+500 MHz depende do silício e do calor: o helper só
  garante que o valor está dentro da faixa do driver, não que o jogo ficará estável.
- O sensor de "qual ventoinha é qual" não é rotulado pelo driver — por isso
  *Ventoinha 1* e *Ventoinha 2*.

## Desenvolvimento

```bash
make check     # sintaxe JS/shell, metadata.json e XML do polkit
make install   # = ./install.sh
make pack      # .zip só da extensão
make uninstall # remove extensão, estado e arquivos do sistema
```

Pelo terminal dá pra trocar o modo direto: `pkexec nitro-profile quiet`.

## Licença

MIT — veja [LICENSE](LICENSE).
