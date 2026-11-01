// Layout do menu em grade: cada item tem linha, coluna e tamanho, escolhidos por você no laboratório das
// preferências (nada se encaixa sozinho). Sem St/Gtk: usado pelo menu, pelo laboratório e pelos testes.
//
// A grade tem 4 colunas. Há dois tipos de tamanho:
//   - ladrilho (w × h células): altura fixa, h linhas; ex. 1x1, 2x1, 2x2, 4x2
//   - bloco de largura inteira (auto): o desenho de hoje da seção (com as variantes dela); a linha dele
//     cresce com o conteúdo, como quando o acordeão de Modos abre
// Linhas só com ladrilhos têm a altura de uma célula; linhas vazias somem.

export const COLS = 4;
export const DEFAULT_GAP = 12;  // o mesmo espaço entre as seções do menu de antes

// _ é o gettext de quem chama. sizes: [chave, rótulo, w, h, auto]
const full = (key, label) => [key, label, 4, 1, true];
export const ITEMS = _ => [
    // os de hoje, com as variantes; vários ganharam tamanhos de ladrilho
    {id: 'profile', title: _('Profile'), group: 'controls', icon: 'power-profile-balanced-symbolic',
        sizes: [full('full', _('Bar with icons')), full('compact', _('Bar, names only')), ['1x1', _('Square: tap to change'), 1, 1], ['2x2', _('Four buttons'), 2, 2]]},
    {id: 'fans', title: _('Fans'), group: 'controls', icon: 'weather-windy-symbolic',
        sizes: [full('full', _('Bar with icons')), full('compact', _('Bar, names only')), ['1x1', _('Square: tap to change'), 1, 1], ['2x1', _('Three buttons'), 2, 1]]},
    {id: 'battery', title: _('Charge limit'), group: 'controls', icon: 'battery-level-80-symbolic',
        sizes: [full('full', _('Switch row')), ['1x1', _('Square button'), 1, 1], ['2x1', _('Button with health'), 2, 1]]},
    {id: 'sensors', title: _('Sensors'), group: 'readings', icon: 'temperature-symbolic',
        sizes: [full('grid', _('2 × 2 blocks')), full('row', _('One line'))]},
    {id: 'cpu', title: _('CPU temperature'), group: 'readings', icon: 'temperature-symbolic',
        sizes: [['1x1', _('Number'), 1, 1], ['2x1', _('Number and chart'), 2, 1], ['2x2', _('Large chart'), 2, 2]]},
    {id: 'gputemp', title: _('GPU temperature'), group: 'readings', icon: 'video-display-symbolic',
        sizes: [['1x1', _('Number'), 1, 1], ['2x1', _('Temperature, watts and load'), 2, 1], ['2x2', _('Large chart'), 2, 2]]},
    {id: 'fan1', title: _('Fan 1'), group: 'readings', icon: 'weather-windy-symbolic',
        sizes: [['1x1', _('Number'), 1, 1], ['2x1', _('Number and bar'), 2, 1]]},
    {id: 'fan2', title: _('Fan 2'), group: 'readings', icon: 'weather-windy-symbolic',
        sizes: [['1x1', _('Number'), 1, 1], ['2x1', _('Number and bar'), 2, 1]]},
    {id: 'batteryinfo', title: _('Battery'), group: 'readings', icon: 'battery-symbolic',
        sizes: [['1x1', _('Charge'), 1, 1], ['2x1', _('Charge, watts and time'), 2, 1]]},
    {id: 'history', title: _('Temperature history'), group: 'panels', icon: 'preferences-system-time-symbolic',
        sizes: [full('normal', _('Normal bar')), full('short', _('Short bar')), ['2x1', _('Small'), 2, 1], ['4x2', _('Large'), 4, 2]]},
    {id: 'modes', title: _('Modes'), group: 'panels', icon: 'input-gaming-symbolic',
        sizes: [full('full', _('Accordion')), ['2x1', _('Mode on'), 2, 1]]},
    {id: 'peripherals', title: _('Peripherals'), group: 'panels', icon: 'input-mouse-symbolic',
        sizes: [full('full', _('Accordion')), ['2x1', _('Icons'), 2, 1]]},
    {id: 'gpu', title: _('NVIDIA GPU'), group: 'panels', icon: 'video-display-symbolic',
        sizes: [full('full', _('Complete card')), full('compact', _('Title only'))]},
    {id: 'gpuapps', title: _('Apps using the GPU'), group: 'panels', icon: 'application-x-executable-symbolic',
        sizes: [['2x2', _('List'), 2, 2], ['4x2', _('List with Close and Force'), 4, 2]]},
    {id: 'curve', title: _('Fan curve'), group: 'panels', icon: 'weather-windy-symbolic',
        sizes: [full('full', _('Bar with chart')), ['2x2', _('Square chart'), 2, 2]]},
    {id: 'status', title: _('System status'), group: 'panels', icon: 'emblem-system-symbolic',
        sizes: [full('full', _('Line of badges')), ['2x1', _('Badges'), 2, 1]]},
    {id: 'autoprofile', title: _('Automatic profile'), group: 'controls', icon: 'battery-symbolic',
        sizes: [full('full', _('Two lines')), ['2x1', _('Compact'), 2, 1]]},
    {id: 'hz60', title: _('60 Hz screen on battery'), group: 'controls', icon: 'video-display-symbolic',
        sizes: [full('full', _('Switch row')), ['1x1', _('Square button'), 1, 1], ['2x1', _('Button with text'), 2, 1]]},
    {id: 'gamemode', title: _('Game mode through GameMode'), group: 'controls', icon: 'input-gaming-symbolic',
        sizes: [full('full', _('Switch row')), ['1x1', _('Square button'), 1, 1], ['2x1', _('Button with text'), 2, 1]]},
    {id: 'turbokey', title: _('NitroSense key'), group: 'controls', icon: 'input-keyboard-symbolic',
        sizes: [full('full', _('Switch row')), ['1x1', _('Square button'), 1, 1]]},
    {id: 'tester', title: _('Peripheral tester'), group: 'shortcuts', icon: 'input-gaming-symbolic',
        sizes: [full('full', _('Button')), ['1x1', _('Square'), 1, 1]]},
    {id: 'prefs', title: _('Preferences'), group: 'shortcuts', icon: 'preferences-system-symbolic',
        sizes: [full('full', _('Button')), ['1x1', _('Square'), 1, 1]]},
];

export const GROUPS = _ => ({readings: _('Readings'), controls: _('Controls'), panels: _('Panels'), shortcuts: _('Shortcuts')});

const CATALOG = Object.fromEntries(ITEMS(s => s).map(i => [i.id, i]));
export const ALL_IDS = Object.keys(CATALOG);

// Tamanho {key, w, h, auto} de um item; a primeira opção se a chave não existir
export function sizeOf(id, key) {
    const item = CATALOG[id];
    if (!item)
        return null;
    const s = item.sizes.find(x => x[0] === key) ?? item.sizes[0];
    return {key: s[0], w: s[2], h: s[3], auto: !!s[4]};
}

// "id:tamanho:linha:coluna" (o formato do GSettings) ⇄ {id, size, r, c}
export function parseItems(strv) {
    const out = [];
    for (const s of strv) {
        const [id, size, r, c] = s.split(':');
        const row = parseInt(r, 10), col = parseInt(c, 10);
        if (!CATALOG[id] || out.some(i => i.id === id) || !Number.isInteger(row) || !Number.isInteger(col))
            continue;
        const sz = sizeOf(id, size);
        const item = {id, size: sz.key, r: row, c: sz.auto ? 0 : col};
        if (fits(out, item))
            out.push(item);
    }
    return out;
}

export const serialize = items => items.map(i => `${i.id}:${i.size}:${i.r}:${i.c}`);

// Células ocupadas por um item
function cells(item) {
    const s = sizeOf(item.id, item.size);
    const out = [];
    for (let r = item.r; r < item.r + s.h; r++)
        for (let c = item.c; c < item.c + s.w; c++)
            out.push(`${r},${c}`);
    return out;
}

// O item cabe ali? (dentro das 4 colunas, linha ≥ 0, sem encostar em outro item que não ele mesmo)
export function fits(items, item) {
    const s = sizeOf(item.id, item.size);
    if (!s || item.r < 0 || item.c < 0 || item.c + s.w > COLS)
        return false;
    const busy = new Set(items.filter(i => i.id !== item.id).flatMap(cells));
    return cells(item).every(k => !busy.has(k));
}

// Põe (ou move) um item; devolve a lista nova, ou null se não couber
export function place(items, item) {
    if (!fits(items, item))
        return null;
    return [...items.filter(i => i.id !== item.id), item];
}

export const remove = (items, id) => items.filter(i => i.id !== id);

// Tira as linhas que nenhum item ocupa (no menu elas já somem; aqui só arruma as coordenadas)
export function compact(items) {
    const rows = items.reduce((m, i) => Math.max(m, i.r + sizeOf(i.id, i.size).h), 0);
    const used = new Array(rows).fill(false);
    for (const i of items)
        for (let r = i.r; r < i.r + sizeOf(i.id, i.size).h; r++)
            used[r] = true;
    const shift = [];
    let n = 0;
    for (let r = 0; r < rows; r++) {
        shift.push(n);
        if (!used[r])
            n++;
    }
    return items.map(i => ({...i, r: i.r - shift[i.r]}));
}

// Soltar um item num lugar, mesmo ocupado: se o lugar está livre, vai direto; se só um item está no
// caminho e cabe onde o arrastado estava, os dois trocam; senão quem está no caminho desce (e quem está
// abaixo dele também). Devolve a lista nova (sem linhas vazias) ou null se o lugar está fora da grade.
export function drop(items, item) {
    const s = sizeOf(item.id, item.size);
    if (!s || item.r < 0 || item.c < 0 || item.c + s.w > COLS)
        return null;
    const direct = place(items, item);
    if (direct)
        return compact(direct);
    const mine = new Set(cells(item));
    const others = items.filter(i => i.id !== item.id);
    const hit = others.filter(i => cells(i).some(k => mine.has(k)));
    const old = items.find(i => i.id === item.id);
    if (old && hit.length === 1) {
        const b = hit[0];
        const moved = {...b, r: old.r, c: sizeOf(b.id, b.size).auto ? 0 : old.c};
        const rest = others.filter(i => i.id !== b.id);
        if (fits([...rest, item], moved) && fits([...rest, moved], item))
            return compact([...rest, item, moved]);
    }
    const out = [item];
    for (const i of [...others].sort((a, b) => a.r - b.r || a.c - b.c)) {
        let r = i.r;
        while (!fits(out, {...i, r}) && r < 1000)
            r++;
        out.push({...i, r});
    }
    return compact(out);
}

// Troca o tamanho, mantendo o lugar; null se o tamanho novo não couber ali
export function resize(items, id, size) {
    const it = items.find(i => i.id === id);
    if (!it)
        return null;
    const sz = sizeOf(id, size);
    return place(items, {...it, size: sz.key, c: sz.auto ? 0 : it.c});
}

// Primeiro lugar livre (quando você só toca no item da gaveta, sem arrastar)
export function firstFree(items, id, size) {
    const sz = sizeOf(id, size);
    for (let r = 0; r < 200; r++) {
        for (let c = 0; c + sz.w <= COLS; c++) {
            const item = {id, size: sz.key, r, c};
            if (fits(items, item))
                return item;
            if (sz.auto)
                break;
        }
    }
    return null;
}

// Altura de cada linha usada. natural(item) = altura do bloco de largura inteira (px).
// Linhas com ladrilhos têm `cell` px; a de um bloco tem a altura dele; vazias somem (0).
export function rowHeights(items, cell, natural) {
    const rows = items.reduce((m, i) => Math.max(m, i.r + sizeOf(i.id, i.size).h), 0);
    const h = new Array(rows).fill(0);
    for (const i of items) {
        const s = sizeOf(i.id, i.size);
        if (s.auto)
            h[i.r] = Math.max(h[i.r], natural(i));
        else
            for (let r = i.r; r < i.r + s.h; r++)
                h[r] = Math.max(h[r], cell);
    }
    return h;
}

// Posição e tamanho em px de cada item: {boxes: [{id, x, y, w, h}], height, cell, tops, heights}
export function geometry(items, width, gap, natural) {
    const cell = (width - gap * (COLS - 1)) / COLS;
    const heights = rowHeights(items, cell, natural);
    const tops = [];
    let y = 0;
    for (const h of heights) {
        tops.push(y);
        y += h ? h + gap : 0;
    }
    const height = Math.max(0, y - (y ? gap : 0));
    const boxes = items.map(i => {
        const s = sizeOf(i.id, i.size);
        let h = 0;
        for (let r = i.r; r < i.r + s.h; r++)
            h += heights[r] + (r > i.r && heights[r] ? gap : 0);
        return {id: i.id, x: i.c * (cell + gap), y: tops[i.r], w: s.w * cell + (s.w - 1) * gap, h};
    });
    return {boxes, height, cell, tops, heights};
}

// Alturas aproximadas dos blocos de largura inteira (px), para o laboratório estimar o menu
export const AUTO_H = {
    'profile:full': 70, 'profile:compact': 44, 'fans:full': 58, 'fans:compact': 44, 'battery:full': 50, 'sensors:grid': 170,
    'sensors:row': 44, 'history:normal': 86, 'history:short': 56, 'modes:full': 44, 'peripherals:full': 44, 'gpu:full': 74,
    'gpu:compact': 40, 'curve:full': 90, 'status:full': 40, 'autoprofile:full': 62, 'hz60:full': 50, 'gamemode:full': 50,
    'turbokey:full': 50, 'tester:full': 34, 'prefs:full': 34,
};
export const estimate = i => AUTO_H[`${i.id}:${i.size}`] ?? 50;

// ---- layouts prontos ----
const rows = list => list.map(([id, size, r, c]) => ({id, size, r, c}));
export const PRESETS = _ => [
    {id: 'classic', title: _('Classic'), subtitle: _('The menu you are used to'), items: rows([
        ['profile', 'full', 0, 0], ['fans', 'full', 1, 0], ['battery', 'full', 2, 0], ['sensors', 'grid', 3, 0],
        ['history', 'normal', 4, 0], ['modes', 'full', 5, 0], ['peripherals', 'full', 6, 0], ['gpu', 'full', 7, 0]])},
    {id: 'compact', title: _('Compact'), subtitle: _('Classic, smaller: fits a 900 px screen'), items: rows([
        ['profile', 'compact', 0, 0], ['fans', 'compact', 1, 0], ['sensors', 'row', 2, 0], ['history', 'short', 3, 0],
        ['modes', 'full', 4, 0], ['gpu', 'compact', 5, 0], ['battery', '1x1', 6, 0], ['hz60', '1x1', 6, 1],
        ['peripherals', '2x1', 6, 2]])},
    {id: 'control', title: _('Control center'), subtitle: _('Tiles side by side, like a phone'), items: rows([
        ['profile', 'full', 0, 0], ['cpu', '1x1', 1, 0], ['gputemp', '1x1', 1, 1], ['fan1', '1x1', 1, 2], ['fan2', '1x1', 1, 3],
        ['fans', '2x1', 2, 0], ['battery', '1x1', 2, 2], ['hz60', '1x1', 2, 3], ['history', '4x2', 3, 0],
        ['modes', '2x1', 5, 0], ['peripherals', '2x1', 5, 2], ['gamemode', '1x1', 6, 0], ['turbokey', '1x1', 6, 1],
        ['tester', '1x1', 6, 2], ['prefs', '1x1', 6, 3]])},
    {id: 'gamer', title: _('Gamer'), subtitle: _('Temperatures, GPU and its apps first'), items: rows([
        ['profile', 'compact', 0, 0], ['cpu', '2x1', 1, 0], ['gputemp', '2x1', 1, 2], ['fans', '2x1', 2, 0], ['fan1', '1x1', 2, 2],
        ['fan2', '1x1', 2, 3], ['gpuapps', '4x2', 3, 0], ['modes', 'full', 5, 0], ['gamemode', '1x1', 6, 0], ['tester', '1x1', 6, 1]])},
    {id: 'minimal', title: _('Minimal'), subtitle: _('Just the essentials in two rows'), items: rows([
        ['profile', '1x1', 0, 0], ['fans', '1x1', 0, 1], ['cpu', '1x1', 0, 2], ['gputemp', '1x1', 0, 3],
        ['battery', '1x1', 1, 0], ['modes', '2x1', 1, 1], ['prefs', '1x1', 1, 3]])},
];

export const DEFAULT_ITEMS = PRESETS(s => s)[0].items;

// ---- barra superior (ordem e o que aparece) ----
export const PANEL_ITEMS = _ => [
    {id: 'icon', title: _('Profile icon'), subtitle: _('Color of the current profile'), icon: 'power-profile-performance-symbolic'},
    {id: 'cpu', title: _('CPU temperature'), subtitle: _('Turns red from 90 °C'), icon: 'temperature-symbolic'},
    {id: 'gpu', title: _('GPU temperature'), subtitle: _('Only while the GPU is awake'), icon: 'video-display-symbolic'},
    {id: 'mode', title: _('Mode on'), subtitle: _('Name of the mode that is on'), icon: 'input-gaming-symbolic'},
    {id: 'fan', title: _('Fan speed'), subtitle: _('Fastest fan, in rpm'), icon: 'weather-windy-symbolic'},
    {id: 'power', title: _('Power draw'), subtitle: _('Watts, only on battery'), icon: 'battery-symbolic'},
];
export const ALL_PANEL = PANEL_ITEMS(s => s).map(i => i.id);
export const DEFAULT_PANEL = ['icon', 'cpu'];

// Barra: só ids conhecidos e sem repetição, na ordem dada
export function cleanPanel(list) {
    const seen = new Set();
    return list.filter(id => ALL_PANEL.includes(id) && !seen.has(id) && seen.add(id));
}

// ---- layouts que você salva com nome (GSettings saved-layouts, JSON) ----
const sortKey = list => serialize([...list].sort((a, b) => a.r - b.r || a.c - b.c || (a.id < b.id ? -1 : 1))).join('|');
export const sameItems = (a, b) => sortKey(a) === sortKey(b);

// [{name, items}] válidos, sem nome vazio ou repetido (ignora maiúsculas) e sem lista vazia
export function parseSaved(json) {
    let raw;
    try {
        raw = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const l of raw) {
        const name = typeof l?.name === 'string' ? l.name.trim().slice(0, 40) : '';
        const items = Array.isArray(l?.items) ? parseItems(l.items.filter(x => typeof x === 'string')) : [];
        if (name && items.length && !out.some(o => o.name.toLowerCase() === name.toLowerCase()))
            out.push({name, items});
    }
    return out;
}
export const serializeSaved = list => JSON.stringify(list.map(l => ({name: l.name, items: serialize(l.items)})));

// Salva (ou substitui, se o nome já existe) mantendo a posição na lista
export function saveNamed(list, name, items) {
    name = name.trim().slice(0, 40);
    if (!name || !items.length)
        return list;
    const i = list.findIndex(l => l.name.toLowerCase() === name.toLowerCase());
    if (i < 0)
        return [...list, {name, items}];
    return list.map((l, j) => (j === i ? {name, items} : l));
}

// Troca o nome; a lista igual se o nome novo é vazio ou já é de outro layout
export function renameNamed(list, from, to) {
    to = to.trim().slice(0, 40);
    if (!to || list.some(l => l.name !== from && l.name.toLowerCase() === to.toLowerCase()))
        return list;
    return list.map(l => (l.name === from ? {...l, name: to} : l));
}
