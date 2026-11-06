import { rollStatistics } from "./roll-statistics.js";
import { toolsForecastContext, toolsForecast } from "./tools-forecast.js";
import { incomingModifiers, attackKind, nativeAttackSnapshot, targetedForecasts } from "./target-forecast.js";

const MODULE = "swade-hud";
const enabled = (key) => game.settings.get(MODULE, key) === true;
const rootOf = (html, app) => html instanceof HTMLElement ? html : html?.[0] ?? app?.element?.[0] ?? app?.element;
const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; };
// Exact integer means can fall a few ulps below the integer after convolution.
export const formatRollNumber = (value) => value === Infinity ? "∞" : value === -Infinity ? "−∞" : Math.floor(value + 1e-9).toLocaleString();
export function resolveRollFormula(formula, data = {}) {
  let result = String(formula ?? "");
  for (let i = 0; i < 8 && result.includes("@"); i++) {
    const previous = result;
    result = result.replace(/@([\w.]+)/g, (match, path) => {
      const value = path.split(".").reduce((value, key) => value?.[key], data);
      return typeof value === "string" || typeof value === "number" ? "(" + value + ")" : match;
    });
    if (result === previous) break;
  }
  return result;
}
export function withAcing(formula, active) {
  return formula.replace(/\[[^\]]*\]/g, "").replace(/(\d*d(?:w\d*|\d+))(xo?(?:(?:[<>=]+)?\d+)?)?/gi,
    (_match, die, explosion) => die + (active ? explosion || (Number(die.match(/\d+$/)?.[0] ?? 6) > 1 ? "x" : "") : ""));
}
export function createRangeScale(roll) {
  const box = node("div", "swade-hud-roll-range");
  const statistics = rollStatistics(roll.formula);
  box.dataset.formula = roll.formula;
  box.dataset.total = String(roll.total);
  if (!statistics) { box.append(node("span", "insight-unavailable", "Range unavailable for this formula")); return box; }
  const labels = node("div", "range-labels");
  labels.append(node("span", "", "Min " + formatRollNumber(statistics.minimum)), node("span", "", "Average " + (statistics.approximate ? "≈" : "") + formatRollNumber(statistics.average)));
  const value = Number(roll.total);
  const position = Math.max(0, Math.min(1, statistics.average === statistics.minimum ? (value >= statistics.average ? 1 : 0)
    : Number.isFinite(statistics.minimum) ? (value - statistics.minimum) / (statistics.average - statistics.minimum)
      : statistics.coordinateCDF(value) / statistics.coordinateCDF(statistics.average)));
  const track = node("div", "range-track");
  const fill = node("div", "range-fill");
  fill.style.width = (position * 100) + "%";
  fill.style.backgroundColor = "hsl(" + (position * 120) + " 65% 42%)";
  track.append(fill);
  track.setAttribute("role", "meter");
  track.setAttribute("aria-label", "Roll result relative to its range");
  track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", "100"); track.setAttribute("aria-valuenow", String(Math.round(position * 100)));
  track.setAttribute("aria-valuetext", "Rolled " + value + "; average " + formatRollNumber(statistics.average));
  box.append(labels, track);
  return box;
}

export class RollInsights {
  dialogs = new Map();
  messages = new Map();
  nativeContexts = new WeakMap();
  start() {
    const capture = (actor, skill, roll, _mods, options, attribute) => {
      const target = [...(game.user.targets ?? [])][0];
      this.nativeContexts.set(roll, { skill, attribute, target,
        incoming: incomingModifiers(target?.actor, attackKind(options?.item, skill), target) });
    };
    Hooks.on("swadePreRollSkill", (actor, skill, roll, mods, options) => capture(actor, skill, roll, mods, options));
    Hooks.on("swadePreRollAttribute", (actor, attribute, roll, mods, options) => capture(actor, null, roll, mods, options, attribute));
    Hooks.on("renderApplicationV2", (app, html) => this.dialog(app, rootOf(html, app), !app.ctx?.roll));
    Hooks.on("renderDialog", (app, html) => this.dialog(app, rootOf(html, app), true));
    Hooks.on("closeApplicationV2", (app) => this.forgetDialog(app));
    Hooks.on("closeDialog", (app) => this.forgetDialog(app));
    Hooks.on("renderChatMessageHTML", (message, html) => this.chat(message, rootOf(html)));
    Hooks.on("targetToken", (user) => { if (user.id === game.user.id) this.refreshDialogs(); });
    for (const hook of ["updateActor", "updateItem", "createItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateToken"]) Hooks.on(hook, () => this.refreshDialogs());
  }
  forgetDialog(app) { const state = this.dialogs.get(app); state?.abort?.abort(); if (state) state.version++; this.dialogs.delete(app); }
  dialog(app, root, tools) {
    if (!root || (tools && !root.querySelector(".swadetools-itemfulldata,.swadetools-dialog-item"))) return;
    if (!tools && !app.ctx?.roll) return;
    const previous = this.dialogs.get(app);
    this.forgetDialog(app);
    const state = { root, tools, version: 0, abort: new AbortController(), target: previous?.target ?? (Number(app.ctx?.roll?.targetNumber) || 4),
      toolsExpanded: previous?.toolsExpanded,
      targets: previous?.targets ?? new Map(), snapshot: previous?.snapshot ?? (!tools ? nativeAttackSnapshot(app, this.nativeContexts.get(app.ctx.roll)) : null) };
    this.dialogs.set(app, state);
    const schedule = () => { if (state.scheduled) return; state.scheduled = true; requestAnimationFrame(() => { state.scheduled = false; this.updateDialog(app, state); }); };
    root.addEventListener("input", (event) => { if (!event.target.closest(".success-target")) schedule(); }, { signal: state.abort.signal });
    root.addEventListener("change", schedule, { signal: state.abort.signal });
    root.addEventListener("click", (event) => { if (!event.target.closest(".swade-hud-roll-insights")) schedule(); }, { signal: state.abort.signal });
    if (tools) for (const name of ["pointerover", "focusin"]) root.addEventListener(name, (event) => {
      const button = event.target.closest(".dialog-button[data-button]");
      if (button && button.dataset.button !== state.toolsAction) { state.toolsAction = button.dataset.button; schedule(); }
    }, { signal: state.abort.signal });
    this.updateDialog(app, state);
  }
  sizeToolsDialog(app, state, expanded) {
    if (!state.tools) return;
    const { root } = state;
    const wasExpanded = root.classList.contains("swade-hud-tools-insights") || state.toolsExpanded;
    root.classList.toggle("swade-hud-tools-insights", expanded);
    if (!expanded && !wasExpanded) return;
    // Re-measure the actual content, including estimates. A fixed multiple of
    // the original window height leaves large empty areas in short dialogs.
    app.setPosition({ height: "auto" });
    const bounds = root.getBoundingClientRect(), scale = app.position?.scale || 1;
    const height = Math.min(bounds.height / scale, Math.max(100, innerHeight - 16) / scale);
    const top = Math.max(8, Math.min(bounds.top, innerHeight - height * scale - 8));
    app.setPosition({ height, top });
    state.toolsExpanded = expanded;
  }
  async updateDialog(app, state) {
    const version = ++state.version, { root } = state;
    let panel = root.querySelector(".swade-hud-roll-insights");
    if (!enabled("damageEstimate") && !enabled("successRates")) { panel?.remove(); this.sizeToolsDialog(app, state, false); return; }
    let forecasts = [];
    try {
      if (state.tools) {
        const context = toolsForecastContext(app, root);
        if (!context) return;
        if (enabled("successRates")) { const forecast = await toolsForecast(context, root, false, state.toolsAction); if (forecast) forecasts.push(forecast); }
        if (enabled("damageEstimate") && context.item) { const forecast = await toolsForecast(context, root, true, state.toolsAction); if (forecast) forecasts.push(forecast); }
      } else {
        const roll = app.ctx.roll;
        const damage = app.isDamageRoll ?? roll.options?.rollType === "damage";
        const trait = app.isTraitRoll ?? roll.options?.rollType === "trait";
        const formulaText = root.querySelector(".formula textarea")?.value ?? roll.formula;
        const data = app.ctx.actor?.getRollData?.(false) ?? app.ctx.item?.actor?.getRollData?.(false) ?? roll.data ?? {};
        let formula = resolveRollFormula(formulaText, data);
        const pending = root.querySelector(".new-modifier-value")?.value?.trim();
        if (pending) formula += "+(" + resolveRollFormula(pending, data) + ")";
        const map = Number(root.querySelector('[name="map"]:checked')?.value) || 0;
        if (map) formula += "+(" + map + ")";
        if (damage) formula = withAcing(formula, !root.querySelector('[name="noAcing"]')?.checked);
        const noAcing = !!root.querySelector('[name="noAcing"]')?.checked;
        forecasts.push({ formula, damage, noAcing, trait, actor: app.ctx.actor, item: app.ctx.item, skill: state.snapshot?.skill, attribute: state.snapshot?.attribute,
          extra: trait && !app.ctx.actor?.isWildcard && !/dw\d*/i.test(formula),
          bestShot: /\}kh[2-9]/.test(formula), label: /\}kh[2-9]/.test(formula) ? "Best shot in volley" : "" });
        if (damage && app.ctx.item) {
          const item = app.ctx.item;
          forecasts.push({ formula: formula + "+" + (item.system.bonusDamageDice || 1) + "d" + (item.system.bonusDamageDie || 6) + (noAcing ? "" : "x"), damage, noAcing, label: "With raise" });
        }
      }
      forecasts = (await Promise.all(forecasts.map((forecast) => forecast.trait ? targetedForecasts(forecast, state.snapshot) : [forecast]))).flat();
    } catch { forecasts = [{ unavailable: true }]; }
    if (version !== state.version || this.dialogs.get(app) !== state) return;
    if (!panel) {
      panel = node("section", "swade-hud-roll-insights");
      const footer = root.querySelector(".form-footer,.dialog-buttons");
      if (footer) { if (state.tools) footer.after(panel); else footer.before(panel); }
      else (root.querySelector(".window-content,.dialog-content") ?? root).append(panel);
    }
    panel.replaceChildren();
    for (const forecast of forecasts) {
      if (forecast.damage && !enabled("damageEstimate") || forecast.trait && !enabled("successRates")) continue;
      const revealTarget = forecast.revealDefense !== false;
      const targetNumber = forecast.targetKey ? (revealTarget ? state.targets.get(forecast.targetKey) : undefined) ?? forecast.target : state.target;
      const statistics = forecast.unavailable ? null : rollStatistics(forecast.formula, { trait: forecast.trait, target: targetNumber, bestShot: forecast.bestShot });
      if (!statistics) { panel.append(node("p", "insight-unavailable", "Estimate unavailable for this formula")); continue; }
      if (forecast.damage) {
        const estimate = node("div", "damage-estimate");
        estimate.append(node("strong", "", forecast.label || "Damage estimate"), node("code", "", forecast.formula),
          node("span", "estimate-values", "Avg " + (statistics.approximate ? "≈" : "") + formatRollNumber(statistics.average) + " · Min " + formatRollNumber(statistics.minimum) + (forecast.noAcing ? " · Max " + formatRollNumber(statistics.maximum) : "")));
        estimate.title = (statistics.unbounded ? "Acing makes this range open-ended. Average includes aces." : "Includes currently enabled dice and modifiers.") + (statistics.approximate ? " Average estimated from 32,768 local samples." : "");
        panel.append(estimate);
      } else if (forecast.trait) {
        const heading = node(revealTarget ? "label" : "div", "success-heading", forecast.targetName ? forecast.targetName + (revealTarget ? " · " + forecast.defense : "") : forecast.label || "Success rate");
        // Do not put an enemy's TN in hidden inputs, tooltips or ARIA text.
        // Players retain the probability preview without its defense breakdown.
        if (revealTarget) {
          const target = node("input", "success-target"); target.type = "number"; target.step = "1"; target.value = targetNumber;
          target.setAttribute("aria-label", "Preview target number"); target.title = "Preview target number; this does not modify the roll.";
          target.addEventListener("change", () => { const value = Number(target.value); if (Number.isFinite(value)) { if (forecast.targetKey) state.targets.set(forecast.targetKey, value); else state.target = value; } });
          heading.append(node("span", "", "TN"), target);
        }
        const bar = node("div", "success-bar"), legend = node("div", "success-legend");
        [forecast.extra ? "Crit Fail*" : "Crit Fail", "Fail", "Success", "Raise"].forEach((name, i) => {
          const probability = i === 3 ? statistics.outcomes[3] + statistics.outcomes[4] : statistics.outcomes[i];
          const segment = node("span", "outcome outcome-" + i); segment.style.width = (probability * 100) + "%";
          const description = name + ": " + (probability * 100).toFixed(1) + "%";
          segment.title = description; segment.setAttribute("aria-label", description);
          bar.append(segment);
          const label = node("span", "outcome-label outcome-" + i, name + " " + (probability * 100).toFixed(1) + "%"); legend.append(label);
        });
        bar.setAttribute("role", "img"); bar.setAttribute("aria-label", [...legend.children].map((el) => el.textContent).join(", "));
        panel.append(heading, bar, legend);
        if (revealTarget && forecast.defenseDetails) panel.append(node("small", "insight-note", forecast.defenseDetails));
        if (forecast.extra) panel.append(node("small", "insight-note", "*Critical-failure candidate; native confirmation still applies for Extras."));
      }
    }
    if (!panel.children.length) panel.remove();
    this.sizeToolsDialog(app, state, panel.children.length > 0);
  }
  chat(message, root) {
    if (!root || !message.rolls?.length) return;
    const previous = this.messages.get(message.id ?? root);
    previous?.observer.disconnect();
    const render = () => {
      root.querySelectorAll(".swade-hud-roll-range").forEach((box) => {
        if (!enabled("chatRollRange") || message.isContentVisible === false) box.remove();
      });
      if (!enabled("chatRollRange") || message.isContentVisible === false || message.visible === false || (message.blind && message.isContentVisible === undefined && !game.user.isGM)) return;
      const rolls = [...root.querySelectorAll(".dice-roll")];
      message.rolls.forEach((roll, index) => {
        const container = rolls[index];
        if (!container || !Number.isFinite(roll.total)) return;
        const anchor = container.querySelector(".dice-formula") ?? container.querySelector(".dice-result") ?? container.firstElementChild;
        if (!anchor) return;
        const previous = anchor.previousElementSibling;
        if (previous?.classList.contains("swade-hud-roll-range")) {
          if (previous.dataset.formula === roll.formula && previous.dataset.total === String(roll.total)) return;
          previous.remove();
        }
        anchor.before(createRangeScale(roll));
      });
    };
    const observer = new MutationObserver(render);
    observer.observe(root, { childList: true, subtree: true });
    this.messages.set(message.id ?? root, { root, message, observer, render });
    if (this.messages.size > 128) { const key = this.messages.keys().next().value; this.messages.get(key).observer.disconnect(); this.messages.delete(key); }
    render();
  }
  refreshDialogs() {
    for (const [app, state] of this.dialogs) {
      if (!state.root.isConnected) this.forgetDialog(app); else this.updateDialog(app, state);
    }
  }
  refresh() {
    this.refreshDialogs();
    document.querySelectorAll(".swade-hud-roll-range").forEach((element) => { if (!enabled("chatRollRange")) element.remove(); });
    for (const [key, entry] of this.messages) {
      if (!entry.root.isConnected) { entry.observer.disconnect(); this.messages.delete(key); } else entry.render();
    }
  }
}
