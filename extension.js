import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ArcBarClock } from './src/clock.js';
import { ArcBarNetworkButton } from './src/networkButton.js';
import { ArcBarNotificationButton } from './src/notificationButton.js';
import { ArcBarPowerButton } from './src/powerButton.js';
import { ArcBarSystemMonitor } from './src/systemMonitor.js';
import { ArcBarVolumeButton } from './src/volumeButton.js';
import { PanelTakeover } from './src/panelTakeover.js';
import { PanelTransparency } from './src/panelTransparency.js';

const POWER_ROLE = 'arcbar-power';
const NETWORK_ROLE = 'arcbar-network';
const VOLUME_ROLE = 'arcbar-volume';
const NOTIFICATIONS_ROLE = 'arcbar-notifications';

export default class ArcBarExtension extends Extension {
    // ArcBar reuses GNOME's panel actor instead of building a separate chrome
    // bar: struts, overview layout and fullscreen keep working for free, and
    // everything undone in disable() is a hide/show, never a destroy.
    enable() {
        log('[ArcBar] enable() entry');
        try {
            this._takeover = new PanelTakeover();
            this._takeover.apply();

            this._system = new ArcBarSystemMonitor();
            this._system._arcbar = true;
            Main.panel._leftBox.insert_child_at_index(this._system, 0);

            this._destroyStatusButton(NOTIFICATIONS_ROLE);
            this._notifications = new ArcBarNotificationButton();
            Main.panel.addToStatusArea(NOTIFICATIONS_ROLE, this._notifications, 0, 'center');
            this._notifications.container._arcbar = true;

            // O canto direito, da esquerda para a direita: rede, som e
            // energia. O índice de addToStatusArea() é o de
            // insert_child_at_index(), ou seja, contado da esquerda — e os
            // filhos que a tomada do painel escondeu continuam na box, mas
            // invisíveis não ocupam lugar.
            this._destroyStatusButton(NETWORK_ROLE);
            this._network = new ArcBarNetworkButton();
            Main.panel.addToStatusArea(NETWORK_ROLE, this._network, 0, 'right');
            this._network.container._arcbar = true;

            this._destroyStatusButton(VOLUME_ROLE);
            this._volume = new ArcBarVolumeButton();
            Main.panel.addToStatusArea(VOLUME_ROLE, this._volume, 1, 'right');
            this._volume.container._arcbar = true;

            this._destroyStatusButton(POWER_ROLE);
            this._power = new ArcBarPowerButton();
            Main.panel.addToStatusArea(POWER_ROLE, this._power, 2, 'right');
            this._power.container._arcbar = true;

            // O relógio fecha a esquerda da caixa da direita, antes da rede.
            // Ele entra DEPOIS dos três botões porque addToStatusArea() conta
            // o índice na box inteira: inserido antes, o primeiro botão a
            // pedir o índice 0 passaria na frente dele.
            this._clock = new ArcBarClock();
            this._clock._arcbar = true;
            Main.panel._rightBox.insert_child_at_index(this._clock, 0);

            Main.panel.add_style_class_name('arcbar-panel');

            this._transparency = new PanelTransparency();
            this._transparency.enable();

            // GNOME re-shows its own indicators whenever the session mode
            // changes, and another extension may drop a button in the panel at
            // any time, so the takeover has to be reasserted.
            this._sessionModeId = Main.sessionMode.connect('updated', () => this._takeover?.apply());
            this._extensionStateId = Main.extensionManager.connect('extension-state-changed',
                () => this._takeover?.apply());
        } catch (e) {
            logError(e, '[ArcBar] enable() failed');
        }
        log('[ArcBar] enable() exit');
    }

    disable() {
        log('[ArcBar] disable() entry');
        try {
            if (this._sessionModeId) {
                Main.sessionMode.disconnect(this._sessionModeId);
                this._sessionModeId = 0;
            }

            if (this._extensionStateId) {
                Main.extensionManager.disconnect(this._extensionStateId);
                this._extensionStateId = 0;
            }

            this._transparency?.disable();
            this._transparency = null;

            Main.panel.remove_style_class_name('arcbar-panel');

            this._clock?.destroy();
            this._clock = null;

            this._system?.destroy();
            this._system = null;

            this._notifications = null;
            this._destroyStatusButton(NOTIFICATIONS_ROLE);
            this._power = null;
            this._destroyStatusButton(POWER_ROLE);
            this._volume = null;
            this._destroyStatusButton(VOLUME_ROLE);
            this._network = null;
            this._destroyStatusButton(NETWORK_ROLE);

            this._takeover?.restore();
            this._takeover = null;
        } catch (e) {
            logError(e, '[ArcBar] disable() failed');
        }
        log('[ArcBar] disable() exit');
    }

    // also clears a button left behind by a previous enable() that failed
    // half-way, which would otherwise make addToStatusArea() throw
    _destroyStatusButton(role) {
        const existing = Main.panel.statusArea[role];
        if (existing)
            existing.destroy();
    }
}
