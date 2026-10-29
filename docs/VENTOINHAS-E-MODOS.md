# Ventoinhas, overclock e modos no ANV15-51

O que foi descoberto e medido para controlar ventoinhas e GPU no Linux, e como os modos
funcionam. Complementa [`ENGENHARIA-REVERSA.md`](ENGENHARIA-REVERSA.md) (perfis térmicos e
tecla Turbo). Tudo abaixo foi feito em um único notebook (Acer Nitro ANV15-51, RTX 3050 6 GB,
Fedora 44, kernel 7.2, driver NVIDIA 615.71); em outro modelo, confira antes de confiar.

## O que o NitroSense (Windows) faz de fato

Pacote analisado: NitroSense 5.2.84, baixado da página oficial de downloads do ANV15-51. É um app
Electron (interface) mais agentes nativos em C++ (`AcerQAAgent.exe`, `AcerCCAgent.exe`,
`AcerDIAgent.exe`) que falam com o hardware. Só estrutura e nomes de funções foram lidos; nenhum
código da Acer entra neste repositório.

| Recurso | Como o NitroSense faz | Equivalente aqui |
|---|---|---|
| Perfis (Silencioso, Padrão, Performance, Turbo, Eco) | WMI gaming, `SetGamingMiscSetting` (ver o outro documento) | `/sys/firmware/acpi/platform_profile` |
| Ventoinhas | WMI gaming, método `0x0E` (`SetFanStatus`/`SwitchFanTable`) | módulo `nitro_fan` |
| "Overclock" | `NvAPI_GPU_SetPstates20`: dois deslocamentos, clock do núcleo e da memória, em MHz × 1000 | NVML: `nvmlDeviceSet{Gpc,Mem}ClkVfOffset` |

Detalhes que importam:

- Os deslocamentos de overclock **não são fixos no programa**: o NitroSense os lê do firmware
  (`AcerHID2025::GetOCProfile`, "Query OC profile table"). Esse caminho passa por um dispositivo
  HID da Acer que **não existe** neste notebook (só há o touchpad e um dongle de terceiros), e a
  BIOS (ACPI/WMI) também não tem função de overclock. Conclusão: o ANV15-51 não traz perfil de
  overclock de fábrica; os valores usados aqui (+100/+500 MHz) são nossos, não da Acer.
- O mesmo agente lê o "modo de uso do sistema" (Quiet/Default/Extreme/Turbo/Eco) pela mesma via;
  o enum do app (`QUIET=0, DEFAULT=1, EXTREME=4, TURBO=5, ECO=6`) bate com o bitmap `0x53`
  já medido (sem o bit do Turbo).

## Ventoinhas: o módulo `nitro_fan`

O `acer_wmi` do kernel tem, para outros modelos, a função que muda o modo das ventoinhas, mas não
a expõe (`pwm`) no ANV15-51. O módulo `system/kmod/nitro_fan.c` repete a mesma chamada:

- GUID WMI gaming `7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56`, método `0x0E`, entrada de 64 bits:
  `bitmap | (modo_cpu << 16) | (modo_gpu << 22)`, com bitmap `0x1` = ventoinha da CPU e `0x8` = da GPU.
- Modos: `1` automático, `2` máximo ("turbo"), `3` personalizado. O `1` e o `2` foram validados na
  máquina; o `3` não é usado (falta o comando que define a velocidade).
- Interface: `/sys/kernel/nitro_fan/mode` (`auto` ou `max`, só root). Ao descarregar o módulo, devolve
  o controle à BIOS (`auto`).
- Medido (ocioso): automático ≈ 2000/1700 RPM; máximo ≈ 7300/7000 RPM em menos de 6 s. Ao voltar para
  automático a rotação cai gradualmente (≈ 5900/5700 RPM seis segundos depois).
- O que o módulo não sabe: ler o modo atual da BIOS. O arquivo `mode` mostra o último valor escrito
  (`unknown` antes da primeira escrita).
- Compilado para o kernel em uso (`install.sh` faz isso). Depois de atualizar o kernel, rode o
  instalador de novo. Secure Boot precisa estar desligado (ou o módulo, assinado).

## GPU: o que dá e o que não dá

| Ajuste | Resultado |
|---|---|
| Deslocamento de clock do núcleo (NVML) | Funciona: faixa aceita −1000 a +1000 MHz. +100 MHz subiu o clock máximo de 2100 para 2197 MHz |
| Deslocamento de clock da memória (NVML) | Funciona: faixa aceita −2000 a +6000 MHz. +500 MHz levou a memória de 5411 para 5661 MHz |
| Limite de potência (`nvmlDeviceSetPowerManagementLimit`, `nvidia-smi -pl`) | **Não suportado** neste notebook (`Not Supported`); fica fixo em 50 W. O driver informa máximo de 65 W, mas não deixa chegar lá |
| Dynamic Boost | O driver registra `failed to get platform power mode from SBIOS` no boot; não conseguimos habilitar |

Os deslocamentos valem até o próximo boot ou recarga do driver; os modos os reaplicam.
O `nitro-boost` confere os valores com a faixa que o próprio driver informa antes de aplicar, mas **não**
garante que o jogo fique estável com eles: o limite real é o silício e o calor (a GPU já passa de 77 °C
em jogo).

## Modos

Um modo é um conjunto nomeado de ajustes que liga e desliga de uma vez. Ficam em
`~/.config/nitro/modes.json`; o comando é `nitro-mode`:

```
nitro-mode on gamer      # liga (volta ao estado anterior com "off")
nitro-mode off
nitro-mode toggle gamer
nitro-mode list | show NOME | active | status
```

Campos de um modo (qualquer um pode ficar `null` = "não mexer"):

| Campo | Valores |
|---|---|
| `profile` | `low-power`, `quiet`, `balanced`, `balanced-performance` |
| `fan` | `auto`, `max` |
| `gpu_offset` | `off`, `boost` (+100/+500), `max` (+150/+1000), `custom` (usa `gpu_custom`) |
| `gpu_custom` | `{"gpc": MHz, "mem": MHz}` |
| `power_limit` | watts da GPU (hoje recusado pelo driver neste modelo) |
| `cpu_performance` | `true` = perfil `tuned` `throughput-performance` (governor e EPP em performance) |
| `only_on_ac` | `true` = ignora o modo na bateria |
| `auto_gamemode` | `true` = a extensão liga o modo quando o GameMode registra um jogo (só um modo por vez) |

Comportamento:

- Ao ligar, o estado anterior (perfil da Acer, perfil do `tuned`, modo das ventoinhas) é guardado em
  `~/.local/state/nitro/mode-active.json`; ao desligar, tudo é restaurado. Trocar direto de um modo para
  outro desfaz o primeiro antes de aplicar o segundo.
- O estado "ligado" guarda o `boot_id`: depois de um reboot o hardware voltou ao padrão, então o estado
  antigo é descartado em vez de "restaurar" valores que já não valem.
- Os passos são independentes: se um falha (ex.: limite de potência), os outros são aplicados e o motivo
  vai para o `stderr` (a extensão mostra no menu). A saída é `1` nesse caso.
- Execuções simultâneas (extensão e lançador de jogo) são serializadas por um `flock`.
- O `tuned` reaplica o perfil da Acer ao trocar de perfil, por isso o `nitro-mode` reaplica o perfil
  depois de ligar o `throughput-performance`.

Os helpers de root são pequenos e só aceitam comandos conhecidos (`nitro-profile`, `nitro-fan`,
`nitro-boost`); a extensão e o `nitro-mode` os chamam por `pkexec`, liberado sem senha só na sessão
ativa pela regra do polkit.

## O que foi verificado

| Item | Estado |
|---|---|
| Perfis, ventoinhas (auto/máx), deslocamentos de GPU, CPU em performance, ligar e desligar um modo | Testado de ponta a ponta na máquina |
| Extensão carrega e inicia sem erro de JS | Testado em um GNOME Shell isolado (headless) |
| Interface de edição dos modos (cliques) | Não testada |
| Estabilidade de +100/+500 MHz em jogo longo | Não testada |
| Ventoinha em porcentagem, ventoinha da CPU e da GPU separadas | Não feito (o bitmap já permite separar; falta o comando de velocidade) |
| Limite de carga da bateria, modo da GPU (MUX), RGB do teclado | Não verificado |

## Fora de escopo

- Subir o PL1 da CPU: já medido, sem ganho (a máquina trava por temperatura) e o firmware reverte o valor.
  Ver a seção 5 do outro documento.
- `gpu-unlock` (desbloqueio de tensor cores): serve a treino e inferência de IA, não a jogos.
