// Shared desktop quit-confirmation state. The titlebar requests a quit and the
// shutdown overlay reacts to it; both live in app/layout but the concern is
// owned by the desktop feature.
export const desktopShutdownState = $state({
  quitRequested: false,
});
