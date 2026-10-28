UUID = nitro@eltobsjr.gmail.com
EXT  = extension
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
STATE = $(or $(XDG_STATE_HOME),$(HOME)/.local/state)/nitro

.PHONY: all install uninstall enable disable check pack clean

all: install

# Instala extensão + helper root + polkit + predator_v4 (ver install.sh). Não recarrega o Shell.
install:
	@./install.sh

# Checagem estática: sintaxe JS, shell e XML do polkit (não executa nada de verdade)
check:
	@d=$$(mktemp -d); cp $(EXT)/extension.js $$d/x.mjs && node --check $$d/x.mjs || { rm -rf $$d; exit 1; }; rm -rf $$d
	@sh -n system/nitro-profile && bash -n install.sh
	@python3 -c "import json; json.load(open('$(EXT)/metadata.json'))"
	@python3 -c "import xml.dom.minidom as m; m.parse('system/com.eltobsjr.nitro.policy')"
	@echo "check ok"

enable:
	@gnome-extensions enable $(UUID)

disable:
	@gnome-extensions disable $(UUID)

# Remove a extensão, o estado e os arquivos do sistema (pede senha)
uninstall:
	@rm -rf "$(DEST)" "$(STATE)"
	@sudo rm -f /usr/local/bin/nitro-profile /usr/share/polkit-1/actions/com.eltobsjr.nitro.policy /etc/modprobe.d/acer-nitro.conf
	@echo "Removido. O acer_wmi volta ao normal no próximo boot."

# Gera o .zip só da extensão (o helper/polkit é instalado pelo install.sh)
pack:
	@cd $(EXT) && zip -r -FS ../$(UUID).shell-extension.zip .
	@echo "Pacote: $(UUID).shell-extension.zip"

clean:
	@rm -f $(UUID).shell-extension.zip
