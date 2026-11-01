// Preferências do Nitro (GTK4/Adwaita): geral, editor de modos e curva de ventoinha.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {initStore, loadModes, saveModes, modeFields, newModeId, summary, POWER, GPC, MEM} from './store.js';
import {
    readText, execAsync, findHwmon, fanBackend, batteryLimitFile, ppdIntegrated, loadCurve, DEFAULT_CURVE,
} from './utils.js';

const FAN_HELPER = '/usr/local/bin/nitro-fan';

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
        window.set_default_size(640, 760);
        window.search_enabled = true;
        window.add(this._generalPage());
        window.add(this._modesPage(window));
        window.add(this._fanPage(window));
    }

    // ---- Geral ----

    _generalPage() {
        const page = new Adw.PreferencesPage({title: _('General'), icon_name: 'preferences-system-symbolic'});

        const panel = new Adw.PreferencesGroup({title: _('Top bar and menu')});
        const gpu = new Adw.SwitchRow({title: _('GPU temperature in the top bar'),
            subtitle: _('Only while the NVIDIA GPU is awake; it is never woken up just to read it')});
        this._settings.bind('panel-gpu-temp', gpu, 'active', Gio.SettingsBindFlags.DEFAULT);
        panel.add(gpu);
        const hist = new Adw.SwitchRow({title: _('Temperature history'), subtitle: _('CPU and GPU chart for the last 3 minutes')});
        this._settings.bind('show-history', hist, 'active', Gio.SettingsBindFlags.DEFAULT);
        panel.add(hist);
        const periph = new Adw.SwitchRow({title: _('Peripherals in the menu'),
            subtitle: _('Controllers, mice, keyboards and wireless battery; input is only read while the menu is open')});
        this._settings.bind('show-peripherals', periph, 'active', Gio.SettingsBindFlags.DEFAULT);
        panel.add(periph);
        const key = new Adw.SwitchRow({title: _('NitroSense key'), subtitle: _('Toggles between Performance and the previous profile')});
        this._settings.bind('turbo-key', key, 'active', Gio.SettingsBindFlags.DEFAULT);
        panel.add(key);
        page.add(panel);

        const power = new Adw.PreferencesGroup({title: _('Automatic profile'),
            description: _('Switch the profile by itself when the charger is plugged in or removed.')});
        const opts = [['', _('Keep the current one')], ...profiles().map(p => [p.id, p.label])];
        for (const [k, title] of [['ac-profile', _('Plugged in')], ['battery-profile', _('On battery')]])
            power.add(comboRow(title, null, opts, this._settings.get_string(k), v => this._settings.set_string(k, v)));
        page.add(power);

        page.add(this._statusGroup());
        return page;
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
        group.add(row(_('Platform profile'), readText('/sys/firmware/acpi/platform_profile') !== null,
            readText('/sys/firmware/acpi/platform_profile') ?? '', _('acer_wmi without predator_v4: run ./install.sh')));
        return group;
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
