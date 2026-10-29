// Modos nomeados do Nitro: leitura/gravação de ~/.config/nitro/modes.json e a seção do menu que os lista e edita.
// A aplicação em si é do comando nitro-mode (system/nitro-mode); aqui só configuramos e disparamos.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

const CONFIG_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'nitro', 'modes.json']);
const ACTIVE_FILE = GLib.build_filenamev([GLib.get_user_state_dir(), 'nitro', 'mode-active.json']);
const BOOT_ID_FILE = '/proc/sys/kernel/random/boot_id';

// Mantenha igual a FIELDS/BUILTIN em system/nitro-mode.
export const MODE_FIELDS = {
    profile: 'balanced-performance',
    fan: 'max',
    gpu_offset: 'boost',
    gpu_custom: {gpc: 100, mem: 500},
    power_limit: null,
    cpu_performance: true,
    only_on_ac: true,
    auto_gamemode: false,
};

const FAN_CHOICES = [[null, '—'], ['auto', 'Automático'], ['max', 'Máximo']];
const OFFSET_CHOICES = [[null, '—'], ['off', 'Padrão'], ['boost', 'Boost'], ['max', 'Máximo'], ['custom', 'Livre']];
const POWER = {min: 30, max: 65, step: 5};   // o helper confere com a faixa real do driver
const GPC = {min: 0, max: 300, step: 25};    // MHz
const MEM = {min: 0, max: 1500, step: 100};  // MHz
const ID_RE = /^[a-z0-9-]{1,32}$/;

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch {
        return null;
    }
}

const clone = v => JSON.parse(JSON.stringify(v));

function builtinModes() {
    return [
        {id: 'gamer', name: 'Gamer', icon: 'input-gaming-symbolic', ...clone(MODE_FIELDS), auto_gamemode: true},
        {id: 'silencio', name: 'Silêncio', icon: 'weather-clear-night-symbolic', ...clone(MODE_FIELDS),
            profile: 'quiet', fan: 'auto', gpu_offset: 'off', cpu_performance: false, only_on_ac: false},
    ];
}

export function loadModes() {
    try {
        const text = readText(CONFIG_FILE);
        const list = text ? JSON.parse(text)?.modes : null;
        if (Array.isArray(list)) {
            const out = list.filter(m => m && typeof m === 'object' && ID_RE.test(String(m.id)))
                .map(m => ({...clone(MODE_FIELDS), name: m.id, icon: 'input-gaming-symbolic', ...m}));
            if (out.length)
                return out;
        }
    } catch {}
    return builtinModes();
}

export function saveModes(modes) {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(CONFIG_FILE), 0o755);
        GLib.file_set_contents(CONFIG_FILE, JSON.stringify({modes}, null, 2));
        return true;
    } catch {
        return false;
    }
}

// Modo ligado agora; um estado de antes do último boot não vale (o hardware voltou ao padrão)
export function activeModeId() {
    try {
        const st = JSON.parse(readText(ACTIVE_FILE) ?? 'null');
        return st?.mode && st.boot === readText(BOOT_ID_FILE) ? st.mode : null;
    } catch {
        return null;
    }
}

function summary(m, profiles) {
    const parts = [];
    const prof = profiles.find(p => p.id === m.profile);
    if (prof)
        parts.push(prof.label);
    if (m.fan)
        parts.push(m.fan === 'max' ? 'ventoinhas no máx.' : 'ventoinhas auto');
    if (m.gpu_offset === 'custom')
        parts.push(`GPU +${m.gpu_custom.gpc}/+${m.gpu_custom.mem}`);
    else if (m.gpu_offset && m.gpu_offset !== 'off')
        parts.push(`GPU ${OFFSET_CHOICES.find(c => c[0] === m.gpu_offset)?.[1] ?? m.gpu_offset}`);
    if (m.power_limit)
        parts.push(`${m.power_limit} W`);
    if (m.cpu_performance)
        parts.push('CPU performance');
    return parts.join(' · ') || 'Sem ajustes';
}

export class ModesSection {
    // profiles: [{id, label}] vindos da extensão; onToggle(id) liga/desliga o modo; onError(texto)
    constructor({profiles, onToggle, onError}) {
        this._profiles = profiles;
        this._onToggle = onToggle;
        this._onError = onError;
        this._modes = loadModes();
        this._open = null;
        this._active = null;
        this._busy = null;
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._render();
    }

    setActive(id) {
        if (id === this._active)
            return;
        this._active = id;
        this._render();
    }

    setBusy(id) {
        this._busy = id;
        this._render();
    }

    // modo marcado para ligar sozinho quando o GameMode registrar um jogo
    autoGameModeId() {
        return loadModes().find(m => m.auto_gamemode)?.id ?? null;
    }

    _save() {
        if (!saveModes(this._modes))
            this._onError('Não deu pra salvar os modos em ~/.config/nitro/modes.json.');
    }

    _render() {
        this.actor.destroy_all_children();
        this.actor.add_child(new St.Label({text: 'Modos', style_class: 'nitro-section-title'}));
        for (const m of this._modes)
            this.actor.add_child(this._block(m));
        const add = new St.Button({label: '+ Novo modo', style_class: 'nitro-addmode', x_expand: true, can_focus: true});
        add.connect('clicked', () => this._add());
        this.actor.add_child(add);
    }

    _block(m) {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        // a linha inteira é o "cartão" (fundo, borda, :checked); o botão principal e a engrenagem ficam dentro dele
        const row = new St.BoxLayout({style_class: 'nitro-moderow', x_expand: true, reactive: true, track_hover: true});
        const active = this._active === m.id;
        if (active)
            row.add_style_pseudo_class('checked');

        const radio = new St.Widget({style_class: 'nitro-radio', layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        if (active)
            radio.add_child(new St.Widget({style_class: 'nitro-radio-dot', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true}));

        const info = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        info.add_child(new St.Label({text: m.name, style_class: 'nitro-modename'}));
        info.add_child(new St.Label({text: this._busy === m.id ? 'Aplicando…' : summary(m, this._profiles), style_class: 'nitro-modesum'}));
        const inner = new St.BoxLayout({style_class: 'nitro-modemain-inner', x_expand: true});
        inner.add_child(radio);
        inner.add_child(info);
        const main = new St.Button({style_class: 'nitro-modemain', child: inner, x_expand: true, can_focus: true, reactive: this._busy === null});
        main.connect('clicked', () => this._onToggle(m.id));
        row.add_child(main);

        const gear = new St.Button({style_class: 'nitro-gear', can_focus: true, y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16})});
        if (this._open === m.id)
            gear.add_style_pseudo_class('checked');
        gear.connect('clicked', () => {
            this._open = this._open === m.id ? null : m.id;
            this._render();
        });
        row.add_child(gear);
        box.add_child(row);

        if (this._open === m.id)
            box.add_child(this._editor(m));
        return box;
    }

    _editor(m) {
        const ed = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-editor', x_expand: true});

        const entry = new St.Entry({text: m.name, style_class: 'nitro-entry', x_expand: true, can_focus: true});
        entry.clutter_text.connect('text-changed', () => {
            const t = entry.get_text().trim();
            if (t) {
                m.name = t.slice(0, 24);
                this._save();
            }
        });
        ed.add_child(this._field('Nome', entry));

        ed.add_child(this._field('Perfil', this._chips(
            [[null, '—'], ...this._profiles.map(p => [p.id, p.label])], m.profile, v => (m.profile = v))));
        ed.add_child(this._field('Ventoinhas', this._chips(FAN_CHOICES, m.fan, v => (m.fan = v))));

        const custom = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, visible: m.gpu_offset === 'custom'});
        custom.add_child(this._field('Núcleo (MHz)', this._stepper(m.gpu_custom.gpc, GPC, false, v => (m.gpu_custom.gpc = v), v => `+${v}`)));
        custom.add_child(this._field('Memória (MHz)', this._stepper(m.gpu_custom.mem, MEM, false, v => (m.gpu_custom.mem = v), v => `+${v}`)));
        ed.add_child(this._field('Overclock GPU', this._chips(OFFSET_CHOICES, m.gpu_offset, v => {
            m.gpu_offset = v;
            custom.visible = v === 'custom';
        })));
        ed.add_child(custom);

        ed.add_child(this._field('Limite GPU (se o driver deixar)', this._stepper(m.power_limit, POWER, true, v => (m.power_limit = v), v => `${v} W`)));
        ed.add_child(this._field('CPU em performance', this._chips([[false, 'Não'], [true, 'Sim']], m.cpu_performance, v => (m.cpu_performance = v))));
        ed.add_child(this._field('Só na tomada', this._chips([[false, 'Não'], [true, 'Sim']], m.only_on_ac, v => (m.only_on_ac = v))));
        ed.add_child(this._field('Ligar ao abrir jogo', this._chips([[false, 'Não'], [true, 'Sim']], m.auto_gamemode, v => {
            m.auto_gamemode = v;
            if (v)
                for (const o of this._modes)
                    if (o !== m)
                        o.auto_gamemode = false;
        })));

        const foot = new St.BoxLayout({style_class: 'nitro-editor-foot', x_expand: true});
        const done = new St.Button({label: 'Pronto', style_class: 'nitro-addmode', x_expand: true, can_focus: true});
        done.connect('clicked', () => {
            this._open = null;
            this._render();
        });
        foot.add_child(done);
        if (this._modes.length > 1) {
            const del = new St.Button({label: 'Excluir', style_class: 'nitro-delmode', can_focus: true});
            del.connect('clicked', () => this._delete(m));
            foot.add_child(del);
        }
        ed.add_child(foot);
        return ed;
    }

    _field(label, widget) {
        const row = new St.BoxLayout({style_class: 'nitro-field', x_expand: true});
        row.add_child(new St.Label({text: label, style_class: 'nitro-field-name', y_align: Clutter.ActorAlign.CENTER, x_expand: true}));
        row.add_child(widget);
        return row;
    }

    // Botões de escolha única; atualiza os próprios estados sem reconstruir o menu
    _chips(options, current, onPick) {
        const box = new St.BoxLayout({style_class: 'nitro-chipbtns'});
        const buttons = [];
        const mark = value => buttons.forEach(([v, b]) => {
            if (v === value)
                b.add_style_pseudo_class('checked');
            else
                b.remove_style_pseudo_class('checked');
        });
        for (const [value, label] of options) {
            const b = new St.Button({label, style_class: 'nitro-chipbtn', can_focus: true});
            b.connect('clicked', () => {
                onPick(value);
                mark(value);
                this._save();
            });
            buttons.push([value, b]);
            box.add_child(b);
        }
        mark(current);
        return box;
    }

    // − valor +. Com nullable, descer do mínimo desliga ("—") e subir de "—" volta ao mínimo
    _stepper(initial, range, nullable, onChange, fmt) {
        let value = initial;
        const box = new St.BoxLayout({style_class: 'nitro-stepper'});
        const label = new St.Label({style_class: 'nitro-stepval', y_align: Clutter.ActorAlign.CENTER});
        const show = () => (label.text = value === null ? '—' : fmt(value));
        const step = dir => {
            if (value === null)
                value = dir > 0 ? range.min : null;
            else if (value + dir * range.step < range.min)
                value = nullable ? null : range.min;
            else
                value = Math.min(range.max, value + dir * range.step);
            onChange(value);
            show();
            this._save();
        };
        const mk = (text, dir) => {
            const b = new St.Button({label: text, style_class: 'nitro-stepbtn', can_focus: true});
            b.connect('clicked', () => step(dir));
            return b;
        };
        box.add_child(mk('−', -1));
        box.add_child(label);
        box.add_child(mk('+', 1));
        show();
        return box;
    }

    _add() {
        let n = 1;
        while (this._modes.some(m => m.id === `modo-${n}`))
            n++;
        const base = this._modes.find(m => m.id === 'gamer') ?? this._modes[0];
        this._modes.push({...clone(base), id: `modo-${n}`, name: `Novo modo ${n}`, auto_gamemode: false});
        this._open = `modo-${n}`;
        this._save();
        this._render();
    }

    _delete(m) {
        this._modes = this._modes.filter(o => o !== m);
        this._open = null;
        this._save();
        this._render();
    }
}
