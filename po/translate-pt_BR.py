#!/usr/bin/env python3
"""Gera po/pt_BR.po a partir de po/nitro.pot com as traduções abaixo (fonte única do português).
Uso: python3 po/translate-pt_BR.py  (o make po roda isto). Falha se faltar tradução."""
import re
import sys
from pathlib import Path

T = {
    'Eco': 'Eco', 'Quiet': 'Silencioso', 'Balanced': 'Equilibrado', 'Performance': 'Performance',
    'Auto': 'Automático', 'Max': 'Máximo', 'Curve': 'Curva', 'Profile': 'Perfil', 'Fans': 'Ventoinhas',
    'Limit charge to 80%': 'Limitar a carga em 80%', 'Sensors': 'Sensores', 'Fan 1': 'Ventoinha 1', 'Fan 2': 'Ventoinha 2',
    'Sleeping — saving power': 'Em repouso — economizando energia', 'On battery': 'Na bateria', 'Plugged in': 'Na tomada',
    'Active': 'Ativa', 'Sleeping': 'Dormindo', 'Load %s': 'Uso %s', '%d–%d °C · last 3 min': '%d–%d °C · últimos 3 min',
    'collecting…': 'coletando…', 'Authorization cancelled.': 'Autorização cancelada.',
    'Could not switch to %s': 'Não deu pra ativar %s', 'Fixed max speed': 'Rotação máxima fixa',
    'Following the curve': 'Seguindo a curva', 'Fixed speed': 'Rotação fixa', 'BIOS in control': 'BIOS no controle',
    'Fan control unavailable: the nitro_fan module is not loaded. Run ./install.sh again (the kernel may have been updated).':
        'Controle de ventoinha indisponível: o módulo nitro_fan não está carregado. Rode o ./install.sh de novo (o kernel pode ter sido atualizado).',
    'Could not change the fans': 'Não deu pra mudar as ventoinhas',
    'Stops at 80% to extend battery life': 'Para em 80% para a bateria durar mais', 'Charges up to 100%': 'Carrega até 100%',
    'Could not change the charge limit': 'Não deu pra mudar o limite de carga', 'Mode': 'Modo',
    'Could not apply the mode.': 'Não deu pra aplicar o modo.', '%s mode': 'Modo %s', 'Modes': 'Modos',
    'Edit modes…': 'Editar modos…', 'Applying…': 'Aplicando…', 'Edit': 'Editar', 'General': 'Geral',
    'Top bar and menu': 'Barra superior e menu', 'GPU temperature in the top bar': 'Temperatura da GPU na barra superior',
    'Only while the NVIDIA GPU is awake; it is never woken up just to read it':
        'Só enquanto a GPU NVIDIA estiver acordada; ela nunca é acordada só pra ler',
    'Temperature history': 'Histórico de temperatura', 'CPU and GPU chart for the last 3 minutes': 'Gráfico de CPU e GPU dos últimos 3 minutos',
    'NitroSense key': 'Tecla NitroSense', 'Toggles between Performance and the previous profile': 'Alterna entre Performance e o perfil anterior',
    'Automatic profile': 'Perfil automático',
    'Switch the profile by itself when the charger is plugged in or removed.': 'Troca o perfil sozinho quando o carregador é ligado ou desligado.',
    'Keep the current one': 'Manter o atual', 'System status': 'Estado do sistema', 'Fan control': 'Controle das ventoinhas',
    'Through the kernel acer-wmi driver (pwm)': 'Pelo driver acer-wmi do kernel (pwm)', 'Through the nitro_fan module': 'Pelo módulo nitro_fan',
    'Unavailable: run ./install.sh (needs kernel-devel and dkms)': 'Indisponível: rode o ./install.sh (precisa de kernel-devel e dkms)',
    'Charge limit': 'Limite de carga', 'nitro_battery module loaded': 'Módulo nitro_battery carregado',
    'Unavailable: nitro_battery module not loaded': 'Indisponível: módulo nitro_battery não carregado',
    'Power profiles daemon': 'Perfis de energia do sistema',
    'Integrated: Quick Settings and this menu stay in sync': 'Integrado: as Configurações rápidas e este menu ficam em sincronia',
    'Not integrated: profiles are written directly (run ./install.sh to integrate tuned-ppd)':
        'Não integrado: os perfis são gravados direto (rode o ./install.sh para integrar o tuned-ppd)',
    'Platform profile': 'Perfil da plataforma', 'acer_wmi without predator_v4: run ./install.sh': 'acer_wmi sem predator_v4: rode o ./install.sh',
    'Sets of settings turned on and off together from the menu (or with nitro-mode on NAME).':
        'Conjuntos de ajustes ligados e desligados juntos pelo menu (ou com nitro-mode on NOME).',
    'New mode': 'Novo modo', 'Could not save ~/.config/nitro/modes.json': 'Não deu pra salvar ~/.config/nitro/modes.json',
    'New mode %d': 'Novo modo %d', 'Name': 'Nome', 'Do not change': 'Não mexer', 'GPU core offset (MHz)': 'Núcleo da GPU (MHz)',
    'GPU memory offset (MHz)': 'Memória da GPU (MHz)', 'GPU overclock': 'Overclock da GPU', 'Default': 'Padrão',
    'Boost (+100/+500)': 'Boost (+100/+500)', 'Maximum (+150/+1000)': 'Máximo (+150/+1000)', 'Custom': 'Livre',
    'GPU power limit (W)': 'Limite de potência da GPU (W)',
    '0 = do not change. Many laptop drivers do not allow it.': '0 = não mexer. Muitos drivers de notebook não deixam.',
    'CPU in performance': 'CPU em performance', 'tuned profile nitro-performance': 'perfil nitro-performance do tuned',
    'Only when plugged in': 'Só na tomada', 'Ignored on battery': 'Ignorado na bateria',
    'Turn on when a game starts': 'Ligar ao abrir um jogo',
    'Through Feral GameMode; only one mode can have this': 'Pelo GameMode da Feral; só um modo pode ter isto',
    'Delete mode': 'Excluir modo', 'Fan curve': 'Curva de ventoinha',
    'Used by the “Curve” fan option. The CPU fan follows the CPU; the GPU fan follows the hotter of the two. Above 92 °C the fans always go to 100%.':
        'Usada pela opção “Curva” das ventoinhas. A ventoinha da CPU segue a CPU; a da GPU segue a mais quente das duas. Acima de 92 °C as ventoinhas sempre vão a 100%.',
    'Points': 'Pontos', 'Point %d': 'Ponto %d', 'Save curve': 'Salvar curva', 'Curve saved': 'Curva salva',
    'Could not save the curve': 'Não deu pra salvar a curva', 'Restore default curve': 'Voltar à curva padrão',
    'fans at max': 'ventoinhas no máx.', 'fan curve': 'curva de ventoinha', 'fans auto': 'ventoinhas auto',
    'Boost': 'Boost', 'Maximum': 'Máximo', 'CPU performance': 'CPU performance', 'No changes': 'Sem ajustes',
    'Show the GPU temperature in the top bar': 'Mostrar a temperatura da GPU na barra superior',
    'Only while the NVIDIA GPU is awake; it is never woken up just to read it.':
        'Só enquanto a GPU NVIDIA estiver acordada; ela nunca é acordada só pra ler.',
    'Show the temperature history in the menu': 'Mostrar o histórico de temperatura no menu',
    'Profile applied when the charger is plugged in (empty = keep the current one)':
        'Perfil aplicado quando o carregador é ligado (vazio = manter o atual)',
    'Profile applied when running on battery (empty = keep the current one)': 'Perfil aplicado na bateria (vazio = manter o atual)',
    'Use the NitroSense key to toggle the Performance profile': 'Usar a tecla NitroSense para alternar o perfil Performance',
    'Button %d': 'Botão %d',
    'left button': 'botão esquerdo',
    'middle button': 'botão do meio',
    'right button': 'botão direito',
    'back button': 'botão voltar',
    'forward button': 'botão avançar',
    'left stick': 'analógico esquerdo',
    'right stick': 'analógico direito',
    'button %d': 'botão %d',
    'scroll up': 'rolou para cima',
    'scroll down': 'rolou para baixo',
    'scroll left': 'rolou para a esquerda',
    'scroll right': 'rolou para a direita',
    'Peripherals': 'Periféricos',
    'Laptop keyboard': 'Teclado do notebook',
    'None on': 'Nenhum ligado',
    'Modes section expanded in the menu': 'Seção de modos aberta no menu',
    'Peripherals section expanded in the menu': 'Seção de periféricos aberta no menu',
    'Test peripherals…': 'Testar periféricos…',
    'Press a button on any device': 'Aperte um botão em qualquer aparelho',
    'Peripheral tester': 'Testador de periféricos',
    'Press keys, click, scroll or use a controller. Everything lights up here; nothing is sent to other apps.': 'Aperte teclas, clique, role ou use um controle. Tudo acende aqui; nada vai para outros apps.',
    'Mouse': 'Mouse',
    'Controller': 'Controle',
    'Keyboard': 'Teclado',
    'Close': 'Fechar',
    'No controller connected (USB or Bluetooth).': 'Nenhum controle conectado (USB ou Bluetooth).',
    'Peripherals in the menu': 'Periféricos no menu',
    'Controllers, mice, keyboards and wireless battery; input is only read while the menu is open': 'Controles, mouses, teclados e bateria dos sem fio; a entrada só é lida com o menu aberto',
    'Show peripherals in the menu': 'Mostrar os periféricos no menu',
    'Controllers, mice and keyboards, wireless battery and the last input; input is only read while the menu is open.': 'Controles, mouses e teclados, bateria dos sem fio e a última entrada; a entrada só é lida com o menu aberto.',
}


def unquote(lines):
    return ''.join(re.match(r'^"(.*)"$', l).group(1) for l in lines).encode().decode('unicode_escape').encode('latin1').decode()


def quote(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


root = Path(__file__).parent
pot = (root / 'nitro.pot').read_text()
out = ['msgid ""', 'msgstr ""', '"Project-Id-Version: nitro-indicator\\n"', '"PO-Revision-Date: 2026-11-01\\n"',
       '"Last-Translator: eltobsjr\\n"', '"Language-Team: Portuguese (Brazil)\\n"', '"MIME-Version: 1.0\\n"',
       '"Content-Transfer-Encoding: 8bit\\n"', '"Content-Type: text/plain; charset=UTF-8\\n"', '"Language: pt_BR\\n"',
       '"Plural-Forms: nplurals=2; plural=(n > 1);\\n"', '']
missing = []
for block in pot.split('\n\n'):
    m = re.search(r'^msgid ((?:".*"\n?)+)', block + '\n', re.M)
    if not m:
        continue
    msgid = unquote(m.group(1).split('\n')[:-1] if m.group(1).endswith('\n') else m.group(1).split('\n'))
    if not msgid:
        continue
    if msgid not in T:
        missing.append(msgid)
        continue
    refs = [l for l in block.split('\n') if l.startswith('#')]
    out += refs + [f'msgid {quote(msgid)}', f'msgstr {quote(T[msgid])}', '']
if missing:
    print('sem tradução:', *missing, sep='\n  ', file=sys.stderr)
    sys.exit(1)
(root / 'pt_BR.po').write_text('\n'.join(out))
