export function bennyPool(actor) {
  const own = Math.max(0, Number(actor?.system?.bennies?.value ?? 0) || 0);
  const gm = actor?.type === "npc" && own === 0;
  const owner = gm ? (game.user?.isGM ? game.user : game.users?.activeGM
    ?? game.users?.find((user) => user.isGM && user.active)
    ?? game.users?.find((user) => user.isGM)) : actor;
  const value = gm ? Number(owner?.bennies ?? owner?.getFlag?.("swade", "bennies") ?? 0) : own;
  return {
    owner, gm, value: Math.max(0, value || 0), label: gm ? "GM Bennies" : "Bennies",
    icon: gm ? "fa-circle-g" : actor?.type === "npc" && (actor.isWildcard ?? actor.system.wildcard) ? "fa-cards" : "fa-circle-b",
    editable: Boolean(actor?.isOwner && owner && (!gm || (game.user?.isGM && owner.id === game.user.id))),
  };
}
