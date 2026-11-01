// Laboratório de layout (preferências, GTK4): monte o menu numa grade de 4 colunas. Você escolhe a célula de
// cada item (soltar em cima de outro troca os dois ou empurra para baixo), o tamanho (ladrilhos 1x1…4x2 ou o bloco clássico de largura inteira),
// a distância entre os itens e parte de layouts prontos. Arraste da gaveta para a grade, dentro da grade, ou de
// volta para a gaveta; clique num item para o tamanho; teclado: setas movem, + e − trocam o tamanho, Delete
// tira, Enter abre as opções. Grava no GSettings na hora (as regras ficam em layout.js, testadas à parte).
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {
    ITEMS, GROUPS, PRESETS, PANEL_ITEMS, ALL_PANEL, COLS, sizeOf, parseItems, serialize, drop, remove, resize,
    firstFree, cleanPanel,
} from './layout.js';

// Peças com título que dá para esconder
const TITLED = ['profile', 'fans', 'sensors'];

// Aparência das peças: a mesma paleta da extensão (Catppuccin Macchiato), fixa, como no menu de verdade
const CSS = `
.lab-wrap { padding: 4px 0 12px; }
.lab-col-title { font-weight: 700; }
.lab-col-desc { font-size: 0.85em; opacity: 0.7; }
.lab-tray { background: alpha(currentColor, 0.06); border-radius: 12px; padding: 8px; min-height: 64px; }
.lab-tray-chip { background: #363a4f; color: #cad3f5; border-radius: 9px; padding: 6px 10px; }
.lab-tray-chip:focus-visible { outline: 2px solid @accent_bg_color; }
.lab-menu { background: #24273a; color: #cad3f5; border-radius: 16px; padding: 10px 0 12px; border: 1px solid alpha(white, 0.08); }
.lab-head { padding: 4px 12px 10px; }
.lab-avatar { background: alpha(#f5a97f, 0.18); color: #f5a97f; border-radius: 10px; min-width: 38px; min-height: 38px; font-weight: 800; }
.lab-fixed { font-size: 0.7em; font-weight: 700; color: #8087a2; }
.lab-zone { min-height: 40px; padding: 2px 0; border-radius: 10px; }
.lab-zone-empty { margin: 4px 12px; padding: 12px; border: 1.5px dashed alpha(white, 0.2); border-radius: 10px; color: #8087a2; font-size: 0.85em; }
.lab-piece { margin: 3px 12px; border-radius: 10px; outline: 1.5px solid transparent; }
.lab-piece:hover { outline-color: alpha(white, 0.22); }
.lab-piece:focus-visible { outline: 2px solid @accent_bg_color; }
.lab-dragging { opacity: 0.3; }
.lab-insert { min-height: 3px; margin: 1px 12px; border-radius: 99px; background: @accent_bg_color; }
.lab-insert-v { min-width: 3px; min-height: 20px; margin: 0; border-radius: 99px; background: @accent_bg_color; }
.lab-over { background: alpha(@accent_bg_color, 0.12); }
.lab-sec { font-weight: 700; font-size: 0.82em; color: #b7bdf8; }
.lab-seg { background: alpha(#363a4f, 0.75); border-radius: 10px; padding: 3px; }
.lab-seg-btn { border-radius: 7px; padding: 6px 2px; font-size: 0.74em; font-weight: 700; color: #a5adcb; }
.lab-seg-btn.on { background: alpha(#f5a97f, 0.22); color: #f5a97f; }
.lab-card { background: alpha(#363a4f, 0.75); border-radius: 10px; padding: 8px 10px; }
.lab-card-title { font-weight: 700; font-size: 0.84em; color: #b7bdf8; }
.lab-tile { background: alpha(#363a4f, 0.75); border-radius: 9px; padding: 6px 9px 8px; }
.lab-tile-name { font-size: 0.74em; color: #a5adcb; }
.lab-tile-val { font-size: 1.1em; font-weight: 800; }
.lab-pill { font-size: 0.7em; font-weight: 800; padding: 1px 8px; border-radius: 99px; background: alpha(#f5a97f, 0.2); color: #f5a97f; }
.lab-chip { font-size: 0.7em; font-weight: 700; padding: 1px 7px; border-radius: 6px; background: alpha(#c6a0f6, 0.16); color: #c6a0f6; }
.lab-ok { background: alpha(#a6da95, 0.18); color: #a6da95; }
.lab-warn { background: alpha(#eed49f, 0.18); color: #eed49f; }
.lab-dim { color: #8087a2; font-size: 0.8em; }
.lab-switch { min-width: 30px; min-height: 17px; border-radius: 99px; background: #8aadf4; }
.lab-icon { color: #a5adcb; }
.lab-btn { border: 1px solid #5b6078; border-radius: 10px; padding: 6px; font-size: 0.82em; font-weight: 700; color: #a5adcb; }
.lab-more { margin: 4px 12px 6px; padding: 8px 12px; border-radius: 10px; background: alpha(#363a4f, 0.75); color: #b7bdf8; font-weight: 700; font-size: 0.86em; }
.lab-more-count { font-size: 0.75em; padding: 1px 8px; border-radius: 99px; background: #494d64; color: #a5adcb; }
.lab-topbar { background: black; color: white; border-radius: 10px; padding: 6px 12px; }
.lab-clock { font-weight: 700; font-size: 0.86em; }
.lab-panel-zone { border: 1px dashed alpha(white, 0.25); border-radius: 8px; padding: 2px 6px; min-height: 26px; min-width: 80px; }
.lab-panel-chip { background: alpha(white, 0.1); color: white; border-radius: 7px; padding: 3px 8px; font-weight: 700; font-size: 0.86em; }
.lab-meter-ok { color: @success_color; }
.lab-meter-no { color: @warning_color; }
.lab-canvas { background: transparent; }
.lab-cell { border: 1px dashed alpha(white, 0.13); border-radius: 12px; }
.lab-item { border-radius: 14px; outline: 1.5px solid transparent; }
.lab-item:hover { outline-color: alpha(white, 0.25); }
.lab-item:focus-visible { outline: 2px solid @accent_bg_color; }
.lab-target-ok { background: alpha(@accent_bg_color, 0.22); border: 2px solid @accent_bg_color; border-radius: 14px; }
.lab-target-bad { background: alpha(@error_bg_color, 0.22); border: 2px solid @error_bg_color; border-radius: 14px; }
.lab-t { background: alpha(#363a4f, 0.85); border-radius: 14px; padding: 8px 9px; color: #cad3f5; }
.lab-t-on { background: alpha(#8aadf4, 0.22); }
.lab-t-label { font-size: 0.72em; font-weight: 700; color: #a5adcb; }
.lab-t-big { font-size: 1.45em; font-weight: 800; }
.lab-t-mid { font-size: 1.1em; font-weight: 800; }
.lab-t-sub { font-size: 0.7em; color: #8087a2; }
.lab-t-ic { background: alpha(#181926, 0.5); border-radius: 9px; min-width: 26px; min-height: 26px; }
.lab-t-on .lab-t-ic { background: #8aadf4; color: #181926; }
.lab-bar { min-height: 5px; border-radius: 99px; background: alpha(#8087a2, 0.25); }
.lab-bar-fill { min-height: 5px; border-radius: 99px; }
.lab-preset { padding: 8px 10px; }
.lab-preset-title { font-weight: 700; }
.lab-preset-sub { font-size: 0.8em; opacity: 0.7; }
.lab-group { font-size: 0.72em; font-weight: 700; letter-spacing: 0.06em; opacity: 0.6; margin-top: 4px; }
.lab-sizes { font-size: 0.75em; opacity: 0.6; }
`;

function label(text, cls, extra = {}) {
    return new Gtk.Label({label: text, css_classes: cls ? cls.split(' ') : [], xalign: 0, ...extra});
}

function hbox(spacing = 6, cls = '') {
    return new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing, css_classes: cls ? cls.split(' ') : []});
}

function vbox(spacing = 4, cls = '') {
    return new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing, css_classes: cls ? cls.split(' ') : []});
}

// Desenho em miniatura de cada peça (valores de exemplo; o menu de verdade mostra os ao vivo)
function drawPiece(_, id, variant, titleOn) {
    const box = vbox(4);
    const title = text => {
        if (titleOn)
            box.append(label(text, 'lab-sec'));
    };
    const seg = (items, on, icons) => {
        const s = hbox(3, 'lab-seg');
        s.homogeneous = true;
        items.forEach(([text, icon], i) => {
            const b = vbox(2, `lab-seg-btn${i === on ? ' on' : ''}`);
            if (icons)
                b.append(new Gtk.Image({icon_name: icon, pixel_size: 14}));
            b.append(new Gtk.Label({label: text}));
            s.append(b);
        });
        box.append(s);
    };
    const card = () => {
        const c = hbox(8, 'lab-card');
        box.append(c);
        return c;
    };
    const toggle = (icon, text) => {
        const c = card();
        c.append(new Gtk.Image({icon_name: icon, css_classes: ['lab-icon']}));
        c.append(label(text, 'lab-card-title', {hexpand: true}));
        c.append(new Gtk.Box({css_classes: ['lab-switch'], valign: Gtk.Align.CENTER}));
    };
    const chart = (h, lines) => {
        const area = new Gtk.DrawingArea({content_height: h, hexpand: true});
        area.set_draw_func((_a, cr, w, hh) => {
            for (const [color, pts] of lines) {
                cr.setSourceRGBA(...color, 1);
                cr.setLineWidth(1.8);
                pts.forEach(([x, y], i) => (i ? cr.lineTo(x * w, y * hh) : cr.moveTo(x * w, y * hh)));
                cr.stroke();
            }
        });
        return area;
    };
    switch (id) {
    case 'profile':
        title(_('Profile'));
        seg([[_('Eco'), 'power-profile-power-saver-symbolic'], [_('Quiet'), 'weather-clear-night-symbolic'],
            [_('Balanced'), 'power-profile-balanced-symbolic'], [_('Performance'), 'power-profile-performance-symbolic']], 3, variant === 'full');
        break;
    case 'fans':
        title(_('Fans'));
        seg([[_('Auto'), 'weather-windy-symbolic'], [_('Max'), 'weather-storm-symbolic'], [_('Curve'), 'power-profile-balanced-symbolic']], 1, variant === 'full');
        break;
    case 'battery':
        toggle('battery-level-80-symbolic', _('Limit charge to 80%'));
        break;
    case 'sensors':
        title(_('Sensors'));
        if (variant === 'row') {
            const c = card();
            for (const t of ['CPU 65°', 'GPU 49°', '2757/2570 rpm'])
                c.append(label(t, 'lab-tile-val', {hexpand: true}));
        } else {
            const g = new Gtk.Grid({column_spacing: 5, row_spacing: 5, column_homogeneous: true});
            [['CPU', '65 °C'], ['GPU', '49 °C'], [_('Fan 1'), '2757 rpm'], [_('Fan 2'), '2570 rpm']].forEach(([n, v], i) => {
                const t = vbox(0, 'lab-tile');
                t.append(label(n, 'lab-tile-name'));
                t.append(label(v, 'lab-tile-val'));
                g.attach(t, i % 2, Math.floor(i / 2), 1, 1);
            });
            box.append(g);
        }
        break;
    case 'history': {
        const c = vbox(2, 'lab-card');
        c.append(label('● CPU  ● GPU', 'lab-dim'));
        c.append(chart(variant === 'short' ? 20 : 40, [
            [[0.96, 0.66, 0.5], [[0, 0.6], [0.2, 0.55], [0.4, 0.35], [0.6, 0.4], [0.8, 0.2], [1, 0.25]]],
            [[0.65, 0.85, 0.58], [[0, 0.8], [0.3, 0.75], [0.6, 0.7], [1, 0.65]]],
        ]));
        box.append(c);
        break;
    }
    case 'modes': {
        const c = card();
        c.append(label(_('Modes'), 'lab-card-title'));
        c.append(label('Gamer', 'lab-pill'));
        c.append(label('⚙  ›', 'lab-dim', {hexpand: true, xalign: 1}));
        break;
    }
    case 'peripherals': {
        const c = card();
        c.append(label(_('Peripherals'), 'lab-card-title', {hexpand: true}));
        for (const icon of ['input-gaming-symbolic', 'input-keyboard-symbolic', 'input-mouse-symbolic'])
            c.append(new Gtk.Image({icon_name: icon, css_classes: ['lab-icon']}));
        break;
    }
    case 'gpu': {
        const c = vbox(5, 'lab-card');
        const h = hbox(6);
        h.append(label('GeForce RTX 3050', 'lab-card-title', {hexpand: true}));
        h.append(label(_('%d apps').replace('%d', 3), 'lab-chip'));
        h.append(label(_('Active'), 'lab-chip lab-ok'));
        c.append(h);
        if (variant !== 'compact') {
            const chips = hbox(4);
            for (const t of ['58 W', '1822 MHz', 'VRAM 4.1/6 GB'])
                chips.append(label(t, 'lab-chip'));
            c.append(chips);
        }
        box.append(c);
        break;
    }
    case 'autoprofile': {
        const c = vbox(3, 'lab-card');
        c.append(label(_('Automatic profile'), 'lab-card-title'));
        for (const [a, b] of [[_('Plugged in'), _('Performance')], [_('On battery'), _('Eco')]]) {
            const l = hbox(6);
            l.append(label(a, 'lab-dim', {hexpand: true}));
            l.append(label(`${b} ⟳`, 'lab-chip'));
            c.append(l);
        }
        box.append(c);
        break;
    }
    case 'hz60':
        toggle('video-display-symbolic', _('60 Hz screen on battery'));
        break;
    case 'gamemode':
        toggle('input-gaming-symbolic', _('Game mode through GameMode'));
        break;
    case 'turbokey':
        toggle('input-keyboard-symbolic', _('NitroSense key'));
        break;
    case 'curve': {
        const c = vbox(3, 'lab-card');
        const h = hbox(6);
        h.append(label(_('Fan curve'), 'lab-card-title', {hexpand: true}));
        h.append(label(_('Edit'), 'lab-chip'));
        c.append(h);
        c.append(chart(34, [[[0.96, 0.66, 0.5], [[0, 0.75], [0.29, 0.75], [0.43, 0.65], [0.57, 0.45], [0.71, 0.2], [0.83, 0.02], [1, 0.02]]]]));
        box.append(c);
        break;
    }
    case 'tester':
    case 'prefs':
        box.append(label(id === 'tester' ? _('Test peripherals…') : _('Preferences…'), 'lab-btn', {xalign: 0.5}));
        break;
    case 'status': {
        const c = card();
        for (const [t, ok] of [[_('Fans'), true], [_('Charge limit'), false], ['PPD', false], ['GNOME', false]])
            c.append(label(`${ok ? '✓' : '!'} ${t}`, `lab-chip ${ok ? 'lab-ok' : 'lab-warn'}`));
        break;
    }
    }
    return box;
}

// Ladrilho em miniatura (valores de exemplo; o menu de verdade mostra os ao vivo)
function drawTile(_, id, size) {
    const t = vbox(2, 'lab-t');
    t.set_vexpand(true);
    const lbl = s => t.append(label(s, 'lab-t-label'));
    const fill = () => t.append(new Gtk.Box({vexpand: true}));
    const big = (s, cls = 'lab-t-big') => t.append(label(s, cls));
    const sub = s => t.append(label(s, 'lab-t-sub'));
    const meter = (frac, color) => {
        const track = new Gtk.Box({css_classes: ['lab-bar']});
        const f = new Gtk.Box({css_classes: ['lab-bar-fill']});
        f.set_size_request(Math.round(frac * 60), -1);
        const css = new Gtk.CssProvider();
        css.load_from_string(`box { background: ${color}; }`);
        f.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        track.append(f);
        t.append(track);
    };
    const spark = (color, pts) => {
        const a = new Gtk.DrawingArea({vexpand: true, hexpand: true});
        a.set_draw_func((_a, cr, w, h) => {
            cr.setSourceRGBA(...color, 1);
            cr.setLineWidth(1.8);
            pts.forEach((y, i) => (i ? cr.lineTo(i / (pts.length - 1) * w, h - y * h) : cr.moveTo(0, h - y * h)));
            cr.stroke();
        });
        t.append(a);
    };
    const toggle = (icon, name, on) => {
        if (on)
            t.add_css_class('lab-t-on');
        const ic = new Gtk.Image({icon_name: icon, css_classes: ['lab-t-ic'], halign: Gtk.Align.START});
        t.append(ic);
        fill();
        t.append(label(name, 'lab-card-title', {wrap: true, lines: 2, ellipsize: 3}));
        sub(on ? _('On') : _('Off'));
    };
    const CPU = [0.3, 0.35, 0.5, 0.45, 0.6, 0.7, 0.65, 0.78], GPU = [0.3, 0.32, 0.36, 0.42, 0.45, 0.47, 0.5, 0.52];
    switch (id) {
    case 'cpu':
    case 'gputemp':
        lbl(id === 'cpu' ? 'CPU' : 'GPU');
        if (size === '1x1')
            fill();
        big(id === 'cpu' ? '65°' : '49°');
        if (size === '1x1')
            meter(0.65, '#a6da95');
        else
            spark(id === 'cpu' ? [0.96, 0.66, 0.5] : [0.65, 0.85, 0.58], id === 'cpu' ? CPU : GPU);
        break;
    case 'fan1':
    case 'fan2':
        lbl(id === 'fan1' ? _('Fan 1') : _('Fan 2'));
        fill();
        big(id === 'fan1' ? '2757' : '2570', size === '1x1' ? 'lab-t-mid' : 'lab-t-big');
        sub('rpm');
        meter(0.45, '#8aadf4');
        break;
    case 'batteryinfo':
        lbl(_('Battery'));
        fill();
        big('80%');
        sub(size === '1x1' ? _('health %d%%').replace('%d%%', '85%') : `11,8 W · 2 h 40 min`);
        break;
    case 'profile':
        if (size === '1x1') {
            lbl(_('Profile'));
            fill();
            t.append(new Gtk.Image({icon_name: 'power-profile-performance-symbolic', pixel_size: 20, halign: Gtk.Align.START}));
            t.append(label(_('Performance'), 'lab-card-title'));
        } else {
            lbl(_('Profile'));
            const g = new Gtk.Grid({column_spacing: 3, row_spacing: 3, column_homogeneous: true, row_homogeneous: true, vexpand: true});
            [[_('Eco'), 'power-profile-power-saver-symbolic'], [_('Quiet'), 'weather-clear-night-symbolic'],
                [_('Balanced'), 'power-profile-balanced-symbolic'], [_('Performance'), 'power-profile-performance-symbolic']].forEach(([n, ic], i) => {
                const b = vbox(1, `lab-seg-btn${i === 3 ? ' on' : ''}`);
                b.append(new Gtk.Image({icon_name: ic, pixel_size: 14}));
                b.append(new Gtk.Label({label: n, ellipsize: 3}));
                g.attach(b, i % 2, Math.floor(i / 2), 1, 1);
            });
            t.append(g);
        }
        break;
    case 'fans':
        lbl(_('Fans'));
        fill();
        if (size === '1x1') {
            t.append(new Gtk.Image({icon_name: 'weather-storm-symbolic', pixel_size: 20, halign: Gtk.Align.START}));
            t.append(label(_('Max'), 'lab-card-title'));
        } else {
            const s = hbox(3, 'lab-seg');
            s.homogeneous = true;
            [_('Auto (short)'), _('Max (short)'), _('Curve (short)')].forEach((n, i) => s.append(label(n, `lab-seg-btn${i === 1 ? ' on' : ''}`, {xalign: 0.5})));
            t.append(s);
        }
        break;
    case 'battery':
        toggle('battery-level-80-symbolic', _('Limit 80%'), true);
        break;
    case 'hz60':
        toggle('video-display-symbolic', _('60 Hz on battery'), false);
        break;
    case 'gamemode':
        toggle('input-gaming-symbolic', 'GameMode', true);
        break;
    case 'turbokey':
        toggle('input-keyboard-symbolic', _('NitroSense key'), true);
        break;
    case 'autoprofile':
        lbl(_('Automatic profile'));
        fill();
        for (const [a, b] of [[_('Plugged in'), _('Performance')], [_('On battery'), _('Eco')]]) {
            const l = hbox(6);
            l.append(label(a, 'lab-t-sub', {hexpand: true}));
            l.append(label(b, 'lab-chip'));
            t.append(l);
        }
        break;
    case 'history':
        lbl('● CPU  ● GPU');
        spark([0.96, 0.66, 0.5], CPU);
        break;
    case 'curve':
        lbl(_('Fan curve'));
        spark([0.96, 0.66, 0.5], [0.25, 0.25, 0.35, 0.55, 0.8, 1, 1]);
        sub('50° 25% → 88° 100%');
        break;
    case 'modes': {
        lbl(_('Modes'));
        fill();
        const l = hbox(4);
        l.append(label('● Gamer', 'lab-pill'));
        l.append(label('○ Silêncio', 'lab-chip'));
        t.append(l);
        break;
    }
    case 'peripherals': {
        lbl(_('Peripherals'));
        fill();
        const l = hbox(4);
        for (const ic of ['input-gaming-symbolic', 'input-keyboard-symbolic', 'input-mouse-symbolic'])
            l.append(new Gtk.Image({icon_name: ic, css_classes: ['lab-icon']}));
        t.append(l);
        break;
    }
    case 'gpuapps':
        lbl(_('Apps using the GPU'));
        for (const [n, sys] of [['Steam', false], ['Ptyxis', false], ['gnome-shell', true]]) {
            const l = hbox(6);
            l.append(label(n, 'lab-t-sub', {hexpand: true}));
            l.append(label(sys ? _('system') : _('Force'), sys ? 'lab-dim' : 'lab-chip lab-warn'));
            t.append(l);
        }
        break;
    case 'status': {
        lbl(_('System'));
        fill();
        const l = hbox(3);
        l.append(label('✓', 'lab-chip lab-ok'));
        l.append(label('! PPD', 'lab-chip lab-warn'));
        t.append(l);
        break;
    }
    case 'tester':
    case 'prefs':
        fill();
        t.append(new Gtk.Image({icon_name: id === 'tester' ? 'input-gaming-symbolic' : 'preferences-system-symbolic', pixel_size: 20}));
        t.append(label(id === 'tester' ? _('Test peripherals') : _('Preferences'), 'lab-card-title', {xalign: 0.5}));
        fill();
        break;
    }
    return t;
}

// Monta a página. settings: GSettings da extensão; _: gettext; Adw: o módulo (para os grupos)
export function buildLab(page, settings, _, Adw) {
    const css = new Gtk.CssProvider();
    css.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    const catalog = Object.fromEntries(ITEMS(_).map(i => [i.id, i]));
    const groups = GROUPS(_);
    const pans = Object.fromEntries(PANEL_ITEMS(_).map(s => [s.id, s]));
    const W = 376;  // largura da grade no menu (404 menos as bordas)
    const smallest = () => {
        const mons = Gdk.Display.get_default().get_monitors();
        let h = Infinity;
        for (let i = 0; i < mons.get_n_items(); i++)
            h = Math.min(h, mons.get_item(i).get_geometry().height);
        return Number.isFinite(h) ? h : 900;
    };

    // ---- estado (sempre lido do GSettings: o laboratório é uma vista dele) ----
    const items = () => parseItems(settings.get_strv('grid-items'));
    const save = list => settings.set_strv('grid-items', serialize(list));
    const gap = () => settings.get_int('grid-gap');
    const panel = () => cleanPanel(settings.get_strv('panel-items'));
    const savePanel = list => settings.set_strv('panel-items', list);

    // ---- estrutura ----
    const intro = new Adw.PreferencesGroup({description:
        _('Build your menu on a 4-column grid. Drag items from the drawer to the cell you want; drop on top of another item to swap them or push it down. Click an item to pick its size. Keyboard: arrows move one cell, + and − change the size, Delete takes it out, Enter opens the options. Changes apply right away.')});
    page.add(intro);
    const group = new Adw.PreferencesGroup();
    page.add(group);
    const wrap = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 22, css_classes: ['lab-wrap']});
    group.add(wrap);

    const left = vbox(8);
    left.set_size_request(270, -1);
    wrap.append(left);

    left.append(label(_('Ready-made layouts'), 'lab-col-title'));
    const presets = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, max_children_per_line: 2, column_spacing: 6, row_spacing: 6, homogeneous: true});
    for (const p of PRESETS(_)) {
        const b = new Gtk.Button({css_classes: ['lab-preset'], tooltip_text: p.subtitle});
        const inner = vbox(0);
        inner.append(label(p.title, 'lab-preset-title'));
        inner.append(label(p.subtitle, 'lab-preset-sub', {wrap: true, max_width_chars: 16}));
        b.set_child(inner);
        b.connect('clicked', () => save(p.items));
        presets.append(b);
    }
    left.append(presets);

    left.append(label(_('Space between items'), 'lab-col-title', {margin_top: 6}));
    const gapRow = hbox(8);
    const gapScale = new Gtk.Scale({orientation: Gtk.Orientation.HORIZONTAL, hexpand: true, draw_value: false,
        adjustment: new Gtk.Adjustment({lower: 0, upper: 24, step_increment: 1, page_increment: 4, value: gap()})});
    for (const v of [0, 8, 12, 24])
        gapScale.add_mark(v, Gtk.PositionType.BOTTOM, null);
    const gapValue = label(`${gap()} px`, 'lab-col-desc');
    gapScale.connect('value-changed', () => settings.set_int('grid-gap', Math.round(gapScale.get_value())));
    gapRow.append(gapScale);
    gapRow.append(gapValue);
    left.append(gapRow);

    left.append(label(_('Drawer'), 'lab-col-title', {margin_top: 6}));
    left.append(label(_('Drag to the grid, or press Enter to put it in the first free spot. Drop here to take an item out.'), 'lab-col-desc', {wrap: true}));
    const drawer = vbox(4, 'lab-tray');
    left.append(drawer);

    left.append(label(_('Outside the top bar'), 'lab-col-title', {margin_top: 6}));
    const ptray = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 6, row_spacing: 6,
        max_children_per_line: 3, css_classes: ['lab-tray']});
    left.append(ptray);

    const meterBox = vbox(4, 'lab-tray');
    const meterLabel = label('', '', {wrap: true});
    const meterBar = new Gtk.LevelBar({min_value: 0, max_value: 1});
    meterBox.append(label(_('Menu height'), 'lab-col-title'));
    meterBox.append(meterBar);
    meterBox.append(meterLabel);
    left.append(meterBox);

    const right = vbox(12);
    right.set_hexpand(true);
    wrap.append(right);
    const topbar = hbox(10, 'lab-topbar');
    topbar.append(label(_('Activities'), 'lab-dim'));
    topbar.append(label(_('Sun 1 Nov 03:20'), 'lab-clock', {hexpand: true, xalign: 0.5}));
    const pzone = hbox(6, 'lab-panel-zone');
    topbar.append(pzone);
    topbar.append(label('▾ ⏻', 'lab-dim'));
    right.append(topbar);

    const menu = vbox(0, 'lab-menu');
    menu.set_size_request(404, -1);
    menu.set_halign(Gtk.Align.CENTER);
    right.append(menu);
    const head = hbox(10, 'lab-head');
    head.append(new Gtk.Label({label: '⚡', css_classes: ['lab-avatar']}));
    const titles = vbox(0);
    titles.append(label('Nitro ANV15-51', 'lab-card-title'));
    titles.append(label(_('Plugged in'), 'lab-dim'));
    titles.set_hexpand(true);
    head.append(titles);
    head.append(label(_('fixed'), 'lab-fixed'));
    menu.append(head);
    const canvas = new Gtk.Fixed({css_classes: ['lab-canvas'], margin_start: 14, margin_end: 14});
    menu.append(canvas);

    // ---- geometria da grade no laboratório (linhas vazias aparecem, para dar onde soltar) ----
    let drag = null;          // {id, size, offX, offY, from: 'grid'|'drawer'}
    let widgets = {};         // id → widget na grade
    let geo = null;           // {cell, tops, heights, rows}
    let target = null;        // caixa da prévia de onde vai cair

    const measure = (w, width) => w.measure(Gtk.Orientation.VERTICAL, width)[1];
    const layoutGeo = list => {
        const g = gap();
        const cell = (W - g * (COLS - 1)) / COLS;
        const used = list.reduce((m, i) => Math.max(m, i.r + sizeOf(i.id, i.size).h), 0);
        const rows = used + 2;
        const heights = new Array(rows).fill(cell);
        for (const i of list) {
            if (sizeOf(i.id, i.size).auto)
                heights[i.r] = Math.max(48, measure(widgets[i.id], W));
        }
        const tops = [];
        let y = 0;
        for (const h of heights) {
            tops.push(y);
            y += h + g;
        }
        return {cell, gap: g, tops, heights, rows, height: y - g, used};
    };
    const rectOf = (g, item) => {
        const s = sizeOf(item.id, item.size);
        let h = 0;
        for (let r = item.r; r < item.r + s.h; r++)
            h += (g.heights[r] ?? g.cell) + (r > item.r ? g.gap : 0);
        return {x: item.c * (g.cell + g.gap), y: g.tops[item.r] ?? g.height + g.gap, w: s.w * g.cell + (s.w - 1) * g.gap, h};
    };
    const cellAt = (g, x, y, sz) => {
        let r = 0;
        for (let i = 0; i < g.tops.length; i++)
            if (y >= g.tops[i] - g.gap / 2)
                r = i;
        const c = sz.auto ? 0 : Math.max(0, Math.min(COLS - sz.w, Math.round(x / (g.cell + g.gap))));
        return {r, c};
    };

    // ---- opções de um item (popover) ----
    const options = (anchor, item) => {
        const pop = new Gtk.Popover({has_arrow: true});
        pop.set_parent(anchor);
        const box = vbox(6);
        for (const m of ['top', 'bottom', 'start', 'end'])
            box[`set_margin_${m}`](10);
        const it = catalog[item.id];
        box.append(label(it.title, 'lab-col-title'));
        let first = null;
        const list = items();
        for (const [key, name, w, h, auto] of it.sizes) {
            const ok = key === item.size || resize(list, item.id, key) !== null;
            const r = new Gtk.CheckButton({label: `${auto ? _('Full width') : `${w}×${h}`} · ${name}`, active: key === item.size,
                group: first, sensitive: ok, tooltip_text: ok ? null : _('Does not fit here: move it first')});
            first ??= r;
            r.connect('toggled', () => {
                if (r.get_active() && key !== item.size) {
                    const next = resize(items(), item.id, key);
                    if (next)
                        save(next);
                }
            });
            box.append(r);
        }
        if (TITLED.includes(item.id) && sizeOf(item.id, item.size).auto) {
            const t = new Gtk.CheckButton({label: _('Show the title'), active: !settings.get_strv('hidden-titles').includes(item.id)});
            t.connect('toggled', () => {
                const hidden = settings.get_strv('hidden-titles').filter(x => x !== item.id);
                if (!t.get_active())
                    hidden.push(item.id);
                settings.set_strv('hidden-titles', hidden);
            });
            box.append(t);
        }
        const out = new Gtk.Button({label: _('Take out of the menu'), css_classes: ['destructive-action']});
        out.connect('clicked', () => {
            pop.popdown();
            save(remove(items(), item.id));
        });
        box.append(out);
        pop.set_child(box);
        pop.connect('closed', () => pop.unparent());
        pop.popup();
    };

    // ---- arrastar ----
    const dragSource = (widget, info) => {
        const src = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        src.connect('prepare', (_s, x, y) => {
            drag = {...info(), offX: x, offY: y};
            return Gdk.ContentProvider.new_for_value(`grid:${drag.id}`);
        });
        src.connect('drag-begin', source => {
            source.set_icon(Gtk.WidgetPaintable.new(widget), drag?.offX ?? 10, drag?.offY ?? 10);
            widget.set_opacity(0.35);
        });
        src.connect('drag-end', () => {
            widget.set_opacity(1);
            clearTarget();
            drag = null;
        });
        widget.add_controller(src);
    };
    const clearTarget = () => {
        if (target) {
            canvas.remove(target);
            target = null;
        }
    };

    const canvasDrop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
    const candidate = (x, y) => {
        const sz = sizeOf(drag.id, drag.size);
        // da grade: onde você pegou o item; da gaveta (peça larga): o ponteiro é o meio da primeira célula
        const offX = drag.from === 'drawer' ? geo.cell / 2 : drag.offX;
        const offY = drag.from === 'drawer' ? geo.cell / 2 : drag.offY;
        const {r, c} = cellAt(geo, x - (sz.auto ? 0 : offX), y - offY + 12, sz);
        const item = {id: drag.id, size: sz.key, r, c};
        const next = drop(items(), item);
        return {item, next, ok: !!next};
    };
    canvasDrop.connect('motion', (_t, x, y) => {
        if (!drag || drag.kind !== 'item')
            return 0;
        const {item, ok} = candidate(x, y);
        clearTarget();
        const rc = rectOf(geo, item);
        target = new Gtk.Box({css_classes: [ok ? 'lab-target-ok' : 'lab-target-bad'], can_target: false});
        target.set_size_request(rc.w, rc.h);
        canvas.put(target, rc.x, rc.y);
        return ok ? Gdk.DragAction.MOVE : 0;
    });
    canvasDrop.connect('leave', clearTarget);
    canvasDrop.connect('drop', (_t, _v, x, y) => {
        if (!drag || drag.kind !== 'item')
            return false;
        const {next} = candidate(x, y);
        clearTarget();
        if (next)
            save(next);
        return !!next;
    });
    canvas.add_controller(canvasDrop);

    const drawerDrop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
    drawerDrop.connect('drop', () => {
        if (drag?.kind === 'item' && drag.from === 'grid')
            save(remove(items(), drag.id));
        return true;
    });
    drawer.add_controller(drawerDrop);

    // ---- teclado ----
    let refocus = null;
    const keys = (widget, getItem) => {
        const k = new Gtk.EventControllerKey();
        k.connect('key-pressed', (_c, keyval) => {
            const item = getItem();
            const list = items();
            const moveBy = (dr, dc) => drop(list, {...item, r: item.r + dr, c: sizeOf(item.id, item.size).auto ? 0 : item.c + dc});
            let next = null;
            if (keyval === Gdk.KEY_Up)
                next = moveBy(-1, 0);
            else if (keyval === Gdk.KEY_Down)
                next = moveBy(1, 0);
            else if (keyval === Gdk.KEY_Left)
                next = moveBy(0, -1);
            else if (keyval === Gdk.KEY_Right)
                next = moveBy(0, 1);
            else if (keyval === Gdk.KEY_plus || keyval === Gdk.KEY_KP_Add || keyval === Gdk.KEY_minus || keyval === Gdk.KEY_KP_Subtract) {
                const sizes = catalog[item.id].sizes.map(s => s[0]);
                const dir = keyval === Gdk.KEY_minus || keyval === Gdk.KEY_KP_Subtract ? -1 : 1;
                for (let i = sizes.indexOf(item.size) + dir; i >= 0 && i < sizes.length && !next; i += dir)
                    next = resize(list, item.id, sizes[i]);
            } else if (keyval === Gdk.KEY_Delete || keyval === Gdk.KEY_BackSpace) {
                next = remove(list, item.id);
            } else if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_space) {
                options(widget, item);
                return true;
            } else {
                return false;
            }
            if (next) {
                refocus = item.id;
                save(next);
            }
            return true;
        });
        widget.add_controller(k);
    };

    // ---- barra superior (ordem e o que aparece) ----
    const panelPiece = (id, inBar) => {
        const sample = {icon: '⚡', cpu: '65°', gpu: '49°', mode: 'Gamer', fan: '2757 rpm', power: '11,8 W'}[id];
        const w = hbox(4, inBar ? 'lab-panel-chip' : 'lab-tray-chip');
        w.append(new Gtk.Label({label: inBar ? sample : `${sample}  ${pans[id].title}`}));
        w.set_tooltip_text(pans[id].subtitle);
        w.set_focusable(true);
        w._panelId = id;
        const src = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        src.connect('prepare', () => {
            drag = {kind: 'panel', id};
            return Gdk.ContentProvider.new_for_value(`panel:${id}`);
        });
        src.connect('drag-begin', source => source.set_icon(Gtk.WidgetPaintable.new(w), 10, 10));
        src.connect('drag-end', () => {
            drag = null;
        });
        w.add_controller(src);
        const k = new Gtk.EventControllerKey();
        k.connect('key-pressed', (_c, keyval) => {
            const list = panel();
            const i = list.indexOf(id);
            if (!inBar && (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_space))
                savePanel([...list, id]);
            else if (inBar && (keyval === Gdk.KEY_Delete || keyval === Gdk.KEY_BackSpace))
                savePanel(list.filter(x => x !== id));
            else if (inBar && keyval === Gdk.KEY_Left && i > 0)
                savePanel([...list.slice(0, i - 1), id, list[i - 1], ...list.slice(i + 1)]);
            else if (inBar && keyval === Gdk.KEY_Right && i < list.length - 1)
                savePanel([...list.slice(0, i), list[i + 1], id, ...list.slice(i + 2)]);
            else
                return false;
            return true;
        });
        w.add_controller(k);
        return w;
    };
    const panelDrop = (zone, inBar) => {
        const t = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
        t.connect('motion', () => (drag?.kind === 'panel' ? Gdk.DragAction.MOVE : 0));
        t.connect('drop', (_t, _v, x) => {
            if (drag?.kind !== 'panel')
                return false;
            const list = panel().filter(id => id !== drag.id);
            if (!inBar) {
                savePanel(list);
                return true;
            }
            // antes do primeiro item cujo meio está à direita do ponteiro
            let at = list.length;
            let i = 0;
            for (let c = zone.get_first_child(); c; c = c.get_next_sibling()) {
                if (!c._panelId || c._panelId === drag.id)
                    continue;
                const [ok, b] = c.compute_bounds(zone);
                if (ok && x < b.get_x() + b.get_width() / 2) {
                    at = i;
                    break;
                }
                i++;
            }
            list.splice(at, 0, drag.id);
            savePanel(list);
            return true;
        });
        zone.add_controller(t);
    };
    panelDrop(pzone, true);
    panelDrop(ptray, false);

    // ---- desenha a partir do GSettings ----
    const clear = box => {
        for (let c = box.get_first_child(); c;) {
            const n = c.get_next_sibling();
            box.remove(c);
            c = n;
        }
    };
    const render = () => {
        const list = items();
        const hiddenTitles = settings.get_strv('hidden-titles');
        clearTarget();
        clear(canvas);
        widgets = {};

        // itens da grade (primeiro cria, para medir os blocos clássicos)
        for (const item of list) {
            const sz = sizeOf(item.id, item.size);
            const w = sz.auto ? drawPiece(_, item.id, item.size, !hiddenTitles.includes(item.id)) : drawTile(_, item.id, item.size);
            w.add_css_class('lab-item');
            w.set_focusable(true);
            w.set_tooltip_text(`${catalog[item.id].title}: ${_('drag to move, click for the size')}`);
            const click = new Gtk.GestureClick();
            click.connect('released', () => options(w, items().find(i => i.id === item.id) ?? item));
            w.add_controller(click);
            dragSource(w, () => ({kind: 'item', id: item.id, size: item.size, from: 'grid'}));
            keys(w, () => items().find(i => i.id === item.id) ?? item);
            widgets[item.id] = w;
            canvas.put(w, 0, 0);  // na janela, para o tema valer na medição
        }
        geo = layoutGeo(list);
        for (const w of Object.values(widgets))
            canvas.remove(w);
        // células livres tracejadas: onde dá para soltar (as ocupadas ficam por baixo do item)
        const busy = new Set();
        for (const item of list) {
            const sz = sizeOf(item.id, item.size);
            for (let r = item.r; r < item.r + sz.h; r++)
                for (let c = item.c; c < item.c + sz.w; c++)
                    busy.add(`${r},${c}`);
        }
        for (let r = 0; r < geo.rows; r++) {
            for (let c = 0; c < COLS; c++) {
                if (busy.has(`${r},${c}`))
                    continue;
                const cell = new Gtk.Box({css_classes: ['lab-cell'], can_target: false});
                cell.set_size_request(Math.floor(geo.cell), Math.floor(geo.heights[r]));
                canvas.put(cell, c * (geo.cell + geo.gap), geo.tops[r]);
            }
        }
        for (const item of list) {
            const rc = rectOf(geo, item);
            widgets[item.id].set_size_request(Math.floor(rc.w), Math.floor(rc.h));
            canvas.put(widgets[item.id], rc.x, rc.y);
        }
        canvas.set_size_request(W, geo.height);

        // gaveta, por grupo
        clear(drawer);
        const placed = new Set(list.map(i => i.id));
        let any = false;
        for (const [g, gname] of Object.entries(groups)) {
            const its = ITEMS(_).filter(i => i.group === g && !placed.has(i.id));
            if (!its.length)
                continue;
            any = true;
            drawer.append(label(gname.toUpperCase(), 'lab-group'));
            for (const it of its) {
                const chip = hbox(6, 'lab-tray-chip');
                chip.append(new Gtk.Image({icon_name: it.icon}));
                chip.append(label(it.title, '', {hexpand: true, ellipsize: 3}));
                chip.append(label(it.sizes.map(s => (s[4] ? '▬' : `${s[2]}×${s[3]}`)).join(' '), 'lab-sizes'));
                chip.set_focusable(true);
                chip.set_tooltip_text(_('Drag to the grid or press Enter'));
                dragSource(chip, () => ({kind: 'item', id: it.id, size: it.sizes[0][0], from: 'drawer'}));
                const k = new Gtk.EventControllerKey();
                k.connect('key-pressed', (_c, keyval) => {
                    if (keyval !== Gdk.KEY_Return && keyval !== Gdk.KEY_space)
                        return false;
                    const spot = firstFree(items(), it.id, it.sizes[0][0]);
                    if (spot)
                        save([...items(), spot]);
                    return true;
                });
                chip.add_controller(k);
                drawer.append(chip);
            }
        }
        if (!any)
            drawer.append(label(_('Everything is in the menu'), 'lab-col-desc'));

        // barra superior
        clear(pzone);
        ptray.remove_all();
        const p = panel();
        for (const id of p)
            pzone.append(panelPiece(id, true));
        for (const id of ALL_PANEL.filter(x => !p.includes(x)))
            ptray.append(panelPiece(id, false));
        if (!p.length)
            pzone.append(label(_('icon'), 'lab-dim'));

        // altura: a do menu de verdade (linhas vazias somem)
        let h = 72 + 12;
        for (let r = 0; r < geo.used; r++) {
            const usedRow = list.some(i => r >= i.r && r < i.r + sizeOf(i.id, i.size).h);
            if (usedRow)
                h += geo.heights[r] + geo.gap;
        }
        const limit = smallest() - 40;
        meterBar.set_value(Math.min(1, h / limit));
        meterLabel.set_label(h <= limit
            ? _('%d px: fits your smallest screen (%d px) without scrolling').replace('%d', h).replace('%d', limit + 40)
            : _('%d px: %d px more than your smallest screen; the menu will scroll').replace('%d', h).replace('%d', h - limit));
        meterLabel.set_css_classes([h <= limit ? 'lab-meter-ok' : 'lab-meter-no']);
        gapValue.set_label(`${gap()} px`);
        if (Math.round(gapScale.get_value()) !== gap())
            gapScale.set_value(gap());

        if (refocus) {
            widgets[refocus]?.grab_focus();
            refocus = null;
        }
    };

    const ids = ['grid-items', 'grid-gap', 'panel-items', 'hidden-titles'].map(k => settings.connect(`changed::${k}`, render));
    page.connect('destroy', () => ids.forEach(i => settings.disconnect(i)));
    render();
}
