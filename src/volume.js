import Gio from 'gi://Gio';
import Gvc from 'gi://Gvc';

import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';

// A chave que o próprio Shell lê para deixar o volume passar de 100%. Se ela
// vale aqui outra coisa que nas configurações rápidas, o mesmo alto-falante
// teria dois tetos diferentes na mesma tela.
const ALLOW_AMPLIFIED_KEY = 'allow-volume-above-100-percent';

// Tirar do mudo um stream que está em zero devolve um quarto do volume — o
// mesmo que o Shell faz, e pela mesma razão: sem isso o clique no ícone
// desmuta e continua sem sair som, o que se lê como botão quebrado.
const UNMUTE_LEVEL = 0.25;

// Do mudo ao superamplificado, na ordem em que o nível cresce.
const LEVEL_ICONS = [
    'audio-volume-muted-symbolic',
    'audio-volume-low-symbolic',
    'audio-volume-medium-symbolic',
    'audio-volume-high-symbolic',
    'audio-volume-overamplified-symbolic',
];

/**
 * O ícone de um nível (0 = mudo, 1 = 100%). Mora aqui, e não no botão, porque
 * a barra e a linha "Sistema" do menu mostram o MESMO alto-falante — duas
 * cópias desta conta virariam dois ícones que discordam do mesmo volume.
 *
 * @param {number} level
 * @returns {string}
 */
export function volumeIconName(level) {
    if (!(level > 0))
        return LEVEL_ICONS[0];

    return LEVEL_ICONS[Math.clamp(Math.ceil(3 * level), 1, LEVEL_ICONS.length - 1)];
}

/**
 * O mixer: a saída padrão e um stream por app que está tocando algo.
 *
 * Como o `NotificationsModel`, este não guarda cópia de nada — toda leitura
 * volta a perguntar ao `Gvc.MixerControl`. É o que impede esta lista de
 * discordar do pavucontrol, do OSD e das configurações rápidas do Shell: o
 * controle é o MESMO objeto que o Shell usa (`getMixerControl()` devolve o
 * singleton dele), então mexer num slider daqui é mexer no que o Shell mostra.
 *
 * Por ser emprestado, o controle nunca é fechado no `destroy()`: fechá-lo
 * derrubaria a conexão do Shell inteiro com o PulseAudio junto com a extensão.
 */
export class VolumeModel {
    /**
     * @param {object} handlers
     * @param {Function} handlers.onOutputChanged - saída trocada, ou o volume/mudo dela
     * @param {Function} handlers.onStreamsChanged - entrou ou saiu um app da lista
     * @param {Function} handlers.onDevicesChanged - mudou a lista/seleção de dispositivos
     */
    constructor({ onOutputChanged, onStreamsChanged, onDevicesChanged }) {
        this._onOutputChanged = onOutputChanged;
        this._onStreamsChanged = onStreamsChanged;
        this._onDevicesChanged = onDevicesChanged;

        this._control = getMixerControl();
        this._output = null;
        this._controlIds = [];
        this._outputIds = [];
        this._settings = null;
        this._settingsId = 0;
        // Os ids que a lista de apps mostra hoje. O sinal 'stream-removed' só
        // traz o id de um stream que já morreu — sem esta lembrança não dá
        // para saber se o que saiu era um app ou o "pop" de uma notificação.
        this._appIds = new Set();
    }

    enable() {
        this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.sound' });
        // Mudou o teto, mudou o significado de cada posição do slider.
        this._settingsId = this._settings.connect(`changed::${ALLOW_AMPLIFIED_KEY}`,
            () => this._onOutputChanged());

        this._controlIds = [
            this._control.connect('state-changed', () => this._readOutput()),
            this._control.connect('default-sink-changed', () => this._readOutput()),
            this._control.connect('default-source-changed', () => this._onDevicesChanged()),
            this._control.connect('stream-added', (_c, id) => this._onStreamAdded(id)),
            this._control.connect('stream-removed', (_c, id) => this._onStreamRemoved(id)),
        ];

        this._readOutput();
    }

    destroy() {
        for (const id of this._controlIds)
            this._control.disconnect(id);
        this._controlIds = [];

        this._setOutput(null, false);

        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        this._settings = null;
        this._appIds.clear();
    }

    /** A saída padrão, ou null enquanto o PulseAudio não respondeu. */
    get output() {
        return this._output;
    }

    /** 1, ou a razão amplificada quando a chave do GNOME permite passar de 100%. */
    get maxLevel() {
        if (!this._settings?.get_boolean(ALLOW_AMPLIFIED_KEY))
            return 1;

        return this._control.get_vol_max_amplified() / this._control.get_vol_max_norm();
    }

    /**
     * Um stream por app tocando som, em ordem de id — a ordem de chegada, que
     * é estável: ordenar por nome faria as linhas trocarem de lugar embaixo do
     * ponteiro quando um app renomeia o próprio stream.
     *
     * @returns {Gvc.MixerStream[]}
     */
    getApplicationStreams() {
        const streams = this._control.get_sink_inputs()
            .filter(stream => this._isAppStream(stream))
            .sort((a, b) => a.get_id() - b.get_id());

        this._appIds = new Set(streams.map(stream => stream.get_id()));
        return streams;
    }

    getOutputs() {
        return this._control.get_sinks()
            .filter(stream => !stream.is_virtual)
            .sort((a, b) => this._deviceName(a).localeCompare(this._deviceName(b)));
    }

    getInputs() {
        return this._control.get_sources()
            .filter(stream => !stream.is_virtual &&
                !stream.get_name()?.endsWith('.monitor'))
            .sort((a, b) => this._deviceName(a).localeCompare(this._deviceName(b)));
    }

    get input() {
        return this._control.get_default_source();
    }

    deviceName(stream) {
        return this._deviceName(stream);
    }

    selectOutput(stream) {
        if (stream)
            this._control.set_default_sink(stream);
    }

    selectInput(stream) {
        if (stream)
            this._control.set_default_source(stream);
    }

    /** 0 quando mudo, senão a fração do volume nominal (1 = 100%). */
    levelOf(stream) {
        if (!stream)
            return 0;

        return stream.is_muted ? 0 : stream.volume / this._control.get_vol_max_norm();
    }

    /**
     * Move um stream para o nível pedido. É a rotina do slider do Shell, e não
     * um `set_volume()` cru: encostar no zero MUDA o stream (senão o app
     * continuaria tocando um fio de som inaudível, e o ícone diria que há
     * volume), e sair do zero desmuda.
     */
    setLevel(stream, level) {
        if (!stream)
            return;

        const volume = level * this._control.get_vol_max_norm();
        const wasMuted = stream.is_muted;

        let changed;
        if (volume < 1) {
            changed = stream.set_volume(0);
            if (!wasMuted)
                stream.change_is_muted(true);
        } else {
            changed = stream.set_volume(volume);
            if (wasMuted)
                stream.change_is_muted(false);
        }

        // push_volume() é o que manda o valor para o servidor: sem ele o objeto
        // muda e o som não. `set_volume()` devolve false quando o número já era
        // esse, e aí não há o que mandar.
        if (changed)
            stream.push_volume();
    }

    toggleMute(stream) {
        if (!stream)
            return;

        const { is_muted: muted } = stream;
        if (muted && stream.volume === 0) {
            stream.volume = UNMUTE_LEVEL * this._control.get_vol_max_norm();
            stream.push_volume();
        }
        stream.change_is_muted(!muted);
    }

    // Só o que um app manda para a saída conta: o "pop" de uma notificação é um
    // stream de evento (nasce e morre em meio segundo, e uma linha piscando na
    // lista seria pior que inútil), e um stream virtual é encanamento de
    // gravador ou monitor, não app nenhum.
    _isAppStream(stream) {
        return stream instanceof Gvc.MixerSinkInput &&
            !stream.is_event_stream && !stream.is_virtual;
    }

    _onStreamAdded(id) {
        this._onDevicesChanged();
        if (!this._isAppStream(this._control.lookup_stream_id(id)))
            return;

        this._appIds.add(id);
        this._onStreamsChanged();
    }

    _onStreamRemoved(id) {
        this._onDevicesChanged();
        if (this._appIds.delete(id))
            this._onStreamsChanged();
    }

    _deviceName(stream) {
        return stream?.get_description?.() ?? stream?.get_name?.() ?? 'Dispositivo';
    }

    _readOutput() {
        const ready = this._control.get_state() === Gvc.MixerControlState.READY;
        this._setOutput(ready ? this._control.get_default_sink() : null);
        this._onDevicesChanged();
    }

    _setOutput(stream, notify = true) {
        for (const id of this._outputIds)
            this._output.disconnect(id);
        this._outputIds = [];

        this._output = stream;

        if (stream) {
            this._outputIds = [
                stream.connect('notify::volume', () => this._onOutputChanged()),
                stream.connect('notify::is-muted', () => this._onOutputChanged()),
            ];
        }

        if (notify)
            this._onOutputChanged();
    }
}
