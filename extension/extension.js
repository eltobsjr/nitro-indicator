import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Perfil térmico exposto pelo acer_wmi com predator_v4=1 (/etc/modprobe.d/acer-nitro.conf).
// Escrita via /usr/local/bin/nitro-profile + polkit (com.eltobsjr.nitro.policy, sem senha na sessão ativa).
const PROFILE_FILE = '/sys/firmware/acpi/platform_profile';
const CHOICES_FILE = '/sys/firmware/acpi/platform_profile_choices';
const HELPER = '/usr/local/bin/nitro-profile';
const AC_FILE = '/sys/class/power_supply/ACAD/online';
const STATE_FILE = GLib.build_filenamev([GLib.get_user_state_dir(), 'nitro', 'profile']);

// "performance" (Turbo) aparece nas choices mas o firmware do ANV15-51 recusa (EIO), então fica de fora.
const MODES = [
    {id: 'low-power', label: 'Eco', icon: 'power-profile-power-saver-symbolic', cls: 'eco'},
    {id: 'quiet', label: 'Silencioso', icon: 'weather-clear-night-symbolic', cls: 'quiet'},
    {id: 'balanced', label: 'Equilibrado', icon: 'power-profile-balanced-symbolic', cls: 'balanced'},
    {id: 'balanced-performance', label: 'Performance', icon: 'power-profile-performance-symbolic', cls: 'perf'},
];

const PANEL_REFRESH_S = 3;
const MENU_REFRESH_MS = 1500;
const GPU_TIMEOUT_S = 4;
const FAN_MAX_RPM = 6000;
const TRACK_W = 120;

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch {
        return null;
    }
}

function readInt(path) {
    const t = readText(path);
    const n = t === null ? NaN : parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
}

function findHwmon(name) {
    const base = '/sys/class/hwmon';
    try {
        const en = Gio.File.new_for_path(base).enumerate_children('standard::name', 0, null);
        let info;
        while ((info = en.next_file(null))) {
            const dir = `${base}/${info.get_name()}`;
            if (readText(`${dir}/name`) === name)
                return dir;
        }
    } catch {}
    return null;
}

// Placa NVIDIA: lida pelo sysfs pra não acordar a dGPU à toa (nvidia-smi só roda se ela já estiver ativa)
function findNvidia() {
    const base = '/sys/bus/pci/devices';
    try {
        const en = Gio.File.new_for_path(base).enumerate_children('standard::name', 0, null);
        let info;
        while ((info = en.next_file(null))) {
            const dir = `${base}/${info.get_name()}`;
            if (readText(`${dir}/vendor`) === '0x10de' && (readText(`${dir}/class`) ?? '').startsWith('0x03'))
                return dir;
        }
    } catch {}
    return null;
}

function level(value, warn, hot) {
    if (value === null)
        return 'nitro-idle';
    return value >= hot ? 'nitro-hot' : value >= warn ? 'nitro-warn' : 'nitro-ok';
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Nitro');
        this._ext = ext;
        this._iconDir = `${ext.path}/icons`;
        this._acer = findHwmon('acer');
        this._core = findHwmon('coretemp');
        this._nvidia = findNvidia();
        this._choices = new Set((readText(CHOICES_FILE) ?? '').split(/\s+/));
        this._modes = MODES.filter(m => this._choices.has(m.id));
        this._current = null;
        this._gpuCancel = null;
        this._gpu = null;
        this._menuTimer = 0;

        this.add_style_class_name('nitro-panel-button');
        const box = new St.BoxLayout({style_class: 'nitro-panel'});
        this._panelIcon = new St.Icon({style_class: 'system-status-icon nitro-panel-icon'});
        this._panelLabel = new St.Label({style_class: 'nitro-panel-label', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._panelIcon);
        box.add_child(this._panelLabel);
        this.add_child(box);

        this._buildMenu();
        this.menu.connect('open-state-changed', (_m, open) => this._onMenuOpen(open));
        this._refreshPanel();
    }

    _fileIcon(name) {
        return Gio.FileIcon.new(Gio.File.new_for_path(`${this._iconDir}/nitro-${name}-symbolic.svg`));
    }

    _container(styleClass) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: styleClass});
        this.menu.addMenuItem(item);
        return item;
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('nitro-menu');

        // ---- cartão do topo ----
        const head = new St.BoxLayout({style_class: 'nitro-head', x_expand: true});
        this._avatar = new St.Icon({style_class: 'nitro-avatar', icon_size: 22});
        const titles = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        titles.add_child(new St.Label({text: 'Acer Nitro V15', style_class: 'nitro-title'}));
        this._subtitle = new St.Label({style_class: 'nitro-sub'});
        titles.add_child(this._subtitle);
        this._pill = new St.Label({style_class: 'nitro-pill', y_align: Clutter.ActorAlign.CENTER});
        head.add_child(this._avatar);
        head.add_child(titles);
        head.add_child(this._pill);
        this._container('nitro-item').add_child(head);

        // ---- seletor de modo ----
        const grid = new St.BoxLayout({style_class: 'nitro-modes', x_expand: true});
        this._tiles = new Map();
        for (const m of this._modes) {
            const inner = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
            inner.add_child(new St.Icon({icon_name: m.icon, icon_size: 20, style_class: 'nitro-mode-icon', x_align: Clutter.ActorAlign.CENTER}));
            inner.add_child(new St.Label({text: m.label, style_class: 'nitro-mode-label', x_align: Clutter.ActorAlign.CENTER}));
            const tile = new St.Button({style_class: `nitro-mode nitro-${m.cls}`, child: inner, x_expand: true, can_focus: true});
            tile.connect('clicked', () => this._apply(m.id, true));
            grid.add_child(tile);
            this._tiles.set(m.id, tile);
        }
        this._container('nitro-item').add_child(grid);

        this._error = new St.Label({style_class: 'nitro-error', visible: false});
        this._error.clutter_text.line_wrap = true;
        this._container('nitro-item nitro-error-item').add_child(this._error);

        // ---- sensores ----
        const sensors = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-section', x_expand: true});
        sensors.add_child(new St.Label({text: 'Sensores', style_class: 'nitro-section-title'}));
        this._rows = {
            cpu: this._row(sensors, 'cpu', 'CPU'),
            gpu: this._row(sensors, 'gpu', 'GPU'),
            fan1: this._row(sensors, 'fan', 'Ventoinha 1'),
            fan2: this._row(sensors, 'fan', 'Ventoinha 2'),
        };
        this._container('nitro-item').add_child(sensors);

        // ---- GPU ----
        const gpu = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-section nitro-gpu', x_expand: true});
        const gpuHead = new St.BoxLayout({style_class: 'nitro-gpu-head'});
        gpuHead.add_child(new St.Label({text: 'GeForce RTX 3050', style_class: 'nitro-section-title', x_expand: true}));
        this._gpuState = new St.Label({style_class: 'nitro-gpu-state'});
        gpuHead.add_child(this._gpuState);
        gpu.add_child(gpuHead);
        this._chips = new St.BoxLayout({style_class: 'nitro-chips'});
        this._chip = {};
        for (const k of ['power', 'clock', 'vram', 'util']) {
            const c = new St.Label({style_class: 'nitro-chip'});
            this._chips.add_child(c);
            this._chip[k] = c;
        }
        gpu.add_child(this._chips);
        this._gpuIdle = new St.Label({text: 'Em repouso — economizando energia', style_class: 'nitro-gpu-idle'});
        gpu.add_child(this._gpuIdle);
        this._container('nitro-item').add_child(gpu);
    }

    _row(parent, icon, name) {
        const row = new St.BoxLayout({style_class: 'nitro-row', x_expand: true});
        row.add_child(new St.Icon({gicon: this._fileIcon(icon), icon_size: 14, style_class: 'nitro-row-icon', y_align: Clutter.ActorAlign.CENTER}));
        row.add_child(new St.Label({text: name, style_class: 'nitro-row-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const track = new St.Widget({style_class: 'nitro-track', layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        const fill = new St.Widget({style_class: 'nitro-fill nitro-idle', x_align: Clutter.ActorAlign.START, y_expand: true});
        track.add_child(fill);
        row.add_child(track);
        const value = new St.Label({style_class: 'nitro-row-value', y_align: Clutter.ActorAlign.CENTER});
        row.add_child(value);
        parent.add_child(row);
        return {fill, value};
    }

    _setRow(row, frac, text, cls) {
        row.fill.width = Math.round(Math.max(0, Math.min(1, frac)) * TRACK_W);
        row.fill.style_class = `nitro-fill ${cls}`;
        row.value.text = text;
    }

    // ---- leitura ----

    _cpuTemp() {
        const v = this._core ? readInt(`${this._core}/temp1_input`) : null;
        return v === null ? null : Math.round(v / 1000);
    }

    _readProfile() {
        const p = readText(PROFILE_FILE);
        if (p && p !== this._current) {
            const external = this._current !== null;
            this._current = p;
            this._ext.saveProfile(p);
            if (external)
                this._osd(p);
        }
        return this._current;
    }

    _refreshPanel() {
        const p = this._readProfile();
        const mode = MODES.find(m => m.id === p);
        this._panelIcon.icon_name = mode?.icon ?? 'power-profile-balanced-symbolic';
        this._panelIcon.style_class = `system-status-icon nitro-panel-icon nitro-${mode?.cls ?? 'turbo'}`;
        const t = this._cpuTemp();
        this._panelLabel.text = t === null ? '' : `${t}°`;
        this._panelLabel.style_class = `nitro-panel-label ${t !== null && t >= 90 ? 'nitro-hot-text' : ''}`;
        return GLib.SOURCE_CONTINUE;
    }

    _refreshMenu() {
        this._refreshPanel();
        const p = this._current;
        const mode = MODES.find(m => m.id === p);
        const ac = readText(AC_FILE) === '1';

        this._avatar.icon_name = mode?.icon ?? 'power-profile-performance-symbolic';
        this._avatar.style_class = `nitro-avatar nitro-${mode?.cls ?? 'turbo'}`;
        this._subtitle.text = ac ? 'Na tomada' : 'Na bateria';
        this._pill.text = mode?.label ?? (p ?? '—');
        this._pill.style_class = `nitro-pill nitro-${mode?.cls ?? 'turbo'}`;
        for (const [id, tile] of this._tiles) {
            if (id === p)
                tile.add_style_pseudo_class('checked');
            else
                tile.remove_style_pseudo_class('checked');
        }

        const cpu = this._cpuTemp();
        this._setRow(this._rows.cpu, (cpu ?? 0) / 100, cpu === null ? '—' : `${cpu} °C`, level(cpu, 75, 90));

        for (const k of ['fan1', 'fan2']) {
            const rpm = this._acer ? readInt(`${this._acer}/${k}_input`) : null;
            this._setRow(this._rows[k], (rpm ?? 0) / FAN_MAX_RPM, rpm === null ? '—' : `${rpm} rpm`,
                rpm === null ? 'nitro-idle' : rpm === 0 ? 'nitro-idle' : 'nitro-fan');
        }

        const active = this._nvidia && readText(`${this._nvidia}/power/runtime_status`) === 'active';
        if (active)
            this._queryGpu();
        else
            this._gpu = null;
        this._renderGpu(active);
        return GLib.SOURCE_CONTINUE;
    }

    _queryGpu() {
        if (this._gpuCancel)
            return;
        const cancel = new Gio.Cancellable();
        this._gpuCancel = cancel;
        const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, GPU_TIMEOUT_S, () => {
            cancel.cancel();
            return GLib.SOURCE_REMOVE;
        });
        try {
            const proc = Gio.Subprocess.new(['nvidia-smi',
                '--query-gpu=temperature.gpu,power.draw,clocks.gr,memory.used,memory.total,utilization.gpu',
                '--format=csv,noheader,nounits'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, cancel, (p, res) => {
                GLib.source_remove(timeout);
                if (this._gpuCancel === cancel)
                    this._gpuCancel = null;
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    const [temp, power, clock, used, total, util] = out.trim().split(',').map(s => parseFloat(s));
                    this._gpu = {temp, power, clock, used, total, util};
                    this._renderGpu(true);
                } catch {}
            });
        } catch {
            GLib.source_remove(timeout);
            this._gpuCancel = null;
        }
    }

    _renderGpu(active) {
        const g = this._gpu;
        this._gpuState.text = active ? 'Ativa' : 'Dormindo';
        this._gpuState.style_class = `nitro-gpu-state ${active ? 'nitro-on' : 'nitro-off'}`;
        this._chips.visible = active && !!g;
        this._gpuIdle.visible = !active;
        if (active && g) {
            this._setRow(this._rows.gpu, g.temp / 100, `${Math.round(g.temp)} °C`, level(g.temp, 75, 87));
            this._chip.power.text = `${Math.round(g.power)} W`;
            this._chip.clock.text = `${Math.round(g.clock)} MHz`;
            this._chip.vram.text = `VRAM ${(g.used / 1024).toFixed(1)}/${(g.total / 1024).toFixed(0)} GB`;
            this._chip.util.text = `Uso ${Math.round(g.util)}%`;
            this._chip.vram.style_class = `nitro-chip ${g.used / g.total > 0.9 ? 'nitro-chip-hot' : ''}`;
        } else if (!active) {
            this._setRow(this._rows.gpu, 0, 'zzz', 'nitro-idle');
        }
    }

    _onMenuOpen(open) {
        if (this._menuTimer) {
            GLib.source_remove(this._menuTimer);
            this._menuTimer = 0;
        }
        if (open) {
            this._refreshMenu();
            this._menuTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MENU_REFRESH_MS, () => this._refreshMenu());
        }
    }

    // ---- troca de modo ----

    _apply(id, interactive) {
        if (!this._choices.has(id))
            return;
        this._error.visible = false;
        try {
            const proc = Gio.Subprocess.new(['pkexec', HELPER, id],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                let err = '';
                try {
                    [, , err] = p.communicate_utf8_finish(res);
                } catch {}
                if (p.get_successful()) {
                    this._current = id;
                    this._ext.saveProfile(id);
                    if (interactive)
                        this._osd(id);
                } else if (interactive) {
                    const label = MODES.find(m => m.id === id)?.label ?? id;
                    this._error.text = p.get_exit_status() === 126
                        ? 'Autorização cancelada.'
                        : `Não deu pra ativar ${label}${err?.trim() ? `: ${err.trim()}` : '.'}`;
                    this._error.visible = true;
                }
                if (this.menu.isOpen)
                    this._refreshMenu();
                else
                    this._refreshPanel();
            });
        } catch (e) {
            this._error.text = `Falha ao chamar o helper: ${e.message}`;
            this._error.visible = true;
        }
    }

    _osd(id) {
        const mode = MODES.find(m => m.id === id);
        if (!mode)
            return;
        try {
            Main.osdWindowManager.showAll(Gio.ThemedIcon.new(mode.icon), `Modo ${mode.label}`, null, null);
        } catch {}
    }

    destroy() {
        this._onMenuOpen(false);
        this._gpuCancel?.cancel();
        super.destroy();
    }
});

export default class NitroExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._panelTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PANEL_REFRESH_S,
            () => this._indicator._refreshPanel());

        // Reaplica o último modo escolhido (o firmware volta pra "balanced" a cada boot)
        const saved = readText(STATE_FILE);
        if (saved && saved !== readText(PROFILE_FILE))
            this._indicator._apply(saved, false);
    }

    disable() {
        if (this._panelTimer) {
            GLib.source_remove(this._panelTimer);
            this._panelTimer = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;
    }

    saveProfile(id) {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(STATE_FILE), 0o755);
            GLib.file_set_contents(STATE_FILE, id);
        } catch {}
    }
}
