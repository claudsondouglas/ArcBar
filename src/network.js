import Gio from 'gi://Gio';
import NM from 'gi://NM';

export const WIRED_CONNECTED_ICON = 'network-wired-symbolic';
export const WIRED_ACQUIRING_ICON = 'network-wired-acquiring-symbolic';
export const WIRED_DISCONNECTED_ICON = 'network-wired-disconnected-symbolic';

// Os estados entre "preparando" e "secundárias" são a conexão em curso: o
// cabo está lá, o endereço ainda não.
const ACQUIRING_STATES = [
    NM.DeviceState.PREPARE,
    NM.DeviceState.CONFIG,
    NM.DeviceState.NEED_AUTH,
    NM.DeviceState.IP_CONFIG,
    NM.DeviceState.IP_CHECK,
    NM.DeviceState.SECONDARIES,
];

/**
 * O estado da rede cabeada, lido do NetworkManager — o mesmo serviço que o
 * indicador do próprio GNOME lê, então o ícone da barra e o das configurações
 * nunca discordam.
 *
 * Só as placas Ethernet entram na conta: Wi-Fi, VPN e túneis têm ícone
 * próprio e não é o que este botão diz. O cliente do NM é criado de forma
 * assíncrona porque a primeira conversa com o serviço passa pelo D-Bus, e
 * ela acontece dentro do enable() — travar o laço principal aí é travar a
 * sessão inteira enquanto ela abre.
 */
export class NetworkModel {
    constructor({ onChanged }) {
        this._onChanged = onChanged;
        this._client = null;
        this._clientIds = [];
        this._deviceIds = new Map();
        this._cancellable = null;

        this.iconName = WIRED_DISCONNECTED_ICON;
        this.connected = false;
    }

    enable() {
        this._cancellable = new Gio.Cancellable();
        // A forma com callback, e não a promessa: `NM.Client.new_async` pode
        // já ter sido promisificada pelo status/network.js do Shell, e o
        // embrulho do GJS devolve à função original assim que vê um callback
        // entre os argumentos. Assim funciona nos dois casos.
        NM.Client.new_async(this._cancellable, (_source, result) => {
            let client;
            try {
                client = NM.Client.new_finish(result);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, '[ArcBar] NetworkManager indisponível');
                return;
            }

            // destroy() pode ter chegado antes da resposta.
            if (!this._cancellable || this._cancellable.is_cancelled())
                return;

            this._client = client;
            this._clientIds.push(client.connect('device-added', (_c, device) => this._track(device)));
            this._clientIds.push(client.connect('device-removed', (_c, device) => this._untrack(device)));

            for (const device of client.get_devices())
                this._track(device);

            this._sync();
        });
    }

    destroy() {
        this._cancellable?.cancel();
        this._cancellable = null;

        for (const [device, id] of this._deviceIds)
            device.disconnect(id);
        this._deviceIds.clear();

        for (const id of this._clientIds)
            this._client?.disconnect(id);
        this._clientIds = [];

        // O cliente é solto, não fechado: ele é uma conexão viva com o
        // NetworkManager e derrubá-la é problema de quem a criou.
        this._client = null;
        this._onChanged = null;
    }

    _track(device) {
        if (device.get_device_type() !== NM.DeviceType.ETHERNET || this._deviceIds.has(device))
            return;

        this._deviceIds.set(device, device.connect('notify::state', () => this._sync()));
        this._sync();
    }

    _untrack(device) {
        const id = this._deviceIds.get(device);
        if (!id)
            return;

        device.disconnect(id);
        this._deviceIds.delete(device);
        this._sync();
    }

    _sync() {
        const states = [...this._deviceIds.keys()].map(device => device.get_state());
        const connected = states.includes(NM.DeviceState.ACTIVATED);
        // Uma placa conectada ganha de todas as outras: numa máquina com duas
        // portas, a que está funcionando é a resposta.
        const iconName = connected ? WIRED_CONNECTED_ICON
            : states.some(state => ACQUIRING_STATES.includes(state)) ? WIRED_ACQUIRING_ICON
            : WIRED_DISCONNECTED_ICON;

        if (iconName === this.iconName && connected === this.connected)
            return;

        this.iconName = iconName;
        this.connected = connected;
        this._onChanged?.();
    }
}
