"""nitro-gpuapps: tabela do nvidia-smi e as travas de segurança do kill (sem matar nada de verdade)."""
import io
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr
from unittest import mock

from tests.helpers import load_script

NVIDIA_SMI = """+-----------------------------------------------------------------------------------------+
| Processes:                                                                              |
|  GPU   GI   CI              PID   Type   Process name                        GPU Memory |
|        ID   ID                                                               Usage      |
|=========================================================================================|
|    0   N/A  N/A            4203      G   /usr/bin/gnome-shell                      2MiB |
|    0   N/A  N/A           91234    C+G   ...steamapps/common/Game/game.exe       3876MiB |
+-----------------------------------------------------------------------------------------+
"""


class GpuAppsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ga = load_script('nitro-gpuapps')

    def test_vram_da_tabela(self):
        with mock.patch.object(self.ga.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, NVIDIA_SMI, '')):
            self.assertEqual(self.ga.vram(), {4203: 2, 91234: 3876})

    def test_gnome_shell_e_do_sistema(self):
        self.assertIn('gnome-shell', self.ga.SYSTEM)
        self.assertIn('Xwayland', self.ga.SYSTEM)

    def run_main(self, *args):
        with mock.patch.object(sys, 'argv', ['nitro-gpuapps', *args]), redirect_stderr(io.StringIO()) as err:
            return self.ga.main(), err.getvalue()

    def test_nao_encerra_se_o_nome_mudou(self):
        rc, err = self.run_main('kill', str(os.getpid()), 'outro-nome', 'term')
        self.assertEqual(rc, 3)
        self.assertIn('já terminou', err)

    def test_nao_encerra_processo_do_sistema(self):
        with mock.patch.object(self.ga, 'read', return_value='gnome-shell'):
            rc, err = self.run_main('kill', str(os.getpid()), 'gnome-shell', 'kill')
        self.assertEqual(rc, 4)

    def test_encerra_o_proprio(self):
        with mock.patch.object(self.ga, 'read', return_value='jogo'), mock.patch.object(self.ga.os, 'kill') as kill:
            rc, _ = self.run_main('kill', str(os.getpid()), 'jogo', 'kill')
        self.assertEqual(rc, 0)
        kill.assert_called_once_with(os.getpid(), self.ga.signal.SIGKILL)

    def test_processo_que_sumiu_no_meio(self):
        with mock.patch.object(self.ga, 'read', return_value='jogo'):
            rc, err = self.run_main('kill', '424242', 'jogo', 'term')
        self.assertEqual(rc, 3)

    def test_ppid(self):
        self.assertEqual(self.ga.ppid(str(os.getpid())), os.getppid())

    def test_uso_errado(self):
        self.assertEqual(self.run_main('kill', 'abc', 'x', 'term')[0], 2)


if __name__ == '__main__':
    unittest.main()
