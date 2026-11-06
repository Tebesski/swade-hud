const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const core = "C:/Program Files/Foundry Virtual Tabletop/resources/app/public";
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".woff2": "font/woff2", ".json": "application/json" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/dev/pixi.mjs") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return fs.createReadStream("C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/pixi.js/dist/pixi.mjs").pipe(res);
  }
  if (pathname === "/dev/native-roll-dialog") {
    const Handlebars = require("C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/handlebars");
    const lang = JSON.parse(fs.readFileSync(path.resolve(workspace, "../../systems/swade/lang/en.json"), "utf8"));
    const localize = (key) => key.split(".").reduce((value, part) => value?.[part], lang) ?? key;
    Handlebars.registerHelper("localize", localize);
    Handlebars.registerHelper("not", (value) => !value);
    Handlebars.registerHelper("checked", (value) => value ? "checked" : "");
    Handlebars.registerHelper("selectOptions", (entries, options) => new Handlebars.SafeString(Object.entries(entries).map(([key,label]) => '<option value="'+Handlebars.escapeExpression(key)+'">'+Handlebars.escapeExpression(options.hash.localize ? localize(label) : label)+'</option>').join("")));
    const template = fs.readFileSync(path.resolve(workspace, "../../systems/swade/templates/apps/roll-dialog.hbs"), "utf8");
    const damage = url.searchParams.get("damage") === "1";
    const html = Handlebars.compile(template)({ isTraitRoll:!damage, isDamageRoll:damage, formula:damage ? "1d8x+1d6x" : "{1d8x,1dw6}kh",
      modifiers:[{label:"Support",value:2,ignore:true}],modGroups:{},messageModes:{public:"Public Roll"} });
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); return res.end(html);
  }
  if (pathname === "/dev/native-cast-card" || pathname === "/dev/native-soak-footer") {
    const hbs = require("C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/handlebars");
    hbs.registerHelper("localize", key => ({
      "SWADE.TraitRolls": "Trait Rolls", "SWADE.DmgRolls": "Damage Rolls", "SWADE.Templates.Available": "Available Templates",
      "SWADE.Templates.Cone.Short": "Cone", "SWADETargetedDamage.Button.Soak.Free": "Soak for Free",
      "SWADETargetedDamage.Button.TakeWounds": "Take Wounds",
    })[key] ?? key);
    hbs.registerHelper("eq", (a, b) => a === b);
    hbs.registerHelper("gt", (a, b) => a > b);
    hbs.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
    hbs.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
    hbs.registerHelper("not", value => !value);
    const cast = pathname === "/dev/native-cast-card";
    const template = cast ? "../../systems/swade/templates/chat/item-card.hbs"
      : "../swade-targeted-damage/templates/apps/targeted-damage-applicator/buttons.hbs";
    const data = cast ? { item: { id: "burst", uuid: "Actor.Ada.Item.burst", name: "Burst", type: "power",
      img: "systems/swade/assets/icons/power.svg", system: { damage: "2d6", templates: { cone: true } } },
      settingRules: { noPowerPoints: true }, hasTrait: true, showTraitRolls: true, trait: "Spellcasting",
      hasDamage: true, showDamageRolls: true, hasTemplates: true,
      data: { description: "<p>Burst produces a fan of energy.</p>", chips: [{text: "Novice"}, {text: "2PP"}] } }
      : { object: { statusToApply: "wounded", wounds: 2, user: { isGM: false }, message: "Ada is about to take 2 wounds." } };
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    return res.end(hbs.compile(fs.readFileSync(path.resolve(workspace, template), "utf8"))(data));
  }
  // Exercise Foundry's real ContextMenu in the standalone fixture, without
  // booting a world or copying the core implementation into the module.
  if (pathname === "/dev/native-context-menu.js") {
    const source = fs.readFileSync(path.join(core, "scripts/foundry.mjs"), "utf8");
    const start = source.indexOf("class ContextMenu {");
    const end = source.lastIndexOf("\n}", source.indexOf("class FormDataExtended extends FormData", start)) + 2;
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return res.end("const _loc = value => game.i18n.localize(value);\n" + source.slice(start, end) + "\nexport { ContextMenu };\n");
  }
  let base = workspace;
  let relative = pathname.replace(/^\/modules\/swade-hud\//, "");
  if (/^\/(ui|css|fonts|icons)\//.test(pathname)) { base = core; relative = pathname.slice(1); }
  if (pathname.startsWith("/modules/swade-tools/")) { base = path.resolve(workspace, "../swade-tools"); relative = pathname.slice("/modules/swade-tools/".length); }
  if (pathname.startsWith("/modules/swade-better-templates/")) { base = path.resolve(workspace, "../swade-better-templates"); relative = pathname.slice("/modules/swade-better-templates/".length); }
  if (pathname.startsWith("/systems/swade/")) { base = path.resolve(workspace, "../../systems/swade"); relative = pathname.slice("/systems/swade/".length); }
  const target = path.resolve(base, relative.replace(/^\/+/, ""));
  if (!target.startsWith(path.resolve(base) + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(4178, "127.0.0.1", () => console.log("HUD preview: http://127.0.0.1:4178/dev/preview.html"));
