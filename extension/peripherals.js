// Periféricos: lista de controles, mouses e teclados, bateria dos sem fio (UPower) e o que está sendo apertado agora.
// Controles: o comando nitro-input (system/nitro-input) lê o evdev e manda JSON; só roda com o menu ou o testador aberto.
// Mouse e teclado: o próprio Shell entrega os eventos (captured-event do stage), também só nesse intervalo.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {readText} from './utils.js';
import {parseInputDevices, padState} from './devices.js';

export const listInputDevices = () => parseInputDevices(readText('/proc/bus/input/devices') ?? '', _);

// ---- nomes dos botões (linux/input-event-codes.h) ----

const PAD_BUTTONS = {
    304: 'A', 305: 'B', 306: 'C', 307: 'Y', 308: 'X', 309: 'Z', 310: 'LB', 311: 'RB', 312: 'LT', 313: 'RT',
    314: 'Select', 315: 'Start', 316: 'Home', 317: 'L3', 318: 'R3',
    544: '↑', 545: '↓', 546: '←', 547: '→',
};
const padButtonName = code => PAD_BUTTONS[code] ?? _('Button %d').replace('%d', code);

const MOUSE_BUTTONS = () => ({1: _('left button'), 2: _('middle button'), 3: _('right button'), 8: _('back button'), 9: _('forward button')});

export const KIND_ICON = {
    gamepad: 'input-gaming-symbolic', mouse: 'input-mouse-symbolic', touchpad: 'input-touchpad-symbolic',
    keyboard: 'input-keyboard-symbolic', headset: 'audio-headset-symbolic', other: 'battery-symbolic',
};

// ---- bateria dos sem fio pelo UPower ----

// Tipos do UPower que são periféricos (fora a bateria do notebook e a tomada)
const UPOWER_KIND = {5: 'mouse', 6: 'keyboard', 12: 'gamepad', 14: 'touchpad', 17: 'headset', 19: 'headset'};

// cb([{kind, name, percentage}])
export function listBatteries(cb) {
    Gio.DBus.system.call('org.freedesktop.UPower', '/org/freedesktop/UPower', 'org.freedesktop.UPower',
        'EnumerateDevices', null, new GLib.VariantType('(ao)'), Gio.DBusCallFlags.NONE, 2000, null, (conn, res) => {
            let paths = [];
            try {
                [paths] = conn.call_finish(res).deepUnpack();
            } catch {
                cb([]);
                return;
            }
            const out = [];
            let left = paths.length;
            if (!left)
                cb(out);
            for (const path of paths) {
                conn.call('org.freedesktop.UPower', path, 'org.freedesktop.DBus.Properties', 'GetAll',
                    new GLib.Variant('(s)', ['org.freedesktop.UPower.Device']), null, Gio.DBusCallFlags.NONE, 2000, null, (c, r) => {
                        try {
                            const [props] = c.call_finish(r).recursiveUnpack();
                            if (!props.PowerSupply && props.Type > 2 && props.IsPresent !== false) {
                                out.push({kind: UPOWER_KIND[props.Type] ?? 'other', name: props.Model || props.NativePath,
                                    percentage: Math.round(props.Percentage)});
                            }
                        } catch {}
                        if (--left === 0)
                            cb(out);
                    });
            }
        });
}

// ---- controles: processo nitro-input ----

export const InputWatcher = GObject.registerClass({
    Signals: {
        'changed': {},                                            // lista de controles mudou
        'pad-event': {param_types: [GObject.TYPE_STRING, GObject.TYPE_JSOBJECT]},
    },
}, class InputWatcher extends GObject.Object {
    _init(bin) {
        super._init();
        this._bin = bin;
        this._users = 0;
        this._proc = null;
        this.pads = new Map();
    }

    // Contagem de quem usa (menu, testador): o processo só existe enquanto alguém está olhando
    hold() {
        if (this._users++ === 0)
            this._start();
    }

    release() {
        if (this._users > 0 && --this._users === 0)
            this._stop();
    }

    _start() {
        if (!GLib.file_test(this._bin, GLib.FileTest.IS_EXECUTABLE))
            return;
        try {
            this._proc = Gio.Subprocess.new([this._bin],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            logError(e, 'Nitro: nitro-input');
            return;
        }
        this._cancel = new Gio.Cancellable();
        this._stdout = new Gio.DataInputStream({base_stream: this._proc.get_stdout_pipe(), close_base_stream: true});
        this._readLine(this._proc, this._stdout, this._cancel);
    }

    _readLine(proc, stream, cancel) {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, cancel, (s, res) => {
            let line;
            try {
                [line] = s.read_line_finish_utf8(res);
            } catch {
                return;  // cancelado
            }
            if (line === null || proc !== this._proc)
                return;  // processo terminou
            try {
                this._handle(JSON.parse(line));
            } catch {}
            this._readLine(proc, stream, cancel);
        });
    }

    _handle(ev) {
        if (ev.t === 'add') {
            this.pads.set(ev.dev, {name: ev.name, bus: ev.bus, axes: ev.axes, buttons: ev.buttons,
                pressed: new Set(ev.pressed), abs: ev.abs});
            this.emit('changed');
        } else if (ev.t === 'remove') {
            this.pads.delete(ev.dev);
            this.emit('changed');
        } else if (ev.t === 'key' || ev.t === 'abs') {
            const pad = this.pads.get(ev.dev);
            if (!pad)
                return;
            if (ev.t === 'key') {
                if (ev.value)
                    pad.pressed.add(ev.code);
                else
                    pad.pressed.delete(ev.code);
            } else {
                pad.abs[ev.code] = ev.value;
            }
            this.emit('pad-event', ev.dev, ev);
        }
    }

    _stop() {
        this._cancel?.cancel();
        const proc = this._proc;
        this._proc = null;
        if (proc) {
            // fechar o stdin já faz o nitro-input sair; o force_exit é só garantia
            try {
                proc.get_stdin_pipe().close(null);
            } catch {}
            proc.force_exit();
        }
        this.pads.clear();
        this.emit('changed');
    }

    destroy() {
        this._users = 0;
        this._stop();
    }
});

// Texto curto do que acabou de acontecer num controle (ou null para movimentos pequenos)
export function describePadEvent(pad, ev) {
    if (ev.t === 'key')
        return ev.value ? padButtonName(ev.code) : null;
    if (ev.code === 16 && ev.value)
        return ev.value < 0 ? '←' : '→';
    if (ev.code === 17 && ev.value)
        return ev.value < 0 ? '↑' : '↓';
    const s = padState(pad);
    if (s.lt > 0.5 && [2, 10].includes(ev.code))
        return 'LT';
    if (s.rt > 0.5 && [5, 9].includes(ev.code))
        return 'RT';
    const far = st => st && Math.hypot(st[0], st[1]) > 0.6;
    if (far(s.left) && [0, 1].includes(ev.code))
        return _('left stick');
    if (far(s.right))
        return _('right stick');
    return null;
}

// Texto de um evento de mouse/teclado do Clutter, ou null
export function describeClutterEvent(event) {
    const type = event.type();
    if (type === Clutter.EventType.BUTTON_PRESS)
        return {kind: 'mouse', text: MOUSE_BUTTONS()[event.get_button()] ?? _('button %d').replace('%d', event.get_button())};
    if (type === Clutter.EventType.SCROLL) {
        let dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            if (Math.abs(dy) < 0.01)
                return null;
            dir = dy < 0 ? Clutter.ScrollDirection.UP : Clutter.ScrollDirection.DOWN;
        }
        return {kind: 'mouse', text: {[Clutter.ScrollDirection.UP]: _('scroll up'), [Clutter.ScrollDirection.DOWN]: _('scroll down'),
            [Clutter.ScrollDirection.LEFT]: _('scroll left'), [Clutter.ScrollDirection.RIGHT]: _('scroll right')}[dir] ?? null};
    }
    if (type === Clutter.EventType.KEY_PRESS)
        return {kind: 'keyboard', text: keyCombo(event)};
    return null;
}

const MODIFIER_NAMES = [
    [Clutter.ModifierType.CONTROL_MASK, 'Ctrl'], [Clutter.ModifierType.SHIFT_MASK, 'Shift'],
    [Clutter.ModifierType.MOD1_MASK, 'Alt'], [Clutter.ModifierType.SUPER_MASK, 'Super'],
];

function keyName(event) {
    const sym = event.get_key_symbol();
    const uni = event.get_key_unicode();
    if (uni && uni.trim() && uni.charCodeAt(0) >= 32)
        return uni.toUpperCase();
    return (Clutter.keyval_name(sym) ?? `#${event.get_key_code()}`).replace(/_[LR]$/, '').replace(/^Control$/, 'Ctrl');
}

function keyCombo(event) {
    const state = event.get_state();
    const name = keyName(event);
    const mods = MODIFIER_NAMES.filter(([mask, n]) => state & mask && n !== name).map(([, n]) => n);
    return [...mods, name].join(' + ');
}

// ---- seção do menu ----

export class PeripheralsSection {
    // Acordeão: fechado mostra só os ícones dos aparelhos lado a lado (acendem quando usados); aberto, a lista.
    // watcher: InputWatcher; settings: GSettings da extensão (peripherals-expanded); onTest(): abre o testador
    constructor({watcher, settings, onTest}) {
        this._watcher = watcher;
        this._settings = settings;
        this._onTest = onTest;
        this._dots = new Map();
        this._batteries = [];
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-accordion', x_expand: true});

        const head = new St.BoxLayout({style_class: 'nitro-accordion-head', x_expand: true});
        head.add_child(new St.Label({text: _('Peripherals'), style_class: 'nitro-accordion-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this._strip = new St.BoxLayout({style_class: 'nitro-periph-strip', y_align: Clutter.ActorAlign.CENTER});
        head.add_child(this._strip);
        this._chevron = new St.Icon({icon_size: 14, style_class: 'nitro-accordion-chevron', y_align: Clutter.ActorAlign.CENTER});
        head.add_child(this._chevron);
        this._toggle = new St.Button({child: head, style_class: 'nitro-accordion-button', x_expand: true, can_focus: true,
            accessible_name: _('Peripherals')});
        this._toggle.connect('clicked', () => this._settings.set_boolean('peripherals-expanded', !this._settings.get_boolean('peripherals-expanded')));
        this.actor.add_child(this._toggle);

        this._body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-accordion-body', x_expand: true});
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-periph-list', x_expand: true});
        this._body.add_child(this._list);
        this._last = new St.Label({style_class: 'nitro-periph-last', x_expand: true});
        this._last.clutter_text.ellipsize = 3;  // fim
        this._body.add_child(this._last);
        const test = new St.Button({label: _('Test peripherals…'), style_class: 'nitro-addmode', x_expand: true, can_focus: true});
        test.connect('clicked', () => this._onTest());
        this._body.add_child(test);
        this.actor.add_child(this._body);
        this._expandedId = settings.connect('changed::peripherals-expanded', () => this._syncExpanded());
        this._syncExpanded();
        this._watcherId = watcher.connect('changed', () => this.refresh());
        this._padId = watcher.connect('pad-event', (_w, dev, ev) => {
            const pad = watcher.pads.get(dev);
            const text = pad && describePadEvent(pad, ev);
            if (text)
                this.activity('gamepad', `${pad.name} · ${text}`);
        });
        this._last.text = _('Press a button on any device');
        // o Shell pode destruir o menu sem passar pelo disable() (ao sair, por exemplo)
        this.actor.connect('destroy', () => this.destroy());
    }

    _syncExpanded() {
        const open = this._settings.get_boolean('peripherals-expanded');
        this._body.visible = open;
        this._strip.visible = !open;
        this._chevron.icon_name = open ? 'pan-down-symbolic' : 'pan-end-symbolic';
        if (open)
            this._toggle.add_style_pseudo_class('checked');
        else
            this._toggle.remove_style_pseudo_class('checked');
    }

    // Menu abriu: relê os dispositivos e a bateria
    open() {
        this._last.text = _('Press a button on any device');
        this.refresh();
        listBatteries(list => {
            this._batteries = list;
            this.refresh();
        });
    }

    refresh() {
        this._clearDots();
        this._list.destroy_all_children();
        this._strip.destroy_all_children();
        const devices = listInputDevices();
        for (const d of devices) {
            const bat = this._batteries.find(b => b.kind === d.kind || d.name.includes(b.name));
            this._add(d.kind, d.name, bat?.percentage ?? null, d.wireless);
        }
        // baterias de aparelhos que não aparecem como entrada (fone, por exemplo)
        for (const b of this._batteries.filter(b => !devices.some(d => d.kind === b.kind || d.name.includes(b.name))))
            this._add(b.kind, b.name, b.percentage, true);
    }

    // Uma linha na lista e um ícone na faixa do acordeão fechado; os dois acendem juntos
    _add(kind, name, percentage, wireless) {
        this._list.add_child(this._row(kind, name, percentage, wireless));
        const low = percentage !== null && percentage <= 20;
        const icon = new St.Icon({icon_name: KIND_ICON[kind] ?? KIND_ICON.other, icon_size: 16,
            style_class: `nitro-periph-chip ${low ? 'nitro-periph-low' : ''}`, accessible_name: name});
        this._strip.add_child(icon);
        this._dots.get(kind).push(icon);
    }

    _row(kind, name, percentage, wireless) {
        const row = new St.BoxLayout({style_class: 'nitro-periph-row', x_expand: true});
        row.add_child(new St.Icon({icon_name: KIND_ICON[kind] ?? KIND_ICON.other, icon_size: 16, style_class: 'nitro-periph-icon', y_align: Clutter.ActorAlign.CENTER}));
        const label = new St.Label({text: name, style_class: 'nitro-periph-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.ellipsize = 3;
        row.add_child(label);
        if (percentage !== null)
            row.add_child(new St.Label({text: `${percentage}%`, style_class: `nitro-chip ${percentage <= 20 ? 'nitro-chip-hot' : ''}`, y_align: Clutter.ActorAlign.CENTER}));
        else if (wireless)
            row.add_child(new St.Icon({icon_name: 'network-wireless-symbolic', icon_size: 12, style_class: 'nitro-periph-icon', y_align: Clutter.ActorAlign.CENTER}));
        const dot = new St.Widget({style_class: 'nitro-periph-dot', y_align: Clutter.ActorAlign.CENTER});
        row.add_child(dot);
        if (!this._dots.has(kind))
            this._dots.set(kind, []);
        this._dots.get(kind).push(dot);
        return row;
    }

    // Acende o indicador do tipo de aparelho e mostra o que foi apertado
    activity(kind, text) {
        this._last.text = text;
        for (const dot of this._dots.get(kind) ?? (kind === 'mouse' ? this._dots.get('touchpad') ?? [] : [])) {
            dot.add_style_pseudo_class('active');
            if (dot._off)
                GLib.source_remove(dot._off);
            dot._off = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                dot._off = 0;
                dot.remove_style_pseudo_class('active');
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    destroy() {
        if (!this._watcherId)
            return;
        this._watcher.disconnect(this._watcherId);
        this._watcher.disconnect(this._padId);
        this._watcherId = this._padId = 0;
        this._settings.disconnect(this._expandedId);
        this._clearDots();
    }

    _clearDots() {
        for (const dots of this._dots.values()) {
            for (const d of dots) {
                if (d._off)
                    GLib.source_remove(d._off);
                d._off = 0;
            }
        }
        this._dots.clear();
    }
}

// ---- testador (janela) ----

// Teclado ABNT2 resumido: [código evdev, rótulo, largura em teclas]. O rótulo muda para o caractere real ao apertar.
const KEYBOARD = [
    [[1, 'Esc', 1.25], [59, 'F1'], [60, 'F2'], [61, 'F3'], [62, 'F4'], [63, 'F5'], [64, 'F6'], [65, 'F7'], [66, 'F8'], [67, 'F9'], [68, 'F10'], [87, 'F11'], [88, 'F12'], [111, 'Del', 1.25]],
    [[41, "'"], [2, '1'], [3, '2'], [4, '3'], [5, '4'], [6, '5'], [7, '6'], [8, '7'], [9, '8'], [10, '9'], [11, '0'], [12, '-'], [13, '='], [14, '⌫', 2]],
    [[15, 'Tab', 1.5], [16, 'Q'], [17, 'W'], [18, 'E'], [19, 'R'], [20, 'T'], [21, 'Y'], [22, 'U'], [23, 'I'], [24, 'O'], [25, 'P'], [26, '´'], [27, '['], [28, 'Enter', 1.5]],
    [[58, 'Caps', 1.75], [30, 'A'], [31, 'S'], [32, 'D'], [33, 'F'], [34, 'G'], [35, 'H'], [36, 'J'], [37, 'K'], [38, 'L'], [39, 'Ç'], [40, '~'], [43, ']'], [0, '', 1.25]],
    [[42, 'Shift', 1.25], [86, '\\'], [44, 'Z'], [45, 'X'], [46, 'C'], [47, 'V'], [48, 'B'], [49, 'N'], [50, 'M'], [51, ','], [52, '.'], [53, ';'], [89, '/'], [54, 'Shift', 1.75]],
    [[29, 'Ctrl', 1.25], [125, 'Super', 1.25], [56, 'Alt', 1.25], [57, '', 5.5], [100, 'AltGr', 1.25], [97, 'Ctrl', 1.25], [105, '←'], [103, '↑'], [108, '↓'], [106, '→']],
];
const KEY_UNIT = 34;

export const PeripheralsDialog = GObject.registerClass(
class PeripheralsDialog extends ModalDialog.ModalDialog {
    _init(watcher) {
        super._init({styleClass: 'nitro-tester', destroyOnClose: true});
        this._watcher = watcher;
        this._keys = new Map();
        this._mouse = {};
        this._timers = new Set();

        const title = new St.Label({text: _('Peripheral tester'), style_class: 'nitro-tester-title'});
        this.contentLayout.add_child(title);
        this._subtitle = new St.Label({text: _('Press keys, click, scroll or use a controller. Everything lights up here; nothing is sent to other apps.'),
            style_class: 'nitro-tester-sub'});
        this._subtitle.clutter_text.line_wrap = true;
        this.contentLayout.add_child(this._subtitle);
        this._battery = new St.BoxLayout({style_class: 'nitro-chips'});
        this.contentLayout.add_child(this._battery);

        const top = new St.BoxLayout({style_class: 'nitro-tester-row'});
        top.add_child(this._card(_('Mouse'), this._buildMouse()));
        top.add_child(this._card(_('Controller'), this._buildPad(), true));
        this.contentLayout.add_child(top);
        this.contentLayout.add_child(this._card(_('Keyboard'), this._buildKeyboard()));

        this._log = new St.Label({style_class: 'nitro-tester-log', text: ' '});
        this.contentLayout.add_child(this._log);

        this.addButton({label: _('Close'), action: () => this.close(), default: true});

        // com o diálogo aberto o Shell entrega a entrada só a ele (grab), então é aqui que se escuta
        this.connect('captured-event', (_a, ev) => this._onEvent(ev));
        this._padId = watcher.connect('pad-event', (_w, dev, ev) => this._onPad(dev, ev));
        this._padsId = watcher.connect('changed', () => this._renderPad());
        watcher.hold();
        listBatteries(list => {
            for (const b of list) {
                const chip = new St.BoxLayout({style_class: 'nitro-chip nitro-tester-bat'});
                chip.add_child(new St.Icon({icon_name: KIND_ICON[b.kind] ?? KIND_ICON.other, icon_size: 14}));
                chip.add_child(new St.Label({text: ` ${b.name} · ${b.percentage}%`}));
                this._battery.add_child(chip);
            }
        });
        this.connect('destroy', () => this._cleanup());
        this._renderPad();
    }

    _card(title, body, expand = false) {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-tester-card', x_expand: expand});
        const head = new St.BoxLayout({style_class: 'nitro-tester-head'});
        head.add_child(new St.Label({text: title, style_class: 'nitro-section-title', x_expand: true}));
        box._note = new St.Label({style_class: 'nitro-note', y_align: Clutter.ActorAlign.START});
        box._note.clutter_text.ellipsize = 3;
        head.add_child(box._note);
        box.add_child(head);
        box.add_child(body);
        return box;
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
    }

    _flash(actor, ms = 250) {
        actor.add_style_pseudo_class('active');
        this._later(ms, () => actor.remove_style_pseudo_class('active'));
    }

    // ---- mouse ----

    _buildMouse() {
        const wrap = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-mouse-wrap'});
        const up = new St.Label({text: '▲', style_class: 'nitro-scroll', x_align: Clutter.ActorAlign.CENTER});
        wrap.add_child(up);
        const body = new St.BoxLayout({style_class: 'nitro-mouse', x_align: Clutter.ActorAlign.CENTER});
        const side = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-mouse-side', y_align: Clutter.ActorAlign.CENTER});
        const fwd = new St.Widget({style_class: 'nitro-mouse-sidebtn'});
        const back = new St.Widget({style_class: 'nitro-mouse-sidebtn'});
        side.add_child(fwd);
        side.add_child(back);
        body.add_child(side);
        const shell = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-mouse-shell'});
        const btns = new St.BoxLayout({style_class: 'nitro-mouse-top'});
        const left = new St.Widget({style_class: 'nitro-mouse-btn nitro-mouse-left'});
        const mid = new St.Widget({style_class: 'nitro-mouse-wheel', y_align: Clutter.ActorAlign.START});
        const right = new St.Widget({style_class: 'nitro-mouse-btn nitro-mouse-right'});
        btns.add_child(left);
        btns.add_child(mid);
        btns.add_child(right);
        shell.add_child(btns);
        shell.add_child(new St.Widget({style_class: 'nitro-mouse-palm'}));
        body.add_child(shell);
        wrap.add_child(body);
        const down = new St.Label({text: '▼', style_class: 'nitro-scroll', x_align: Clutter.ActorAlign.CENTER});
        wrap.add_child(down);
        this._mouse = {1: left, 2: mid, 3: right, 8: back, 9: fwd, up, down};
        return wrap;
    }

    // ---- controle ----

    _buildPad() {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        const canvas = new St.Widget({style_class: 'nitro-pad', layout_manager: new Clutter.FixedLayout()});
        const place = (actor, x, y) => {
            actor.set_position(x, y);
            canvas.add_child(actor);
            return actor;
        };
        const btn = (label, cls, x, y) => place(new St.Label({text: label, style_class: `nitro-pad-btn ${cls}`}), x, y);
        const trigger = (label, x) => {
            const t = new St.Widget({style_class: 'nitro-pad-trigger', layout_manager: new Clutter.BinLayout()});
            const fill = new St.Widget({style_class: 'nitro-pad-trigger-fill', y_align: Clutter.ActorAlign.END, x_expand: true});
            t.add_child(fill);
            t.add_child(new St.Label({text: label, style_class: 'nitro-pad-trigger-label', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
            place(t, x, 0);
            return fill;
        };
        const stick = (x, y) => {
            const ring = place(new St.Widget({style_class: 'nitro-pad-stick', layout_manager: new Clutter.FixedLayout()}), x, y);
            const dot = new St.Widget({style_class: 'nitro-pad-stick-dot'});
            dot.set_position(19, 19);
            ring.add_child(dot);
            return {ring, dot};
        };
        this._pad = {
            lt: trigger('LT', 18), rt: trigger('RT', 300),
            310: btn('LB', 'nitro-pad-bumper', 56, 4), 311: btn('RB', 'nitro-pad-bumper', 226, 4),
            l: stick(30, 54), r: stick(196, 120),
            up: btn('▲', 'nitro-pad-dir', 104, 112), down: btn('▼', 'nitro-pad-dir', 104, 160),
            left: btn('◀', 'nitro-pad-dir', 80, 136), right: btn('▶', 'nitro-pad-dir', 128, 136),
            307: btn('Y', 'nitro-pad-face nitro-pad-y', 284, 46), 308: btn('X', 'nitro-pad-face nitro-pad-x', 256, 74),
            305: btn('B', 'nitro-pad-face nitro-pad-b', 312, 74), 304: btn('A', 'nitro-pad-face nitro-pad-a', 284, 102),
            314: btn('⧉', 'nitro-pad-small', 140, 56), 316: btn('⌂', 'nitro-pad-small nitro-pad-home', 170, 52),
            315: btn('≡', 'nitro-pad-small', 200, 56),
        };
        box.add_child(canvas);
        this._padChips = new St.Widget({style_class: 'nitro-pad-chips', x_expand: true,
            layout_manager: new Clutter.FlowLayout({orientation: Clutter.Orientation.HORIZONTAL, column_spacing: 4, row_spacing: 4})});
        box.add_child(this._padChips);
        this._padEmpty = new St.Label({text: _('No controller connected (USB or Bluetooth).'), style_class: 'nitro-gpu-idle'});
        box.add_child(this._padEmpty);
        return box;
    }

    _currentPad() {
        return [...this._watcher.pads.entries()][0] ?? null;
    }

    _renderPad() {
        const cur = this._currentPad();
        this._padEmpty.visible = !cur;
        this._padChips.destroy_all_children();
        this._padChipMap = new Map();
        const card = this._padChips.get_parent()?.get_parent();
        if (card?._note)
            card._note.text = cur ? cur[1].name : '';
        if (!cur)
            return;
        // todo botão que o aparelho diz ter, mesmo os que o desenho não mostra
        for (const code of cur[1].buttons.filter(c => c >= 0x100)) {
            const chip = new St.Label({text: padButtonName(code), style_class: 'nitro-pad-chip'});
            this._padChips.add_child(chip);
            this._padChipMap.set(code, chip);
        }
        this._paintPad(cur[1]);
    }

    _paintPad(pad) {
        const s = padState(pad);
        const set = (actor, on) => on ? actor.add_style_pseudo_class('active') : actor.remove_style_pseudo_class('active');
        for (const code of [304, 305, 307, 308, 310, 311, 314, 315, 316])
            set(this._pad[code], pad.pressed.has(code));
        set(this._pad.up, s.up);
        set(this._pad.down, s.down);
        set(this._pad.left, s.left_);
        set(this._pad.right, s.right_);
        for (const [key, which, l3] of [['l', s.left, 317], ['r', s.right, 318]]) {
            const v = which ?? [0, 0];
            this._pad[key].dot.set_position(19 + Math.round(v[0] * 17), 19 + Math.round(v[1] * 17));
            set(this._pad[key].ring, pad.pressed.has(l3) || Math.hypot(v[0], v[1]) > 0.25);
        }
        this._pad.lt.height = Math.round(s.lt * 30);
        this._pad.rt.height = Math.round(s.rt * 30);
        for (const [code, chip] of this._padChipMap)
            set(chip, pad.pressed.has(code));
    }

    _onPad(dev, ev) {
        const cur = this._currentPad();
        if (!cur || cur[0] !== dev)
            return;
        this._paintPad(cur[1]);
        const text = describePadEvent(cur[1], ev);
        if (text)
            this._log.text = `${_('Controller')} · ${text}`;
    }

    // ---- teclado ----

    _buildKeyboard() {
        const kb = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-kb'});
        for (const row of KEYBOARD) {
            const line = new St.BoxLayout({style_class: 'nitro-kb-row'});
            for (const [code, label, w = 1] of row) {
                const key = new St.Label({text: label, style_class: code ? 'nitro-key' : 'nitro-key nitro-key-blank',
                    style: `width: ${Math.round(w * KEY_UNIT - 4)}px;`});
                line.add_child(key);
                if (code)
                    this._keys.set(code, key);
            }
            kb.add_child(line);
        }
        return kb;
    }

    // ---- eventos do Shell (mouse e teclado) ----

    _onEvent(event) {
        const type = event.type();
        const dev = event.get_source_device()?.get_device_name() ?? '';
        if (type === Clutter.EventType.KEY_PRESS || type === Clutter.EventType.KEY_RELEASE) {
            const code = event.get_key_code() - 8;  // keycode do X/xkb = evdev + 8
            const key = this._keys.get(code);
            if (key) {
                if (type === Clutter.EventType.KEY_PRESS) {
                    key.add_style_pseudo_class('active');
                    key.add_style_pseudo_class('seen');
                    const uni = event.get_key_unicode();
                    if (uni && uni.length === 1 && /\p{L}|\p{N}|\p{P}|\p{S}/u.test(uni) && key.text.length === 1)
                        key.text = uni.toUpperCase();
                } else {
                    key.remove_style_pseudo_class('active');
                }
            }
            if (type === Clutter.EventType.KEY_PRESS) {
                this._log.text = `${_('Keyboard')} · ${keyCombo(event)}${dev ? `  (${dev})` : ''}`;
                // Tab/setas/Enter/Esc são para testar, não para mexer no diálogo
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.BUTTON_RELEASE) {
            const b = this._mouse[event.get_button()];
            if (b) {
                if (type === Clutter.EventType.BUTTON_PRESS)
                    b.add_style_pseudo_class('active');
                else
                    b.remove_style_pseudo_class('active');
            }
            if (type === Clutter.EventType.BUTTON_PRESS) {
                this._log.text = `${_('Mouse')} · ${describeClutterEvent(event)?.text ?? ''}${dev ? `  (${dev})` : ''}`;
                this._noteMouse(dev);
            }
            return Clutter.EVENT_PROPAGATE;  // o clique no "Fechar" precisa chegar ao botão
        }
        if (type === Clutter.EventType.SCROLL) {
            const d = describeClutterEvent(event);
            if (d?.text) {
                const up = d.text === _('scroll up');
                this._flash(up ? this._mouse.up : this._mouse.down);
                this._flash(this._mouse[2]);
                this._log.text = `${_('Mouse')} · ${d.text}`;
                this._noteMouse(dev);
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _noteMouse(dev) {
        const card = this._mouse[1]?.get_parent()?.get_parent()?.get_parent()?.get_parent()?.get_parent();
        if (card?._note && dev)
            card._note.text = dev;
    }

    _cleanup() {
        this._watcher.disconnect(this._padId);
        this._watcher.disconnect(this._padsId);
        this._watcher.release();
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
    }
});
