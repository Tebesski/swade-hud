// PF2e HUD's item popup uses the native ApplicationV2 window frame. Retain that
// frame and its item-summary container while enriching SWADE's description.
import { renderItemSummary } from "./item-summary.js";
import { showModifierDialog } from "./modifiers.js";
import { renderItemActions } from "./item-actions.js";
export function createItemPopup(actor, item, { actions = false, anchor } = {}) {
  if (actions) return createShortcutPopup(actor, item, anchor);
  const modify = (spec) => showModifierDialog(actor, actor.token, spec)
    .catch((error) => ui.notifications.error(error.message ?? String(error)));
  class ItemPopup extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["swade-hud-popup"],
      position: { width: 550 },
      window: { resizable: false, minimizable: false },
      actions: {
        "send-to-chat": () => item.show(),
      },
    };
    async _renderFrame(options) {
      const frame = await super._renderFrame(options);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "header-control";
      button.dataset.action = "send-to-chat";
      button.title = "Send to chat";
      button.setAttribute("aria-label", "Send to chat");
      button.innerHTML = '<i class="fa-solid fa-message" aria-hidden="true"></i>';
      frame.querySelector(".window-title")?.insertAdjacentElement("afterend", button);
      if (item.type === "skill") frame.querySelector(".window-title")?.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        modify({kind:"skill",itemId:item.id});
      });
      return frame;
    }
    async _renderHTML() {
      const summary = await renderItemSummary(actor, item);
      summary.addEventListener("contextmenu",(event)=>{
        const target = event.target.closest("[data-modifier]");
        if (!target) return;
        event.preventDefault();
        modify({kind:target.dataset.modifier,itemId:target.dataset.itemId,key:target.dataset.attribute});
      });
      return summary;
    }
    _replaceHTML(result, content) { content.replaceChildren(result); }
  }
  return new ItemPopup({
    id: "swade-hud-item-" + item.id,
    window: { title: actor.name + " - " + item.name },
  });
}

function createShortcutPopup(actor, item, anchor) {
  class ShortcutPopup extends foundry.applications.api.ApplicationV2 {
    shortcutItemUuid = item.uuid;
    static DEFAULT_OPTIONS = {
      classes: ["application", "swade-hud-popup", "swade-hud-shortcut-popup"],
      window: { frame: false, positioned: true, resizable: false, minimizable: false },
      position: { width: "auto", height: "auto" },
    };
    async _renderHTML() {
      return renderItemActions(actor, item, async () => {
        if (!this.element?.isConnected) return;
        await this.render({ force: true });
        this.positionAtShortcut();
      }, { compact: true });
    }
    _replaceHTML(result, content) { content.replaceChildren(result); }
    positionAtShortcut() {
      const target = typeof anchor === "function" ? anchor() : anchor;
      if (!target?.isConnected || !this.element?.isConnected) return;
      const bounds = target.getBoundingClientRect();
      const panel = this.element.getBoundingClientRect();
      const left = Math.max(5, Math.min(innerWidth - panel.width - 5, bounds.left + (bounds.width - panel.width) / 2));
      const above = bounds.top - panel.height - 8;
      const top = above >= 5 ? above : Math.max(5, Math.min(innerHeight - panel.height - 5, bounds.bottom + 8));
      this.setPosition({ left, top });
    }
  }
  return new ShortcutPopup({ id: "swade-hud-shortcut-" + item.id });
}
