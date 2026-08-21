import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { applyGlass } from './glassEffect.js';

// Precisa acompanhar o border-radius de `.arcbar-glass-menu .popup-menu-content`
// no stylesheet — é dele que sai o recuo do retângulo do blur.
export const MENU_RADIUS = 20;

// Shell.BlurEffect sempre pinta um RETÂNGULO — ele não conhece o border-radius
// do St. Mesmo recuo do ArcTab: o canto do retângulo inscrito toca o arco
// quando o recuo é r * (1 - 1/√2).
const BLUR_INSET = Math.ceil(MENU_RADIUS * (1 - Math.SQRT1_2));
const BLUR_RADIUS = 32;

const MENU_CLASS = 'arcbar-glass-menu';

/**
 * Transforma um PopupMenu na mesma superfície de vidro da box do ArcTab: o
 * BoxPointer para de pintar (arrow transparente, ver o stylesheet), quem
 * desenha o corpo é o `.popup-menu-content`, e o borrão mora num actor PRÓPRIO
 * atrás dele — aplicá-lo no content faria o retângulo do blur escapar pelos
 * cantos arredondados.
 *
 * Mora aqui, e não no menu de energia onde nasceu, porque o menu de
 * notificações é a MESMA superfície: duas cópias desta função virariam dois
 * vidros que divergem no primeiro ajuste de tinte.
 *
 * @param {PopupMenu.PopupMenu} menu
 */
export function applyGlassMenu(menu) {
    const boxPointer = menu?.actor;
    const content = menu?.box;
    if (!boxPointer?.bin || !content)
        return;

    boxPointer.add_style_class_name(MENU_CLASS);

    // O recuo resolve os CANTOS (o retângulo do blur escapando pelo arco do
    // menu), mas não as BORDAS: o Shell.BlurEffect infla o volume de pintura
    // pelo sigma e desenha o borrão para fora do actor, o que sobre um limite
    // de contraste — a barra escura de uma janela encostando no branco da
    // página — vira uma mancha cinza em volta do menu. Só um recorte corta
    // isso, e ele vai num actor PAI: o clip de um actor é empurrado no
    // framebuffer antes de descer para os filhos, então nele o recorte pega a
    // saída do efeito com certeza, o que não é garantido quando clip e efeito
    // moram no mesmo actor.
    const blurClip = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        clip_to_allocation: true,
        reactive: false,
    });
    // Duas BindConstraints em vez de uma alocação nossa: o BoxPointer só aloca
    // `bin` e `_border`, e o BinLayout do host esticaria o recorte até a borda.
    // POSITION recua o canto, SIZE encolhe os dois lados — content e recorte
    // são irmãos, então o espaço de coordenadas é o mesmo e a conta não passa
    // por transformação nenhuma.
    blurClip.add_constraint(new Clutter.BindConstraint({
        source: content,
        coordinate: Clutter.BindCoordinate.POSITION,
        offset: BLUR_INSET,
    }));
    blurClip.add_constraint(new Clutter.BindConstraint({
        source: content,
        coordinate: Clutter.BindCoordinate.SIZE,
        offset: -2 * BLUR_INSET,
    }));

    const backdrop = new St.Widget({
        style_class: 'arcbar-glass-menu-blur',
        reactive: false,
    });
    blurClip.add_child(backdrop);
    applyGlass(backdrop, { radius: BLUR_RADIUS });

    const host = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        reactive: false,
    });
    boxPointer.bin.set_child(null);
    host.add_child(blurClip);
    host.add_child(content);
    boxPointer.bin.set_child(host);

    // O blur de fundo lê o framebuffer ATRÁS do actor, e o BoxPointer se
    // redireciona para um buffer offscreen incondicionalmente — lá dentro não
    // há fundo nenhum para amostrar. Voltando à política padrão, o
    // redirecionamento só vale enquanto o fade de abertura roda; o
    // queue_redraw abaixo repinta o vidro no primeiro quadro depois dele.
    boxPointer.set_offscreen_redirect(Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY);
    menu.connect('open-state-changed', (_menu, isOpen) => {
        if (isOpen)
            backdrop.queue_redraw();
    });
}
