// Modos nomeados: leitura/gravação de ~/.config/nitro/modes.json. Sem St/Gtk: usado pelo menu e pelas preferências.
// A aplicação em si é do comando nitro-mode (system/nitro-mode); aqui só configuramos.
// Os campos e os modos de fábrica vêm de defaults.json (a mesma fonte que o nitro-mode lê).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readText, writeText} from './utils.js';

const CONFIG_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'nitro', 'modes.json']);
const ACTIVE_FILE = GLib.build_filenamev([GLib.get_user_state_dir(), 'nitro', 'mode-active.json']);
const BOOT_ID_FILE = '/proc/sys/kernel/random/boot_id';
export const ID_RE = /^[a-z0-9-]{1,32}$/;

export const POWER = {min: 30, max: 65, step: 5};   // o helper confere com a faixa real do driver
export const GPC = {min: 0, max: 300, step: 25};    // MHz
export const MEM = {min: 0, max: 1500, step: 100};  // MHz

const clone = v => JSON.parse(JSON.stringify(v));

let defaults = null;

// Chamar uma vez com a pasta da extensão (this.path)
export function initStore(extDir) {
    try {
        defaults = JSON.parse(readText(GLib.build_filenamev([extDir, 'defaults.json'])));
    } catch (e) {
        logError(e, 'Nitro: defaults.json ilegível');
        defaults = {fields: {}, builtin: []};
    }
}

export function modeFields() {
    return clone(defaults.fields);
}

function builtinModes() {
    return defaults.builtin.map(b => ({...clone(defaults.fields), name: b.id, ...clone(b)}));
}

// Cache pela data de modificação: o menu relê a cada 1,5 s, o arquivo quase nunca muda
let cache = {mtime: null, modes: null};

function mtime(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_modification_date_time()?.to_unix_usec() ?? 0;
    } catch {
        return -1;
    }
}

export function loadModes() {
    const t = mtime(CONFIG_FILE);
    if (cache.modes && cache.mtime === t)
        return clone(cache.modes);
    let modes = null;
    try {
        const list = JSON.parse(readText(CONFIG_FILE) ?? 'null')?.modes;
        if (Array.isArray(list)) {
            const out = list.filter(m => m && typeof m === 'object' && ID_RE.test(String(m.id)))
                .map(m => ({...clone(defaults.fields), name: m.id, icon: 'input-gaming-symbolic', ...m}));
            if (out.length)
                modes = out;
        }
    } catch {}
    cache = {mtime: t, modes: modes ?? builtinModes()};
    return clone(cache.modes);
}

export function saveModes(modes) {
    const ok = writeText(CONFIG_FILE, JSON.stringify({modes}, null, 2));
    cache = {mtime: null, modes: null};
    return ok;
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

export function newModeId(modes) {
    let n = 1;
    while (modes.some(m => m.id === `modo-${n}`))
        n++;
    return `modo-${n}`;
}

// Resumo de uma linha de um modo; _ é o gettext de quem chama (Shell ou preferências)
export function summary(m, profiles, _) {
    const parts = [];
    const prof = profiles.find(p => p.id === m.profile);
    if (prof)
        parts.push(prof.label);
    if (m.fan)
        parts.push({max: _('fans at max'), curve: _('fan curve'), auto: _('fans auto')}[m.fan] ?? m.fan);
    if (m.gpu_offset === 'custom')
        parts.push(`GPU +${m.gpu_custom.gpc}/+${m.gpu_custom.mem}`);
    else if (m.gpu_offset && m.gpu_offset !== 'off')
        parts.push(`GPU ${{boost: _('Boost'), max: _('Maximum')}[m.gpu_offset] ?? m.gpu_offset}`);
    if (m.power_limit)
        parts.push(`${m.power_limit} W`);
    if (m.cpu_performance)
        parts.push(_('CPU performance'));
    return parts.join(' · ') || _('No changes');
}
