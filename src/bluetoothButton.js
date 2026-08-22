import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import { BluetoothModel } from './bluetooth.js';
import { applyGlassMenu } from './glassMenu.js';

const SETTINGS_DESKTOP_ID = 'gnome-bluetooth-panel.desktop';

const BluetoothDeviceItem = GObject.registerClass(
class BluetoothDeviceItem extends PopupMenu.PopupBaseMenuItem {
    constructor(device, activate) {
        super({ style_class: 'arcbar-bluetooth-device' });

        this.add_child(new St.Icon({
            icon_name: device.icon || 'bluetooth-symbolic',
            style_class: 'arcbar-bluetooth-device-icon',
        }));
        this.add_child(new St.Label({
            text: device.alias ?? device.name ?? device.address,
            style_class: 'arcbar-bluetooth-device-name',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));

        if (device.battery_type !== 0) {
            this.add_child(new St.Label({
                text: `${device.battery_percentage}%`,
                style_class: 'arcbar-bluetooth-device-battery',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            this.add_child(new St.Icon({
                icon_name: 'battery-symbolic',
                style_class: 'arcbar-bluetooth-battery-icon',
            }));
        }

        this.add_child(new St.Icon({
            icon_name: device.connected ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic',
            style_class: 'arcbar-bluetooth-state-icon',
        }));
        this.setSensitive(device.connected || device.connectable);
        this.connect('activate', activate);
    }
});

export const ArcBarBluetoothButton = GObject.registerClass(
class ArcBarBluetoothButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'ArcBar Bluetooth');

        this.add_style_class_name('arcbar-bluetooth-button');
        this._icon = new St.Icon({ style_class: 'system-status-icon' });
        this.add_child(this._icon);
        this.menu.actor?.add_style_class_name('arcbar-bluetooth-menu');

        this._model = new BluetoothModel({ onChanged: () => this._sync() });
        this.connect('destroy', () => this._onDestroy());

        applyGlassMenu(this.menu);
        this._sync();
    }

    _sync() {
        this.container.visible = this._model.available;
        this._icon.icon_name = this._model.iconName;
        const connected = this._model.devices.filter(device => device.connected).length;
        this.accessible_name = connected > 0
            ? `Bluetooth, ${connected} conectado${connected === 1 ? '' : 's'}`
            : `Bluetooth ${this._model.powered ? 'ligado' : 'desligado'}`;

        if (!this._model.available) {
            this.menu.close();
            return;
        }

        // Mantém o conteúdo pronto antes da abertura. Esvaziar o menu no
        // `open-state-changed` fazia o actor passar por uma alocação de largura
        // zero enquanto o BlurEffect já estava pintando; o Cogl então tentava
        // criar uma textura 0xN e emitia `width >= 1` a cada clique.
        if (!this.menu.isOpen)
            this._rebuild();
    }

    _rebuild() {
        this.menu.removeAll();

        const title = new PopupMenu.PopupSwitchMenuItem('Bluetooth', this._model.powered, {
            style_class: 'arcbar-bluetooth-title',
        });
        title.insert_child_at_index(new St.Icon({
            icon_name: this._model.iconName,
            style_class: 'arcbar-bluetooth-title-icon',
        }), 0);
        title.connect('toggled', (_item, state) => this._model.setPowered(state));
        this.menu.addMenuItem(title);

        const devices = this._model.devices;
        for (const device of devices)
            this.menu.addMenuItem(new BluetoothDeviceItem(device, () => this._model.toggle(device)));

        if (devices.length === 0) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                this._model.powered ? 'Nenhum dispositivo pareado' : 'Bluetooth desligado',
                { reactive: false, style_class: 'arcbar-bluetooth-empty' }));
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settings = new PopupMenu.PopupImageMenuItem(
            'Configurações de Bluetooth', 'emblem-system-symbolic', {
                style_class: 'arcbar-bluetooth-settings',
            });
        settings.connect('activate', () => this._openSettings());
        this.menu.addMenuItem(settings);
    }

    _openSettings() {
        Main.overview.hide();
        const app = Shell.AppSystem.get_default().lookup_app(SETTINGS_DESKTOP_ID);
        if (app)
            app.activate();
        else
            Util.spawn(['gnome-control-center', 'bluetooth']);
    }

    _onDestroy() {
        this._model?.destroy();
        this._model = null;
    }
});
