# Changelog

Todas as mudanças relevantes do projeto ficam aqui. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o
[Versionamento Semântico](https://semver.org/lang/pt-BR/). A versão da extensão é a do
`version-name` em `extension/metadata.json`.

## [Não lançado]

### Adicionado
- **Laboratório › Personalizado**: ao mexer na grade, o layout vira *Personalizado* sozinho e a
  edição fica guardada à parte (chave `grid-custom`); escolher um layout pronto não a apaga.
- **Laboratório › Meus layouts**: *Salvar como…* guarda a grade com um nome (chave
  `saved-layouts`, JSON); cada layout salvo pode ser aplicado, renomeado, substituído pela grade
  atual ou apagado (com confirmação).
- O layout em uso (pronto, salvo ou personalizado) fica destacado.
- Testes da grade: trocar, empurrar, layouts com nome e leitura de JSON inválido.

### Mudado
- Soltar um item em cima de outro no laboratório **troca os dois** de lugar; se não der (vários
  itens no caminho, ou item novo vindo da gaveta), quem está no caminho desce. Linhas vazias somem.
  As setas do teclado seguem a mesma regra.
- README: seção do laboratório atualizada e este CHANGELOG.

### Corrigido
- Não dava para reordenar os itens: o laboratório recusava soltar em célula ocupada, e os layouts
  prontos não deixam célula livre.
- `nitro_fan`: aceita a resposta em buffer do firmware do ANV15-51 (antes dava `EIO` no modo
  máximo mesmo com o comando executado).
- Instalador: o UPower é reiniciado depois de carregar os módulos (o limite de carga não aparecia
  nas Configurações do GNOME); `dkms.conf` sem a diretiva `CLEAN`, obsoleta no dkms 3.4.
- `teste.sh`: usa os módulos instalados pelo DKMS (`--local` para os da pasta) e sempre devolve as
  ventoinhas para a BIOS ao sair.
- Laboratório e menu: desenho dos ladrilhos 1×1/2×1 (nomes, ícones, apps da GPU sem vazar) e
  arrastar da gaveta mirando a célula sob o ponteiro.

### Documentação
- Resultados do teste no hardware (ventoinhas, limite de carga, DKMS, tuned-ppd).

## [0.4.0] - 2026-11-01

### Adicionado
- **Laboratório** nas preferências: menu em grade de 4 colunas montado por arrastar e soltar,
  distância entre itens, layouts prontos (Clássico, Compacto, Central de controle, Gamer, Mínimo) e
  barra superior editável.
- Ladrilhos 1×1, 2×1, 2×2 e 4×2 (CPU, GPU, ventoinhas, bateria, perfil, limite, 60 Hz, GameMode,
  histórico, curva, apps da GPU, modos, periféricos, estado, atalhos); os blocos antigos continuam
  como blocos de largura inteira.
- Apps usando a GPU, com Fechar e Forçar (`nitro-gpuapps`, sessão protegida).
- Selo de limitação térmica/de energia na CPU e na GPU; consumo, tempo, saúde e ciclos da bateria.
- Tela a 60 Hz na bateria (Mutter), limite de carga pelo UPower/GNOME (hwdb), GameMode via
  `gamemode.ini` com `nitro-mode auto-start`/`auto-stop`, Silencioso no PPD.
- Controles com o mapeamento da SDL_GameControllerDB e DPI do mouse pelo ratbagd.
- Testes da grade, geometria, presets, 60 Hz, SDL, `nitro-gpuapps` e GameMode.

## [0.3.0] - 2026-11-01

### Adicionado
- Módulo `nitro_fan`: modo das ventoinhas (auto/máximo) pelo mesmo comando WMI do NitroSense,
  velocidade em % e carregamento só nos modelos testados (DMI; `force=1`).
- Módulo `nitro_battery`: *health mode* da Acer como `charge_control_end_threshold` (80/100).
- DKMS recompila os módulos a cada kernel; aviso de Secure Boot.
- Curva de ventoinha (`nitro-fancurve`, serviço root) e helpers com polkit.
- `nitro-boost`: deslocamentos de clock da GPU livres e limite de potência, conferidos com a faixa
  do driver.
- Modos nomeados (`modes.json`, `nitro-mode`) que aplicam perfil, ventoinhas, overclock e CPU de uma
  vez e restauram o estado anterior; GameMode liga o modo marcado.
- Integração com o tuned-ppd (perfil `nitro-performance`).
- Preferências (Adwaita): geral, editor de modos, curva com gráfico e estado do sistema.
- Menu: limite de carga, histórico de temperatura, menu rolável; Modos e Periféricos em acordeões.
- Periféricos: lista, bateria dos sem fio, último botão apertado e testador (`nitro-input`).
- Perfil automático na tomada e na bateria; temperatura da GPU na barra (opcional).
- GSettings, tradução pt_BR e `defaults.json` como fonte única dos modos.
- Suíte de testes (`make test`) e documentação de engenharia reversa da tecla Turbo.

### Mudado
- Menu redesenhado: perfil e ventoinhas como controles segmentados, sensores 2×2, GPU em cartão
  único.

### Corrigido
- hwmon recarregado, ventoinhas reaplicadas a cada desbloqueio, tomada detectada pelo tipo, erro
  que não sumia.

## [0.2.0] - 2026-10-28

### Adicionado
- Tema por tokens (`stylesheet.tpl.css`) gerado pelo instalador, com contraste mínimo de 4,5:1
  garantido e conferido no `make check`.
- Instalador interativo; usa a cor de destaque do GNOME.
- Nome do notebook (DMI) e da GPU (`nvidia-smi`) lidos do sistema.
- `make check`, `pack` e `clean`; `docs/DESIGN.md`.

## [0.1.0] - 2026-10-28

### Adicionado
- Extensão do GNOME Shell no estilo NitroSense para o Acer Nitro: perfis Eco, Silencioso,
  Equilibrado e Performance (`platform_profile` do `acer_wmi` com `predator_v4=1`).
- Rotação das ventoinhas, temperaturas da CPU e da GPU, seção da GPU NVIDIA sem acordá-la.
- Helper root com polkit para trocar o perfil sem senha; último perfil reaplicado no login; OSD.
- `install.sh`, Makefile e README.
