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

const USAGE_BAR_WIDTH = 340;

function percentOf(used, total) {
    if (!total)
        return 0;

    return Math.max(0, Math.min(100, Math.round(used / total * 100)));
}

function usageLevel(percent) {
    if (percent >= 90)
        return 'critical';
    if (percent >= 75)
        return 'warning';
    return 'normal';
}

function createUsageBar(percent) {
    const track = new St.BoxLayout({
        style_class: 'arcbar-storage-bar',
        width: USAGE_BAR_WIDTH,
    });
    track.add_child(new St.Widget({
        style_class: `arcbar-storage-bar-fill ${usageLevel(percent)}`,
        width: Math.round(USAGE_BAR_WIDTH * percent / 100),
    }));
    return track;
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
        this._summary = new St.BoxLayout({
            style_class: 'arcbar-storage-summary',
            vertical: true,
            x_expand: true,
        });
        this._summaryTitle = new St.Label({ style_class: 'arcbar-storage-summary-title' });
        this._summaryDetails = new St.Label({ style_class: 'arcbar-storage-summary-details' });
        this._summary.add_child(this._summaryTitle);
        this._summary.add_child(this._summaryDetails);
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
        if (this._model.total) {
            this._summaryTitle.text = `${size(this._model.used)} usados`;
            this._summaryDetails.text =
                `${size(this._model.total - this._model.used)} livres de ${size(this._model.total)}`;
        } else {
            this._summaryTitle.text = 'Armazenamento indisponível';
            this._summaryDetails.text = 'Não foi possível ler os discos';
        }

        this._list.destroy_all_children();
        for (const disk of this._model.filesystems) {
            const percent = percentOf(disk.used, disk.total);
            const row = new St.BoxLayout({
                style_class: `arcbar-storage-row ${usageLevel(percent)}`,
                vertical: true,
                x_expand: true,
            });
            const head = new St.BoxLayout({ style_class: 'arcbar-storage-row-head', x_expand: true });
            head.add_child(new St.Icon({
                style_class: 'arcbar-storage-disk-icon',
                icon_name: disk.path === '/'
                    ? 'drive-harddisk-symbolic'
                    : 'drive-removable-media-symbolic',
                icon_size: 16,
            }));
            head.add_child(new St.Label({
                style_class: 'arcbar-storage-name',
                text: disk.name,
                x_expand: true,
            }));
            head.add_child(new St.Label({
                style_class: 'arcbar-storage-percent',
                text: `${percent}% usado`,
            }));
            row.add_child(head);
            row.add_child(createUsageBar(percent));
            row.add_child(new St.Label({
                style_class: 'arcbar-storage-details',
                text: `${size(disk.used)} usados  ·  ${size(disk.free)} livres`,
            }));
            row.add_child(new St.Label({
                style_class: 'arcbar-storage-path',
                text: disk.path,
            }));
            this._list.add_child(row);
        }
    }
});
