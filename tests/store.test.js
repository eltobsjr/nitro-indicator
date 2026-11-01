// store.js e utils.js rodando de verdade no gjs (sem o Shell). Chamado por test_js.py com XDG_* temporários.
import GLib from 'gi://GLib';
import System from 'system';

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const ext = GLib.build_filenamev([here, '..', 'extension']);
const store = await import(`file://${ext}/store.js`);
const utils = await import(`file://${ext}/utils.js`);
const devices = await import(`file://${ext}/devices.js`);

let failed = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) {
        print(`ok    ${name}`);
    } else {
        print(`FALHA ${name}: veio ${g}, esperado ${w}`);
        failed++;
    }
}
const _ = s => s;

store.initStore(ext);
const defaults = JSON.parse(utils.readText(`${ext}/defaults.json`));

eq('sem config: modos de fábrica', store.loadModes().map(m => m.id), ['gamer', 'silencio']);
eq('campos padrão vêm do defaults.json', store.modeFields(), defaults.fields);
eq('silêncio herda campos e sobrescreve', [store.loadModes()[1].profile, store.loadModes()[1].gpu_custom], ['quiet', {gpc: 100, mem: 500}]);

const modes = store.loadModes();
modes.push({...store.modeFields(), id: store.newModeId(modes), name: 'Teste', fan: 'curve'});
eq('novo id', modes.at(-1).id, 'modo-1');
eq('salva', store.saveModes(modes), true);
eq('relê o que salvou (cache invalidado)', store.loadModes().map(m => [m.id, m.fan]), [['gamer', 'max'], ['silencio', 'auto'], ['modo-1', 'curve']]);
eq('loadModes devolve cópia', (() => {
    const a = store.loadModes();
    a[0].name = 'mexido';
    return store.loadModes()[0].name;
})(), 'Gamer');

const profiles = [{id: 'balanced-performance', label: 'Performance'}, {id: 'quiet', label: 'Silencioso'}];
eq('resumo gamer', store.summary(store.loadModes()[0], profiles, _), 'Performance · fans at max · GPU Boost · CPU performance');
eq('resumo vazio', store.summary({gpu_custom: {}}, profiles, _), 'No changes');
eq('resumo custom', store.summary({gpu_offset: 'custom', gpu_custom: {gpc: 50, mem: 200}, power_limit: 45}, profiles, _), 'GPU +50/+200 · 45 W');

eq('sem modo ativo', store.activeModeId(), null);
const stateDir = GLib.build_filenamev([GLib.get_user_state_dir(), 'nitro']);
utils.writeText(`${stateDir}/mode-active.json`, JSON.stringify({mode: 'gamer', boot: utils.readText('/proc/sys/kernel/random/boot_id')}));
eq('modo ativo deste boot', store.activeModeId(), 'gamer');
utils.writeText(`${stateDir}/mode-active.json`, JSON.stringify({mode: 'gamer', boot: 'outro'}));
eq('modo de outro boot não vale', store.activeModeId(), null);

// utils
eq('readInt inválido', utils.readInt('/proc/version'), null);
eq('fanBackend sem nada', utils.fanBackend('/caminho/que/nao/existe') === null || utils.fanBackend('/caminho/que/nao/existe').kind === 'module', true);
eq('fanState sem backend', utils.fanState(null), null);
eq('onAc é booleano ou null', [true, false, null].includes(utils.onAc()), true);
eq('curva padrão quando não há config', utils.loadCurve().length >= 2, true);
eq('PPD_OF não mapeia quiet', 'quiet' in utils.PPD_OF, false);

// periféricos: /proc/bus/input/devices real do ANV15-51 (com controle, receptor 2.4G e touchpad)
const fixture = utils.readText(GLib.build_filenamev([here, 'fixtures', 'input-devices.txt']));
const devs = devices.parseInputDevices(fixture, s => s === 'Laptop keyboard' ? 'Teclado do notebook' : s);
eq('dispositivos reconhecidos', devs.map(d => [d.kind, d.name, d.wireless]), [
    ['gamepad', 'Zikway HID gamepad', false],
    ['touchpad', 'Touchpad (PIXA3848)', false],
    ['keyboard', 'Teclado do notebook', false],
    ['keyboard', 'YICHIP 2.4G Receiver', true],
    ['mouse', 'YICHIP 2.4G Receiver', true],
]);
eq('ignora botão de energia, vídeo, alto-falante e partes do controle',
    devs.some(d => /Power|Video|Speaker|Consumer|System Control|gamepad Keyboard/.test(d.name)), false);

// controle HID genérico (Zikway): direito em Z/RZ, gatilhos em GAS/BRAKE, faixa 0..255
const hid = {axes: {0: [0, 255], 1: [0, 255], 2: [0, 255], 5: [0, 255], 9: [0, 255], 10: [0, 255], 16: [-1, 1], 17: [-1, 1]},
    abs: {0: 255, 1: 0, 2: 128, 5: 128, 9: 255, 10: 0, 16: -1, 17: 1}, pressed: new Set([304])};
const sh = devices.padState(hid);
eq('HID: analógico esquerdo', sh.left.map(v => Math.round(v * 100) / 100), [1, -1]);
eq('HID: direito no centro', sh.right.map(v => Math.round(v * 10) / 10), [0, 0]);
eq('HID: gatilhos', [sh.lt, sh.rt], [0, 1]);
eq('HID: direcional', [sh.up, sh.down, sh.left_, sh.right_], [false, true, true, false]);

// controle tipo Xbox (xpad): direito em RX/RY, gatilhos em Z/RZ
const xpad = {axes: {0: [-32768, 32767], 1: [-32768, 32767], 2: [0, 1023], 3: [-32768, 32767], 4: [-32768, 32767], 5: [0, 1023]},
    abs: {0: 0, 1: 0, 2: 1023, 3: 32767, 4: -32768, 5: 0}, pressed: new Set([313])};
const sx = devices.padState(xpad);
eq('xpad: direito em RX/RY', sx.right.map(v => Math.round(v)), [1, -1]);
eq('xpad: LT pelo eixo, RT pelo botão digital', [sx.lt, sx.rt], [1, 1]);
eq('controle sem eixos não quebra', devices.padState({axes: {}, abs: {}, pressed: new Set()}).left, null);

System.exit(failed ? 1 : 0);
