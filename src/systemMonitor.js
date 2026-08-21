import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import { ArcBarSystemStat } from './systemStat.js';
import { SystemUsage } from './systemUsage.js';

// Em ordem de preferência. O primeiro de cada lista é o desenho que o
// MacTahoe tem — o gráfico dentro da moldura e o pente de memória; os
// seguintes são o que sobra num tema que não os traga.
const CPU_ICONS = ['utilities-system-monitor-symbolic', 'speedometer-symbolic', 'system-run-symbolic'];
const MEMORY_ICONS = ['media-memory-symbolic', 'ram-symbolic', 'drive-harddisk-symbolic'];
const SYSTEM_MONITOR_DESKTOP_ID = 'org.gnome.SystemMonitor.desktop';

/**
 * CPU e memória, ao lado do relógio.
 *
 * Cada medida abre o Monitor do Sistema quando clicada.
 */
export const ArcBarSystemMonitor = GObject.registerClass(
class ArcBarSystemMonitor extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'arcbar-system-monitor',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });

        this._cpu = new ArcBarSystemStat({
            iconNames: CPU_ICONS,
            accessibleName: 'Uso da CPU — abrir Monitor do Sistema',
            onActivate: () => this._openSystemMonitor(),
        });
        this.add_child(this._cpu);

        this._memory = new ArcBarSystemStat({
            iconNames: MEMORY_ICONS,
            accessibleName: 'Uso da memória — abrir Monitor do Sistema',
            onActivate: () => this._openSystemMonitor(),
        });
        this.add_child(this._memory);

        this._usage = new SystemUsage({ onChanged: () => this._sync() });
        this.connect('destroy', () => this._onDestroy());
        this._usage.enable();
    }

    _sync() {
        this._cpu.setPercent(this._usage.cpu);
        this._memory.setPercent(this._usage.memory);
    }

    _openSystemMonitor() {
        Main.overview.hide();

        const app = Shell.AppSystem.get_default().lookup_app(SYSTEM_MONITOR_DESKTOP_ID);
        if (app) {
            app.activate();
            return;
        }

        try {
            Util.spawn(['gnome-system-monitor']);
        } catch (e) {
            logError(e, '[ArcBar] não consegui abrir o Monitor do Sistema');
        }
    }

    _onDestroy() {
        this._usage?.destroy();
        this._usage = null;
    }
});
