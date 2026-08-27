import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createAppIcon } from './appIcon.js';

// Sem constante para a capa: o tamanho dela é o `width`/`height` de
// `.arcbar-media-cover`, porque quem desenha a arte agora é o fundo do
// bin. O glifo do estado vazio continua aqui — é um ícone, e o `icon-size`
// de um St.Icon é propriedade, não caixa.
const PLACEHOLDER_ICON_SIZE = 28;
const BADGE_ICON_SIZE = 16;
const CONTROL_ICON_SIZE = 16;
// Play/pause é o botão que se procura sem olhar, então ele se destaca pelo
// tamanho: dois ícones iguais e um maior no meio se leem de relance, enquanto
// um terceiro fundo colorido entre eles só acrescentaria mais uma forma.
const PLAY_PAUSE_ICON_SIZE = 20;

export function createPlayerIcon(player, size, styleClass) {
    if (player.app)
        return createAppIcon(player.app, size, styleClass);

    return new St.Icon({
        style_class: styleClass,
        icon_name: 'audio-x-generic-symbolic',
        icon_size: size,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/** Cartão de mídia da central: capa, metadados e os três controles MPRIS. */
export const ArcBarMediaPlayer = GObject.registerClass(
class ArcBarMediaPlayer extends St.Button {
    _init(player, { onActivate }) {
        super._init({
            style_class: 'arcbar-media-player',
            can_focus: true,
            x_expand: true,
        });

        this._player = player;

        const box = new St.BoxLayout({
            style_class: 'arcbar-media-player-box',
            x_expand: true,
        });
        this.set_child(box);

        // A capa e o selo do app se sobrepõem, então o grupo é um BinLayout —
        // e não tem tamanho próprio no JS: quem dita a caixa é a capa, o maior
        // dos dois filhos, com as medidas que o CSS lhe der.
        this._coverGroup = new St.Widget({
            style_class: 'arcbar-media-cover-group',
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
            // Explícito, e não por omissão: o expand do selo é herdado por
            // quem o contém quando o contêiner não decide sozinho, e o grupo
            // passaria a disputar com `.arcbar-media-text` a folga da linha —
            // a capa ganharia uma margem que ninguém pediu. Declarado aqui, a
            // sobra que o selo usa morre dentro do grupo.
            x_expand: false,
            y_expand: false,
        });
        box.add_child(this._coverGroup);

        // `arc-e2` é o degrau da escada de elevação do ArcSuite (common.css):
        // o St não tem variáveis, então a classe é o token, e a sombra de um
        // cartão pousado no vidro fica escrita num lugar só para o dock, a
        // barra e o alt-tab. Por isso nenhuma sombra local aqui — e por isso a
        // classe do estado vazio entra por add/remove, que um `style_class`
        // reescrito no primeiro _sync() com arte levaria o token embora.
        this._coverBin = new St.Bin({style_class: 'arc-e2 arcbar-media-cover'});
        this._coverGroup.add_child(this._coverBin);

        // A capa e o selo nascem no _sync(): a arte chega com os metadados e
        // `player.app` só é resolvido quando o proxy raiz do MPRIS responde, o
        // que pode ser depois desta montagem. `undefined` e não `null` porque
        // `null` é "sem arte", um estado que o primeiro _sync() ainda precisa
        // aplicar.
        this._appliedCoverUri = undefined;
        this._badge = null;
        this._badgeApp = null;

        const text = new St.BoxLayout({
            style_class: 'arcbar-media-text',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(text);

        this._title = this._label('arcbar-media-title');
        text.add_child(this._title);

        this._artists = this._label('arcbar-media-artists');
        text.add_child(this._artists);

        const controls = new St.BoxLayout({
            style_class: 'arcbar-media-controls',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(controls);

        this._previous = this._control(
            'media-skip-backward-symbolic', 'Faixa anterior',
            () => player.previous());
        controls.add_child(this._previous);

        this._playPause = this._control(
            'media-playback-start-symbolic', 'Reproduzir ou pausar',
            () => player.playPause(), PLAY_PAUSE_ICON_SIZE);
        this._playPause.add_style_class_name('arcbar-media-play-pause');
        controls.add_child(this._playPause);

        this._next = this._control(
            'media-skip-forward-symbolic', 'Próxima faixa',
            () => player.next());
        controls.add_child(this._next);

        this.connect('clicked', () => onActivate(player));
        player.connectObject('changed', () => this._sync(), this);
        this._sync();
    }

    _label(styleClass) {
        const label = new St.Label({style_class: styleClass, x_expand: true});
        label.clutter_text.single_line_mode = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    _control(iconName, accessibleName, callback, iconSize = CONTROL_ICON_SIZE) {
        const button = new St.Button({
            style_class: 'arcbar-media-control',
            can_focus: true,
            accessible_name: accessibleName,
            child: new St.Icon({
                icon_name: iconName,
                icon_size: iconSize,
            }),
        });
        button.connect('clicked', callback);
        return button;
    }

    _sync() {
        this._title.text = this._player.title;

        const artists = this._player.artists.join(', ');
        this._artists.text = artists;
        this._artists.visible = artists.length > 0;
        // O nome do app saiu da lista de linhas, mas continua sendo dito aqui:
        // é o que um leitor de tela tem no lugar do selo sobre a capa.
        this.accessible_name = artists.length > 0
            ? `${this._player.appName}: ${this._player.title}, por ${artists}`
            : `${this._player.appName}: ${this._player.title}`;

        this._syncCover();
        this._syncBadge();

        this._playPause.child.icon_name = this._player.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._setControlEnabled(this._previous, this._player.canGoPrevious);
        this._setControlEnabled(this._next, this._player.canGoNext);
    }

    /**
     * A capa: a arte como FUNDO do bin, nunca como um actor filho dele.
     *
     * No St o `border-radius` recorta o fundo pintado pelo próprio nó, e não
     * os filhos — um `St.Icon` com a arte fica de canto vivo por cima dos 6px
     * do bin. (Não é um descuido local: a capa do próprio Shell é um
     * `St.Icon`, e o `border-radius: 8px !important` que o tema põe em
     * `.media-message .message-icon` também não a arredonda.) Como
     * `background-image` o mesmo raio recorta a arte, o que foi medido numa
     * sessão headless junto das três alternativas.
     *
     * `background-size: cover` porque a arte não é quadrada em todo player:
     * sem ele o St estica a imagem nos dois eixos e um single 16:9 sai
     * amassado. Um arquivo que não existe não é erro nenhum — o que aparece é
     * o `background-color` da classe.
     */
    _syncCover() {
        const uri = this._coverUri();
        // Reaplicar um `set_style()` idêntico faz o St reanalisar o nó e
        // recarregar a textura, e `_sync()` roda a cada PropertiesChanged do
        // player — a mesma razão da comparação em `_syncBadge()`.
        if (uri === this._appliedCoverUri)
            return;

        this._appliedCoverUri = uri;

        if (uri) {
            // `set_style()` e não uma classe: o caminho da arte muda a cada
            // faixa, e é exatamente o caso que o cabeçalho do common.css manda
            // resolver pelo JS.
            this._coverBin.child = null;
            this._coverBin.set_style(
                `background-image: url("${uri}"); background-size: cover;`);
            this._coverBin.remove_style_class_name('arcbar-media-cover-empty');
            return;
        }

        // O mesmo bin serve as duas situações, então a classe do vazio — a que
        // pinta o gradiente sob a nota musical — só entra quando a arte falta,
        // ou ela seguiria por baixo de toda capa com transparência.
        this._coverBin.set_style(null);
        this._coverBin.child = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: PLACEHOLDER_ICON_SIZE,
        });
        this._coverBin.add_style_class_name('arcbar-media-cover-empty');
    }

    /**
     * A URI da arte, normalizada — ou null.
     *
     * Passa pelo `Gio.File` de propósito: ele devolve a URI já escapada, e é
     * isso que impede uma aspa vinda do barramento de fechar o `url("…")` e
     * emendar declarações no `set_style()`.
     */
    _coverUri() {
        if (!this._player.coverUrl)
            return null;

        try {
            return Gio.File.new_for_uri(this._player.coverUrl).get_uri();
        } catch (_) {
            return null;
        }
    }

    /**
     * O selo do app no canto da capa, no lugar da antiga linha com o nome.
     *
     * Sem `.desktop` resolvido não há selo nenhum: um glifo genérico ali não
     * diria de qual app é a música, apenas cobriria um pedaço da capa.
     */
    _syncBadge() {
        // O app de um endpoint MPRIS não muda enquanto ele vive — mesma regra
        // das linhas de notificação —, mas `_sync()` roda a cada metadado; sem
        // esta comparação a textura do ícone seria refeita a cada faixa.
        if (this._player.app === this._badgeApp)
            return;

        this._badgeApp = this._player.app;
        this._badge?.destroy();
        this._badge = null;

        if (!this._badgeApp)
            return;

        // `arc-e1`, o degrau da pastilha: o fio que impede o selo de se fundir
        // com a arte embaixo dele, e não uma sombra desenhada aqui.
        this._badge = new St.Bin({
            style_class: 'arc-e1 arcbar-media-badge',
            // O expand não é decoração do alinhamento, é o que o liga: num
            // `Clutter.BinLayout` o filho só é deslocado quando lhe sobra
            // espaço, e quem pede a sobra é o expand. Só com os dois `END` o
            // selo saía CENTRADO na capa (caixa medida em 19,19 numa capa de
            // 58px, em vez dos 38,38 do canto).
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            child: createAppIcon(
                this._badgeApp, BADGE_ICON_SIZE, 'arcbar-media-badge-icon'),
        });
        this._coverGroup.add_child(this._badge);
    }

    _setControlEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
    }
});
