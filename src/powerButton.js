import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import { applyGlassMenu } from './glassMenu.js';

// null = separator. Actions are routed through the shell's own SystemActions
// so confirmation dialogs, inhibitors and lockdown settings behave exactly
// like they do in the stock quick settings menu.
const ITEMS = [
    { id: 'power-off', label: 'Desligar', icon: 'system-shutdown-symbolic', canProperty: 'can-power-off' },
    { id: 'restart', label: 'Reiniciar', icon: 'system-reboot-symbolic', canProperty: 'can-restart' },
    { id: 'suspend', label: 'Suspender', icon: 'media-playback-pause-symbolic', canProperty: 'can-suspend' },
    null,
    { id: 'logout', label: 'Reiniciar sessão', icon: 'system-log-out-symbolic', canProperty: 'can-logout' },
];

/** The right-hand power button and its menu. */
export const ArcBarPowerButton = GObject.registerClass(
class ArcBarPowerButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'ArcBar Power');

        this.add_style_class_name('arcbar-power-button');
        this.add_child(new St.Icon({
            icon_name: 'system-shutdown-symbolic',
            style_class: 'system-status-icon',
        }));

        this.menu.actor?.add_style_class_name('arcbar-power-menu');
        this.menu.actor?.add_style_class_name('arcbar-action-menu');

        this._systemActions = SystemActions.getDefault();
        for (const item of ITEMS)
            this.menu.addMenuItem(item ? this._buildItem(item) : new PopupMenu.PopupSeparatorMenuItem());

        applyGlassMenu(this.menu);
    }

    _buildItem({ id, label, icon, canProperty }) {
        const item = new PopupMenu.PopupImageMenuItem(label, icon);
        item.connect('activate', () => this._systemActions.activateAction(id));
        // an unavailable action (lockdown, no logind seat, …) hides itself
        this._systemActions.bind_property(canProperty, item, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
        return item;
    }
});
