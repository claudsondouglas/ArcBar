import Gio from 'gi://Gio';
import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';

export const BLUETOOTH_OFF_ICON = 'bluetooth-disabled-symbolic';
export const BLUETOOTH_ON_ICON = 'bluetooth-active-symbolic';

/** Estado Bluetooth vindo da mesma biblioteca usada pelo GNOME Shell. */
export class BluetoothModel {
    constructor({ onChanged }) {
        this._onChanged = onChanged;
        this._client = new GnomeBluetooth.Client();
        this._devices = this._client.get_devices();
        this._cancellable = new Gio.Cancellable();
        this._trackedDevices = new Set();

        this._client.connectObject(
            'notify::default-adapter-state', () => this._changed(),
            'notify::default-adapter-powered', () => this._changed(),
            this);
        this._devices.connectObject('items-changed', () => {
            this._trackDevices();
            this._changed();
        }, this);
        this._trackDevices();
    }

    get available() {
        return this._client.default_adapter_state !== GnomeBluetooth.AdapterState.ABSENT;
    }

    get powered() {
        return this._client.default_adapter_powered;
    }

    get iconName() {
        return this.powered ? BLUETOOTH_ON_ICON : BLUETOOTH_OFF_ICON;
    }

    get devices() {
        const devices = [];
        for (let i = 0; i < this._devices.get_n_items(); i++) {
            const device = this._devices.get_item(i);
            // O submenu nativo também evita anunciar aparelhos descobertos
            // ao acaso: entram os conhecidos ou os que já estão conectados.
            if (device.paired || device.trusted || device.connected)
                devices.push(device);
        }

        return devices.sort((a, b) => {
            if (a.connected !== b.connected)
                return a.connected ? -1 : 1;
            return (a.alias ?? a.name ?? '').localeCompare(b.alias ?? b.name ?? '');
        });
    }

    toggle(device) {
        if (!device.connectable && !device.connected)
            return;

        this._client.connect_service(
            device.get_object_path(), !device.connected, this._cancellable,
            (_client, result) => {
                try {
                    this._client.connect_service_finish(result);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e, `[ArcBar] não consegui mudar a conexão Bluetooth de ${device.address}`);
                }
            });
    }

    destroy() {
        this._cancellable.cancel();
        this._devices.disconnectObject(this);
        this._client.disconnectObject(this);
        for (const device of this._trackedDevices)
            device.disconnectObject(this);
        this._trackedDevices.clear();
        this._devices = null;
        this._client = null;
        this._onChanged = null;
    }

    _changed() {
        this._onChanged?.();
    }

    _trackDevices() {
        const current = new Set();
        for (let i = 0; i < this._devices.get_n_items(); i++) {
            const device = this._devices.get_item(i);
            current.add(device);
            if (this._trackedDevices.has(device))
                continue;

            device.connectObject(
                'notify::connected', () => this._changed(),
                'notify::battery-percentage', () => this._changed(),
                'notify::battery-type', () => this._changed(),
                'notify::alias', () => this._changed(),
                this);
            this._trackedDevices.add(device);
        }

        for (const device of this._trackedDevices) {
            if (current.has(device))
                continue;
            device.disconnectObject(this);
            this._trackedDevices.delete(device);
        }
    }
}
