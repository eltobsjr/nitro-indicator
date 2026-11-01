// Partes puras dos periféricos (sem St/Shell): leitura de /proc/bus/input/devices e normalização dos controles.
// Separadas para os testes rodarem no gjs puro (tests/store.test.js).

// Texto de /proc/bus/input/devices → [{kind: 'gamepad'|'mouse'|'touchpad'|'keyboard', name, wireless}]; _ = gettext de quem chama
export function parseInputDevices(text, _) {
    const blocks = text.split(/\n\s*\n/).map(b => ({
        name: b.match(/^N: Name="(.*)"$/m)?.[1] ?? '',
        handlers: b.match(/^H: Handlers=(.*)$/m)?.[1] ?? '',
        ev: parseInt(b.match(/^B: EV=([0-9a-f]+)$/m)?.[1] ?? '0', 16),
        bus: parseInt(b.match(/^I: Bus=([0-9a-f]+)/m)?.[1] ?? '0', 16),
        phys: b.match(/^P: Phys=(.*)$/m)?.[1] ?? '',
    })).filter(b => b.name);

    const pads = blocks.filter(b => /\bjs\d+\b/.test(b.handlers));
    const touchpads = blocks.filter(b => /touchpad/i.test(b.name));
    // nome-base: "Zikway HID gamepad Keyboard" é o mesmo aparelho que "Zikway HID gamepad"
    const partOf = (b, list) => list.some(o => o !== b && b.name.startsWith(o.name.replace(/\s*(Touchpad|Mouse)$/i, '')));
    const out = [];
    const add = (kind, b) => out.push({kind, name: prettyName(b.name, _), wireless: b.bus === 0x05 || /2\.4G|wireless|receiver/i.test(b.name)});

    for (const b of pads)
        add('gamepad', b);
    for (const b of touchpads)
        add('touchpad', b);
    for (const b of blocks) {
        if (pads.includes(b) || touchpads.includes(b) || partOf(b, pads) || partOf(b, touchpads))
            continue;
        if (/\bmouse\d+\b/.test(b.handlers))
            add('mouse', b);
        // teclado de verdade: tem LED e repetição (EV_LED | EV_REP); botões avulsos (energia, vídeo) não
        else if (/\bkbd\b/.test(b.handlers) && (b.ev & 0x20000) && (b.ev & 0x100000))
            add('keyboard', b);
    }
    return out;
}

// "PIXA3848:00 093A:3848 Touchpad" → "Touchpad (PIXA3848)"; "AT Translated Set 2 keyboard" → teclado do notebook
function prettyName(name, _) {
    if (/^AT Translated Set 2 keyboard$/i.test(name))
        return _('Laptop keyboard');
    const m = name.match(/^([A-Z0-9]+):\d+ [0-9A-F]{4}:[0-9A-F]{4} (.+)$/i);
    if (m)
        return `${m[2]} (${m[1]})`;
    return name.replace(/\s+(Mouse|Keyboard)$/i, '');
}


// ---- controles: mapeamento da SDL (SDL_GameControllerDB) com o do kernel como reserva ----

const hex16 = n => (n & 0xff).toString(16).padStart(2, '0') + ((n >> 8) & 0xff).toString(16).padStart(2, '0');

// GUID da SDL para Linux: barramento, vendor, product e versão em little-endian, intercalados com zeros
export function sdlGuid([bus, vendor, product, version]) {
    return `${hex16(bus)}0000${hex16(vendor)}0000${hex16(product)}0000${hex16(version)}0000`;
}

// Linha do banco para este controle: GUID exato, senão o mesmo sem a versão. null quando não há.
export function findSdlMapping(dbText, ids) {
    if (!ids)
        return null;
    const guid = sdlGuid(ids);
    const noVersion = `${guid.slice(0, 24)}00000000`;
    let fallback = null;
    for (const line of dbText.split('\n')) {
        if (line.startsWith(guid))
            return parseSdlLine(line);
        if (!fallback && line.startsWith(noVersion))
            fallback = line;
    }
    return fallback ? parseSdlLine(fallback) : null;
}

export function parseSdlLine(line) {
    const [guid, name, ...rest] = line.split(',');
    const map = {};
    for (const part of rest) {
        const i = part.indexOf(':');
        if (i > 0 && part.slice(0, i) !== 'platform')
            map[part.slice(0, i)] = part.slice(i + 1);
    }
    return {guid, name, map};
}

const BTN_JOYSTICK = 0x120, ABS_HAT0X = 0x10, ABS_HAT3Y = 0x17;

// Como a SDL numera as entradas no Linux: botões de BTN_JOYSTICK em diante e depois os de antes;
// eixos em ordem sem os direcionais (hats), que viram hats em pares
function sdlIndexes(pad) {
    const codes = [...pad.buttons].sort((x, y) => x - y);
    const buttons = [...codes.filter(c => c >= BTN_JOYSTICK), ...codes.filter(c => c < BTN_JOYSTICK)];
    const absCodes = Object.keys(pad.axes).map(Number).sort((x, y) => x - y);
    const axes = absCodes.filter(c => c < ABS_HAT0X || c > ABS_HAT3Y);
    const hats = [];
    for (let h = ABS_HAT0X; h <= ABS_HAT3Y; h += 2) {
        if (absCodes.includes(h) || absCodes.includes(h + 1))
            hats.push([h, h + 1]);
    }
    return {buttons, axes, hats};
}

// Valores normalizados de um controle: analógicos -1..1, gatilhos 0..1, botões por nome (a, b, x, y, lb…).
// Com um mapeamento da SDL os nomes saem dele; sem, do jeito do kernel (BTN_SOUTH = A embaixo etc.).
export function padState(pad, sdl = null) {
    const norm = code => {
        const range = pad.axes[code];
        const v = pad.abs[code];
        if (!range || v === undefined || range[1] === range[0])
            return null;
        return (v - range[0]) / (range[1] - range[0]);
    };
    const stickOf = (x, y) => (x === null || y === null ? null : [x * 2 - 1, y * 2 - 1]);
    const p = pad.pressed;
    if (sdl)
        return sdlState(pad, sdl, norm, stickOf);

    // xpad e cia.: direito em RX/RY e gatilhos em Z/RZ; HID genérico: direito em Z/RZ e gatilhos em BRAKE/GAS
    const xinput = '3' in pad.axes && '4' in pad.axes;
    const hatX = pad.abs[16] ?? 0, hatY = pad.abs[17] ?? 0;
    return {
        source: 'kernel',
        left: stickOf(norm(0), norm(1)),
        right: xinput ? stickOf(norm(3), norm(4)) : stickOf(norm(2), norm(5)),
        lt: Math.max(xinput ? norm(2) ?? 0 : norm(10) ?? 0, p.has(312) ? 1 : 0),
        rt: Math.max(xinput ? norm(5) ?? 0 : norm(9) ?? 0, p.has(313) ? 1 : 0),
        up: hatY < 0 || p.has(544), down: hatY > 0 || p.has(545), left_: hatX < 0 || p.has(546), right_: hatX > 0 || p.has(547),
        btn: {
            a: p.has(304), b: p.has(305), y: p.has(307), x: p.has(308), lb: p.has(310), rb: p.has(311),
            back: p.has(314), start: p.has(315), guide: p.has(316), l3: p.has(317), r3: p.has(318),
        },
    };
}

function sdlState(pad, sdl, norm, stickOf) {
    const idx = sdlIndexes(pad);
    // valor de uma entrada da SDL ("b3", "a2", "+a2", "-a2", "a2~", "h0.4") como 0..1 (ou -1..1 para eixo inteiro)
    const read = spec => {
        if (!spec)
            return null;
        const m = spec.match(/^([+-]?)([abh])(\d+)(?:\.(\d+))?(~?)$/);
        if (!m)
            return null;
        const [, half, kind, n, mask, invert] = m;
        if (kind === 'b') {
            const code = idx.buttons[+n];
            return code === undefined ? null : pad.pressed.has(code) ? 1 : 0;
        }
        if (kind === 'h') {
            const hat = idx.hats[+n];
            if (!hat)
                return null;
            const hx = pad.abs[hat[0]] ?? 0, hy = pad.abs[hat[1]] ?? 0;
            const bit = +mask;
            return (bit === 1 && hy < 0) || (bit === 4 && hy > 0) || (bit === 8 && hx < 0) || (bit === 2 && hx > 0) ? 1 : 0;
        }
        const code = idx.axes[+n];
        let v = code === undefined ? null : norm(code);
        if (v === null)
            return null;
        v = v * 2 - 1;
        if (invert)
            v = -v;
        if (half === '+')
            return Math.max(0, v);
        if (half === '-')
            return Math.max(0, -v);
        return v;
    };
    const m = sdl.map;
    const on = k => (read(m[k]) ?? 0) > 0.5;
    // gatilho como eixo inteiro (-1..1 em repouso -1) vira 0..1; como botão ou meio eixo já vem 0..1
    const trigger = k => {
        const v = read(m[k]);
        if (v === null)
            return 0;
        return m[k].startsWith('a') ? (v + 1) / 2 : v;
    };
    const axis = k => {
        const v = read(m[k]);
        return v === null ? null : (v + 1) / 2;
    };
    return {
        source: 'sdl',
        name: sdl.name,
        left: stickOf(axis('leftx'), axis('lefty')),
        right: stickOf(axis('rightx'), axis('righty')),
        lt: trigger('lefttrigger'), rt: trigger('righttrigger'),
        up: on('dpup'), down: on('dpdown'), left_: on('dpleft'), right_: on('dpright'),
        btn: {
            a: on('a'), b: on('b'), x: on('x'), y: on('y'), lb: on('leftshoulder'), rb: on('rightshoulder'),
            back: on('back'), start: on('start'), guide: on('guide'), l3: on('leftstick'), r3: on('rightstick'),
        },
    };
}
