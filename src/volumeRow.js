import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

import { volumeIconName } from './volume.js';

// Opacidade do ícone de uma linha muda. É o ícone do app — trocá-lo pelo
// alto-falante cortado apagaria justamente a informação que a linha existe
// para dar (de QUEM é o som), então quem diz "calado" é o apagamento.
const MUTED_OPACITY = 90;

/**
 * Uma linha do menu de som: ícone, nome, porcentagem e o slider.
 *
 * A mesma linha serve para a saída do sistema e para cada app, porque as duas
 * fazem a mesma coisa com o mesmo `Gvc.MixerStream` — o que muda é só de onde
 * vem o ícone. Na saída ele é o glifo do nível (e por isso é reconstruído a
 * cada mudança de volume); num app é o ícone do próprio app, que não muda
 * enquanto ele estiver tocando.
 *
 * O ícone é um botão: clicar nele muda e desmuda, como no slider das
 * configurações rápidas do Shell.
 */
export const ArcBarVolumeRow = GObject.registerClass(
class ArcBarVolumeRow extends St.BoxLayout {
    /**
     * @param {VolumeModel} model
     * @param {object} params
     * @param {string} params.title
     * @param {Gvc.MixerStream?} [params.stream]
     * @param {Clutter.Actor?} [params.iconActor] - ausente = glifo de nível
     */
    _init(model, { title, stream = null, iconActor = null }) {
        super._init({
            style_class: 'arcbar-volume-row',
            x_expand: true,
        });

        this._model = model;
        this._stream = null;

        // Sem actor pronto a linha desenha o nível: guarda o St.Icon para
        // reescrever o nome dele a cada sync.
        this._levelIcon = iconActor ? null : new St.Icon({
            style_class: 'arcbar-volume-row-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._iconActor = iconActor ?? this._levelIcon;

        this._iconButton = new St.Button({
            style_class: 'arcbar-volume-row-icon-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._iconActor,
        });
        // Centrado na caixa fixa do botão (ver o stylesheet). Só o alinhamento:
        // `x_expand` aqui subiria pelo Clutter até o BoxLayout da linha — a
        // marca de expansão de um filho vale para o pai também —, e o botão
        // roubaria a largura que é do slider.
        this._iconButton.connect('clicked', () => this._model.toggleMute(this._stream));
        this.add_child(this._iconButton);

        // `vertical`, e não `orientation`: ver a nota em src/notificationRow.js.
        const body = new St.BoxLayout({
            style_class: 'arcbar-volume-row-body',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(body);

        const head = new St.BoxLayout({
            style_class: 'arcbar-volume-row-head',
            x_expand: true,
        });
        body.add_child(head);

        this._title = new St.Label({
            style_class: 'arcbar-volume-row-title',
            text: title,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Uma linha cortada com reticências, como as da lista de notificações:
        // um app com nome comprido não pode esticar o menu.
        this._title.clutter_text.single_line_mode = true;
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        head.add_child(this._title);

        this._percent = new St.Label({
            style_class: 'arcbar-volume-row-percent',
            y_align: Clutter.ActorAlign.CENTER,
        });
        head.add_child(this._percent);

        this._slider = new Slider(0);
        // O handler fica guardado para poder ser BLOQUEADO em _sync(): sem
        // isso, escrever o valor que veio do stream mandaria esse mesmo valor
        // de volta ao stream, e um arraste viraria um cabo de guerra entre a
        // posição do mouse e a última posição confirmada pelo PulseAudio.
        this._sliderId = this._slider.connect('notify::value',
            () => this._model.setLevel(this._stream, this._slider.value));
        body.add_child(this._slider);

        // Nenhum handler de 'destroy' aqui: os sinais do stream foram
        // conectados com connectObject tendo ESTA linha como rastreada, e o
        // rastreador do Shell já os desconecta quando ela é destruída.
        this.setStream(stream);
    }

    get stream() {
        return this._stream;
    }

    /**
     * Troca o stream desta linha. Existe por causa da saída padrão, que muda
     * quando um fone entra ou sai — a linha "Sistema" é montada uma vez e
     * segue o alto-falante da vez.
     */
    setStream(stream) {
        this._stream?.disconnectObject(this);
        this._stream = stream;

        // connectObject com a LINHA como objeto rastreado: quem destrói o
        // stream é o Gvc, não nós, e os handlers precisam morrer com a linha.
        this._stream?.connectObject(
            'notify::volume', () => this._sync(),
            'notify::is-muted', () => this._sync(),
            this);

        this._sync();
    }

    /**
     * Redesenha a linha a partir do stream. Pública porque nem tudo que a
     * muda passa por um sinal do stream: o teto do slider vem da chave de
     * volume acima de 100%, que é do GNOME e não do PulseAudio.
     */
    sync() {
        this._sync();
    }

    /** Um passo de roda do mouse, para o botão da barra delegar aqui. */
    step(nSteps) {
        return this._slider.step(nSteps);
    }

    _sync() {
        this._iconButton.reactive = this._stream !== null;

        const level = this._model.levelOf(this._stream);
        const muted = this._stream?.is_muted ?? true;

        // O teto pode mudar embaixo da linha (a chave de passar de 100%), e a
        // marca é o que dá onde encostar nos 100% num slider que vai além.
        this._slider.maximum_value = this._model.maxLevel;
        this._slider.clearMarks();
        if (this._slider.maximum_value > 1)
            this._slider.addMark(1);

        this._slider.block_signal_handler(this._sliderId);
        this._slider.value = Math.min(level, this._slider.maximum_value);
        this._slider.unblock_signal_handler(this._sliderId);

        this._percent.text = `${Math.round(level * 100)}%`;
        if (this._levelIcon)
            this._levelIcon.icon_name = volumeIconName(level);
        this._iconActor.opacity = muted ? MUTED_OPACITY : 255;
    }
});
