import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ArcBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Aparência',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: 'Barra superior',
            description: 'Escolha como a ArcBar se integra visualmente aos aplicativos.',
        });
        const adaptiveColor = new Adw.SwitchRow({
            title: 'Cor adaptável ao aplicativo',
            subtitle: 'Usa uma versão 20% mais escura da cor do aplicativo sob a barra.',
        });

        settings.bind(
            'adaptive-panel-color',
            adaptiveColor,
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        group.add(adaptiveColor);
        page.add(group);
        window.add(page);
    }
}
