// SWADE's native dialog retains the original roll terms when it builds the
// confirmed roll. Mark those terms, then attach Tools' chat metadata before the
// message is created. This preserves the native dialog and rolls/resources once.
const MARKER = "swadeHudToolsCard";

export async function withToolsChatCard(context, execute) {
  if (!game.modules?.get("swade-tools")?.active || !globalThis.Hooks?.on) return execute();
  const handlers = [];
  const listen = (name, callback) => handlers.push([name, Hooks.on(name, callback)]);
  const mark = (kind, actor, trait, roll, _modifiers, options) => {
    // This exact array belongs to this HUD operation. Concurrent dialogs and
    // unrelated rolls from the same actor cannot acquire each other's metadata.
    if (options?.additionalMods !== context.mods || !roll?.terms?.[0]) return;
    const item = context.item;
    const flags = {
      useactor: context.actor.id,
      rolltype: kind === "damage" ? "damage" : item ? "skill" : kind,
      userof: options.rof ?? 1,
    };
    const hud = game.modules?.get("swade-hud")?.api;
    const token = context.actor.token ?? (hud?.actor?.uuid === context.actor.uuid ? hud.token?.document : null);
    if (token) flags.usetoken = token.id;
    if (kind === "attribute") flags.attribute = trait;
    if (kind === "skill") flags.skill = trait?.name;
    if (item) { flags.itemroll = item.id; flags.useaction = context.action; }
    if (context.owner?.type === "vehicle") {
      flags.usevehicle = context.owner.id;
      const vehicleToken = context.owner.token ?? (hud?.actor?.uuid === context.owner.uuid ? hud.token?.document : null);
      if (vehicleToken) flags.usevehicletoken = vehicleToken.id;
    }
    roll.terms[0].options ??= {};
    roll.terms[0].options[MARKER] = flags;
  };
  listen("swadePreRollAttribute", (...args) => mark("attribute", ...args));
  listen("swadePreRollSkill", (...args) => mark("skill", ...args));
  listen("swadeRollDamage", (...args) => mark("damage", ...args));
  try { return await execute(); }
  finally { for (const [name, id] of handlers) Hooks.off(name, id); }
}

export function decorateToolsChatMessage(message, _data, _options, userId) {
  if (!game.modules?.get("swade-tools")?.active || userId !== game.user.id) return;
  const flags = message.rolls?.[0]?.terms?.[0]?.options?.[MARKER];
  if (!flags) return;
  message.updateSource({ "flags.swade-tools": {
    ...flags,
    usetarget: [...(game.user.targets ?? [])].map((token) => token.id).join(","),
    ...message.flags?.["swade-tools"],
  } });
}
