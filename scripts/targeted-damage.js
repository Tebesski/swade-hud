import {t as sbsI18n} from "./i18n.mjs";
export const TARGETED_DAMAGE_SOAK_SETTING = "fixTargetedDamageSoak";
const soaking = new WeakSet();

function soakSpender(app) {
  if (!game.settings.get("swade-hud", TARGETED_DAMAGE_SOAK_SETTING)
    || !(app.object?.wounds > 0) || !app.actor?.isOwner || !app.actor.system?.attributes?.vigor) return;
  if (app.actor.bennies > 0) return app.actor;
  if (game.user.isGM && game.user.bennies > 0) return game.user;
}

export function patchTargetedDamageDialog(app, html) {
  if (!game.modules.get("swade-targeted-damage")?.active) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const footer = root?.matches?.(".swade-targeted-damage.targeted-damage-applicator")
    && root.querySelector(".targeted-damage-applicator-footer");
  if (!footer) return;

  // Use Foundry's window-close action for the no-damage footer button.
  const closeButton = footer.querySelector('button[data-action="noDamage"]');
  if (closeButton) closeButton.dataset.action = "close";

  if (typeof app.attemptSoak !== "function") return;
  const spender = soakSpender(app);
  const existing = footer.querySelector(".swade-hud-targeted-soak");
  if (!spender) { existing?.remove(); return; }
  if (existing) return;
  const gm = spender === game.user;
  if (footer.querySelector(`[data-action="${gm ? sbsI18n("swade-hud.UI.bennyGMSoak_173f35847c") : sbsI18n("swade-hud.UI.bennySoak_92fcae6188")}"]`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "swade-hud-targeted-soak";
  const verb = app.object.attemptedSoak ? sbsI18n("swade-hud.UI.RerollSoak_783cb422a4") : sbsI18n("swade-hud.UI.Soak_5118a9fc52");
  button.textContent = sbsI18n("swade-hud.UI.forBenny_efb077bf63", {p0: (verb), p1: (gm ? "GM " : "")});
  button.addEventListener("click", async () => {
    if (soaking.has(app) || soakSpender(app) !== spender) return;
    soaking.add(app);
    button.disabled = true;
    try {
      const isReroll = app.object.attemptedSoak;
      if (await spender.spendBenny() !== false) await app.attemptSoak({ isReroll });
    } catch (error) {
      console.error("SWADE HUD | Targeted Damage", error);
      ui.notifications.error(error.message);
    } finally {
      soaking.delete(app);
      button.disabled = soakSpender(app) !== spender;
    }
  });
  const anchor = footer.querySelector('button[data-action="freeSoak"], button[data-action="applyShaken"], button[data-action="takeWounds"]');
  if (anchor) anchor.before(button);
  else footer.append(button);
}
