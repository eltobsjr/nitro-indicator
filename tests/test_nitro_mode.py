"""nitro-mode: liga/desliga modos e restaura o estado anterior. Nada de pkexec de verdade: run() é simulado."""
import json
import os
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT, load_script


class NitroModeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self._home = os.environ.get('HOME')
        self.nm = load_script('nitro-mode', self.home)
        self.calls = []
        self.fail_on = set()
        self.profile = 'balanced'
        self.ac = True

        def run(*cmd):
            self.calls.append(cmd)
            if cmd[0] == 'tuned-adm' and cmd[1] == 'active':
                return True, 'Current active profile: balanced'
            if cmd[-1] == 'status':
                return True, 'auto'
            name = os.path.basename(cmd[1]) if cmd[0] == 'pkexec' else cmd[0]
            if name in self.fail_on:
                return False, 'falhou de propósito'
            if name.endswith('nitro-profile'):
                self.profile = cmd[-1]
            return True, ''

        real_read = self.nm.read
        self.nm.run = run
        self.nm.read = lambda p: self.profile if p == self.nm.PROFILE_FILE else real_read(p)
        self.nm.on_ac = lambda: self.ac
        os.makedirs(self.nm.STATE_DIR, exist_ok=True)

    def tearDown(self):
        if self._home is not None:
            os.environ['HOME'] = self._home
        self.tmp.cleanup()

    def actions(self):
        """Só as mudanças (sem as leituras de estado)."""
        out = []
        for c in self.calls:
            if c[0] == 'pkexec' and c[-1] != 'status':
                out.append((os.path.basename(c[1]), *c[2:]))
            elif c[0] == 'tuned-adm' and c[1] == 'profile':
                out.append(('tuned', c[2]))
        return out

    def write_modes(self, modes):
        cfg = self.home / '.config' / 'nitro' / 'modes.json'
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text(json.dumps({'modes': modes}))

    # ---- leitura ----

    def test_defaults_vem_do_json(self):
        d = json.loads((ROOT / 'extension' / 'defaults.json').read_text())
        self.assertEqual(self.nm.FIELDS, d['fields'])
        self.assertEqual([m['id'] for m in self.nm.BUILTIN], ['gamer', 'silencio'])
        self.assertTrue(self.nm.BUILTIN[0]['auto_gamemode'])
        self.assertEqual(self.nm.BUILTIN[1]['profile'], 'quiet')

    def test_sem_config_usa_os_de_fabrica(self):
        self.assertEqual([m['id'] for m in self.nm.load_modes()], ['gamer', 'silencio'])

    def test_config_quebrada_usa_os_de_fabrica(self):
        cfg = self.home / '.config' / 'nitro' / 'modes.json'
        cfg.parent.mkdir(parents=True)
        cfg.write_text('{nada disso é json')
        self.assertEqual([m['id'] for m in self.nm.load_modes()], ['gamer', 'silencio'])

    def test_ids_invalidos_sao_ignorados_e_campos_completados(self):
        self.write_modes([{'id': 'Com Espaço'}, {'id': 'ok-1', 'fan': 'curve'}])
        modes = self.nm.load_modes()
        self.assertEqual([m['id'] for m in modes], ['ok-1'])
        self.assertEqual(modes[0]['fan'], 'curve')
        self.assertEqual(modes[0]['profile'], 'balanced-performance')  # veio dos campos padrão
        self.assertEqual(modes[0]['name'], 'ok-1')

    # ---- ligar/desligar ----

    def test_liga_gamer(self):
        self.assertEqual(self.nm.turn_on('gamer'), 0)
        self.assertEqual(self.actions(), [
            ('tuned', self.nm.TUNED_PERF),
            ('nitro-profile', 'balanced-performance'),
            ('nitro-fan', 'max'),
            ('nitro-boost', 'boost'),
        ])
        st = self.nm.active_state()
        self.assertEqual(st['mode'], 'gamer')
        self.assertEqual(st['prev'], {'profile': 'balanced', 'tuned': 'balanced', 'fan': 'auto'})

    def test_desliga_restaura_o_anterior(self):
        self.nm.turn_on('gamer')
        self.calls.clear()
        self.assertEqual(self.nm.turn_off(), 0)
        self.assertEqual(self.actions(), [
            ('nitro-boost', 'off'),
            ('nitro-fan', 'auto'),
            ('tuned', 'balanced'),
            ('nitro-profile', 'balanced'),
        ])
        self.assertIsNone(self.nm.active_state())

    def test_trocar_de_modo_desfaz_o_anterior_primeiro(self):
        self.nm.turn_on('gamer')
        self.calls.clear()
        self.nm.turn_on('silencio')
        acts = self.actions()
        self.assertEqual(acts[0], ('nitro-boost', 'off'))  # desfaz o gamer
        self.assertIn(('nitro-profile', 'quiet'), acts)
        self.assertEqual(self.nm.active_state()['mode'], 'silencio')

    def test_so_na_tomada_e_ignorado_na_bateria(self):
        self.ac = False
        self.assertEqual(self.nm.turn_on('gamer'), 0)
        self.assertEqual(self.actions(), [])
        self.assertIsNone(self.nm.active_state())

    def test_modo_com_curva_liga_o_servico(self):
        self.write_modes([{'id': 'curva', 'fan': 'curve', 'gpu_offset': None, 'cpu_performance': False, 'profile': None}])
        self.nm.turn_on('curva')
        self.assertEqual(self.actions(), [('nitro-fan', 'curve', 'on')])

    def test_restaura_curva_que_estava_ligada(self):
        self.nm.turn_on('gamer')
        st = json.loads(Path(self.nm.ACTIVE).read_text())
        st['prev']['fan'] = 'curve'
        Path(self.nm.ACTIVE).write_text(json.dumps(st))
        self.calls.clear()
        self.nm.turn_off()
        self.assertIn(('nitro-fan', 'curve', 'on'), self.actions())

    def test_falha_num_passo_nao_impede_os_outros(self):
        self.fail_on = {'nitro-boost'}
        self.assertEqual(self.nm.turn_on('gamer'), 1)
        self.assertIn(('nitro-fan', 'max'), self.actions())
        self.assertEqual(self.nm.active_state()['mode'], 'gamer')

    def test_estado_de_outro_boot_nao_vale(self):
        Path(self.nm.ACTIVE).write_text(json.dumps({'mode': 'gamer', 'boot': 'boot-antigo', 'prev': {}}))
        self.assertIsNone(self.nm.active_state())
        self.assertFalse(Path(self.nm.ACTIVE).exists())

    def test_modo_desconhecido(self):
        self.assertEqual(self.nm.turn_on('nao-existe'), 2)


if __name__ == '__main__':
    unittest.main()
