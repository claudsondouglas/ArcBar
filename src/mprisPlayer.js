import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

const OBJECT_PATH = '/org/mpris/MediaPlayer2';

const MPRIS_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <property name="Identity" type="s" access="read"/>
  </interface>
</node>`;

const PLAYER_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="PlayPause"/>
    <method name="Previous"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
  </interface>
</node>`;

const MprisProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_XML);
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(PLAYER_XML);

/** Um player MPRIS vivo no barramento da sessão. */
export const MediaPlayer = GObject.registerClass({
    Signals: {
        'changed': {},
    },
}, class MediaPlayer extends GObject.Object {
    _init(busName) {
        super._init();

        this._destroyed = false;
        this._playerSignalId = 0;

        this._app = null;
        this._appName = 'Reprodutor de mídia';
        this._artists = [];
        this._title = 'Mídia';
        this._coverUrl = '';
        this._canPlay = false;

        this._mprisProxy = new MprisProxy(
            Gio.DBus.session, busName, OBJECT_PATH,
            () => this._onMprisReady());
        this._playerProxy = new PlayerProxy(
            Gio.DBus.session, busName, OBJECT_PATH,
            () => this._onPlayerReady());
    }

    get app() {
        return this._app;
    }

    get appName() {
        return this._appName;
    }

    get artists() {
        return this._artists;
    }

    get title() {
        return this._title;
    }

    get coverUrl() {
        return this._coverUrl;
    }

    get visible() {
        return this._canPlay;
    }

    get playing() {
        return this._playerProxy?.PlaybackStatus === 'Playing';
    }

    get canGoNext() {
        return !!this._playerProxy?.CanGoNext;
    }

    get canGoPrevious() {
        return !!this._playerProxy?.CanGoPrevious;
    }

    playPause() {
        this._playerProxy?.PlayPauseAsync().catch(error =>
            logError(error, '[ArcBar] MPRIS PlayPause failed'));
    }

    next() {
        this._playerProxy?.NextAsync().catch(error =>
            logError(error, '[ArcBar] MPRIS Next failed'));
    }

    previous() {
        this._playerProxy?.PreviousAsync().catch(error =>
            logError(error, '[ArcBar] MPRIS Previous failed'));
    }

    raise() {
        // Ativar pelo .desktop evita que a proteção contra roubo de foco
        // rejeite Raise(); é o mesmo cuidado do player nativo do Shell.
        if (this._app)
            this._app.activate();
        else if (this._mprisProxy?.CanRaise)
            this._mprisProxy.RaiseAsync().catch(error =>
                logError(error, '[ArcBar] MPRIS Raise failed'));
    }

    destroy() {
        if (this._destroyed)
            return;

        this._destroyed = true;
        if (this._playerSignalId)
            this._playerProxy.disconnect(this._playerSignalId);
        this._playerSignalId = 0;
        this._playerProxy = null;
        this._mprisProxy = null;
    }

    _onMprisReady() {
        if (this._destroyed)
            return;

        const desktopEntry = this._mprisProxy.DesktopEntry;
        this._app = desktopEntry
            ? Shell.AppSystem.get_default().lookup_app(`${desktopEntry}.desktop`)
            : null;
        this._appName = this._app?.get_name() ??
            this._mprisProxy.Identity ?? 'Reprodutor de mídia';
        this.emit('changed');
    }

    _onPlayerReady() {
        if (this._destroyed)
            return;

        this._playerSignalId = this._playerProxy.connect(
            'g-properties-changed', () => this._sync());
        this._sync();
    }

    _sync() {
        if (this._destroyed)
            return;

        const metadata = {};
        for (const key in this._playerProxy.Metadata ?? {})
            metadata[key] = this._playerProxy.Metadata[key].deepUnpack();

        const artists = metadata['xesam:artist'];
        this._artists = Array.isArray(artists) &&
            artists.every(artist => typeof artist === 'string')
            ? artists
            : [];

        const title = metadata['xesam:title'];
        this._title = typeof title === 'string' && title.length > 0
            ? title
            : 'Mídia';

        const coverUrl = metadata['mpris:artUrl'];
        this._coverUrl = typeof coverUrl === 'string' ? coverUrl : '';
        this._canPlay = !!this._playerProxy.CanPlay;
        this.emit('changed');
    }
});
