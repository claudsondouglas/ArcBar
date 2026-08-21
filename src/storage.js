import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ATTRIBUTES = 'filesystem::size,filesystem::free,filesystem::type';
const REFRESH_SECONDS = 30 * 60;

function percent(used, total) {
    return total > 0 ? Math.min(100, Math.max(0, Math.round(used / total * 100))) : 0;
}

/** Espaço dos sistemas de arquivos locais montados. */
export class StorageModel {
    constructor({ onChanged }) {
        this._onChanged = onChanged;
        this._timeoutId = 0;
        this._cancellable = null;
        this._volumeMonitor = Gio.VolumeMonitor.get();
        this._signalIds = [];
        this.filesystems = [];
        this.used = 0;
        this.total = 0;
        this.percent = 0;
    }

    enable() {
        for (const signal of ['mount-added', 'mount-removed', 'mount-changed'])
            this._signalIds.push(this._volumeMonitor.connect(signal, () => this.refresh()));

        this.refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timeoutId)
            GLib.Source.remove(this._timeoutId);
        this._timeoutId = 0;
        for (const id of this._signalIds)
            this._volumeMonitor.disconnect(id);
        this._signalIds = [];
        this._onChanged = null;
    }

    refresh() {
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        const entries = [];
        const seen = new Set();
        for (const mount of this._volumeMonitor.get_mounts()) {
            const root = mount.get_root();
            if (!root?.is_native())
                continue;

            const path = root.get_path();
            if (!path || seen.has(path))
                continue;
            seen.add(path);

            const volume = mount.get_volume();
            const driveName = volume?.get_drive()?.get_name() ?? '';
            const volumeName = volume?.get_name() ?? mount.get_name() ?? '';
            let name = volumeName || driveName || path;
            if (driveName && volumeName && driveName !== volumeName)
                name = `${driveName} — ${volumeName}`;
            if (path === '/')
                name = driveName ? `${driveName} — Sistema` : 'Sistema';

            entries.push({ root, path, name });
        }

        // Em algumas sessões o GVolumeMonitor não enumera a raiz, embora ela
        // obviamente esteja montada. Ela nunca pode faltar do total.
        if (!seen.has('/'))
            entries.unshift({ root: Gio.File.new_for_path('/'), path: '/', name: 'Sistema' });

        if (!entries.length) {
            this._apply([]);
            return;
        }

        const results = [];
        let pending = entries.length;
        for (const entry of entries) {
            entry.root.query_filesystem_info_async(ATTRIBUTES, GLib.PRIORITY_DEFAULT,
                cancellable, (file, result) => {
                    try {
                        const info = file.query_filesystem_info_finish(result);
                        const total = info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_SIZE);
                        const free = info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_FREE);
                        const type = info.get_attribute_string(Gio.FILE_ATTRIBUTE_FILESYSTEM_TYPE) ?? '';
                        if (total > 0)
                            results.push({ ...entry, total, free, used: Math.max(0, total - free), type });
                    } catch (e) {
                        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            logError(e, `[ArcBar] não consegui medir ${entry.path}`);
                    }

                    if (--pending === 0 && this._cancellable === cancellable)
                        this._apply(results);
                });
        }
    }

    _apply(filesystems) {
        filesystems.sort((a, b) => a.path === '/' ? -1 : b.path === '/' ? 1 :
            a.name.localeCompare(b.name));
        this.filesystems = filesystems;
        this.total = filesystems.reduce((sum, item) => sum + item.total, 0);
        this.used = filesystems.reduce((sum, item) => sum + item.used, 0);
        this.percent = percent(this.used, this.total);
        this._onChanged?.();
    }
}
