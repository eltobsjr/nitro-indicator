#!/usr/bin/env bash
# Instalador do Nitro Indicator (extensão GNOME Shell + helper root + polkit).
# Idempotente: pode rodar de novo para atualizar. Não recarrega o GNOME Shell —
# no Wayland a extensão nova só vale após logout/login.
set -euo pipefail

UUID="nitro@eltobsjr.gmail.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
EXT_DEST="$EXT_BASE/$UUID"
BIN=/usr/local/bin
HELPERS="nitro-profile nitro-boost nitro-fan nitro-battery nitro-fancurve"
MODE_BIN="$HOME/.local/bin/nitro-mode"
DEFAULTS="${XDG_DATA_HOME:-$HOME/.local/share}/nitro/defaults.json"
MODLOAD="/etc/modules-load.d/nitro_fan.conf"
POLICY="/usr/share/polkit-1/actions/com.eltobsjr.nitro.policy"
MODPROBE="/etc/modprobe.d/acer-nitro.conf"
UNIT="/etc/systemd/system/nitro-fancurve.service"
HWDB="/etc/udev/hwdb.d/61-nitro-battery.hwdb"
TUNED_PROFILE="/etc/tuned/profiles/nitro-performance"
PPD_CONF="/etc/tuned/ppd.conf"
VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/extension/metadata.json'))['version-name'])")"
KMOD_SRC="/usr/src/nitro-kmod-$VERSION"

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

# 2) parte do sistema (root): helpers, polkit, predator_v4 no acer_wmi, serviço da curva.
#    Só pede senha se algo mudou.
same() { [ -f "$2" ] && cmp -s "$1" "$2"; }
WANT_SYSTEM="$(python3 "$SETUP" extra --answers "$ANSWERS" system)"
system_current() {
    for h in $HELPERS; do same "$ROOT/system/$h" "$BIN/$h" || return 1; done
    same "$ROOT/system/acer-nitro-fan.conf" "$MODLOAD" &&
    same "$ROOT/system/com.eltobsjr.nitro.policy" "$POLICY" &&
    same "$ROOT/system/acer-nitro.conf" "$MODPROBE" &&
    same "$ROOT/system/nitro-fancurve.service" "$UNIT" &&
    same "$ROOT/system/61-nitro-battery.hwdb" "$HWDB"
}
if [ "$WANT_SYSTEM" != "true" ]; then
    echo "==> Parte do sistema ignorada (instale depois com ./install.sh)"
elif system_current; then
    echo "==> Arquivos do sistema já atualizados"
else
    echo "==> Instalando helpers, polkit, serviço da curva e opção do acer_wmi (pede senha de administrador)"
    for h in $HELPERS; do sudo install -m 755 "$ROOT/system/$h" "$BIN/$h"; done
    sudo install -m 644 "$ROOT/system/acer-nitro-fan.conf" "$MODLOAD"
    sudo install -m 644 "$ROOT/system/com.eltobsjr.nitro.policy" "$POLICY"
    sudo install -m 644 "$ROOT/system/acer-nitro.conf" "$MODPROBE"
    sudo install -m 644 "$ROOT/system/nitro-fancurve.service" "$UNIT"
    sudo systemctl daemon-reload
    # UPower lê o limite de carga do hwdb: com isso o GNOME enxerga o limite do nitro_battery
    sudo install -D -m 644 "$ROOT/system/61-nitro-battery.hwdb" "$HWDB"
    sudo systemd-hwdb update && sudo udevadm trigger -s power_supply || true
    sudo systemctl try-restart upower.service || true
    command -v restorecon >/dev/null 2>&1 &&
        sudo restorecon $(for h in $HELPERS; do echo "$BIN/$h"; done) "$POLICY" "$MODPROBE" "$MODLOAD" "$UNIT" || true
fi

# 2b) módulos nitro_fan (ventoinhas) e nitro_battery (limite de carga) pelo DKMS: recompilados sozinhos a
#     cada kernel novo. Sem DKMS (ou se ele falhar), compila só para o kernel atual.
build_manual() {
    if [ -d "/lib/modules/$(uname -r)/build" ] && command -v make >/dev/null 2>&1; then
        echo "==> Compilando os módulos para o kernel $(uname -r) (sem DKMS: rode de novo após atualizar o kernel)"
        make -C "$ROOT/system/kmod" >/dev/null
        for m in nitro_fan nitro_battery; do
            same "$ROOT/system/kmod/$m.ko" "/lib/modules/$(uname -r)/extra/$m.ko" ||
                sudo install -D -m 644 "$ROOT/system/kmod/$m.ko" "/lib/modules/$(uname -r)/extra/$m.ko"
        done
        sudo depmod -a
        make -C "$ROOT/system/kmod" clean >/dev/null
    else
        echo "AVISO: sem kernel-devel/make para o kernel atual — ventoinhas e limite de carga indisponíveis (sudo dnf install kernel-devel gcc make dkms)."
        return 1
    fi
}
build_dkms() {
    if ! command -v dkms >/dev/null 2>&1; then
        command -v dnf >/dev/null 2>&1 || return 1
        echo "==> Instalando o DKMS (recompila os módulos a cada atualização do kernel)"
        sudo dnf install -y dkms kernel-devel-"$(uname -r)" >/dev/null || return 1
    fi
    if dkms status -m nitro-kmod -v "$VERSION" 2>/dev/null | grep -q "$(uname -r).*installed" &&
       diff -rq "$ROOT/system/kmod" "$KMOD_SRC" -x dkms.conf -x teste.sh -x '*.o' -x '*.ko' -x '.*' -x '*.mod*' -x modules.order -x Module.symvers >/dev/null 2>&1; then
        echo "==> Módulos já instalados pelo DKMS ($VERSION)"
        return 0
    fi
    echo "==> Registrando os módulos no DKMS (nitro-kmod $VERSION)"
    # versões antigas: as do DKMS e a cópia manual do install.sh antigo
    for v in $(dkms status -m nitro-kmod 2>/dev/null | sed -n 's#^nitro-kmod/\([^,:]*\).*#\1#p' | sort -u); do
        sudo dkms remove -m nitro-kmod -v "$v" --all >/dev/null 2>&1 || true
        sudo rm -rf "/usr/src/nitro-kmod-$v"
    done
    sudo rm -f /lib/modules/*/extra/nitro_fan.ko /lib/modules/*/extra/nitro_battery.ko
    sudo rm -rf "$KMOD_SRC"
    sudo mkdir -p "$KMOD_SRC"
    sudo cp "$ROOT/system/kmod/"*.c "$ROOT/system/kmod/Makefile" "$KMOD_SRC/"
    sed "s/@VERSION@/$VERSION/" "$ROOT/system/kmod/dkms.conf" | sudo tee "$KMOD_SRC/dkms.conf" >/dev/null
    sudo dkms install -m nitro-kmod -v "$VERSION" >/dev/null
}
if [ "$WANT_SYSTEM" = "true" ]; then
    build_dkms || { echo "AVISO: DKMS indisponível ou falhou; usando a compilação manual."; build_manual; } || true
    if mokutil --sb-state 2>/dev/null | grep -qi enabled; then
        echo "AVISO: Secure Boot ligado — o kernel só carrega módulos assinados. O DKMS assina com a chave dele;"
        echo "       registre-a uma vez com: sudo mokutil --import /var/lib/dkms/mok.pub (e confirme no próximo boot)."
    fi
    # Kernel com o acer-wmi-battery oficial (a caminho do mainline em 2026): ele assume o limite de carga
    # e o nitro_battery fica de fora, senão os dois disputam o mesmo GUID WMI
    BAT_BLACKLIST=/etc/modprobe.d/nitro-battery-blacklist.conf
    MODS="nitro_fan nitro_battery"
    if modinfo acer_wmi_battery >/dev/null 2>&1; then
        echo "==> O kernel já tem o acer-wmi-battery: o limite de carga fica com ele"
        [ -f "$BAT_BLACKLIST" ] || echo "blacklist nitro_battery" | sudo tee "$BAT_BLACKLIST" >/dev/null
        sudo modprobe -r nitro_battery 2>/dev/null || true
        MODS="nitro_fan"
    elif [ -f "$BAT_BLACKLIST" ]; then
        sudo rm -f "$BAT_BLACKLIST"
    fi
    # recarrega para valer a versão nova (o nitro_fan devolve as ventoinhas à BIOS ao sair)
    for m in $MODS; do
        sudo modprobe -r "$m" 2>/dev/null || true
        sudo modprobe "$m" 2>/dev/null || echo "AVISO: não deu pra carregar o $m (sudo dmesg | tail)."
    done
fi

# 2b') tuned-ppd: o "Desempenho" das Configurações rápidas passa a usar o nitro-performance, que pede o perfil
#      Acer que o firmware aceita (o throughput-performance pede "performance", recusado com EIO).
if [ "$WANT_SYSTEM" = "true" ] && [ -f "$PPD_CONF" ] && command -v tuned-adm >/dev/null 2>&1; then
    if ! same "$ROOT/system/tuned/nitro-performance/tuned.conf" "$TUNED_PROFILE/tuned.conf" ||
       ! grep -qE '^\s*performance\s*=\s*nitro-performance\s*$' "$PPD_CONF"; then
        echo "==> Integrando com o tuned-ppd (perfil nitro-performance)"
        sudo install -D -m 644 "$ROOT/system/tuned/nitro-performance/tuned.conf" "$TUNED_PROFILE/tuned.conf"
        [ -f "$PPD_CONF.nitro-orig" ] || sudo cp -p "$PPD_CONF" "$PPD_CONF.nitro-orig"
        sudo sed -i -E '/^\[profiles\]/,/^\[/ s/^(\s*performance\s*=\s*).*/\1nitro-performance/' "$PPD_CONF"
        sudo systemctl try-restart tuned-ppd.service
    fi
fi

# 2c) nitro-mode (modos, também usado pelos lançadores de jogos) e nitro-input (periféricos): sem root
mkdir -p "$(dirname "$MODE_BIN")"
install -m 755 "$ROOT/system/nitro-mode" "$MODE_BIN"
install -m 755 "$ROOT/system/nitro-input" "$(dirname "$MODE_BIN")/nitro-input"  # leitor de controles (sem root)
install -m 755 "$ROOT/system/nitro-gpuapps" "$(dirname "$MODE_BIN")/nitro-gpuapps"  # apps usando a GPU (sem root)

# GameMode: ao abrir um jogo, liga o modo marcado como "ligar ao abrir um jogo" (mesmo com a extensão desligada).
# Só cria o arquivo se você não tiver um; dá para desligar nas preferências.
GAMEMODE_INI="${XDG_CONFIG_HOME:-$HOME/.config}/gamemode.ini"
if command -v gamemoded >/dev/null 2>&1 && [ ! -e "$GAMEMODE_INI" ]; then
    printf '# Nitro Indicator: liga o modo marcado como "ligar ao abrir um jogo".\n[custom]\nstart=%s auto-start\nend=%s auto-stop\n' \
        "$MODE_BIN" "$MODE_BIN" > "$GAMEMODE_INI"
    echo "==> GameMode: $GAMEMODE_INI criado (desligue nas preferências se não quiser)"
fi
install -D -m 644 "$ROOT/extension/defaults.json" "$DEFAULTS"

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
# traduções e schema compilados na cópia (o repositório guarda só as fontes)
for po in "$ROOT"/po/*.po; do
    lang="$(basename "$po" .po)"
    mkdir -p "$STAGE/locale/$lang/LC_MESSAGES"
    msgfmt -o "$STAGE/locale/$lang/LC_MESSAGES/$UUID.mo" "$po" 2>/dev/null ||
        echo "AVISO: msgfmt não encontrado — a extensão fica em inglês (sudo dnf install gettext)."
done
glib-compile-schemas "$STAGE/schemas"
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
