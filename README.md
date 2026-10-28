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
| `~/.local/share/gnome-shell/extensions/nitro@eltobsjr.gmail.com` | A extensão |

Se o `acer_wmi` já estiver carregado, ele é recarregado na hora com `predator_v4=1`.

## O que tem no menu

- **Ícone na barra** com a cor do modo atual + temperatura da CPU (fica vermelha a
  partir de 90 °C).
- **Cartão do topo**: modo atual e se está na tomada ou na bateria.
- **Seletor de modo** — os mesmos perfis do NitroSense:

  | Botão | `platform_profile` |
  |---|---|
  | Eco | `low-power` |
  | Silencioso | `quiet` |
  | Equilibrado | `balanced` |
  | Performance | `balanced-performance` |

  Trocar o modo mostra o OSD do GNOME. A **tecla NitroSense** do teclado também troca
  o modo, e a extensão acompanha (e mostra o OSD).
- **Sensores**: temperatura da CPU (pacote, `coretemp`), da GPU e RPM das duas
  ventoinhas, com barras verde/amarelo/vermelho.
- **GeForce RTX 3050**: consumo (W), clock, uso de VRAM (fica vermelho acima de 90 %)
  e uso da GPU. Quando a dGPU está em **repouso** (RTD3), a extensão **não** chama o
  `nvidia-smi` — senão ela acordaria a placa e gastaria bateria à toa.

O último modo escolhido fica em `~/.local/state/nitro/profile` e é **reaplicado no
login** (o firmware volta para `balanced` a cada boot).

## Limitações

- **Turbo** (`performance`): aparece em `platform_profile_choices`, mas o firmware do
  ANV15-51 recusa (`EIO`) mesmo na tomada, então o botão fica escondido.
- **Controle manual de ventoinha e RGB do teclado**: o `acer_wmi` do kernel não expõe.
  Para isso existe o [DAMX](https://github.com/PXDiv/Div-Acer-Manager-Max), que troca
  o driver por um módulo próprio.
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
