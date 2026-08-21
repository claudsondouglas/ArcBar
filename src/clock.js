import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Fixed on purpose: the bar always reads "Qui 20 de Ago 14:44", so the
// desktop's clock-format / clock-show-* keys have nothing left to decide here
// and are no longer watched.
//
// Weekday and month come from the locale (`%a`/`%b`), only the "de" between
// them is ours — but glibc hands those abbreviations over in lowercase, which
// next to a bold time reads as a typo rather than a style. Hence the two
// capitals below: the shape of the line is fixed, the words are still the
// user's language.
function capitalize(text) {
    return text ? text[0].toLocaleUpperCase() + text.slice(1) : '';
}

function formatNow(now) {
    const weekday = capitalize(now.format('%a') ?? '');
    const month = capitalize(now.format('%b') ?? '');
    return `${weekday} ${now.format('%d')} de ${month} ${now.format('%H:%M')}`;
}

/**
 * The clock, at the right end of the bar, just before the network icon: a
 * plain label (no menu). It re-arms itself on the next minute boundary
 * instead of polling.
 */
export const ArcBarClock = GObject.registerClass(
class ArcBarClock extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'arcbar-clock',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });

        this._label = new St.Label({
            style_class: 'arcbar-clock-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this._timeoutId = 0;
        this.connect('destroy', () => this._clearTimeout());
        this._tick();
    }

    _tick() {
        this._clearTimeout();

        const now = GLib.DateTime.new_now_local();
        this._label.text = formatNow(now);

        // seconds is a double (32.451) — align the next wake-up to the boundary
        const delay = (60 - Math.floor(now.get_seconds())) * 1000;

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(delay, 50), () => {
            this._timeoutId = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTimeout() {
        if (!this._timeoutId)
            return;

        GLib.Source.remove(this._timeoutId);
        this._timeoutId = 0;
    }
});
