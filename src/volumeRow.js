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
// Espelha o border-radius de `.arcbar-volume-control` em local.css. O
// BarLevel do Shell usa sempre metade da altura e não expõe esse raio no CSS.
const CONTROL_RADIUS = 11;

function roundedRect(cr, x, y, width, height, radius) {
    const right = x + width;
    const bottom = y + height;
    const tau = Math.PI * 2;

    cr.newSubPath();
    cr.arc(right - radius, y + radius, radius, -tau / 4, 0);
    cr.arc(right - radius, bottom - radius, radius, 0, tau / 4);
    cr.arc(x + radius, bottom - radius, radius, tau / 4, tau / 2);
    cr.arc(x + radius, y + radius, radius, tau / 2, tau * 3 / 4);
    cr.closePath();
}

const ArcBarSlider = GObject.registerClass(
class ArcBarSlider extends Slider {
    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const radius = Math.min(CONTROL_RADIUS, width / 2, height / 2);
        const rtl = this.get_text_direction() === Clutter.TextDirection.RTL;
        const progress = this._maxValue > 0 ? this._value / this._maxValue : 0;
        const endX = width * (rtl ? 1 - progress : progress);

        roundedRect(cr, 0, 0, width, height, radius);
        cr.setSourceColor(this._barLevelColor);
        cr.fill();

        if (this._value > 0) {
            cr.save();
            if (rtl)
                cr.rectangle(endX, 0, width - endX, height);
            else
                cr.rectangle(0, 0, endX, height);
            cr.clip();
            roundedRect(cr, 0, 0, width, height, radius);
            cr.setSourceColor(this._barLevelActiveColor);
            cr.fill();
            cr.restore();
        }

        if (this._value > this._overdriveStart) {
            const overdriveX = width * this._overdriveStart / this._maxValue;
            cr.save();
            if (rtl)
                cr.rectangle(0, 0, width - overdriveX, height);
            else
                cr.rectangle(overdriveX, 0, width - overdriveX, height);
            cr.clip();
            roundedRect(cr, 0, 0, width, height, radius);
            cr.setSourceColor(this._barLevelOverdriveColor);
            cr.fill();
            cr.restore();
        }

        cr.$dispose();
    }
});

/**
 * Uma linha do menu de som: ícone, nome, porcentagem e o slider.
 *
 * A mesma linha serve para a saída do sistema e para cada app, porque as duas
 * fazem a mesma coisa com o mesmo `Gvc.MixerStream` — o que muda é só de onde
 * vem o ícone. Na saída ele é o glifo do nível (e por isso é reconstruído a
 * cada mudança de volume); num app é o ícone do próprio app, que não muda
 * enquanto ele estiver tocando.
 *
 * O ícone flutua sobre o começo do slider e não recebe eventos: toda a
 * cápsula, inclusive a área sob o glifo, continua sendo o controle.
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

        this._iconOverlay = new St.Bin({
            style_class: 'arcbar-volume-row-icon-overlay',
            reactive: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._iconActor,
        });

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

        this._slider = new ArcBarSlider(0);
        this._slider.x_expand = true;
        // O handler fica guardado para poder ser BLOQUEADO em _sync(): sem
        // isso, escrever o valor que veio do stream mandaria esse mesmo valor
        // de volta ao stream, e um arraste viraria um cabo de guerra entre a
        // posição do mouse e a última posição confirmada pelo PulseAudio.
        this._sliderId = this._slider.connect('notify::value',
            () => this._model.setLevel(this._stream, this._slider.value));

        // BinLayout sobrepõe os filhos: o slider ocupa a cápsula inteira e
        // o ícone, adicionado por último, apenas flutua sobre o seu início.
        const control = new St.Widget({
            style_class: 'arcbar-volume-control',
            x_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        const iconLayer = new St.BoxLayout({
            reactive: false,
            x_expand: true,
            y_expand: true,
        });
        iconLayer.add_child(this._iconOverlay);
        control.add_child(this._slider);
        control.add_child(iconLayer);
        body.add_child(control);

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
        this._slider.reactive = this._stream !== null;

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
