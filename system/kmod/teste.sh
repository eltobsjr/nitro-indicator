#!/bin/sh
# Teste no hardware (como root): recarrega os módulos e confere ventoinhas e limite de carga.
# Usa os módulos instalados (DKMS); com --local, compila e testa os desta pasta.
# Ventoinhas: "max" sobe a rotação, "custom" segue a porcentagem pedida, "auto" devolve à BIOS.
# Bateria: liga e desliga o limite e devolve ao estado de antes.
set -e
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "rode como root: sudo $0" >&2; exit 1; }
rpm() { cat /sys/class/hwmon/hwmon*/fan1_input /sys/class/hwmon/hwmon*/fan2_input 2>/dev/null | tr '\n' ' '; }
F=/sys/kernel/nitro_fan
fail=0
LOCAL=0
[ "${1:-}" = --local ] && LOCAL=1
# recarrega um módulo: o instalado (modprobe) ou, com --local, o compilado aqui (insmod)
load() {
    modprobe -r "$1" 2>/dev/null || rmmod "$1" 2>/dev/null || true
    if [ $LOCAL = 0 ] && modinfo "$1" >/dev/null 2>&1; then
        modprobe "$1"
    else
        [ -f "./$1.ko" ] || make -s >/dev/null
        insmod "./$1.ko"
    fi
}
check() { if [ "$2" = "$3" ]; then echo "  ok    $1"; else echo "  FALHA $1: esperado '$3', veio '$2'"; fail=1; fi; }

echo "== nitro_fan"
load nitro_fan
echo "antes:          $(rpm)"
echo max > $F/mode; sleep 6
echo "max:            $(rpm)"; check "modo max" "$(cat $F/mode)" max
echo custom > $F/mode
echo 40 > $F/cpu_speed; echo 40 > $F/gpu_speed; sleep 8
echo "custom 40%:     $(rpm)"; check "modo custom" "$(cat $F/mode)" custom
check "cpu_speed lido" "$(cat $F/cpu_speed)" 40
check "gpu_speed lido" "$(cat $F/gpu_speed)" 40
echo 101 > $F/cpu_speed 2>/dev/null && { echo "  FALHA 101% aceito"; fail=1; } || echo "  ok    101% recusado"
echo auto > $F/mode; sleep 6
echo "auto:           $(rpm)"; check "modo auto" "$(cat $F/mode)" auto

echo "== nitro_battery"
load nitro_battery
dmesg | grep -i nitro_battery | tail -2 || true
B=$(for b in /sys/class/power_supply/*; do [ "$(cat $b/type)" = Battery ] && echo $b && break; done)
T=$B/charge_control_end_threshold
if [ ! -e "$T" ]; then
    echo "  FALHA $T não apareceu"; fail=1
else
    was=$(cat $T); echo "  limite atual: $was"
    echo 80 > $T; check "liga limite" "$(cat $T)" 80
    echo 100 > $T; check "desliga limite" "$(cat $T)" 100
    echo 90 > $T; check "90 vira 80" "$(cat $T)" 80
    echo "$was" > $T; check "volta ao de antes" "$(cat $T)" "$was"
fi

[ $fail = 0 ] && echo "TUDO OK" || { echo "HOUVE FALHAS"; exit 1; }
