import { placePowerTemplate, powerTemplates } from "./powers.js";

const MARKER = "swadeHudPowerCast";
const pendingCasts = new Map();
let nextCast = 0;

function selectedModifiers(item, choices, root) {
  const selected = new Set();
  const options = [];
  const add = (...values) => {
    for (const value of values) if (typeof value === "string" && value.trim()) selected.add(value);
  };
  const toggles = new Map(Array.from(root?.querySelectorAll(".swadetools-powermod-check[data-id]") ?? [],
    (input) => [input.dataset.id, input.checked]));
  for (const effect of item.effects ?? []) {
    if (effect.type === "modifier" && !effect.isSuppressed && (toggles.get(effect.id) ?? effect.active ?? !effect.disabled)) {
      add(effect.id, effect.name, effect.flags?.["swade-better-powers"]?.modifierId ?? effect.flags?.["swade-better-setting"]?.modifierId);
    }
  }
  for (const modifier of item.flags?.["swade-better-powers"]?.powerModifiers ?? item.flags?.["swade-better-setting"]?.powerModifiers ?? []) {
    const optionId = choices?.get(modifier.id);
    if (!optionId) continue;
    options.push([modifier.id, optionId]);
    const option = modifier.options?.find((entry) => entry.id === optionId || entry.id + "-max" === optionId);
    add(modifier.id, modifier.name, optionId);
    if (option?.label) add(option.label, modifier.name + " — " + option.label);
  }
  return {modifiers: [...selected], modifierOptions: Object.fromEntries(options)};
}

function setMarker(roll, marker) {
  const term = roll?.terms?.[0];
  if (!term) return;
  term.options ??= {};
  term.options[MARKER] = marker;
}

// SWADE retains the first term when building the confirmed roll. Match the
// operation's own modifier array so overlapping dialogs stay independent.
export async function withPowerCastCard(item, mods, execute) {
  if (!item.uuid || !globalThis.Hooks?.on) return execute();
  const id = ++nextCast;
  pendingCasts.set(id, { item });
  const mark = (_actor, _trait, roll, _modifiers, options) => {
    if (options?.additionalMods === mods) setMarker(roll, id);
  };
  const hooks = ["swadePreRollSkill", "swadePreRollAttribute"].map((name) => [name, Hooks.on(name, mark)]);
  try { return await execute(); }
  finally {
    for (const [name, hook] of hooks) Hooks.off(name, hook);
    pendingCasts.delete(id);
  }
}

export function trackPowerCastDialog(app) {
  const cast = pendingCasts.get(app.ctx?.roll?.terms?.[0]?.options?.[MARKER]);
  if (cast) cast.dialog = app;
}

let openingToolsPower;
const toolsDialogs = new WeakSet();
const wrappedTools = new WeakSet();

export function withToolsPowerCast(item, open) {
  const previous = openingToolsPower;
  openingToolsPower = item;
  try { return open(); }
  finally { openingToolsPower = previous; }
}

export function installToolsPowerCast(ItemDialog) {
  const prototype = ItemDialog?.prototype;
  if (!prototype || wrappedTools.has(prototype) || typeof prototype.processItemFormDialog !== "function") return;
  wrappedTools.add(prototype);
  const show = prototype.showDialog;
  prototype.showDialog = function (...args) {
    if (openingToolsPower && this.item === openingToolsPower) toolsDialogs.add(this);
    return show.apply(this, args);
  };
  const process = prototype.processItemFormDialog;
  prototype.processItemFormDialog = async function (html, roller, actionType) {
    const result = await process.call(this, html, roller, actionType);
    if (!toolsDialogs.has(this) || actionType === "damage") return result;
    const root = html?.querySelector ? html : html?.[0];
    const choices = root?.sbsPowerChoices ?? root?.querySelector(".sbs-casting-modifiers")?.sbsPowerChoices;
    const cast = { itemUuid: this.item.uuid, ...selectedModifiers(this.item, choices, root) };
    const rollSkill = roller.rollBaseSkill;
    roller.rollBaseSkill = async function (...args) {
      const outcome = await rollSkill.apply(this, args);
      setMarker(this.roll, cast);
      return outcome;
    };
    return result;
  };
}

export function decoratePowerCastMessage(message, _data, _options, userId) {
  if (userId !== game.user.id || message.flags?.["swade-hud"]?.powerCast) return;
  const marker = message.rolls?.[0]?.terms?.[0]?.options?.[MARKER];
  const cast = pendingCasts.get(marker);
  const data = cast ? { itemUuid: cast.item.uuid, ...selectedModifiers(cast.item, cast.dialog?.sbsPowerChoices) } : marker;
  if (data?.itemUuid) message.updateSource({ "flags.swade-hud.powerCast": data });
}

export function powerCastRaises(message) {
  const roll = message.rolls?.find((entry) => !entry.isCritFailConfirmationRoll);
  if (!roll || message.isCritfail || roll.isCritfail) return 0;
  if (Number.isFinite(roll.successes)) return Math.max(0, roll.successes - 1);
  // Tools' generic SwadeRoll has a pool but no TraitRoll success getter.
  const dice = roll.terms?.[0]?.dice ?? [];
  const ones = dice.filter((die) => die.total === 1).length;
  if (ones > 1 && ones > dice.length / 2 && !dice.some((die) => die.options?.flavor === "Wild Die" && die.total > 1)) return 0;
  return Math.max(0, Math.floor((roll.total - (roll.targetNumber ?? 4)) / 4) || 0);
}

function templateButtons(templates) {
  if (!templates.length) return;
  const group = document.createElement("div");
  group.className = "card-buttons template-controls";
  const title = document.createElement("h4");
  title.className = "actions-subheading";
  title.innerHTML = '<i class="fa-solid fa-bullseye" aria-hidden="true"></i> ';
  title.append(game.i18n.localize("SWADE.Templates.Available"));
  const buttons = document.createElement("span");
  buttons.className = "flexrow";
  for (const template of templates) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = "template";
    button.dataset.template = template.preset;
    button.textContent = template.label;
    button.title = template.title;
    buttons.append(button);
  }
  group.append(title, buttons);
  return group;
}

export async function renderPowerCastCard(message, html, useItem) {
  const cast = message.flags?.["swade-hud"]?.powerCast;
  const content = html.querySelector(".message-content");
  if (!cast?.itemUuid || !message.isContentVisible || !content || content.querySelector(".swade-hud-power-cast")) return;
  const item = await foundry.utils.fromUuid(cast.itemUuid);
  if (item?.type !== "power"
    || (item.actor?.type === "npc" && !game.user.isGM && game.settings.get("swade", "hideNpcItemChatCards"))) return;
  const data = await item.getChatData({ relativeTo: item, secrets: false });
  const card = foundry.utils.parseHTML(await foundry.applications.handlebars.renderTemplate("systems/swade/templates/chat/item-card.hbs", data));
  if (!message.isContentVisible || content.querySelector(".swade-hud-power-cast")) return;
  card.classList.add("swade-hud-power-cast");
  card.querySelectorAll(".trait-rolls, .template-controls, .pp-controls, .arcane-device-controls").forEach((group) => group.remove());
  const description = card.querySelector(".card-content");
  card.querySelector(".item-name")?.addEventListener("click", () => description?.classList.toggle("expanded"));
  const canUse = Boolean(item.actor?.isOwner);
  if (!canUse) card.querySelectorAll(".damage-rolls, .pp-counter, .macros, .resist-rolls").forEach((group) => group.remove());
  const powers = game.modules.get("swade-better-powers")?.api ?? game.modules.get("swade-better-setting")?.api;
  const castContext = powers?.getCastContext?.(message) ?? {raises: powerCastRaises(message), modifiers: cast.modifiers, modifierOptions: cast.modifierOptions};
  const betterTemplates = game.modules.get("swade-better-templates")?.api;
  const damage = canUse ? card.querySelector(".damage-rolls") : null;
  const tail = damage ?? content.lastChild ?? description;
  // Move the original nodes, retaining SWADE, Tools and Better Effects listeners.
  description.after(...content.childNodes, ...(damage ? [damage] : []));
  if (canUse) {
    const rollDamage = (action, additionalMods) => useItem(item.actor, item, action, undefined, {nativeOnly: true, additionalMods});
    const controls = betterTemplates?.castTemplateControls?.(item, message, castContext, card, rollDamage) ?? templateButtons(powerTemplates(item));
    if (controls) tail.after(controls);
    powers?.wirePowerDamageControls?.(item, message, card, rollDamage);
  }
  for (const button of card.querySelectorAll(":scope > .card-buttons button[data-action]:not([data-sbt-cast-damage], [data-sbp-cast-damage])")) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (button.disabled || !item.actor?.isOwner || item.actor.items.get(item.id) !== item || !message.isContentVisible) return;
      button.disabled = true;
      try {
        const action = button.dataset.action;
        if (action === "template") {
          await placePowerTemplate(button.dataset.template, item, castContext);
        } else {
          let actor = item.actor;
          if (item.system.actions?.additional?.[action]?.type === "resist") {
            const controlled = globalThis.canvas?.tokens?.controlled ?? [];
            if (controlled.length !== 1) return ui.notifications.warn("Select one token to make a resistance roll.");
            actor = controlled[0].actor;
          }
          await useItem(actor, item, action, event, { nativeOnly: true });
        }
      } catch (error) {
        console.error("SWADE HUD | Power cast", error);
        ui.notifications.error(error.message);
      } finally { button.disabled = false; }
    });
  }
  content.replaceChildren(card);
  powers?.renderCastingBreakdown?.(message, html);
}
