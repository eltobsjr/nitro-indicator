UUID = nitro@eltobsjr.gmail.com
EXT  = extension
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
STATE = $(or $(XDG_STATE_HOME),$(HOME)/.local/state)/nitro

.PHONY: all install uninstall enable disable check test po kmod sdldb pack clean

all: install

# Instala extensão + helper root + polkit + predator_v4 (ver install.sh). Não recarrega o Shell.
install:
	@./install.sh

enable:
	@gnome-extensions enable $(UUID)

disable:
	@gnome-extensions disable $(UUID)

# Remove tudo o que o install.sh pôs (pede senha); ~/.config/nitro/modes.json fica
uninstall:
	@./uninstall.sh

# Traduções: extrai as strings, regera o pt_BR.po (po/translate-pt_BR.py) e confere
po:
	@xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ -o po/nitro.pot $(EXT)/*.js
	@xgettext --from-code=UTF-8 -j -o po/nitro.pot $(EXT)/schemas/*.xml
	@python3 po/translate-pt_BR.py && msgfmt --check -o /dev/null po/pt_BR.po && echo "po ok"

# Compila os módulos para o kernel atual sem instalar (confere que o código C compila)
kmod:
	@$(MAKE) -s -C system/kmod && $(MAKE) -s -C system/kmod clean >/dev/null && echo "kmod ok"

# Atualiza o banco de mapeamentos de controles da SDL (só as entradas de Linux)
sdldb:
	@curl -sfL https://raw.githubusercontent.com/mdqinc/SDL_GameControllerDB/master/gamecontrollerdb.txt | \
		{ echo "# SDL_GameControllerDB (https://github.com/mdqinc/SDL_GameControllerDB), só as entradas de Linux."; \
		  echo "# Licença zlib (a mesma do SDL). Atualizar: make sdldb"; grep "platform:Linux"; } > $(EXT)/data/gamecontrollerdb-linux.txt
	@echo "$$(grep -c platform:Linux $(EXT)/data/gamecontrollerdb-linux.txt) mapeamentos"

# Testes automáticos (sem root, sem mexer no hardware): Python dos helpers + checagem estática
test: check
	@python3 -m unittest discover -s tests -t . -q

# Checagem estática: sintaxe JS/Python/JSON, schema e o tema (todas as paletas e cores de destaque)
check:
	@d=$$(mktemp -d); for f in $$(find $(EXT) -name '*.js'); do \
		cp $$f $$d/x.mjs && node --check $$d/x.mjs || { rm -rf $$d; exit 1; }; done; rm -rf $$d
	@python3 -m py_compile scripts/eltob-setup.py && rm -rf scripts/__pycache__
	@for f in system/nitro-mode system/nitro-boost system/nitro-fancurve system/nitro-input system/nitro-gpuapps; do python3 -c "import ast,sys; ast.parse(open('$$f').read())" || exit 1; done
	@for f in system/nitro-fan system/nitro-battery system/nitro-profile install.sh uninstall.sh; do sh -n $$f 2>/dev/null || bash -n $$f || exit 1; done
	@xmllint --noout system/com.eltobsjr.nitro.policy $(EXT)/schemas/*.xml
	@msgfmt --check -o /dev/null po/pt_BR.po
	@python3 -c "import json; [json.load(open(f)) for f in ('$(EXT)/metadata.json','$(EXT)/defaults.json','scripts/options.json','scripts/palettes.json')]"
	@if [ -d $(EXT)/schemas ]; then glib-compile-schemas --strict --dry-run $(EXT)/schemas; fi
	@d=$$(mktemp -d); for p in macchiato frappe mocha; do for a in blue mauve green red; do \
		python3 scripts/eltob-setup.py render --template $(EXT)/stylesheet.tpl.css --out $$d/s.css --palette $$p --accent $$a || exit 1; \
		! grep -q '{{' $$d/s.css || { echo "token sem valor ($$p/$$a)"; exit 1; }; done; done; rm -rf $$d
	@python3 scripts/eltob-setup.py contrast
	@echo "check ok"

# Gera o .zip só da extensão, com o tema padrão (Macchiato/azul) já renderizado, schema e traduções compilados
pack:
	@d=$$(mktemp -d); cp -r $(EXT)/. $$d/; rm -f $$d/schemas/gschemas.compiled; \
		python3 scripts/eltob-setup.py render --template $$d/stylesheet.tpl.css --out $$d/stylesheet.css --title "Nitro" && rm $$d/stylesheet.tpl.css; \
		glib-compile-schemas $$d/schemas; \
		for po in po/*.po; do l=$$(basename $$po .po); mkdir -p $$d/locale/$$l/LC_MESSAGES; msgfmt -o $$d/locale/$$l/LC_MESSAGES/$(UUID).mo $$po; done; \
		rm -f $(UUID).shell-extension.zip; (cd $$d && zip -qr -FS "$(CURDIR)/$(UUID).shell-extension.zip" .); rm -rf $$d
	@echo "Pacote: $(UUID).shell-extension.zip"

clean:
	@rm -rf $(UUID).shell-extension.zip $(EXT)/stylesheet.css $(EXT)/schemas/gschemas.compiled $(EXT)/locale
	@find . -name '__pycache__' -type d -prune -exec rm -rf {} +
