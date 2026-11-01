// Peças de configuração que podem morar no menu (laboratório das preferências): perfil automático, 60 Hz,
// GameMode, tecla NitroSense, curva de ventoinha, testador, estado do sistema e atalho das preferências.
// Cada uma devolve {actor, refresh()}; o menu chama refresh() quando abre.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {loadCurve, gamemodeState, setGamemode} from './utils.js';

const PROFILE_CHOICES = () => [
    ['', _('Keep')], ['low-power', _('Eco')], ['quiet', _('Quiet')], ['balanced', _('Balanced')], ['balanced-performance', _('Performance')],
];

// Linha clicável com ícone, título, uma segunda linha e um interruptor (o mesmo desenho do limite de carga)
function toggleRow(icon, title, onClick) {
    const box = new St.BoxLayout({style_class: 'nitro-toggle-row', x_expand: true});
    box.add_child(new St.Icon({icon_name: icon, icon_size: 16, style_class: 'nitro-toggle-icon', y_align: Clutter.ActorAlign.CENTER}));
    const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    text.add_child(new St.Label({text: title, style_class: 'nitro-toggle-name'}));
    const note = new St.Label({style_class: 'nitro-modesum'});
    text.add_child(note);
    box.add_child(text);
    const sw = new PopupMenu.Switch(false);
    sw.y_align = Clutter.ActorAlign.CENTER;
    box.add_child(sw);
    const button = new St.Button({child: box, style_class: 'nitro-toggle', x_expand: true, can_focus: true, accessible_name: title});
    button.connect('clicked', () => onClick(!sw.state));
    return {actor: button, sw, note};
}

// Interruptor ligado a uma chave booleana do GSettings
function settingSwitch(settings, key, icon, title, onNote, offNote) {
    const row = toggleRow(icon, title, on => settings.set_boolean(key, on));
    const refresh = () => {
        const on = settings.get_boolean(key);
        row.sw.state = on;
        row.note.text = on ? onNote : offNote;
    };
    const id = settings.connect(`changed::${key}`, refresh);
    row.actor.connect('destroy', () => settings.disconnect(id));
    refresh();
    return {actor: row.actor, refresh};
}

// ctx: {settings, openPrefs(), openTester(), status() → [{label, ok}]}
export function buildPiece(id, ctx) {
    const s = ctx.settings;
    switch (id) {
    case 'hz60':
        return settingSwitch(s, 'battery-60hz', 'video-display-symbolic', _('60 Hz screen on battery'),
            _('The laptop screen drops to 60 Hz off the charger'), _('Keeps the refresh rate on battery'));
    case 'turbokey':
        return settingSwitch(s, 'turbo-key', 'input-keyboard-symbolic', _('NitroSense key'),
            _('Toggles Performance'), _('The key does nothing'));
    case 'gamemode': {
        const row = toggleRow('input-gaming-symbolic', _('Game mode through GameMode'), on => {
            setGamemode(on);
            refresh();
        });
        const refresh = () => {
            const st = gamemodeState();
            row.sw.state = st === 'ours';
            row.actor.reactive = st !== 'other';
            row.note.text = st === 'other' ? _('You have your own gamemode.ini') : st === 'ours'
                ? _('The marked mode turns on when a game starts') : _('Off');
        };
        refresh();
        return {actor: row.actor, refresh};
    }
    case 'autoprofile':
        return autoProfile(s);
    case 'curve':
        return curvePiece(ctx);
    case 'tester':
    case 'prefs': {
        const b = new St.Button({label: id === 'tester' ? _('Test peripherals…') : _('Preferences…'),
            style_class: 'nitro-addmode', x_expand: true, can_focus: true});
        b.connect('clicked', () => (id === 'tester' ? ctx.openTester() : ctx.openPrefs()));
        return {actor: b, refresh: () => {}};
    }
    case 'status':
        return statusPiece(ctx);
    }
    return null;
}

// Duas linhas "Na tomada / Na bateria"; cada clique passa para o próximo perfil
function autoProfile(settings) {
    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-piece-card', x_expand: true});
    box.add_child(new St.Label({text: _('Automatic profile'), style_class: 'nitro-piece-title'}));
    const rows = [];
    for (const [key, label] of [['ac-profile', _('Plugged in')], ['battery-profile', _('On battery')]]) {
        const line = new St.BoxLayout({style_class: 'nitro-piece-line', x_expand: true});
        line.add_child(new St.Label({text: label, style_class: 'nitro-modesum', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const btn = new St.Button({style_class: 'nitro-chipbtn', can_focus: true, accessible_name: label});
        btn.connect('clicked', () => {
            const choices = PROFILE_CHOICES();
            const i = choices.findIndex(c => c[0] === settings.get_string(key));
            settings.set_string(key, choices[(i + 1) % choices.length][0]);
        });
        line.add_child(btn);
        box.add_child(line);
        rows.push([key, btn]);
    }
    const refresh = () => {
        for (const [key, btn] of rows)
            btn.label = `${PROFILE_CHOICES().find(c => c[0] === settings.get_string(key))?.[1] ?? '—'} ⟳`;
    };
    const ids = ['ac-profile', 'battery-profile'].map(k => settings.connect(`changed::${k}`, refresh));
    box.connect('destroy', () => ids.forEach(i => settings.disconnect(i)));
    refresh();
    return {actor: box, refresh};
}

// A curva em miniatura (°C → %) e um atalho para editá-la nas preferências
function curvePiece(ctx) {
    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-piece-card', x_expand: true});
    const head = new St.BoxLayout({x_expand: true});
    head.add_child(new St.Label({text: _('Fan curve'), style_class: 'nitro-piece-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
    const edit = new St.Button({label: _('Edit'), style_class: 'nitro-chipbtn', can_focus: true});
    edit.connect('clicked', () => ctx.openPrefs());
    head.add_child(edit);
    box.add_child(head);
    const area = new St.DrawingArea({style_class: 'nitro-curve-mini', x_expand: true});
    let points = loadCurve();
    area.connect('repaint', a => {
        const cr = a.get_context();
        const [w, h] = a.get_surface_size();
        const c = a.get_theme_node().get_color('-nitro-line');
        const x = t => (t - 30) / 70 * w;
        const y = p => h - 2 - p / 100 * (h - 4);
        const sorted = [...points].sort((p, q) => p[0] - q[0]);
        cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255, 1);
        cr.setLineWidth(2);
        cr.moveTo(0, y(sorted[0][1]));
        for (const [t, p] of sorted)
            cr.lineTo(x(t), y(p));
        cr.lineTo(x(92), y(sorted.at(-1)[1]));
        cr.lineTo(x(92), y(100));
        cr.lineTo(w, y(100));
        cr.stroke();
        for (const [t, p] of sorted) {
            cr.arc(x(t), y(p), 3, 0, 2 * Math.PI);
            cr.fill();
        }
        cr.$dispose();
    });
    box.add_child(area);
    return {actor: box, refresh: () => {
        points = loadCurve();
        area.queue_repaint();
    }};
}

// O estado do sistema numa linha de selos (✓ ou !)
function statusPiece(ctx) {
    const box = new St.BoxLayout({style_class: 'nitro-piece-card nitro-status-line', x_expand: true});
    const refresh = () => {
        box.destroy_all_children();
        for (const {label, ok} of ctx.status())
            box.add_child(new St.Label({text: `${ok ? '✓' : '!'} ${label}`, style_class: `nitro-status-chip ${ok ? '' : 'nitro-status-warn'}`}));
    };
    refresh();
    return {actor: box, refresh};
}
