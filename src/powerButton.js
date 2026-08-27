import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import { applyGlassMenu } from './glassMenu.js';

// null = separator. Actions are routed through the shell's own SystemActions
// so confirmation dialogs, inhibitors and lockdown settings behave exactly
// like they do in the stock quick settings menu.
const ITEMS = [
    { id: 'lock-screen', label: 'Bloquear tela', icon: 'system-lock-screen-symbolic', canProperty: 'can-lock-screen' },
    { id: 'switch-user', label: 'Trocar usuário', icon: 'system-switch-user-symbolic', canProperty: 'can-switch-user' },
    { id: 'logout', label: 'Encerrar sessão', icon: 'system-log-out-symbolic', canProperty: 'can-logout' },
    null,
    { id: 'suspend', label: 'Suspender', icon: 'media-playback-pause-symbolic', canProperty: 'can-suspend' },
    { id: 'restart', label: 'Reiniciar', icon: 'system-reboot-symbolic', canProperty: 'can-restart' },
    { id: 'power-off', label: 'Desligar', icon: 'system-shutdown-symbolic', canProperty: 'can-power-off', destructive: true },
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
        this.menu.addMenuItem(this._buildIdentity());
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const item of ITEMS)
            this.menu.addMenuItem(item ? this._buildItem(item) : new PopupMenu.PopupSeparatorMenuItem());

        applyGlassMenu(this.menu);
    }

    _buildIdentity() {
        const username = GLib.get_user_name();
        const realName = GLib.get_real_name();
        const displayName = realName && realName !== 'Unknown' ? realName : username;
        const hostname = GLib.get_host_name();

        const avatarPath = `/var/lib/AccountsService/icons/${username}`;
        const avatarFile = Gio.File.new_for_path(avatarPath);
        const avatar = avatarFile.query_exists(null)
            ? new St.Icon({ gicon: new Gio.FileIcon({ file: avatarFile }), icon_size: 42, style_class: 'arcbar-power-avatar' })
            : new St.Icon({ icon_name: 'avatar-default-symbolic', icon_size: 42, style_class: 'arcbar-power-avatar' });

        const labels = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'arcbar-power-identity-labels',
        });
        labels.add_child(new St.Label({ text: displayName, style_class: 'arcbar-power-user-name' }));
        labels.add_child(new St.Label({
            text: `${username} · ${hostname}`,
            style_class: 'arcbar-power-device-name',
        }));

        const row = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'arcbar-power-identity',
        });
        row.add_child(avatar);
        row.add_child(labels);
        return row;
    }

    _buildItem({ id, label, icon, canProperty, destructive = false }) {
        const item = new PopupMenu.PopupImageMenuItem(label, icon);
        if (destructive)
            item.add_style_class_name('arcbar-power-destructive');
        item.connect('activate', () => this._systemActions.activateAction(id));
        // an unavailable action (lockdown, no logind seat, …) hides itself
        this._systemActions.bind_property(canProperty, item, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
        return item;
    }
});
