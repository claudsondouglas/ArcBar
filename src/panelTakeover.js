import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Empties GNOME's own top bar without destroying it.
 *
 * The panel actor itself stays alive and allocated, so struts, the overview
 * layout, fullscreen handling and multi-monitor all keep working — only the
 * built-in indicators (activities, date menu, quick settings, …) are hidden,
 * leaving the bar free for ArcBar's own widgets.
 *
 * Only actors that were visible when we took over are stashed, so restore()
 * puts back exactly what it took away and never reveals something GNOME had
 * legitimately hidden (screen recording indicator, unavailable menus, …).
 */
export class PanelTakeover {
    constructor() {
        this._hidden = new Set();
    }

    /**
     * Hides every foreign panel child. Safe to call again: GNOME re-shows its
     * indicators on session mode changes, so this runs once per 'updated'.
     */
    apply() {
        for (const box of this._boxes()) {
            for (const child of box.get_children()) {
                if (child._arcbar || !child.visible)
                    continue;

                this._hidden.add(child);
                child.hide();
            }
        }
    }

    restore() {
        for (const child of this._hidden) {
            try {
                child.show();
            } catch (_) {
                // actor already destroyed by the shell — nothing to restore
            }
        }
        this._hidden.clear();
    }

    _boxes() {
        const panel = Main.panel;
        return [panel._leftBox, panel._centerBox, panel._rightBox].filter(box => box);
    }
}
