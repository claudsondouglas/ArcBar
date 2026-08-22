import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { VolumeModel, volumeIconName } from './volume.js';
import { ArcBarVolumeRow } from './volumeRow.js';
import { appForStream, createStreamIcon } from './appIcon.js';
import { applyGlassMenu } from './glassMenu.js';

const APP_ICON_SIZE = 24;

/**
 * O botão de som, à esquerda do de energia: o ícone do nível na barra, e um
 * menu com o volume do sistema em cima e um slider por app tocando embaixo.
 *
 * A roda do mouse sobre o botão mexe no volume do sistema sem abrir nada —
 * é o gesto que o indicador do próprio GNOME atende, e a barra que o
 * substituiu não podia perdê-lo.
 */
export const ArcBarVolumeButton = GObject.registerClass(
class ArcBarVolumeButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'ArcBar Volume');

        this.add_style_class_name('arcbar-volume-button');
        this._icon = new St.Icon({
            icon_name: volumeIconName(0),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this.menu.actor?.add_style_class_name('arcbar-volume-menu');

        this._rebuildId = 0;
        this._model = new VolumeModel({
            onOutputChanged: () => this._syncOutput(),
            onStreamsChanged: () => this._queueRebuild(),
            onDevicesChanged: () => this._queueDeviceRebuild(),
        });

        this._buildMenu();
        applyGlassMenu(this.menu);

        this._model.enable();

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            // A lista de apps só é montada na abertura, como a de
            // notificações: com o menu fechado ninguém vê essas linhas, e um
            // app que abre e fecha streams (um navegador trocando de aba de
            // vídeo, por exemplo) reconstruiria sliders à toa.
            if (isOpen) {
                this._rebuildDevices();
                this._rebuildApps();
            }
        });

        this.connect('destroy', () => this._onDestroy());
        this._syncOutput();
    }

    _buildMenu() {
        this._master = new ArcBarVolumeRow(this._model, { title: 'Sistema' });
        this.menu.box.add_child(this._master);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._outputMenu = new PopupMenu.PopupSubMenuMenuItem('Saída', true);
        this._outputMenu.icon.icon_name = 'audio-speakers-symbolic';
        this.menu.addMenuItem(this._outputMenu);

        this._inputMenu = new PopupMenu.PopupSubMenuMenuItem('Microfone', true);
        this._inputMenu.icon.icon_name = 'audio-input-microphone-symbolic';
        this.menu.addMenuItem(this._inputMenu);

        this._appsSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._appsSeparator);

        this._appsTitle = new St.Label({
            style_class: 'arcbar-volume-section-title',
            text: 'Aplicativos',
        });
        this.menu.box.add_child(this._appsTitle);

        // `vertical` e não `orientation`: ver a nota em src/notificationRow.js.
        this._appList = new St.BoxLayout({
            style_class: 'arcbar-volume-list',
            vertical: true,
            x_expand: true,
        });
        this.menu.box.add_child(this._appList);

        this._appsSeparator.visible = false;
        this._appsTitle.visible = false;
        this._appList.visible = false;
    }

    _queueDeviceRebuild() {
        if (!this.menu.isOpen)
            return;
        this._rebuildDevices();
    }

    _rebuildDevices() {
        this._fillDeviceMenu(this._outputMenu, this._model.getOutputs(),
            this._model.output, stream => this._model.selectOutput(stream),
            'audio-speakers-symbolic');
        this._fillDeviceMenu(this._inputMenu, this._model.getInputs(),
            this._model.input, stream => this._model.selectInput(stream),
            'audio-input-microphone-symbolic');
    }

    _fillDeviceMenu(submenu, streams, active, select, iconName) {
        submenu.menu.removeAll();
        for (const stream of streams) {
            const item = new PopupMenu.PopupImageMenuItem(
                this._model.deviceName(stream), iconName);
            item.setOrnament(stream === active
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE);
            item.connect('activate', () => select(stream));
            submenu.menu.addMenuItem(item);
        }
        submenu.visible = streams.length > 0;
    }

    // Adiada para o ocioso pelo mesmo motivo da lista de notificações: um app
    // que começa a tocar abre mais de um stream em sequência, e no ocioso a
    // rajada vira uma reconstrução só.
    _queueRebuild() {
        if (this._rebuildId || !this.menu.isOpen)
            return;

        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            this._rebuildApps();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildApps() {
        this._appList.destroy_all_children();

        const streams = this._model.getApplicationStreams();
        for (const stream of streams) {
            this._appList.add_child(new ArcBarVolumeRow(this._model, {
                stream,
                // O nome do app instalado quando ele foi encontrado: o
                // PulseAudio manda o que o app se chamou ao abrir o stream, que
                // às vezes é o binário ("chromium-browser") em vez do nome que
                // o resto da área de trabalho mostra.
                title: appForStream(stream)?.get_name() ?? stream.get_name() ??
                    stream.get_description() ?? 'Aplicativo',
                iconActor: createStreamIcon(stream, APP_ICON_SIZE,
                    'arcbar-volume-row-icon'),
            }));
        }

        const hasApps = streams.length > 0;
        this._appsSeparator.visible = hasApps;
        this._appsTitle.visible = hasApps;
        this._appList.visible = hasApps;
    }

    _syncOutput() {
        const output = this._model.output;
        // A ligação só é refeita quando a saída TROCA: este callback também
        // chega a cada mudança de volume, e desconectar e reconectar dois
        // sinais a cada passo da roda seria à toa. Nos outros casos basta
        // redesenhar — é o que pega o que não vem do stream, como o teto da
        // chave de volume acima de 100%.
        if (this._master.stream === output)
            this._master.sync();
        else
            this._master.setStream(output);

        // Sem saída não há o que controlar — o botão sai da barra em vez de
        // abrir um menu com um slider morto.
        this.container.visible = output !== null;
        if (!output) {
            this.menu.close();
            return;
        }

        this._icon.icon_name = volumeIconName(this._model.levelOf(output));
    }

    vfunc_scroll_event(event) {
        // O evento emulado é o que o toque na tela gera ao arrastar; atendê-lo
        // faria o volume andar junto com a rolagem de qualquer coisa.
        if (event.get_flags() & Clutter.EventFlags.FLAG_POINTER_EMULATED)
            return Clutter.EVENT_PROPAGATE;

        const direction = event.get_scroll_direction();
        let nSteps = 0;
        if (direction === Clutter.ScrollDirection.DOWN) {
            nSteps = -1;
        } else if (direction === Clutter.ScrollDirection.UP) {
            nSteps = 1;
        } else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            nSteps = -dy;
            // Acompanha a direção física da rolagem invertida.
            if (event.get_scroll_flags() & Clutter.ScrollFlags.INVERTED)
                nSteps *= -1;
        }

        // O passo vai pelo slider do menu: ele já é o dono do tamanho do passo
        // e do teto, e assim a rolagem e o arraste nunca discordam.
        const changed = this._master.step(nSteps);
        // Com o menu aberto o próprio slider já mostra o que aconteceu; o OSD
        // por cima dele seria a mesma informação duas vezes.
        if (changed && !this.menu.isOpen)
            this._showOSD();

        return Clutter.EVENT_STOP;
    }

    _showOSD() {
        const level = this._model.levelOf(this._model.output);
        Main.osdWindowManager.showAll(
            new Gio.ThemedIcon({ name: volumeIconName(level) }),
            null, level, this._model.maxLevel);
    }

    _onDestroy() {
        if (this._rebuildId) {
            GLib.Source.remove(this._rebuildId);
            this._rebuildId = 0;
        }

        this._model?.destroy();
        this._model = null;
    }
});
