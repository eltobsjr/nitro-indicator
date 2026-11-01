// Preferências do Nitro (GTK4/Adwaita): geral, editor de modos e curva de ventoinha.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildLab} from './lab.js';
import {initStore, loadModes, saveModes, modeFields, newModeId, summary, POWER, GPC, MEM} from './store.js';
import {
    readText, execAsync, findHwmon, fanBackend, gamemodeState, setGamemode, batteryLimitFile, ppdIntegrated, loadCurve, DEFAULT_CURVE,
} from './utils.js';

const FAN_HELPER = '/usr/local/bin/nitro-fan';

// Nome no barramento do sistema com dono (ou que o D-Bus sabe ativar, com activatable)
function busHasOwner(name, activatable = false) {
    try {
        const call = (method, args, type) => Gio.DBus.system.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', method, args, new GLib.VariantType(type), Gio.DBusCallFlags.NONE, 1000, null).deepUnpack()[0];
        return call('NameHasOwner', new GLib.Variant('(s)', [name]), '(b)') ||
            (activatable && call('ListActivatableNames', null, '(as)').includes(name));
    } catch {
        return false;
    }
}

// O UPower reconhece o limite de carga desta bateria (então o GNOME também)
function upowerChargeLimit() {
    try {
        const paths = Gio.DBus.system.call_sync('org.freedesktop.UPower', '/org/freedesktop/UPower', 'org.freedesktop.UPower',
            'EnumerateDevices', null, new GLib.VariantType('(ao)'), Gio.DBusCallFlags.NONE, 1000, null).deepUnpack()[0];
        return paths.some(path => {
            const v = Gio.DBus.system.call_sync('org.freedesktop.UPower', path, 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.freedesktop.UPower.Device', 'ChargeThresholdSupported']),
                new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 1000, null).deepUnpack()[0];
            return v.unpack() === true;
        });
    } catch {
        return false;
    }
}

const profiles = () => [
    {id: 'low-power', label: _('Eco')},
    {id: 'quiet', label: _('Quiet')},
    {id: 'balanced', label: _('Balanced')},
    {id: 'balanced-performance', label: _('Performance')},
];

// ComboRow a partir de [[valor, rótulo]]; onPick(valor)
function comboRow(title, subtitle, options, current, onPick) {
    const row = new Adw.ComboRow({title, subtitle, model: Gtk.StringList.new(options.map(o => o[1]))});
    row.selected = Math.max(0, options.findIndex(o => o[0] === current));
    row.connect('notify::selected', () => onPick(options[row.selected][0]));
    return row;
}

function switchRow(title, subtitle, active, onToggle) {
    const row = new Adw.SwitchRow({title, subtitle, active});
    row.connect('notify::active', () => onToggle(row.active));
    return row;
}

// SpinRow com "—" (desligado) em 0 quando nullable
function spinRow(title, subtitle, range, value, nullable, onChange) {
    const row = new Adw.SpinRow({
        title, subtitle,
        adjustment: new Gtk.Adjustment({lower: nullable ? 0 : range.min, upper: range.max, step_increment: range.step, value: value ?? 0}),
    });
    row.connect('notify::value', () => {
        let v = Math.round(row.value / range.step) * range.step;
        if (nullable && v < range.min)
            v = v > 0 ? range.min : null;
        onChange(v);
    });
    return row;
}

export default class NitroPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        initStore(this.path);
        this._settings = this.getSettings();
        window.set_default_size(1000, 860);
        window.search_enabled = true;
        window.add(this._generalPage());
        window.add(this._labPage());
        window.add(this._modesPage(window));
        window.add(this._fanPage(window));
    }

    // ---- Geral ----

    _generalPage() {
        const page = new Adw.PreferencesPage({title: _('General'), icon_name: 'preferences-system-symbolic'});

        const panel = new Adw.PreferencesGroup({title: _('Keyboard')});
        const key = new Adw.SwitchRow({title: _('NitroSense key'), subtitle: _('Toggles between Performance and the previous profile')});
        this._settings.bind('turbo-key', key, 'active', Gio.SettingsBindFlags.DEFAULT);
        panel.add(key);
        page.add(panel);

        const power = new Adw.PreferencesGroup({title: _('Automatic profile'),
            description: _('Switch the profile by itself when the charger is plugged in or removed.')});
        const opts = [['', _('Keep the current one')], ...profiles().map(p => [p.id, p.label])];
        for (const [k, title] of [['ac-profile', _('Plugged in')], ['battery-profile', _('On battery')]])
            power.add(comboRow(title, null, opts, this._settings.get_string(k), v => this._settings.set_string(k, v)));
        const hz = new Adw.SwitchRow({title: _('60 Hz screen on battery'),
            subtitle: _('Only the laptop screen; the previous rate comes back when plugged in')});
        this._settings.bind('battery-60hz', hz, 'active', Gio.SettingsBindFlags.DEFAULT);
        power.add(hz);
        power.add(this._gamemodeRow());
        page.add(power);

        page.add(this._statusGroup());
        return page;
    }

    // ~/.config/gamemode.ini: o GameMode chama o nitro-mode ao abrir e fechar um jogo (funciona com a extensão
    // desligada). Um gamemode.ini seu nunca é mexido (utils.js).
    _gamemodeRow() {
        const state = gamemodeState();
        const row = new Adw.SwitchRow({title: _('Turn on the game mode through GameMode'),
            subtitle: state === 'other' ? _('You already have a gamemode.ini; add start/end with nitro-mode auto-start/auto-stop to it')
                : _('Works even with the extension off or the screen locked'),
            active: state === 'ours', sensitive: state !== 'other'});
        row.connect('notify::active', () => setGamemode(row.active));
        return row;
    }

    // O que está instalado e funcionando: ajuda a entender um botão acinzentado no menu
    _statusGroup() {
        const group = new Adw.PreferencesGroup({title: _('System status')});
        const row = (title, ok, okText, badText) => {
            const r = new Adw.ActionRow({title, subtitle: ok ? okText : badText});
            r.add_prefix(new Gtk.Image({icon_name: ok ? 'object-select-symbolic' : 'dialog-warning-symbolic',
                css_classes: [ok ? 'success' : 'warning']}));
            return r;
        };
        const backend = fanBackend(findHwmon('acer'));
        group.add(row(_('Fan control'), !!backend,
            backend?.kind === 'hwmon' ? _('Through the kernel acer-wmi driver (pwm)') : _('Through the nitro_fan module'),
            _('Unavailable: run ./install.sh (needs kernel-devel and dkms)')));
        group.add(row(_('Charge limit'), !!batteryLimitFile(), _('nitro_battery module loaded'),
            _('Unavailable: nitro_battery module not loaded')));
        group.add(row(_('Power profiles daemon'), ppdIntegrated(),
            _('Integrated: Quick Settings and this menu stay in sync'),
            _('Not integrated: profiles are written directly (run ./install.sh to integrate tuned-ppd)')));
        group.add(row(_('Charge limit in GNOME Settings'), upowerChargeLimit(),
            _('“Preserve battery health” controls the same limit'),
            _('UPower does not see the limit yet (run ./install.sh and load nitro_battery)')));
        group.add(row(_('thermald'), busHasOwner('org.freedesktop.thermald'),
            _('Running; it does not touch the Acer profile'), _('Not running (optional)')));
        group.add(row(_('Mouse DPI (ratbagd)'), busHasOwner('org.freedesktop.ratbag1', true),
            _('Available in the peripheral tester for supported mice'),
            _('ratbagd not installed (sudo dnf install libratbag-ratbagd)')));
        group.add(row(_('Platform profile'), readText('/sys/firmware/acpi/platform_profile') !== null,
            readText('/sys/firmware/acpi/platform_profile') ?? '', _('acer_wmi without predator_v4: run ./install.sh')));
        return group;
    }

    // ---- Laboratório: monte o menu e a barra arrastando as peças (lab.js) ----

    _labPage() {
        const page = new Adw.PreferencesPage({title: _('Lab'), icon_name: 'view-grid-symbolic'});
        buildLab(page, this._settings, _, Adw);
        return page;
    }

    // ---- Modos ----

    _modesPage(window) {
        const page = new Adw.PreferencesPage({title: _('Modes'), icon_name: 'input-gaming-symbolic'});
        const group = new Adw.PreferencesGroup({title: _('Modes'),
            description: _('Sets of settings turned on and off together from the menu (or with nitro-mode on NAME).')});
        const add = new Gtk.Button({icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('New mode'),
            css_classes: ['flat']});
        group.set_header_suffix(add);
        page.add(group);

        let modes = loadModes();
        let rows = [];
        let saveTimer = 0;
        const save = () => {
            if (saveTimer)
                GLib.source_remove(saveTimer);
            saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                saveTimer = 0;
                if (!saveModes(modes))
                    window.add_toast(new Adw.Toast({title: _('Could not save ~/.config/nitro/modes.json')}));
                return GLib.SOURCE_REMOVE;
            });
        };
        const render = (expand = null) => {
            rows.forEach(r => group.remove(r));
            rows = modes.map(m => this._modeRow(m, modes, save, () => {
                modes = modes.filter(o => o !== m);
                save();
                render();
            }));
            rows.forEach(r => {
                group.add(r);
                if (r._modeId === expand)
                    r.expanded = true;
            });
        };
        add.connect('clicked', () => {
            const id = newModeId(modes);
            const base = modes.find(m => m.id === 'gamer') ?? modes[0] ?? modeFields();
            modes.push({...JSON.parse(JSON.stringify(base)), id, name: _('New mode %d').replace('%d', id.split('-')[1]), auto_gamemode: false});
            save();
            render(id);
        });
        render();
        return page;
    }

    _modeRow(m, modes, save, remove) {
        const sum = () => summary(m, profiles(), _);
        const row = new Adw.ExpanderRow({title: GLib.markup_escape_text(m.name, -1), subtitle: sum()});
        row._modeId = m.id;
        const changed = () => {
            row.subtitle = sum();
            save();
        };

        const name = new Adw.EntryRow({title: _('Name'), text: m.name});
        name.connect('changed', () => {
            const t = name.text.trim();
            if (t) {
                m.name = t.slice(0, 24);
                row.title = GLib.markup_escape_text(m.name, -1);
                save();
            }
        });
        row.add_row(name);

        row.add_row(comboRow(_('Profile'), null, [[null, _('Do not change')], ...profiles().map(p => [p.id, p.label])],
            m.profile, v => {
                m.profile = v;
                changed();
            }));
        row.add_row(comboRow(_('Fans'), null,
            [[null, _('Do not change')], ['auto', _('Auto')], ['max', _('Max')], ['curve', _('Curve')]], m.fan, v => {
                m.fan = v;
                changed();
            }));

        const gpc = spinRow(_('GPU core offset (MHz)'), null, GPC, m.gpu_custom.gpc, false, v => {
            m.gpu_custom.gpc = v;
            changed();
        });
        const mem = spinRow(_('GPU memory offset (MHz)'), null, MEM, m.gpu_custom.mem, false, v => {
            m.gpu_custom.mem = v;
            changed();
        });
        const syncCustom = () => {
            gpc.visible = mem.visible = m.gpu_offset === 'custom';
        };
        row.add_row(comboRow(_('GPU overclock'), null,
            [[null, _('Do not change')], ['off', _('Default')], ['boost', _('Boost (+100/+500)')], ['max', _('Maximum (+150/+1000)')], ['custom', _('Custom')]],
            m.gpu_offset, v => {
                m.gpu_offset = v;
                syncCustom();
                changed();
            }));
        row.add_row(gpc);
        row.add_row(mem);
        syncCustom();

        row.add_row(spinRow(_('GPU power limit (W)'), _('0 = do not change. Many laptop drivers do not allow it.'),
            POWER, m.power_limit, true, v => {
                m.power_limit = v;
                changed();
            }));
        row.add_row(switchRow(_('CPU in performance'), _('tuned profile nitro-performance'), m.cpu_performance, v => {
            m.cpu_performance = v;
            changed();
        }));
        row.add_row(switchRow(_('Only when plugged in'), _('Ignored on battery'), m.only_on_ac, v => {
            m.only_on_ac = v;
            changed();
        }));
        row.add_row(switchRow(_('Turn on when a game starts'), _('Through Feral GameMode; only one mode can have this'), m.auto_gamemode, v => {
            m.auto_gamemode = v;
            if (v)
                for (const o of modes)
                    if (o !== m)
                        o.auto_gamemode = false;
            changed();
        }));

        if (modes.length > 1) {
            const del = new Adw.ButtonRow({title: _('Delete mode'), css_classes: ['destructive-action']});
            del.connect('activated', remove);
            row.add_row(del);
        }
        return row;
    }

    // ---- Ventoinhas: curva ----

    _fanPage(window) {
        const page = new Adw.PreferencesPage({title: _('Fan curve'), icon_name: 'weather-windy-symbolic'});
        const group = new Adw.PreferencesGroup({title: _('Fan curve'),
            description: _('Used by the “Curve” fan option. The CPU fan follows the CPU; the GPU fan follows the hotter of the two. Above 92 °C the fans always go to 100%.')});
        page.add(group);

        let points = loadCurve();
        const chart = new Gtk.DrawingArea({content_height: 180, hexpand: true, margin_bottom: 12});
        chart.set_draw_func((_a, cr, w, h) => this._drawCurve(chart, cr, w, h, points));
        const frame = new Gtk.Frame({child: chart, css_classes: ['view']});
        group.add(frame);

        const pts = new Adw.PreferencesGroup({title: _('Points')});
        page.add(pts);
        let rows = [];
        const render = () => {
            rows.forEach(r => pts.remove(r));
            rows = points.map((p, i) => {
                const r = new Adw.ActionRow({title: _('Point %d').replace('%d', i + 1)});
                const temp = new Gtk.SpinButton({adjustment: new Gtk.Adjustment({lower: 30, upper: 100, step_increment: 1, value: p[0]}),
                    valign: Gtk.Align.CENTER, tooltip_text: '°C'});
                const pct = new Gtk.SpinButton({adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5, value: p[1]}),
                    valign: Gtk.Align.CENTER, tooltip_text: '%'});
                temp.connect('value-changed', () => {
                    p[0] = temp.get_value_as_int();
                    chart.queue_draw();
                });
                pct.connect('value-changed', () => {
                    p[1] = pct.get_value_as_int();
                    chart.queue_draw();
                });
                r.add_suffix(temp);
                r.add_suffix(new Gtk.Label({label: '°C →', css_classes: ['dim-label']}));
                r.add_suffix(pct);
                r.add_suffix(new Gtk.Label({label: '%', css_classes: ['dim-label']}));
                pts.add(r);
                return r;
            });
            chart.queue_draw();
        };
        render();

        const actions = new Adw.PreferencesGroup();
        const apply = new Adw.ButtonRow({title: _('Save curve'), css_classes: ['suggested-action']});
        apply.connect('activated', () => {
            const sorted = [...points].sort((a, b) => a[0] - b[0]);
            execAsync(['pkexec', FAN_HELPER, 'curve', 'set', JSON.stringify({points: sorted})], (ok, msg) => {
                window.add_toast(new Adw.Toast({title: ok ? _('Curve saved') : `${_('Could not save the curve')}: ${msg}`}));
            });
        });
        const reset = new Adw.ButtonRow({title: _('Restore default curve')});
        reset.connect('activated', () => {
            points = DEFAULT_CURVE.map(p => [...p]);
            render();
        });
        actions.add(apply);
        actions.add(reset);
        page.add(actions);
        return page;
    }

    _drawCurve(widget, cr, w, h, points) {
        const fg = widget.get_color();
        const accent = Adw.StyleManager.get_default().get_accent_color_rgba();
        const pad = {l: 34, r: 10, t: 10, b: 22};
        const x = t => pad.l + (t - 30) / 70 * (w - pad.l - pad.r);
        const y = p => h - pad.b - p / 100 * (h - pad.t - pad.b);

        cr.setFontSize(10);
        cr.setLineWidth(1);
        for (const t of [30, 50, 70, 90]) {
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.12);
            cr.moveTo(x(t), pad.t);
            cr.lineTo(x(t), h - pad.b);
            cr.stroke();
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.6);
            cr.moveTo(x(t) - 10, h - 6);
            cr.showText(`${t}°`);
        }
        for (const p of [0, 50, 100]) {
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.12);
            cr.moveTo(pad.l, y(p));
            cr.lineTo(w - pad.r, y(p));
            cr.stroke();
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.6);
            cr.moveTo(2, y(p) + 4);
            cr.showText(`${p}%`);
        }

        const sorted = [...points].sort((a, b) => a[0] - b[0]);
        cr.setSourceRGBA(accent.red, accent.green, accent.blue, 1);
        cr.setLineWidth(2.5);
        cr.moveTo(x(30), y(sorted[0][1]));
        for (const [t, p] of sorted)
            cr.lineTo(x(t), y(p));
        cr.lineTo(x(Math.max(92, sorted.at(-1)[0])), y(sorted.at(-1)[1]));
        cr.lineTo(x(92), y(100));
        cr.lineTo(x(100), y(100));
        cr.stroke();
        for (const [t, p] of sorted) {
            cr.arc(x(t), y(p), 4, 0, 2 * Math.PI);
            cr.fill();
        }
    }
}
