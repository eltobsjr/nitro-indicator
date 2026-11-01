#!/usr/bin/env bash
# Remove o Nitro Indicator: extensão, estado, helpers, polkit, módulos (DKMS ou manuais), serviço da curva
# e a integração com o tuned-ppd (o ppd.conf volta ao original). Pede senha de administrador.
set -u
UUID="nitro@eltobsjr.gmail.com"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/nitro"

gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "$DATA/gnome-shell/extensions/$UUID" "$STATE" "$DATA/nitro" "$HOME/.local/bin/nitro-mode" "$HOME/.local/bin/nitro-input"

sudo systemctl disable --now nitro-fancurve.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/nitro-fancurve.service && sudo systemctl daemon-reload
sudo modprobe -r nitro_fan nitro_battery 2>/dev/null || true
if command -v dkms >/dev/null 2>&1; then
    for v in $(dkms status -m nitro-kmod 2>/dev/null | sed -n 's#^nitro-kmod/\([^,:]*\).*#\1#p' | sort -u); do
        sudo dkms remove -m nitro-kmod -v "$v" --all >/dev/null 2>&1 || true
        sudo rm -rf "/usr/src/nitro-kmod-$v"
    done
fi
sudo rm -f /lib/modules/*/extra/nitro_fan.ko /lib/modules/*/extra/nitro_battery.ko && sudo depmod -a
sudo rm -f /usr/local/bin/nitro-profile /usr/local/bin/nitro-boost /usr/local/bin/nitro-fan \
    /usr/local/bin/nitro-battery /usr/local/bin/nitro-fancurve \
    /usr/share/polkit-1/actions/com.eltobsjr.nitro.policy /etc/modprobe.d/acer-nitro.conf \
    /etc/modules-load.d/nitro_fan.conf /etc/modprobe.d/nitro-battery-blacklist.conf
sudo rm -rf /etc/nitro /etc/tuned/profiles/nitro-performance
if [ -f /etc/tuned/ppd.conf.nitro-orig ]; then
    sudo mv /etc/tuned/ppd.conf.nitro-orig /etc/tuned/ppd.conf
    sudo systemctl try-restart tuned-ppd.service
fi
echo "Removido. O acer_wmi volta ao normal no próximo boot."
