import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import { appForDesktopId } from './appIcon.js';

const SYSTEMD_NAME = 'org.freedesktop.systemd1';
const SYSTEMD_PATH = '/org/freedesktop/systemd1';
const SYSTEMD_MANAGER = 'org.freedesktop.systemd1.Manager';

// Só os escopos de aplicativo: o `app.slice` do usuário. O resto do que o
// systemd da sessão carrega (`podman-pause-*.scope`, os serviços do próprio
// GNOME) não é app de ninguém.
const UNIT_PATTERN = 'app-*.scope';

// O prefixo que o lançador põe ANTES do id do .desktop, quando põe:
// `app-gnome-discord-5876.scope` é o `discord.desktop` lançado pelo Shell.
// Não dá para separá-lo por regra — `gnome-terminal` também começa com
// "gnome" —, então ele só vira um candidato a mais e quem decide é a base de
// .desktop instalados.
const LAUNCHERS = ['gnome', 'flatpak', 'snap'];

// Aplicativos cuja janela é o próprio produto e que não oferecem um modo de
// bandeja/background ao usuário. Extensões, terminais e agentes podem manter
// o processo deles vivo depois da última janela, mas isso não deve transformar
// o aplicativo em item de segundo plano.
const FOREGROUND_ONLY_APPS = new Set([
    'code.desktop',
    'code-insiders.desktop',
    'codium.desktop',
    'com.visualstudio.code.desktop',
    'com.vscodium.codium.desktop',
]);

/** O `\xNN` com que o systemd escapa o que não cabe num nome de unidade. */
function unescapeUnit(name) {
    return name.replace(/\\x([0-9a-f]{2})/gi, (_match, hex) =>
        String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Os ids de `.desktop` que um nome de escopo pode querer dizer, do mais
 * provável para o menos.
 *
 * A gramática do nome é `app-[lançador-]<id escapado>-<pid ou aleatório>.scope`
 * (o systemd novo usa `@` no lugar do último traço). Como nem o lançador nem o
 * id têm delimitador próprio — os dois podem conter traços —, aqui não se
 * adivinha: devolve-se o nome inteiro e o nome sem o lançador, e o
 * `appForDesktopId()` diz qual dos dois existe de verdade.
 */
export function desktopIdsFromUnit(unit) {
    const body = unit.replace(/\.scope$/, '').replace(/^app-/, '').split('@')[0];
    const parts = body.split('-');

    // O último pedaço é o PID (ou o aleatório do systemd), nunca parte do id.
    if (parts.length > 1 && /^[0-9a-f]+$/i.test(parts[parts.length - 1]))
        parts.pop();
    if (!parts.length)
        return [];

    const ids = [unescapeUnit(parts.join('-'))];
    if (parts.length > 1 && LAUNCHERS.includes(parts[0]))
        ids.push(unescapeUnit(parts.slice(1).join('-')));

    return ids;
}

/**
 * PID que o lançador gravou no fim do nome do escopo, quando disponível.
 * Versões mais novas do systemd podem usar um identificador aleatório depois
 * de `@`; esse formato não é confundido com PID aqui.
 */
export function launchPidFromUnit(unit) {
    const match = unit.match(/-(\d+)\.scope$/);
    if (!match)
        return null;

    const pid = Number(match[1]);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function processName(command) {
    const name = String(command ?? '').trim().split(/\s+/)[0].split('/').pop();
    return name?.toLocaleLowerCase() ?? '';
}

function appExecutable(app) {
    const executable = app?.get_app_info?.()?.get_executable?.();
    return executable ? processName(executable) : '';
}

/**
 * Um app que o usuário lançou e que o menu de apps mostraria. O `should_show()`
 * é o que separa um app de um daemon de sessão: os dois ganham escopo, mas o
 * `.desktop` do segundo é `NoDisplay=true` e ele não é algo que alguém tenha
 * "deixado aberto".
 */
function launchable(app) {
    const info = app?.get_app_info?.();
    if (!info)
        return false;

    // Sem o `should_show()` (uma ligação que não o exponha) o certo é
    // mostrar: um daemon a mais na fila é um defeito menor que a fila
    // inteira vazia sem nada dizer por quê.
    return info.should_show?.() ?? true;
}

function backgroundCapable(app) {
    return launchable(app) && !FOREGROUND_ONLY_APPS.has(app.id.toLowerCase());
}

function sameApps(a, b) {
    return a.length === b.length && a.every((app, i) => app === b[i]);
}

/**
 * Os aplicativos que continuam rodando sem nenhuma janela.
 *
 * A pergunta óbvia — o `org.freedesktop.background.Monitor` do portal — não
 * responde aqui: aquela lista é montada com o que o app declarou pelo
 * `org.freedesktop.portal.Background.SetStatus`, então só um app em sandbox
 * aparece nela. Nesta máquina, com o Discord fechado na bandeja há uma hora,
 * ela devolve `[]`.
 *
 * O que sabe é o systemd: cada app lançado pelo Shell ganha um escopo em
 * `app.slice` que só morre com o último processo dele — janela, bandeja e
 * portal não entram na conta. Além de cruzar o escopo com zero janelas, é
 * preciso confirmar que o processo que originou o app continua nele: uma
 * tarefa ou terminal filho pode sobreviver ao VS Code e manter o mesmo
 * escopo, mas isso não significa que o Code esteja em segundo plano.
 *
 * Como os outros modelos da extensão, não guarda cópia de estado alheio: os
 * escopos são relidos quando o systemd avisa que alguma unidade nasceu ou
 * morreu, e o filtro é refeito do zero a cada mudança do `WindowTracker`.
 */
export class BackgroundAppsModel {
    constructor({ onChanged }) {
        this._onChanged = onChanged;
        this._proxy = null;
        this._cancellable = null;
        this._signalId = 0;
        this._trackerId = 0;
        this._idleId = 0;
        this._relist = false;
        this._filterGeneration = 0;
        // id do .desktop -> Shell.App, com ou sem janela: a lista de escopos,
        // que só muda quando um app abre ou fecha de verdade.
        this._candidates = new Map();

        this.apps = [];
    }

    enable() {
        this._cancellable = new Gio.Cancellable();

        // Assíncrono pelo mesmo motivo do NetworkModel: isto roda dentro do
        // enable(), e uma ida ao D-Bus travando o laço principal aí trava a
        // sessão inteira enquanto ela abre.
        //
        // DO_NOT_LOAD_PROPERTIES porque o Manager do systemd tem mais de cem
        // propriedades e nenhuma delas é usada aqui; DO_NOT_AUTO_START porque
        // o gerenciador da sessão ou já está no barramento ou não está, e
        // pedir para o D-Bus levantar um é pedir a coisa errada — numa sessão
        // sem ele (um `dbus-run-session` de teste) a resposta certa é a lista
        // ficar vazia, não uma tentativa de subir o systemd.
        Gio.DBusProxy.new(Gio.DBus.session,
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES |
            Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            null, SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_MANAGER,
            this._cancellable, (_source, result) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_finish(result);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e, '[ArcBar] systemd da sessão indisponível');
                    return;
                }

                // destroy() pode ter chegado antes da resposta.
                if (!this._cancellable || this._cancellable.is_cancelled())
                    return;

                this._proxy = proxy;
                this._signalId = proxy.connect('g-signal', (_p, _sender, signal) => {
                    if (signal === 'UnitNew' || signal === 'UnitRemoved')
                        this._queue(true);
                });

                // O systemd só emite UnitNew/UnitRemoved enquanto alguém
                // estiver inscrito; sem isto o proxy fica mudo.
                this._call('Subscribe', null);
                this._list();
            });

        // Uma janela que nasce ou morre não muda os escopos, muda de que lado
        // do filtro o app está.
        this._trackerId = Shell.WindowTracker.get_default().connect(
            'tracked-windows-changed', () => this._queue(false));
    }

    destroy() {
        if (this._idleId) {
            GLib.Source.remove(this._idleId);
            this._idleId = 0;
        }

        if (this._trackerId) {
            Shell.WindowTracker.get_default().disconnect(this._trackerId);
            this._trackerId = 0;
        }

        if (this._signalId) {
            this._proxy.disconnect(this._signalId);
            this._signalId = 0;
        }

        // Antes de cancelar, ou o próprio Unsubscribe seria cancelado com o
        // resto. A conexão com o barramento é a do Shell e continua viva
        // depois da extensão, então a inscrição não se desfaz sozinha.
        if (this._proxy)
            this._call('Unsubscribe', null, null);

        this._cancellable?.cancel();
        this._cancellable = null;
        this._proxy = null;
        this._filterGeneration++;
        this._candidates.clear();
        this._onChanged = null;
    }

    /** Encerra todos os escopos que pertencem ao app, incluindo os filhos. */
    stop(app) {
        const candidate = this._candidates.get(app.id);
        if (!candidate)
            return;

        // StopUnit age sobre o cgroup inteiro do escopo, não apenas sobre o
        // processo que abriu o app. Assim helpers, bandeja e subprocessos
        // também terminam. Um app pode ter mais de um escopo; parar todos é
        // intencional e UnitRemoved fará a lista se atualizar em seguida.
        for (const unit of candidate.units)
            this._call('StopUnit', new GLib.Variant('(ss)', [unit, 'replace']));
    }

    _call(method, parameters, cancellable = this._cancellable) {
        this._proxy?.call(method, parameters, Gio.DBusCallFlags.NONE, -1, cancellable,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e, `[ArcBar] ${method} falhou`);
                }
            });
    }

    // Uma releitura por ocioso, e uma só: abrir um app dispara o UnitNew do
    // escopo e várias mudanças do WindowTracker em sequência, e cada uma
    // delas refaria a fila de ícones no meio da anterior.
    _queue(relist) {
        this._relist ||= relist;
        if (this._idleId)
            return;

        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            const relist = this._relist;
            this._relist = false;

            if (relist)
                this._list();
            else
                this._filter();

            return GLib.SOURCE_REMOVE;
        });
    }

    _list() {
        this._proxy?.call('ListUnitsByPatterns',
            new GLib.Variant('(asas)', [['active'], [UNIT_PATTERN]]),
            Gio.DBusCallFlags.NONE, -1, this._cancellable, (proxy, result) => {
                let reply;
                try {
                    reply = proxy.call_finish(result);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e, '[ArcBar] não consegui listar os escopos de app');
                    return;
                }

                const [units] = reply.deepUnpack();
                this._candidates.clear();

                for (const unit of units) {
                    const unitName = unit[0];
                    const app = desktopIdsFromUnit(unitName)
                        .map(id => appForDesktopId(id))
                        .find(found => backgroundCapable(found));
                    // Um app pode ter dois escopos — o do lançador e o
                    // aninhado (`app-discord-…` e `app-gnome-discord-…`) —,
                    // e a chave pelo id resolve os dois no mesmo ícone.
                    if (app) {
                        let candidate = this._candidates.get(app.id);
                        if (!candidate) {
                            candidate = { app, units: [] };
                            this._candidates.set(app.id, candidate);
                        }
                        candidate.units.push(unitName);
                    }
                }

                this._filter();
            });
    }

    async _unitStillOwnsApp(unit, app) {
        let reply;
        try {
            reply = await this._proxy.call(
                'GetUnitProcesses', new GLib.Variant('(s)', [unit]),
                Gio.DBusCallFlags.NONE, -1, this._cancellable);
        } catch (e) {
            // Um systemd antigo sem GetUnitProcesses continua usando o
            // comportamento anterior em vez de esconder todos os apps.
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, `[ArcBar] não consegui ler os processos de ${unit}`);
            return true;
        }

        const [processes] = reply.deepUnpack();
        const launchPid = launchPidFromUnit(unit);
        if (launchPid !== null)
            return processes.some(process => Number(process[1]) === launchPid);

        // Escopos com sufixo aleatório não revelam o PID inicial. Neles, ao
        // menos exige que o executável do .desktop ainda esteja no cgroup;
        // shells, tarefas e language servers isolados não contam como o app.
        const executable = appExecutable(app);
        if (!executable)
            return true;
        return processes.some(process => processName(process[2]) === executable);
    }

    async _filter() {
        const generation = ++this._filterGeneration;
        const candidates = [...this._candidates.values()]
            .filter(({ app }) => app.get_n_windows() === 0);
        const ownership = await Promise.all(candidates.map(async candidate => ({
            candidate,
            ownsApp: (await Promise.all(candidate.units.map(unit =>
                this._unitStillOwnsApp(unit, candidate.app)))).some(Boolean),
        })));

        if (generation !== this._filterGeneration || !this._cancellable)
            return;

        const apps = ownership
            .filter(({ ownsApp }) => ownsApp)
            .map(({ candidate }) => candidate.app)
            // Por nome, e não pela ordem em que o systemd devolveu os
            // escopos: aquela muda a cada leitura e faria os ícones trocarem
            // de lugar sozinhos.
            .sort((a, b) => (a.get_name() ?? a.id).localeCompare(b.get_name() ?? b.id));

        if (sameApps(apps, this.apps))
            return;

        this.apps = apps;
        this._onChanged?.();
    }
}
