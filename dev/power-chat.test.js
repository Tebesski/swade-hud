import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { useItem } from "../scripts/swade.js";
import { decoratePowerCastMessage, installToolsPowerCast, powerCastRaises, trackPowerCastDialog, withToolsPowerCast } from "../scripts/power-chat.js";

describe("HUD power cast context", () => {
  let actor, power, listeners;
  beforeEach(() => {
    listeners = new Map();
    globalThis.Hooks = {
      on(name, callback) { const id = Symbol(name); listeners.set(id, { name, callback }); return id; },
      off(_name, id) { listeners.delete(id); },
    };
    actor = { id: "caster", uuid: "Actor.caster", isOwner: true };
    power = { type: "power", uuid: actor.uuid + ".Item.burst", actor, system: { actions: {} },
      effects: [{ id: "native", name: "Lingering", type: "modifier" }, { id: "off", name: "Unselected", type: "modifier", disabled: true }],
      flags: { "swade-better-setting": { powerModifiers: [
        { id: "area", name: "Area", options: [{ id: "large", label: "Large" }] },
        { id: "reach", name: "Reach", options: [{ id: "long", label: "Long" }] },
      ] } } };
    globalThis.game = { modules: new Map(), user: { id: "user" }, settings: { get: () => false },
      swade: { itemChatCardHelper: {} } };
  });

  function newRoll(mods, choices = []) {
    const roll = { terms: [{ options: {} }], successes: 2 };
    for (const { callback, name } of listeners.values()) {
      if (name === "swadePreRollSkill") callback(actor, null, roll, [], { additionalMods: mods });
    }
    const dialog = { ctx: { roll }, sbsPowerChoices: new Map(choices) };
    trackPowerCastDialog(dialog);
    return { roll, dialog };
  }
  function post(roll, userId = "user") {
    const message = { rolls: [structuredClone(roll)], updateSource(data) { this.cast = data["flags.swade-hud.powerCast"]; } };
    decoratePowerCastMessage(message, {}, {}, userId);
    return message;
  }

  it("keeps overlapping casts separate and reads choices at confirmation", async () => {
    const dialogs = [];
    game.swade.itemChatCardHelper.handleAction = (_item, _actor, _action, { additionalMods }) => new Promise(resolve => {
      dialogs.push({ ...newRoll(additionalMods), resolve });
    });
    const a = useItem(actor, power, "formula", undefined, { castCard: true });
    const b = useItem(actor, power, "formula", undefined, { castCard: true });
    dialogs[0].dialog.sbsPowerChoices.set("area", "large");
    dialogs[1].dialog.sbsPowerChoices.set("reach", "long");
    const unrelated = post(newRoll([]).roll);
    const otherAuthor = post(dialogs[0].roll, "another-user");
    const first = post(dialogs[0].roll), second = post(dialogs[1].roll);
    for (const dialog of dialogs) dialog.resolve(dialog.roll);
    await Promise.all([a, b]);
    assert.equal(first.cast.itemUuid, power.uuid);
    assert.deepEqual(first.cast.modifiers, ["native", "Lingering", "area", "Area", "large", "Large", "Area — Large"]);
    assert.ok(second.cast.modifiers.includes("Reach"));
    assert.ok(!second.cast.modifiers.includes("Area"));
    assert.equal(unrelated.cast, undefined); assert.equal(otherAuthor.cast, undefined);
    assert.equal(listeners.size, 0);
  });

  it("does not tag ordinary item rolls or create a card when casting is canceled", async () => {
    game.swade.itemChatCardHelper.handleAction = (_item, _actor, _action, { additionalMods }) => post(newRoll(additionalMods).roll);
    assert.equal((await useItem(actor, power)).cast, undefined);
    game.swade.itemChatCardHelper.handleAction = (_item, _actor, _action, { additionalMods }) => {
      newRoll(additionalMods);
      return null;
    };
    assert.equal(await useItem(actor, power, "formula", undefined, { castCard: true }), null);
    assert.equal(listeners.size, 0);
  });

  it("captures Tools dialog selections only on the HUD's cast roll", async () => {
    class ItemDialog {
      constructor(item) { this.item = item; }
      showDialog() {}
      async processItemFormDialog() {}
    }
    installToolsPowerCast(ItemDialog);
    const hud = new ItemDialog(power), sheet = new ItemDialog(power);
    withToolsPowerCast(power, () => hud.showDialog());
    sheet.showDialog();
    const html = { querySelector: () => null, querySelectorAll: () => [],
      sbsPowerChoices: new Map([["reach", "long"]]) };
    const roller = () => ({ async rollBaseSkill() { this.roll = { total: 8, terms: [{ options: {} }] }; } });
    const cast = roller(), other = roller();
    await hud.processItemFormDialog(html, cast);
    await sheet.processItemFormDialog(html, other);
    await cast.rollBaseSkill(); await other.rollBaseSkill();
    const card = post(cast.roll);
    assert.ok(card.cast.modifiers.includes("Reach"));
    assert.equal(powerCastRaises(card), 1);
    assert.equal(post(other.roll).cast, undefined);
  });

  it("counts native raises from the confirmed roll and ignores critical failures", () => {
    assert.equal(powerCastRaises({ rolls: [{ successes: 3 }, { isCritFailConfirmationRoll: true, total: 1 }] }), 2);
    assert.equal(powerCastRaises({ rolls: [{ successes: 1 }] }), 0);
    assert.equal(powerCastRaises({ isCritfail: true, rolls: [{ total: 12 }] }), 0);
    assert.equal(powerCastRaises({ rolls: [{ total: 8, terms: [{ dice: [{ total: 1 }, { total: 1 }] }] }] }), 0);
  });
});
