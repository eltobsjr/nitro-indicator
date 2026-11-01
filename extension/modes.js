// Seção "Modos" do menu, em acordeão: fechado é uma linha só (título, o modo ligado em destaque, engrenagem
// e seta); aberto lista os modos em linhas de uma altura para ligar/desligar. A edição fica nas preferências.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {loadModes, summary} from './store.js';

const ELLIPSIZE_END = 3;

export class ModesSection {
    // profiles: [{id, label}] vindos da extensão; settings: GSettings (modes-expanded);
    // onToggle(id) liga/desliga; onEdit() abre as preferências
    constructor({profiles, settings, onToggle, onEdit}) {
        this._profiles = profiles;
        this._settings = settings;
        this._onToggle = onToggle;
        this._onEdit = onEdit;
        this._active = null;
        this._busy = null;
        this._sig = null;
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-accordion', x_expand: true});

        // barra do acordeão: a área que abre/fecha e, ao lado, a engrenagem (botões irmãos, não aninhados)
        const bar = new St.BoxLayout({style_class: 'nitro-accordion-bar', x_expand: true});
        const head = new St.BoxLayout({style_class: 'nitro-accordion-head', x_expand: true});
        head.add_child(new St.Label({text: _('Modes'), style_class: 'nitro-accordion-title', y_align: Clutter.ActorAlign.CENTER}));
        this._current = new St.Label({style_class: 'nitro-mode-pill', y_align: Clutter.ActorAlign.CENTER});
        this._current.clutter_text.ellipsize = ELLIPSIZE_END;
        head.add_child(this._current);
        head.add_child(new St.Widget({x_expand: true}));
        this._toggle = new St.Button({child: head, style_class: 'nitro-accordion-hit', x_expand: true, can_focus: true,
            accessible_name: _('Modes')});
        const flip = () => settings.set_boolean('modes-expanded', !settings.get_boolean('modes-expanded'));
        this._toggle.connect('clicked', flip);
        const gear = new St.Button({style_class: 'nitro-gear', can_focus: true, y_align: Clutter.ActorAlign.CENTER,
            accessible_name: _('Edit modes…'), child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16})});
        gear.connect('clicked', () => this._onEdit());
        // a seta fica na ponta direita, alinhada com a do acordeão de periféricos
        this._chevron = new St.Icon({icon_size: 14, style_class: 'nitro-accordion-chevron'});
        const chevron = new St.Button({child: this._chevron, style_class: 'nitro-accordion-chevron-btn', can_focus: true,
            y_align: Clutter.ActorAlign.CENTER, accessible_name: _('Modes')});
        chevron.connect('clicked', flip);
        bar.add_child(this._toggle);
        bar.add_child(gear);
        bar.add_child(chevron);
        this.actor.add_child(bar);

        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'nitro-modelist', x_expand: true});
        this.actor.add_child(this._list);
        this._expandedId = settings.connect('changed::modes-expanded', () => this._syncExpanded());
        this.actor.connect('destroy', () => {
            if (this._expandedId)
                settings.disconnect(this._expandedId);
            this._expandedId = 0;
        });
        this._syncExpanded();
        this.refresh();
    }

    get active() {
        return this._active;
    }

    setActive(id) {
        if (id === this._active)
            return;
        this._active = id;
        this.refresh(true);
    }

    setBusy(id) {
        this._busy = id;
        this.refresh(true);
    }

    // modo marcado para ligar sozinho quando o GameMode registrar um jogo
    autoGameModeId() {
        return loadModes().find(m => m.auto_gamemode)?.id ?? null;
    }

    _syncExpanded() {
        const open = this._settings.get_boolean('modes-expanded');
        this._list.visible = open;
        this._chevron.icon_name = open ? 'pan-down-symbolic' : 'pan-end-symbolic';
        if (open)
            this.actor.add_style_pseudo_class('checked');
        else
            this.actor.remove_style_pseudo_class('checked');
    }

    // Só reconstrói quando a lista (ou o estado) mudou: o menu chama isto a cada atualização
    refresh(force = false) {
        const modes = loadModes();
        const sig = JSON.stringify([modes, this._active, this._busy]);
        if (!force && sig === this._sig)
            return;
        this._sig = sig;

        // o modo ligado fica na barra, visível mesmo com o acordeão fechado
        const active = modes.find(m => m.id === this._active);
        if (this._busy) {
            this._current.text = _('Applying…');
            this._current.style_class = 'nitro-mode-pill nitro-mode-pill-busy';
        } else if (active) {
            this._current.text = active.name;
            this._current.style_class = 'nitro-mode-pill nitro-mode-pill-on';
        } else {
            this._current.text = _('None on');
            this._current.style_class = 'nitro-mode-pill';
        }

        this._list.destroy_all_children();
        for (const m of modes)
            this._list.add_child(this._line(m));
    }

    // Uma linha por modo: bolinha, nome e o resumo cortado no fim
    _line(m) {
        const active = this._active === m.id;
        const inner = new St.BoxLayout({style_class: 'nitro-modeline-inner', x_expand: true});
        const radio = new St.Widget({style_class: 'nitro-radio', layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        if (active)
            radio.add_child(new St.Widget({style_class: 'nitro-radio-dot', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true}));
        inner.add_child(radio);
        inner.add_child(new St.Label({text: m.name, style_class: 'nitro-modename', y_align: Clutter.ActorAlign.CENTER}));
        const sum = new St.Label({text: this._busy === m.id ? _('Applying…') : summary(m, this._profiles, _),
            style_class: 'nitro-modesum', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        sum.clutter_text.ellipsize = ELLIPSIZE_END;
        inner.add_child(sum);
        const line = new St.Button({style_class: 'nitro-modeline', child: inner, x_expand: true, can_focus: true,
            reactive: this._busy === null, accessible_name: m.name});
        if (active)
            line.add_style_pseudo_class('checked');
        line.connect('clicked', () => this._onToggle(m.id));
        return line;
    }
}
