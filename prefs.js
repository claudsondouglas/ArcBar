import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

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

        const appGroup = new Adw.PreferencesGroup({
            title: 'Cores dos aplicativos',
            description: 'A cor detectada é reutilizada na próxima vez que o aplicativo abrir.',
        });
        const detectedColors = this._dictionary(settings, 'app-colors');
        const appIds = Object.keys(detectedColors).sort((left, right) =>
            this._appName(left).localeCompare(this._appName(right)));

        if (appIds.length === 0) {
            appGroup.add(new Adw.ActionRow({
                title: 'Nenhuma cor detectada ainda',
                subtitle: 'Abra um aplicativo com a cor adaptável ativada.',
            }));
        } else {
            for (const appId of appIds)
                appGroup.add(this._createAppRow(settings, appId, detectedColors[appId]));
        }

        page.add(group);
        page.add(appGroup);
        window.add(page);
    }

    _createAppRow(settings, appId, detectedColor) {
        const modes = ['automatic', 'light', 'dark', 'custom'];
        const modeLabels = ['Detectada', 'Clara', 'Escura', 'Personalizada'];
        const savedMode = this._dictionary(settings, 'app-color-modes')[appId] ?? 'automatic';
        const row = new Adw.ActionRow({
            title: this._appName(appId),
            subtitle: appId,
        });
        const dropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(modeLabels),
            selected: Math.max(0, modes.indexOf(savedMode)),
            valign: Gtk.Align.CENTER,
        });
        const customColors = this._dictionary(settings, 'app-custom-colors');
        const colorButton = new Gtk.ColorButton({
            rgba: this._rgba(customColors[appId] ?? detectedColor),
            use_alpha: false,
            valign: Gtk.Align.CENTER,
            visible: savedMode === 'custom',
        });
        const forgetButton = new Gtk.Button({
            icon_name: 'edit-delete-symbolic',
            tooltip_text: 'Esquecer e detectar novamente',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });

        dropdown.connect('notify::selected', () => {
            const mode = modes[dropdown.selected];
            this._setDictionaryEntry(settings, 'app-color-modes', appId, mode);
            colorButton.visible = mode === 'custom';
            if (mode === 'custom' && !this._dictionary(settings, 'app-custom-colors')[appId])
                this._setDictionaryEntry(settings, 'app-custom-colors', appId, detectedColor);
        });
        colorButton.connect('color-set', () => {
            this._setDictionaryEntry(
                settings, 'app-custom-colors', appId, this._hex(colorButton.rgba));
            if (dropdown.selected !== modes.indexOf('custom'))
                dropdown.selected = modes.indexOf('custom');
        });
        forgetButton.connect('clicked', () => {
            for (const key of ['app-colors', 'app-color-modes', 'app-custom-colors'])
                this._deleteDictionaryEntry(settings, key, appId);
            row.visible = false;
        });

        row.add_suffix(dropdown);
        row.add_suffix(colorButton);
        row.add_suffix(forgetButton);
        return row;
    }

    _appName(appId) {
        return Gio.DesktopAppInfo.new(appId)?.get_display_name() ?? appId;
    }

    _dictionary(settings, key) {
        return settings.get_value(key).deep_unpack();
    }

    _setDictionaryEntry(settings, key, appId, value) {
        const dictionary = this._dictionary(settings, key);
        dictionary[appId] = value;
        settings.set_value(key, new GLib.Variant('a{ss}', dictionary));
    }

    _deleteDictionaryEntry(settings, key, appId) {
        const dictionary = this._dictionary(settings, key);
        delete dictionary[appId];
        settings.set_value(key, new GLib.Variant('a{ss}', dictionary));
    }

    _rgba(hex) {
        const rgba = new Gdk.RGBA();
        if (!rgba.parse(hex))
            rgba.parse('#121212');
        return rgba;
    }

    _hex(rgba) {
        const channel = value => Math.round(value * 255)
            .toString(16).padStart(2, '0');
        return `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`;
    }
}
