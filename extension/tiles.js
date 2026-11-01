// Ladrilhos da grade do menu (1x1, 2x1, 2x2, 4x2). Cada um é montado uma vez para um tamanho e recebe, a cada
// atualização do menu, um retrato dos dados (data) que a extensão já leu. Ações voltam pela ctx.
//   ctx: {applyProfile(id), setFan(id), setLimit(on), setSetting(key, on), setGamemode(on), cycleAuto(key),
//         toggleMode(id), openTester(), openPrefs(), gpuApps(compact) → {actor, refresh(active)}}
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const ELLIPSIZE_END = 3;

const box = (cls, vertical = true, extra = {}) => new St.BoxLayout({
    style_class: cls, orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL, ...extra,
});
const text = (cls, t = '', extra = {}) => {
    const l = new St.Label({text: t, style_class: cls, ...extra});
    l.clutter_text.ellipsize = ELLIPSIZE_END;
    return l;
};
const spacer = () => new St.Widget({y_expand: true, x_expand: true});
// nome que pode ocupar duas linhas (ladrilhos 1x1 são estreitos)
const wrapText = (cls, t = '', extra = {}) => {
    const l = new St.Label({text: t, style_class: cls, ...extra});
    l.clutter_text.line_wrap = true;
    l.clutter_text.ellipsize = 0;
    return l;
};

// Barra fina (fração 0..1); cls dá a cor
function bar() {
    const track = new St.Widget({style_class: 'nitro-t-bar', layout_manager: new Clutter.BinLayout(), x_expand: true});
    const fill = new St.Widget({style_class: 'nitro-t-fill', x_align: Clutter.ActorAlign.START, y_expand: true});
    track.add_child(fill);
    return {actor: track, set: (frac, cls) => {
        fill.width = Math.round(Math.max(0, Math.min(1, frac)) * (track.width || 80));
        fill.style_class = `nitro-t-fill ${cls}`;
    }};
}

// Gráfico de linha das últimas leituras: series = [[valores…], …], cores pelos estilos -nitro-a/-nitro-b
function chart(cls) {
    const area = new St.DrawingArea({style_class: `nitro-t-chart ${cls}`, x_expand: true, y_expand: true});
    let series = [];
    area.connect('repaint', a => {
        const cr = a.get_context();
        const [w, h] = a.get_surface_size();
        const node = a.get_theme_node();
        const all = series.flat().filter(v => v !== null);
        if (all.length > 1) {
            const lo = Math.min(...all) - 3, hi = Math.max(...all) + 3;
            series.forEach((s, k) => {
                const c = node.get_color(k ? '-nitro-b' : '-nitro-a');
                const n = s.length;
                const pts = s.map((v, i) => (v === null ? null : [i / Math.max(1, n - 1) * w, h - 2 - (v - lo) / (hi - lo) * (h - 4)]));
                // área clara embaixo da primeira série
                if (k === 0) {
                    const real = pts.filter(Boolean);
                    if (real.length > 1) {
                        cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255, 0.14);
                        cr.moveTo(real[0][0], h);
                        real.forEach(([x, y]) => cr.lineTo(x, y));
                        cr.lineTo(real.at(-1)[0], h);
                        cr.closePath();
                        cr.fill();
                    }
                }
                cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255, 1);
                cr.setLineWidth(2);
                let drawing = false;
                for (const p of pts) {
                    if (!p) {
                        drawing = false;
                        continue;
                    }
                    if (drawing)
                        cr.lineTo(...p);
                    else
                        cr.moveTo(...p);
                    drawing = true;
                }
                cr.stroke();
            });
        }
        cr.$dispose();
    });
    return {actor: area, set: s => {
        series = s;
        area.queue_repaint();
    }};
}

// Raiz de um ladrilho: botão (quando faz algo ao tocar) ou caixa
function root(clickable, onClick, name) {
    const inner = box('nitro-t-in', true, {x_expand: true, y_expand: true});
    if (!clickable)
        return {actor: box('nitro-t', true, {x_expand: true, y_expand: true, clip_to_allocation: true}), inner: null};
    const b = new St.Button({style_class: 'nitro-t nitro-t-button', child: inner, can_focus: true, x_expand: true, y_expand: true,
        accessible_name: name, clip_to_allocation: true});
    b.connect('clicked', onClick);
    return {actor: b, inner};
}

// Ladrilho de interruptor (limite de carga, 60 Hz, GameMode, tecla): ícone, nome e estado; tocar alterna
function toggleTile(icon, name, wide, onToggle) {
    let on = false;
    const r = root(true, () => onToggle(!on), name);
    const c = r.inner;
    if (!wide)
        c.add_style_class_name('nitro-t-small');
    const ic = new St.Icon({icon_name: icon, icon_size: 16, style_class: 'nitro-t-toggle-icon'});
    const top = box('', false);
    top.add_child(new St.Bin({child: ic, style_class: 'nitro-t-toggle-ic'}));
    c.add_child(top);
    c.add_child(spacer());
    c.add_child(wrapText(wide ? 'nitro-t-name' : 'nitro-t-name nitro-t-name-small', name));
    const state = text('nitro-t-state');
    c.add_child(state);
    return {actor: r.actor, update: (isOn, extra = '', enabled = true) => {
        on = !!isOn;
        r.actor.reactive = enabled;
        if (on)
            r.actor.add_style_pseudo_class('checked');
        else
            r.actor.remove_style_pseudo_class('checked');
        state.text = `${on ? _('On') : _('Off')}${wide && extra ? ` · ${extra}` : ''}`;
    }};
}

const level = (v, warn, hot) => (v === null ? 'nitro-idle' : v >= hot ? 'nitro-hot' : v >= warn ? 'nitro-warn' : 'nitro-ok');

export function buildTile(id, size, ctx) {
    const wide = size !== '1x1';
    switch (id) {
    case 'cpu':
    case 'gputemp': {
        const isCpu = id === 'cpu';
        const r = root(false);
        const c = r.actor;
        const head = box('nitro-t-head', false);
        const name = text('nitro-t-label', isCpu ? 'CPU' : 'GPU', {x_expand: true});
        head.add_child(name);
        const badge = text('nitro-flag', '', {visible: false});
        head.add_child(badge);
        const big = text('nitro-t-big');
        const sub = text('nitro-t-sub', '', {visible: false});
        // 1x1: barra; maiores: gráfico (só cria o que vai para a tela)
        const b = size === '1x1' ? bar() : null;
        const ch = size === '1x1' ? null : chart(isCpu ? 'nitro-t-chart-cpu' : 'nitro-t-chart-gpu');
        if (size === '2x1') {
            c.orientation = Clutter.Orientation.HORIZONTAL;
            c.add_style_class_name('nitro-t-row');
            const left = box('nitro-t-col');
            left.add_child(head);
            left.add_child(spacer());
            left.add_child(big);
            left.add_child(sub);
            c.add_child(left);
            c.add_child(ch.actor);
        } else {
            c.add_child(head);
            if (size === '1x1')
                c.add_child(spacer());
            c.add_child(big);
            c.add_child(sub);
            c.add_child((ch ?? b).actor);
        }
        return {actor: c, update: d => {
            if (isCpu) {
                big.text = d.cpu === null ? '—' : `${d.cpu}°`;
                badge.visible = d.cpuLimiting;
                badge.text = size === '1x1' ? _('LIM') : _('THROTTLING');
                sub.visible = size === '2x2';
                sub.text = _('%d throttles since boot').replace('%d', d.throttleTotal ?? 0);
                b?.set((d.cpu ?? 0) / 100, level(d.cpu, 75, 90));
                ch?.set([d.history.map(s => s[0])]);
            } else {
                const g = d.gpu;
                big.text = g ? `${Math.round(g.temp)}°` : 'zzz';
                name.text = size === '2x2' && d.gpuName ? d.gpuName : 'GPU';
                badge.visible = !!g?.limit;
                badge.text = g?.limit === 'thermal' ? (size === '1x1' ? _('LIM') : _('THROTTLING')) : _('POWER LIMIT');
                badge.style_class = `nitro-flag ${g?.limit === 'power' ? 'nitro-flag-power' : ''}`;
                sub.visible = size !== '1x1';
                sub.text = g ? `${Math.round(g.power)} W · ${_('Load %s').replace('%s', `${Math.round(g.util)}%`)}` : _('Sleeping');
                b?.set(g ? g.temp / 100 : 0, g ? level(g.temp, 75, 87) : 'nitro-idle');
                ch?.set([d.history.map(s => s[1])]);
            }
        }};
    }
    case 'fan1':
    case 'fan2': {
        const r = root(false);
        const c = r.actor;
        c.add_child(text('nitro-t-label', size === '1x1' ? (id === 'fan1' ? _('Fan 1') : _('Fan 2'))
            : (id === 'fan1' ? _('Fan 1 · CPU') : _('Fan 2 · GPU'))));
        c.add_child(spacer());
        const big = text(size === '1x1' ? 'nitro-t-mid' : 'nitro-t-big');
        c.add_child(big);
        c.add_child(text('nitro-t-sub', 'rpm'));
        const b = bar();
        c.add_child(b.actor);
        return {actor: c, update: d => {
            const rpm = d[id];
            big.text = rpm === null ? '—' : `${rpm}`;
            b.set((rpm ?? 0) / 6000, rpm ? 'nitro-fan' : 'nitro-idle');
        }};
    }
    case 'batteryinfo': {
        const r = root(false);
        const c = r.actor;
        const head = text('nitro-t-label');
        c.add_child(head);
        c.add_child(spacer());
        const line = box('nitro-t-line', false);
        const big = text('nitro-t-big');
        line.add_child(big);
        const watts = text('nitro-t-mid', '', {visible: wide});
        line.add_child(watts);
        c.add_child(line);
        const sub = text('nitro-t-sub');
        c.add_child(sub);
        return {actor: c, update: d => {
            head.text = d.onBattery ? _('On battery') : _('Battery');
            big.text = d.batteryPct === null ? '—' : `${d.batteryPct}%`;
            watts.text = d.onBattery && d.rate > 0 ? `${d.rate.toLocaleString(undefined, {maximumFractionDigits: 1})} W` : '';
            sub.text = wide ? [d.timeText, d.health].filter(Boolean).join(' · ') : d.healthShort ?? '';
        }};
    }
    case 'profile': {
        if (size === '1x1') {
            const r = root(true, () => ctx.cycleProfile(), _('Profile'));
            const c = r.inner;
            c.add_child(text('nitro-t-label', _('Profile')));
            c.add_child(spacer());
            const icon = new St.Icon({icon_size: 22, style_class: 'nitro-t-icon'});
            c.add_child(icon);
            const name = wrapText('nitro-t-value');
            c.add_child(name);
            return {actor: r.actor, update: d => {
                const p = d.profiles.find(x => x.id === d.profile);
                icon.icon_name = p?.icon ?? 'power-profile-balanced-symbolic';
                name.text = p?.label ?? '—';
                name.style_class = `nitro-t-value nitro-t-${p?.cls ?? 'turbo'}`;
                r.actor.accessible_name = `${_('Profile')}: ${name.text}. ${_('tap to change')}`;
            }};
        }
        return segTile(_('Profile'), ctx, 2, (d) => d.profiles, d => d.profile, idd => ctx.applyProfile(idd));
    }
    case 'fans': {
        if (size === '1x1') {
            const r = root(true, () => ctx.cycleFan(), _('Fans'));
            const c = r.inner;
            c.add_child(text('nitro-t-label', _('Fans')));
            c.add_child(spacer());
            const icon = new St.Icon({icon_size: 22, style_class: 'nitro-t-icon'});
            c.add_child(icon);
            const name = wrapText('nitro-t-value');
            c.add_child(name);
            const short = {auto: _('Auto (short)'), max: _('Max (short)'), curve: _('Curve (short)')};
            return {actor: r.actor, update: d => {
                const f = d.fans.find(x => x.id === d.fan);
                icon.icon_name = f?.icon ?? 'weather-windy-symbolic';
                name.text = short[f?.id] ?? f?.label ?? '—';
                name.style_class = `nitro-t-value nitro-t-${f?.cls ?? 'balanced'}`;
            }};
        }
        const short = {auto: _('Auto (short)'), max: _('Max (short)'), curve: _('Curve (short)')};
        return segTile(_('Fans'), ctx, 0, d => d.fans.map(f => ({...f, label: short[f.id] ?? f.label})), d => d.fan, idd => ctx.setFan(idd), true);
    }
    case 'battery': {
        const t = toggleTile('battery-level-80-symbolic', size === '1x1' ? _('Limit 80%') : _('Limit charge to 80%'), wide, on => ctx.setLimit(on));
        return {actor: t.actor, update: d => t.update(d.limitOn, d.healthShort, d.limitOn !== null)};
    }
    case 'hz60': {
        const t = toggleTile('video-display-symbolic', _('60 Hz on battery'), wide, on => ctx.setSetting('battery-60hz', on));
        return {actor: t.actor, update: d => t.update(d.hz60, d.lowHz ? _('now at 60 Hz') : '')};
    }
    case 'gamemode': {
        const t = toggleTile('input-gaming-symbolic', 'GameMode', wide, on => ctx.setGamemode(on));
        return {actor: t.actor, update: d => t.update(d.gamemode === 'ours', d.autoMode ? _('turns on %s').replace('%s', d.autoMode) : '', d.gamemode !== 'other')};
    }
    case 'turbokey': {
        const t = toggleTile('input-keyboard-symbolic', _('NitroSense key'), wide, on => ctx.setSetting('turbo-key', on));
        return {actor: t.actor, update: d => t.update(d.turbo)};
    }
    case 'autoprofile': {
        const r = root(false);
        const c = r.actor;
        c.add_child(text('nitro-t-label', _('Automatic profile')));
        c.add_child(spacer());
        const chips = {};
        for (const [key, label] of [['ac-profile', _('Plugged in')], ['battery-profile', _('On battery')]]) {
            const line = box('nitro-t-line', false);
            line.add_child(text('nitro-t-sub', label, {x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            const btn = new St.Button({style_class: 'nitro-chipbtn', can_focus: true, accessible_name: label});
            btn.connect('clicked', () => ctx.cycleAuto(key));
            line.add_child(btn);
            c.add_child(line);
            chips[key] = btn;
        }
        return {actor: c, update: d => {
            for (const [key, btn] of Object.entries(chips))
                btn.label = d.autoLabels[key];
        }};
    }
    case 'history': {
        const r = root(false);
        const c = r.actor;
        const head = box('nitro-t-head', false);
        head.add_child(text('nitro-legend-cpu', '● CPU'));
        head.add_child(text('nitro-legend-gpu', ' ● GPU', {x_expand: true}));
        const range = text('nitro-t-sub');
        head.add_child(range);
        c.add_child(head);
        const ch = chart('nitro-t-chart-hist');
        c.add_child(ch.actor);
        return {actor: c, update: d => {
            ch.set([d.history.map(s => s[0]), d.history.map(s => s[1])]);
            range.text = size === '4x2' ? d.historyRange : '3 min';
        }};
    }
    case 'curve': {
        const r = root(false);
        const c = r.actor;
        const head = box('nitro-t-head', false);
        head.add_child(text('nitro-t-label', _('Fan curve'), {x_expand: true}));
        const edit = new St.Button({label: _('Edit'), style_class: 'nitro-chipbtn', can_focus: true});
        edit.connect('clicked', () => ctx.openPrefs());
        head.add_child(edit);
        c.add_child(head);
        const ch = chart('nitro-t-chart-curve');
        c.add_child(ch.actor);
        const sub = text('nitro-t-sub');
        c.add_child(sub);
        return {actor: c, update: d => {
            // a curva como série: % a cada 2 °C, de 30 a 100
            const pts = [...d.curve].sort((a, b) => a[0] - b[0]);
            const at = t => {
                if (t >= 92)
                    return 100;
                if (t <= pts[0][0])
                    return pts[0][1];
                for (let i = 1; i < pts.length; i++) {
                    if (t <= pts[i][0])
                        return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
                }
                return pts.at(-1)[1];
            };
            const s = [];
            for (let t = 30; t <= 100; t += 2)
                s.push(at(t));
            ch.set([s]);
            sub.text = `${pts[0][0]}° ${pts[0][1]}% → ${pts.at(-1)[0]}° ${pts.at(-1)[1]}%`;
        }};
    }
    case 'modes': {
        const r = root(false);
        const c = r.actor;
        const head = box('nitro-t-head', false);
        head.add_child(text('nitro-t-label', _('Modes'), {x_expand: true}));
        const gear = new St.Button({style_class: 'nitro-t-mini', can_focus: true, accessible_name: _('Edit modes…'),
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 12})});
        gear.connect('clicked', () => ctx.openPrefs());
        head.add_child(gear);
        c.add_child(head);
        c.add_child(spacer());
        const list = box('nitro-t-chips', false);
        c.add_child(list);
        let sig = null;
        return {actor: c, update: d => {
            const s = JSON.stringify([d.modes.map(m => [m.id, m.name]), d.activeMode]);
            if (s === sig)
                return;
            sig = s;
            list.destroy_all_children();
            for (const m of d.modes.slice(0, 3)) {
                const on = m.id === d.activeMode;
                const b = new St.Button({label: `${on ? '●' : '○'} ${m.name}`, style_class: `nitro-t-modechip ${on ? 'nitro-t-on' : ''}`,
                    can_focus: true, accessible_name: m.name});
                b.connect('clicked', () => ctx.toggleMode(m.id));
                list.add_child(b);
            }
        }};
    }
    case 'peripherals': {
        const r = root(true, () => ctx.openTester(), _('Test peripherals…'));
        const c = r.inner;
        c.add_child(text('nitro-t-label', _('Peripherals')));
        c.add_child(spacer());
        const icons = box('nitro-t-chips', false);
        c.add_child(icons);
        let sig = null;
        return {actor: r.actor, update: d => {
            const s = d.devices.map(x => x.icon).join();
            if (s === sig)
                return;
            sig = s;
            icons.destroy_all_children();
            for (const dev of d.devices.slice(0, 6))
                icons.add_child(new St.Icon({icon_name: dev.icon, icon_size: 14, style_class: 'nitro-periph-chip'}));
        }};
    }
    case 'gpuapps': {
        const r = root(false);
        const c = r.actor;
        c.add_child(text('nitro-t-label', size === '4x2' ? _('Apps using the GPU') : _('On the GPU')));
        const apps = ctx.gpuApps(size === '2x2', 3);
        apps.actor.y_expand = true;
        c.add_child(apps.actor);
        const idle = text('nitro-t-sub', _('GPU asleep: no app is using it'));
        c.add_child(idle);
        return {actor: c, update: d => {
            idle.visible = !d.gpuActive;
            apps.refresh(d.gpuActive);
        }};
    }
    case 'status': {
        const r = root(false);
        const c = r.actor;
        c.add_child(text('nitro-t-label', _('System')));
        c.add_child(spacer());
        const chips = box('nitro-t-chips', false);
        c.add_child(chips);
        return {actor: c, update: d => {
            chips.destroy_all_children();
            for (const {label, ok} of d.status)
                chips.add_child(text(`nitro-status-chip ${ok ? '' : 'nitro-status-warn'}`, `${ok ? '✓' : '!'} ${label}`));
        }};
    }
    case 'tester':
    case 'prefs': {
        const isTester = id === 'tester';
        const r = root(true, () => (isTester ? ctx.openTester() : ctx.openPrefs()), isTester ? _('Test peripherals…') : _('Preferences…'));
        const c = r.inner;
        c.add_style_class_name('nitro-t-center');
        c.add_child(spacer());
        c.add_child(new St.Icon({icon_name: isTester ? 'input-gaming-symbolic' : 'preferences-system-symbolic', icon_size: 22,
            style_class: 'nitro-t-icon', x_align: Clutter.ActorAlign.CENTER}));
        c.add_child(wrapText('nitro-t-name nitro-t-name-small', isTester ? _('Test peripherals') : _('Preferences'), {x_align: Clutter.ActorAlign.CENTER}));
        c.add_child(spacer());
        return {actor: r.actor, update: () => {}};
    }
    }
    return null;
}

// Ladrilho de botões (perfil 2x2, ventoinhas 2x1): um botão por opção, o ativo destacado
function segTile(title, ctx, cols, options, current, onPick, stacked = false) {
    const c = box('nitro-t', true, {x_expand: true, y_expand: true});
    c.add_child(text('nitro-t-label', title));
    const grid = new St.Widget({layout_manager: new Clutter.GridLayout({column_homogeneous: true, row_homogeneous: true,
        column_spacing: 4, row_spacing: 4}), style_class: 'nitro-t-seg', x_expand: true, y_expand: true});
    c.add_child(grid);
    let buttons = null;
    return {actor: c, update: d => {
        const opts = options(d);
        if (!buttons) {
            buttons = new Map();
            opts.forEach((o, i) => {
                const inner = box('nitro-t-segin', !!cols || stacked);
                inner.add_child(new St.Icon({icon_name: o.icon, icon_size: 14, x_align: Clutter.ActorAlign.CENTER}));
                inner.add_child(text('nitro-t-seglabel', o.label, {x_align: Clutter.ActorAlign.CENTER}));
                const b = new St.Button({child: inner, style_class: 'nitro-t-segbtn', can_focus: true, x_expand: true, y_expand: true,
                    accessible_name: o.label});
                b.connect('clicked', () => onPick(o.id));
                const per = cols || opts.length;
                grid.layout_manager.attach(b, i % per, Math.floor(i / per), 1, 1);
                buttons.set(o.id, b);
            });
        }
        const cur = current(d);
        for (const [idd, b] of buttons) {
            if (idd === cur)
                b.add_style_pseudo_class('checked');
            else
                b.remove_style_pseudo_class('checked');
        }
    }};
}
