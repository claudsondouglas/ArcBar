import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

const ICON_SIZE = 16;

/**
 * O primeiro nome que o tema de ícones realmente tem.
 *
 * O mesmo cuidado do src/appIcon.js, pelo mesmo motivo: um `icon_name` que o
 * tema não conhece não vira um espaço vazio, vira o ponto de interrogação do
 * "image-missing" — e nomes de monitor de sistema são justamente os que
 * variam de tema para tema.
 */
function themedName(names) {
    const theme = new St.IconTheme();
    return names.find(name => theme.has_icon(name)) ?? names[names.length - 1];
}

/**
 * Uma medida da barra: o ícone e a porcentagem, nessa ordem.
 *
 * Sem legenda: o gráfico e o pente de memória já dizem qual é qual, e a
 * palavra embaixo custava uma segunda linha de texto dentro de um painel de
 * 32px. O tamanho da fonte continua em px no stylesheet, e não em em, porque
 * o `em` aqui é o do painel — que o tema do usuário decide, e uma barra que
 * muda de altura conforme o tema não é uma barra.
 */
export const ArcBarSystemStat = GObject.registerClass(
class ArcBarSystemStat extends St.BoxLayout {
    _init({ iconNames, accessibleName, onActivate }) {
        super._init({
            style_class: 'arcbar-system-stat',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: accessibleName,
        });

        this._onActivate = onActivate;

        this.add_child(new St.Icon({
            style_class: 'arcbar-system-stat-icon',
            icon_name: themedName(iconNames),
            icon_size: ICON_SIZE,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._value = new St.Label({
            style_class: 'arcbar-system-stat-value',
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._value);
    }

    vfunc_event(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            this._onActivate();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space) {
            this._onActivate();
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(event);
    }

    setPercent(value) {
        const text = `${value}%`;
        // O rótulo só é escrito quando muda: cada atribuição refaz o layout
        // do painel inteiro, e a maior parte dos tiques repete o número.
        if (this._value.text !== text)
            this._value.text = text;
    }
});
