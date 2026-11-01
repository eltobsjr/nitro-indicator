"""nitro-fancurve: validação e cálculo da curva (sem tocar nas ventoinhas)."""
import unittest

from tests.helpers import load_script


class CurveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fc = load_script('nitro-fancurve')

    def test_padrao_e_valido(self):
        self.assertEqual(len(self.fc.validate(self.fc.DEFAULT)), 5)

    def test_rejeita_curvas_invalidas(self):
        for bad in ({'points': [[50, 20]]},                       # 1 ponto
                    {'points': [[50, 20], [40, 30]]},             # temperatura caindo
                    {'points': [[50, 20], [60, 130]]},            # % fora da faixa
                    {'points': [[10, 20], [60, 30]]},             # °C fora da faixa
                    {'points': [[50, 20.5], [60, 30]]},           # não inteiro
                    {'pontos': []}, [], None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.fc.validate(bad)

    def test_interpolacao(self):
        p = self.fc.validate({'points': [[50, 20], [70, 60], [80, 100]]})
        self.assertEqual(self.fc.interpolate(p, 30), 20)   # abaixo do 1º ponto: o 1º
        self.assertEqual(self.fc.interpolate(p, 60), 40)   # meio do caminho
        self.assertEqual(self.fc.interpolate(p, 75), 80)
        self.assertEqual(self.fc.interpolate(p, 85), 100)  # acima do último: o último

    def test_acima_do_limite_de_seguranca_sempre_100(self):
        p = self.fc.validate({'points': [[50, 20], [90, 30]]})
        self.assertEqual(self.fc.interpolate(p, 91), 30)
        self.assertEqual(self.fc.interpolate(p, self.fc.PANIC_TEMP), 100)

    def test_sobe_na_hora_desce_devagar(self):
        self.assertEqual(self.fc.step(40, 80), 80)
        self.assertEqual(self.fc.step(80, 40), 80 - self.fc.DROP_PER_TICK)
        self.assertEqual(self.fc.step(42, 40), 40)


if __name__ == '__main__':
    unittest.main()
