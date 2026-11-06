import { ATTRIBUTES, localize } from "./swade.js";
let nextDialogId = 0;

export function modifierTarget(actor, spec) {
  if (!actor?.isOwner) return null;
  switch (spec.kind) {
    case "pace": return actor.system.pace ? {
      label: "Pace", key: "system.pace." + (actor.system.pace.base || "ground"), img: "icons/svg/wingfoot.svg", pace: true,
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
    case "armour": return { label: "Toughness / Armour", key: "system.stats.toughness.value", armour: true };
    case "parry": return { label: "Parry", key: "system.stats.parry.value" };
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
    throw new Error("Enter valid modifiers and a positive duration.");
  }
  if (!amount && !running && !armour) throw new Error("Enter a non-zero modifier.");
  const change = (key, value) => ({ key, type: "add", value: direction * value, phase: "initial" });
  const changes = [];
  if (amount) changes.push(change(target.key, amount));
  if (running) changes.push(change("system.pace.running.mod", running));
  if (armour) changes.push(change("system.stats.toughness.armor", armour));
  const name = (direction > 0 ? "Boost " : "Lower ") + target.label;
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
  numberField("amount", target.pace ? "Pace adjustment" : target.armour ? "Toughness adjustment" : target.label + " adjustment", target.armour ? 0 : 2, 0);
  if (target.pace) numberField("running", "Running die adjustment", 0, 0);
  if (target.armour) numberField("armour", "Armour adjustment", 0, 0);
  numberField("duration", "Duration", 5, 1);
  const row = document.createElement("div");
  row.className = "form-group";
  const label = document.createElement("label");
  label.textContent = "Time units";
  const select = document.createElement("select");
  select.name = "units";
  select.id = dialogId + "-units";
  label.htmlFor = select.id;
  for (const [value, text] of [["rounds", "Rounds"], ["minutes", "Minutes"], ["hours", "Hours"]]) {
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
      { action: "boost", label: "Boost", icon: "fa-solid fa-arrow-up", default: true,
        callback: (_event, button) => createModifierEffect(actor, token, spec, read(button), 1) },
      { action: "lower", label: "Lower", icon: "fa-solid fa-arrow-down",
        callback: (_event, button) => createModifierEffect(actor, token, spec, read(button), -1) },
    ],
  });
}
