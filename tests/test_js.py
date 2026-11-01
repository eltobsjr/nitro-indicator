"""Roda tests/store.test.js no gjs com config/estado temporários."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


@unittest.skipUnless(shutil.which('gjs'), 'gjs não instalado')
class StoreJsTest(unittest.TestCase):
    def test_store_e_utils(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, 'XDG_CONFIG_HOME': f'{tmp}/config', 'XDG_STATE_HOME': f'{tmp}/state'}
            r = subprocess.run(['gjs', '-m', str(HERE / 'store.test.js')], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
