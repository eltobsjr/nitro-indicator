import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ModesSection} from './modes.js';
import {InputWatcher, PeripheralsSection, PeripheralsDialog, describeClutterEvent} from './peripherals.js';
import {initStore, loadModes, activeModeId} from './store.js';
import {
    readText, readInt, writeText, execAsync, findHwmon, findNvidia, onAc, machineName,
    fanBackend, fanState, batteryLimitFile, PPD_OF, ppdIntegrated,
} from './utils.js';

// Perfil térmico exposto pelo acer_wmi com predator_v4=1 (/etc/modprobe.d/acer-nitro.conf).
// Escrita via /usr/local/bin/nitro-profile + polkit (com.eltobsjr.nitro.policy, sem senha na sessão ativa),
// ou pelo power-profiles-daemon quando o tuned-ppd está integrado (ver utils.js: ppdIntegrated).
const PROFILE_FILE = '/sys/firmware/acpi/platform_profile';
const CHOICES_FILE = '/sys/firmware/acpi/platform_profile_choices';
const HELPER = '/usr/local/bin/nitro-profile';
const FAN_HELPER = '/usr/local/bin/nitro-fan';
const BATTERY_HELPER = '/usr/local/bin/nitro-battery';
const STATE_DIR = GLib.build_filenamev([GLib.get_user_state_dir(), 'nitro']);
const STATE_FILE = GLib.build_filenamev([STATE_DIR, 'profile']);
const FAN_FILE = GLib.build_filenamev([STATE_DIR, 'fan']);
const BATTERY_FILE = GLib.build_filenamev([STATE_DIR, 'battery-limit']);
const MODE_BIN = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'nitro-mode']);
const INPUT_BIN = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'nitro-input']);

// "performance" (Turbo, valor 5) aparece nas choices mas o firmware do ANV15-51 não tem Turbo: o bitmap de
// perfis suportados (misc setting 0x0A) é 0x53 = quiet|balanced|performance(4)|eco, e o SMM recusa o 5 (EIO).
// O "Performance" do NitroSense no Windows é o mesmo valor 4 = balanced-performance aqui, o máximo da máquina.
// Os rótulos são funções: o gettext da extensão só existe depois que ela é carregada.
const MODES = [
    {id: 'low-power', label: () => _('Eco'), icon: 'power-profile-power-saver-symbolic', cls: 'eco'},
    {id: 'quiet', label: () => _('Quiet'), icon: 'weather-clear-night-symbolic', cls: 'quiet'},
    {id: 'balanced', label: () => _('Balanced'), icon: 'power-profile-balanced-symbolic', cls: 'balanced'},
    {id: 'balanced-performance', label: () => _('Performance'), icon: 'power-profile-performance-symbolic', cls: 'perf'},
];

// Ventoinhas: pwm do acer-wmi ou o módulo nitro_fan (system/kmod); "curve" é o serviço nitro-fancurve
const FANS = [
    {id: 'auto', label: () => _('Auto'), icon: 'weather-windy-symbolic', cls: 'balanced'},
    {id: 'max', label: () => _('Max'), icon: 'weather-storm-symbolic', cls: 'turbo'},
    {id: 'curve', label: () => _('Curve'), icon: 'power-profile-balanced-symbolic', cls: 'perf'},
];

// O gamemoded avisa por D-Bus (ClientCount) quando um jogo abre e fecha
const GAMEMODE = {name: 'com.feralinteractive.GameMode', path: '/com/feralinteractive/GameMode', iface: 'com.feralinteractive.GameMode'};
const PPD = {name: 'org.freedesktop.UPower.PowerProfiles', path: '/org/freedesktop/UPower/PowerProfiles', iface: 'org.freedesktop.UPower.PowerProfiles'};
const UPOWER = {name: 'org.freedesktop.UPower', path: '/org/freedesktop/UPower', iface: 'org.freedesktop.UPower'};

const PEAK = 'balanced-performance';
// Tecla NitroSense/Turbo: o EC manda scancode PS/2 0xf5 no teclado AT, o hwdb do systemd mapeia p/ KEY_PROG1,
// que no XKB vira XF86Launch1. Não passa pelo acer_wmi, então dá pra pegar no Shell sem root.
const TURBO_KEY = 'XF86Launch1';

const PANEL_REFRESH_S = 3;
const MENU_REFRESH_MS = 1500;
const GPU_TIMEOUT_S = 4;
const FAN_MAX_RPM = 6000;
const TRACK_W = 120;
const ERROR_HIDE_S = 8;
const HISTORY_LEN = 60;          // 60 × 3 s = 3 min
const PPD_VERIFY_MS = 1500;      // tempo para o tuned aplicar o perfil antes de conferir
const AC_SETTLE_MS = 2500;       // o tuned-ppd reaplica o perfil dele ao trocar a fonte; esperamos ele terminar
const AC_GRACE_MS = 6000;        // nessa janela, mudança de perfil vinda de fora não vira "escolha do usuário"

function level(value, warn, hot) {
    if (value === null)
        return 'nitro-idle';
    return value >= hot ? 'nitro-hot' : value >= warn ? 'nitro-warn' : 'nitro-ok';
}

function profileLabel(id) {
    return MODES.find(m => m.id === id)?.label() ?? id;
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Nitro');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._acer = findHwmon('acer');
        this._core = findHwmon('coretemp');
        this._nvidia = findNvidia();
        this._choices = new Set((readText(CHOICES_FILE) ?? '').split(/\s+/));
        this._modes = MODES.filter(m => this._choices.has(m.id));
        this._current = null;
        this._wanted = readText(STATE_FILE);
        this._pending = null;
        this._acGraceUntil = 0;
        this._autoStartedMode = null;
        this._gameActive = false;
        this._gm = null;
        this._ppd = null;
        this._upower = null;
        this._onBattery = null;
        this._gpuCancel = null;
        this._gpu = null;
        this._gpuAt = 0;
        this._history = [];
        this._menuTimer = 0;
        this._errorTimer = 0;
        this._timers = new Set();
        this._watcher = new InputWatcher(INPUT_BIN);
        this._stageId = 0;

        this.add_style_class_name('nitro-panel-button');
        const box = new St.BoxLayout({style_class: 'nitro-panel'});
        this._panelIcon = new St.Icon({style_class: 'system-status-icon nitro-panel-icon'});
        this._panelLabel = new St.Label({style_class: 'nitro-panel-label', y_align: Clutter.ActorAlign.CENTER});
        this._panelGpu = new St.Label({style_class: 'nitro-panel-label nitro-panel-gpu', y_align: Clutter.ActorAlign.CENTER, visible: false});
        box.add_child(this._panelIcon);
        box.add_child(this._panelLabel);
        box.add_child(this._panelGpu);
        this.add_child(box);

        this._buildMenu();
        this._watchGameMode();
        this._watchPower();
        this.menu.connect('open-state-changed', (_m, open) => this._onMenuOpen(open));
        this._settingsIds = [
            this._settings.connect('changed::show-history', () => this._renderHistory()),
            this._settings.connect('changed::panel-gpu-temp', () => this._refreshPanel()),
            this._settings.connect('changed::show-peripherals', () => this._syncPeripherals()),
        ];
        this._syncPeripherals();
        this._refreshPanel();
    }

    // Timer de uma vez que some sozinho no destroy()
    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
    }

    // pinned: fica fora da área que rola (o cartão do topo)
    _container(styleClass, pinned = false) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: styleClass});
        (pinned ? this.menu : this._body).addMenuItem(item);
        return item;
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('nitro-menu');

        // ---- cartão do topo ----
        const head = new St.BoxLayout({style_class: 'nitro-head', x_expand: true});
        this._avatar = new St.Icon({style_class: 'nitro-avatar', icon_size: 22});
        const titles = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        titles.add_child(new St.Label({text: machineName(), style_class: 'nitro-title'}));
        this._subtitle = new St.Label({style_class: 'nitro-sub'});
        titles.add_child(this._subtitle);
        this._pill = new St.Label({style_class: 'nitro-pill', y_align: Clutter.ActorAlign.CENTER});
        head.add_child(this._avatar);
        head.add_child(titles);
        head.add_child(this._pill);
        this._container('nitro-item', true).add_child(head);

        // o resto rola: em tela baixa (900 px) o menu inteiro não cabe
        const scrollSection = new PopupMenu.PopupMenuSection();
        this._body = new PopupMenu.PopupMenuSection();
        const scroll = new St.ScrollView({style_class: 'nitro-scroll-area', hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true, y_expand: true});
        scroll.set_child(this._body.actor);
        scrollSection.actor.add_child(scroll);
        this.menu.addMenuItem(scrollSection);

        // ---- perfil ----
        const profile = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        profile.add_child(new St.Label({text: _('Profile'), style_class: 'nitro-section-title'}));
        const seg = this._segmented(this._modes, id => this._apply(id, true), false);
        this._tiles = seg.tiles;
        profile.add_child(seg.rail);
        this._container('nitro-item').add_child(profile);

        this._error = new St.Label({style_class: 'nitro-error', visible: false});
        this._error.clutter_text.line_wrap = true;
        this._container('nitro-item nitro-error-item').add_child(this._error);

        // ---- ventoinhas ----
        const fan = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const fanHead = new St.BoxLayout({x_expand: true});
        fanHead.add_child(new St.Label({text: _('Fans'), style_class: 'nitro-section-title', x_expand: true}));
        this._fanNote = new St.Label({style_class: 'nitro-note', y_align: Clutter.ActorAlign.CENTER});
        fanHead.add_child(this._fanNote);
        fan.add_child(fanHead);
        const fanSeg = this._segmented(FANS, id => this._setFan(id, true), true);
        this._fanTiles = fanSeg.tiles;
        fan.add_child(fanSeg.rail);
        this._fanWarn = new St.Label({style_class: 'nitro-sub nitro-hint', visible: false});
        this._fanWarn.clutter_text.line_wrap = true;
        fan.add_child(this._fanWarn);
        this._container('nitro-item').add_child(fan);

        // ---- bateria: limite de carga ----
        this._batteryItem = this._container('nitro-item');
        const bat = new St.BoxLayout({style_class: 'nitro-toggle-row', x_expand: true});
        bat.add_child(new St.Icon({icon_name: 'battery-level-80-symbolic', icon_size: 16, style_class: 'nitro-toggle-icon', y_align: Clutter.ActorAlign.CENTER}));
        const batText = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        batText.add_child(new St.Label({text: _('Limit charge to 80%'), style_class: 'nitro-toggle-name'}));
        this._batteryNote = new St.Label({style_class: 'nitro-modesum'});
        batText.add_child(this._batteryNote);
        bat.add_child(batText);
        this._batterySwitch = new PopupMenu.Switch(false);
        this._batterySwitch.y_align = Clutter.ActorAlign.CENTER;
        bat.add_child(this._batterySwitch);
        this._batteryButton = new St.Button({child: bat, style_class: 'nitro-toggle', x_expand: true, can_focus: true,
            accessible_name: _('Limit charge to 80%')});
        this._batteryButton.connect('clicked', () => this._setBatteryLimit(!this._batterySwitch.state, true));
        this._batteryItem.add_child(this._batteryButton);

        // ---- sensores ----
        const sensors = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        sensors.add_child(new St.Label({text: _('Sensors'), style_class: 'nitro-section-title'}));
        const grid = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-tiles', x_expand: true});
        this._rows = {};
        for (const pair of [[['cpu', 'CPU'], ['gpu', 'GPU']], [['fan1', _('Fan 1')], ['fan2', _('Fan 2')]]]) {
            const line = new St.BoxLayout({style_class: 'nitro-tiles', x_expand: true});
            line.layout_manager.homogeneous = true;
            for (const [key, name] of pair) {
                this._rows[key] = this._tile(name);
                line.add_child(this._rows[key].actor);
            }
            grid.add_child(line);
        }
        sensors.add_child(grid);

        // histórico de temperatura (3 min)
        this._historyBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-history', x_expand: true});
        const legend = new St.BoxLayout({style_class: 'nitro-history-legend', x_expand: true});
        legend.add_child(new St.Label({text: '● CPU', style_class: 'nitro-legend-cpu'}));
        legend.add_child(new St.Label({text: '● GPU', style_class: 'nitro-legend-gpu'}));
        legend.add_child(new St.Widget({x_expand: true}));
        this._historyRange = new St.Label({style_class: 'nitro-note'});
        legend.add_child(this._historyRange);
        this._historyBox.add_child(legend);
        this._chart = new St.DrawingArea({style_class: 'nitro-chart', x_expand: true});
        this._chart.connect('repaint', area => this._drawHistory(area));
        this._historyBox.add_child(this._chart);
        sensors.add_child(this._historyBox);
        this._container('nitro-item').add_child(sensors);

        // ---- modos (Gamer e os que o usuário criar) ----
        this._modesSection = new ModesSection({
            profiles: MODES.map(m => ({id: m.id, label: m.label()})),
            settings: this._settings,
            onToggle: id => this._toggleMode(id),
            onEdit: () => {
                this.menu.close();
                this._ext.openPreferences();
            },
        });
        this._container('nitro-item').add_child(this._modesSection.actor);

        // ---- periféricos ----
        this._periph = new PeripheralsSection({
            watcher: this._watcher,
            settings: this._settings,
            onTest: () => {
                this.menu.close();
                new PeripheralsDialog(this._watcher).open();
            },
        });
        this._periphItem = this._container('nitro-item');
        this._periphItem.add_child(this._periph.actor);

        // ---- GPU ----
        const gpu = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-section nitro-gpu', x_expand: true});
        const gpuHead = new St.BoxLayout({style_class: 'nitro-gpu-head'});
        this._gpuTitle = new St.Label({text: 'GPU NVIDIA', style_class: 'nitro-gpu-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        gpuHead.add_child(this._gpuTitle);
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
        this._gpuIdle = new St.Label({text: _('Sleeping — saving power'), style_class: 'nitro-gpu-idle'});
        gpu.add_child(this._gpuIdle);
        this._container('nitro-item').add_child(gpu);
    }

    // Trilho segmentado: só o item marcado (:checked) ganha a cor do token. horizontal = ícone ao lado do texto
    _segmented(items, onPick, horizontal) {
        const rail = new St.BoxLayout({style_class: 'nitro-seg', x_expand: true});
        rail.layout_manager.homogeneous = true;
        const tiles = new Map();
        for (const it of items) {
            const inner = new St.BoxLayout({
                orientation: horizontal ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
                style_class: horizontal ? 'nitro-seg-inline' : 'nitro-seg-stack',
                x_expand: true, x_align: Clutter.ActorAlign.CENTER,
            });
            inner.add_child(new St.Icon({icon_name: it.icon, icon_size: 18, style_class: 'nitro-seg-icon', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
            inner.add_child(new St.Label({text: it.label(), style_class: 'nitro-seg-label', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
            const tile = new St.Button({style_class: `nitro-seg-btn nitro-${it.cls}`, child: inner, x_expand: true, can_focus: true, accessible_name: it.label()});
            tile.connect('clicked', () => onPick(it.id));
            rail.add_child(tile);
            tiles.set(it.id, tile);
        }
        return {rail, tiles};
    }

    // Peça de sensor: nome, número grande com unidade e barra fina
    _tile(name) {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-tile', x_expand: true});
        box.add_child(new St.Label({text: name, style_class: 'nitro-tile-name'}));
        const line = new St.BoxLayout({style_class: 'nitro-tile-line'});
        const value = new St.Label({style_class: 'nitro-tile-value', y_align: Clutter.ActorAlign.END});
        const unit = new St.Label({style_class: 'nitro-tile-unit', y_align: Clutter.ActorAlign.END});
        line.add_child(value);
        line.add_child(unit);
        box.add_child(line);
        const track = new St.Widget({style_class: 'nitro-track', layout_manager: new Clutter.BinLayout(), x_expand: true});
        const fill = new St.Widget({style_class: 'nitro-fill nitro-idle', x_align: Clutter.ActorAlign.START, y_expand: true});
        track.add_child(fill);
        box.add_child(track);
        return {actor: box, track, fill, value, unit};
    }

    _setRow(row, frac, value, unit, cls) {
        row.fill.width = Math.round(Math.max(0, Math.min(1, frac)) * (row.track.get_width() || TRACK_W));
        row.fill.style_class = `nitro-fill ${cls}`;
        row.value.text = value;
        row.unit.text = unit;
    }

    // ---- leitura ----

    _cpuTemp() {
        let v = this._core ? readInt(`${this._core}/temp1_input`) : null;
        if (v === null) {  // o hwmonN muda quando o driver é recarregado: procura de novo
            this._core = findHwmon('coretemp') ?? findHwmon('k10temp');
            v = this._core ? readInt(`${this._core}/temp1_input`) : null;
        }
        return v === null ? null : Math.round(v / 1000);
    }

    _fanRpm(k) {
        let v = this._acer ? readInt(`${this._acer}/${k}_input`) : null;
        if (v === null) {  // o install.sh recarrega o acer_wmi com a extensão ligada
            this._acer = findHwmon('acer');
            v = this._acer ? readInt(`${this._acer}/${k}_input`) : null;
        }
        return v;
    }

    _gpuActive() {
        return !!this._nvidia && readText(`${this._nvidia}/power/runtime_status`) === 'active';
    }

    _readProfile() {
        const p = readText(PROFILE_FILE);
        if (p && p !== this._current) {
            const first = this._current === null;
            const ours = p === this._pending;
            this._current = p;
            if (ours)
                this._pending = null;
            // Mudança vinda de fora (Configurações rápidas, nitro-mode, tecla Fn) vira a escolha do usuário,
            // menos logo depois de trocar a fonte de energia: ali quem mexeu foi o tuned-ppd, e nós reaplicamos.
            if (!first && !ours && Date.now() > this._acGraceUntil) {
                this._wanted = p;
                this._ext.saveState(STATE_FILE, p);
                this._osd(p);
            }
        }
        return this._current;
    }

    // Tecla Turbo: alterna entre o modo mais forte que o firmware aceita e o último modo antes dele
    _turboKey() {
        const p = this._readProfile();
        if (p === PEAK)
            this._apply(this._lastNonPeak ?? 'balanced', true);
        else
            this._apply(PEAK, true);
    }

    _refreshPanel() {
        const p = this._readProfile();
        const mode = MODES.find(m => m.id === p);
        this._panelIcon.icon_name = mode?.icon ?? 'power-profile-balanced-symbolic';
        this._panelIcon.style_class = `system-status-icon nitro-panel-icon nitro-${mode?.cls ?? 'turbo'}`;
        const t = this._cpuTemp();
        this._panelLabel.text = t === null ? '' : `${t}°`;
        this._panelLabel.style_class = `nitro-panel-label ${t !== null && t >= 90 ? 'nitro-hot-text' : ''}`;

        const gpuActive = this._gpuActive();
        // GPU acordada: lê para o painel e o histórico (nunca acorda a placa só pra isso)
        const wantGpu = this._settings.get_boolean('panel-gpu-temp');
        if ((wantGpu || this._settings.get_boolean('show-history')) && gpuActive && !this.menu.isOpen)
            this._queryGpu();
        const g = gpuActive ? this._gpu : null;
        this._panelGpu.visible = wantGpu && !!g;
        if (g) {
            this._panelGpu.text = `${Math.round(g.temp)}°`;
            this._panelGpu.style_class = `nitro-panel-label nitro-panel-gpu ${g.temp >= 87 ? 'nitro-hot-text' : ''}`;
        }

        this._pushHistory(t, g && Date.now() - this._gpuAt < 10000 ? g.temp : null);
        this._modesSection.setActive(activeModeId());
        return GLib.SOURCE_CONTINUE;
    }

    _refreshMenu() {
        this._refreshPanel();
        const p = this._current;
        const mode = MODES.find(m => m.id === p);
        const ac = onAc();

        this._avatar.icon_name = mode?.icon ?? 'power-profile-performance-symbolic';
        this._avatar.style_class = `nitro-avatar nitro-${mode?.cls ?? 'turbo'}`;
        this._subtitle.text = ac === false ? _('On battery') : _('Plugged in');
        const activeMode = loadModes().find(m => m.id === this._modesSection.active);
        this._pill.text = activeMode?.name ?? mode?.label() ?? (p ?? '—');
        this._pill.style_class = `nitro-pill nitro-${mode?.cls ?? 'turbo'}`;
        for (const [id, tile] of this._tiles) {
            if (id === p)
                tile.add_style_pseudo_class('checked');
            else
                tile.remove_style_pseudo_class('checked');
        }

        this._renderFan();
        this._renderBattery();
        this._modesSection.refresh();

        const cpu = this._cpuTemp();
        this._setRow(this._rows.cpu, (cpu ?? 0) / 100, cpu === null ? '—' : `${cpu}`, cpu === null ? '' : '°C', level(cpu, 75, 90));

        for (const k of ['fan1', 'fan2']) {
            const rpm = this._fanRpm(k);
            this._setRow(this._rows[k], (rpm ?? 0) / FAN_MAX_RPM, rpm === null ? '—' : `${rpm}`, rpm === null ? '' : 'rpm',
                rpm === null || rpm === 0 ? 'nitro-idle' : 'nitro-fan');
        }

        const active = this._gpuActive();
        if (active)
            this._queryGpu();
        else
            this._gpu = null;
        this._renderGpu(active);
        this._renderHistory();
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
                '--query-gpu=name,temperature.gpu,power.draw,clocks.gr,memory.used,memory.total,utilization.gpu',
                '--format=csv,noheader,nounits'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, cancel, (p, res) => {
                GLib.source_remove(timeout);
                if (this._gpuCancel === cancel)
                    this._gpuCancel = null;
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    const [name, ...rest] = out.trim().split(',').map(s => s.trim());
                    const [temp, power, clock, used, total, util] = rest.map(s => parseFloat(s));
                    this._gpuTitle.text = name.replace(/^NVIDIA\s+/, '').replace(/^GeForce\s+/, 'GeForce ');
                    this._gpu = {temp, power, clock, used, total, util};
                    this._gpuAt = Date.now();
                    if (this.menu.isOpen)
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
        this._gpuState.text = active ? _('Active') : _('Sleeping');
        this._gpuState.style_class = `nitro-gpu-state ${active ? 'nitro-on' : 'nitro-off'}`;
        this._chips.visible = active && !!g;
        this._gpuIdle.visible = !active;
        if (active && g) {
            this._setRow(this._rows.gpu, g.temp / 100, `${Math.round(g.temp)}`, '°C', level(g.temp, 75, 87));
            this._chip.power.text = `${Math.round(g.power)} W`;
            this._chip.clock.text = `${Math.round(g.clock)} MHz`;
            this._chip.vram.text = `VRAM ${(g.used / 1024).toFixed(1)}/${(g.total / 1024).toFixed(0)} GB`;
            this._chip.util.text = _('Load %s').replace('%s', `${Math.round(g.util)}%`);
            this._chip.vram.style_class = `nitro-chip ${g.used / g.total > 0.9 ? 'nitro-chip-hot' : ''}`;
        } else if (!active) {
            this._setRow(this._rows.gpu, 0, 'zzz', '', 'nitro-idle');
        }
    }

    // ---- histórico ----

    _pushHistory(cpu, gpu) {
        this._history.push([cpu, gpu]);
        if (this._history.length > HISTORY_LEN)
            this._history.shift();
        if (this.menu.isOpen)
            this._chart.queue_repaint();
    }

    _renderHistory() {
        const show = this._settings.get_boolean('show-history');
        this._historyBox.visible = show;
        if (!show)
            return;
        const temps = this._history.flat().filter(v => v !== null);
        this._historyRange.text = temps.length
            ? _('%d–%d °C · last 3 min').replace('%d', Math.min(...temps)).replace('%d', Math.max(...temps))
            : _('collecting…');
        this._chart.queue_repaint();
    }

    _drawHistory(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const node = area.get_theme_node();
        const color = name => node.get_color(name);
        const lo = 30, hi = 100;
        const y = t => h - 2 - (Math.max(lo, Math.min(hi, t)) - lo) / (hi - lo) * (h - 4);
        const x = i => (i / (HISTORY_LEN - 1)) * w;

        // linhas de 50, 75 e 90 °C
        const grid = color('-nitro-grid');
        cr.setSourceRGBA(grid.red / 255, grid.green / 255, grid.blue / 255, grid.alpha / 255);
        cr.setLineWidth(1);
        for (const t of [50, 75, 90]) {
            cr.moveTo(0, Math.round(y(t)) + 0.5);
            cr.lineTo(w, Math.round(y(t)) + 0.5);
        }
        cr.stroke();

        const offset = HISTORY_LEN - this._history.length;
        for (const [idx, name] of [[1, '-nitro-gpu'], [0, '-nitro-cpu']]) {
            const c = color(name);
            cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255, 1);
            cr.setLineWidth(2);
            cr.setLineJoin(1);  // round
            let drawing = false;
            this._history.forEach((s, i) => {
                const v = s[idx];
                if (v === null) {
                    drawing = false;
                    return;
                }
                if (drawing)
                    cr.lineTo(x(offset + i), y(v));
                else
                    cr.moveTo(x(offset + i), y(v));
                drawing = true;
            });
            cr.stroke();
        }
        cr.$dispose();
    }

    _onMenuOpen(open) {
        if (this._menuTimer) {
            GLib.source_remove(this._menuTimer);
            this._menuTimer = 0;
        }
        this._menuInput(open && this._settings.get_boolean('show-peripherals'));
        if (open) {
            this._refreshMenu();
            this._menuTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MENU_REFRESH_MS, () => this._refreshMenu());
        }
    }

    // ---- periféricos: só escuta a entrada com o menu aberto ----

    _syncPeripherals() {
        this._periphItem.visible = this._settings.get_boolean('show-peripherals');
    }

    _menuInput(on) {
        if (on && !this._stageId) {
            this._watcher.hold();
            this._periph.open();
            // o menu aberto segura a entrada (grab): os eventos passam por ele, não pelo stage
            this._stageId = this.menu.actor.connect('captured-event', (_a, ev) => {
                const d = describeClutterEvent(ev);
                if (d?.text) {
                    const dev = ev.get_source_device()?.get_device_name();
                    this._periph.activity(d.kind, dev ? `${dev} · ${d.text}` : d.text);
                }
                return Clutter.EVENT_PROPAGATE;
            });
        } else if (!on && this._stageId) {
            this.menu.actor.disconnect(this._stageId);
            this._stageId = 0;
            this._watcher.release();
        }
    }

    // ---- troca de perfil ----

    _ppdUsable(id) {
        return !!this._ppd?.g_name_owner && id in PPD_OF && ppdIntegrated();
    }

    // interactive: veio de um clique/tecla (mostra OSD e erros)
    _apply(id, interactive) {
        if (!this._choices.has(id))
            return;
        this._hideError();
        if (interactive) {
            this._wanted = id;
            this._ext.saveState(STATE_FILE, id);
        }
        if (this._current && this._current !== PEAK && id === PEAK)
            this._lastNonPeak = this._current;
        this._pending = id;
        if (this._ppdUsable(id))
            this._applyPpd(id, interactive);
        else
            this._applyHelper(id, interactive);
    }

    // Pelo power-profiles-daemon: as Configurações rápidas do GNOME ficam em sincronia e o tuned
    // ajusta a CPU junto. Se o perfil Acer não chegar ao esperado, cai no helper.
    _applyPpd(id, interactive) {
        this._ppd.call('org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [PPD.iface, 'ActiveProfile', new GLib.Variant('s', PPD_OF[id])]),
            Gio.DBusCallFlags.NONE, -1, null, (proxy, res) => {
                try {
                    proxy.call_finish(res);
                } catch {
                    this._applyHelper(id, interactive);
                    return;
                }
                this._later(PPD_VERIFY_MS, () => {
                    if (readText(PROFILE_FILE) === id)
                        this._applied(id, interactive);
                    else
                        this._applyHelper(id, interactive);
                });
            });
    }

    _applyHelper(id, interactive) {
        execAsync(['pkexec', HELPER, id], (ok, msg, status) => {
            if (ok)
                this._applied(id, interactive);
            else if (interactive)
                this._showError(status === 126 ? _('Authorization cancelled.') : `${_('Could not switch to %s').replace('%s', profileLabel(id))}${msg ? `: ${msg}` : '.'}`);
            this._pending = null;
            this._refresh();
        });
    }

    _applied(id, interactive) {
        this._current = id;
        this._pending = null;
        if (interactive)
            this._osd(id);
        this._refresh();
    }

    _refresh() {
        if (this.menu.isOpen)
            this._refreshMenu();
        else
            this._refreshPanel();
    }

    // Perfil para a fonte de energia atual: o automático das preferências, senão a última escolha do usuário
    _targetProfile() {
        const ac = onAc();
        const auto = ac === null ? '' : this._settings.get_string(ac ? 'ac-profile' : 'battery-profile');
        return auto || this._wanted;
    }

    // ---- energia: PPD e tomada/bateria ----

    _watchPower() {
        const bus = Gio.BusType.SYSTEM;
        const flags = Gio.DBusProxyFlags.DO_NOT_AUTO_START;
        Gio.DBusProxy.new_for_bus(bus, flags, null, PPD.name, PPD.path, PPD.iface, null, (_o, res) => {
            try {
                this._ppd = Gio.DBusProxy.new_for_bus_finish(res);
            } catch {}
        });
        Gio.DBusProxy.new_for_bus(bus, flags, null, UPOWER.name, UPOWER.path, UPOWER.iface, null, (_o, res) => {
            try {
                this._upower = Gio.DBusProxy.new_for_bus_finish(res);
            } catch {
                return;
            }
            this._onBattery = this._upower.get_cached_property('OnBattery')?.unpack() ?? null;
            this._upowerId = this._upower.connect('g-properties-changed', () => {
                const now = this._upower.get_cached_property('OnBattery')?.unpack() ?? null;
                if (now === this._onBattery)
                    return;
                this._onBattery = now;
                this._powerSourceChanged();
            });
        });
    }

    // O tuned-ppd reaplica o perfil dele quando a fonte muda e passa por cima do perfil Acer escolhido.
    // Esperamos ele terminar e devolvemos o perfil certo para a nova fonte.
    _powerSourceChanged() {
        this._acGraceUntil = Date.now() + AC_GRACE_MS;
        this._later(AC_SETTLE_MS, () => {
            const target = this._targetProfile();
            if (target && this._choices.has(target) && readText(PROFILE_FILE) !== target)
                this._apply(target, false);
            this._refresh();
        });
    }

    // ---- ventoinhas ----

    _renderFan() {
        const backend = fanBackend(this._acer);
        const cur = fanState(backend);
        const shown = cur === 'unknown' ? this._ext.loadState(FAN_FILE) : cur;
        for (const [id, tile] of this._fanTiles) {
            tile.reactive = !!backend;
            tile.opacity = backend ? 255 : 110;
            if (backend && id === shown)
                tile.add_style_pseudo_class('checked');
            else
                tile.remove_style_pseudo_class('checked');
        }
        this._fanNote.text = !backend ? '' : {
            max: _('Fixed max speed'), curve: _('Following the curve'), custom: _('Fixed speed'),
        }[shown] ?? _('BIOS in control');
        this._fanWarn.text = _('Fan control unavailable: the nitro_fan module is not loaded. Run ./install.sh again (the kernel may have been updated).');
        this._fanWarn.visible = !backend;
    }

    _setFan(id, interactive) {
        this._hideError();
        const argv = id === 'curve' ? ['pkexec', FAN_HELPER, 'curve', 'on'] : ['pkexec', FAN_HELPER, id];
        execAsync(argv, (ok, msg, status) => {
            if (ok)
                this._ext.saveState(FAN_FILE, id);
            else if (interactive)
                this._showError(status === 126 ? _('Authorization cancelled.') : `${_('Could not change the fans')}${msg ? `: ${msg}` : '.'}`);
            if (this.menu.isOpen)
                this._refreshMenu();
        });
    }

    // ---- bateria ----

    _batteryLimit() {
        const f = batteryLimitFile();
        const v = f ? readInt(f) : null;
        return v === null ? null : v < 100;
    }

    _renderBattery() {
        const on = this._batteryLimit();
        this._batteryItem.visible = on !== null;
        if (on === null)
            return;
        this._batterySwitch.state = on;
        this._batteryNote.text = on ? _('Stops at 80% to extend battery life') : _('Charges up to 100%');
    }

    _setBatteryLimit(on, interactive) {
        this._hideError();
        execAsync(['pkexec', BATTERY_HELPER, on ? 'on' : 'off'], (ok, msg, status) => {
            if (ok)
                this._ext.saveState(BATTERY_FILE, on ? 'on' : 'off');
            else if (interactive)
                this._showError(status === 126 ? _('Authorization cancelled.') : `${_('Could not change the charge limit')}${msg ? `: ${msg}` : '.'}`);
            if (this.menu.isOpen)
                this._refreshMenu();
        });
    }

    // ---- modos ----

    _toggleMode(id) {
        this._hideError();
        this._modesSection.setBusy(id);
        execAsync([MODE_BIN, 'toggle', id], (ok, msg) => {
            this._modesSection.setBusy(null);
            this._modesSection.setActive(activeModeId());
            if (!ok)
                this._showError(msg ? `${_('Mode')}: ${msg}` : _('Could not apply the mode.'));
            this._refresh();
        });
    }

    _showError(text) {
        this._error.text = text;
        this._error.visible = true;
        if (this._errorTimer)
            GLib.source_remove(this._errorTimer);
        this._errorTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ERROR_HIDE_S, () => {
            this._errorTimer = 0;
            this._error.visible = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideError() {
        this._error.visible = false;
        if (this._errorTimer) {
            GLib.source_remove(this._errorTimer);
            this._errorTimer = 0;
        }
    }

    // Quando o GameMode registra um jogo, liga o modo marcado como "ligar ao abrir jogo"; ao fechar, desliga só o que ligamos
    _watchGameMode() {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
            GAMEMODE.name, GAMEMODE.path, GAMEMODE.iface, null, (_o, res) => {
                try {
                    this._gm = Gio.DBusProxy.new_for_bus_finish(res);
                } catch {
                    return;
                }
                if (!this._gm)
                    return;
                this._gmIds = [
                    this._gm.connect('g-properties-changed', () => this._readGameMode()),
                    this._gm.connect('notify::g-name-owner', () => this._readGameMode()),
                ];
                this._readGameMode();
            });
    }

    _readGameMode() {
        const count = this._gm?.g_name_owner ? this._gm.get_cached_property('ClientCount')?.unpack() ?? 0 : 0;
        const active = count > 0;
        if (active === this._gameActive)
            return;
        this._gameActive = active;
        if (active) {
            const id = this._modesSection.autoGameModeId();
            if (id && !activeModeId()) {
                this._autoStartedMode = id;
                this._toggleMode(id);
            }
        } else if (this._autoStartedMode) {
            const id = this._autoStartedMode;
            this._autoStartedMode = null;
            if (activeModeId() === id)
                this._toggleMode(id);
        }
    }

    _osd(id) {
        const mode = MODES.find(m => m.id === id);
        if (!mode)
            return;
        try {
            Main.osdWindowManager.showAll(Gio.ThemedIcon.new(mode.icon), _('%s mode').replace('%s', mode.label()), null, null);
        } catch {}
    }

    // Login/desbloqueio: o firmware volta ao padrão a cada boot; só chama o helper quando algo está diferente
    restore() {
        const target = this._targetProfile();
        if (target && this._choices.has(target) && target !== readText(PROFILE_FILE))
            this._apply(target, false);

        const fan = this._ext.loadState(FAN_FILE);
        const backend = fanBackend(this._acer);
        if (FANS.some(f => f.id === fan) && backend && fanState(backend) !== fan)
            this._setFan(fan, false);

        const bat = this._ext.loadState(BATTERY_FILE);
        const cur = this._batteryLimit();
        if ((bat === 'on' || bat === 'off') && cur !== null && cur !== (bat === 'on'))
            this._setBatteryLimit(bat === 'on', false);
    }

    destroy() {
        this._onMenuOpen(false);
        this._menuInput(false);
        this._periph?.destroy();
        this._watcher.destroy();
        this._hideError();
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        for (const id of this._gmIds ?? [])
            this._gm?.disconnect(id);
        if (this._upowerId)
            this._upower?.disconnect(this._upowerId);
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._gm = this._ppd = this._upower = null;
        this._gpuCancel?.cancel();
        super.destroy();
    }
});

export default class NitroExtension extends Extension {
    enable() {
        initStore(this.path);
        this._settings = this.getSettings();
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._panelTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PANEL_REFRESH_S,
            () => this._indicator._refreshPanel());
        this._indicator.restore();

        this._turboId = this._settings.connect('changed::turbo-key', () => this._syncTurboKey());
        this._syncTurboKey();
    }

    _syncTurboKey() {
        this._releaseTurboKey();
        if (this._settings.get_boolean('turbo-key'))
            this._grabTurboKey();
    }

    _grabTurboKey() {
        const action = global.display.grab_accelerator(TURBO_KEY, Meta.KeyBindingFlags.NONE);
        if (action === Meta.KeyBindingAction.NONE)
            return;
        this._keyAction = action;
        this._keyName = Meta.external_binding_name_for_action(action);
        Main.wm.allowKeybinding(this._keyName, Shell.ActionMode.ALL);
        this._keyId = global.display.connect('accelerator-activated', (_d, a) => {
            if (a === this._keyAction)
                this._indicator?._turboKey();
        });
    }

    _releaseTurboKey() {
        if (this._keyId) {
            global.display.disconnect(this._keyId);
            this._keyId = 0;
        }
        if (this._keyAction) {
            global.display.ungrab_accelerator(this._keyAction);
            Main.wm.allowKeybinding(this._keyName, Shell.ActionMode.NONE);
            this._keyAction = 0;
        }
    }

    disable() {
        if (this._turboId) {
            this._settings.disconnect(this._turboId);
            this._turboId = 0;
        }
        this._releaseTurboKey();
        if (this._panelTimer) {
            GLib.source_remove(this._panelTimer);
            this._panelTimer = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    saveState(file, value) {
        writeText(file, value);
    }

    loadState(file) {
        return readText(file);
    }
}
