import { SwadeHUD } from "../scripts/hud.js";
import { renderItemSummary } from "../scripts/item-summary.js";
import { modifierTarget } from "../scripts/modifiers.js";
import { onSizeEffectChange } from "../scripts/scale.js";
import { MODULE_ID, SWADE_TOOLS_SETTING, SWADE_TOOLS_GLOBAL_SETTING, useItem } from "../scripts/swade.js";
import { registerSettings } from "../scripts/settings.js";
import { decorateToolsChatMessage } from "../scripts/tools-chat.js";
import { decoratePowerCastMessage, renderPowerCastCard, trackPowerCastDialog } from "../scripts/power-chat.js";
import { patchTargetedDamageDialog, TARGETED_DAMAGE_SOAK_SETTING } from "../scripts/targeted-damage.js";
import { ContextMenu } from "/dev/native-context-menu.js";
class FixtureContextMenu extends ContextMenu {
  async _animate() {} // Keep the native menu behavior, without test delays.
}
Object.defineProperty(Array.prototype, "filterJoin", { value(separator) { return this.filter(Boolean).join(separator); }, configurable: true });
const calls = [];
const documents = new Map();
const flags = {};
const settings = { weightUnit: "imperial" };
const registeredSettings = new Map();
const clientSettings = new Map();
const hookListeners = new Map();let nextHookId=0;
globalThis.Hooks={
  on:(name,callback)=>{const id=++nextHookId;hookListeners.set(id,{name,callback});return id;},
  off:(_name,id)=>hookListeners.delete(id),
  callAll:(name,...args)=>{for(const hook of [...hookListeners.values()])if(hook.name===name)hook.callback(...args);},
};
Hooks.on("preCreateChatMessage",decorateToolsChatMessage);
Hooks.on("preCreateChatMessage",decoratePowerCastMessage);
function record(method, ...args) { calls.push({ method, args }); }
function nativeRollCard(kind,actor,trait,options={}) {
  if(!game.modules.get("swade-tools")?.active)return;
  const roll={terms:[{options:{}}]};
  const hook=kind==="damage"?"swadeRollDamage":kind==="attribute"?"swadePreRollAttribute":"swadePreRollSkill";
  Hooks.callAll(hook,actor,trait,roll,options.additionalMods??[],options);
  // The API fixture confirms a native roll; the production SWADE dialog keeps
  // these terms before creating the message, as verified in the system source.
  const message={rolls:[structuredClone(roll)],flags:{},updateSource(data){this.flags["swade-tools"]=data["flags.swade-tools"];}};
  Hooks.callAll("preCreateChatMessage",message,{}, {},game.user.id);
  if(message.flags["swade-tools"])record("toolsChat",message.flags["swade-tools"]);
}
function update(object, changed) {
  for (const [path, value] of Object.entries(changed)) {
    const parts = path.split(".");
    let current = object;
    while (parts.length > 1) current = current[parts.shift()] ??= {};
    const key = parts[0];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      current[key] ??= {};
      update(current[key], value);
    } else current[key] = value;
  }
  hud.schedule();
}
globalThis.game = {
  modules: new Map(),
  time: { worldTime: 1000 },
  i18n: { localize: (key) => ({ "SWADE.AttrAgi": "Agility", "SWADE.AttrSma": "Smarts", "SWADE.AttrSpr": "Spirit",
    "SWADE.AttrStr": "Strength", "SWADE.AttrVig": "Vigor", "SWADE.Currency": "Currency" })[key] ?? key },
  settings: {
    register: (namespace,key,config) => registeredSettings.set(namespace+"."+key,config),
    get: (namespace, key) => {
      if (namespace === MODULE_ID) {
        const config=registeredSettings.get(namespace+"."+key);
        if(!config)throw new Error("Unregistered SWADE HUD setting: "+key);
        return clientSettings.has(key) ? clientSettings.get(key) : config.default;
      }
      return settings[key];
    },
    set: async(namespace,key,value)=>{
      clientSettings.set(key,value);record("setting",namespace,key,value);
    },
  },
  user: { id: "preview", getFlag: (_, key) => flags[key], setFlag: async (_, key, value) => { flags[key] = value; hud.schedule(); } },
  swade: {
    itemChatCardHelper: { handleAction: async (item, actor, action, options) => {
      const damage=action==="damage" || item.system.actions?.additional?.[action]?.type==="damage";
      if(["formula","damage"].includes(action) || ["trait","damage"].includes(item.system.actions?.additional?.[action]?.type)) {
        nativeRollCard(damage?"damage":"skill",actor,damage?item:{name:item.system.actions?.trait},options);
      }
      record("itemAction", item.id, actor.id, action, options.additionalMods);
    } },
    util: { createRegionFromPreset: async (preset, item) => record("template", preset, item.id) },
  },
  audio: { globalMute: false },
  tooltip: { deactivate() {} },
};
registerSettings();
const toolsPreference=document.querySelector("#disable-tools-dialogs");
toolsPreference.checked=game.settings.get(MODULE_ID,SWADE_TOOLS_SETTING);
toolsPreference.onchange=()=>game.settings.set(MODULE_ID,SWADE_TOOLS_SETTING,toolsPreference.checked);
globalThis.ui = { hotbar: { locked: false }, notifications: { error: (message) => { record("error", message); document.querySelector("#result").textContent = message; } } };
class FixtureApplication {
  constructor(options = {}) { this.options = options; }
  async _renderFrame() {
    const el = document.createElement("div");
    if (this.options.id) el.id = this.options.id;
    el.className = "application " + (this.constructor.DEFAULT_OPTIONS?.classes ?? []).join(" ");
    const width = this.constructor.DEFAULT_OPTIONS?.position?.width ?? 400;
    el.style.cssText = "position:fixed;left:200px;top:100px;z-index:105;background:#242424;width:"
      + width + (typeof width === "number" ? "px" : "") + ";pointer-events:all";
    el.innerHTML = this.constructor.DEFAULT_OPTIONS?.window?.frame===false ? ""
      : '<header class="window-header"><h1 class="window-title"></h1></header><section class="window-content"></section>';
    if(el.querySelector("h1"))el.querySelector("h1").textContent = this.options.window?.title ?? "";
    return el;
  }
  async render() {
    this.element?.remove();
    this.element = await this._renderFrame({});
    const result = await this._renderHTML?.();
    if (result) this._replaceHTML(result, this.element.querySelector(".window-content") ?? this.element);
    document.body.append(this.element);
    this.element.addEventListener("click", (event) => this.constructor.DEFAULT_OPTIONS?.actions?.[event.target.closest("[data-action]")?.dataset.action]?.());
    return this;
  }
  close() { this.element?.remove(); }
  setPosition(position) { for (const [key,value] of Object.entries(position)) this.element.style[key] = value + "px"; }
}
globalThis.foundry = { utils: { deepClone: (value) => structuredClone(value),
    getType: (value) => value instanceof HTMLElement ? "HTMLElement" : typeof value,
    isSubclass: (Class, Base) => Class === Base || Class.prototype instanceof Base,
    getDefiningClass: (Class) => ContextMenu },
  applications: {
    detached: document.body,
    ux: { ContextMenu, TextEditor: { implementation: { enrichHTML: async (html) => html } } },
    api: { ApplicationV2: FixtureApplication, DialogV2: { wait: async (config) => {
      record("dialog", config.window.title);
      const dialog = new FixtureApplication(config);
      const close = dialog.close.bind(dialog);
      dialog.close = () => { close(); config.close?.(null, dialog); };
      await dialog.render();
      dialog.element.classList.add(...(config.classes ?? []));
      const form = document.createElement("form");
      form.className = "dialog-form standard-form";
      form.innerHTML = config.content ?? "";
      const footer = document.createElement("footer");
      footer.className = "form-footer";
      for (const option of config.buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = option.class;
        button.dataset.action = option.action;
        button.textContent = option.label;
        button.onclick = async (event) => { await option.callback(event, button, dialog); dialog.close(); };
        footer.append(button);
      }
      form.append(footer);
      dialog.element.querySelector(".window-content").append(form);
      config.render?.(null, dialog);
      return dialog;
    } } },
  } };
globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY:1, NEUTRAL:0, HOSTILE:-1 } };
globalThis.ChatMessage = {
  getSpeaker: ({actor}) => ({actor:actor.id}),
  create: async (data) => record("effectChat", data.content),
};
globalThis.fromUuidSync = (uuid) => documents.get(uuid);
globalThis.fromUuid = async (uuid) => documents.get(uuid);
class FixtureStatusSheet {
  constructor(options) { this.document = options.document; }
  get isEditable() { return true; }
  async render(options) { record("statusPreview", this.document, this.isEditable, options); }
}
class FixtureStatusEffect {
  constructor(data, { parent }) {
    Object.assign(this, data);
    this.parent = parent;
    this.statuses = new Set(data.statuses ?? []);
    this.sheet = new FixtureStatusSheet({ document: this });
  }
  static async fromStatusEffect(statusId, options) {
    record("statusFromDefinition", statusId);
    const { id, ...data } = CONFIG.statusEffects[statusId];
    return new this({ ...data, statuses: [id, ...(data.statuses ?? [])] }, options);
  }
  static getEffectStart() { return { time: game.time.worldTime, combat: null, combatant: null, initiative: null, round: null, turn: null }; }
}
globalThis.CONFIG = { ux: { ContextMenu: FixtureContextMenu }, statusEffects: ["shaken","distracted","vulnerable","stunned","incapacitated","prone"].map((id) => ({
  id, name: id[0].toUpperCase() + id.slice(1), img: "icons/svg/aura.svg",
})), ActiveEffect: { documentClass: FixtureStatusEffect }, Token: { prototypeSheetClass: class {
  constructor(options) { this.options=options; }
  async render(options) { record("prototypeToken",this.options.prototype,options); }
} } };
const actor = {
  id: "Ada", uuid: "Actor.Ada", documentName: "Actor", name: "Ada Blackthorne", type: "character", isOwner: true,
  img: "icons/svg/mystery-man.svg",
  system: {
    bennies: { value: 3, max: 3 }, wounds: { value: 1, max: 3 }, fatigue: { value: 0, max: 2 },
    attributes: Object.fromEntries(["agility","smarts","spirit","strength","vigor"].map((key,index) => [key, { die: { sides: 6 + index % 3 * 2, modifier: 0 } }])),
    stats: { size: 0, parry: { value: 7 }, toughness: { value: 8, armor: 2 } },
    pace: { default: 6, base: "ground", ground: 6, fly: null, running: { die: 6, mod: 0 } },
    details: { currency: 125, conviction: { value: 1, active: false }, encumbrance: { value: 34.12121, max: 60 } },
    advances: { value: 8 }, powerPoints: { general: { value: 13, max: 20 } },
  },
  statuses: new Set(["shaken"]), effects: [], getRollData: () => ({}),
  update: async (data) => { record("actorUpdate", data); update(actor, data); },
  createEmbeddedDocuments: async (type, data) => {
    record("createEffects", type, data);
    return data.map((entry, index) => {
      const effect = addEffect("temporary-" + calls.length + "-" + index, entry.name, actor, entry.system, "", entry.duration);
      Object.assign(effect, entry);
      actor.system.stats.size += sizeContribution(effect);
      hud.schedule();
      return effect;
    });
  },
  rollAttribute: async (key, options) => {nativeRollCard("attribute",actor,key,options);record("attribute", key, options);},
  rollSkill: async (id,options) => {nativeRollCard("skill",actor,actor.items.get(id),options);record("skill", id);},
  rollRunningDie: async () => record("running"),
  spendBenny: async () => { record("spendBenny"); actor.system.bennies.value--; hud.schedule(); },
  getBenny: async () => { record("getBenny"); actor.system.bennies.value++; hud.schedule(); },
  toggleConviction: async () => record("conviction"),
  toggleActiveEffect: async (status, options={}) => {
    const statusId=typeof status==='string'?status:status.id;
    record("status", statusId, options);
    const active=options.active ?? !actor.statuses.has(statusId);
    active ? actor.statuses.add(statusId) : actor.statuses.delete(statusId);
    if(typeof status==='object'&&active){
      const {id,...data}=structuredClone(status);
      const effect=addEffect(data._id??'status-'+id,game.i18n.localize(data.name),actor,data.system??{changes:[]},data.description??'',data.duration??{});
      Object.assign(effect,data,{name:game.i18n.localize(data.name),statuses:new Set([id,...(data.statuses??[])])});
    }
    hud.schedule();
  },
  sheet: { render: async () => record("actorSheet"), changeTab: (tab,group) => record("changeTab",tab,group) },
};
const itemList = [];
actor.prototypeToken = { name: actor.name, parent: actor };
function item(id, name, type, system, img = "icons/svg/sword.svg") {
  const doc = { id, uuid: "Actor.Ada.Item." + id, documentName: "Item", name, type, system, img, sort: itemList.length,
    parent: actor, actor, modifier: 0,
    sheet: { render: () => record("itemSheet", id) },
    show: async () => record("itemChat", id),
    consume: async () => record("consume", id),
    setEquipState: async (state) => { record("equip", id, state); doc.system.equipStatus = state; hud.schedule(); },
    deleteDialog: async () => record("deleteDialog", id),
    getRollData: () => ({}),
    update: async (data) => { record("itemUpdate", id, data); update(doc, data); },
  };
  doc.system.description = "<p>" + name + " description, enriched by the SWADE system.</p>";
  documents.set(doc.uuid, doc);
  itemList.push(doc);
  return doc;
}
item("sword","Longsword","weapon",{ quantity:1, weight:4, minStr:"d6", equipStatus:4, damage:"@str+d8", range:"Melee", ap:1, parry:1, actions:{trait:"Fighting",additional:{wild:{name:"Wild Attack",type:"trait"}}} });
item("pistol","Peacemaker","weapon",{quantity:1,equipStatus:1,damage:"2d6+1",range:"12/24/48",shots:6,currentShots:4,hasReloadButton:true,actions:{trait:"Shooting",additional:{double:{name:"Double Tap",type:"trait"}}}});
item("rifle","Hunting Rifle","weapon",{quantity:1,equipStatus:1,damage:"2d8",range:"24/48/96",shots:5,currentShots:5,actions:{trait:"Shooting"}});
item("spear","Spear","weapon",{quantity:1,equipStatus:4,weight:3,damage:"@str+d6",range:"3/6/12",rangeType:0,ap:0,rof:1,
  notes:"Reach 1. Parry +1 if used two-handed",actions:{trait:"Fighting",additional:{
    throwing:{name:"Athletics (throwing)",type:"trait",override:"Athletics"},ready:{name:"Ready",type:"trait",override:"Fighting"}}}});
item("armor","Leather Armor","armor",{quantity:1,equipStatus:3,weight:12,armor:2,toughness:1,locations:{torso:true,arms:true}},"icons/svg/shield.svg");
item("shield","Round Shield","shield",{quantity:1,equipStatus:2,weight:8,parry:2,cover:2},"icons/svg/shield.svg");
item("gear","Healer's Kit","gear",{quantity:1,weight:5},"icons/svg/item-bag.svg");
item("rope","Rope (20 yards)","gear",{quantity:1,weight:15.12121},"icons/svg/item-bag.svg");
item("potion","Healing Potion","consumable",{quantity:3,weight:1},"icons/svg/regen.svg");
for (const [index,name] of ["Bolt","Healing","Deflection","Boost/Lower Trait"].entries()) item("power"+index,name,"power",{
  pp:2,ppModifiers:{cost:2},arcane:"general",rank:"Novice",range:"Smarts",duration:"5 rounds",
  damage:name==="Bolt"?"2d6":"",actions:{trait:"Spellcasting"},
},"icons/svg/aura.svg");
itemList.find((item)=>item.id==="power0").system.actions.additional = {
  enhanced: { name:"Damage (3d6)", type:"damage", override:"3d6" },
};
itemList.find((item)=>item.id==="power3").system.actions.additional = {
  apply: {name:"Apply Effect",type:"effect"}, resist: {name:"Resist",type:"resist"},
};
item("burst","Burst","power",{pp:2,ppModifiers:{cost:2},arcane:"general",rank:"Novice",range:"Cone Template",duration:"Instant",damage:"2d6",actions:{trait:"Spellcasting"}},"icons/svg/explosion.svg");
item("blast","Blast","power",{pp:3,ppModifiers:{cost:3},arcane:"general",range:"24",templates:{small:true,medium:true,large:true},actions:{trait:"Spellcasting"}},"icons/svg/explosion.svg");
for (const [index,name] of ["Athletics","Fighting","Shooting","Stealth","Notice","Healing","Spellcasting","Persuasion","Intimidation","Survival","Thievery","Research"].entries()) item("skill"+index,name,"skill",{
  swid:name.toLowerCase(),die:{sides:index%3===0?8:6,modifier:0},attribute:["agility","smarts","spirit","strength","vigor"][index%5],
},"icons/svg/dice-target.svg");
for (const [index,name] of ["Alertness","Arcane Background (Magic)","Combat Reflexes","Quick","Level Headed","Trademark Weapon"].entries()) item("edge"+index,name,"edge",{},"icons/svg/upgrade.svg");
item("hindrance","Heroic","hindrance",{major:true},"icons/svg/downgrade.svg");
item("ancestry","Human","ancestry",{},"icons/svg/mystery-man.svg");
item("ability","Infravision","ability",{},"icons/svg/eye.svg");
item("action","Battle Cry","action",{actions:{trait:"Intimidation",additional:{test:{name:"Test",type:"trait"}}}},"icons/svg/sound.svg");
item("unskilled","Unskilled Attempt","skill",{swid:"unskilled-attempt",die:{sides:4,modifier:-2},attribute:""},"icons/svg/dice-target.svg");
actor.items = Object.assign(itemList, { get: (id) => itemList.find((doc) => doc.id === id) });
actor.effects = Object.assign([], { get: (id) => actor.effects.find((effect) => effect.id === id) });
actor.allApplicableEffects = () => [...actor.effects, ...itemList.flatMap((item) => item.effects ?? [])];
function sizeContribution(effect) {
  if (!effect.flags?.["swade-hud"]?.sizeChange || !effect.active || effect.disabled || effect.duration?.expired) return 0;
  return Number(effect.system.changes.find((change)=>change.key==="system.stats.size")?.value ?? 0);
}
function addEffect(id, name, parent, system, description, duration) {
  const effect = { id, uuid:parent.uuid+".ActiveEffect."+id, name, parent, actor, system, description, duration,
    active:true, statuses:new Set(), img:"icons/svg/aura.svg",
    sheet:{render:async()=>record("effectSheet",id)},
    deleteDialog:(options)=>new Promise((resolve)=>{
      void foundry.applications.api.DialogV2.wait({
        ...options, window:{title:"Delete Active Effect: "+name}, content:"<p>Delete this effect?</p>",
        close:()=>resolve(null), buttons:[
          {action:"yes", label:options.yes.label, callback:async()=>resolve(await options.yes.callback())},
          {action:"no", label:options.no.label, callback:()=>resolve(false)}
        ]
      });
    }),
    delete:async()=>{
      record("effectDelete",id);
      actor.system.stats.size -= sizeContribution(effect);
      parent.effects.splice(parent.effects.indexOf(effect),1);
      documents.delete(effect.uuid);
      await onSizeEffectChange(effect,game.user.id);
      hud.schedule();
    },
    update:async(data)=>{
      const previous=sizeContribution(effect);
      update(effect,data);
      effect.active=!effect.disabled && !effect.duration?.expired;
      actor.system.stats.size += sizeContribution(effect)-previous;
      await onSizeEffectChange(effect,game.user.id);
      hud.schedule();
    },
  };
  parent.effects ??= [];
  parent.effects.push(effect);
  documents.set(effect.uuid,effect);
  return effect;
}
addEffect("blessing","Blessing",actor,{changes:[{key:"system.stats.globalMods.attack",value:"2"}]},
  "<p>A magical blessing improves your attack rolls.</p>",{value:10,remaining:9,units:"rounds"});
addEffect("armor-effect","Protection",actor.items.get("armor"),{changes:[{key:"system.stats.toughness.value",value:"2"}]},
  "<p>Armour grants additional protection.</p>",{value:null,remaining:Infinity,units:"seconds"});
documents.set(actor.uuid, actor);
const token = { id:"TokenAda", name:actor.name, actor,
  document:{uuid:"Scene.preview.Token.TokenAda",name:actor.name,actor,isOwner:true,width:1,height:1,disposition:0,texture:{src:actor.img},
    update:async(data)=>{record("tokenUpdate",data);Object.assign(token.document,data);hud.schedule();}} };
globalThis.canvas = { scene:{id:"preview"}, tokens:{controlled:[token],placeables:[token]} };
documents.set(token.document.uuid,token.document);

const hotbar = document.createElement("aside");
hotbar.id = "hotbar";
hotbar.className = "faded-ui flexrow";
hotbar.innerHTML = '<div id="hotbar-controls-left" class="hotbar-controls flexcol"><button data-action="mute">Mute</button></div><menu id="action-bar" class="flexrow"></menu><div id="hotbar-controls-right" class="hotbar-controls flexrow"><nav id="hotbar-page-controls" class="flexcol"></nav><div><button data-action="lock">Lock</button><button data-action="clear">Clear</button></div></div>';
let nativeHotbarPage=1;
const renderNativePages=()=>{
  hotbar.querySelector("#hotbar-page-controls").innerHTML='<button type="button" class="plain hotbar-page-control page-next fa-solid fa-triangle icon" data-action="page" data-direction="1" aria-label="Next Page"></button><span class="hotbar-page-number">'+nativeHotbarPage+'</span><button type="button" class="plain hotbar-page-control page-prev fa-solid fa-triangle icon" data-action="page" data-direction="-1" aria-label="Previous Page"></button>';
};
renderNativePages();
hotbar.addEventListener("click",(event)=>{
  const button=event.target.closest('[data-action=page]');
  if(!button)return;
  nativeHotbarPage = (nativeHotbarPage-1+Number(button.dataset.direction)+5)%5+1;
  record("nativeHotbarPage",nativeHotbarPage);
  // Reproduce Foundry replacing the clicked DOM part before bubbling to HUD.
  renderNativePages();
  hud.schedule();
});
for (let index=0;index<10;index++) {
  const slot = document.createElement("li");
  slot.className = "slot";
  slot.dataset.slot=String(index+1);
  slot.innerHTML = '<span class="key">'+(index+1)+'</span>';
  hotbar.querySelector("#action-bar").append(slot);
}
document.querySelector("#ui-bottom").append(hotbar);
const controlBounds = () => {
  return [...document.querySelectorAll("#scene-controls button")].flatMap((button)=>{
    const bounds=button.getBoundingClientRect();
    return [bounds.left,bounds.top,bounds.width,bounds.height].map((value)=>Math.round(value));
  });
};
const controlsBeforeHud = controlBounds().join();
const playersBottomBeforeHud = document.querySelector("#players-active").getBoundingClientRect().bottom;
document.querySelector("#players-expand").onclick=()=>document.querySelector("#players").classList.toggle("expanded");
const hud = new SwadeHUD();
ContextMenu.activateListeners(document);
window.addEventListener("resize", () => hud.positionSidebar());
globalThis.preview = { hud, actor, token, calls };
hud.render();
document.querySelector("#result").textContent = "Checks ready";
document.querySelector("#selection").onclick = () => {
  canvas.tokens.controlled = canvas.tokens.controlled.length ? [] : [token];
  hud.render();
  document.querySelector("#selection").textContent = canvas.tokens.controlled.length ? "Deselect token" : "Select token";
};
const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const context = (element, shiftKey = false) => element.dispatchEvent(new MouseEvent("contextmenu", {
  bubbles: true, cancelable: true, shiftKey,
}));
const chooseEffectContextAction = (label) => {
  const entry = [...document.querySelectorAll("#context-menu.swade-hud-effect-context .context-item")]
    .find((entry) => entry.textContent.trim() === label);
  if (!entry) throw new Error("Missing effect context action: " + label);
  entry.click();
};
const confirmEffectDelete = (action = "yes") => document.querySelector(`.swade-hud-effect-delete [data-action="${action}"]`).click();
document.querySelector("#checks").onclick = async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  const results = [];
  const result = document.querySelector("#result");
  const summary = document.querySelector("#check-summary");
  summary.textContent = "Running interaction checks";
  result.textContent = "Running checks";
  const assert = (name, condition) => {
    if (!condition) throw new Error(name);
    results.push("PASS " + name);
    result.textContent = results.join("\n");
  };
  try {
    assert("Reference dock grid", getComputedStyle(hud.element).display === "grid");
    assert("18 shortcut cells", hud.element.querySelectorAll(".shortcut").length === 18);
    if (!hud.profile.pages?.[0]) {
      assert("New actors start with empty shortcut pages", hud.shortcuts().every(slot => slot === null));
      // Populate this interaction fixture explicitly, as a user would by dragging.
      await hud.savePage(actor.items.filter(item => ["weapon", "power", "action", "consumable"].includes(item.type) && !item.system.hidden)
        .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name)).slice(0, 18).map(item => ({type: "Item", uuid: item.uuid})));
      await tick();
    }
    assert("Shortcut icons only show their type indicator", !hud.element.querySelector(".shortcut .label,.shortcut .cost,.shortcut .counter")
      && [...hud.element.querySelectorAll(".shortcut.item")].every((slot)=>slot.querySelectorAll(".icon").length===1));
    const shortcutFor = (id) => [...hud.element.querySelectorAll(".shortcut.item")].find((slot)=>
      hud.resolveShortcut(hud.shortcuts()[Number(slot.dataset.slot)])?.doc?.id===id);
    const rollsBeforePopup = calls.filter((call)=>call.method==="itemAction").length;
    shortcutFor("spear").click();
    await tick();
    assert("Weapon shortcut opens its action popup before rolling", Boolean(hud.description?.element?.isConnected)
      && calls.filter((call)=>call.method==="itemAction").length===rollsBeforePopup);
    assert("Shortcut popup contains only buttons without a movable header", !hud.description.element.querySelector(".window-header,.item-vital-stats,.description,.item-notes")
      && hud.description.constructor.DEFAULT_OPTIONS.window.frame===false);
    const popupBounds=hud.description.element.getBoundingClientRect();
    const spearBounds=shortcutFor("spear").getBoundingClientRect();
    assert("Action popup is compact and anchored above the shortcut", popupBounds.width<=360 && popupBounds.height<150
      && Math.abs(popupBounds.bottom-(spearBounds.top-8))<2);
    assert("Weapon rows are Attack and Throw then other actions then Damage", [...hud.description.element.querySelector(".shortcut-actions").children]
      .map((row)=>row.className).join()==="action-row attack-actions,action-row additional-actions,action-row damage-actions"
      && hud.description.element.querySelector(".attack-actions [data-popup-action=formula]")
      && hud.description.element.querySelector(".attack-actions [data-popup-action=throwing]")
      && hud.description.element.querySelector(".additional-actions [data-popup-action=ready]")
      && hud.description.element.querySelector(".damage-actions [data-popup-action=damage]"));
    const attackRow=hud.description.element.querySelector(".attack-actions");
    assert("Attack and Throw labels fit without a scrollbar", attackRow.scrollWidth<=attackRow.clientWidth+1
      && [...attackRow.children].every((button)=>button.scrollWidth<=button.clientWidth+1));
    assert("Weapon popup has Attack Damage and ranged Throw", hud.description.element.querySelector('[data-popup-action=formula]')
      && hud.description.element.querySelector('[data-popup-action=damage]')
      && hud.description.element.querySelector('[data-popup-action=throwing]').textContent==="Throw (3/6/12)");
    shortcutFor("spear").click();
    await tick();
    assert("Clicking the same shortcut closes its action popup", !hud.description && !document.querySelector(".swade-hud-shortcut-popup"));
    shortcutFor("spear").click();
    await tick();
    hud.description.element.querySelector('[data-popup-action=formula]').click();
    await tick();
    assert("Popup Attack delegates the native item roll and stays open", calls.some((call)=>call.method==="itemAction" && call.args[0]==="spear" && call.args[2]==="formula")
      && hud.description.element.isConnected);
    hud.description.element.querySelector('[data-popup-action=damage]').click();
    await tick();
    assert("Popup Damage delegates native damage", calls.some((call)=>call.method==="itemAction" && call.args[0]==="spear" && call.args[2]==="damage"));
    hud.description.element.querySelector('[data-popup-action=throwing]').click();
    await tick();
    assert("Popup Throw preserves the item's native Athletics action", calls.some((call)=>call.method==="itemAction" && call.args[0]==="spear" && call.args[2]==="throwing"));
    shortcutFor("pistol").click();await tick();
    const reloadButton=()=>hud.description.element.querySelector('[data-popup-action=reload]');
    assert("Weapon shortcut Reload shows current ammo and capacity beside Attack",reloadButton()?.textContent==="Reload (4 / 6)"&&reloadButton().parentElement.querySelector('[data-popup-action=formula]'));
    const pistol=actor.items.get("pistol");pistol.system.currentShots=0;await hud.description.render({force:true});
    assert("Reload displays zero ammo for an empty weapon",reloadButton()?.textContent==="Reload (0 / 6)");
    pistol.system.currentShots=6;await hud.description.render({force:true});
    assert("Reload reflects updated ammo when the shortcut panel refreshes",reloadButton()?.textContent==="Reload (6 / 6)");
    pistol.system.currentShots=4;
    shortcutFor("burst").click();
    await tick();
    assert("Power shortcut offers cast damage and template actions", hud.description.element.querySelector('[data-popup-action=formula]')
      && hud.description.element.querySelector('[data-popup-action=damage]') && hud.description.element.querySelector('[data-preset=swcone]'));
    assert("Power action popup only contains compact button rows", !hud.description.element.querySelector(".window-header,dl,.description")
      && hud.description.element.getBoundingClientRect().height<150);
    assert("Power popup keeps PP cost read-only", !hud.description.element.querySelector(".pp-adjust")
      && hud.description.element.querySelector('[data-popup-action=formula]').textContent.includes("2 PP"));
    hud.description.element.querySelector('[data-preset=swcone] i').click();
    await tick();
    assert("Popup template button delegates native placement", calls.some((call)=>call.method==="template" && call.args.join()==="swcone,burst")
      && hud.description.element.isConnected);
    hud.description.element.querySelector('[data-popup-action=formula]').click();
    await tick();
    assert("Popup Cast delegates native casting", calls.some((call)=>call.method==="itemAction" && call.args[0]==="burst" && call.args[2]==="formula"));
    shortcutFor("power3").click();
    await tick();
    assert("Power popup offers Apply Effect and excludes Resist", hud.description.element.querySelector('[data-popup-action=apply]')
      && !hud.description.element.querySelector('[data-popup-action=resist]'));
    hud.description.element.querySelector('[data-popup-action=apply]').click();
    await tick();
    assert("Popup Apply Effect delegates the configured native action", calls.some((call)=>call.method==="itemAction" && call.args[0]==="power3" && call.args[2]==="apply"));
    document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Clicks outside the canvas keep the compact action popup open", hud.description?.element.isConnected);
    document.querySelector("#board").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Canvas clicks close the compact action popup", !hud.description && !document.querySelector(".swade-hud-shortcut-popup"));
    hud.closeDescription();
    hud.element.querySelector('[data-action=toggle-clean]').click();
    await tick();
    assert("HUD appearance controls still use user flags", flags.appearance?.cleanPortrait===true
      && hud.element.classList.contains("cleaned"));
    hud.element.querySelector('[data-action=toggle-clean]').click();
    await tick();
    assert("Six icon sidebar controls", hud.element.querySelectorAll("[data-sidebar]").length === 6);
    assert("Native hotbar integrated", hotbar.parentElement === hud.element);
    assert("Scene control buttons keep their original position and size", controlBounds().join()===controlsBeforeHud);
    assert("Left dock does not participate in scene-control layout", hud.element.parentElement.id==="interface");
    const playersClearHud = () => document.querySelector("#players-active").getBoundingClientRect().bottom
      < hud.element.getBoundingClientRect().top;
    assert("Active players and trade button sit above HUD", playersClearHud()
      && document.querySelector("#players-active").getBoundingClientRect().bottom < playersBottomBeforeHud);
    document.querySelector("#players-expand").click();
    await tick();
    assert("Expanded player panel remains above HUD", playersClearHud());
    document.querySelector("#players-expand").click();
    const shortcutsBeforeNativePage=JSON.stringify(hud.shortcuts());
    hotbar.querySelector('[data-direction="1"]').click();
    await tick();
    assert("Native Next Page does not change HUD shortcuts or page", nativeHotbarPage===2 && hud.page===0
      && JSON.stringify(hud.shortcuts())===shortcutsBeforeNativePage
      && hud.element.querySelector('[data-panel=shortcuts-menu] .value').textContent==="1");
    hotbar.querySelector('[data-direction="-1"]').click();
    await tick();
    assert("Native Previous Page leaves HUD page finite", nativeHotbarPage===1 && hud.page===0 && Number.isFinite(hud.page));
    assert("HUD uses its own paging action", hud.element.querySelectorAll('[data-action=shortcut-page]').length===2);
    const invalidPage=hud.element.querySelector('[data-action=shortcut-page][data-delta="1"]');
    invalidPage.dataset.delta="invalid"; invalidPage.click();
    await tick();
    assert("Invalid page input cannot corrupt shortcuts", hud.page===0 && JSON.stringify(hud.shortcuts())===shortcutsBeforeNativePage);
    hud.page=NaN; hud.render();
    await tick();
    assert("Previously invalid page recovers to the first page", hud.page===0 && JSON.stringify(hud.shortcuts())===shortcutsBeforeNativePage);
    const reactionButton=()=>hud.element.querySelector('[data-action=reaction]');
    assert("Reaction button follows the shortcut page changer and uses rotate-right", hud.element.querySelector('[data-panel=shortcuts-menu] .tabs').nextElementSibling===reactionButton()
      && reactionButton().querySelector('.fa-rotate-right') && reactionButton().getAttribute('aria-pressed')==='false');
    const reactionRow=[...hud.element.querySelector('[data-panel=shortcuts-menu]').children].filter(el=>el.dataset.panel!=='shortcut-bin');
    assert("Shortcut menu controls remain on one row", Math.max(...reactionRow.map(el=>el.getBoundingClientRect().top))-Math.min(...reactionRow.map(el=>el.getBoundingClientRect().top))<5);
    reactionButton().click();await tick();
    const reaction=actor.effects.find(effect=>effect.flags?.[MODULE_ID]?.reactionUsed);
    assert("Reaction button creates the one-round arrow effect", reaction?.name==='Reaction used' && reaction.img==='icons/svg/direction.svg'
      && reaction.duration.value===1 && reaction.duration.units==='rounds' && reaction.system.removeEffect===true);
    assert("Reaction button highlights while its effect exists", reactionButton().classList.contains('active')&&reactionButton().getAttribute('aria-pressed')==='true');
    reactionButton().click();await tick();
    assert("Clicking Reaction again removes the effect and clears its highlight", !actor.effects.includes(reaction)&&reactionButton().getAttribute('aria-pressed')==='false');
    assert("Prototype Token replaces the autofill button", hud.element.querySelector('[data-action=prototype-token]')?.title==="Prototype Token"
      && !hud.element.querySelector('[data-action=fill-shortcuts]'));
    hud.element.querySelector('[data-action=prototype-token]').click();
    await tick();
    assert("Prototype button opens the native actor prototype config", calls.some((call)=>call.method==="prototypeToken"
      && call.args[0]===actor.prototypeToken && call.args[1].force===true));
    const basePrototype={name:"World Actor Prototype"};
    actor.token={id:"unlinked",baseActor:{isOwner:true,prototypeToken:basePrototype}};
    hud.element.querySelector('[data-action=prototype-token]').click();
    await tick();
    assert("Unlinked tokens configure the base actor prototype", calls.findLast((call)=>call.method==="prototypeToken").args[0]===basePrototype);
    delete actor.token;
    const statOrder = [...hud.element.querySelector('[data-panel="stats"]').children].map((el)=>el.dataset.section).join(",");
    assert("Portrait stats use requested order", statOrder === "wounds,fatigue,parry,toughness");
    for (const key of ["wounds","fatigue"]) {
      const before=actor.system[key].value;
      hud.element.querySelector('[data-section='+key+'] [data-action=resource-adjust]').click();
      await tick();
      assert(key+" icon LMB increases the value and its input", actor.system[key].value===before+1
        && hud.element.querySelector('[data-path="system.'+key+'.value"]').value===String(before+1));
      hud.element.querySelector('[data-section='+key+'] [data-action=resource-adjust]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
      await tick();
      assert(key+" icon RMB decreases the value", actor.system[key].value===before);
    }
    hud.element.querySelector('[data-section=fatigue] [data-action=resource-adjust]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
    await tick();
    assert("Fatigue icon cannot reduce the value below zero", actor.system.fatigue.value===0);
    assert("Toughness precedes armour", hud.element.querySelector('[data-section=toughness]').textContent.trim() === "8 (2)");
    assert("Status rail removed", !hud.element.querySelector('[data-panel=info]'));
    assert("Fatigue only appears in portrait stats", !hud.element.querySelector('[data-panel=resources] [data-section=fatigue]'));
    assert("Requested resource and Parry icons", Boolean(hud.element.querySelector('[data-section=powerPoints] .fa-sparkles'))
      && Boolean(hud.element.querySelector('[data-section=parry] .fa-swords')));
    assert("Both effect panels show actor and item effects", hud.element.querySelectorAll(".effect-item").length === 2
      && document.querySelectorAll("#swade-hud-effects-panel .effect-item").length === 2);
    const effectsRect = document.querySelector("#swade-hud-effects-panel").getBoundingClientRect();
    const chatRect = document.querySelector('[data-tab=chat]').getBoundingClientRect();
    assert("System-style effect panel sits left of Chat", effectsRect.right < chatRect.left && effectsRect.top < 35);
    hud.element.querySelector("[data-action=attribute]").click();
    assert("Native attribute roll", calls.at(-1).method === "attribute");
    hud.element.querySelector('[data-action=resource-adjust][data-key=bennies].resource-value').dispatchEvent(new MouseEvent("contextmenu", {bubbles:true, cancelable:true}));
    await tick();
    assert("Native Benny spending", calls.some((call) => call.method === "spendBenny"));
    hud.element.querySelector('[data-sidebar="items"]').click();
    await tick();
    assert("Inventory shows coin icon then Wealth and amount", hud.sidebar.querySelector(".inventory-wealth").textContent==="Wealth: 125"
      && hud.sidebar.querySelector(".inventory-wealth .fa-coins") && !hud.sidebar.querySelector(".inventory-wealth .total"));
    assert("Item and encumbrance weights round to one decimal", hud.sidebar.querySelector('[data-item-id=rope] .bulk span').textContent==="15.1"
      && hud.sidebar.querySelector(".inventory-bulk .left").textContent==="34.1 / 60"
      && actor.items.get("rope").system.weight===15.12121 && actor.system.details.encumbrance.value===34.12121);
    const quantity = hud.sidebar.querySelector("[data-item-property]");
    quantity.value = "2"; quantity.dispatchEvent(new Event("change",{bubbles:true}));
    await tick();
    assert("Quantity update reaches item", calls.some((call) => call.method === "itemUpdate"));
    hud.element.querySelector('[data-sidebar="spells"]').click();
    await tick();
    hud.sidebar.querySelector('[data-action="item-action"][data-item-action=formula]').click();
    await tick();
    assert("Native power action", calls.some((call) => call.method === "itemAction" && call.args[2] === "formula"));
    assert("Power costs are static numbers", !hud.sidebar.querySelector(".pp-adjust")
      && hud.sidebar.querySelector(".pp-cost").textContent==="2 PP");
    assert("Power range uses a ruler", Boolean(hud.sidebar.querySelector('[data-item-id=power0] .power-range .fa-ruler')));
    const burstRow = hud.sidebar.querySelector('[data-item-id=burst]');
    const cone = burstRow.querySelector('[data-action=place-template]');
    assert("Cone has compact clickable template label", cone.textContent==="Cone" && cone.title==="Cone Template"
      && Boolean(cone.querySelector(".fa-ruler-combined")));
    cone.querySelector("i").click();
    await tick();
    assert("Template icon delegates native region placement", calls.some((call)=>call.method==="template" && call.args.join()==="swcone,burst"));
    const blast = hud.sidebar.querySelector('[data-item-id=blast] .power-range');
    assert("Multiple blast templates use requested aliases and commas", blast.textContent.includes("SBT, MBT, LBT")
      && blast.querySelectorAll('[data-action=place-template]').length===3);
    blast.querySelector('[data-preset=lbt] span').click();
    await tick();
    assert("Template label also delegates native placement", calls.some((call)=>call.method==="template" && call.args.join()==="lbt,blast"));
    assert("Boost/Lower Trait excludes Resist", ![...hud.sidebar.querySelectorAll('[data-item-id=power3] + .variants a')].some((el)=>el.textContent==="Resist"));
    assert("Power cast controls exclude inline damage", !hud.sidebar.querySelector(".power-row .actions [data-item-action=damage]"));
    const boltDamage=hud.sidebar.querySelector('[data-item-id=power0] + .variants');
    assert("Bolt lists default and additional damage options", boltDamage.querySelector('[data-item-action=damage]').textContent==="Damage (2d6)"
      && boltDamage.querySelector('[data-item-action=enhanced]').textContent==="Damage (3d6)");
    boltDamage.querySelector('[data-item-action=damage]').click();
    await tick();
    boltDamage.querySelector('[data-item-action=enhanced]').click();
    await tick();
    assert("Both Bolt damage options use their native actions", calls.some((call)=>call.method==="itemAction" && call.args[0]==="power0" && call.args[2]==="damage")
      && calls.some((call)=>call.method==="itemAction" && call.args[0]==="power0" && call.args[2]==="enhanced"));
    context(boltDamage.querySelector('[data-item-action=enhanced]'));
    await tick();
    const powerMenu = document.querySelector("#context-menu.swade-hud-item-context");
    assert("Right-clicking a power variant offers Edit and Delete for its power",
      [...(powerMenu?.querySelectorAll(".context-item") ?? [])].map((entry) => entry.textContent.trim()).join() === "Edit,Delete");
    powerMenu.querySelector(".context-item").click();
    await tick();
    assert("Editing a power opens the correct sheet and preserves the sidebar",
      calls.at(-1).method === "itemSheet" && calls.at(-1).args[0] === "power0" && hud.activeSidebar === "spells");
    const burstDamage=hud.sidebar.querySelector('[data-item-id=burst] + .variants [data-item-action=damage]');
    assert("Burst has a default damage button without additional actions", burstDamage?.textContent==="Damage (2d6)");
    burstDamage.click();
    await tick();
    assert("Burst damage delegates the native damage action", calls.some((call)=>call.method==="itemAction" && call.args[0]==="burst" && call.args[2]==="damage"));
    for (const row of hud.sidebar.querySelectorAll(".power-row")) {
      const rangeBounds = row.querySelector(".power-range").getBoundingClientRect();
      const castBounds = row.querySelector(".actions").getBoundingClientRect();
      assert(row.dataset.itemId+" range stays clear of casting controls", rangeBounds.right <= castBounds.left + 1);
    }
    const weaponSummary = await renderItemSummary(actor, actor.items.get("sword"));
    assert("Weapon summary includes damage weight and bonuses", ["Strength+d8","4 lb","Parry bonus","+1","Minimum Strength"].every((text)=>weaponSummary.textContent.includes(text)));
    assert("Item trait references point to the actor's skill", weaponSummary.querySelector('[data-modifier=skill]')?.dataset.itemId==="skill1");
    const armorSummary = await renderItemSummary(actor, actor.items.get("armor"));
    assert("Armour summary includes protection locations and effects", ["Armour bonus","+2","Torso, Arms","Protection","Toughness: +2"].every((text)=>armorSummary.textContent.includes(text)));
    const shieldSummary = await renderItemSummary(actor, actor.items.get("shield"));
    assert("Shield summary includes parry and cover", ["Parry bonus","+2","Cover"].every((text)=>shieldSummary.textContent.includes(text)));
    hud.element.querySelector('[data-sidebar="actions"]').click();
    await tick();
    hud.sidebar.querySelector('[data-item-action=damage]').click();
    await tick();
    assert("Native weapon damage", calls.some((call) => call.method === "itemAction" && call.args[2] === "damage"));
    assert("Rolls keep the sidebar open", hud.activeSidebar === "actions" && hud.sidebar.isConnected);
    hud.sidebar.querySelector('[data-item-action=reload]').click();
    await tick();
    assert("Native weapon reloading", calls.some((call) => call.method === "itemAction" && call.args[2] === "reload"));
    hud.element.querySelector('[data-sidebar=extras]').click();
    await tick();
    const statusNames = [...hud.sidebar.querySelectorAll(".status-list [data-action=status]")].map((el)=>el.textContent);
    assert("System effects are alphabetical in the right column", statusNames.join() === [...statusNames].sort((a,b)=>a.localeCompare(b)).join()
      && hud.sidebar.querySelector(".effects-columns").children[1].classList.contains("system-effect-list"));
    const actorEffectsColumn=()=>hud.sidebar.querySelector(".actor-effect-list");
    const effectRow=(id)=>actorEffectsColumn().querySelector('[data-effect-uuid$=".'+id+'"]');
    const columnBounds=actorEffectsColumn().getBoundingClientRect();
    const systemBounds=hud.sidebar.querySelector(".system-effect-list").getBoundingClientRect();
    assert("Effects expands into two equal columns without overflowing", Math.abs(columnBounds.width-systemBounds.width)<2
      && columnBounds.right<=systemBounds.left && hud.sidebar.querySelector(".inner").scrollWidth<=hud.sidebar.querySelector(".inner").clientWidth+1);
    assert("Actor effects include temporary effects and transferred permanent effects", actorEffectsColumn().textContent.includes("Temporary Effects")
      && actorEffectsColumn().textContent.includes("Permanent Effects") && effectRow("blessing") && effectRow("armor-effect")
      && effectRow("armor-effect").textContent.includes("Leather Armor"));
    assert("Effect selection highlights the whole row without checkboxes", effectRow("blessing").classList.contains("selected")
      && hud.sidebar.querySelector('[data-action=status][data-status=shaken]').closest(".effect-row").classList.contains("selected")
      && !hud.sidebar.querySelector('.fa-square,.fa-square-check,input[type=checkbox]'));
    effectRow("armor-effect").querySelector("img").click();await tick();
    assert("Clicking an actor effect disables it but keeps it available", !effectRow("armor-effect").classList.contains("selected")
      && effectRow("armor-effect").querySelector(".effect-toggle").getAttribute("aria-pressed")==="false"
      && actor.items.get("armor").effects[0].disabled && effectRow("armor-effect").textContent.includes("Disabled"));
    effectRow("armor-effect").querySelector(".effect-toggle").dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));await tick();
    assert("Space re-enables the transferred effect at its source", effectRow("armor-effect").classList.contains("selected")
      && actor.items.get("armor").effects[0].disabled===false);
    effectRow("armor-effect").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));await tick();
    assert("Actor effect RMB opens the native Edit Delete context menu", document.querySelector("#context-menu.swade-hud-effect-context")
      && [...document.querySelectorAll("#context-menu .context-item")].map((entry)=>entry.textContent.trim()).join()==="Edit,Delete");
    chooseEffectContextAction("Edit");await tick();
    assert("Context Edit opens the transferred effect sheet without removing it", calls.findLast((call)=>call.method==="effectSheet").args[0]==="armor-effect"
      && actor.items.get("armor").effects.length===1);
    const deleteCandidate=addEffect("context-delete","Temporary test effect",actor,{changes:[]},"",{value:2,units:"rounds"});
    await deleteCandidate.update({disabled:true});await tick();
    effectRow("context-delete").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));await tick();
    chooseEffectContextAction("Delete");await tick();
    assert("Context Delete asks before deleting an actor effect", actor.effects.includes(deleteCandidate)
      && document.querySelector(".swade-hud-effect-delete"));
    confirmEffectDelete();await tick();
    assert("Context Delete removes the selected disabled actor effect and keeps Effects open", !actor.effects.includes(deleteCandidate)
      && !effectRow("context-delete") && hud.activeSidebar==="extras" && hud.sidebar.isConnected);
    effectRow("armor-effect").querySelector(".effect-star").click();await tick();
    assert("Starring an actor effect pins it above both duration groups", actorEffectsColumn().querySelector(".effect-row").dataset.effectUuid.endsWith(".armor-effect")
      && actorEffectsColumn().querySelector(".effect-group-title").textContent==="Starred"
      && effectRow("armor-effect").classList.contains("selected"));
    hud.sidebar.querySelector('.row[data-status=vulnerable] .effect-star').click();await tick();
    assert("Inactive system effects can be starred without applying them", hud.sidebar.querySelector(".status-list .effect-row").dataset.status==="vulnerable"
      && !actor.statuses.has("vulnerable") && hud.sidebar.querySelector('.row[data-status=vulnerable] .effect-star').getAttribute("aria-pressed")==="true");
    hud.closeSidebar();hud.activeSidebar="extras";hud.render();await tick();
    assert("Both effect stars persist after closing and rebuilding the panel", actorEffectsColumn().querySelector(".effect-row").dataset.effectUuid.endsWith(".armor-effect")
      && hud.sidebar.querySelector(".status-list .effect-row").dataset.status==="vulnerable"
      && hud.profile.effectFavorites.length===2);
    effectRow("armor-effect").querySelector(".effect-star").click();await tick();
    hud.sidebar.querySelector('.row[data-status=vulnerable] .effect-star').click();await tick();
    assert("Unstarring restores the duration groups and alphabetical system order", !actorEffectsColumn().textContent.includes("Starred")
      && hud.sidebar.querySelector(".status-list .effect-row").dataset.status==="distracted" && !hud.profile.effectFavorites.length);
    assert("Extras has been renamed Effects", hud.element.querySelector('[data-sidebar=extras]').getAttribute("aria-label")==="Effects");
    const statusView=addEffect("status-view-shaken","Shaken",actor,{changes:[]},"",{value:null});
    statusView.statuses.add("shaken");
    hud.render();
    assert("System status documents are excluded from the actor-effect column", !effectRow("status-view-shaken"));
    const togglesBeforeInspect=calls.filter((call)=>call.method==="status").length;
    hud.sidebar.querySelector('[data-action=status][data-status=shaken]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
    await tick();
    chooseEffectContextAction("Edit");await tick();
    assert("System effect Context Edit opens its sheet without toggling it", calls.some((call)=>call.method==="effectSheet" && call.args[0]==="status-view-shaken")
      && calls.filter((call)=>call.method==="status").length===togglesBeforeInspect);
    hud.sidebar.querySelector('.row[data-status=shaken]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));await tick();
    chooseEffectContextAction("Delete");await tick();
    confirmEffectDelete();await tick();
    assert("System effect Context Delete removes the document and preserves the system definition", !actor.effects.includes(statusView)
      && CONFIG.statusEffects.some((definition)=>definition.id==="shaken") && hud.sidebar.querySelector('.row[data-status=shaken]'));
    const effectsBeforePreview=actor.effects.length;
    hud.sidebar.querySelector('.row[data-status=prone] img').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
    await tick();
    assert("Inactive system statuses offer Edit without deleting their definition", [...document.querySelectorAll("#context-menu .context-item")]
      .map((entry)=>entry.textContent.trim()).join()==="Edit");
    chooseEffectContextAction("Edit");await tick();
    assert("Inactive effect RMB opens a read-only definition without applying it", calls.findLast((call)=>call.method==="statusPreview")?.args[0].name==="Prone"
      && calls.findLast((call)=>call.method==="statusPreview").args[1]===false && actor.effects.length===effectsBeforePreview && !actor.statuses.has("prone"));
    const originalDefinitions=CONFIG.statusEffects;
    CONFIG.statusEffects=Object.fromEntries(originalDefinitions.map((definition)=>[definition.id,definition]));
    hud.sidebar.querySelector('[data-action=status][data-status=prone]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
    await tick();
    chooseEffectContextAction("Edit");await tick();
    assert("Effect definition lookup supports native Foundry status maps", calls.some((call)=>call.method==="statusFromDefinition" && call.args[0]==="prone"));
    CONFIG.statusEffects=originalDefinitions;
    hud.sidebar.querySelector('[data-action=status][data-status=shaken]').click();
    await tick();
    assert("Native status toggling", calls.some((call) => call.method === "status" && call.args[0] === "shaken"));
    hud.element.querySelector('[data-action=disposition]').click();
    await tick();
    const disposition = document.querySelector(".swade-hud-modify-disposition");
    assert("Disposition dialog has three choices", disposition.querySelectorAll(".form-footer button").length === 3);
    disposition.querySelector('[data-action=friendly]').click();
    await tick();
    assert("Disposition updates the actual token and letter", token.document.disposition === 1
      && hud.element.querySelector('[data-action=disposition]').textContent.trim() === "F");
    hud.element.querySelector('[data-action=disposition]').click();
    await tick();
    hud.element.querySelector('[data-action=disposition]').click();
    await tick();
    assert("Disposition button toggles the existing dialog closed", !document.querySelector(".swade-hud-modify-disposition"));
    hud.element.querySelector('[data-action=disposition]').click();
    hud.element.querySelector('[data-action=disposition]').click();
    await tick();
    assert("Rapid Disposition clicks cannot stack dialogs", !document.querySelector(".swade-hud-modify-disposition"));
    context(hud.element.querySelector('[data-action=running]'));
    await tick();
    let modifier = document.querySelector(".swade-hud-stat-modifier");
    assert("Pace dialog has three numbers and ordered time units", modifier.querySelectorAll('input[type=number]').length===3
      && [...modifier.querySelector("select").options].map((el)=>el.value).join()==="rounds,minutes,hours");
    modifier.querySelector('[name=amount]').value="2";
    modifier.querySelector('[name=running]').value="1";
    modifier.querySelector('[name=duration]').value="3";
    modifier.querySelector('[name=units]').value="minutes";
    modifier.querySelector('[data-action=lower]').click();
    await tick();
    let created = calls.findLast((call)=>call.method==="createEffects").args[1][0];
    assert("Pace Lower creates signed native pace and running changes", created.system.changes[0].key==="system.pace.ground"
      && created.system.changes[0].value===-2 && created.system.changes[1].key==="system.pace.running.mod"
      && created.system.changes[1].value===-1);
    assert("Temporary effects use native duration and expiry", created.duration.units==="minutes"
      && created.duration.value===3 && created.duration.expiry==="turnEnd" && created.system.removeEffect===true);
    context(hud.element.querySelector('[data-action=attribute][data-attribute=agility]'));
    await tick();
    document.querySelector(".swade-hud-stat-modifier [data-action=boost]").click();
    await tick();
    created = calls.findLast((call)=>call.method==="createEffects").args[1][0];
    assert("Attribute Boost creates native roll modifier", created.system.changes[0].key==="system.attributes.agility.die.modifier"
      && created.system.changes[0].value===2);
    for (const [kind,path] of [["parry","system.stats.parry.value"],["toughness","system.stats.toughness.value"],["armour","system.stats.toughness.armor"]]) {
      context(hud.element.querySelector('[data-modifier='+kind+']'));
      await tick();
      const dialog = document.querySelector(".swade-hud-stat-modifier");
      if (kind!=="parry") {
        assert(kind+" opens a combined dialog with zero adjustments", dialog.querySelector('[name=amount]').value==="0"
          && dialog.querySelector('[name=armour]').value==="0");
        dialog.querySelector(kind==="armour" ? '[name=armour]' : '[name=amount]').value="2";
      }
      document.querySelector(".swade-hud-stat-modifier [data-action=boost]").click();
      await tick();
      assert(kind+" opens its own effect target", calls.findLast((call)=>call.method==="createEffects").args[1][0].system.changes[0].key===path);
    }
    context(hud.element.querySelector('[data-modifier=toughness]'));
    await tick();
    modifier = document.querySelector(".swade-hud-stat-modifier");
    modifier.querySelector('[name=amount]').value="1";
    modifier.querySelector('[name=armour]').value="2";
    modifier.querySelector('[data-action=lower]').click();
    await tick();
    created = calls.findLast((call)=>call.method==="createEffects").args[1][0];
    assert("Combined Toughness and Armour creates both changes in one effect", created.system.changes.length===2
      && created.system.changes[0].key==="system.stats.toughness.value" && created.system.changes[0].value===-1
      && created.system.changes[1].key==="system.stats.toughness.armor" && created.system.changes[1].value===-2);
    const ppBefore = actor.system.powerPoints.general.value;
    hud.element.querySelector('[data-action=resource-adjust][data-key=powerPoints].resource-icon').click();
    await tick();
    assert("PP icon LMB adds one", actor.system.powerPoints.general.value===ppBefore+1);
    context(hud.element.querySelector('[data-action=resource-adjust][data-key=powerPoints].resource-value'));
    await tick();
    assert("PP amount RMB subtracts one", actor.system.powerPoints.general.value===ppBefore);
    context(hud.element.querySelector('[data-action=resource-adjust][data-key=powerPoints].resource-value'),true);
    await tick();
    document.querySelector(".swade-hud-stat-modifier [data-action=boost]").click();
    await tick();
    assert("Shift RMB PP creates a Power Point effect", calls.findLast((call)=>call.method==="createEffects").args[1][0].system.changes[0].key==="system.powerPoints.general.value");
    const benniesBefore = actor.system.bennies.value;
    hud.element.querySelector('[data-action=resource-adjust][data-key=bennies].resource-value').click();
    await tick();
    context(hud.element.querySelector('[data-action=resource-adjust][data-key=bennies].resource-icon'));
    await tick();
    assert("Benny icons and amounts use native gain and spend", actor.system.bennies.value===benniesBefore
      && calls.some((call)=>call.method==="getBenny"));
    assert("Skill effect targeting uses stable native item IDs", modifierTarget(actor,{kind:"skill",itemId:"skill0"}).key==="@Skill{skill0}[system.die.modifier]");
    for (const effect of [...actor.effects].filter((effect)=>effect.id.startsWith("temporary-"))) await effect.delete();
    await tick();
    hud.element.querySelector('[data-action=advance]').click();
    await tick();
    assert("Advances opens both sheet tab groups", calls.some((call)=>call.method==="changeTab" && call.args.join()==="about,primary")
      && calls.some((call)=>call.method==="changeTab" && call.args.join()==="advances,about"));
    hud.element.querySelector('[data-sidebar=skills]').click();
    await tick();
    assert("Only the owned Unskilled Attempt remains", hud.sidebar.querySelectorAll('.item[data-item-id=unskilled]').length === 1
      && !hud.sidebar.querySelector('[data-action=unskilled]'));
    const attributeImage = hud.sidebar.querySelector(".attribute-image");
    const attributeIcon = attributeImage.querySelector("i");
    const imageBounds = attributeImage.getBoundingClientRect();
    const iconBounds = attributeIcon.getBoundingClientRect();
    assert("Attribute icons are centered and sized", Math.abs(imageBounds.left+imageBounds.width/2-iconBounds.left-iconBounds.width/2)<2
      && Math.abs(imageBounds.top+imageBounds.height/2-iconBounds.top-iconBounds.height/2)<2 && iconBounds.height>16);
    attributeIcon.click();
    await tick();
    assert("Attribute icon LMB rolls the attribute", calls.at(-1).method==="attribute" && calls.at(-1).args[0]==="agility");
    context(attributeImage);
    await tick();
    assert("Attribute image RMB opens modifier dialog", Boolean(document.querySelector(".swade-hud-stat-modifier")));
    document.querySelector(".swade-hud-stat-modifier [data-action=boost]").click();
    await tick();
    const skillRow = hud.sidebar.querySelector('[data-modifier=skill][data-item-id=skill0]');
    context(skillRow);
    await tick();
    assert("Plain right-click on a skill offers its item menu", document.querySelector("#context-menu.swade-hud-item-context")
      && !document.querySelector(".swade-hud-stat-modifier"));
    context(skillRow, true);
    await tick();
    assert("Shift-right-click switches from the skill item menu to its modifier dialog",
      !document.querySelector("#context-menu") && document.querySelector(".swade-hud-stat-modifier"));
    document.querySelector(".swade-hud-stat-modifier [data-action=lower]").click();
    await tick();
    assert("Skill row Shift RMB creates a skill effect", calls.findLast((call)=>call.method==="createEffects").args[1][0].system.changes[0].key==="@Skill{skill0}[system.die.modifier]");
    context(hud.sidebar.querySelector('[data-modifier=skill][data-item-id=skill0] .attribute-name'));
    await tick();
    document.querySelector(".swade-hud-stat-modifier [data-action=boost]").click();
    await tick();
    assert("Linked attribute names modify that attribute", calls.findLast((call)=>call.method==="createEffects").args[1][0].system.changes[0].key==="system.attributes.agility.die.modifier");
    for (const effect of [...actor.effects].filter((effect)=>effect.id.startsWith("temporary-"))) await effect.delete();
    await tick();
    const anchor = hud.element.querySelector('[data-sidebar=skills]').getBoundingClientRect();
    const sidebarBounds = hud.sidebar.querySelector(".inner").getBoundingClientRect();
    assert("Sidebar is attached to its active arrow", anchor.left+anchor.width/2 >= sidebarBounds.left
      && anchor.left+anchor.width/2 <= sidebarBounds.right && Math.abs(sidebarBounds.bottom-(anchor.top-20)) < 3);
    const originalItems = actor.items;
    actor.items = Object.assign(originalItems.filter((item)=>item.type!=="weapon"), {get:originalItems.get});
    hud.activeSidebar = "actions";
    hud.render();
    await tick();
    const emptyAnchor = hud.element.querySelector('[data-sidebar=actions]').getBoundingClientRect();
    const emptyBounds = hud.sidebar.querySelector(".inner").getBoundingClientRect();
    assert("Empty attack panel remains over its arrow", emptyAnchor.left+emptyAnchor.width/2>=emptyBounds.left
      && emptyAnchor.left+emptyAnchor.width/2<=emptyBounds.right && Math.abs(emptyBounds.bottom-(emptyAnchor.top-20))<3);
    document.body.style.setProperty("--ui-scale","1.25");
    hud.positionSidebar();
    await tick();
    const scaledAnchor = hud.element.querySelector('[data-sidebar=actions]').getBoundingClientRect();
    const scaledBounds = hud.sidebar.querySelector(".inner").getBoundingClientRect();
    assert("Sidebar anchoring respects UI scaling", Math.abs(scaledBounds.bottom-(scaledAnchor.top-25))<3);
    assert("Player-panel clearance respects UI scaling", playersClearHud());
    document.body.style.setProperty("--ui-scale","1");
    actor.items = originalItems;
    hud.render();
    hud.element.querySelector('[data-sidebar=items]').click();
    await tick();
    hud.sidebar.querySelector('[data-action=edit-item]').click();
    await tick();
    assert("Item editing preserves the panel", hud.activeSidebar==="items" && hud.sidebar.isConnected);
    context(hud.sidebar.querySelector('[data-item-id=rope] .image'));
    await tick();
    const deleteEntry = [...document.querySelectorAll("#context-menu.swade-hud-item-context .context-item")]
      .find((entry) => entry.textContent.trim() === "Delete");
    deleteEntry?.click();
    await tick();
    assert("Inventory context Delete opens native confirmation for the selected item",
      calls.at(-1).method === "deleteDialog" && calls.at(-1).args[0] === "rope" && hud.activeSidebar === "items");
    hud.sidebar.querySelector('[data-action=item-description]').click();
    await tick();
    assert("Description windows preserve panel", Boolean(hud.description?.element?.isConnected) && hud.activeSidebar==="items");
    document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    document.querySelector('[data-tab=chat]').dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    document.querySelector("#scene-controls button").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Body sidebar and scene-control clicks preserve HUD panels and item popups", hud.sidebar?.isConnected && hud.description?.element.isConnected);
    document.querySelector("#board").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Canvas clicks close both sidebar and item popup", !hud.sidebar && !hud.description);
    hud.element.querySelector('[data-sidebar=skills]').click();
    await tick();
    context(hud.sidebar.querySelector(".attribute-image"));
    await tick();
    const retainedDialog=document.querySelector(".swade-hud-stat-modifier");
    retainedDialog.querySelector("input").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    const dialogCanvas=document.createElement("canvas");retainedDialog.append(dialogCanvas);
    dialogCanvas.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Dialog clicks including their own canvases keep HUD panels open", hud.sidebar?.isConnected && retainedDialog.isConnected);
    document.querySelector("#board").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:120,clientY:120}));
    assert("Scene board clicks close HUD panels without closing Boost Lower dialogs", !hud.sidebar && retainedDialog.isConnected);
    retainedDialog.querySelector('[data-action=boost]').click();
    await tick();
    for (const effect of [...actor.effects].filter((effect)=>effect.id.startsWith("temporary-"))) await effect.delete();
    await tick();
    hud.closeDescription();
    const effectIcon = hud.element.querySelector(".effect-item");
    effectIcon.dispatchEvent(new PointerEvent("pointerenter"));
    await tick();
    const effectTooltip = document.querySelector(".swade-hud-effect-info");
    assert("Dock effects have rich descriptions and durations", effectTooltip?.textContent.includes("9 rounds remaining")
      && effectTooltip.textContent.includes("improves your attack") && effectTooltip.textContent.includes("Attack rolls: 2")
      && !effectIcon.hasAttribute("title"));
    effectTooltip.querySelector('[data-effect-action=send-to-chat]').click();
    await tick();
    assert("Effect tooltip sends an effect card", calls.some((call)=>call.method==="effectChat" && call.args[0].includes("Blessing")));
    effectTooltip.querySelector('[data-effect-action=edit]').click();
    await tick();
    assert("Effect tooltip opens native effect sheet", calls.some((call)=>call.method==="effectSheet" && call.args[0]==="blessing"));
    effectTooltip.querySelector('[data-effect-action=edit]').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    await tick();
    assert("Effect tooltip actions support keyboard activation", calls.filter((call)=>call.method==="effectSheet" && call.args[0]==="blessing").length===2);
    document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Non-canvas clicks also preserve effect tooltips", document.querySelector(".swade-hud-effect-info"));
    document.querySelector("#board").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Canvas clicks also close effect tooltips", !document.querySelector(".swade-hud-effect-info"));
    hud.element.querySelector('.effect-item[data-item-id=blessing]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
    await tick();
    assert("Dock RMB opens confirmation without removing the effect", actor.effects.get("blessing") && document.querySelector(".swade-hud-effect-delete"));
    confirmEffectDelete("no");await tick();
    const sidebarBlessing = document.querySelector('#swade-hud-effects-panel [data-item-id="blessing"]');
    sidebarBlessing.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));await tick();
    assert("Sidebar RMB also asks before removing the effect", actor.effects.get("blessing") && document.querySelector(".swade-hud-effect-delete"));
    confirmEffectDelete();await tick();
    assert("Confirmed removal synchronizes both panels", calls.some((call)=>call.method==="effectDelete" && call.args[0]==="blessing")
      && !hud.element.querySelector('[data-effect-uuid="Actor.Ada.ActiveEffect.blessing"]'));
    const transferred = document.querySelector('#swade-hud-effects-panel [data-item-id="armor-effect"]');
    transferred.dispatchEvent(new PointerEvent("pointerenter"));
    await tick();
    assert("Sidebar effects also have source descriptions", document.querySelector(".swade-hud-effect-info")?.textContent.includes("Source: Leather Armor"));
    hud.element.querySelector('[data-sidebar=extras]').click();await tick();
    hud.sidebar.querySelector('.actor-effect-list .effect-row[data-effect-uuid$=".armor-effect"]')
      .dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));await tick();
    chooseEffectContextAction("Delete");
    await tick();
    confirmEffectDelete();await tick();
    assert("Context Delete removes transferred effects at their source and synchronizes both docks", calls.some((call)=>call.method==="effectDelete" && call.args[0]==="armor-effect")
      && !document.querySelector("#swade-hud-effects-panel"));
    const transfer = new DataTransfer();
    transfer.setData("text/plain", JSON.stringify({type:"attribute",key:"vigor"}));
    hud.element.querySelector('[data-slot="10"]').dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:transfer}));
    await tick();
    assert("Dropped shortcuts persist per actor", hud.shortcuts()[10]?.key === "vigor");
    context(hud.element.querySelector('[data-slot="10"]'));
    await tick();
    assert("Attribute shortcut RMB opens its modifier dialog", document.querySelector(".swade-hud-stat-modifier .window-title")?.textContent.includes("Vigor"));
    document.querySelector(".swade-hud-stat-modifier [data-action=boost]").click();
    await tick();
    const skillTransfer = new DataTransfer();
    skillTransfer.setData("text/plain",JSON.stringify({type:"Item",uuid:actor.items.get("skill0").uuid}));
    hud.element.querySelector('[data-slot="11"]').dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:skillTransfer}));
    await tick();
    context(hud.element.querySelector('[data-slot="11"]'));
    await tick();
    assert("Skill shortcut RMB opens its modifier dialog", document.querySelector(".swade-hud-stat-modifier .window-title")?.textContent.includes("Athletics"));
    document.querySelector(".swade-hud-stat-modifier [data-action=lower]").click();
    await tick();
    for (const effect of [...actor.effects].filter((effect)=>effect.id.startsWith("temporary-"))) await effect.delete();
    await tick();
    hud.element.querySelector('[data-action=shortcut-page][data-delta="1"]').click();
    await tick();
    const profileBeforePrototype=JSON.stringify(hud.profiles);
    hud.element.querySelector('[data-action=prototype-token]').click();
    await tick();
    assert("Prototype Token does not modify shortcut pages", hud.page===1 && JSON.stringify(hud.profiles)===profileBeforePrototype);
    hotbar.querySelector('[data-direction="1"]').click();
    await tick();
    assert("Native page changes preserve a different HUD page", hud.page===1
      && hud.element.querySelector('[data-panel=shortcuts-menu] .value').textContent==="2");
    context(hud.element.querySelector('[data-action=shortcut-page].value'));
    await tick();
    assert("HUD pages still restore saved shortcuts after native paging", hud.page===0 && hud.shortcuts()[10]?.key==="vigor"
      && hud.shortcuts()[11]?.uuid===actor.items.get("skill0").uuid);
    canvas.tokens.controlled = []; hud.render();
    assert("Last selected owned token persists after deselection", Boolean(document.querySelector("#swade-hud-persistent")) && hud.token===token);
    hud.element.querySelector("[data-action=attribute]").click();
    assert("Unselected HUD remains usable", calls.at(-1).method==="attribute");
    const second = {...token,id:"second-owned",name:"Second owned token"};
    canvas.tokens.placeables.push(second);
    hud.render();
    assert("Multiple owned tokens preserve the last selection", hud.token===token);
    canvas.tokens.controlled=[second]; hud.rememberToken(second); hud.render();
    canvas.tokens.controlled=[]; hud.render();
    assert("Most recently selected owned token persists", hud.token===second);
    const unowned={...token,id:"unowned",actor:{...actor,isOwner:false},document:{...token.document,isOwner:false}};
    canvas.tokens.placeables.push(unowned);
    canvas.tokens.controlled=[unowned]; hud.rememberToken(unowned); hud.render();
    assert("Selecting an unowned token never displays its HUD", hud.token===second);
    second.document={...token.document,isOwner:false}; hud.render();
    assert("Revoked ownership removes retained HUD", !document.querySelector("#swade-hud-persistent"));
    assert("Native hotbar restored", hotbar.parentElement.id === "ui-bottom");
    assert("Players return to vanilla placement when HUD hides", Math.abs(document.querySelector("#players-active").getBoundingClientRect().bottom-playersBottomBeforeHud)<1
      && !document.querySelector("#interface").style.getPropertyValue("--swade-hud-players-space"));
    assert("Scene controls remain stable when HUD hides", controlBounds().join()===controlsBeforeHud);
    canvas.tokens.controlled = [token]; canvas.tokens.placeables=[token]; hud.render();
    assert("Reselection restores HUD", Boolean(document.querySelector("#swade-hud-persistent")));
    canvas.tokens.controlled=[]; canvas.tokens.placeables=[]; hud.render();
    assert("Deleting the retained token removes its HUD", !document.querySelector("#swade-hud-persistent"));
    canvas.tokens.placeables=[token]; canvas.tokens.controlled=[token]; hud.render();
    canvas.tokens.controlled=[]; canvas.scene={id:"other"}; hud.render();
    assert("Changing scenes clears remembered token", !document.querySelector("#swade-hud-persistent"));
    canvas.scene={id:"preview"}; canvas.tokens.controlled=[token]; hud.render();
    game.modules.set("swade-tools",{active:true});
    game.swadetools={
      attribute:(...args)=>record("toolsAttribute",...args),
      skill:(...args)=>record("toolsSkill",...args),
      run:(...args)=>record("toolsRun",...args),
      item:(...args)=>record("toolsItem",...args),
    };
    game.swade.swadetoolsAttack=(...args)=>record("toolsItemDialog",...args);
    assert("SWADE HUD disables Tools dialogs by default and keeps the global override off", registeredSettings.size===7
      && ["tokenDistance","damageEstimate","successRates","chatRollRange"].every((key)=>game.settings.get(MODULE_ID,key)===true)
      && registeredSettings.get(MODULE_ID+"."+SWADE_TOOLS_SETTING)?.config===true
      && game.settings.get(MODULE_ID,SWADE_TOOLS_SETTING) && toolsPreference.checked
      && !game.settings.get(MODULE_ID,SWADE_TOOLS_GLOBAL_SETTING));
    hud.element.querySelector('[data-action=attribute][data-attribute=agility]').click();await tick();
    assert("Disable setting on keeps native dialogs without invoking custom Tools dialogs", calls.at(-1).method==="attribute"
      && !calls.some((call)=>["toolsAttribute","toolsSkill","toolsRun","toolsItem","toolsItemDialog"].includes(call.method)));
    assert("Native attribute rolls retain Tools chat metadata", calls.findLast((call)=>call.method==="toolsChat")?.args[0].rolltype==="attribute");
    shortcutFor("spear").click();await tick();
    assert("Default-on disable preference keeps the HUD shortcut action panel", Boolean(hud.description?.element?.querySelector(".attack-actions")));
    hud.description.element.querySelector('[data-popup-action=formula]').click();await tick();
    let nativeChat=calls.findLast((call)=>call.method==="toolsChat")?.args[0];
    assert("Standard attack dialog path retains automated Tools attack cards", nativeChat?.itemroll==="spear" && nativeChat.useaction==="formula"
      && nativeChat.rolltype==="skill" && calls.findLast((call)=>call.method==="itemAction")?.args[2]==="formula");
    hud.description.element.querySelector('[data-popup-action=damage]').click();await tick();
    nativeChat=calls.findLast((call)=>call.method==="toolsChat")?.args[0];
    assert("Standard damage dialog path retains automated Tools damage cards", nativeChat?.itemroll==="spear" && nativeChat.useaction==="damage"
      && nativeChat.rolltype==="damage" && calls.findLast((call)=>call.method==="itemAction")?.args[2]==="damage");
    hud.closeDescription();
    toolsPreference.checked=false;toolsPreference.dispatchEvent(new Event("change"));await tick();
    assert("Tools dialogs can be allowed without reloading", game.settings.get(MODULE_ID,SWADE_TOOLS_SETTING)===false);
    const nativeRolls=()=>calls.filter((call)=>["attribute","skill","running","itemAction"].includes(call.method)).length;
    const nativeBeforeTools=nativeRolls();
    hud.element.querySelector('[data-action=attribute][data-attribute=agility]').click();
    hud.element.querySelector('[data-action=skill]').click();
    hud.element.querySelector('[data-action=running]').click();
    await tick();
    assert("SWADE Tools receives main HUD attribute skill and running rolls", calls.some((call)=>call.method==="toolsAttribute" && call.args[0]===actor && call.args[1]==="agility")
      && calls.some((call)=>call.method==="toolsSkill" && call.args[0]===actor && call.args[1]==="skill4")
      && calls.some((call)=>call.method==="toolsRun" && call.args[0]===actor));
    hud.element.querySelector('[data-sidebar=skills]').click();
    await tick();
    hud.sidebar.querySelector('.attribute-image[data-attribute=smarts]').click();
    hud.sidebar.querySelector('[data-action=skill][data-item-id=skill0]').click();
    await tick();
    assert("Skills panel uses SWADE Tools for attribute icons and skills", calls.some((call)=>call.method==="toolsAttribute" && call.args[1]==="smarts")
      && calls.some((call)=>call.method==="toolsSkill" && call.args[1]==="skill0"));
    hud.element.querySelector('[data-slot="10"]').click();
    hud.element.querySelector('[data-slot="11"]').click();
    await tick();
    assert("Attribute and skill shortcuts use SWADE Tools", calls.some((call)=>call.method==="toolsAttribute" && call.args[1]==="vigor")
      && calls.filter((call)=>call.method==="toolsSkill" && call.args[1]==="skill0").length>=2);
    for(const id of ["spear","power0"]){
      const before=calls.filter((call)=>call.method==="toolsItem").length;
      shortcutFor(id).click();
      await tick();
      assert(id+" shortcut opens SWADE Tools directly without a HUD action panel", !hud.description
        && !document.querySelector(".swade-hud-shortcut-popup")
        && calls.filter((call)=>call.method==="toolsItem").length===before+1
        && calls.findLast((call)=>call.method==="toolsItem")?.args[1]===id);
    }
    for(const id of ["action","rope","edge0","hindrance","ability"]){
      const doc=actor.items.get(id),previous=doc.system.actions;
      doc.system.actions={trait:"Notice",additional:{test:{name:"Test",type:"trait"}}};
      await hud.setShortcut(17,{type:"Item",uuid:doc.uuid}); await tick();
      hud.element.querySelector('[data-slot="17"]').click(); await tick();
      const call=calls.findLast((call)=>call.method==="toolsItemDialog");
      assert(doc.type+" shortcut also bypasses the HUD panel for Tools", !hud.description
        && call?.args[0]===actor && call.args[1]===doc && call.args[2]===true);
      doc.system.actions=previous;
    }
    await hud.setShortcut(17,null); await tick();
    hud.element.querySelector('[data-sidebar=spells]').click();
    await tick();
    const toolsItemsBefore=calls.filter((call)=>call.method==="toolsItem").length;
    for(const action of ["formula","damage","enhanced"]){
      hud.sidebar.querySelector('[data-item-id=power0][data-action=item-action][data-item-action='+action+']').click();
      await tick();
    }
    assert("Power casting and both damage choices open SWADE Tools", calls.filter((call)=>call.method==="toolsItem").length===toolsItemsBefore+3
      && calls.filter((call)=>call.method==="toolsItem").slice(-3).every((call)=>call.args[0]===actor && call.args[1]==="power0"));
    assert("SWADE Tools delegation never also starts a vanilla roll", nativeRolls()===nativeBeforeTools);
    hud.sidebar.querySelector('[data-item-id=power3][data-action=item-action][data-item-action=apply]').click();
    await tick();
    assert("SWADE Tools integration keeps Apply Effect direct", calls.findLast((call)=>call.method==="itemAction")?.args[2]==="apply");
    const toolsBeforeTemplate=calls.filter((call)=>call.method==="toolsItem").length;
    hud.sidebar.querySelector('[data-item-id=burst][data-action=place-template]').click();
    await tick();
    assert("Template placement remains direct with SWADE Tools enabled", calls.findLast((call)=>call.method==="template")?.args.join()==="swcone,burst"
      && calls.filter((call)=>call.method==="toolsItem").length===toolsBeforeTemplate);
    toolsPreference.checked=true;toolsPreference.dispatchEvent(new Event("change"));await tick();
    const toolsBeforeOptOut=calls.filter((call)=>call.method==="toolsAttribute").length;
    hud.element.querySelector('[data-action=attribute][data-attribute=agility]').click();await tick();
    assert("Turning the HUD disable setting on restores native rolls while Tools remains active", game.modules.get("swade-tools").active
      && calls.at(-1).method==="attribute" && calls.filter((call)=>call.method==="toolsAttribute").length===toolsBeforeOptOut);
    shortcutFor("spear").click();await tick();
    assert("Turning the disable setting on also restores shortcut action panels", Boolean(hud.description?.element?.querySelector(".attack-actions")));
    hud.closeDescription();
    toolsPreference.checked=false;toolsPreference.dispatchEvent(new Event("change"));
    game.modules.get("swade-tools").active=false;
    const beforeDisabled=calls.filter((call)=>call.method==="toolsAttribute").length;
    hud.element.querySelector('[data-action=attribute][data-attribute=agility]').click();
    await tick();
    assert("Disabling SWADE Tools restores vanilla HUD rolls", calls.at(-1).method==="attribute"
      && calls.filter((call)=>call.method==="toolsAttribute").length===beforeDisabled);
    shortcutFor("spear").click(); await tick();
    assert("Disabling SWADE Tools restores the compact shortcut panel", Boolean(hud.description?.element?.querySelector(".attack-actions")));
    game.modules.delete("swade-tools"); delete game.swadetools; delete game.swade.swadetoolsAttack;
    toolsPreference.checked=true;toolsPreference.dispatchEvent(new Event("change"));
    hud.closeSidebar();
    hud.closeDescription();
    assert("Scale replaces Clear Page with an expand icon and actor rating", !hud.element.querySelector('[data-action=clear-shortcuts]')
      && hud.element.querySelector('[data-action=scale] .fa-expand')
      && hud.element.querySelector('[data-action=scale] span').textContent==="0");
    const scale=hud.element.querySelector('[data-action=scale]');
    assert("Scale tooltip explains Shift RMB size reference", scale.title.includes("Shift+Right-click: size reference"));
    scale.querySelector("span").click(); scale.querySelector("span").click();
    await hud.scaleUpdate; await tick();
    assert("Rapid scale increases are serialized and resize the actual token", actor.system.stats.size===2
      && token.document.width===2 && token.document.height===2
      && hud.element.querySelector('[data-action=scale] span').textContent==="2");
    hud.element.querySelector('[data-action=scale] span').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
    await hud.scaleUpdate; await tick();
    assert("Scale RMB decreases rating and restores one grid square", actor.system.stats.size===1
      && token.document.width===1 && token.document.height===1);
    hud.element.querySelector('[data-action=scale]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,shiftKey:true}));
    await tick();
    const sizeReference=document.querySelector("#swade-hud-size-reference");
    assert("Shift RMB opens an actual Size Table without changing Size", sizeReference?.querySelector('table[aria-label="Size Table"]')
      && !sizeReference.querySelector("img")
      && actor.system.stats.size===1);
    assert("Size reference includes all six columns and 25 size rows", sizeReference.querySelectorAll("thead th").length===6
      && sizeReference.querySelectorAll("tr[data-size]").length===25);
    assert("Size reference keeps all seven categories and the supplied scale values", sizeReference.querySelectorAll(".size-group").length===7
      && sizeReference.querySelector('[data-size="-4"] > :nth-child(3)').textContent==="−6"
      && sizeReference.querySelector('[data-size="20"] > :nth-child(3)').textContent==="+6"
      && sizeReference.querySelector('[data-size="12"]').textContent.includes("Kaiju or giant monsters"));
    const tableBounds=sizeReference.getBoundingClientRect();
    assert("Size reference fits the viewport and scrolls its content", tableBounds.width<=innerWidth-20
      && tableBounds.height<=innerHeight*.85+1
      && getComputedStyle(sizeReference.querySelector(".window-content")).overflowY==="auto");
    document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Size reference remains open after an outside click", sizeReference.isConnected);
    sizeReference.remove();
    await hud.changeScale(-1); await tick();
    assert("Scale decreases through zero", actor.system.stats.size===0 && token.document.width===1);

    let dragImage, dragData;
    const dragTransfer={setData:(_type,value)=>{dragData=JSON.parse(value);},setDragImage:(element,x,y)=>{dragImage={element,x,y};}};
    const dragSource=shortcutFor("spear");
    hud.onDragStart({target:dragSource,dataTransfer:dragTransfer});
    assert("Shortcut drag preview contains only a 48px icon", dragImage?.element.className==="swade-hud-drag-image"
      && dragImage.element.children.length===0 && dragImage.element.style.backgroundImage.includes("sword.svg")
      && dragImage.element.offsetWidth===48 && dragImage.element.offsetHeight===48 && dragImage.x===24 && dragImage.y===24);
    assert("Icon drag keeps the shortcut data and original slot", dragData.uuid===actor.items.get("spear").uuid
      && dragData.swadeHudSlot===Number(dragSource.dataset.slot));
    hud.element.dispatchEvent(new DragEvent("dragend",{bubbles:true}));
    await tick();
    assert("Drag preview is removed after the browser captures it", !document.querySelector(".swade-hud-drag-image"));
    hud.element.querySelector('[data-sidebar=items]').click(); await tick();
    hud.onDragStart({target:hud.sidebar.querySelector('[data-item-id=rope]'),dataTransfer:dragTransfer});
    assert("Inventory row drag also uses only its icon", dragImage.element.children.length===0
      && dragImage.element.offsetWidth===48 && dragData.uuid===actor.items.get("rope").uuid);
    hud.element.dispatchEvent(new DragEvent("dragend",{bubbles:true}));
    await tick(); hud.closeSidebar();

    const shortcutProfile=structuredClone(hud.profile);
    const chatsBeforeActions=calls.filter((call)=>call.method==="itemChat").length;
    for (const id of ["action","rope","edge0","hindrance","ability"]) {
      const doc=actor.items.get(id), previous=doc.system.actions;
      doc.system.actions={additional:{test:{name:"Test",type:"trait",override:"Notice"}}};
      await hud.setShortcut(17,{type:"Item",uuid:doc.uuid}); await tick();
      hud.element.querySelector('[data-slot="17"]').click(); await tick();
      const roll=calls.findLast((call)=>call.method==="itemAction");
      assert(doc.type+" shortcut directly rolls its sole configured action", roll?.args[0]===id && roll.args[2]==="test" && !hud.description);
      doc.system.actions=previous;
    }
    assert("Configured item shortcuts do not post chat cards", calls.filter((call)=>call.method==="itemChat").length===chatsBeforeActions);
    await hud.saveProfile(shortcutProfile); await tick();
    await hud.setShortcut(17,{type:"Item",uuid:actor.items.get("action").uuid}); await tick();
    shortcutFor("action").click(); await tick();
    assert("Multiple item actions use the compact anchored button panel", hud.description?.element?.classList.contains("swade-hud-shortcut-popup")
      && !hud.description.element.querySelector(".description,.window-header"));
    assert("Action buttons show action names and effective traits", [...hud.description.element.querySelectorAll("button")]
      .map((button)=>button.textContent).join("|")==="Battle Cry (Intimidation)|Test (Intimidation)");
    hud.description.element.querySelector('[data-popup-action=test]').click(); await tick();
    assert("Configured action panel delegates the selected action and stays open", calls.findLast((call)=>call.method==="itemAction")?.args[2]==="test"
      && hud.description.element.isConnected);
    shortcutFor("action").click(); await tick();
    assert("Clicking the same ability shortcut toggles its panel closed", !hud.description);
    assert("Power Points appear above Bennies", [...hud.element.querySelector('[data-panel=resources]').children]
      .map((row)=>row.dataset.section).join()==="powerPoints,bennies");

    const woundsIcon=()=>hud.element.querySelector('[data-section=wounds] .stat-resource-icon');
    const woundsBeforeShift=actor.system.wounds.value;
    const wasShaken=actor.statuses.has("shaken");
    actor.statuses.delete("shaken");
    woundsIcon().dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,shiftKey:true})); await tick();
    assert("Shift LMB Wounds applies Shaken without adding a wound", actor.statuses.has("shaken") && actor.system.wounds.value===woundsBeforeShift);
    woundsIcon().dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,shiftKey:true})); await tick();
    assert("Shift LMB Wounds removes Shaken without changing wounds", !actor.statuses.has("shaken") && actor.system.wounds.value===woundsBeforeShift);
    const originalAttributeRoll=actor.rollAttribute,originalUnshakeBonus=actor.system.attributes.spirit.unShakeBonus;
    actor.system.attributes.spirit.unShakeBonus=2;
    actor.rollAttribute=async(...args)=>{record("attribute",...args);return {successes:1};};
    actor.statuses.add("shaken");
    woundsIcon().dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,shiftKey:true})); await tick();
    const recoveryCall=calls.findLast((call)=>call.method==="attribute");
    assert("Shift RMB Wounds rolls Spirit with Unshake bonus and removes Shaken on success", !actor.statuses.has("shaken")
      && recoveryCall.args[0]==="spirit" && recoveryCall.args[1].additionalMods[0].value===2
      && actor.system.wounds.value===woundsBeforeShift);
    actor.rollAttribute=async()=>({successes:0});actor.statuses.add("shaken");
    woundsIcon().dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,shiftKey:true})); await tick();
    assert("A failed Spirit recovery leaves Shaken and wounds unchanged", actor.statuses.has("shaken") && actor.system.wounds.value===woundsBeforeShift);
    actor.rollAttribute=async()=>null;
    woundsIcon().dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,shiftKey:true})); await tick();
    assert("Cancelling recovery also leaves Shaken in place", actor.statuses.has("shaken"));
    actor.rollAttribute=originalAttributeRoll;actor.system.attributes.spirit.unShakeBonus=originalUnshakeBonus;
    if(!wasShaken)actor.statuses.delete("shaken");

    const openSize=async()=>{
      hud.element.querySelector('[data-action=scale]').dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,shiftKey:true}));
      await tick();
      return document.querySelector(".swade-hud-size-dialog");
    };
    let sizeDialog=await openSize();
    assert("Shift LMB Scale opens a size input with the current rating", sizeDialog?.querySelector('[name=size]').value==="0"
      && sizeDialog.querySelector('[name=size]').step==="1");
    assert("Size duration is empty by default and optional", sizeDialog.querySelector('[name=duration]').value===""
      && !sizeDialog.querySelector('[name=duration]').required);
    assert("Size duration units are ordered Rounds Minutes Hours", [...sizeDialog.querySelector('[name=units]').options]
      .map((option)=>option.value).join()==="rounds,minutes,hours");
    document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
    assert("Outside clicks leave the manual Size dialog open", sizeDialog.isConnected);
    sizeDialog.querySelector('[name=size]').value="9";
    sizeDialog.querySelector('[data-action=apply]').click(); await hud.scaleUpdate; await tick();
    assert("Applying a typed size updates actor rating and grid footprint", actor.system.stats.size===9
      && token.document.width===4 && token.document.height===4
      && hud.element.querySelector('[data-action=scale] span').textContent==="9");
    sizeDialog=await openSize();
    assert("Reopening Size uses the updated actor rating", sizeDialog.querySelector('[name=size]').value==="9");
    sizeDialog.querySelector('[name=size]').value="-2";
    sizeDialog.querySelector('[data-action=apply]').click(); await hud.scaleUpdate; await tick();
    assert("Manual negative Size uses the requested fractional footprint", actor.system.stats.size===-2 && token.document.width===.8 && token.document.height===.8);
    sizeDialog=await openSize();sizeDialog.querySelector('[name=size]').value="13";
    sizeDialog.querySelector('[name=duration]').value="3";
    sizeDialog.querySelector('[name=units]').value="hours";
    sizeDialog.querySelector('[data-action=cancel]').click(); await tick();
    assert("Cancel Size leaves actor and token unchanged", actor.system.stats.size===-2 && token.document.width===.8);
    sizeDialog=await openSize();sizeDialog.querySelector('[name=size]').value="0";
    sizeDialog.querySelector('[data-action=apply]').click();await hud.scaleUpdate;await tick();
    assert("Size dialog can restore the default footprint", actor.system.stats.size===0 && token.document.width===1);
    assert("Empty duration retains permanent size changes without an effect", !actor.effects.some((effect)=>effect.flags?.["swade-hud"]?.sizeChange));

    const baseSizeUpdates=calls.filter((call)=>call.method==="actorUpdate").length;
    sizeDialog=await openSize();sizeDialog.querySelector('[name=size]').value="6";
    sizeDialog.querySelector('[name=duration]').value="2";sizeDialog.querySelector('[name=units]').value="minutes";
    sizeDialog.querySelector('[data-action=apply]').click();await hud.scaleUpdate;await tick();
    let sizeEffect=actor.effects.find((effect)=>effect.flags?.["swade-hud"]?.sizeChange);
    assert("Entering duration creates a native timed Size effect", sizeEffect?.duration.value===2 && sizeEffect.duration.units==="minutes"
      && sizeEffect.duration.expiry==="turnEnd" && sizeEffect.system.removeEffect
      && sizeEffect.system.changes[0].key==="system.stats.size" && sizeEffect.system.changes[0].value===6
      && calls.filter((call)=>call.method==="actorUpdate").length===baseSizeUpdates);
    assert("Timed Size changes the displayed size and token footprint", actor.system.stats.size===6 && token.document.width===3
      && token.document.height===3 && hud.element.querySelector('[data-action=scale] span').textContent==="6");
    canvas.tokens.controlled=[];hud.render();
    await sizeEffect.update({"duration.expired":true});await tick();
    assert("Native Size expiry restores the actor and unselected token", actor.system.stats.size===0 && token.document.width===1 && token.document.height===1);
    await sizeEffect.delete();await tick();
    sizeDialog=await openSize();sizeDialog.querySelector('[name=size]').value="-2";sizeDialog.querySelector('[name=duration]').value="1";
    sizeDialog.querySelector('[data-action=apply]').click();await hud.scaleUpdate;await tick();
    sizeEffect=actor.effects.find((effect)=>effect.flags?.["swade-hud"]?.sizeChange);
    await sizeEffect.update({disabled:true});await tick();
    assert("Disabling a Size effect restores the normal footprint", actor.system.stats.size===0 && token.document.width===1);
    await sizeEffect.update({disabled:false});await tick();
    assert("Re-enabling a Size effect reapplies its footprint", actor.system.stats.size===-2 && token.document.width===.8);
    await sizeEffect.delete();await tick();
    assert("Removing a Size effect restores the footprint without a selection", actor.system.stats.size===0 && token.document.width===1);
    canvas.tokens.controlled=[token];hud.render();
    const previousNpc={type:actor.type,wildcard:actor.system.wildcard,bennies:actor.system.bennies.value};
    actor.type="npc";actor.system.wildcard=true;actor.system.bennies.value=2;
    game.user.isGM=true;game.user.bennies=5;
    game.user.getBenny=async()=>{record("gmGetBenny");game.user.bennies++;hud.schedule();};
    game.user.spendBenny=async()=>{record("gmSpendBenny");if(game.user.bennies>0)game.user.bennies--;hud.schedule();};
    hud.render();
    const bennyRow=()=>hud.element.querySelector('[data-panel=resources] [data-section=bennies]');
    assert("Wild Card NPC uses cards icon and its own Benny count", bennyRow().querySelector(".fa-cards") && bennyRow().querySelector(".resource-value").textContent==="2");
    bennyRow().querySelector(".resource-icon").click();await tick();
    assert("Wild Card Benny controls change its own pool", actor.system.bennies.value===3 && game.user.bennies===5);
    actor.system.bennies.value=1;hud.render();
    bennyRow().querySelector(".resource-value").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));await tick();
    assert("Spending the NPC's last Benny switches to the GM pool and circle-g", actor.system.bennies.value===0 && bennyRow().querySelector(".fa-circle-g")
      && bennyRow().title==="GM Bennies" && bennyRow().querySelector(".resource-value").textContent==="5");
    bennyRow().querySelector(".resource-icon").click();await tick();
    assert("GM Benny icon LMB increases GM Bennies", game.user.bennies===6 && actor.system.bennies.value===0);
    bennyRow().querySelector(".resource-value").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));await tick();
    assert("GM Benny number RMB decreases GM Bennies", game.user.bennies===5 && actor.system.bennies.value===0);
    context(bennyRow().querySelector('.resource-icon'));await tick();
    assert("GM Benny controls have no arrows and use the same GM pool", game.user.bennies===4 && actor.system.bennies.value===0
      && !hud.element.querySelector('[data-panel=resources] .carret'));
    actor.system.wildcard=false;hud.render();
    assert("NPC Extras without Bennies also display the GM pool", bennyRow().querySelector(".fa-circle-g") && bennyRow().querySelector(".resource-value").textContent==="4");
    actor.type=previousNpc.type;actor.system.wildcard=previousNpc.wildcard;actor.system.bennies.value=previousNpc.bennies;hud.render();
    assert("No runtime errors", !calls.some((call) => call.method === "error"));
    result.textContent = results.join("\n");
  } catch(error) { result.textContent = results.join("\n") + "\nFAIL " + error.message; console.error(error); }
  finally {
    button.disabled = false;
    summary.textContent = results.length + (result.textContent.includes("\nFAIL ") ? " checks passed; a check failed" : " checks passed");
    result.scrollTop = result.scrollHeight;
  }
};
document.querySelector('#effect-gesture-checks').onclick=async(event)=>{
  const button=event.currentTarget,output=document.querySelector('#result'),results=[];
  button.disabled=true;output.textContent='Running effect gesture checks';
  const check=(name,passed)=>{if(!passed)throw Error(name);results.push('PASS '+name);output.textContent=results.join('\n');};
  const click=(element,shiftKey=true)=>element.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,shiftKey}));
  const context=(element,shiftKey=true)=>element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,shiftKey}));
  const system=(id)=>hud.sidebar.querySelector('[data-action=status][data-status="'+id+'"]');
  const effectControl=()=>hud.sidebar.querySelector('[data-effect-uuid$=".blessing"] .effect-toggle');
  const definitions=structuredClone(CONFIG.statusEffects),beforeStatuses=new Set(actor.statuses);
  let timed;
  try{
    hud.closeDescription();hud.activeSidebar='extras';hud.render();await tick();
    for(const units of ['rounds','minutes','hours']){
      const countBefore=actor.effects.length;
      click(system('distracted'));await tick();
      const dialog=document.querySelector('.swade-hud-status-duration');
      check('Shift LMB opens duration dialog for '+units,!!dialog&&dialog.querySelectorAll('input[type=number]').length===1&&[...dialog.querySelector('select').options].map(o=>o.value).join()==='rounds,minutes,hours'&&actor.effects.length===countBefore);
      dialog.querySelector('[name=duration]').value='3';dialog.querySelector('select').value=units;
      game.time.worldTime++;dialog.querySelector('[data-action=apply]').click();await tick();
      const applied=actor.effects.filter(effect=>effect.statuses.has('distracted'));
      check('Applying '+units+' creates or refreshes one native timed status',applied.length===1&&applied[0].duration.value===3&&applied[0].duration.units===units&&applied[0].system.removeEffect&&applied[0].start.time===game.time.worldTime&&actor.statuses.has('distracted'));
      if(timed)check('Reapplying '+units+' preserves the existing status document',timed===applied[0]);
      timed=applied[0];
    }
    check('Shared system definitions stay unchanged',JSON.stringify(CONFIG.statusEffects)===JSON.stringify(definitions));
    click(system('prone'));await tick();document.querySelector('.swade-hud-status-duration [data-action=cancel]').click();await tick();
    check('Cancelling duration leaves an inactive status unapplied',!actor.statuses.has('prone')&&!actor.effects.some(effect=>effect.statuses.has('prone')));
    click(effectControl());await tick();
    check('Shift LMB on Actor Effects retains normal toggling',!document.querySelector('.swade-hud-status-duration')&&actor.effects.find(effect=>effect.id==='blessing').disabled===true);
    click(effectControl(),false);await tick();context(effectControl().querySelector('img'));await tick();
    check('Shift RMB on actor effect opens enriched description without a context menu',hud.description?.element?.classList.contains('swade-hud-effect-description')&&hud.description.element.textContent.includes('A magical blessing improves your attack rolls.')&&hud.description.element.textContent.includes('Modifiers')&&!document.querySelector('#context-menu.swade-hud-effect-context'));
    hud.closeDescription();context(system('prone'));await tick();
    check('Shift RMB describes inactive System Effects without applying them',hud.description?.element?.classList.contains('swade-hud-effect-description')&&hud.description.element.textContent.includes('Prone')&&hud.description.element.textContent.includes('No description.')&&!actor.statuses.has('prone')&&!document.querySelector('#context-menu.swade-hud-effect-context'));
    hud.closeDescription();context(system('distracted'));await tick();
    check('Shift RMB describes the active timed system effect',hud.description?.element?.textContent.includes('3 hours remaining'));
    hud.closeDescription();context(system('distracted'),false);await tick();
    check('Plain RMB retains the native Edit Delete context menu',!!document.querySelector('#context-menu.swade-hud-effect-context')&&[...document.querySelectorAll('#context-menu .context-item')].map(el=>el.textContent.trim()).join()==='Edit,Delete');
    hud.closeSidebarContextMenu();click(system('prone'));await tick();
    document.querySelector('#board').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    check('Canvas dismissal leaves duration dialogs open',!!document.querySelector('.swade-hud-status-duration'));
    document.querySelector('.swade-hud-status-duration [data-action=cancel]').click();await tick();
    output.textContent=results.join('\n')+'\n'+results.length+' effect gesture checks passed';
    document.querySelector('#check-summary').textContent=results.length+' effect gesture checks passed';
  }catch(error){output.textContent=results.join('\n')+'\nFAIL '+error.message;console.error(error);}
  finally{if(timed)await timed.delete();actor.statuses=beforeStatuses;button.disabled=false;hud.activeSidebar='extras';hud.render();}
};
document.querySelector('#effect-hover-checks').onclick=async(event)=>{
  const button=event.currentTarget,output=document.querySelector('#result'),results=[];
  const check=(name,passed)=>{if(!passed)throw Error(name);results.push('PASS '+name);output.textContent=results.join('\n');};
  const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  const enter=(control)=>control.dispatchEvent(new PointerEvent('pointerenter'));
  const leave=(control)=>control.dispatchEvent(new PointerEvent('pointerleave'));
  const actorControl=()=>hud.sidebar.querySelector('[data-effect-uuid$=".blessing"] .effect-toggle');
  const systemControl=()=>hud.sidebar.querySelector('[data-action=status][data-status=prone]');
  button.disabled=true;output.textContent='Running effect hover checks';
  try{
    hud.closeDescription();hud.activeSidebar='extras';hud.render();await tick();
    const actor=actorControl();enter(actor);await delay(200);
    check('Effect tooltip waits before the 400ms delay',!hud.effectPanels.tooltip);
    await delay(250);await tick();
    const tooltip=hud.effectPanels.tooltip;
    check('Actor effect hover shows its enriched description and modifiers',tooltip?.dataset.location==='list'&&tooltip.textContent.includes('A magical blessing improves your attack rolls.')&&tooltip.textContent.includes('Attack rolls: 2'));
    const sectionBounds=actor.closest('.effect-column').getBoundingClientRect(),rowBounds=actor.closest('.effect-row').getBoundingClientRect(),tipBounds=tooltip.getBoundingClientRect();
    check('Actor Effect tooltip sits beside the Actor Effects section right edge',Math.abs(tipBounds.left-sectionBounds.right-8)<2);
    check('Hover tooltip is vertically centered on its effect row',Math.abs(tipBounds.top+tipBounds.height/2-rowBounds.top-rowBounds.height/2)<2);
    check('Rich tooltip replaces the browser title and uses matching list instructions',!actor.hasAttribute('title')&&!tooltip.textContent.includes('[Right Click] Confirm removal'));
    leave(actor);enter(systemControl());
    check('Moving to another row clears the old tooltip immediately',!hud.effectPanels.tooltip);
    await delay(450);await tick();
    check('Inactive system effects have hover descriptions without being applied',hud.effectPanels.tooltip?.querySelector('h1').textContent.includes('Prone')&&!preview.actor.statuses.has('prone')&&!preview.actor.effects.some(effect=>effect.statuses.has('prone')));
    check('System Effect tooltip sits beside the System Effects section right edge',Math.abs(hud.effectPanels.tooltip.getBoundingClientRect().left-systemControl().closest('.effect-column').getBoundingClientRect().right-8)<2);
    hud.effectPanels.hideListTooltip();enter(actorControl());await delay(100);
    actorControl().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await delay(350);await tick();
    check('Opening the effect context menu cancels its pending hover tooltip',!hud.effectPanels.tooltip&&!!document.querySelector('#context-menu.swade-hud-effect-context'));
    hud.closeSidebarContextMenu();
    leave(systemControl());hud.effectPanels.hideListTooltip();enter(actorControl());await delay(100);leave(actorControl());await delay(350);
    check('Quick hover-out cancels its pending tooltip',!hud.effectPanels.tooltip);
    enter(actorControl());hud.closeSidebar();await delay(450);
    check('Closing the panel cancels pending effect tooltips',!hud.effectPanels.tooltip);
    hud.activeSidebar='extras';hud.render();await tick();
    const inner=hud.sidebar.querySelector('.inner'),oldStyle=inner.style.cssText;
    inner.style.height='100px';inner.style.maxHeight='100px';inner.style.overflowY='auto';hud.positionSidebar();
    enter(actorControl());await delay(450);await tick();
    inner.scrollTop=20;inner.dispatchEvent(new Event('scroll'));await tick();
    const scrolledRow=actorControl().closest('.effect-row').getBoundingClientRect(),scrolledTip=hud.effectPanels.tooltip?.getBoundingClientRect();
    check('Scrolling keeps the tooltip centered on the visible row',scrolledTip&&Math.abs(scrolledTip.top+scrolledTip.height/2-scrolledRow.top-scrolledRow.height/2)<2);
    inner.scrollTop=inner.scrollHeight;inner.dispatchEvent(new Event('scroll'));await tick();
    check('Scrolling the hovered row out of view hides its tooltip',!hud.effectPanels.tooltip);
    inner.style.cssText=oldStyle;inner.scrollTop=0;hud.positionSidebar();
    hud.sidebar.style.left=(innerWidth-hud.sidebar.getBoundingClientRect().width-5)+'px';enter(systemControl());await delay(450);await tick();
    const edgeTip=hud.effectPanels.tooltip?.getBoundingClientRect(),edgeSection=systemControl().closest('.effect-column').getBoundingClientRect();
    check('Tooltip stays beside its section near the viewport right edge',edgeTip&&edgeTip.right<=edgeSection.left-7&&edgeTip.left>=5);
    output.textContent=results.join('\n')+'\n'+results.length+' effect hover checks passed';
    document.querySelector('#check-summary').textContent=results.length+' effect hover checks passed';
  }catch(error){output.textContent=results.join('\n')+'\nFAIL '+error.message;console.error(error);}
  finally{hud.effectPanels.hideTooltip();hud.positionSidebar();button.disabled=false;}
};
document.querySelector("#cast-and-soak-checks").onclick = async (event) => {
  const button = event.currentTarget, output = document.querySelector("#result"), summary = document.querySelector("#check-summary");
  button.disabled = true;
  summary.textContent = "Running cast and soak checks";
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    results.push("PASS " + name);
    output.textContent = results.join("\n");
  };
  const power = actor.items.get("burst"), previousFlags = power.flags, previousGetChatData = power.getChatData;
  const dialogs = foundry.applications.api.DialogV2, previousWait = dialogs.wait;
  const helper = game.swade.itemChatCardHelper, previousAction = helper.handleAction;
  const previousFromUuid = foundry.utils.fromUuid, previousParseHTML = foundry.utils.parseHTML;
  const previousHandlebars = foundry.applications.handlebars;
  const previousTemplateModule = game.modules.get("swade-better-templates");
  const previousDamageModule = game.modules.get("swade-targeted-damage");
  const previousSoak = clientSettings.get(TARGETED_DAMAGE_SOAK_SETTING);
  let root, dialog, placed;
  try {
    const { chooseCastOptions } = await import("/modules/swade-better-templates/scripts/variants.mjs");
    const [cardHTML, footerHTML] = await Promise.all(["/dev/native-cast-card", "/dev/native-soak-footer"]
      .map(async (url) => (await fetch(url)).text()));
    foundry.utils.fromUuid = fromUuid;
    foundry.utils.parseHTML = (html) => {
      const template = document.createElement("template");
      template.innerHTML = html.trim();
      return template.content.firstElementChild;
    };
    foundry.applications.handlebars = { renderTemplate: async () => cardHTML };
    power.getChatData = async () => ({});
    power.flags = { "swade-better-setting": { powerModifiers: [{ id: "reach", name: "Reach", options: [{ id: "far", label: "Far" }] }] } };
    let message, casts = 0, damageCalls = 0;
    helper.handleAction = async (item, roller, action, { additionalMods }) => {
      if (action === "damage") { damageCalls++; return; }
      casts++;
      const roll = { successes: 2, total: 8, terms: [{ options: {} }] };
      Hooks.callAll("swadePreRollSkill", roller, actor.items.get("skill6"), roll, [], { item, additionalMods });
      const choices = new Map([["reach", "far"]]);
      trackPowerCastDialog({ ctx: { roll }, sbsPowerChoices: choices });
      message = { rolls: [structuredClone(roll)], flags: {}, isContentVisible: true,
        updateSource(data) { update(this, data); } };
      Hooks.callAll("preCreateChatMessage", message, {}, {}, game.user.id);
      choices.clear();
    };
    hud.activeSidebar = "spells"; hud.render();
    hud.sidebar.querySelector('.power-row[data-item-id="burst"] .cast').click();
    await tick();
    check("HUD Cast marks its single roll with the confirmed modifier", casts === 1
      && message?.flags[MODULE_ID]?.powerCast?.modifiers.includes("Reach"));
    root = document.createElement("article");
    root.className = "chat-message message";
    root.style.cssText = "position:fixed;right:10px;top:40px;width:250px;z-index:100;pointer-events:all";
    root.innerHTML = '<div class="message-content"><section class="swade-roll-message"><div class="dice-roll"><div class="dice-total">8</div></div><button class="free-reroll">Free</button></section></div>';
    document.body.append(root);
    const roll = root.querySelector(".swade-roll-message");
    let rerolls = 0;
    roll.querySelector("button").onclick = () => { rerolls++; };
    await renderPowerCastCard(message, root, useItem);
    const card = root.querySelector(".swade-hud-power-cast");
    check("The power card replaces Trait Rolls with the existing roll, then damage and templates",
      card?.contains(roll) && !card.querySelector(".trait-rolls") && roll.nextElementSibling.matches(".damage-rolls")
      && roll.nextElementSibling.nextElementSibling.matches(".template-controls"));
    roll.querySelector("button").click();
    card.querySelector(".damage-rolls button").click();
    await tick();
    check("The original roll listeners and the separate damage action still work", rerolls === 1 && damageCalls === 1 && casts === 1);
    const hidden = document.createElement("div");
    hidden.innerHTML = '<div class="message-content">Private roll</div>';
    await renderPowerCastCard({ ...message, isContentVisible: false }, hidden, useItem);
    check("A private cast does not expose the power card", hidden.textContent === "Private roll");
    const change = { changes: [{ target: "template", field: "size", operation: "set", value: 12 }] };
    const automation = { shapes: ["cone"], raises: [{ level: 1, ...change }, { level: 2, ...change }],
      modifiers: [{ id: "bt-reach", name: " reach ", ...change }, { id: "bt-other", name: "Other", ...change }] };
    dialogs.wait = (config) => new Promise((resolve, reject) => {
      const buttons = config.buttons.map((entry) => ({ ...entry, callback: (...args) => resolve(entry.callback?.(...args) ?? entry.action) }));
      previousWait({ ...config, buttons }).then((app) => { dialog = app; }, reject);
    });
    game.modules.set("swade-better-templates", { active: true, api: {
      readAutomation: () => automation, placeTemplate: async (item, shape, { castContext }) => {
        placed = await chooseCastOptions(automation, item.name, shape, { castContext });
      },
    } });
    card.querySelector(".template-controls button").click();
    await tick();
    const options = dialog.element.querySelector(".sbt-cast-options");
    const earned = options.querySelectorAll(".sbt-earned-raise");
    check("Only the earned raise is highlighted green with a bullseye", earned.length === 1
      && earned[0].querySelector("input").value === "1" && earned[0].querySelector(".fa-bullseye")
      && getComputedStyle(earned[0]).backgroundColor === "rgb(36, 104, 62)");
    check("Only the matching cast modifier is preselected by name", options.querySelector('[value="bt-reach"]').checked
      && !options.querySelector('[value="bt-other"]').checked);
    options.querySelector('[name="raise"][value="1"]').click();
    dialog.element.querySelector('[data-action="place"]').click();
    await tick();
    check("Template placement receives the chosen raise and the preselected modifier",
      placed?.raise === 1 && placed.baseShape === "cone" && placed.modifiers.join() === "bt-reach");

    game.modules.set("swade-targeted-damage", { active: true });
    const soakRoot = document.createElement("form");
    soakRoot.className = "swade-targeted-damage targeted-damage-applicator";
    soakRoot.innerHTML = footerHTML;
    const soakRolls = [];
    let spends = 0;
    const app = { object: { wounds: 2, attemptedSoak: false },
      actor: { isOwner: true, bennies: 2, system: actor.system, async spendBenny() { spends++; this.bennies--; return true; } },
      async attemptSoak(options) { soakRolls.push(options); } };
    check("The targeted soak fix defaults on", registeredSettings.get(MODULE_ID + "." + TARGETED_DAMAGE_SOAK_SETTING).default === true);
    clientSettings.set(TARGETED_DAMAGE_SOAK_SETTING, false);
    patchTargetedDamageDialog(app, soakRoot);
    check("Turning the fix off leaves the native footer alone", !soakRoot.querySelector(".swade-hud-targeted-soak"));
    clientSettings.set(TARGETED_DAMAGE_SOAK_SETTING, true);
    patchTargetedDamageDialog(app, soakRoot); patchTargetedDamageDialog(app, soakRoot);
    const soak = soakRoot.querySelector(".swade-hud-targeted-soak");
    check("The broken Targeted Damage footer gets one Soak for Benny button",
      soak?.textContent === "Soak for Benny" && soakRoot.querySelectorAll(".swade-hud-targeted-soak").length === 1);
    soak.click(); soak.click();
    await tick();
    check("Soak spends one target Benny and invokes the existing soak workflow once", spends === 1
      && soakRolls.length === 1 && soakRolls[0].isReroll === false);
    app.object.attemptedSoak = true;
    soakRoot.innerHTML = footerHTML;
    patchTargetedDamageDialog(app, soakRoot);
    soakRoot.querySelector(".swade-hud-targeted-soak").click();
    await tick();
    check("Soak rerolls retain Targeted Damage's reroll rules", spends === 2 && soakRolls[1].isReroll === true);
    soakRoot.innerHTML = footerHTML;
    patchTargetedDamageDialog(app, soakRoot);
    check("A target with no available Benny does not get a spend button", !soakRoot.querySelector(".swade-hud-targeted-soak"));
    soakRoot.classList.add("sbe-targeted-adapter");
    soakRoot.innerHTML = '<div class="targeted-damage-applicator-footer"><button type="button" data-action="noDamage">Close</button></div>';
    app.object.wounds = 0;
    clientSettings.set(TARGETED_DAMAGE_SOAK_SETTING, false);
    patchTargetedDamageDialog(app, soakRoot);
    check("The no-damage Close button uses Foundry's close action with the soak fix off",
      soakRoot.querySelector(".targeted-damage-applicator-footer button").dataset.action === "close");
    summary.textContent = results.length + " cast and soak checks passed";
  } catch (error) {
    summary.textContent = "FAIL " + error.message;
    console.error(error);
  } finally {
    root?.remove(); dialog?.close(); dialogs.wait = previousWait; helper.handleAction = previousAction;
    power.flags = previousFlags; power.getChatData = previousGetChatData;
    foundry.utils.fromUuid = previousFromUuid; foundry.utils.parseHTML = previousParseHTML;
    foundry.applications.handlebars = previousHandlebars;
    if (previousTemplateModule) game.modules.set("swade-better-templates", previousTemplateModule);
    else game.modules.delete("swade-better-templates");
    if (previousDamageModule) game.modules.set("swade-targeted-damage", previousDamageModule);
    else game.modules.delete("swade-targeted-damage");
    if (previousSoak === undefined) clientSettings.delete(TARGETED_DAMAGE_SOAK_SETTING);
    else clientSettings.set(TARGETED_DAMAGE_SOAK_SETTING, previousSoak);
    hud.closeSidebar(); button.disabled = false;
  }
};
if (new URLSearchParams(location.search).has("presentation")) {
  document.querySelector("#preview-controls").hidden = true;
}
if (new URLSearchParams(location.search).has('effect-hover-preview')) {
  hud.activeSidebar='extras';hud.render();
  hud.sidebar.querySelector('[data-effect-uuid$=".blessing"] .effect-toggle').dispatchEvent(new PointerEvent('pointerenter'));
}
