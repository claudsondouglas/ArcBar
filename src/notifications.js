import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

/**
 * Leitura da bandeja de mensagens do Shell: quais notificações existem agora,
 * de quais apps, e o que fazer com elas.
 *
 * Não guarda cópia nenhuma — a lista é sempre recalculada a partir de
 * `Main.messageTray`, que continua sendo o dono das notificações. É isso que
 * faz o botão da barra e o banner do Shell nunca discordarem: dispensar uma
 * linha daqui é a MESMA `Notification.destroy()` que o banner chama, então a
 * notificação some dos dois lugares e do painel de mensagens do calendário
 * junto.
 *
 * `onChanged` é chamado a cada entrada/saída de fonte ou notificação.
 */
export class NotificationsModel {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._sources = new Set();
    }

    enable() {
        // connectObject(), e não a lista manual de handlers do resto da
        // extensão: fontes e notificações são destruídas o tempo todo por quem
        // as criou, e desconectar à mão de um GObject já disposto é justamente
        // o que ele evita — o rastreador do Shell limpa os handlers de uma
        // fonte sozinho quando ela emite 'destroy'.
        Main.messageTray.connectObject(
            'source-added', (_tray, source) => this._addSource(source),
            'source-removed', (_tray, source) => this._removeSource(source),
            this);

        for (const source of Main.messageTray.getSources())
            this._addSource(source);

        this._changed();
    }

    destroy() {
        Main.messageTray.disconnectObject(this);
        for (const source of this._sources)
            source.disconnectObject(this);
        this._sources.clear();
        this._onChanged = null;
    }

    /** Notificações de todas as fontes, da mais recente para a mais antiga. */
    getNotifications() {
        const all = [];
        for (const source of this._sources)
            all.push(...source.notifications);

        return all.sort((a, b) => this._stamp(b) - this._stamp(a));
    }

    get count() {
        let count = 0;
        for (const source of this._sources)
            count += source.notifications.length;
        return count;
    }

    /**
     * Fontes que têm ao menos uma notificação, na ordem da notificação mais
     * recente de cada uma — é dessa lista que saem os ícones da barra.
     */
    getActiveSources() {
        const sources = [...this._sources].filter(source => source.notifications.length > 0);
        return sources.sort((a, b) => this._newestStamp(b) - this._newestStamp(a));
    }

    /** Dispensa tudo, como o "Limpar" do painel de mensagens do Shell. */
    clear() {
        // Sobre a cópia que getNotifications() devolve, e nunca sobre os
        // arrays das fontes: cada destroy() tira a notificação do array da
        // fonte, e iterar sobre um array que encolhe pula uma linha sim, uma
        // não.
        for (const notification of this.getNotifications())
            this.dismiss(notification);
    }

    /** Dispensa uma notificação — o mesmo caminho do "x" do banner. */
    dismiss(notification) {
        notification?.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
    }

    /**
     * Marca tudo como visto. O Shell usa `acknowledged` para decidir se ainda
     * deve mostrar o banner de uma notificação; depois que a lista foi aberta,
     * ela já foi vista e o banner só apareceria duas vezes.
     */
    acknowledgeAll() {
        for (const notification of this.getNotifications())
            notification.acknowledged = true;
    }

    _addSource(source) {
        if (this._sources.has(source))
            return;

        this._sources.add(source);
        source.connectObject(
            'notification-added', () => this._changed(),
            'notification-removed', () => this._changed(),
            this);
        this._changed();
    }

    _removeSource(source) {
        if (!this._sources.delete(source))
            return;

        source.disconnectObject(this);
        this._changed();
    }

    // Em MICROSSEGUNDOS, e não os segundos redondos do to_unix(): duas
    // notificações que chegam no mesmo segundo — o que acontece o tempo todo,
    // um app que manda duas de uma vez — empatariam, e o empate deixa a ordem
    // de chegada das fontes decidir, que é justamente o contrário do "mais
    // recente primeiro". Número solto em vez de datetime.compare() para o
    // comparador continuar valendo quando falta datetime (nenhuma notificação
    // deveria vir sem, mas uma exceção aqui derrubaria a lista inteira).
    _stamp(notification) {
        const datetime = notification?.datetime;
        if (!datetime)
            return 0;

        return datetime.to_unix() * 1e6 + datetime.get_microsecond();
    }

    _newestStamp(source) {
        return source.notifications.reduce(
            (newest, notification) => Math.max(newest, this._stamp(notification)), 0);
    }

    _changed() {
        this._onChanged?.();
    }
}
