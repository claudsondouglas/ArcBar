import Shell from 'gi://Shell';

const EFFECT_NAME = 'liquid-glass';

/* Mesmo vocabulário de vidro do ArcTab (ver
 * ../ArcTab@claudson/src/glassEffect.js) — propositalmente idêntico, para o
 * menu do ArcBar e a box do alternador lerem como a mesma superfície.
 *
 * brightness fica EM 1.0: o blur é um retângulo e a borda dele fica visível
 * quanto mais o brilho se afasta do fundo real. O realce "vidro" vem do
 * gradiente do CSS, esse sim recortado pelo border-radius. */
const DEFAULTS = Object.freeze({
    radius: 32,
    brightness: 1.0,
});

/* A propriedade de intensidade do Shell.BlurEffect se chama `radius` em
 * algumas versões do Shell e `sigma` em outras — sondamos em tempo de
 * execução para o mesmo código valer nas duas. */
function setIntensity(effect, value) {
    if ('sigma' in effect) {
        effect.sigma = value;
        return;
    }
    if ('radius' in effect)
        effect.radius = value;
}

export function applyGlass(actor, opts = {}) {
    const { radius, brightness } = { ...DEFAULTS, ...opts };
    const effect = new Shell.BlurEffect();
    setIntensity(effect, radius);
    effect.brightness = brightness;
    effect.mode = Shell.BlurMode.BACKGROUND;
    actor.add_effect_with_name(EFFECT_NAME, effect);
    return effect;
}
