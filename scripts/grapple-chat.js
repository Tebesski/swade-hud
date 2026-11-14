import { rollSkill } from "./swade.js";

export const isGrapple = item => item?.type === "action" && item.system?.swid === "grapple";
const resolving = new Set();

export function grappleOutcome(grab, resistance, statuses) {
  if (grab.isCritfail || statuses.has("bound") || (!resistance.isCritfail && grab.total <= resistance.total)) return null;
  return grab.total - resistance.total >= 4 || statuses.has("entangled") ? "bound" : "entangled";
}

export async function renderGrappleCard(message, html) {
  if (!message.isContentVisible) return;
  let grapple = message.flags?.["swade-hud"]?.grapple;
  if (!grapple) {
    const flags = message.flags?.["swade-tools"];
    if (flags?.useaction !== "formula" || flags.rolltype !== "skill") return;
    const source = ChatMessage.getSpeakerActor(message.speaker);
    if (!isGrapple(source?.items.get(flags.itemroll))) return;
    const targetIds = flags.usetarget?.split(",").filter(Boolean) ?? [];
    const scene = message.speaker.scene && game.scenes.get(message.speaker.scene);
    grapple = {targetUuid: targetIds.length === 1 ? scene?.tokens.get(targetIds[0])?.uuid : null};
  }
  const content = html.querySelector(".message-content");
  if (!content || content.querySelector(".swade-hud-grapple")) return;
  const grab = message.rolls?.[0];
  if (!Number.isFinite(grab?.total)) return;
  const token = grapple.targetUuid && await foundry.utils.fromUuid(grapple.targetUuid);
  const actor = token?.actor;
  if (content.querySelector(".swade-hud-grapple")) return;

  const row = document.createElement("div");
  row.className = "swade-hud-grapple";
  if (!actor || grab.isCritfail || grapple.resolved) {
    row.textContent = grapple.resolved ?? (grab.isCritfail ? "Grab critically failed." : "Grab requires one targeted token.");
  } else {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Resolve Grab · " + token.name;
    button.disabled = !actor.isOwner || !message.isOwner;
    button.title = button.disabled ? "A GM or an owner of both the roll and defender can resolve Grab." : "Roll the defender’s Athletics";
    button.addEventListener("click", async () => {
      if (button.disabled || resolving.has(message.id) || message.flags?.["swade-hud"]?.grapple?.resolved
        || !actor.isOwner || !message.isOwner) return;
      resolving.add(message.id);
      button.disabled = true;
      try {
        const skill = actor.items.find(item => item.type === "skill" && (item.system.swid === "athletics" || item.name === "Athletics"));
        const resistance = await rollSkill(actor, skill?.id, {title: "Oppose Grapple", flavour: "Oppose Grapple"});
        if (!Number.isFinite(resistance?.total)) return;
        const status = grappleOutcome(grab, resistance, actor.statuses);
        if (status) await actor.toggleActiveEffect(status, {active: true});
        const result = status === "bound" ? "Target is Bound. The grappler is Vulnerable while maintaining the hold."
          : status === "entangled" ? "Target is Entangled." : "Grab did not change the target’s status.";
        await message.setFlag("swade-hud", "grapple", {...grapple, resolved: result});
        row.textContent = result;
      } catch (error) {
        ui.notifications.error("SWADE HUD: " + error.message);
      } finally {
        resolving.delete(message.id);
        button.disabled = false;
      }
    });
    row.append(button);
  }
  content.append(row);
}
