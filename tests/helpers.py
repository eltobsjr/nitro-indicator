"""Carrega os scripts de system/ (sem extensão .py) como módulos, com HOME isolado."""
import importlib.machinery
import importlib.util
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_script(name, home=None):
    if home:
        os.environ['HOME'] = str(home)
    os.environ['NITRO_DEFAULTS'] = str(ROOT / 'extension' / 'defaults.json')
    loader = importlib.machinery.SourceFileLoader(name.replace('-', '_'), str(ROOT / 'system' / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod
