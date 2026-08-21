import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { applyGlassMenu } from './glassMenu.js';
import { StorageModel } from './storage.js';

function size(bytes) {
    return GLib.format_size(bytes);
}

export const ArcBarStorageButton = GObject.registerClass(
class ArcBarStorageButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Uso dos discos');
        this.add_style_class_name('arcbar-storage-button');

        const indicator = new St.BoxLayout({
            style_class: 'arcbar-system-stat arcbar-storage-indicator',
            y_align: Clutter.ActorAlign.CENTER,
        });
        indicator.add_child(new St.Icon({
            style_class: 'arcbar-system-stat-icon',
            icon_name: 'drive-harddisk-symbolic',
            icon_size: 16,
        }));
        this._value = new St.Label({
            style_class: 'arcbar-system-stat-value',
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
        });
        indicator.add_child(this._value);
        this.add_child(indicator);

        this.menu.actor?.add_style_class_name('arcbar-storage-menu');
        this._summary = new St.Label({ style_class: 'arcbar-storage-summary' });
        this.menu.box.add_child(this._summary);
        this._list = new St.BoxLayout({
            style_class: 'arcbar-storage-list',
            vertical: true,
            x_expand: true,
        });
        this.menu.box.add_child(this._list);
        applyGlassMenu(this.menu);

        this._model = new StorageModel({ onChanged: () => this._sync() });
        this._model.enable();
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._model?.refresh();
        });
        this.connect('destroy', () => {
            this._model?.destroy();
            this._model = null;
        });
    }

    _sync() {
        this._value.text = `${this._model.percent}%`;
        this.accessible_name = `Discos: ${this._model.percent}% em uso`;
        this._summary.text = this._model.total
            ? `${size(this._model.used)} usados de ${size(this._model.total)}`
            : 'Armazenamento indisponível';

        this._list.destroy_all_children();
        for (const disk of this._model.filesystems) {
            const row = new St.BoxLayout({
                style_class: 'arcbar-storage-row',
                vertical: true,
                x_expand: true,
            });
            const head = new St.BoxLayout({ style_class: 'arcbar-storage-row-head', x_expand: true });
            head.add_child(new St.Label({
                style_class: 'arcbar-storage-name',
                text: disk.name,
                x_expand: true,
            }));
            head.add_child(new St.Label({
                style_class: 'arcbar-storage-percent',
                text: `${Math.round(disk.used / disk.total * 100)}%`,
            }));
            row.add_child(head);
            row.add_child(new St.Label({
                style_class: 'arcbar-storage-details',
                text: `${size(disk.used)} usados · ${size(disk.free)} livres · ${size(disk.total)} total`,
            }));
            row.add_child(new St.Label({
                style_class: 'arcbar-storage-path',
                text: disk.path,
            }));
            this._list.add_child(row);
        }
    }
});
