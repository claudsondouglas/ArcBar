# ArcBar — instructions for Claude

A minimal top bar for GNOME Shell: CPU/memory on the left, notifications in the middle, clock,
network, sound and power on the right, flat `#121212` background. It **takes over** GNOME's panel
instead of replacing the actor.

## How to reload after editing JS

- **Xorg:** `Alt+F2` → `r` → `Enter`.
- **Wayland (this machine):** `gnome-extensions disable ArcBar@claudson; gnome-extensions enable
  ArcBar@claudson` re-runs `enable()`, but GNOME 46+ keeps the ESM modules in memory — edits to
  `src/*.js` often stay invisible. If new logs don't appear, log out and back in.
- CSS-only edits reload with the shell; there is no cheaper reliable trick.
- Logs: `journalctl -f -o cat /usr/bin/gnome-shell | grep ArcBar`.
- To test an edit **without** logging out, run a throwaway shell that loads the files fresh:
  `dbus-run-session -- gnome-shell --headless --virtual-monitor 1280x720`. It reads the same dconf,
  so the extension is already enabled there, and it prints this extension's logs to stdout. It even
  renders: `new Shell.Screenshot().screenshot_area(x, y, w, h, stream)` (promisified — no callback)
  writes a PNG from inside the session, which is the only way to look at a menu, since the
  `org.gnome.Shell.Screenshot` D-Bus method answers "Screenshot is not allowed" to anything that is
  not the portal.

## Architecture

```
extension.js             — ArcBarExtension.enable/disable: takeover + widgets + panel style class.
src/
├── panelTakeover.js     — PanelTakeover: hides/restores GNOME's own panel children.
├── panelTransparency.js — PanelTransparency: toggles the `arcbar-panel-transparent` class.
├── clock.js             — ArcBarClock: right-hand label, fixed `Qui 20 de Ago 14:44`.
├── systemUsage.js       — SystemUsage: CPU and memory percentages, sampled from /proc.
├── systemStat.js        — ArcBarSystemStat: one measure (icon + percentage).
├── systemMonitor.js     — ArcBarSystemMonitor: the two stats, at the far left.
├── backgroundApps.js    — BackgroundAppsModel: systemd's app scopes minus the ones with windows.
├── backgroundAppIcon.js — ArcBarBackgroundAppIcon: one background app's icon, click to raise it.
├── backgroundAppsIndicator.js — ArcBarBackgroundApps: the row of them, right of the stats.
├── glassEffect.js       — applyGlass(): Shell.BlurEffect in BACKGROUND mode.
├── glassMenu.js         — applyGlassMenu(): turns a PopupMenu into that glass surface.
├── notifications.js     — NotificationsModel: reads Main.messageTray, dismisses, clears.
├── appIcon.js           — createSourceIcon(): the source's app icon, from the icon theme.
├── notificationRow.js   — ArcBarNotificationRow: one list row (icon, title, body, time, x).
├── notificationButton.js— ArcBarNotificationButton: centre PanelMenu.Button + the list menu.
├── network.js           — NetworkModel: NetworkManager's wired state → an icon name.
├── networkButton.js     — ArcBarNetworkButton: right PanelMenu.Button, menuless; opens Settings.
├── volume.js            — VolumeModel: the shell's Gvc mixer; output + one stream per app.
├── volumeRow.js         — ArcBarVolumeRow: one row (icon button, name, percentage, slider).
├── volumeButton.js      — ArcBarVolumeButton: right PanelMenu.Button + the sliders menu.
└── powerButton.js       — ArcBarPowerButton: right PanelMenu.Button, 4 SystemActions entries.
```

One class = one file = one responsibility.

### Why the panel is reused, not replaced

Building a separate chrome bar means owning struts, the overview layout, fullscreen and
multi-monitor by hand. Keeping GNOME's `Main.panel` actor alive and merely emptying it gets all of
that for free, and every step of `enable()` is undone by a `show()` or a `destroy()` of our own
actors — the shell's widgets are never touched destructively.

The catch: `Panel._updatePanel()` re-shows the built-in indicators on every session mode change,
so `PanelTakeover.apply()` is re-run from the `Main.sessionMode` `'updated'` handler — and from
`extension-state-changed`, since another extension can drop a button in the panel at any time. `apply()`
stashes only actors that were **visible** when it ran and skips anything flagged `_arcbar`, so
`restore()` puts back exactly what it hid.

### Transparency

The bar is only painted `#121212` when a window of the active workspace actually reaches the panel
strip on the primary monitor; on the bare desktop and in the overview it goes transparent. State
lives in a single style class (`arcbar-panel-transparent`) so every colour stays in
`stylesheet.css`, and `disable()` only has to drop the class.

`PanelTransparency` connects to each managed window (`position-changed`, `size-changed`,
`notify::minimized`, `workspace-changed`) plus `window-created`, workspace/monitor changes and the
overview's `showing`/`hiding` — `Main.overview.visibleTarget` is already correct while those
animations run, so both ends share one handler.

### Notifications

The centre of the bar is `ArcBarNotificationButton`: the icons of the apps that have something
pending (three at most) next to the total, and a menu with one row per notification. With nothing
pending the whole button leaves the bar — the hidden actor is `container`, the one the panel
allocates, so an invisible button does not keep holding its slot in the middle; and the menu is
closed along with it, since dismissing the last row would otherwise pull the button out from under
an open menu.

`NotificationsModel` keeps **no copy** of anything — every read walks `Main.messageTray` again.
That is what keeps this list and the shell's own banners from ever disagreeing: dismissing a row
here is the same `Notification.destroy(DISMISSED)` the banner's `x` calls, so the notification
leaves the bar, the banner queue and the date menu at once. It is also why the model connects with
`connectObject()` instead of the manual handler arrays the rest of the extension uses — sources
and notifications are destroyed by whoever created them, and the shell's tracker drops the
handlers of a dead source on its own.

Two things are deliberately lazy. The row list is only built when the menu **opens** (a file copy
notifying once a second would otherwise rebuild rows nobody is looking at), and every rebuild goes
through an idle: dismissing a row destroys the very button that is in the middle of emitting its
`clicked`, and "Limpar tudo" fires one change per notification — the idle turns both into a single
rebuild, after the click is over.

The icon of a row — and of the bar indicator — is the **app's**, resolved through
`Shell.App.create_icon_texture()` in `src/appIcon.js`, exactly as ArcDock's app grid resolves its
own. The obvious source, `notification.gicon`, is not the same picture: it is whatever the app
*sent* (`image-path`/`image-data`), i.e. the PNG bundled inside it, so a Firefox or a Telegram row
was the only thing on a screen full of themed icons that ignored the icon theme. The app never
changes over a notification's life, so the icon is built once per row instead of following
`notify::gicon`. Finding the `Shell.App` takes four tries because there are four owners: the fdo
daemon keeps it in `source.app`, the GTK one in `source._app`, the policy carries the `.desktop`
id — which is where the shell got the app from in the first place — and, failing all three, the
`WM_CLASS` of the app's window goes through the same three tables the shell itself uses to match a
window to a `.desktop` (`lookup_desktop_wmclass`, `lookup_startup_wmclass`, then the basename
guess).

That fourth try is the one that matters, because `source.app` being set is not the same as an app
being found: when no `.desktop` matches, the shell still hands out a `Shell.App` — a **window-backed**
one, invented from the window — and its icon is whatever the window carries, which is the bundled
PNG again. `installed()` in `src/appIcon.js` is the filter (`is_window_backed()` plus a real
`get_app_info()`); only what survives it is worth an icon. ArcDock's grid never hits this because it
lists installed apps only. With no installed app at all, the last resorts are, in order, the first
name the icon theme actually has (`St.IconTheme.has_icon()` over the source's themed-icon names, the
`WM_CLASS` and the app name) and only then the raw image — an off-theme icon still says which app
notified, which a generic glyph would not.

Opening the menu also marks everything `acknowledged`, which is the flag the shell reads to decide
whether a banner is still owed — without it the same notification would pop up again after being
read here.

### CPU and memory

The left end of the bar, one icon + percentage per measure — no caption: the graph and the memory
stick already say which is which, and the word under each number cost a second line of text inside a
32px panel. `SystemUsage` reads `/proc` on a 2s timer, synchronously: the file is built by the kernel on read, never touches a disk, and arming an
async `GFile` twice a second would cost more than the read itself.

Neither number is in the file directly. `/proc/stat` counts jiffies **since boot**, so CPU use only
exists as the difference between two samples — that previous sample is the single piece of state the
model keeps. `iowait` is counted as idle (a file copy is the machine waiting on a disk, not
computing, and adding it would show 100% on any copy). The first read, with nothing to subtract from,
falls back to the since-boot average: a lukewarm number, but an honest one, and it is replaced two
seconds later — showing `0%` until then would be inventing a value. Memory is `MemTotal -
MemAvailable`, not `MemFree`: `MemAvailable` is the kernel's own estimate of what a new app could
take without swapping, while `MemFree` counts the whole disk cache as used and would sit near 100% on
any machine that has been up for a while.

The font size is given in **px** and not in `em`: `em` here is the panel's, which the user's theme
decides, and a bar whose height changes with the theme is not a bar. Icon names go through `St.IconTheme.has_icon()` (the same care as `src/appIcon.js`, for
the same reason: an unknown `icon_name` is not an empty space, it is the broken-image glyph), and
monitor icons are exactly the ones that vary from theme to theme — hence a list per measure rather
than one name.

### Background apps

Right of the two percentages, one icon per app that is **running with no window** — the app that
was closed to a tray that GNOME does not draw. Clicking one brings it back.

The obvious source is the wrong one. `org.freedesktop.background.Monitor`, the portal interface
behind GNOME's own "Background Apps" menu, builds its list from what an app *declared* through
`org.freedesktop.portal.Background.SetStatus`, so only a sandboxed app that bothers to call it ever
appears. On this machine, with Discord closed to the tray for an hour, it answers `[]`.

What does know is **systemd**. Every app the shell launches gets a scope in the user manager's
`app.slice` — `app-gnome-discord-5876.scope` — and that scope outlives windows, tray icons and
portals; it dies with the app's last process. `ListUnitsByPatterns(['active'], ['app-*.scope'])` on
the session bus is therefore the list of apps that are alive, and intersecting it with
`get_n_windows() === 0` is the whole definition of "in the background". Minimised is not
background: a minimised window is still a window.

Two things follow from the two halves having different costs. The scopes are re-listed only when
systemd says a unit was born or died — which needs a `Subscribe()` first, or the manager never
emits `UnitNew`/`UnitRemoved` at all — while the window filter is redone from scratch on every
`tracked-windows-changed`, because that one is local and free. Both go through one idle, for the
same reason the notification list does: opening an app fires the scope's `UnitNew` and several
window changes in a row, and each of them would rebuild the icon row in the middle of the last.

Turning a unit name into a `.desktop` id is a guess that is never guessed. The grammar is
`app-[launcher-]<escaped id>-<pid>.scope`, and neither half has a delimiter of its own — `gnome` is
a launcher in `app-gnome-discord-…` and part of the id in `gnome-terminal`. So
`desktopIdsFromUnit()` drops the trailing pid, unescapes systemd's `\xNN`, and returns *both*
readings; `appForDesktopId()` decides which one exists. That is what resolves
`app-gnome-brave\x2dbrowser-6488.scope` to `brave-browser.desktop`, and what silently drops
`app-org.chromium.Chromium-6496.scope` — a Brave child process whose scope names no installed app.
An app with two scopes (the launcher's and the nested one, as Discord has) collapses into one icon
because the map is keyed by the resolved app.

`should_show()` is the line between an app and a session daemon: both get scopes, but the daemon's
`.desktop` is `NoDisplay=true` and nobody "left it open".

Clicking calls `Shell.App.activate()`, which with no windows is the same launch the app grid does —
a single-instance app shows the window it already had instead of opening a second. The icon then
removes itself, because that new window reaches the model through `tracked-windows-changed`.

With nothing in the background the whole widget leaves the bar: the actor is a direct child of
`_leftBox`, and a box skips an invisible child along with the `spacing` that would come with it.

### The clock, and where things sit

Left to right: CPU and memory on the far left, notifications in the middle, then clock, network,
sound and power on the right. The clock is a plain label, not a `PanelMenu.Button`, so it goes into
`_rightBox` with `insert_child_at_index()` — and it goes in **after** the three buttons, because
`addToStatusArea()`'s position is an index in the whole box: inserted first, it would be pushed
right by the next button asking for index 0.

The line reads `Qui 20 de Ago 14:44`. Weekday and month come from the locale (`%a`/`%b`) and only
the "de" between them is ours, but glibc hands those abbreviations over in lowercase (`qui`, `ago`),
which next to the bold time reads as a typo rather than a style — hence the two capitals in
`formatNow()`. Everything else about the shape is fixed, so the desktop's `clock-format` /
`clock-show-*` keys still have nothing to decide here.

Every gap on the bar is 8px, but it is not always the same lever. On the left, where the widgets
are bare labels and icons, it is the **`spacing` of the panel box**: a box skips an invisible child
and the space that would come with it, which is exactly what is needed while the takeover keeps
GNOME's own indicators hidden inside those same boxes. On the right, where the three items are
buttons with a click target of their own, `spacing` is zero and the 8px is measured between the
**highlights** — see *Hit targets*. The background-app icons are the exception on that side: they are buttons with a
highlight, so they follow the right-hand rule instead — `spacing: 0` and 4px of transparent border,
which puts 8px between two highlights and 12px between the memory percentage and the first one. The
extra 4px is welcome there: a number and an app icon are not the same kind of thing. The only 4px
left is inside a measure, between its icon and its percentage: those two are one thing, and spacing them like CPU is spaced from memory would break the
two pairs into four loose items. Distances to the screen edges are padding (`.arcbar-system-monitor`
on the left, `#panelRight` on the right).

### Hit targets

Network, sound and power are **40×40** — square, and the same square the panel is tall. The height
was never in question (a `PanelMenu.Button` is `y_expand`, so it fills the 40px the theme gives
`#panel`); the width is, and the only lever for it is the hpadding, because
`ButtonBox.vfunc_get_preferred_width` measures the child plus `2 * hpadding` and — in GNOME 50 —
does not even run the theme node's `adjust_preferred_width`, so the button's own `padding` and
border add nothing. With the glyph at 16px, `(40 - 16) / 2 = 12px` per side closes the square. It
used to be zero: the button was then exactly as wide as its glyph, a 16×40 slit that had to be
aimed at. The 4px the theme puts around every `.system-status-icon` is still zeroed, and that line
is now part of the arithmetic — with it the child measures 24px and the button comes out 48 wide.

The 12px is a number derived from a 40px panel, and the panel's height belongs to the user's theme:
another theme squares nothing. That is the same trade already made for the bar's height itself.

What one actually sees is the highlight, and its size is decided by the transparent border MacTahoe
hides it inside (6px, `!important`); at 4px it is a 32×32 square concentric with the target. That
border is also the gap: with `#panelRight`'s `spacing` at zero, two neighbouring highlights are
4 + 4 = the same 8px apart as everything else, and `padding-right: 4px` completes 8 to the screen
edge. Adding `spacing` on top of two 12px hpaddings would have thrown the glyphs 32px apart —
three loose keys instead of a group. The clock is not a button and carries neither hpadding nor
border, so it gets `padding-right: 4px` of its own to keep the same 8px off the first highlight.
The `border-radius` is 10px rather than the theme's `9999px`: a pill of that width is a circle, and
a 32px disc behind a 16px glyph reads as a radio button that is switched on. The notification
button cannot be square (its width is the row of app icons plus the count), but it takes the same
border and radius, or it would be the one 28px-tall pill in a bar of 32px keys.

The white is never flat: `rgba(255, 255, 255, 0.9)` on icons and `0.8` on text (clock, percentages,
notification count). Over the bar's `#121212`, pure white hits hard enough to pull the eye to the
chrome before the windows.

### Network

A wired icon that opens Settings ▸ Network. It is a `PanelMenu.Button` built with the third
argument, `dontCreateMenu`: without it the button would carry a `PopupMenu` that nothing ever opens.
`vfunc_event` answers the press itself and returns `EVENT_STOP` so the click never reaches the
button's own menu handling, and `vfunc_key_press_event` does the same for Enter/Space.

The panel is asked for by `.desktop` id (`gnome-network-panel.desktop`), through
`Shell.AppSystem.lookup_app().activate()` — the same route the shell's own menu takes, so the window
opens straight on the right page and under the same app as everywhere else, instead of a loose
process. `Util.spawn(['gnome-control-center', 'network'])` is only the fallback for a desktop where
that id does not exist. The overview is hidden first, or the window would open behind it.

`NetworkModel` reads the same NetworkManager the shell's own indicator reads, so the two icons can
never disagree, and only Ethernet devices count — Wi-Fi and VPN have their own icons and are not what
this button says. The client is created **async**: that first call goes over D-Bus, from inside
`enable()`, and blocking the main loop there blocks the whole session as it opens. It is created with
the callback form rather than `await`, because `NM.Client.new_async` may already have been promisified
by the shell's `status/network.js` — GJS's wrapper hands back to the original function as soon as it
sees a callback among the arguments, so the callback form works either way. An activated device wins
over every other state: on a machine with two ports, the one that works is the answer.

### Volume

The right side is, left to right, clock, network, sound then power. The order of the three buttons
is the `position` of `addToStatusArea()` — the index of `insert_child_at_index()`, counted from the left — and not CSS;
the foreign children the takeover hid are still in the box, but an invisible actor holds no slot.

`VolumeModel` (src/volume.js) keeps **no copy** of anything either, and the control it reads is the
shell's own: `getMixerControl()` hands out the singleton every `Gvc.MixerControl` user in the
process shares, so a slider here and the quick settings' slider are two views of one PulseAudio
connection and can never disagree. Being borrowed, it is never `close()`d in `destroy()` — that
would take the whole shell's audio down with the extension.

The apps are the sink inputs, minus the event streams (the notification "pop", which would flash a
row for half a second) and the virtual ones (recorder plumbing). `stream-removed` only carries the
id of something already dead, so the model remembers which ids the list is showing — otherwise
there is no way to tell a departing app from a departing beep. Rows are built when the menu
**opens** and rebuilt through an idle, for the same reasons the notification list is.

One row class serves both halves of the menu: system and app do the same thing to the same
`Gvc.MixerStream`, and only the icon differs — the output's is the level glyph (rebuilt on every
volume change), an app's is the app icon, which cannot change while it plays. The icon is a button
that mutes and unmutes; a muted app row keeps its icon and dims it, because swapping in a crossed
speaker would erase the one thing the row exists to say (*whose* sound this is).

Identifying the app behind a stream is the notification problem again with a worse starting point:
PulseAudio hands out no `.desktop` id at all (`application.id` is almost never set), so
`appForStream()` in src/appIcon.js reuses the same cascade over `application.name` and
`application.icon_name` — the latter is usually the `.desktop`/icon basename ("brave-browser" for a
stream that calls itself "Brave"), which is what actually resolves most of them.

Writing a volume takes `set_volume()` **and** `push_volume()`; the first only moves the local
object. The push is skipped when `set_volume()` returns false, as in the shell — but note that
value is compared against the local cache, which only catches up when the server confirms, so two
changes inside one round trip collapse into one. That is invisible at pointer speed and shows up
only if something drives the slider programmatically.

Scrolling the bar button delegates to the master row's slider (`step()`), which already owns the
step size and the ceiling, and shows the OSD only while the menu is closed — with it open the
slider itself is the answer.

The size of the three buttons — 40×40, with a 32×32 highlight and 8px between highlights — is in
*Hit targets*, above. The distance to the screen edge, which used to be the power button's hpadding,
is `padding-right` on `#panelRight`: an ordinary `St.BoxLayout`, which unlike the buttons does
respect padding.

The slider has to be restyled from scratch: `.slider` in MacTahoe-Light was drawn for the shell's
**dark** quick settings (white active bar, transparent handle until hover), which over this light
glass is white on white — the control would simply not be there. Ink is `#242424`, the same as the
labels, because no menu in this bar uses the accent colour. The icon column has a fixed 36px box:
the level glyph is symbolic and the app icon is themed art, two different sizes, and without a
fixed column each row would start its slider at a different x.

### Power actions

`SystemActions.getDefault().activateAction(id)` — `power-off`, `restart`, `suspend`, `logout`.
Going through the shell's own object keeps the confirmation dialogs, inhibitor handling and
lockdown/GDM settings identical to stock GNOME; each item binds its `can-*` property to `visible`,
so an unavailable action disappears instead of failing silently.

The menu spells out every colour in `stylesheet.css` (label, icon, hover, separator), and several
selectors carry `!important` — that is the price of living with a user theme. MacTahoe-Light stamps
`!important` on nearly every `.popup-menu-item` line (accent-blue hover, `border-radius: 10px`,
`text-shadow: none`), and without answering in kind the highlight reverts to the theme's blue on top
of our glass. Its `margin: 4px 12px 17px 12px` on `.popup-menu-content` has to be zeroed too: the
blur backdrop's constraints hang off that actor's allocation, so an asymmetric margin throws the
blur rectangle outside the glass.

"Reiniciar sessão" is the `logout` action: it ends the session and returns to GDM. There is no
in-place shell restart on Wayland.

### The glass menu

`applyGlassMenu()` (src/glassMenu.js) is what all three menus — power, sound and notifications —
are made of; it lives in its own file precisely because two copies of it would be two glasses that
drift apart at the first tint tweak. The separator is styled off `.arcbar-glass-menu` for the same
reason: the power menu and the sound menu both draw one, and there was no reason for the two to be
different lines. Its shape is ArcTab's alt-tab box (`../ArcTab@claudson/stylesheet.css`,
`.arctab-panel`) — three-tone hairline rim, blurred backdrop, same rounded body — but the **tint
is the dock's**: `rgba(245, 245, 245, 0.92)`, the `.popup-menu-content` of MacTahoe-Light, which is
what ArcDock's own context menu shows. It is the only other menu that hangs off this bar/dock pair,
and two near-identical greys side by side would read as a mistake rather than a style.

That ground is light, and everything that used to depend on a dark one flips with it: labels are
`#242424` (the theme's), the rim inverts from highlight to shadow — over light glass it is the
*shadow* that draws an edge, so the top hairline nearly vanishes and the bottom is the deepest —
the hover veil sinks instead of lighting up, and the `text-shadow`/`icon-shadow` are gone. Those
shadows existed to hold white text up when the wallpaper came through a 0.32 tint; at 0.92 almost
nothing comes through, and a dark shadow under dark text only muddies the line. The tint is also
flat, not a gradient: the vertical gradient reads as refraction only while the tint is weak — in a
near-opaque grey the same variation reads as a stain on one side of the menu.

The blur stays, though it earns much less now: at 8% transparency it is no longer what makes the
text legible, only what keeps the little that shows through from being pixel noise inside the grey.
The one thing still not copied from ArcTab is the drop shadow, at all: the switcher floats alone
mid-screen and would look cut out and pasted without one, while this menu hangs off the button
right above it — the anchor already says where it came from, and the rim draws the glass edge. All
the shadow ever did here was paint a dark band around the menu.

Getting there costs three moves, all in `applyGlassMenu()`:

1. The `BoxPointer` paints its own background and arrow in an `St.DrawingArea` that knows neither
   `border-radius` nor gradients, so it is blanked (`-arrow-background-color: transparent`) and
   `.popup-menu-content` becomes the thing that draws the body. `-arrow-rise` stays: with no arrow
   drawn it is just the gap between bar and menu.
2. `Shell.BlurEffect` always paints a **rectangle** — on the content itself the blur would escape
   the rounded corners, so it lives on its own actor behind it, inset `r * (1 - 1/√2)`. That actor
   is sized by two `Clutter.BindConstraint`s (POSITION `+inset`, SIZE `-2*inset`) rather than by our
   own `allocate()`: `BoxPointer.vfunc_allocate` only ever allocates `bin` and `_border`, so a third
   child of it would stay 0×0. The inset covers the corners but not the edges: the effect inflates
   its paint volume by the sigma and draws the blur *outside* the actor, which over a contrast
   boundary (a window's dark titlebar meeting a white page) smears a grey halo all around the menu.
   That takes a clip, and the clip goes on a **parent** actor — an actor's clip is pushed on the
   framebuffer before descending into its children, so there it certainly catches the effect's
   output, which is not guaranteed when clip and effect live on the same actor.
3. Background blur samples the framebuffer *behind* the actor, and `BoxPointer` sets
   `OffscreenRedirect.ALWAYS` — inside that buffer there is no background to sample. Back on
   `AUTOMATIC_FOR_OPACITY` the redirect only lasts as long as the opening fade.

The notification rows borrow the rest of ArcTab's list vocabulary (icon left, strong title, faded
subtitle, rounded row), and both menus highlight the same way. Unlike ArcTab, that highlight is
luminosity, not the blue accent ring: there the ring marks a keyboard selection the user hunts for
while hammering Tab, here it would blink under every pass of the pointer. Its direction follows the
ground rather than taste — over this light glass the row **sinks** under a dark veil; the white veil
that lit a row up over the old smoked tint would only wash out the dark label it is meant to pick
out.

The `!important`s stay for a different reason than the shadows did: MacTahoe-Light stamps them on
nearly every `.popup-menu-item` line (accent-blue hover, `border-radius: 10px`), so without
answering in kind the highlight reverts to the theme's blue on top of our glass.

## Session modes

`user` only — on lock the extension is disabled, GNOME's panel is restored for the lock screen,
and `enable()` runs again on unlock.
