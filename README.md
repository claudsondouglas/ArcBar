# ArcBar

A minimal top bar for GNOME Shell: CPU/memory usage on the left, notifications in the middle, clock,
network, sound and power on the right, flat `#121212` background. ArcBar takes over GNOME's
own panel — it hides the built-in indicators (activities, date menu, quick settings) and puts its
own widgets in their place, so struts, the overview and fullscreen keep behaving exactly like stock
GNOME. Disabling the extension puts everything back.

On the desktop and in the overview the bar is transparent; it turns solid as soon as a window
reaches the top of the screen. Every item is 8px from the next, and neither the icons nor the text
are pure white — they are slightly translucent, so the bar does not out-shout the windows.

## CPU and memory

On the left end of the bar, the current CPU and memory use, each as an icon and a percentage. Click
either measure to open GNOME System Monitor.
Both are read from `/proc` every two seconds: CPU is the average over that interval (disk waits
don't count as use), and memory is what is actually taken, with the disk cache counted as free —
the same reading the kernel gives an app that asks how much room is left.

## Notifications

The centre of the bar shows the icons of the apps that have pending notifications (up to three)
next to the total count; with nothing pending it falls back to a dim bell. Clicking it opens a
glass menu with one row per notification — app icon, title, body and time:

- clicking a row activates the notification (opens the app) and dismisses it;
- the `x` on the right dismisses it without opening anything;
- "Limpar tudo" dismisses every notification at once.

The list is the shell's own message tray, not a copy of it, so dismissing a row here also removes
the notification from GNOME's date menu, and vice versa.

## Clock

At the right end of the bar, just before the network icon: `Qui 20 de Ago 14:44`. The weekday and
the month come from the system's language; the rest of the shape is fixed.

## Network

A wired network icon, showing whether the cable is connected, connecting or out.
Clicking it opens GNOME Settings straight on the network page.

## Volume

The speaker icon sits between the network and power buttons. Scrolling over it changes the system
volume without opening anything (with an OSD, like stock GNOME); clicking it opens a glass menu
with:

- **Sistema** — the default output: icon, percentage and slider;
- **Aplicativos** — one row per app currently playing something, each with its own slider, so a
  video can be turned down without touching the music.

Clicking the icon of any row mutes and unmutes that row alone; a muted app keeps its icon, dimmed.
The apps show up and leave the list on their own as they start and stop playing.

Everything goes through the same mixer the shell itself uses, so these sliders, the volume keys and
the quick settings panel always show the same numbers.

## Power menu

- Desligar
- Reiniciar
- Suspender
- Reiniciar sessão (encerra a sessão e volta para o GDM)

All four go through the shell's own `SystemActions`, so confirmation dialogs and lockdown settings
behave like stock GNOME, and an unavailable action simply doesn't show up.

## Install

Already in place at `~/.local/share/gnome-shell/extensions/ArcBar@claudson`.

```
gnome-extensions enable ArcBar@claudson
```

On Wayland a newly created extension is only picked up after logging out and back in.
