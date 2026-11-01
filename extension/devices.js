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


// Valores normalizados de um controle: analógicos -1..1, gatilhos 0..1, direcional -1/0/1
export function padState(pad) {
    const norm = code => {
        const range = pad.axes[code];
        const v = pad.abs[code];
        if (!range || v === undefined || range[1] === range[0])
            return null;
        return (v - range[0]) / (range[1] - range[0]);
    };
    const stick = (cx, cy) => {
        const x = norm(cx), y = norm(cy);
        return x === null || y === null ? null : [x * 2 - 1, y * 2 - 1];
    };
    // xpad e cia.: direito em RX/RY e gatilhos em Z/RZ; HID genérico: direito em Z/RZ e gatilhos em BRAKE/GAS
    const xinput = '3' in pad.axes && '4' in pad.axes;
    const p = pad.pressed;
    const hatX = pad.abs[16] ?? 0, hatY = pad.abs[17] ?? 0;
    return {
        left: stick(0, 1),
        right: xinput ? stick(3, 4) : stick(2, 5),
        lt: Math.max(xinput ? norm(2) ?? 0 : norm(10) ?? 0, p.has(312) ? 1 : 0),
        rt: Math.max(xinput ? norm(5) ?? 0 : norm(9) ?? 0, p.has(313) ? 1 : 0),
        up: hatY < 0 || p.has(544), down: hatY > 0 || p.has(545), left_: hatX < 0 || p.has(546), right_: hatX > 0 || p.has(547),
    };
}
