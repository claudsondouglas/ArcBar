import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TRANSPARENT_CLASS = 'arcbar-panel-transparent';

// Per-window signals that can move a window in or out of the panel strip.
const WINDOW_SIGNALS = ['position-changed', 'size-changed', 'notify::minimized', 'workspace-changed'];

/**
 * Makes the bar transparent while nothing is underneath it — the desktop and
 * the overview — and solid again as soon as a window reaches the panel strip.
 *
 * The state is a single style class on Main.panel, so the colours stay in
 * stylesheet.css and disable() only has to drop the class.
 */
export class PanelTransparency {
    constructor() {
        this._signals = [];
        this._windowSignals = new Map();
    }

    enable() {
        this._connect(global.display, 'window-created', (_d, window) => {
            this._trackWindow(window);
            this._sync();
        });
        this._connect(global.workspace_manager, 'active-workspace-changed', () => this._sync());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._sync());
        // visibleTarget is already correct while the animations run, so both
        // ends of the overview transition can share the same handler.
        this._connect(Main.overview, 'showing', () => this._sync());
        this._connect(Main.overview, 'hiding', () => this._sync());

        for (const actor of global.get_window_actors())
            this._trackWindow(actor.meta_window);

        this._sync();
    }

    disable() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];

        for (const [window, ids] of this._windowSignals) {
            for (const id of ids)
                window.disconnect(id);
        }
        this._windowSignals.clear();

        Main.panel.remove_style_class_name(TRANSPARENT_CLASS);
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _trackWindow(window) {
        if (!window || this._windowSignals.has(window))
            return;

        const ids = WINDOW_SIGNALS.map(signal => window.connect(signal, () => this._sync()));
        ids.push(window.connect('unmanaged', () => this._untrackWindow(window)));
        this._windowSignals.set(window, ids);
    }

    _untrackWindow(window) {
        const ids = this._windowSignals.get(window);
        if (!ids)
            return;

        for (const id of ids)
            window.disconnect(id);
        this._windowSignals.delete(window);
        this._sync();
    }

    _sync() {
        const transparent = Main.overview.visibleTarget || !this._windowTouchesPanel();
        log(`[ArcBar] sync transparent=${transparent} overview=${Main.overview.visibleTarget} touches=${this._windowTouchesPanel()}`);
        if (transparent)
            Main.panel.add_style_class_name(TRANSPARENT_CLASS);
        else
            Main.panel.remove_style_class_name(TRANSPARENT_CLASS);
    }

    // True as soon as one window of the active workspace overlaps the strip the
    // panel occupies on its own monitor.
    _windowTouchesPanel() {
        const panelBox = Main.layoutManager.panelBox;
        const monitor = Main.layoutManager.primaryIndex;
        const workspace = global.workspace_manager.get_active_workspace();
        if (!workspace)
            return false;

        for (const window of workspace.list_windows()) {
            if (window.skip_taskbar || !window.showing_on_its_workspace() || window.minimized)
                continue;
            if (window.get_monitor() !== monitor)
                continue;
            if (window.get_window_type() === Meta.WindowType.DESKTOP)
                continue;

            const rect = window.get_frame_rect();
            // <=, not <: the panel's strut keeps a maximized window's frame
            // exactly at the bar's bottom edge, so it never truly overlaps.
            const overlapsY = rect.y <= panelBox.y + panelBox.height;
            const overlapsX = rect.x < panelBox.x + panelBox.width && rect.x + rect.width > panelBox.x;
            if (overlapsY && overlapsX)
                return true;
        }

        return false;
    }
}
