// Leitura do sysfs e subprocessos: só GLib/Gio, serve tanto ao Shell quanto às preferências (GTK).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch {
        return null;
    }
}

export function readInt(path) {
    const t = readText(path);
    const n = t === null ? NaN : parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
}

export function writeText(path, text) {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
        GLib.file_set_contents(path, text);
        return true;
    } catch {
        return false;
    }
}

// Roda um comando sem travar o Shell; cb(ok, mensagem, status)
export function execAsync(argv, cb) {
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            let out = '', err = '';
            try {
                [, out, err] = p.communicate_utf8_finish(res);
            } catch {}
            cb(p.get_successful(), (err || out || '').trim(), p.get_exit_status());
        });
    } catch (e) {
        cb(false, e.message, -1);
    }
}

function listDir(base) {
    const out = [];
    try {
        const en = Gio.File.new_for_path(base).enumerate_children('standard::name', 0, null);
        let info;
        while ((info = en.next_file(null)))
            out.push(`${base}/${info.get_name()}`);
    } catch {}
    return out;
}

export function findHwmon(name) {
    return listDir('/sys/class/hwmon').find(dir => readText(`${dir}/name`) === name) ?? null;
}

// Placa NVIDIA: lida pelo sysfs pra não acordar a dGPU à toa (nvidia-smi só roda se ela já estiver ativa)
export function findNvidia() {
    return listDir('/sys/bus/pci/devices').find(dir =>
        readText(`${dir}/vendor`) === '0x10de' && (readText(`${dir}/class`) ?? '').startsWith('0x03')) ?? null;
}

// Fontes de energia pelo tipo, não pelo nome (ACAD, AC, ADP1… muda de modelo pra modelo)
export function findPowerSupply(type) {
    return listDir('/sys/class/power_supply').find(dir => readText(`${dir}/type`) === type) ?? null;
}

// true/false; null quando não há fonte "Mains" (aí quem chama decide)
export function onAc() {
    const mains = listDir('/sys/class/power_supply').filter(dir => readText(`${dir}/type`) === 'Mains');
    return mains.length ? mains.some(dir => readText(`${dir}/online`) === '1') : null;
}

// Nome do notebook pelo DMI (nada de modelo escrito no código)
export function machineName() {
    return readText('/sys/class/dmi/id/product_name') || readText('/sys/class/dmi/id/product_family') || 'Acer Nitro';
}

// ---- ventoinhas: pwm do acer-wmi (kernel com o quirk do modelo) ou o módulo nitro_fan ----

export const FAN_NODE = '/sys/kernel/nitro_fan/mode';
export const CURVE_STATE = '/run/nitro/fancurve';
export const CURVE_CONF = '/etc/nitro/fan-curve.json';
export const DEFAULT_CURVE = [[50, 25], [60, 35], [70, 55], [80, 80], [88, 100]];

export function fanBackend(acerHwmon) {
    if (acerHwmon && readText(`${acerHwmon}/pwm1_enable`) !== null)
        return {kind: 'hwmon', path: acerHwmon};
    if (readText(FAN_NODE) !== null)
        return {kind: 'module', path: FAN_NODE};
    return null;
}

// auto | max | custom | curve | unknown, ou null sem controle de ventoinha
export function fanState(backend) {
    if (!backend)
        return null;
    if (readText(CURVE_STATE) !== null)
        return 'curve';
    if (backend.kind === 'hwmon')
        return {0: 'max', 1: 'custom', 2: 'auto'}[readInt(`${backend.path}/pwm1_enable`)] ?? 'unknown';
    return readText(FAN_NODE) ?? 'unknown';
}

export function loadCurve() {
    try {
        const pts = JSON.parse(readText(CURVE_CONF) ?? 'null')?.points;
        if (Array.isArray(pts) && pts.length >= 2)
            return pts;
    } catch {}
    return DEFAULT_CURVE.map(p => [...p]);
}

// ---- bateria: charge_control_end_threshold do módulo nitro_battery (ou de um driver oficial no futuro) ----

export function batteryLimitFile() {
    const bat = findPowerSupply('Battery');
    return bat && readText(`${bat}/charge_control_end_threshold`) !== null ? `${bat}/charge_control_end_threshold` : null;
}

// ---- integração com o power-profiles-daemon (tuned-ppd) ----

// Perfis Acer que têm equivalente no PPD. "quiet" não tem: vai direto pelo helper.
export const PPD_OF = {'low-power': 'power-saver', 'balanced': 'balanced', 'balanced-performance': 'performance'};

// Só usamos o PPD quando o "Desempenho" dele aponta para o nitro-performance (instalado pelo install.sh);
// sem isso o tuned pede platform_profile=performance, que o firmware recusa.
export function ppdIntegrated() {
    const conf = readText('/etc/tuned/ppd.conf') ?? '';
    return /^\s*performance\s*=\s*nitro-performance\s*$/m.test(conf);
}

// ---- GameMode: ~/.config/gamemode.ini que chama o nitro-mode ao abrir e fechar um jogo ----
// Só criamos ou apagamos o arquivo quando ele é nosso (tem a marca); um gamemode.ini seu nunca é mexido.

const GAMEMODE_MARK = '# Nitro Indicator';
export const gamemodeIni = () => GLib.build_filenamev([GLib.get_user_config_dir(), 'gamemode.ini']);

// 'ours' (ligado por nós) | 'none' (sem arquivo) | 'other' (arquivo seu: não mexemos)
export function gamemodeState() {
    const text = readText(gamemodeIni());
    if (text === null)
        return 'none';
    return text.includes(GAMEMODE_MARK) ? 'ours' : 'other';
}

export function setGamemode(on) {
    const state = gamemodeState();
    if (state === 'other')
        return false;
    if (on) {
        const bin = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'nitro-mode']);
        return writeText(gamemodeIni(), `${GAMEMODE_MARK}: liga o modo marcado como "ligar ao abrir um jogo".\n` +
            `[custom]\nstart=${bin} auto-start\nend=${bin} auto-stop\n`);
    }
    if (state === 'ours')
        GLib.unlink(gamemodeIni());
    return true;
}
