# Engenharia reversa: Turbo e tecla Turbo no ANV15-51

Registro do que foi investigado em 2026-10-28 no **Acer Nitro V15 ANV15-51**
(BIOS V1.26, Fedora 44, kernel 7.2.11, driver `acer_wmi` com `predator_v4=1`).
Pergunta de partida: por que `echo performance > /sys/firmware/acpi/platform_profile`
falha com `EIO`, e dá para ter o Turbo e a tecla Turbo no Linux?

**Resposta curta:** este modelo **não tem Turbo** no firmware. O modo mais forte é o
`balanced-performance`, que é o "Performance" do NitroSense. A tecla Turbo existe,
mas chega como uma tecla comum do teclado, não pelo `acer_wmi`.

Cada afirmação abaixo diz de onde veio: **medido** (rodado nesta máquina),
**lido** (código/tabelas desta máquina) ou **relatado** (fonte externa, não reproduzida aqui).

## 1. Mapa dos perfis

Valores do WMI da Acer (do fonte do `acer_wmi`, **lido**):

| Valor | Nome na Acer | `platform_profile` |
|---|---|---|
| `0x00` | Quiet | `quiet` |
| `0x01` | Balanced | `balanced` |
| `0x04` | Performance | `balanced-performance` |
| `0x05` | Turbo | `performance` |
| `0x06` | Eco | `low-power` |

O nome do sysfs engana: o **`performance` do kernel é o Turbo (5)**, e o
**`balanced-performance` é o Performance (4)** do NitroSense.

## 2. O que as tabelas ACPI mostram (lido)

Tabelas copiadas de `/sys/firmware/acpi/tables/` (precisa de root) e decompiladas
com `iasl -d`.

- O WMI da Acer está na **SSDT10**, no dispositivo `\_SB.PC00.WMID` (`_UID "APGe"`).
- O GUID `7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56`, usado pelo `acer_wmi` no `predator_v4`,
  corresponde ao objeto `BH`, ou seja, ao método **`WMBH`**.
- `WMBH` com `Case 0x16` (set misc setting) e `Arg2[0] == 0x0B` troca o perfil térmico.
  Os valores **0, 1, 4 e 6** aplicam DPTF (`ODV0`) e as tabelas de potência da NVIDIA
  (`NPCF`, linhas `M1`, `M2`, `M3`, `M5`).
- O valor **5 (Turbo) não tem ramo nenhum** no AML.
- Antes de qualquer coisa, `WMBH` chama `WSMI`, que dispara uma **SMI** (porta `0xD0`).
  A decisão de aceitar ou recusar é tomada no código **SMM** da BIOS, que o AML não mostra.
  O `EIO` do kernel é essa recusa.
- As tabelas `M4DB/M4CT/M4CP` existem na NVS (DSDT), mas nada no AML as aplica.

## 3. Por que o Turbo não existe

- **Medido:** `nitro-profile performance` falha com `EIO` na bateria **e** na tomada
  (hipótese "Turbo exige AC" testada e descartada).
- **Relatado:** um patch no LKML (julho de 2026, testado num ANV15-51 com BIOS V1.60)
  leu a lista de perfis suportados pelo firmware (misc setting `0x0A`). O valor vem como
  `0x53`, que liga só os bits 0, 1, 4 e 6, isto é, quiet, balanced, performance(4) e eco.
  O Turbo (5) não está na lista, e o mesmo patch diz que o NitroSense do Windows usa
  os mesmos valores. A página da Acer também anuncia só Quiet/Balanced/Performance/Eco.
  O driver do kernel lista `performance` sem consultar essa máscara: é uma falha de
  exibição do driver, não um modo escondido.
  Não consegui ler o valor `0x0A` desta máquina sem root.
- Não há BIOS mais nova que a V1.26 para o ANV15-51 nas buscas feitas.

## 4. A tecla Turbo

- **Medido:** um `kprobe` em `acer_wmi_notify` contou **0 chamadas** em 20 s com várias
  apertadas. A tecla não chega ao `acer_wmi`.
- **Medido:** `libinput debug-events --show-keycodes` no teclado
  `AT Translated Set 2 keyboard` (`/dev/input/event3`) mostra `KEY_PROG1 (148)` a cada aperto.
- **Relatado/lido pelo agente:** o hwdb do systemd já tem `KEYBOARD_KEY_f5=prog1` para
  este modelo, e a função `HKEV()` da DSDT só gera eventos WMI com funções 1, 2, 5, 8, 9 e
  `0x0B`, nunca a função 7 que o `acer_wmi` trata como tecla Turbo.
- No XKB o `KEY_PROG1` vira **`XF86Launch1`**, que a extensão captura com
  `global.display.grab_accelerator()`, sem root.
- O evento `acer_wmi: Unknown function number - 9 - 1` no log do kernel é o
  **carregador sendo ligado**, não a tecla (**medido**: aconteceu 20 s antes de eu tocar
  no perfil, com a tomada já ligada).

## 5. Tentativa de mais desempenho: PL1 de 55 para 65 W (descartada)

No `balanced-performance`, na tomada, com carga total (12 threads, 90 s):

| Janela | Base | Com PL1 em 65 W |
|---|---|---|
| 30 a 70 s | 4090 MHz | 4041 MHz (-1,2%) |
| 76 a 90 s (sustentado) | 3730 MHz | 3709 MHz (-0,6%) |
| Temperatura máxima | 100 °C | 100 °C |

- **Medido:** a máquina já trava por temperatura (100 °C, ventoinhas no máximo em ~14 s).
  Subir o limite de potência não deu ganho.
- **Medido:** o limite do MMIO (`intel-rapl-mmio:0`, 55 W) voltou sozinho depois do teste.
  Não identifiquei o responsável (suspeitos: `thermald` ou o firmware).
- Há dois PL1: MSR (`intel-rapl:0`, 65 W) e MMIO (55 W). Vale o menor.
- Por isso o helper `nitro-profile` **não** mexe em RAPL.

## 6. O que não funcionou

- Turbo na tomada: `EIO`.
- Capturar a tecla pelo `acer_wmi`: 0 eventos.
- Subir o PL1: sem ganho e revertido pelo sistema.
- Decodificar o MOF do WMI (`WQAB`): o bmfdec não foi compilado.

## 7. Como reproduzir

```bash
# tabelas ACPI (root) e decompilação
sudo dnf install acpica-tools
mkdir acpi && sudo cp /sys/firmware/acpi/tables/{DSDT,SSDT*} acpi/ && sudo chown -R $USER acpi
cd acpi && iasl -d DSDT SSDT*          # procure por WMID e "Case (0x16)" na SSDT com o GUID da Acer

# a tecla Turbo no teclado (root; aperte a tecla e saia com Ctrl+C)
sudo libinput debug-events --device /dev/input/event3 --show-keycodes

# se a tecla chega ao acer_wmi (root; deve dar 0 neste modelo)
sudo sh -c 'cd /sys/kernel/tracing && echo "p:acernotify acer_wmi:acer_wmi_notify" > kprobe_events \
  && echo 1 > events/kprobes/acernotify/enable && echo > trace && sleep 20; grep -c acer_wmi_notify trace'
# limpar a sonda
sudo sh -c 'cd /sys/kernel/tracing && echo 0 > events/kprobes/acernotify/enable; echo "-:acernotify" >> kprobe_events'
```

Teste de extensão sem tocar na sessão real: `gnome-shell --headless --wayland`
com `GSETTINGS_BACKEND=keyfile` e `XDG_*` apontando para pastas temporárias
(sem isso o `dconf` grava na configuração real).

## Fontes

- [Patch ANV15-51 (v1) no LKML](https://lkml.iu.edu/2607.3/11709.html) e [resposta ao v2](https://lkml.iu.edu/2607.3/13387.html)
- [Review do ANV15-51 (LaptopMedia)](https://laptopmedia.com/review/acer-nitro-v-15-anv15-51-review-successful-symbiosis-between-the-aspire-and-the-nitro-series/)
- [Comunidade Acer](https://community.acer.com/en/discussion/comment/1315361)
- Fonte do driver: `drivers/platform/x86/acer-wmi.c` (kernel.org)
