import Gio from 'gi://Gio';

import { MediaPlayer } from './mprisPlayer.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

const DBUS_XML = `
<node>
  <interface name="org.freedesktop.DBus">
    <method name="ListNames">
      <arg type="as" direction="out"/>
    </method>
    <signal name="NameOwnerChanged">
      <arg type="s"/>
      <arg type="s"/>
      <arg type="s"/>
    </signal>
  </interface>
</node>`;

const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBUS_XML);

/** Descobre players MPRIS e mantém somente referências aos que podem tocar. */
export class MediaModel {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._players = new Map();
        this._proxy = null;
        this._nameOwnerChangedId = 0;
        this._destroyed = false;
    }

    enable() {
        this._proxy = new DBusProxy(
            Gio.DBus.session,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            () => this._onProxyReady());
    }

    getPlayers() {
        return [...this._players.values()]
            .filter(player => player.visible)
            .sort((a, b) => Number(b.playing) - Number(a.playing));
    }

    destroy() {
        this._destroyed = true;
        if (this._nameOwnerChangedId)
            this._proxy.disconnectSignal(this._nameOwnerChangedId);
        this._nameOwnerChangedId = 0;

        for (const player of this._players.values()) {
            player.disconnectObject(this);
            player.destroy();
        }
        this._players.clear();
        this._proxy = null;
        this._onChanged = null;
    }

    async _onProxyReady() {
        if (this._destroyed)
            return;

        try {
            const [names] = await this._proxy.ListNamesAsync();
            if (this._destroyed)
                return;

            for (const name of names) {
                if (name.startsWith(MPRIS_PREFIX))
                    this._addPlayer(name);
            }

            this._nameOwnerChangedId = this._proxy.connectSignal(
                'NameOwnerChanged', (_proxy, _sender, [name, oldOwner, newOwner]) => {
                    if (!name.startsWith(MPRIS_PREFIX))
                        return;

                    if (oldOwner)
                        this._removePlayer(name);
                    if (newOwner)
                        this._addPlayer(name);
                });
        } catch (error) {
            if (!this._destroyed)
                logError(error, '[ArcBar] failed to list MPRIS players');
        }
    }

    _addPlayer(busName) {
        if (this._destroyed || this._players.has(busName))
            return;

        const player = new MediaPlayer(busName);
        this._players.set(busName, player);
        player.connectObject('changed', () => this._onChanged?.(), this);
    }

    _removePlayer(busName) {
        const player = this._players.get(busName);
        if (!player)
            return;

        this._players.delete(busName);
        player.disconnectObject(this);
        player.destroy();
        this._onChanged?.();
    }
}
