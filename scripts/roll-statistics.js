// Pure probability calculations. Never evaluates a Foundry Roll, calls its RNG,
// spends resources, or executes formula text as JavaScript.
const EPSILON = 1e-12;
const MAX_WORK = 600000;
const cache = new Map();
const point = (value, probability = 1) => new Map([[value, probability]]);
const add = (map, value, probability) => map.set(value, (map.get(value) ?? 0) + probability);

export function parseFormula(input) {
  const text = String(input).replace(/\[[^\]]*\]/g, "").replace(/[−–]/g, "-").replace(/\s+/g, "");
  let cursor = 0, serial = 0;
  const read = (pattern) => { const match = pattern.exec(text.slice(cursor)); if (match) cursor += match[0].length; return match; };
  const modifiers = () => {
    const result = [];
    let match;
    while ((match = read(/^(kh|kl|dh|dl|xo|x|ro|r|cs|cf|min|max)(?:(<=|>=|=|<|>)(-?\d+)|(\d+))?/i))) {
      result.push({ kind: match[1].toLowerCase(), comparison: match[2], value: match[3] === undefined && match[4] === undefined ? undefined : Number(match[3] ?? match[4]) });
    }
    return result;
  };
  function primary() {
    if (read(/^\+/)) return primary();
    if (read(/^-/)) return { kind: "binary", op: "*", left: { kind: "number", value: -1 }, right: primary() };
    if (read(/^\(/)) { const node = expression(); if (!read(/^\)/)) throw Error("Unclosed parenthesis"); return node; }
    if (read(/^\{/)) {
      const rolls = [expression()];
      while (read(/^,/)) rolls.push(expression());
      if (!read(/^\}/)) throw Error("Unclosed dice pool");
      return { kind: "pool", rolls, modifiers: modifiers() };
    }
    const die = read(/^(\d*)d(w\d*|\d+|f|c)/i);
    if (die) {
      const denomination = die[2].toLowerCase();
      const faces = denomination[0] === "w" ? Number(denomination.slice(1) || 6) : denomination === "f" ? 3 : denomination === "c" ? 2 : Number(denomination);
      const number = Number(die[1] || 1);
      if (number < 1 || number > 100 || faces < 1 || faces > 1000) throw Error("Dice exceed analysis limits");
      return { kind: "die", id: ++serial, number, faces, wild: denomination[0] === "w", fate: denomination === "f", coin: denomination === "c", modifiers: modifiers() };
    }
    const number = read(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) return { kind: "number", value: Number(number[0]) };
    const fn = read(/^(floor|ceil|round|abs|min|max)\(/i);
    if (fn) {
      const args = [expression()];
      while (read(/^,/)) args.push(expression());
      if (!read(/^\)/)) throw Error("Unclosed function");
      return { kind: "function", name: fn[1].toLowerCase(), args };
    }
    throw Error("Unsupported formula term");
  }
  function expression(minimum = 0) {
    let left = primary();
    const precedences = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3, "**": 3 };
    while (cursor < text.length) {
      const op = /^(\*\*|[+*/%^-])/.exec(text.slice(cursor))?.[0];
      const precedence = precedences[op];
      if (!precedence || precedence < minimum) break;
      cursor += op.length;
      left = { kind: "binary", op, left, right: expression(precedence + (op === "^" || op === "**" ? 0 : 1)) };
    }
    return left;
  }
  if (!text || text.length > 1500) throw Error("Invalid formula length");
  const root = expression();
  if (cursor !== text.length) throw Error("Unsupported dice modifier or formula");
  return root;
}

function compare(value, comparison, target) {
  return ({ "=": value === target, "<": value < target, ">": value > target, "<=": value <= target, ">=": value >= target })[comparison ?? "="];
}
function operation(op, a, b) {
  return ({ "+": () => a + b, "-": () => a - b, "*": () => a * b, "/": () => a / b, "%": () => a % b, "^": () => a ** b, "**": () => a ** b })[op]();
}
function calculate(root, forced = new Map()) {
  let work = 0;
  const spend = () => { if (++work > MAX_WORK) throw Error("Formula exceeds exact analysis limits"); };
  const combine = (a, b, fn) => {
    const result = new Map();
    for (const [x, px] of a) for (const [y, py] of b) { spend(); const value = fn(x, y); if (!Number.isFinite(value)) throw Error("Non-finite arithmetic"); add(result, value, px * py); }
    return result;
  };
  const select = (maps, mods) => {
    if (!mods.length) return maps.reduce((sum, map) => combine(sum, map, (a, b) => a + b), point(0));
    if (mods.length !== 1 || !["kh", "kl", "dh", "dl"].includes(mods[0].kind)) throw Error("Unsupported pool modifier");
    const mod = mods[0], count = mod.value ?? 1;
    const keep = mod.kind[0] === "d" ? Math.max(0, maps.length - count) : Math.min(count, maps.length);
    const high = ["kh", "dl"].includes(mod.kind);
    if (keep === 0) return point(0);
    if (keep === 1) {
      // CDF products avoid enumerating every combination of acing dice.
      const values = [...new Set(maps.flatMap((map) => [...map.keys()]))].sort((a, b) => a - b);
      const result = new Map(), totals = maps.map((map) => [...map.values()].reduce((a, b) => a + b, 0));
      const cumulative = maps.map(() => 0);
      let previous = high ? 0 : totals.reduce((a, b) => a * b, 1);
      for (const value of values) {
        if (high) {
          maps.forEach((map, i) => cumulative[i] += map.get(value) ?? 0);
          const now = cumulative.reduce((a, b) => a * b, 1);
          add(result, value, Math.max(0, now - previous)); previous = now;
        } else {
          maps.forEach((map, i) => cumulative[i] += map.get(value) ?? 0);
          const now = cumulative.reduce((p, c, i) => p * (totals[i] - c), 1);
          add(result, value, Math.max(0, previous - now)); previous = now;
        }
      }
      return result;
    }
    const result = new Map();
    function visit(index, values, probability) {
      if (index === maps.length) { values.sort((a, b) => high ? b - a : a - b); add(result, values.slice(0, keep).reduce((a, b) => a + b, 0), probability); return; }
      for (const [value, p] of maps[index]) { spend(); visit(index + 1, [...values, value], probability * p); }
    }
    visit(0, [], 1);
    return result;
  };
  function evaluate(node) {
    if (node.kind === "number") return point(node.value);
    if (node.kind === "binary") return combine(evaluate(node.left), evaluate(node.right), (a, b) => operation(node.op, a, b));
    if (node.kind === "pool") return select(node.rolls.map(evaluate), node.modifiers);
    if (node.kind === "function") {
      if (["min", "max"].includes(node.name)) return node.args.map(evaluate).reduce((a, b) => combine(a, b, Math[node.name]));
      if (node.args.length !== 1) throw Error("Unsupported function arguments");
      const result = new Map(); for (const [value, p] of evaluate(node.args[0])) add(result, Math[node.name](value), p); return result;
    }
    const die = new Map(), mods = node.modifiers;
    const explosion = mods.find((mod) => ["x", "xo"].includes(mod.kind)) ?? (node.wild ? { kind: "x" } : null);
    const reroll = mods.find((mod) => ["r", "ro"].includes(mod.kind));
    if (mods.some((mod) => !["x", "xo", "r", "ro", "kh", "kl", "dh", "dl", "min", "max", "cs", "cf"].includes(mod.kind))) throw Error("Unsupported die modifier");
    const faces = Array.from({ length: node.faces }, (_, i) => node.fate ? i - 1 : node.coin ? i : i + 1);
    const rollsAgain = (value) => reroll && compare(value, reroll.comparison, reroll.value ?? 1);
    const rerolled = faces.filter(rollsAgain).length / node.faces;
    if (rerolled === 1 && reroll?.kind === "r") throw Error("Infinite reroll");
    const faceProbability = (value) => reroll ? reroll.kind === "r" ? (rollsAgain(value) ? 0 : 1 / node.faces / (1 - rerolled))
      : (rollsAgain(value) ? 0 : 1 / node.faces) + rerolled / node.faces : 1 / node.faces;
    const explode = (value) => explosion && compare(value, explosion.comparison, explosion.value ?? faces.at(-1));
    if (explosion && faces.every(explode)) throw Error("Unbounded non-terminating explosion");
    let frontier = point(0);
    for (let level = 0; frontier.size && level < 80; level++) {
      const next = new Map();
      for (const [sum, p] of frontier) for (const face of faces) {
        spend();
        const probability = p * faceProbability(face);
        if (!probability) continue;
        if (level === 0 && forced.has(node.id) && (face === 1) !== forced.get(node.id)) continue;
        const value = sum + face;
        if (explode(face) && (explosion.kind !== "xo" || level === 0)) add(next, value, probability);
        else add(die, value, probability);
      }
      if ([...next.values()].reduce((a, b) => a + b, 0) < EPSILON) break;
      frontier = next;
    }
    let bounded = die;
    for (const mod of mods.filter((mod) => ["min", "max", "cs", "cf"].includes(mod.kind))) {
      const previous = bounded;
      bounded = new Map();
      for (const [value, p] of previous) add(bounded, mod.kind === "min" ? Math.max(value, mod.value) : mod.kind === "max" ? Math.min(value, mod.value)
        : (compare(value, mod.comparison ?? ">=", mod.value ?? node.faces) ? (mod.kind === "cf" ? -1 : 1) : 0), p);
    }
    return select(Array.from({ length: node.number }, () => bounded), mods.filter((mod) => ["kh", "kl", "dh", "dl"].includes(mod.kind)));
  }
  return evaluate(root);
}

function diceIn(node) {
  if (node.kind === "die") return [node];
  if (node.kind === "binary") return [...diceIn(node.left), ...diceIn(node.right)];
  return (node.rolls ?? node.args ?? []).flatMap(diceIn);
}
function sampledDistribution(root, formula) {
  // Fixed local PRNG: large keep/drop pools can be estimated without touching
  // Foundry's RNG or generating real dice results. The UI labels this estimate.
  let seed = [...formula].reduce((seed, letter) => Math.imul(seed ^ letter.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const select = (values, mods) => {
    if (mods.length) {
      const mod = mods[0], high = ["kh", "dl"].includes(mod.kind);
      values.sort((a, b) => high ? b - a : a - b);
      const count = mod.kind[0] === "d" ? Math.max(0, values.length - (mod.value ?? 1)) : mod.value ?? 1;
      values = values.slice(0, count);
    }
    return values.reduce((a, b) => a + b, 0);
  };
  function sample(node) {
    if (node.kind === "number") return node.value;
    if (node.kind === "binary") return operation(node.op, sample(node.left), sample(node.right));
    if (node.kind === "pool") return select(node.rolls.map(sample), node.modifiers);
    if (node.kind === "function") return Math[node.name](...node.args.map(sample));
    const reroll = node.modifiers.find((mod) => ["r", "ro"].includes(mod.kind));
    const explosion = node.modifiers.find((mod) => ["x", "xo"].includes(mod.kind)) ?? (node.wild ? { kind: "x" } : null);
    const face = () => {
      let value, repeats = 0;
      do {
        value = Math.floor(random() * node.faces) + (node.fate ? -1 : node.coin ? 0 : 1);
        if (++repeats > 1000) throw Error("Non-terminating die");
      } while (reroll && compare(value, reroll.comparison, reroll.value ?? 1) && (reroll.kind === "r" || repeats === 1));
      return value;
    };
    const values = [];
    for (let i = 0; i < node.number; i++) {
      let value = 0, next, aces = 0;
      do {
        next = face(); value += next;
        if (++aces > 1000) throw Error("Non-terminating die");
      } while (explosion && compare(next, explosion.comparison, explosion.value ?? (node.fate ? 1 : node.coin ? 1 : node.faces)) && (explosion.kind !== "xo" || aces === 1));
      for (const mod of node.modifiers) {
        if (mod.kind === "min") value = Math.max(value, mod.value);
        if (mod.kind === "max") value = Math.min(value, mod.value);
        if (mod.kind === "cs" || mod.kind === "cf") value = compare(value, mod.comparison ?? ">=", mod.value ?? node.faces) ? (mod.kind === "cf" ? -1 : 1) : 0;
      }
      values.push(value);
    }
    return select(values, node.modifiers.filter((mod) => ["kh", "kl", "dh", "dl"].includes(mod.kind)));
  }
  const distribution = new Map(), count = 32768;
  for (let i = 0; i < count; i++) { const value = sample(root); if (!Number.isFinite(value)) throw Error("Non-finite arithmetic"); add(distribution, value, 1 / count); }
  return distribution;
}
function traitDice(root) {
  const first = root.kind === "binary" ? traitDice(root.left) : root;
  if (Array.isArray(first)) return first;
  return first.kind === "pool" ? first.rolls.map((roll) => diceIn(roll)[0]).filter(Boolean) : diceIn(first).slice(0, 1);
}
function limits(root, entries) {
  if (root.kind === "number") return [root.value, root.value];
  if (root.kind === "binary") {
    const [a, b] = limits(root.left, entries), [c, d] = limits(root.right, entries);
    if (root.op === "+") return [a + c, b + d];
    if (root.op === "-") return [a - d, b - c];
    if (["*", "/"].includes(root.op)) {
      if (root.op === "*" && ((a === 0 && b === 0) || (c === 0 && d === 0))) return [0, 0];
      if (root.op === "/" && c <= 0 && d >= 0) throw Error("Division through zero");
      const values = [operation(root.op, a, c), operation(root.op, a, d), operation(root.op, b, c), operation(root.op, b, d)].filter((v) => !Number.isNaN(v));
      return [Math.min(...values), Math.max(...values)];
    }
    if (["^", "**"].includes(root.op) && c === d && c > 0) {
      if (a >= 0 || Number.isInteger(c) && c % 2 === 1) return [a ** c, b ** c];
      if (Number.isInteger(c)) return [a <= 0 && b >= 0 ? 0 : Math.min(a ** c, b ** c), Math.max(a ** c, b ** c)];
    }
  }
  if (root.kind === "die") {
    const unbounded = root.wild || root.modifiers.some((mod) => mod.kind === "x");
    const values = [...calculate({ ...root, number: 1, modifiers: root.modifiers.filter((mod) => !["kh", "kl", "dh", "dl"].includes(mod.kind)) }).keys()];
    const mod = root.modifiers.find((mod) => ["kh", "kl", "dh", "dl"].includes(mod.kind));
    const count = !mod ? root.number : mod.kind[0] === "d" ? Math.max(0, root.number - (mod.value ?? 1)) : Math.min(root.number, mod.value ?? 1);
    return [Math.min(...values) * count, count && unbounded && !root.modifiers.some((mod) => mod.kind === "max" || ["cs", "cf"].includes(mod.kind)) ? Infinity : Math.max(...values) * count];
  }
  if (root.kind === "pool") {
    const children = root.rolls.map((node) => limits(node, entries));
    const mod = root.modifiers[0];
    const keep = !mod ? children.length : mod.kind[0] === "d" ? Math.max(0, children.length - (mod.value ?? 1)) : Math.min(children.length, mod.value ?? 1);
    const high = mod && ["kh", "dl"].includes(mod.kind);
    return [0, 1].map((index) => children.map((range) => range[index]).sort((a, b) => high ? b - a : a - b).slice(0, keep).reduce((a, b) => a + b, 0));
  }
  if (root.kind === "function") {
    const children = (root.rolls ?? root.args).map((node) => limits(node, entries));
    if (["min", "max"].includes(root.name)) return [0, 1].map((i) => Math[root.name](...children.map((range) => range[i])));
    const [low, high] = children[0];
    if (root.name === "abs") return [low <= 0 && high >= 0 ? 0 : Math.min(Math.abs(low), Math.abs(high)), Math.max(Math.abs(low), Math.abs(high))];
    return [Math[root.name](low), Math[root.name](high)];
  }
  const local = [...calculate(root).keys()];
  return [Math.min(...local), Math.max(...local)];
}

export function rollStatistics(formula, { trait = false, target = 4, bestShot = false } = {}) {
  const key = JSON.stringify([formula, trait, target, bestShot]);
  if (cache.has(key)) return cache.get(key);
  try {
    const root = parseFormula(formula);
    if (bestShot) {
      let node = root;
      while (node.kind === "binary") node = node.left;
      if (node.kind === "pool") node.modifiers = [{ kind: "kh", value: 1 }];
    }
    let distribution, sampled = false;
    try { distribution = calculate(root); }
    catch (error) {
      if (trait || !error.message.includes("exact analysis limits")) throw error;
      distribution = sampledDistribution(root, formula); sampled = true;
    }
    const mass = [...distribution.values()].reduce((a, b) => a + b, 0);
    if (mass < 1 - 1e-8) throw Error("Analysis tail exceeds precision limit");
    const entries = [...distribution].sort(([a], [b]) => a - b);
    const [minimum, maximum] = limits(root, entries);
    const average = entries.reduce((sum, [value, probability]) => sum + value * probability, 0) / mass;
    const critical = new Map();
    if (trait) {
      const dice = traitDice(root);
      if (dice.some((die) => die.number !== 1) || dice.length > 8) throw Error("Unsupported trait pool");
      for (let mask = 0; mask < 2 ** dice.length; mask++) {
        const ones = dice.map((_, i) => Boolean(mask & (1 << i)));
        if (ones.filter(Boolean).length <= dice.length / 2 || dice.some((die, i) => die.wild && !ones[i])) continue;
        for (const [value, p] of calculate(root, new Map(dice.map((die, i) => [die.id, ones[i]])))) add(critical, value, p);
      }
    }
    const outcomes = [0, 0, 0, 0, 0];
    for (const [value, probability] of entries) {
      const crit = Math.min(probability, critical.get(value) ?? 0);
      outcomes[0] += crit;
      outcomes[value < target ? 1 : value < target + 4 ? 2 : value < target + 8 ? 3 : 4] += probability - crit;
    }
    const result = { minimum, maximum, average, outcomes: outcomes.map((p) => Math.max(0, p / mass)),
      cdf: (value) => entries.reduce((p, [v, probability]) => p + (v <= value ? probability : 0), 0) / mass,
      coordinateCDF: (value) => {
        let cumulative = 0, previousValue = entries[0][0], previous = 0;
        for (const [v, p] of entries) {
          cumulative += p;
          if (value <= v) return (v === previousValue ? cumulative : previous + (cumulative - previous) * (value - previousValue) / (v - previousValue)) / mass;
          previousValue = v; previous = cumulative;
        }
        return 1;
      },
      unbounded: ![minimum, maximum].every(Number.isFinite), approximate: sampled, formula };
    if (!Number.isFinite(average) || Number.isNaN(minimum) || Number.isNaN(maximum)) throw Error("Invalid statistics");
    if (cache.size >= 96) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  } catch { if (cache.size >= 96) cache.delete(cache.keys().next().value); cache.set(key, null); return null; }
}

export function rangePosition(statistics, value) {
  if (!Number.isFinite(value)) return 0;
  const { minimum, maximum, average } = statistics;
  if (minimum === maximum) return 0.5;
  if (!Number.isFinite(maximum) || !Number.isFinite(minimum)) {
    const middle = statistics.coordinateCDF(average);
    const low = Number.isFinite(minimum) ? statistics.cdf(minimum) : 0;
    const p = statistics.coordinateCDF(value);
    return Math.max(0, Math.min(1, p <= middle ? 0.5 * (p - low) / (middle - low || 1) : 0.5 + 0.5 * (p - middle) / (1 - middle || 1)));
  }
  return Math.max(0, Math.min(1, value <= average ? 0.5 * (value - minimum) / (average - minimum || 1)
    : 0.5 + 0.5 * (value - average) / (maximum - average || 1)));
}
