#!/bin/sh
# Carrega o módulo e testa: ventoinhas em "max" devem subir de rotação com a máquina ociosa, "auto" devolve.
set -e
cd "$(dirname "$0")"
rpm() { cat /sys/class/hwmon/hwmon*/fan1_input /sys/class/hwmon/hwmon*/fan2_input 2>/dev/null | tr '\n' ' '; }
lsmod | grep -q '^nitro_fan' || insmod ./nitro_fan.ko
echo "antes (auto):  $(rpm)"
echo max > /sys/kernel/nitro_fan/mode
sleep 6
echo "depois (max):  $(rpm)  modo=$(cat /sys/kernel/nitro_fan/mode)"
echo auto > /sys/kernel/nitro_fan/mode
sleep 6
echo "voltou (auto): $(rpm)  modo=$(cat /sys/kernel/nitro_fan/mode)"
