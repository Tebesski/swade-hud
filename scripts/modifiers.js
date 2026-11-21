import {t as sbsI18n} from "./i18n.mjs";
import { ATTRIBUTES, localize } from "./swade.js";
let nextDialogId = 0;

export function modifierTarget(actor, spec) {
  if (!actor?.isOwner) return null;
  switch (spec.kind) {
    case "pace": return actor.system.pace ? {
      label: sbsI18n("swade-hud.UI.Pace_9582b504fe"), key: "system.pace." + (actor.system.pace.base || "ground"), img: "icons/svg/wingfoot.svg", pace: true,
    } : null;
    case "attribute": {
      const attribute = ATTRIBUTES.find(([key]) => key === spec.key);
      return attribute && actor.system.attributes?.[spec.key] ? {
        label: localize(attribute[1], spec.key), key: "system.attributes." + spec.key + ".die.modifier",
      } : null;
    }
    case "skill": {
      const item = actor.items.get(spec.itemId);
      return item?.type === "skill" ? { label: item.name, key: "@Skill{" + item.id + "}[system.die.modifier]", img: item.img } : null;
    }
    case "toughness":
    case "armour": return { label: sbsI18n("swade-hud.UI.ToughnessArmour_7b80a31844"), key: "system.stats.toughness.value", armour: true };
    case "parry": return { label: sbsI18n("swade-hud.UI.Parry_e5567f841f"), key: "system.stats.parry.value" };
    case "powerPoints": return actor.system.powerPoints?.[spec.pool] ? {
      label: (spec.pool === "general" ? "" : spec.pool + " ") + "Power Points",
      key: "system.powerPoints." + spec.pool + ".value",
    } : null;
    default: return null;
  }
}

export async function createModifierEffect(actor, token, spec, values, direction) {
  const target = modifierTarget(actor, spec);
  if (!target || !actor.isOwner) return;
  const amount = Math.abs(Number(values.amount));
  const running = target.pace ? Math.abs(Number(values.running ?? 0)) : 0;
  const armour = target.armour ? Math.abs(Number(values.armour ?? 0)) : 0;
  const duration = Number(values.duration);
  const units = values.units;
  if (![amount, running, armour, duration].every(Number.isFinite) || duration <= 0 || !["rounds", "minutes", "hours"].includes(units)) {
    throw new Error(sbsI18n("swade-hud.UI.Entervalidmodifiersandapositive_fcc80639df"));
  }
  if (!amount && !running && !armour) throw new Error(sbsI18n("swade-hud.UI.Enteranonzeromodifier_2b2c5f4ace"));
  const change = (key, value) => ({ key, type: "add", value: direction * value, phase: "initial" });
  const changes = [];
  if (amount) {
    // SWADE applies this modifier to the attribute and to skills linked to it.
    const key = spec.kind === "attribute" && values.linkedSkills
      ? "system.stats.globalMods." + spec.key : target.key;
    changes.push(change(key, amount));
  }
  if (running) changes.push(change("system.pace.running.mod", running));
  if (armour) changes.push(change("system.stats.toughness.armor", armour));
  const name = (direction > 0 ? sbsI18n("swade-hud.UI.Boost_430f7a1498") : sbsI18n("swade-hud.UI.Lower_be93862dba")) + target.label;
  return actor.createEmbeddedDocuments("ActiveEffect", [{
    name, type: "base", img: target.img || (direction > 0 ? "icons/svg/upgrade.svg" : "icons/svg/downgrade.svg"),
    origin: token?.uuid ?? actor.uuid, transfer: false, disabled: false,
    duration: { value: duration, units, expiry: "turnEnd" },
    system: { changes, removeEffect: true },
  }]);
}

export async function showModifierDialog(actor, token, spec) {
  const target = modifierTarget(actor, spec);
  if (!target) return;
  const content = document.createElement("div");
  const dialogId = "swade-hud-modifier-" + (++nextDialogId);
  const numberField = (name, label, value, min) => {
    const row = document.createElement("div");
    row.className = "form-group";
    const title = document.createElement("label");
    title.textContent = label;
    const input = document.createElement("input");
    Object.assign(input, { name, type: "number", value: String(value), min: String(min), step: "1", required: true });
    input.setAttribute("value",String(value));
    input.id = dialogId + "-" + name;
    title.htmlFor = input.id;
    row.append(title, input);
    content.append(row);
  };
  numberField("amount", target.pace ? sbsI18n("swade-hud.UI.Paceadjustment_e1c98a8398") : target.armour ? sbsI18n("swade-hud.UI.Toughnessadjustment_b5e61869d5") : target.label + " adjustment", target.armour ? 0 : 2, 0);
  if (spec.kind === "attribute") {
    const row = document.createElement("div");
    row.className = "form-group";
    const label = document.createElement("label");
    label.textContent = sbsI18n("swade-hud.UI.AlllinkedSkills_ae20ac6578");
    const input = document.createElement("input");
    Object.assign(input, { name: sbsI18n("swade-hud.UI.linkedSkills_9c51b4fe20"), type: "checkbox", id: dialogId + "-linked-skills" });
    label.htmlFor = input.id;
    row.append(label, input);
    content.append(row);
  }
  if (target.pace) numberField("running", sbsI18n("swade-hud.UI.Runningdieadjustment_a16bc258a3"), 0, 0);
  if (target.armour) numberField("armour", sbsI18n("swade-hud.UI.Armouradjustment_3e8ce09504"), 0, 0);
  numberField("duration", "Duration", 5, 1);
  const row = document.createElement("div");
  row.className = "form-group";
  const label = document.createElement("label");
  label.textContent = sbsI18n("swade-hud.UI.Timeunits_1bb4b94e65");
  const select = document.createElement("select");
  select.name = sbsI18n("swade-hud.UI.units_c981a30c0e");
  select.id = dialogId + "-units";
  label.htmlFor = select.id;
  for (const [value, text] of [["rounds", sbsI18n("swade-hud.UI.Rounds_e9af9cdec8")], ["minutes", sbsI18n("swade-hud.UI.Minutes_4f846a84e7")], ["hours", sbsI18n("swade-hud.UI.Hours_21e8492938")]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  row.append(label, select);
  content.append(row);
  const read = (button) => {
    const form = button.form;
    return {
      amount: form.elements.namedItem("amount").valueAsNumber,
      linkedSkills: form.elements.namedItem("linkedSkills")?.checked ?? false,
      running: form.elements.namedItem("running")?.valueAsNumber ?? 0,
      armour: form.elements.namedItem("armour")?.valueAsNumber ?? 0,
      duration: form.elements.namedItem("duration").valueAsNumber,
      units: form.elements.namedItem("units").value,
    };
  };
  return foundry.applications.api.DialogV2.wait({
    classes: ["swade-hud-stat-modifier"], window: { title: "Modify " + target.label + " - " + (token?.name ?? actor.name) },
    content: content.innerHTML,
    buttons: [
      { action: "boost", label: sbsI18n("swade-hud.UI.Boost_0d791a0a6f"), icon: "fa-solid fa-arrow-up", default: true,
        callback: (_event, button) => createModifierEffect(actor, token, spec, read(button), 1) },
      { action: "lower", label: sbsI18n("swade-hud.UI.Lower_4e8bbf3a2b"), icon: "fa-solid fa-arrow-down",
        callback: (_event, button) => createModifierEffect(actor, token, spec, read(button), -1) },
    ],
  });
}
