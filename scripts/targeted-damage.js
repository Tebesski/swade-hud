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
  if (footer.querySelector(`[data-action="${gm ? "bennyGMSoak" : "bennySoak"}"]`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "swade-hud-targeted-soak";
  const verb = app.object.attemptedSoak ? "Reroll Soak" : "Soak";
  button.textContent = `${verb} for ${gm ? "GM " : ""}Benny`;
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
