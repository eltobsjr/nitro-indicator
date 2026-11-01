// Taxa de atualização da tela do notebook: 60 Hz na bateria, a de antes na tomada.
// Pelo org.gnome.Mutter.DisplayConfig (sem root). Só mexe no monitor interno; os externos são repassados como estão.
// A configuração é aplicada como temporária (não grava no monitors.xml): no próximo login vale a sua de sempre.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS = ['org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig', 'org.gnome.Mutter.DisplayConfig'];
const METHOD_VERIFY = 0, METHOD_TEMPORARY = 1;
const LOW_HZ = 60;

// Parte pura (testada em tests/store.test.js): estado do GetCurrentState já desempacotado (recursiveUnpack)
// → {serial, builtin, current, target, logical} ou null se não há o que mudar.
// want: 'low' (o modo mais perto de 60 Hz) ou o id de um modo a restaurar.
export function planRefresh(state, want) {
    const [serial, monitors, logicals] = state;
    const builtin = monitors.find(m => m[2]['is-builtin']);
    if (!builtin)
        return null;
    const connector = builtin[0][0];
    const modes = builtin[1];
    const current = modes.find(m => m[6]['is-current']);
    if (!current)
        return null;
    const sameSize = modes.filter(m => m[1] === current[1] && m[2] === current[2]);
    let target;
    if (want === 'low') {
        target = sameSize.reduce((best, m) => (Math.abs(m[3] - LOW_HZ) < Math.abs(best[3] - LOW_HZ) ? m : best), current);
    } else {
        // o modo de antes; se sumiu (outra resolução), o de maior taxa no tamanho atual
        target = modes.find(m => m[0] === want) ?? sameSize.reduce((best, m) => (m[3] > best[3] ? m : best), current);
    }
    if (target[0] === current[0])
        return null;

    const currentMode = c => monitors.find(m => m[0][0] === c)?.[1].find(x => x[6]['is-current'])?.[0];
    const logical = logicals.map(([x, y, scale, transform, primary, mons]) =>
        [x, y, scale, transform, primary, mons.map(([c]) => [c, c === connector ? target[0] : currentMode(c), {}])]);
    return {serial, connector, current: current[0], target: target[0], hz: target[3], logical};
}

function call(method, params, cb) {
    Gio.DBus.session.call(...BUS, method, params, null, Gio.DBusCallFlags.NONE, 5000, null, (conn, res) => {
        try {
            cb(conn.call_finish(res), null);
        } catch (e) {
            cb(null, e);
        }
    });
}

// cb(erro ou null, plano aplicado ou null). verify=true só confere se o Mutter aceitaria, sem trocar nada.
export function setRefresh(want, cb, verify = false) {
    call('GetCurrentState', null, (res, err) => {
        if (err) {
            cb(err, null);
            return;
        }
        const plan = planRefresh(res.recursiveUnpack(), want);
        if (!plan) {
            cb(null, null);
            return;
        }
        const params = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
            [plan.serial, verify ? METHOD_VERIFY : METHOD_TEMPORARY, plan.logical, {}]);
        call('ApplyMonitorsConfig', params, (_r, e) => cb(e, e ? null : plan));
    });
}
