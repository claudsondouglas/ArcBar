import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { NotificationsModel } from './notifications.js';
import { ArcBarNotificationRow, FALLBACK_ICON } from './notificationRow.js';
import { createSourceIcon } from './appIcon.js';
import { applyGlassMenu } from './glassMenu.js';

// Quantos ícones de app cabem na barra antes de a fileira virar sopa de
// letrinhas. O número ao lado continua sendo o total, então nada some da
// contagem quando o quarto app notifica.
const MAX_INDICATOR_ICONS = 3;
const INDICATOR_ICON_SIZE = 16;

/**
 * O indicador de notificações do meio da barra: os ícones dos apps que
 * notificaram, o total ao lado, e um menu de vidro com uma linha por
 * notificação.
 */
export const ArcBarNotificationButton = GObject.registerClass(
class ArcBarNotificationButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'ArcBar Notifications');

        this.add_style_class_name('arcbar-notification-button');
        this.menu.actor?.add_style_class_name('arcbar-notification-menu');

        this._buildIndicator();
        this._buildMenu();

        applyGlassMenu(this.menu);

        this._updateId = 0;
        this._model = new NotificationsModel(() => this._queueUpdate());
        this._model.enable();

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                return;
            // A lista só é montada na abertura: enquanto o menu está fechado
            // nada dela é visível, e uma notificação por segundo (uma cópia de
            // arquivos, por exemplo) reconstruiria linhas que ninguém vê.
            this._rebuildList();
            this._model.acknowledgeAll();
        });

        this.connect('destroy', () => this._onDestroy());
        this._update();
    }

    _buildIndicator() {
        const box = new St.BoxLayout({
            style_class: 'arcbar-notification-indicator',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(box);

        this._icons = new St.BoxLayout({
            style_class: 'arcbar-notification-icons',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._icons);

        this._count = new St.Label({
            style_class: 'arcbar-notification-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._count);
    }

    _buildMenu() {
        const header = new St.BoxLayout({
            style_class: 'arcbar-notification-header',
            x_expand: true,
        });

        header.add_child(new St.Label({
            style_class: 'arcbar-notification-header-title',
            text: 'Notificações',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._clearButton = new St.Button({
            style_class: 'arcbar-notification-clear',
            label: 'Limpar tudo',
            can_focus: true,
        });
        this._clearButton.connect('clicked', () => this._model.clear());
        header.add_child(this._clearButton);

        // `vertical` e não `orientation`: ver a nota em src/notificationRow.js.
        this._list = new St.BoxLayout({
            style_class: 'arcbar-notification-list',
            vertical: true,
            x_expand: true,
        });

        // overlay_scrollbars: a barra flutua sobre a última coluna de pixels em
        // vez de roubar largura das linhas, como na lista do ArcTab. A altura
        // máxima está no `max-height` do stylesheet — é lá que ela precisa
        // estar para acompanhar o padding do vidro.
        this._scroll = new St.ScrollView({
            style_class: 'arcbar-notification-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            child: this._list,
        });

        this._emptyLabel = new St.Label({
            style_class: 'arcbar-notification-empty',
            text: 'Sem notificações',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        // Direto na box do menu, e não como PopupMenuItem: as linhas são
        // botões próprios (ícone, dois rótulos e o "x"), e embrulhá-las num
        // item de menu só traria o realce e o padding do tema por cima do
        // nosso.
        this.menu.box.add_child(header);
        this.menu.box.add_child(this._scroll);
        this.menu.box.add_child(this._emptyLabel);
    }

    // A reconstrução é adiada para o ocioso por dois motivos: dispensar uma
    // linha destrói o botão que está no meio da emissão do próprio 'clicked',
    // e "Limpar tudo" dispara uma mudança por notificação — no ocioso as duas
    // coisas viram uma única reconstrução, depois que o clique terminou.
    _queueUpdate() {
        if (this._updateId)
            return;

        this._updateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._updateId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _update() {
        const count = this._model.count;

        this._icons.destroy_all_children();
        // Mesmo ícone da linha do menu, pelo mesmo caminho (src/appIcon.js):
        // os dois mostram o mesmo app e não poderiam mostrá-lo de dois jeitos.
        for (const source of this._model.getActiveSources().slice(0, MAX_INDICATOR_ICONS)) {
            this._icons.add_child(createSourceIcon(
                source, INDICATOR_ICON_SIZE,
                'arcbar-notification-app-icon', FALLBACK_ICON));
        }

        this._count.text = `${count}`;

        // Sem notificação nenhuma o botão inteiro sai da barra: o que sobraria
        // é um espaço clicável para uma lista vazia. Quem esconde é o
        // `container` e não o botão — é ele que o painel aloca, e um botão
        // invisível dentro de um container visível continuaria ocupando o
        // lugar dele no meio da barra. O menu é fechado junto: dispensar a
        // última linha some com o botão embaixo do menu ainda aberto.
        this.container.visible = count > 0;
        if (count === 0)
            this.menu.close();

        if (this.menu.isOpen)
            this._rebuildList();
    }

    _rebuildList() {
        this._list.destroy_all_children();

        const notifications = this._model.getNotifications();
        for (const notification of notifications) {
            this._list.add_child(new ArcBarNotificationRow(notification, {
                onActivate: n => this._activate(n),
                onDismiss: n => this._model.dismiss(n),
            }));
        }

        this._scroll.visible = notifications.length > 0;
        this._emptyLabel.visible = notifications.length === 0;
        this._clearButton.visible = notifications.length > 0;
    }

    _activate(notification) {
        // Fecha antes de ativar: `activate()` leva o foco para a janela do app,
        // e um menu ainda aberto por cima dela ficaria com o grab de teclado.
        this.menu.close();
        notification.activate();
    }

    _onDestroy() {
        if (this._updateId) {
            GLib.Source.remove(this._updateId);
            this._updateId = 0;
        }

        this._model?.destroy();
        this._model = null;
    }
});
