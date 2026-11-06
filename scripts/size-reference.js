// Transcribed from the Size Table supplied by the user. These are the rules
// reference values; token footprints continue to use the requested HUD ranges.
const groups = [
  ["Tiny", [
    [-4, "1", "−6", "6″", "<4 lbs", "Crow, mouse"],
  ]],
  ["Very Small", [
    [-3, "d4−3", "−4", "18″", "16 lbs", "House cat, small dogs"],
  ]],
  ["Small", [
    [-2, "d4−1", "−2", "3′", "32 lbs", "Coyote, bobcat, porcupine"],
  ]],
  ["Normal", [
    [-1, "d4 to d6", "—", "4′", "125 lbs", "Child, wolf, half-folk, goblin"],
    [0, "d6 to d12", "—", "6′", "250 lbs", "Human, Great Dane, dire wolf"],
    [1, "d8 to d12+1", "—", "8′", "500 lbs", "Large human, gorilla, lion, orc"],
    [2, "d10 to d12+2", "—", "9′", "1000 lbs", "Grizzly, horse, ogre, tiger shark"],
    [3, "d12 to d12+3", "—", "12′", "2000 lbs", "Bull, war horse"],
  ]],
  ["Large (+1 Wound)", [
    [4, "d12+1 to d12+4", "+2", "15′", "2 tons", "Hippo, great white shark"],
    [5, "d12+2 to d12+5", "+2", "18′", "4 tons", "White rhino, beluga whale"],
    [6, "d12+3 to d12+6", "+2", "24′", "8 tons", "African elephant, drake, orca"],
    [7, "d12+4 to d12+7", "+2", "30′", "16 tons", "T-Rex, triceratops"],
  ]],
  ["Huge (+2 Wounds)", [
    [8, "d12+5 to d12+8", "+4", "36′", "32 tons", "Dragon, sperm whale"],
    [9, "d12+6 to d12+9", "+4", "50′", "64 tons", "Humpback whale"],
    [10, "d12+7 to d12+10", "+4", "63′", "125 tons", "Bowhead whale"],
    [11, "d12+8 to d12+11", "+4", "75′", "250 tons", "Blue whale"],
  ]],
  ["Gargantuan (+3 Wounds)", [
    [12, "d12+9 to d12+12", "+6", "100′", "500 tons", "Kaiju or giant monsters"],
    [13, "d12+10 to d12+13", "+6", "125′", "1K tons", ""],
    [14, "d12+11 to d12+14", "+6", "150′", "2K tons", ""],
    [15, "d12+12 to d12+15", "+6", "200′", "4K tons", ""],
    [16, "d12+13 to d12+16", "+6", "250′", "8K tons", ""],
    [17, "d12+14 to d12+17", "+6", "300′", "16K tons", ""],
    [18, "d12+15 to d12+18", "+6", "400′", "32K tons", ""],
    [19, "d12+16 to d12+19", "+6", "500′", "64K tons", ""],
    [20, "d12+17 to d12+20", "+6", "600′", "125K tons", ""],
  ]],
];

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function renderSizeReference() {
  const content = element("div");
  content.className = "size-reference-content";
  content.append(element("p", "Use mass and overall dimensions to estimate a creature’s Size and Toughness bonus."));
  const tiny = element("p", "Tiny creatures have Strength 1 and cannot make Strength rolls, Ace, or gain bonus damage. They can harm creatures with Toughness 1, and must swarm to harm Small or larger beings (see Swarms, page 189).");
  tiny.className = "size-reference-note";
  content.append(tiny);
  const table = element("table");
  table.setAttribute("aria-label", "Size Table");
  const head = element("thead");
  const headings = element("tr");
  for (const text of ["Size / Toughness Bonus", "Typical Strength Range", "Scale Modifier", "Typical Height / Length Up To…", "Mass Up To…", "Example Creatures"]) {
    const cell = element("th", text);
    cell.scope = "col";
    headings.append(cell);
  }
  head.append(headings);
  table.append(head);
  for (const [label, rows] of groups) {
    const body = element("tbody");
    const group = element("tr");
    group.className = "size-group";
    const heading = element("th", label);
    heading.colSpan = 6;
    heading.scope = "rowgroup";
    group.append(heading);
    body.append(group);
    for (const values of rows) {
      const row = element("tr");
      row.dataset.size = String(values[0]);
      values.forEach((value, index) => {
        const cell = element(index === 0 ? "th" : "td", value);
        if (index === 0) cell.scope = "row";
        row.append(cell);
      });
      body.append(row);
    }
    table.append(body);
  }
  content.append(table);
  return content;
}
