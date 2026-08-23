import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TRANSPARENT_CLASS = 'arcbar-panel-transparent';
const LIGHT_BACKGROUND_CLASS = 'arcbar-panel-light-background';
const FALLBACK_COLOR = '#121212';
// The first rows below a maximized window are commonly its border or shadow.
const SAMPLE_OFFSET = 36;
const SAMPLE_DELAY_MS = 100;
const SAMPLE_COUNT = 3;
const BACKGROUND_DARKEN_FACTOR = 0.8;
const LIGHT_PRESET = '#dedede';
const DARK_PRESET = '#121212';

Gio._promisify(Shell.Screenshot.prototype, 'pick_color');

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
    constructor(settings) {
        this._settings = settings;
        this._signals = [];
        this._windowSignals = new Map();
        this._screenshot = new Shell.Screenshot();
        this._originalPanelStyle = null;
        this._colorRequest = 0;
        this._sampleTimeoutId = 0;
    }

    enable() {
        this._originalPanelStyle = Main.panel.get_style();
        this._connect(this._settings, 'changed::adaptive-panel-color', () => this._sync());
        this._connect(this._settings, 'changed::app-colors', () => this._sync());
        this._connect(this._settings, 'changed::app-color-modes', () => this._sync());
        this._connect(this._settings, 'changed::app-custom-colors', () => this._sync());
        this._connect(global.display, 'window-created', (_d, window) => {
            this._trackWindow(window);
            this._sync();
        });
        this._connect(global.display, 'notify::focus-window', () => this._sync());
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

        // Invalidates an in-flight pick_color() and restores any inline style
        // that was present before ArcBar took control of the panel colour.
        this._cancelColorSample();
        this._colorRequest++;
        Main.panel.set_style(this._originalPanelStyle);
        this._originalPanelStyle = null;
        this._screenshot = null;
        this._settings = null;
        Main.panel.remove_style_class_name(LIGHT_BACKGROUND_CLASS);
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
        if (transparent) {
            this._cancelColorSample();
            this._colorRequest++;
            Main.panel.remove_style_class_name(LIGHT_BACKGROUND_CLASS);
            Main.panel.set_style('background-color: transparent;');
            Main.panel.add_style_class_name(TRANSPARENT_CLASS);
        } else {
            Main.panel.remove_style_class_name(TRANSPARENT_CLASS);
            if (this._settings.get_boolean('adaptive-panel-color')) {
                const appId = this._focusedAppId();
                const savedColor = appId ? this._savedColorForApp(appId) : null;
                if (savedColor) {
                    this._cancelColorSample();
                    this._colorRequest++;
                    this._applyPanelColor(savedColor);
                } else {
                    Main.panel.remove_style_class_name(LIGHT_BACKGROUND_CLASS);
                    Main.panel.set_style(`background-color: ${FALLBACK_COLOR};`);
                    this._scheduleColorSample(appId);
                }
            } else {
                this._cancelColorSample();
                this._colorRequest++;
                Main.panel.remove_style_class_name(LIGHT_BACKGROUND_CLASS);
                Main.panel.set_style(`background-color: ${FALLBACK_COLOR};`);
            }
        }
    }

    _scheduleColorSample(appId) {
        this._cancelColorSample();
        const request = ++this._colorRequest;
        this._collectColorSamples(request, appId, []);
    }

    _cancelColorSample() {
        if (!this._sampleTimeoutId)
            return;

        GLib.Source.remove(this._sampleTimeoutId);
        this._sampleTimeoutId = 0;
    }

    async _collectColorSamples(request, appId, samples) {
        const screenshot = this._screenshot;
        if (!screenshot || request !== this._colorRequest)
            return;

        const window = global.display.focus_window;
        if (!window || !window.showing_on_its_workspace() || window.minimized)
            return;

        const rect = window.get_frame_rect();
        // Sample inside the focused app instead of at the monitor edge. The
        // 75% position stays on the right-hand side without hitting a border,
        // scrollbar or the window controls in the extreme corner.
        const x = Math.min(
            rect.x + Math.floor(rect.width * 0.75),
            rect.x + rect.width - 1);
        const y = Math.min(rect.y + SAMPLE_OFFSET, rect.y + rect.height - 1);

        try {
            const [color] = await screenshot.pick_color(x, y);
            if (!this._screenshot || request !== this._colorRequest || !color)
                return;

            samples.push(color);
            if (samples.length === 1)
                this._applySampledColor(color);

            if (samples.length < SAMPLE_COUNT) {
                this._sampleTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, SAMPLE_DELAY_MS, () => {
                        this._sampleTimeoutId = 0;
                        this._collectColorSamples(request, appId, samples);
                        return GLib.SOURCE_REMOVE;
                    });
                return;
            }

            const sampledColor = this._bestColorSample(samples);
            const panelColor = this._darkenedColor(sampledColor);
            this._applyPanelColor(this._colorToHex(panelColor));
            if (appId)
                this._saveDetectedColor(appId, panelColor);
        } catch (error) {
            logError(error, `[ArcBar] could not sample colour at ${x},${y}`);
        }
    }

    _applySampledColor(color) {
        this._applyPanelColor(this._colorToHex(this._darkenedColor(color)));
    }

    _darkenedColor(color) {
        return {
            red: Math.round(color.red * BACKGROUND_DARKEN_FACTOR),
            green: Math.round(color.green * BACKGROUND_DARKEN_FACTOR),
            blue: Math.round(color.blue * BACKGROUND_DARKEN_FACTOR),
        };
    }

    _applyPanelColor(hex) {
        const panelColor = this._hexToColor(hex);
        if (!panelColor)
            return;

        if (this._isLightColor(panelColor))
            Main.panel.add_style_class_name(LIGHT_BACKGROUND_CLASS);
        else
            Main.panel.remove_style_class_name(LIGHT_BACKGROUND_CLASS);

        Main.panel.set_style(
            `background-color: ${hex};`);
    }

    _focusedAppId() {
        const window = global.display.focus_window;
        if (!window)
            return null;

        return Shell.WindowTracker.get_default().get_window_app(window)?.get_id() ??
            window.get_gtk_application_id?.() ?? window.get_wm_class?.() ?? null;
    }

    _savedColorForApp(appId) {
        const mode = this._settings.get_value('app-color-modes').deep_unpack()[appId] ?? 'automatic';
        if (mode === 'light')
            return LIGHT_PRESET;
        if (mode === 'dark')
            return DARK_PRESET;
        if (mode === 'custom')
            return this._settings.get_value('app-custom-colors').deep_unpack()[appId] ?? null;

        return this._settings.get_value('app-colors').deep_unpack()[appId] ?? null;
    }

    _saveDetectedColor(appId, color) {
        const colors = this._settings.get_value('app-colors').deep_unpack();
        colors[appId] = this._colorToHex(color);
        this._settings.set_value('app-colors', new GLib.Variant('a{ss}', colors));
    }

    _colorToHex(color) {
        const channel = value => Math.max(0, Math.min(255, value))
            .toString(16).padStart(2, '0');
        return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
    }

    _hexToColor(hex) {
        const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
        return match ? {
            red: Number.parseInt(match[1], 16),
            green: Number.parseInt(match[2], 16),
            blue: Number.parseInt(match[3], 16),
        } : null;
    }

    // Returns the actual sample closest to the other two. Unlike averaging,
    // this cannot invent a colour between the app and a stray wallpaper frame.
    _bestColorSample(samples) {
        const distance = (left, right) =>
            (left.red - right.red) ** 2 +
            (left.green - right.green) ** 2 +
            (left.blue - right.blue) ** 2;

        return samples.reduce((best, candidate) => {
            const score = samples.reduce(
                (total, other) => total + distance(candidate, other), 0);
            return !best || score < best.score ? {color: candidate, score} : best;
        }, null).color;
    }

    // WCAG relative luminance. At 0.179, black and white have equal contrast;
    // above it dark foreground content is the more readable choice.
    _isLightColor(color) {
        const linear = channel => {
            const value = channel / 255;
            return value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4;
        };
        const luminance = 0.2126 * linear(color.red) +
            0.7152 * linear(color.green) +
            0.0722 * linear(color.blue);

        return luminance > 0.179;
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
