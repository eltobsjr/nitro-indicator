// store.js e utils.js rodando de verdade no gjs (sem o Shell). Chamado por test_js.py com XDG_* temporários.
import GLib from 'gi://GLib';
import System from 'system';

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const ext = GLib.build_filenamev([here, '..', 'extension']);
const store = await import(`file://${ext}/store.js`);
const utils = await import(`file://${ext}/utils.js`);
const devices = await import(`file://${ext}/devices.js`);
const display = await import(`file://${ext}/display.js`);
const layout = await import(`file://${ext}/layout.js`);

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

// tela a 60 Hz: estado real do Mutter com 3 monitores (DP-1 girado, eDP-1 interno a 165 Hz, HDMI-2)
const state = JSON.parse(utils.readText(GLib.build_filenamev([here, 'fixtures', 'mutter-state.json'])));
const low = display.planRefresh(state, 'low');
eq('60 Hz: só o monitor interno', [low.connector, low.current, low.target], ['eDP-1', '1920x1080@165.000', '1920x1080@60.000']);
eq('60 Hz: externos repassados como estão',
    low.logical.map(l => [l[0], l[1], l[3], l[4], l[5][0][0], l[5][0][1]]),
    [[0, 720, 3, false, 'DP-1', '1440x900@59.887'], [900, 1080, 0, true, 'eDP-1', '1920x1080@60.000'], [900, 0, 0, false, 'HDMI-2', '1920x1080@59.934']]);
eq('60 Hz: já no modo pedido, nada a fazer', display.planRefresh(state, '1920x1080@165.000'), null);
const back = JSON.parse(JSON.stringify(state));
for (const m of back[1][1][1])
    m[6]['is-current'] = m[0] === '1920x1080@60.000';
eq('volta para o modo salvo', display.planRefresh(back, '1920x1080@165.000').target, '1920x1080@165.000');
eq('modo salvo sumiu: o de maior taxa', display.planRefresh(back, 'nao-existe').target, '1920x1080@165.000');
eq('sem monitor interno', display.planRefresh([1, [state[1][0]], [state[2][0]], {}], 'low'), null);

// mapeamento da SDL
eq('GUID do GameSir (Zikway)', devices.sdlGuid([0x03, 0x3537, 0x1041, 0x0111]), '03000000373500004110000011010000');
const db = utils.readText(GLib.build_filenamev([ext, 'data', 'gamecontrollerdb-linux.txt']));
eq('GameSir Nova Lite não está no banco (fica com o kernel)', devices.findSdlMapping(db, [0x03, 0x3537, 0x1041, 0x0111]), null);
const x360 = devices.findSdlMapping(db, [0x03, 0x045e, 0x028e, 0x0114]);
eq('Xbox 360 encontrado', x360 !== null && /Xbox 360/.test(x360.name), true);
// xpad: botões 304..318, eixos X Y Z RX RY RZ e hat
const xp = {buttons: [304, 305, 307, 308, 310, 311, 314, 315, 316, 317, 318],
    axes: {0: [-32768, 32767], 1: [-32768, 32767], 2: [0, 255], 3: [-32768, 32767], 4: [-32768, 32767], 5: [0, 255], 16: [-1, 1], 17: [-1, 1]},
    abs: {0: 32767, 1: 0, 2: 255, 3: 0, 4: 0, 5: 0, 16: 1, 17: 0}, pressed: new Set([308, 315])};
const sx2 = devices.padState(xp, x360);
eq('SDL: fonte', sx2.source, 'sdl');
// no xpad o 308 (BTN_Y) é o Y, ao contrário do que a convenção BTN_WEST sugere: é isso que a SDL corrige
eq('SDL: botões pelo nome', Object.entries(sx2.btn).filter(([, v]) => v).map(([k]) => k).sort(), ['start', 'y']);
eq('SDL: LT apertado, RT solto', [Math.round(sx2.lt * 100) / 100, sx2.rt], [1, 0]);
eq('SDL: direcional para a direita', [sx2.up, sx2.down, sx2.left_, sx2.right_], [false, false, false, true]);
eq('SDL: analógico esquerdo à direita', Math.round(sx2.left[0]), 1);

// layout em grade: linha, coluna e tamanho escolhidos (nada se encaixa sozinho)
const it = (id, size, r, c) => ({id, size, r, c});
const parsed = layout.parseItems(['cpu:1x1:0:0', 'gputemp:1x1:0:1', 'xyz:1x1:0:2', 'cpu:2x1:3:0', 'fan1:1x1:0:1', 'profile:full:1:3', 'fan2:9x9:2:2']);
eq('grade: lê, ignora desconhecidos, repetidos e sobrepostos', parsed.map(i => `${i.id}:${i.size}:${i.r}:${i.c}`),
    ['cpu:1x1:0:0', 'gputemp:1x1:0:1', 'profile:full:1:0', 'fan2:1x1:2:2']);
eq('grade: ida e volta', layout.parseItems(layout.serialize(parsed)), parsed);
const g0 = [it('cpu', '1x1', 0, 0), it('gputemp', '2x1', 0, 2)];
eq('grade: cabe ao lado', layout.fits(g0, it('fan1', '1x1', 0, 1)), true);
eq('grade: não sobrepõe', layout.fits(g0, it('fan1', '1x1', 0, 2)), false);
eq('grade: não passa da 4ª coluna', layout.fits(g0, it('fan1', '2x1', 1, 3)), false);
eq('grade: bloco clássico ocupa a linha toda', layout.fits(g0, it('profile', 'full', 0, 0)), false);
eq('grade: mover para o mesmo lugar dele mesmo', layout.fits(g0, it('cpu', '1x1', 0, 0)), true);
eq('grade: buraco é permitido (sem encaixe automático)', layout.place(g0, it('fan1', '1x1', 5, 3)).find(i => i.id === 'fan1'), it('fan1', '1x1', 5, 3));
eq('grade: place recusa sobreposição', layout.place(g0, it('fan1', '1x1', 0, 0)), null);
eq('grade: aumentar que não cabe é recusado', layout.resize([...g0, it('fan1', '1x1', 0, 1)], 'cpu', '2x1'), null);
eq('grade: aumentar que cabe', layout.resize([it('cpu', '1x1', 0, 0)], 'cpu', '2x2').find(i => i.id === 'cpu').size, '2x2');
eq('grade: primeiro lugar livre', layout.firstFree(g0, 'fan1', '1x1'), it('fan1', '1x1', 0, 1));
eq('grade: primeiro lugar livre de bloco clássico', layout.firstFree(g0, 'modes', 'full'), it('modes', 'full', 1, 0));
eq('grade: tirar', layout.remove(g0, 'cpu').map(i => i.id), ['gputemp']);

// geometria: ladrilhos = célula; bloco = altura dele; linha vazia some; gap entre linhas usadas
const geo = layout.geometry([it('cpu', '1x1', 0, 0), it('modes', 'full', 1, 0), it('fan1', '1x1', 3, 1)], 376, 12, () => 50);
eq('geometria: célula', geo.cell, (376 - 36) / 4);
eq('geometria: alturas das linhas (a 2 vazia some)', geo.heights, [85, 50, 0, 85]);
eq('geometria: posições', geo.boxes.map(b => [b.x, b.y, b.w, b.h]), [[0, 0, 85, 85], [0, 97, 376, 50], [97, 159, 85, 85]]);
eq('geometria: altura total', geo.height, 85 + 12 + 50 + 12 + 85);
const tall = layout.geometry([it('gpuapps', '2x2', 0, 0)], 376, 0, () => 0);
eq('geometria: 2x2 sem gap tem 2 células de altura', tall.boxes[0].h, 2 * 94);
eq('geometria: distância muda as posições', layout.geometry([it('cpu', '1x1', 0, 0), it('fan1', '1x1', 0, 1)], 376, 24, () => 0).boxes[1].x,
    (376 - 72) / 4 + 24);

// layouts prontos válidos e o padrão igual ao do schema
for (const p of layout.PRESETS(s => s))
    eq(`pronto "${p.id}": todos os itens cabem`, layout.parseItems(layout.serialize(p.items)).length, p.items.length);
const schema = utils.readText(GLib.build_filenamev([ext, 'schemas', 'org.gnome.shell.extensions.nitro.gschema.xml']));
const def = schema.match(/name="grid-items"[^]*?<default>(.*?)<\/default>/)[1];
eq('padrão do schema = layout Clássico', JSON.parse(def.replace(/'/g, '"')), layout.serialize(layout.DEFAULT_ITEMS));
eq('gap padrão do schema = DEFAULT_GAP', Number(schema.match(/name="grid-gap"[^]*?<default>(\d+)</)[1]), layout.DEFAULT_GAP);
eq('barra: limpa ids e repetidos', layout.cleanPanel(['cpu', 'x', 'cpu', 'mode']), ['cpu', 'mode']);
eq('todo item tem tamanho válido', layout.ALL_IDS.every(id => layout.sizeOf(id, 'nada') !== null), true);

System.exit(failed ? 1 : 0);
