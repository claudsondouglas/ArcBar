import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import { NetworkModel } from './network.js';

// O .desktop da página de rede do Settings: pedir o painel por ele é o que o
// próprio GNOME faz, e assim a janela abre já na página certa e sob o mesmo
// app da barra de tarefas em vez de um processo solto.
const SETTINGS_DESKTOP_ID = 'gnome-network-panel.desktop';

/**
 * O ícone de rede cabeada, à esquerda do de som. Não tem menu: o clique abre
 * as Configurações na parte de redes.
 */
export const ArcBarNetworkButton = GObject.registerClass(
class ArcBarNetworkButton extends PanelMenu.Button {
    _init() {
        // O terceiro argumento é `dontCreateMenu`: sem ele o PanelMenu.Button
        // monta um PopupMenu que este botão nunca abriria.
        super._init(0.5, 'ArcBar Network', true);

        this.add_style_class_name('arcbar-network-button');
        this._model = new NetworkModel({ onChanged: () => this._sync() });

        this._icon = new St.Icon({
            icon_name: this._model.iconName,
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this.connect('destroy', () => this._onDestroy());
        // O primeiro estado só chega quando o NetworkManager responder; até
        // lá o ícone é o de desconectado, que é o que o modelo assume.
        this._model.enable();
        this._sync();
    }

    _sync() {
        this._icon.icon_name = this._model.iconName;
        this.accessible_name = this._model.connected ? 'Rede cabeada conectada' : 'Rede cabeada desconectada';
    }

    // O clique não pode subir para o PanelMenu.Button: lá ele abriria (ou
    // tentaria abrir) o menu.
    vfunc_event(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            this._openSettings();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space) {
            this._openSettings();
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(event);
    }

    _openSettings() {
        // A janela nasceria atrás do overview, que continua aberto por cima
        // dela.
        Main.overview.hide();

        const app = Shell.AppSystem.get_default().lookup_app(SETTINGS_DESKTOP_ID);
        if (app) {
            app.activate();
            return;
        }

        // Sem o .desktop da página (Settings de outra área de trabalho, ou
        // nenhum instalado) ainda dá para pedir a página pelo argumento.
        try {
            Util.spawn(['gnome-control-center', 'network']);
        } catch (e) {
            logError(e, '[ArcBar] não consegui abrir as configurações de rede');
        }
    }

    _onDestroy() {
        this._model?.destroy();
        this._model = null;
    }
});
