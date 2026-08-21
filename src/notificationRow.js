import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createSourceIcon } from './appIcon.js';

const ICON_SIZE = 28;
const CLOSE_ICON_SIZE = 14;

// Ícone de último recurso, aqui e no indicador da barra: uma linha sem ícone
// nenhum desalinharia a coluna de texto em relação às vizinhas, e um espaço
// vazio na barra pareceria um ícone que não carregou.
export const FALLBACK_ICON = 'dialog-information-symbolic';

/**
 * Uma linha da lista de notificações: ícone do app, título, corpo, hora e o
 * "x" de dispensar.
 *
 * É um `St.Button` com outro `St.Button` dentro, como a `Message` do próprio
 * Shell: o botão de fechar consome o clique antes de ele subir para a linha,
 * então dispensar nunca abre o app por engano.
 */
export const ArcBarNotificationRow = GObject.registerClass(
class ArcBarNotificationRow extends St.Button {
    _init(notification, { onActivate, onDismiss }) {
        super._init({
            style_class: 'arcbar-notification-row',
            can_focus: true,
            x_expand: true,
        });

        this._notification = notification;

        const box = new St.BoxLayout({
            style_class: 'arcbar-notification-row-box',
            x_expand: true,
        });
        this.set_child(box);

        // Guardada porque o ícone não é atualizado, é trocado: o actor vem
        // pronto do Shell.App e não tem gicon para reatribuir.
        this._box = box;
        this._icon = null;

        // `vertical`, e não o `orientation` que o Shell 48+ passou a usar: o
        // metadata desta extensão declara o 46, onde `orientation` ainda não
        // existe em St.BoxLayout. A propriedade antiga continua lá no 50,
        // apenas marcada como obsoleta — e obsoleta em silêncio, sem aviso no
        // journal.
        const text = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(text);

        this._title = this._label('arcbar-notification-row-title');
        text.add_child(this._title);

        this._body = this._label('arcbar-notification-row-body');
        text.add_child(this._body);

        this._time = new St.Label({
            style_class: 'arcbar-notification-row-time',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._time);

        this._close = new St.Button({
            style_class: 'arcbar-notification-row-close',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: CLOSE_ICON_SIZE,
            }),
        });
        box.add_child(this._close);

        this.connect('clicked', () => onActivate(notification));
        this._close.connect('clicked', () => onDismiss(notification));

        // connectObject com a LINHA como objeto rastreado: a notificação vive
        // mais que a lista (ela é redesenhada a cada mudança), e os handlers
        // precisam morrer junto com a linha, não com ela.
        notification.connectObject(
            'notify::title', () => this._syncText(),
            'notify::body', () => this._syncText(),
            'notify::datetime', () => this._syncTime(),
            this);

        this._syncIcon();
        this._syncText();
        this._syncTime();
    }

    _label(styleClass) {
        const label = new St.Label({ style_class: styleClass, x_expand: true });
        // Uma linha só, cortada com reticências: as linhas ficam todas da mesma
        // altura e a lista continua legível de relance, que é para o que ela
        // serve — o texto inteiro está no app, a um clique daqui.
        label.clutter_text.single_line_mode = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    // O ícone é o do APP, do tema (ver src/appIcon.js) — e nunca o `gicon` da
    // notificação, que é a imagem que o app mandou junto: um avatar de quem
    // escreveu é mais específico, sim, mas também é o PNG cru embutido no
    // app, e ao lado do dock e do alt-tab, ambos com os ícones do tema, essa
    // linha era a única fora dele. O app de uma notificação também não muda,
    // então isto roda uma vez por linha.
    _syncIcon() {
        this._icon?.destroy();
        this._icon = createSourceIcon(
            this._notification.source, ICON_SIZE,
            'arcbar-notification-row-icon', FALLBACK_ICON);
        this._box.insert_child_at_index(this._icon, 0);
    }

    _syncText() {
        this._title.text = this._notification.title ?? '';

        // O corpo pode vir com marcação Pango e com quebras de linha — numa
        // linha só as quebras viram espaço, e a marcação é aplicada em vez de
        // aparecer crua. Marcação quebrada (o daemon aceita o que o app
        // mandar) cairia numa exceção que derrubaria a lista inteira.
        const body = (this._notification.body ?? '').replace(/\s+/g, ' ').trim();
        if (this._notification.useBodyMarkup) {
            try {
                this._body.clutter_text.set_markup(body);
            } catch (_) {
                this._body.text = body;
            }
        } else {
            this._body.text = body;
        }
        this._body.visible = body.length > 0;
    }

    _syncTime() {
        this._time.text = this._notification.datetime?.format('%H:%M') ?? '';
    }
});
