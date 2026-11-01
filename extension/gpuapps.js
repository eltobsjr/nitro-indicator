// Apps que estão usando a GPU NVIDIA, no cartão da GPU: uma pílula "N apps" no título e, ao clicar, uma linha
// por processo com Fechar (SIGTERM) e Forçar (SIGKILL) sempre à mão. A lista vem do nitro-gpuapps (system/),
// que lê /proc sem acordar a placa; processos da sessão (gnome-shell…) aparecem como "sistema", sem botões.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {execAsync} from './utils.js';

const ELLIPSIZE_END = 3;
const RECHECK_MS = 700;        // relê a lista logo depois de mandar o sinal
const NO_ANSWER_MS = 3000;     // depois disso, "Fechar" que não funcionou vira aviso na linha

export class GpuApps {
    // bin: nitro-gpuapps; onError(texto); alwaysOpen: lista sempre à mostra (ladrilho da grade), sem pílula;
    // compact: só o nome e o Forçar (ladrilho 2x2)
    // maxRows: no ladrilho cabem poucas linhas; o resto vira "+N"
    constructor({bin, onError, alwaysOpen = false, compact = false, maxRows = Infinity}) {
        this._bin = bin;
        this._onError = onError;
        this._procs = [];
        this._open = alwaysOpen;
        this._always = alwaysOpen;
        this._compact = compact;
        this._maxRows = maxRows;
        this._busy = false;
        this._sig = null;
        this._closing = new Map();  // pid → hora em que pedimos para fechar
        this._timers = new Set();

        this._pillLabel = new St.Label({style_class: 'nitro-gpuapps-pill-label', y_align: Clutter.ActorAlign.CENTER});
        this.pill = new St.Button({child: this._pillLabel, style_class: 'nitro-gpuapps-pill', can_focus: true,
            y_align: Clutter.ActorAlign.CENTER, visible: false});
        this.pill.connect('clicked', () => {
            this._open = !this._open;
            this._sig = null;
            this._render();
        });
        this.list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-gpuapps', x_expand: true, visible: false});
        this.list.connect('destroy', () => this.destroy());
    }

    // GPU ativa: relê (sem empilhar chamadas); dormindo: some tudo
    refresh(active) {
        if (!active) {
            this._procs = [];
            this._render();
            return;
        }
        if (this._busy)
            return;
        this._busy = true;
        execAsync([this._bin, 'list'], (ok, out) => {
            this._busy = false;
            if (!this.list)
                return;
            try {
                this._procs = ok ? JSON.parse(out).procs : [];
            } catch {
                this._procs = [];
            }
            this._render();
        });
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
    }

    _render() {
        const procs = this._procs;
        for (const pid of [...this._closing.keys()])
            if (!procs.some(p => p.pid === pid))
                this._closing.delete(pid);
        const now = Date.now();
        const sig = JSON.stringify([procs, this._open, [...this._closing].map(([pid, t]) => [pid, now - t > NO_ANSWER_MS])]);
        if (sig === this._sig)
            return;
        this._sig = sig;

        this.pill.visible = procs.length > 0 && !this._always;
        this._pillLabel.text = `${procs.length === 1 ? _('1 app') : _('%d apps').replace('%d', procs.length)} ${this._open ? '⌄' : '›'}`;
        if (this._open)
            this.pill.add_style_pseudo_class('checked');
        else
            this.pill.remove_style_pseudo_class('checked');

        this.list.destroy_all_children();
        this.list.visible = this._open && procs.length > 0;
        if (!this.list.visible)
            return;
        // os seus primeiro (os que dá para encerrar), depois os do sistema
        const sorted = [...procs].sort((a, b) => a.system - b.system);
        for (const p of sorted.slice(0, this._maxRows))
            this.list.add_child(this._row(p, now));
        if (sorted.length > this._maxRows)
            this.list.add_child(new St.Label({text: _('+%d more').replace('%d', sorted.length - this._maxRows), style_class: 'nitro-gpuapps-sub'}));
        const mine = procs.filter(p => !p.system);
        if (mine.length > 1 && !this._always) {
            const all = new St.Button({label: _('Close all mine (%d)').replace('%d', mine.length), style_class: 'nitro-gpuapps-all',
                x_align: Clutter.ActorAlign.START, can_focus: true});
            all.connect('clicked', () => mine.forEach(p => this._kill(p, 'term')));
            this.list.add_child(all);
        }
    }

    _row(p, now) {
        const app = Shell.WindowTracker.get_default().get_app_from_pid(p.pid);
        const row = new St.BoxLayout({style_class: 'nitro-gpuapps-row', x_expand: true});
        const icon = app?.create_icon_texture(16) ?? new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 16});
        icon.add_style_class_name('nitro-gpuapps-icon');
        icon.y_align = Clutter.ActorAlign.CENTER;
        row.add_child(icon);

        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const name = new St.Label({text: app?.get_name() ?? p.comm, style_class: 'nitro-gpuapps-name'});
        name.clutter_text.ellipsize = ELLIPSIZE_END;
        text.add_child(name);
        const asked = this._closing.get(p.pid);
        let sub = `PID ${p.pid}`;
        let subCls = 'nitro-gpuapps-sub';
        if (asked && now - asked > NO_ANSWER_MS) {
            sub = _('did not respond');
            subCls += ' nitro-gpuapps-stuck';
        } else if (asked) {
            sub = _('closing…');
        }
        text.add_child(new St.Label({text: sub, style_class: subCls}));
        row.add_child(text);

        if (p.vram !== null && p.vram !== undefined && !this._compact)
            row.add_child(new St.Label({text: `${p.vram} MB`, style_class: 'nitro-gpuapps-mem', y_align: Clutter.ActorAlign.CENTER}));

        if (p.system) {
            row.add_child(new St.Label({text: _('system'), style_class: 'nitro-gpuapps-lock', y_align: Clutter.ActorAlign.CENTER}));
            return row;
        }
        const btn = (label, cls, signal) => {
            const b = new St.Button({label, style_class: `nitro-gpuapps-btn ${cls}`, can_focus: true, y_align: Clutter.ActorAlign.CENTER,
                accessible_name: `${label} ${p.comm}`});
            b.connect('clicked', () => this._kill(p, signal));
            return b;
        };
        if (!this._compact)
            row.add_child(btn(_('Close'), '', 'term'));
        row.add_child(btn(_('Force'), 'nitro-gpuapps-force', 'kill'));
        return row;
    }

    _kill(p, signal) {
        execAsync([this._bin, 'kill', String(p.pid), p.comm, signal], (ok, msg) => {
            if (!ok && msg)
                this._onError(msg);
            if (ok && signal === 'term')
                this._closing.set(p.pid, Date.now());
            this._sig = null;
            this._later(RECHECK_MS, () => this.refresh(true));
            if (signal === 'term')
                this._later(NO_ANSWER_MS + 100, () => this.refresh(true));
        });
    }

    destroy() {
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        this.list = null;
    }
}
