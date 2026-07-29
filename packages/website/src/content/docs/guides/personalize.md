---
title: Personalize Nerve
description: Configure appearance, zoom, panel layout, notifications, sounds, and shortcuts.
sidebar:
  order: 13
---

## Appearance and layout

Choose system, light, or dark theme. Zoom uses fixed steps from -8 through 8. Panel locations, sizes, visibility, and active tabs persist in browser local storage, so another browser profile starts with its own layout.

## Notifications and sounds

When work completes or needs attention, Nerve chooses the best available delivery:

1. native desktop notification through Electron;
2. browser notification when permission is granted;
3. in-app toast fallback.

Notification sounds are configured independently. A task event inserted into a conversation is not the same as an operating-system notification.

## Keyboard shortcuts

Nerve has fixed shortcuts for creating/searching conversations, tab navigation, send/stop, microphone, cycling mode/permission/thinking, pane navigation, and zoom. Settings displays the current bindings, but they are not currently remappable.

See the [shortcut reference](/reference/shortcuts/) for the exact current list and platform modifier notation.

## Responsive behavior

Below 1024px, use sheet controls to open dock content. Below 640px, phone density reduces control spacing. Zoom is not a substitute for the compact layout; both can apply.

## Next steps

- [Shortcut reference](/reference/shortcuts/)
- [Browser and PWA operation](/operations/browser-pwa/)
