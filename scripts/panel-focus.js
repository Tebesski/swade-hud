export function raiseHudPanel(element) {
  const { ApplicationV2 } = foundry.applications.api;
  // Foundry v14 shares this counter between ApplicationV2 and legacy windows.
  // Clear the active window so clicking that same window can raise it again.
  element.style.zIndex = String(++ApplicationV2._maxZ);
  ui.activeWindow = null;
}
