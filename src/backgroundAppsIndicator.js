import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ArcBarBackgroundAppIcon } from './backgroundAppIcon.js';
import { BackgroundAppsModel } from './backgroundApps.js';

/**
 * A fila de ícones dos apps em segundo plano, logo à direita da CPU e da
 * memória.
 *
 * Sem nenhum app escondido o widget inteiro sai da barra: o actor é filho
 * direto do `_leftBox`, e uma box pula o filho invisível junto com o
 * `spacing` que viria com ele — do contrário sobraria um vão de 8px depois da
 * porcentagem de memória sem nada dentro.
 *
 * A lista é refeita por inteiro a cada mudança, e não remendada: são três ou
 * quatro ícones, e o modelo já entrega tudo por um ocioso — o clique que
 * destrói o próprio botão já terminou quando isto roda.
 */
export const ArcBarBackgroundApps = GObject.registerClass(
class ArcBarBackgroundApps extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'arcbar-background-apps',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });

        this._model = new BackgroundAppsModel({ onChanged: () => this._sync() });
        this.connect('destroy', () => this._onDestroy());
        this._model.enable();
        this._sync();
    }

    _sync() {
        this.destroy_all_children();

        for (const app of this._model.apps)
            this.add_child(new ArcBarBackgroundAppIcon(app, target => this._activate(target)));

        this.visible = this._model.apps.length > 0;
    }

    // activate() sem janela nenhuma é o mesmo lançamento do menu de apps: o
    // app que ficou na bandeja é de instância única e mostra a janela que já
    // tinha, em vez de abrir uma segunda. Assim que ela aparece o
    // WindowTracker avisa o modelo e este ícone sai da barra sozinho.
    _activate(app) {
        // A janela nasceria atrás do overview, que continua aberto por cima
        // dela.
        Main.overview.hide();

        try {
            app.activate();
        } catch (e) {
            logError(e, `[ArcBar] não consegui abrir ${app.id}`);
        }
    }

    _onDestroy() {
        this._model?.destroy();
        this._model = null;
    }
});
