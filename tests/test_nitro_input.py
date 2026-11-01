"""nitro-input: reconhece os controles em /proc/bus/input/devices (fixture real do ANV15-51)."""
import unittest

from tests.helpers import ROOT, load_script


class InputTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ni = load_script('nitro-input')
        cls.text = (ROOT / 'tests' / 'fixtures' / 'input-devices.txt').read_text()

    def test_so_o_controle_vira_gamepad(self):
        self.assertEqual(self.ni.gamepads(self.text), {'event23': ('Zikway HID gamepad', 'usb')})

    def test_sem_controle(self):
        self.assertEqual(self.ni.gamepads('I: Bus=0011\nN: Name="Teclado"\nH: Handlers=kbd event3\n'), {})

    def test_ioctl(self):
        # EVIOCGABS(0) = _IOR('E', 0x40, input_absinfo de 24 bytes)
        self.assertEqual(self.ni.ioc_read(0x40, 24), 0x80184540)


if __name__ == '__main__':
    unittest.main()
