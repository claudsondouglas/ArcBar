import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { createAppIcon } from './appIcon.js';

const ICON_SIZE = 16;

/**
 * O ícone de um app que está rodando sem janela. Clicar traz o app de volta.
 *
 * É o mesmo tamanho e o mesmo tipo de alvo do ArcBarSystemStat, o vizinho da
 * esquerda — mas com realce no hover, que as medidas não têm: CPU e memória
 * dizem o que fazem só por estarem escritas, enquanto um ícone solto na barra
 * precisa dizer que é um botão.
 */
export const ArcBarBackgroundAppIcon = GObject.registerClass(
class ArcBarBackgroundAppIcon extends St.BoxLayout {
    _init(app, onActivate) {
        super._init({
            style_class: 'arcbar-background-app',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: `${app.get_name()} — em segundo plano, clique para abrir`,
        });

        this._app = app;
        this._onActivate = onActivate;

        this.add_child(createAppIcon(app, ICON_SIZE, 'arcbar-background-app-icon'));
    }

    vfunc_event(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            this._onActivate(this._app);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space) {
            this._onActivate(this._app);
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(event);
    }
});
