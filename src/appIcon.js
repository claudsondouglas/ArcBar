import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

/**
 * O ícone de app de uma fonte de notificação, resolvido do mesmo jeito que o
 * ArcDock resolve os da grade de apps: pelo `.desktop`, através do tema de
 * ícones.
 *
 * Dois caminhos óbvios não servem, e é por isso que este arquivo existe:
 *
 * - O `gicon` da notificação é a imagem que o app MANDOU (`image-path`/
 *   `image-data` do fdo) — quase sempre o PNG que ele carrega dentro de si.
 * - O `icon` da fonte é `Shell.App.get_icon()`, que só passa pelo tema quando
 *   o app tem `.desktop`. Quando o Shell não achou um, ele ainda devolve um
 *   `Shell.App` — um *window-backed*, inventado a partir da janela — e o ícone
 *   dele é o que a janela carrega, de novo o PNG de dentro do app. É esse o
 *   caso que fazia uma linha ficar fora do tema no meio de uma barra inteira
 *   de ícones dele: a grade do ArcDock só lista app instalado, então lá o
 *   problema nunca aparece.
 *
 * Daí a procura em cascata abaixo: só um app com `.desktop` conta, e sem
 * nenhum ainda se tenta um nome que o tema conheça antes de aceitar a imagem
 * crua.
 */

// O `.desktop` sem ícone nenhum ainda precisa ocupar o espaço: uma linha mais
// estreita que as vizinhas desalinharia a coluna de texto.
const APP_FALLBACK_ICON = 'application-x-executable';

const DEBUG = true;

function debug(message) {
    if (DEBUG)
        console.log(`[ArcBar] appIcon: ${message}`);
}

/** O app só serve se vier de um `.desktop`; ver o comentário do topo. */
function installed(app) {
    return app && !app.is_window_backed() && app.get_app_info() ? app : null;
}

function lookupById(id) {
    if (!id)
        return null;

    const sys = Shell.AppSystem.get_default();
    const desktop = id.endsWith('.desktop') ? id : `${id}.desktop`;
    return installed(sys.lookup_app(desktop)) ??
        installed(sys.lookup_heuristic_basename(desktop.toLowerCase()));
}

/**
 * O `Shell.App` **instalado** de um id de `.desktop`, ou null.
 *
 * A porta de entrada de quem já TEM o id e só quer saber se ele existe — o
 * nome de escopo do systemd, em src/backgroundApps.js. O filtro é o mesmo do
 * resto do arquivo: um app sem `.desktop` não conta.
 *
 * @param {string} id
 * @returns {Shell.App?}
 */
export function appForDesktopId(id) {
    return lookupById(id);
}

/**
 * O app instalado que corresponde a uma `WM_CLASS`. São as mesmas três tabelas
 * que o Shell usa para casar janela com `.desktop`: a `WMClass` declarada, a
 * `StartupWMClass`, e por fim o chute pelo nome do arquivo.
 */
function lookupByWmClass(wmClass) {
    if (!wmClass)
        return null;

    const sys = Shell.AppSystem.get_default();
    return installed(sys.lookup_desktop_wmclass(wmClass)) ??
        installed(sys.lookup_startup_wmclass(wmClass)) ??
        lookupById(wmClass.toLowerCase().replace(/\s+/g, '-'));
}

/** A `WM_CLASS` da primeira janela de um app, quando ele tem alguma. */
function wmClassOf(app) {
    const [window] = app?.get_windows() ?? [];
    return window?.get_wm_class() ?? null;
}

/** Os nomes de ícone que uma fonte sugere, do mais confiável para o menos. */
function iconNamesOf(source) {
    const names = [];
    const icon = source?.icon;
    if (icon instanceof Gio.ThemedIcon)
        names.push(...icon.get_names());

    const wmClass = wmClassOf(source?.app ?? source?._app);
    if (wmClass)
        names.push(wmClass.toLowerCase());

    if (source?.title)
        names.push(source.title.toLowerCase().replace(/\s+/g, '-'));

    return names;
}

/**
 * O `Shell.App` **instalado** por trás de uma fonte, ou null.
 *
 * Quatro tentativas porque são quatro donos possíveis: o daemon fdo guarda o
 * app em `app`, o do GTK em `_app`, a policy guarda o id do `.desktop` (é dele
 * que o Shell tirou o app para criá-la), e um app *window-backed* ainda leva a
 * um instalado pela `WM_CLASS` da janela dele.
 */
export function appForSource(source) {
    if (!source)
        return null;

    const own = source.app ?? source._app ?? null;
    return installed(own) ??
        lookupById(source.policy?.id === 'generic' ? null : source.policy?.id) ??
        lookupByWmClass(wmClassOf(own)) ??
        lookupByWmClass(source.title);
}

/**
 * A textura do tema para um app instalado, ou null.
 *
 * O `icon-size` vai inline, e não só no `icon_size` do construtor: o
 * `icon-size` do CSS do tema venceria a propriedade e devolveria o ícone a um
 * tamanho que não é o desta lista.
 */
function iconTexture(app, size, styleClass) {
    const texture = app?.create_icon_texture?.(size) ?? null;
    if (!texture)
        return null;

    texture.add_style_class_name(styleClass);
    texture.set_style?.(`icon-size: ${size}px;`);
    texture.y_align = Clutter.ActorAlign.CENTER;
    return texture;
}

/**
 * Um actor de ícone para um `Shell.App` que já foi resolvido.
 *
 * Sem a cascata das outras duas funções daqui: quem chama isto partiu de um
 * `.desktop` que existe, então ou o tema tem o ícone dele ou não há segunda
 * pista nenhuma a seguir.
 *
 * @param {Shell.App} app
 * @param {number} size
 * @param {string} styleClass
 * @returns {Clutter.Actor}
 */
export function createAppIcon(app, size, styleClass) {
    return iconTexture(app, size, styleClass) ?? new St.Icon({
        style_class: styleClass,
        icon_name: APP_FALLBACK_ICON,
        icon_size: size,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/**
 * Um actor de ícone para a fonte, no tamanho pedido.
 *
 * Com app instalado é `create_icon_texture()`, o mesmo que o ArcDock chama.
 * Sem ele, o primeiro nome que o tema de ícones realmente tiver; e só depois
 * disso a imagem crua que a fonte oferece — um ícone fora do tema ainda diz de
 * qual app é a notificação, o que um ponto de interrogação genérico não diria.
 */
export function createSourceIcon(source, size, styleClass, fallbackIconName) {
    const app = appForSource(source);
    const texture = iconTexture(app, size, styleClass);

    debug(`source="${source?.title}" own=${(source?.app ?? source?._app)?.id} ` +
        `windowBacked=${(source?.app ?? source?._app)?.is_window_backed?.()} ` +
        `policy=${source?.policy?.id} wmClass=${wmClassOf(source?.app ?? source?._app)} ` +
        `resolved=${app?.id} gicon=${source?.icon?.to_string?.()} ` +
        `names=[${iconNamesOf(source)}]`);

    if (texture)
        return texture;

    const icon = new St.Icon({
        style_class: styleClass,
        icon_size: size,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const theme = new St.IconTheme();
    const themed = iconNamesOf(source).find(name => theme.has_icon(name));
    if (themed)
        icon.icon_name = themed;
    else if (source?.icon)
        icon.gicon = source.icon;
    else
        icon.icon_name = fallbackIconName ?? APP_FALLBACK_ICON;

    debug(`  -> themed=${themed} fallback=${icon.icon_name}`);
    return icon;
}

/* ------------------------------------------------------------------
 * Streams de áudio
 *
 * O mesmo problema de identidade das notificações, com outra origem: o
 * PulseAudio não entrega `.desktop` nenhum. O `application.id`, que seria
 * a resposta direta, quase nunca vem preenchido (um app em flatpak, por
 * exemplo, chega aqui só como `application.name`), e o `application.
 * icon_name` costuma ser um genérico de categoria — "applications-games"
 * para um jogo qualquer.
 *
 * Por isso a mesma cascata de cima é reaproveitada, e só depois dela é que
 * se aceita o que o stream ofereceu.
 * ------------------------------------------------------------------ */

// Um stream sem app identificável ainda é som saindo da máquina, e o alto-
// falante genérico diz isso melhor que um ponto de interrogação.
const STREAM_FALLBACK_ICON = 'audio-x-generic-symbolic';

/**
 * O app instalado cujo NOME visível é este. Última tentativa para os streams,
 * porque o nome é a única coisa que o PulseAudio sempre traz — e é o mesmo
 * texto que o `.desktop` mostra no menu de apps ("Sober", "Firefox"), então a
 * comparação é entre duas etiquetas feitas para o mesmo humano ler.
 */
function lookupByName(name) {
    if (!name)
        return null;

    const wanted = name.toLowerCase();
    const running = Shell.AppSystem.get_default().get_running?.() ?? [];
    return running.find(app =>
        installed(app) && app.get_name()?.toLowerCase() === wanted) ?? null;
}

/**
 * O `Shell.App` **instalado** por trás de um stream do mixer, ou null.
 *
 * @param {Gvc.MixerStream} stream
 * @returns {Shell.App?}
 */
export function appForStream(stream) {
    if (!stream)
        return null;

    const name = stream.get_name();
    return lookupById(stream.get_application_id()) ??
        lookupByWmClass(name) ??
        // O `application.icon_name` costuma ser o basename do `.desktop`
        // ("brave-browser" para um stream que se chama só "Brave"), então ele
        // passa pelas mesmas tabelas de WM_CLASS antes de virar só um ícone.
        lookupByWmClass(stream.get_icon_name()) ??
        lookupByName(name);
}

/**
 * Um actor de ícone para um stream do mixer, no tamanho pedido.
 *
 * @param {Gvc.MixerStream} stream
 * @param {number} size
 * @param {string} styleClass
 * @returns {Clutter.Actor}
 */
export function createStreamIcon(stream, size, styleClass) {
    const app = appForStream(stream);
    const texture = iconTexture(app, size, styleClass);

    debug(`stream="${stream?.get_name()}" appId=${stream?.get_application_id()} ` +
        `resolved=${app?.id} iconName=${stream?.get_icon_name()}`);

    if (texture)
        return texture;

    const icon = new St.Icon({
        style_class: styleClass,
        icon_size: size,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const iconName = stream?.get_icon_name();
    if (iconName && new St.IconTheme().has_icon(iconName))
        icon.icon_name = iconName;
    else if (stream?.get_gicon())
        icon.gicon = stream.get_gicon();
    else
        icon.icon_name = STREAM_FALLBACK_ICON;

    return icon;
}
