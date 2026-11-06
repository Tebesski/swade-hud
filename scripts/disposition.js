export function dispositionDetails(value) {
  const values = globalThis.CONST?.TOKEN_DISPOSITIONS ?? { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1 };
  if (value === values.FRIENDLY) return { value, key: "friendly", letter: "F", label: "Friendly", icon: "fa-face-smile-halo" };
  if (value === values.HOSTILE) return { value, key: "hostile", letter: "H", label: "Hostile", icon: "fa-face-angry-horns" };
  return { value: values.NEUTRAL, key: "neutral", letter: "N", label: "Neutral", icon: "fa-face-meh" };
}

let activeDialog = null;
export function showDispositionDialog(token, anchor) {
  if (!token || token.isOwner === false) return;
  if (activeDialog) {
    activeDialog.cancelled = true;
    return activeDialog.instance?.close();
  }
  const state = { instance: null, cancelled: false };
  activeDialog = state;
  const values = globalThis.CONST?.TOKEN_DISPOSITIONS ?? { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1 };
  const current = dispositionDetails(token.disposition);
  return foundry.applications.api.DialogV2.wait({
    classes: ["swade-hud-modify-disposition"],
    close: () => { if (activeDialog === state) activeDialog = null; },
    content: "",
    window: { title: "Disposition - " + token.name },
    buttons: [values.FRIENDLY, values.NEUTRAL, values.HOSTILE].map((value) => {
      const option = dispositionDetails(value);
      const selected = option.key === current.key;
      return {
        action: option.key, label: option.label, icon: "fa-solid " + option.icon,
        class: selected ? "selected" : "", default: selected,
        callback: () => token.update({ disposition: option.value }),
      };
    }),
    render: (_event, dialog) => {
      state.instance = dialog;
      if (state.cancelled) { dialog.close(); return; }
      requestAnimationFrame(() => {
        if (!anchor?.isConnected) return;
        const bounds = anchor.getBoundingClientRect();
        dialog.setPosition({
          left: Math.max(0, Math.min(innerWidth - dialog.element.offsetWidth, bounds.left + bounds.width / 2 - dialog.element.offsetWidth / 2)),
          top: Math.max(0, bounds.top - dialog.element.offsetHeight - 20),
        });
      });
    },
  });
}
