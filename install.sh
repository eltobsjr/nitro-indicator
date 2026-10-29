#!/usr/bin/env bash
# Instalador do Nitro Indicator (extensão GNOME Shell + helper root + polkit).
# Idempotente: pode rodar de novo para atualizar. Não recarrega o GNOME Shell —
# no Wayland a extensão nova só vale após logout/login.
set -euo pipefail

UUID="nitro@eltobsjr.gmail.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
EXT_DEST="$EXT_BASE/$UUID"
HELPER="/usr/local/bin/nitro-profile"
BOOST="/usr/local/bin/nitro-boost"
FAN="/usr/local/bin/nitro-fan"
MODE_BIN="$HOME/.local/bin/nitro-mode"
KMOD_DIR="/lib/modules/$(uname -r)/extra"
FANCONF="/etc/modules-load.d/nitro_fan.conf"
POLICY="/usr/share/polkit-1/actions/com.eltobsjr.nitro.policy"
MODPROBE="/etc/modprobe.d/acer-nitro.conf"

echo "==> Instalando Nitro Indicator"

# 0) tema e opções: pergunta no terminal (use --yes para aceitar os padrões e
#    --reconfigure para perguntar de novo; também aceita --palette, --accent, --system-accent)
command -v python3 >/dev/null 2>&1 || { echo "ERRO: python3 não encontrado. Instale com: sudo dnf install python3" >&2; exit 1; }
SETUP="$ROOT/scripts/eltob-setup.py"
ANSWERS="$(mktemp)"
trap 'rm -f "$ANSWERS"' EXIT
python3 "$SETUP" ask --uuid "$UUID" --options "$ROOT/scripts/options.json" \
    --schema-dir "$ROOT/extension/schemas" --answers "$ANSWERS" "$@"

# 1) checa o hardware/driver
if ! modinfo acer_wmi >/dev/null 2>&1; then
    echo "ERRO: módulo acer_wmi não encontrado — isto é só para notebooks Acer Nitro/Predator." >&2
    exit 1
fi
command -v pkexec >/dev/null 2>&1 || { echo "ERRO: pkexec não encontrado (sudo dnf install polkit)." >&2; exit 1; }
command -v nvidia-smi >/dev/null 2>&1 ||
    echo "AVISO: nvidia-smi não encontrado — a seção da GPU fica vazia."

# 2) parte do sistema (root): helper, regra do polkit e predator_v4 no acer_wmi.
#    Só pede senha se algo mudou.
same() { [ -f "$2" ] && cmp -s "$1" "$2"; }
WANT_SYSTEM="$(python3 "$SETUP" extra --answers "$ANSWERS" system)"
if [ "$WANT_SYSTEM" != "true" ]; then
    echo "==> Parte do sistema ignorada (instale depois com ./install.sh)"
elif same "$ROOT/system/nitro-profile" "$HELPER" &&
   same "$ROOT/system/nitro-boost" "$BOOST" &&
   same "$ROOT/system/nitro-fan" "$FAN" &&
   same "$ROOT/system/acer-nitro-fan.conf" "$FANCONF" &&
   same "$ROOT/system/com.eltobsjr.nitro.policy" "$POLICY" &&
   same "$ROOT/system/acer-nitro.conf" "$MODPROBE"; then
    echo "==> Arquivos do sistema já atualizados"
else
    echo "==> Instalando helper, polkit e opção do acer_wmi (pede senha de administrador)"
    sudo install -m 755 "$ROOT/system/nitro-profile" "$HELPER"
    sudo install -m 755 "$ROOT/system/nitro-boost" "$BOOST"
    sudo install -m 755 "$ROOT/system/nitro-fan" "$FAN"
    sudo install -m 644 "$ROOT/system/acer-nitro-fan.conf" "$FANCONF"
    sudo install -m 644 "$ROOT/system/com.eltobsjr.nitro.policy" "$POLICY"
    sudo install -m 644 "$ROOT/system/acer-nitro.conf" "$MODPROBE"
    command -v restorecon >/dev/null 2>&1 && sudo restorecon "$HELPER" "$BOOST" "$FAN" "$POLICY" "$MODPROBE" "$FANCONF" || true
fi

# 2b) módulo nitro_fan (controle das ventoinhas): compila para o kernel atual e instala.
#     Precisa de kernel-devel e gcc; depois de atualizar o kernel, rode o install.sh de novo.
if [ "$WANT_SYSTEM" = "true" ]; then
    if [ -d "/lib/modules/$(uname -r)/build" ] && command -v make >/dev/null 2>&1; then
        echo "==> Compilando o módulo nitro_fan para o kernel $(uname -r)"
        make -C "$ROOT/system/kmod" >/dev/null
        if ! same "$ROOT/system/kmod/nitro_fan.ko" "$KMOD_DIR/nitro_fan.ko"; then
            sudo install -D -m 644 "$ROOT/system/kmod/nitro_fan.ko" "$KMOD_DIR/nitro_fan.ko"
            sudo depmod -a
        fi
        [ -e /sys/kernel/nitro_fan/mode ] || sudo modprobe nitro_fan ||
            echo "AVISO: não deu pra carregar o nitro_fan — controle de ventoinhas indisponível."
    else
        echo "AVISO: sem kernel-devel/make para o kernel atual — controle de ventoinhas indisponível (sudo dnf install kernel-devel gcc make)."
    fi
fi

# 2c) nitro-mode: comando dos modos, sem root (também usado pelos lançadores de jogos)
mkdir -p "$(dirname "$MODE_BIN")"
install -m 755 "$ROOT/system/nitro-mode" "$MODE_BIN"

# 3) recarrega o acer_wmi com predator_v4=1 se ainda não estiver ativo
if [ "$WANT_SYSTEM" = "true" ] && [ "$(cat /sys/module/acer_wmi/parameters/predator_v4 2>/dev/null)" != "Y" ]; then
    echo "==> Recarregando acer_wmi com predator_v4=1"
    sudo modprobe -r acer_wmi && sudo modprobe acer_wmi ||
        echo "AVISO: não deu pra recarregar agora — reinicie o PC para ativar."
fi
if [ ! -f /sys/firmware/acpi/platform_profile ]; then
    echo "AVISO: /sys/firmware/acpi/platform_profile não apareceu — seu modelo pode não ser suportado pelo predator_v4."
fi

# 4) extensão: monta numa pasta temporária ao lado e troca de uma vez (o Shell nunca
#    vê uma extensão pela metade)
echo "==> Copiando extensão para $EXT_DEST"
mkdir -p "$EXT_BASE"
STAGE="$(mktemp -d "$EXT_BASE/.$UUID.XXXXXX")"
cleanup() { rm -rf "$STAGE" "${OLD:-}" "$ANSWERS"; }
trap cleanup EXIT
cp -r "$ROOT/extension/." "$STAGE/"
chmod 755 "$STAGE"
if [ -d "$EXT_DEST" ]; then
    OLD="$EXT_BASE/.$UUID.old.$$"
    mv "$EXT_DEST" "$OLD"
fi
mv "$STAGE" "$EXT_DEST"

echo "==> Aplicando tema e opções"
python3 "$SETUP" apply --uuid "$UUID" --answers "$ANSWERS" --dest "$EXT_DEST" \
    --options "$ROOT/scripts/options.json" --schema "" --title "Nitro"

echo ""
echo "✅ Instalado!"
echo ""
echo "Para carregar a versão nova da extensão:"
echo "  • Wayland: faça logout/login (e, se ainda não estiver ativa: gnome-extensions enable $UUID)"
echo "  • X11:     Alt+F2, digite 'r', Enter"
