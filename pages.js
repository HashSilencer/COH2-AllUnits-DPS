// Pages of the DPS site, from site_data.js (written by the DPS Site Editor's "Export to site").
// The menus are built from its factions, categories and pages, in the editor's order. Each page
// keeps its weapons' base stats; veterancy, upgrades, per-weapon tuning and the site-wide
// modifiers are applied to a copy whenever a weapon is calculated or shown.
// Loaded after engine.js, so it can replace and wrap functions defined there.

var FACTION_NAMES = {
	"aef": "US Forces", "british": "British Forces", "german": "Wehrmacht Ostheer",
	"soviet": "Soviet Army", "west_german": "Oberkommando West"
};

// Weapon modifiers and the weapon fields they change.
var MODIFIER_FIELDS = {
	"accuracy_weapon_modifier":            [["accuracy", "near"], ["accuracy", "mid"], ["accuracy", "far"]],
	"damage_weapon_modifier":              [["damage", "min"], ["damage", "max"]],
	"cooldown_weapon_modifier":            [["cooldown", "duration", "min"], ["cooldown", "duration", "max"]],
	"reload_weapon_modifier":              [["reload", "duration", "min"], ["reload", "duration", "max"]],
	"range_weapon_modifier":               [["range", "max"]],
	"weapon_burst_length_modifier":        [["burst", "duration", "min"], ["burst", "duration", "max"]],
	"weapon_burst_rate_of_fire_modifier":  [["burst", "rate_of_fire", "min"], ["burst", "rate_of_fire", "max"]],
	"weapon_penetration_modifier":         [["penetration", "near"], ["penetration", "mid"], ["penetration", "far"]],
	"weapon_scatter":                      [["scatter", "angle_scatter"], ["scatter", "distance_scatter_ratio"], ["scatter", "distance_scatter_max"]],
	"weapon_suppression_modifier":         [["suppression", "amount"]],
	"horizontal_speed_weapon_modifier":    [["tracking", "normal", "speed_horizontal"]],
	"weapon_horizontal_traverse":          [["tracking", "normal", "speed_horizontal"]],
	"weapon_horizontal_fire_cone":         [["tracking", "fire_cone_angle"]]
};

// The game's modusagetype values, applied to one stat.
var MODIFIER_OPERATIONS = {
	"multiplication":          function (x, v) { return x * v; },
	"addition":                function (x, v) { return x + v; },
	"multiplication_addition": function (x, v) { return x * (1 + v); },
	"multiply_add":            function (x, v) { return x * v; },
	"set":                     function (x, v) { return v; }
};

var PAGES = SITE.pages;
var PAGE_BY_KEY = {};
var pageState = [];      // per page: { vet: rank, upgrades: [on/off] }


// ------------------------------------------------------------------ AOE in DPS

// Share of a weapon's damage that a missed shot still does to the target, from the scatter rule
// (基础设定篇): a miss lands in an annular sector around the target, angle_scatter wide either side
// and distance_scatter_ratio x distance deep (at most distance_scatter_max); distance_scatter_offset
// is the part that lands outside it and does nothing. Inside, landing points are taken as evenly
// spread, and the AOE falloff (near/mid/far, linear between) is averaged over them. One target.
function aoeFactor(weapon, d)
{
	var r = weapon.area_effect && weapon.area_effect.area_info ? weapon.area_effect.area_info.radius : 0;
	if (!(r > 0) || !weapon.scatter) return 0;
	var aoe = weapon.area_effect, s = weapon.scatter;
	var band = function (x) {
		var n = aoe.distance.near, m = aoe.distance.mid, f = aoe.distance.far, dm = aoe.damage;
		if (f <= 0 || f > r) f = r;
		if (x > f) return 0;
		if (x <= n) return dm.near;
		if (x <= m) return dm.near + (dm.mid - dm.near) * (x - n) / Math.max(m - n, 1e-9);
		return dm.mid + (dm.far - dm.mid) * (x - m) / Math.max(f - m, 1e-9);
	};
	var depth = Math.min(s.distance_scatter_ratio * d, s.distance_scatter_max);
	var half = (s.angle_scatter || 0) * Math.PI / 180;
	var steps = 24, sum = 0, weight = 0;
	for (var i = 0; i < steps; i++)
	{
		var rr = Math.max(0, d - depth + (2 * depth) * (i + 0.5) / steps);
		for (var j = 0; j < steps; j++)
		{
			var a = -half + 2 * half * (j + 0.5) / steps;
			var dist = Math.sqrt(Math.max(0, rr * rr + d * d - 2 * rr * d * Math.cos(a)));
			var w = Math.max(rr, 1e-6);   // even spread over the sector's area
			sum += band(dist) * w;
			weight += w;
		}
	}
	var inside = 1 - Math.min(Math.max(s.distance_scatter_offset || 0, 0), 1);
	return weight > 0 ? inside * sum / weight : 0;
}

// ------------------------------------------------------------------ the target

// What the chart's weapons shoot at: its unit types (for the weapons' target_type_table), target
// size and armor. By default infantry, size 1, armor 1.
// every unit type some weapon's target_type_table has a row for
var TARGET_TYPES = (function () {
	var seen = {};
	Object.keys(SITE.weapons).forEach(function (k) { (SITE.weapons[k].target_type_table || []).forEach(function (r) { if (r.unit_type) seen[r.unit_type] = true; }); });
	return Object.keys(seen).sort();
})();
var TARGET = { types: ["infantry"], size: 1, armor: 1 };

// Puts the target into the engine's globals (target_size, target_armor) before a calculation.
function applyTarget()
{
	target_size = TARGET.size > 0 ? TARGET.size : 1;
	target_armor = TARGET.armor > 0 ? TARGET.armor : 1;
}

// The weapon's target_type_table row for the target: the first one naming one of its types.
function typeMultipliers(weapon)
{
	var rows = weapon.target_type_table || [];
	for (var i = 0; i < rows.length; i++)
		if (TARGET.types.indexOf(rows[i].unit_type) >= 0 && rows[i].weapon_multipliers) return rows[i].weapon_multipliers;
	return { accuracy_multiplier: 1, damage_multiplier: 1, penetration_multiplier: 1 };
}

// DPS with the AOE of missed shots counted for weapons that have one. Accuracy is times the
// target's size (at most 100%), with the weapon's multipliers for the target's types. Against
// armor (above 1) a hit penetrates with pen / armor (none under 3%) and a deflected one does the
// weapon's deflection damage if it has any; a miss's explosion uses the AOE's own penetration.
DPSCalc = function (weapon, range, moving) {
	if (weapon.dot) return dotDPS(weapon, moving);
	if (moving && weapon.moving.disable_moving_firing) return 0;
	var tm = typeMultipliers(weapon);
	var accuracy = getAccuracy(weapon, range, moving);
	if (accuracy > 0 && tm.accuracy_multiplier != 1) accuracy = Math.min(1, accuracy * tm.accuracy_multiplier);
	var armored = target_armor > 1;
	var splash = aoeFactor(weapon, range);
	if (accuracy == 0 && splash == 0) return 0;
	var hit = getDamage(weapon) * tm.damage_multiplier, blast = hit;
	if (armored)
	{
		var p = penetrate(Rangemodifier(range, weapon.penetration, weapon.range) * tm.penetration_multiplier);
		var deflected = weapon.deflection && weapon.deflection.has_deflection_damage ? weapon.deflection.deflection_damage_multiplier : 0;
		hit *= p + (1 - p) * deflected;
		// A miss's explosion gets through with the AOE's own penetration (at its centre).
		var ap = weapon.area_effect && weapon.area_effect.aoe_penetration;
		blast *= ap ? penetrate(ap.near * tm.penetration_multiplier) : 0;
	}
	var miss = (1 - Math.min(accuracy, 1)) * splash;
	var perShot = hit * accuracy + blast * miss;
	return perShot * numberofshots(weapon, range, moving) / DPSTime(weapon, range, moving);
};

// A weapon's damage over time (a "(DoT)" weapon): its own weapon hits whoever stands in it every
// dot.frequency seconds, whatever the range. A hit penetrates (pen / armor, infantry armor 1)
// for the weapon's damage plus its on-penetrated damage actions, or is deflected for the
// deflection damage plus its on-deflected actions (white phosphorus works that way). Times the
// DoT stacks chosen on the page (overlapping fires), at the centre of the burning ground.
var dotStacksNow = 1;

function dotDPS(weapon, moving)
{
	if (moving) return 0;
	var d = weapon.dot;
	if (!(d.frequency > 0)) return 0;
	var armored = target_armor > 1;
	var base = getDamage(weapon) * d.centre;
	var pen = weapon.penetration ? weapon.penetration.near : 0;
	var p = armored ? penetrate(pen) : Math.min(Math.max(pen, 0), 1);
	var hit = base + (armored ? d.vehicle_penetrated : d.infantry_penetrated);
	var miss = base * d.deflection_multiplier + (armored ? d.vehicle_deflected : d.infantry_deflected);
	return (p * hit + (1 - p) * miss) * dotStacksNow / d.frequency;
}

// ------------------------------------------------------------------ building the engine's arrays

(function build() {
	PAGES.forEach(function (page, u) {
		PAGE_BY_KEY[page.key] = u;
		data[u] = [];
		label[u] = [];
		page.weapons.forEach(function (w, k) {
			var base = SITE.weapons[w.weapon];
			var copy = JSON.parse(JSON.stringify(base));
			copy.hardpoint = w.hardpoint;
			data[u][k] = copy;
			label[u][k] = w.label || w.weapon;
		});
		entities[u] = [page.entities.map(function (e) { return e.stats; })];
		elabel[u] = page.entities.map(function (e) { return e.name + (e.num > 1 ? " x" + e.num : ""); });
		squadinfo[u] = [page.name, 0, 1, 0, 0, page.pop];
		pageState[u] = { vet: 0, firstStrike: false, dotStacks: 1, stacks: {}, upgrades: page.upgrades.map(function (g) { return !!g.default_on; }) };
		page.hasFirstStrike = pageMods(page).some(function (m) { return m.state == "first_strike"; });
		page.hasDot = page.weapons.some(function (w) { return !!SITE.weapons[w.weapon].dot; });
	});
})();

// Every modifier a page carries (tuning, upgrades, veterancy).
function pageMods(page)
{
	var all = [];
	page.weapons.forEach(function (w) { w.tuning.forEach(function (r) { all = all.concat(r.modifiers); }); });
	page.upgrades.forEach(function (g) { all = all.concat(g.modifiers); });
	page.veterancy.forEach(function (r) { all = all.concat(r.modifiers); });
	return all;
}

// ------------------------------------------------------------------ modifiers

function applyModifier(weapon, type, operation, value)
{
	var fields = MODIFIER_FIELDS[type];
	var op = MODIFIER_OPERATIONS[operation];
	if (!fields || !op) return;
	for (var i = 0; i < fields.length; i++)
	{
		var path = fields[i];
		var obj = weapon;
		for (var j = 0; j < path.length - 1 && obj; j++) obj = obj[path[j]];
		var key = path[path.length - 1];
		if (obj && typeof obj[key] === "number")
			obj[key] = Math.round(op(obj[key], value) * 10000) / 10000;
	}
}

// Whether a modifier from the page applies to weapon k in this calculation.
function applies(m, page, k, moving)
{
	// A DoT is the game's separate weapon: the squad's bonuses do not reach it.
	var dw = data[PAGES.indexOf(page)][k];
	if (dw && dw.dot) return false;
	if (m.state == "moving" && !moving) return false;
	if (m.state == "stationary" && moving) return false;
	var state = pageState[PAGES.indexOf(page)];
	if (m.state == "first_strike" && !state.firstStrike) return false;
	// Off while a switch for one of these game upgrades is on (e.g. a penalty the upgrade removes).
	if (m.unless && m.unless.length && page.upgrades.some(function (g, i) { return state.upgrades[i] && g.upgrade && m.unless.indexOf(g.upgrade) >= 0; })) return false;
	// a stack tier: on when the chosen number of tiers reaches it
	if (m.stack && (state.stacks[m.stack] || 0) < m.stack_level) return false;
	// "vet:N": off from that rank on (e.g. a penalty lifted at vet 2)
	if (m.unless && m.unless.some(function (x) { return /^vet:\d+$/.test(x) && state.vet >= parseInt(x.substring(4), 10); })) return false;
	var w = page.weapons[k];
	if (m.only && m.only.length && m.only.indexOf(w.weapon) < 0) return false;
	if (m.except && m.except.length && m.except.indexOf(w.weapon) >= 0) return false;
	var hp = /hardpoint_0*(\d+)/.exec(m.target || "");
	if (hp && parseInt(hp[1], 10) != w.hardpoint) return false;
	return true;
}

// The modifiers in effect for weapon k of page u: per-weapon tuning, the upgrades switched on,
// the squad's veterancy up to the chosen rank (conditional ones with the Conditional switch), and the
// site-wide list.
function pageModifiers(u, k, moving)
{
	return pageModifierSources(u, k, moving).map(function (e) { return e.m; });
}

// ------------------------------------------------------------------ weapon list order

// Hidden sections of a page's weapon list after its own weapons (the export's "group"): 1
// incendiary grenades, 2 grenades and rifle grenades, 3 stun grenades, 4 smoke and flares,
// 5 damage over time, 6 anti-tank. They only order the list; no headings are shown.

// The weapon list in display order: own weapons first, then the sections in order; within each,
// the page's order, except that a "_vet" version follows its base weapon when the page has it
// (molotov_cocktail_weapon_vet_mp after molotov_cocktail_weapon_mp).
function weaponOrder(page)
{
	var names = page.weapons.map(function (w) { return w.weapon; });
	// (a vet version's DoT follows the base version's DoT)
	var base = function (n) { var dot = / \(DoT\)$/.test(n) ? " (DoT)" : ""; var b = n.replace(/ \(DoT\)$/, "").replace(/_vet(_?\d+)?(?=(_mp)?$)/, "") + dot; return b != n && names.indexOf(b) >= 0 ? b : null; };
	var groupOf = function (i) { var b = base(names[i]); return page.weapons[b ? names.indexOf(b) : i].group || 0; };
	var order = [];
	[0, 1, 2, 3, 4, 5, 6].forEach(function (g) {
		page.weapons.forEach(function (w, i) {
			if (groupOf(i) != g || base(names[i])) return;
			order.push(i);
			page.weapons.forEach(function (v, j) { if (base(names[j]) == names[i] && order.indexOf(j) < 0) order.push(j); });
		});
	});
	// anything left (a vet version of a weapon in another section, ...) at the end
	page.weapons.forEach(function (w, i) { if (order.indexOf(i) < 0) order.push(i); });
	return order;
}

// A conditional bonus with its own control on the page: a stack tier (tier buttons) or a first
// strike (the First strike box). The "Conditional bonuses" switch does not gate those.
function ownSwitch(m) { return !!m.stack || m.state == "first_strike"; }

// The same, each with where it comes from: { m, src }.
function pageModifierSources(u, k, moving)
{
	var page = PAGES[u], state = pageState[u], list = [];
	var add = function (src) { return function (m) { if (applies(m, page, k, moving)) list.push({ m: m, src: m.stack ? m.stack + " #" + m.stack_level : src }); }; };
	page.weapons[k].tuning.forEach(function (r) { if (r.rank <= state.vet) r.modifiers.forEach(add(r.rank ? "Tuning vet " + r.rank : "Tuning")); });
	// Stack tiers among the conditional bonuses follow the tier buttons, not that switch.
	// So do first-strike bonuses (the First strike box is their condition).
	page.upgrades.forEach(function (g, i) { var f = add(upgradeName(g)); g.modifiers.forEach(function (m) { if (state.upgrades[i] || ownSwitch(m) && g.name == "Conditional bonuses (game)") f(m); }); });
	// Veterancy bonuses that need a condition (cover...) go with the "Conditional bonuses" switch.
	var condOn = page.upgrades.some(function (g, i) { return state.upgrades[i] && g.name == "Conditional bonuses (game)"; });
	page.veterancy.forEach(function (r) { var f = add("Vet " + r.rank); if (r.rank <= state.vet) r.modifiers.forEach(function (m) { if (!m.conditional || condOn || ownSwitch(m)) f(m); }); });
	activeModifiers().forEach(function (m) { list.push({ m: { type: m.type, usage: m.operation, value: m.value }, src: "Slot modifier" }); });
	return list;
}

// What the shown weapon gets on its page: each bonus with its source, and the product per field.
function renderBonuses()
{
	var box = document.getElementById("bonuses");
	if (!box) return;
	box.innerHTML = "";
	if (currentunit < 0 || currentweapon < 0 || currentunit != currentdisplay || !PAGES[currentunit]) return;
	var standing = pageModifierSources(currentunit, currentweapon, false);
	var moving = pageModifierSources(currentunit, currentweapon, true).filter(function (e) { return e.m.state == "moving"; });
	var all = standing.concat(moving);
	var head = document.createElement("div");
	head.className = "bonushead";
	head.innerHTML = "Bonuses on " + label[currentunit][currentweapon] + (all.length ? "" : ": none");
	box.appendChild(head);
	if (!all.length) return;
	var table = document.createElement("table");
	table.className = "bonuses";
	all.forEach(function (e) {
		var tr = document.createElement("tr");
		tr.innerHTML = "<td>" + e.src + "</td><td>" + modifierText(e.m) + "</td>";
		table.appendChild(tr);
	});
	var total = {};
	standing.forEach(function (e) {
		if (e.m.usage != "multiplication" && e.m.usage != "addition") return;
		var key = e.m.type.replace(/_weapon_modifier$|_modifier$/, "").replace(/^weapon_/, "") + (e.m.usage == "addition" ? " +" : " x");
		total[key] = total[key] === undefined ? (e.m.usage == "addition" ? 0 : 1) : total[key];
		total[key] = e.m.usage == "addition" ? total[key] + e.m.value : total[key] * e.m.value;
	});
	var keys = Object.keys(total);
	if (keys.length)
	{
		var tr = document.createElement("tr");
		tr.className = "total";
		tr.innerHTML = "<td>Total (standing)</td><td>" + keys.map(function (k) { return k + (Math.round(total[k] * 1000) / 1000); }).join(", ") + "</td>";
		table.appendChild(tr);
	}
	box.appendChild(table);
}

// Run fn with data[u][k] replaced by its modified copy, then put the base back.
function withModified(u, k, moving, fn)
{
	var original = data[u] && data[u][k];
	if (original == null || !PAGES[u]) return fn();
	var list = pageModifiers(u, k, moving);
	if (list.length == 0) return fn();
	var copy = JSON.parse(JSON.stringify(original));
	list.forEach(function (m) { applyModifier(copy, m.type, m.usage, m.value); });
	data[u][k] = copy;
	try { return fn(); }
	finally { data[u][k] = original; }
}

var baseFullRangeDPS = fullRangeDPS;
fullRangeDPS = function (unit, windex, moving, forcedps) {
	// Multi-shot weapons (autocannons, flak) get a DPS curve, their AOE counted, not the
	// single-shot ballistic chart.
	var w = data[unit] && data[unit][windex];
	if (w && w.burst && w.burst.can_burst) forcedps = true;
	dotStacksNow = w && w.dot && pageState[unit] ? pageState[unit].dotStacks || 1 : 1;
	return withModified(unit, windex, !!moving, function () { return baseFullRangeDPS(unit, windex, moving, forcedps); });
};

var baseStatgenerator = statgenerator;
statgenerator = function (panel, unitid, weaponid) {
	var w = data[unitid] && data[unitid][weaponid];
	if (w && w.dot) base(panel, w, "Damage over time", dotgenerator);
	return withModified(unitid, weaponid, false, function () { return baseStatgenerator(panel, unitid, weaponid); });
};

function dotgenerator(dl, weapon)
{
	var d = weapon.dot;
	dtgenerator(dl, "Tick every", round(d.frequency, 3) + " s");
	dtgenerator(dl, "Duration", round(d.duration, 2) + " s");
	// A short, fierce burn (e.g. 0.5 s) has a high DPS but little damage in all.
	var saved = dotStacksNow;
	dotStacksNow = 1;
	dtgenerator(dl, "Damage per area", round(dotDPS(weapon, false) * d.duration, 2) + " (whole duration, one area)");
	dotStacksNow = saved;
	dtgenerator(dl, "Radius", round(d.radius, 2));
	if (d.patches != 1) dtgenerator(dl, "Areas per hit", round(d.patches, 2));
	if (d.centre != 1) dtgenerator(dl, "Centre multiplier", round(d.centre, 3));
	if (d.infantry_penetrated || d.infantry_deflected) dtgenerator(dl, "Extra vs infantry", round(d.infantry_penetrated, 3) + " / " + round(d.infantry_deflected, 3) + " (pen / defl)");
	if (d.vehicle_penetrated || d.vehicle_deflected) dtgenerator(dl, "Extra vs vehicles", round(d.vehicle_penetrated, 3) + " / " + round(d.vehicle_deflected, 3) + " (pen / defl)");
	dtgenerator(dl, "Weapon", d.source);
}

// ------------------------------------------------------------------ chart names

// What the line shows: weapon, rank and upgrades, so comparing a weapon with itself at another
// rank reads "vet 0" vs "vet 3".
function stateTag(u)
{
	if (u < 0 || !PAGES[u]) return "";
	var page = PAGES[u], state = pageState[u], parts = [];
	if (page.veterancy.length) parts.push("vet " + state.vet);
	if (state.firstStrike) parts.push("first strike");
	if (page.hasDot && state.dotStacks > 1) parts.push("DoT x" + state.dotStacks);
	Object.keys(state.stacks).forEach(function (k) { if (state.stacks[k]) parts.push(k + " " + state.stacks[k]); });
	var on = page.upgrades.filter(function (g, i) { return state.upgrades[i] != !!g.default_on; }).map(function (g, i) { return g.name; });
	page.upgrades.forEach(function (g, i) { if (state.upgrades[i] && !g.default_on) parts.push("+" + upgradeName(g)); if (!state.upgrades[i] && g.default_on) parts.push("-" + upgradeName(g)); });
	return parts.length ? " (" + parts.join(", ") + ")" : "";
}

function shortUpgrade(name) { return name.replace(/ \(game\)$/, ""); }

// A switch's name on the site: its label when the editor gave it one.
function upgradeName(g) { return g.label || shortUpgrade(g.name); }

// ------------------------------------------------------------------ comparison slots

// Up to MAX_SLOTS weapons on the chart. Clicking a weapon fills the next free slot with it and
// its page's state at that moment (rank, upgrades, tiers, first strike); a full set stays until a
// slot is removed. Each slot has its own modifiers. Every slot is a line (its DPS, the AOE of
// misses counted) and, if it can fire on the move, a dashed line of the same color.
// 11: the most versions one small arm has in the game (the Kar98k).
var MAX_SLOTS = 11;
var SLOT_COLORS = ["#3366cc", "#dc3912", "#ff9900", "#109618", "#990099", "#0099c6", "#dd4477", "#66aa00", "#b82e2e", "#316395", "#994499"];
var SLOTS = [];          // { u, k, state, name, color, mods: [{ type, operation, value, enabled }] }
var slotExtra = null;    // the modifiers of the slot being calculated
var ballisticView = false;
var showStanding = true, showMoving = true;   // which lines the chart draws

// The slot's modifiers, while that slot is calculated.
function activeModifiers()
{
	return (slotExtra || []).filter(function (m) { return m.enabled && !isNaN(m.value); });
}

// Runs fn with the slot's page state and modifiers in place.
function inSlot(slot, fn)
{
	var saved = pageState[slot.u];
	pageState[slot.u] = slot.state;
	slotExtra = slot.mods;
	try { return fn(); }
	finally { pageState[slot.u] = saved; slotExtra = null; }
}

// A single-shot projectile weapon engine would show as a ballistic bubble.
function isBallistic(u, k)
{
	var w = data[u][k];
	return !(w.burst && w.burst.can_burst) && !!w.hasprojectile
		&& (w.accuracy.near < 0.1 || w.accuracy.near > 10 || w.area_effect.area_info.radius > 2 || getDamage(w) >= 80);
}

function addSlot(u, k)
{
	if (SLOTS.length >= MAX_SLOTS) return "All " + MAX_SLOTS + " slots are full: remove one (x) to add another.";
	// The same weapon in the same state is there already, with no modifiers of its own: adding it
	// again would draw the same lines. (With modifiers on that slot, a plain copy is a comparison.)
	var state = JSON.stringify(pageState[u]);
	if (SLOTS.some(function (s) { return s.u == u && s.k == k && JSON.stringify(s.state) == state && !s.mods.some(function (m) { return m.enabled; }); }))
		return label[u][k] + stateTag(u) + " is already in the comparison.";
	var used = SLOTS.map(function (s) { return s.color; });
	SLOTS.push({
		u: u, k: k, state: JSON.parse(JSON.stringify(pageState[u])),
		name: squadinfo[u][0] + ": " + label[u][k] + stateTag(u),
		color: SLOT_COLORS.filter(function (c) { return used.indexOf(c) < 0; })[0] || SLOT_COLORS[0],
		mods: []
	});
	return null;
}

// Shows weapon k of the open page in the bonus list and adds it to the comparison.
changeweapon = function (weapon) {
	currentunit = currentdisplay;
	currentweapon = weapon;
	var refused = addSlot(currentunit, currentweapon);
	refreshSlots();
	if (refused) flashSlots(refused);
	renderBonuses();
};

// Opens a page; the chart is left as it is (no weapon is added by itself).
displayunit = function (unit) {
	currentdisplay = unit;
	PrintSquad(unit);
	if (PAGES[unit]) history.replaceState(null, "", "#" + PAGES[unit].key);
};

drawChart = function () { drawSlots(); };

determinetitle = function () { return ""; };

function drawSlots()
{
	var el = document.getElementById("curve_chart");
	if (!el) return;
	if (!SLOTS.length)
	{
		el.innerHTML = "<div class='slothint'>Click a weapon to add it to the comparison (up to " + MAX_SLOTS + ").</div>";
		return;
	}
	if (ballisticView && SLOTS.some(function (s) { return isBallistic(s.u, s.k); })) return drawBallistic(el);
	applyTarget();
	var lines = [];
	SLOTS.forEach(function (s) {
		inSlot(s, function () {
			if (showStanding) lines.push({ dps: fullRangeDPS(s.u, s.k, false, true), name: s.name, color: s.color, dash: false });
			if (showMoving && !data[s.u][s.k].moving.disable_moving_firing)
			{
				var mv = fullRangeDPS(s.u, s.k, true, true);
				if (mv && mv.some(function (v) { return v > 0; })) lines.push({ dps: mv, name: s.name + " (moving)", color: s.color, dash: true });
			}
		});
	});
	if (!lines.length)
	{
		el.innerHTML = "<div class='slothint'>" + (showStanding || showMoving ? "None of these weapons can fire on the move." : "Tick Stationary or Moving to draw the lines.") + "</div>";
		return;
	}
	var gdata = new google.visualization.DataTable();
	gdata.addColumn("number", "Range");
	var series = {};
	lines.forEach(function (l, i) {
		gdata.addColumn("number", l.name);
		series[i] = l.dash ? { color: l.color, lineDashStyle: [6, 4], lineWidth: 1.5 } : { color: l.color, lineWidth: 2 };
	});
	var n = lines.reduce(function (a, l) { return Math.max(a, l.dps.length); }, 0);
	for (var i = 0; i < n; i++)
		gdata.addRow([i].concat(lines.map(function (l) { return i < l.dps.length && isFinite(l.dps[i]) ? Math.round(l.dps[i] * 1000) / 1000 : null; })));
	new google.visualization.LineChart(el).draw(gdata, {
		width: el.style.width, height: 440, legend: { position: "top", maxLines: 6 }, series: series,
		hAxis: { title: "Range", ticks: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80] },
		vAxis: { title: showStanding && showMoving ? "DPS (dashed: moving)" : showMoving ? "DPS (moving)" : "DPS", viewWindow: { min: 0 } }, chartArea: { width: "82%", left: "6%" },
	});
}

// Engine's ballistic bubble chart (penetration, reload, damage, AOE hit) for the single-shot
// slots, a bubble each.
function drawBallistic(el)
{
	var gdata = new google.visualization.DataTable();
	["Weapon", "Penetration", "Reload", "Damage", "AOE"].forEach(function (c, i) { gdata.addColumn(i ? "number" : "string", c); });
	SLOTS.forEach(function (s) {
		if (!isBallistic(s.u, s.k)) return;
		var d = inSlot(s, function () {
			return withModified(s.u, s.k, false, function () { var w = data[s.u][s.k]; w.range = FillRangetable(w.range); return GenerateBallisticData(w, false); });
		});
		gdata.addRow([s.name, d[0], d[1], d[2], d[3]]);
	});
	new google.visualization.BubbleChart(el).draw(gdata, {
		title: "Single-shot weapons: penetration vs reload (size: damage, color: AOE hit)", width: el.style.width, height: 440,
		vAxis: { title: "Reload time", ticks: [0, 2, 4, 6, 8, 10, 12, 14] },
		hAxis: { title: "Penetration", viewWindow: { min: 0 }, gridlines: { count: 10 } },
		colorAxis: { legend: { position: "none" }, minValue: 20, maxValue: 320, colors: ["green", "yellow", "red"] },
		sizeAxis: { minSize: 5, minValue: 1, maxSize: 35, maxValue: 150 },
	});
}

// ------------------------------------------------------------------ menus

function pageFaction(page) { return page.faction; }

displaymenu = function (faction) {
	factionSelected = faction;
	var bar = document.getElementById("unitbuttons");
	bar.innerHTML = "";
	SITE.categories.forEach(function (category) {
		var pages = [];
		PAGES.forEach(function (p, u) { if (p.faction == faction && p.category == category) pages.push(u); });
		if (!pages.length) return;
		var drop = document.createElement("div");
		drop.className = "dropdown";
		var button = document.createElement("button");
		button.className = "dropbtn";
		button.innerHTML = category || "Other";
		var list = document.createElement("div");
		list.className = "dropdown-content";
		pages.forEach(function (u) {
			var a = document.createElement("a");
			a.href = "#" + PAGES[u].key;
			a.innerHTML = PAGES[u].name;
			a.onclick = function (e) { e.preventDefault(); displayunit(u); };
			list.appendChild(a);
		});
		drop.appendChild(button);
		drop.appendChild(list);
		// whitespace between the inline-block buttons, as the hand-written menus had
		if (bar.childNodes.length) bar.appendChild(document.createTextNode("\n"));
		bar.appendChild(drop);
	});
	document.getElementById("FactionButton").innerHTML = FACTION_NAMES[faction] || faction;
};

function buildFactionMenu()
{
	var list = document.getElementById("factionlist");
	SITE.factions.forEach(function (f) {
		if (!PAGES.some(function (p) { return p.faction == f; })) return;
		var a = document.createElement("a");
		a.href = "#";
		a.innerHTML = FACTION_NAMES[f] || f;
		a.onclick = function (e) { e.preventDefault(); displaymenu(f); };
		list.appendChild(a);
	});
	var stamp = document.getElementById("generated");
	if (stamp) stamp.innerHTML = "Data: " + SITE.generated;
}

// Opens the page named in the address (#squad_name).
function openFromHash()
{
	var key = decodeURIComponent(location.hash.replace(/^#/, ""));
	var u = PAGE_BY_KEY[key];
	if (u === undefined) return;
	displaymenu(PAGES[u].faction);
	displayunit(u);
}

// ------------------------------------------------------------------ squad page

// Stack groups on a page and their highest tier.
function pageStacks(page)
{
	var out = {};
	pageMods(page).forEach(function (m) { if (m.stack) out[m.stack] = Math.max(out[m.stack] || 0, m.stack_level); });
	return out;
}

function vetButton(text, active, onclick)
{
	var b = document.createElement("button");
	b.className = "vetbtn" + (active ? " active" : "");
	b.innerHTML = text;
	b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); onclick(b); };
	return b;
}

// Rank, upgrades or tiers changed: only the page's panel is redrawn. A weapon clicked after it
// fills a comparison slot with the new state; slots already filled keep theirs.
function stateChanged(u)
{
	PrintSquad(u);
}

PrintSquad = function (unitid) {
	var page = PAGES[unitid], state = pageState[unitid];
	var html = document.createElement("div");
	var h3 = document.createElement("H3");
	h3.appendChild(document.createTextNode(page.name + " "));

	var maxRank = page.veterancy.reduce(function (n, r) { return Math.max(n, r.rank); }, 0);
	page.weapons.forEach(function (w) { w.tuning.forEach(function (r) { maxRank = Math.max(maxRank, r.rank); }); });
	if (maxRank > 0)
	{
		var group = document.createElement("span");
		group.className = "vetgroup";
		group.appendChild(document.createTextNode("Vet: "));
		for (var r = 0; r <= maxRank; r++)
			(function (r) {
				group.appendChild(vetButton(String(r), state.vet == r, function () { state.vet = r; stateChanged(unitid); }));
			})(r);
		h3.appendChild(group);
	}
	// Abilities whose tiers stack (e.g. one per squad member lost): how many apply.
	var stacks = pageStacks(page);
	Object.keys(stacks).forEach(function (k) {
		var sg = document.createElement("span");
		sg.className = "vetgroup";
		sg.appendChild(document.createTextNode(" " + k + ": "));
		for (var n = 0; n <= stacks[k]; n++)
			(function (n) {
				sg.appendChild(vetButton(String(n), (state.stacks[k] || 0) == n, function () { state.stacks[k] = n; stateChanged(unitid); }));
			})(n);
		h3.appendChild(sg);
	});
	html.appendChild(h3);

	if (page.upgrades.length || page.hasFirstStrike || page.hasDot)
	{
		var ups = document.createElement("div");
		ups.className = "upgrades";
		if (page.hasFirstStrike)
		{
			var fs = document.createElement("label");
			fs.className = "upgrade" + (state.firstStrike ? " on" : "");
			fs.title = "The first shots out of camouflage";
			var fsBox = document.createElement("input");
			fsBox.type = "checkbox";
			fsBox.checked = state.firstStrike;
			fsBox.onchange = function () { state.firstStrike = fsBox.checked; stateChanged(unitid); };
			fs.appendChild(fsBox);
			fs.appendChild(document.createTextNode(" First strike"));
			ups.appendChild(fs);
		}
		if (page.hasDot)
		{
			// Overlapping fires stack: each one burns the target on its own.
			var ds = document.createElement("label");
			ds.className = "upgrade" + (state.dotStacks > 1 ? " on" : "");
			ds.title = "How many burning areas (DoT) the target stands in at once";
			ds.appendChild(document.createTextNode("DoT stacks "));
			var dsBox = document.createElement("input");
			dsBox.type = "number";
			dsBox.min = 1;
			dsBox.max = 20;
			dsBox.value = state.dotStacks;
			dsBox.className = "dotstacks";
			dsBox.onchange = function () { var n = parseInt(dsBox.value, 10); state.dotStacks = isNaN(n) ? 1 : Math.min(20, Math.max(1, n)); dsBox.value = state.dotStacks; stateChanged(unitid); };
			ds.appendChild(dsBox);
			ups.appendChild(ds);
		}
		page.upgrades.forEach(function (g, i) {
			// Always true in the game: applied, not offered as a switch.
			if (g.name == "Squad bonuses (game)") return;
			// Only stack tiers and first strike (they have their own buttons) and no other
			// conditional veterancy: nothing to switch.
			if (g.name == "Conditional bonuses (game)" && g.modifiers.every(ownSwitch)
				&& !page.veterancy.some(function (r) { return r.modifiers.some(function (m) { return m.conditional && !ownSwitch(m); }); })) return;
			var labelEl = document.createElement("label");
			labelEl.className = "upgrade" + (state.upgrades[i] ? " on" : "");
			var box = document.createElement("input");
			box.type = "checkbox";
			box.checked = state.upgrades[i];
			box.onchange = function () { state.upgrades[i] = box.checked; stateChanged(unitid); };
			labelEl.appendChild(box);
			labelEl.appendChild(document.createTextNode(" " + upgradeName(g)));
			labelEl.title = g.modifiers.map(modifierText).join("\n");
			ups.appendChild(labelEl);
		});
		html.appendChild(ups);
	}
	var bonusBox = document.createElement("div");
	bonusBox.id = "bonuses";
	html.appendChild(bonusBox);

	for (var j = 0; j < entities[unitid][0].length; j++)
	{
		var table = document.createElement("Table");
		table.appendChild(EntityTR(unitid, 0, j));
		html.appendChild(table);
	}
	addTextLine(html, "Total pop: " + page.pop);

	// In section order (weaponOrder), without headings: the sections only sort the list.
	weaponOrder(page).forEach(function (i) {
		var row = document.createElement("span");
		row.setAttribute("class", "weapon");
		var a = document.createElement("a");
		a.setAttribute("href", "#" + page.key);
		a.setAttribute("onclick", "changeweapon(" + i + "); return false;");
		a.innerHTML = (data[unitid][i].hardpoint != -1 ? data[unitid][i].hardpoint + ": " : "") + label[unitid][i];
		var tuned = page.weapons[i].tuning.length > 0;
		if (tuned) a.title = page.weapons[i].tuning.map(function (r) { return (r.rank ? "Vet " + r.rank : "Always") + ": " + r.modifiers.map(modifierText).join(", "); }).join("\n");
		if (page.weapons[i].label) a.innerHTML += " <span class='wname'>" + page.weapons[i].weapon + "</span>";
		row.appendChild(CreateAccordion(unitid, i, a, ""));
		html.appendChild(row);
	});
	var content = document.getElementById("content");
	content.innerHTML = "";
	content.appendChild(html);
	renderBonuses();
};

function modifierText(m)
{
	var op = m.usage == "multiplication" ? "x" : m.usage == "addition" ? "+" : m.usage + " ";
	return m.type.replace(/_weapon_modifier$|_modifier$/, "").replace(/^weapon_/, "") + " " + op + m.value
		+ (m.state ? " (" + m.state + ")" : "") + (m.conditional ? " (if)" : "");
}

// ------------------------------------------------------------------ comparison panel

function refreshSlots()
{
	drawSlots();
	renderSlotPanel();
}

var flashTimer = null;
function flashSlots(text)
{
	var note = document.getElementById("slotnote");
	if (!note) return;
	note.innerHTML = text;
	clearTimeout(flashTimer);
	flashTimer = setTimeout(function () { note.innerHTML = ""; }, 4000);
}

function option(select, value, text, selected)
{
	var o = document.createElement("option");
	o.value = value;
	o.innerHTML = text;
	if (selected) o.selected = true;
	select.appendChild(o);
	return o;
}

function smallButton(text, title, onclick)
{
	var b = document.createElement("button");
	b.innerHTML = text;
	if (title) b.title = title;
	b.onclick = onclick;
	return b;
}

// One modifier of a slot: on/off, type, operation, value, remove.
function modifierRow(list, index)
{
	var m = list[index];
	var row = document.createElement("div");
	row.className = "modrow" + (m.enabled ? "" : " off");
	var on = document.createElement("input");
	on.type = "checkbox";
	on.checked = !!m.enabled;
	on.onchange = function () { m.enabled = on.checked; refreshSlots(); };
	var type = document.createElement("select");
	Object.keys(MODIFIER_FIELDS).forEach(function (k) { option(type, k, k, k == m.type); });
	type.onchange = function () { m.type = type.value; refreshSlots(); };
	var operation = document.createElement("select");
	Object.keys(MODIFIER_OPERATIONS).forEach(function (k) { option(operation, k, k, k == m.operation); });
	operation.onchange = function () { m.operation = operation.value; refreshSlots(); };
	var value = document.createElement("input");
	value.type = "number";
	value.step = "any";
	value.value = m.value;
	value.onchange = function () { m.value = parseFloat(value.value); refreshSlots(); };
	[on, type, operation, value, smallButton("x", "Remove modifier", function () { list.splice(index, 1); refreshSlots(); })].forEach(function (el) { row.appendChild(el); });
	return row;
}

// The target line under the Comparison heading: its unit types as tags (any type a weapon's
// target_type_table names; type to pick one, x to drop it), its size and armor.
function targetRow()
{
	var row = document.createElement("div");
	row.className = "targetrow";
	row.appendChild(document.createTextNode("Target: "));
	TARGET.types.forEach(function (t) {
		var tag = document.createElement("span");
		tag.className = "typetag";
		tag.title = "The weapons' multipliers against " + t + " apply";
		tag.appendChild(document.createTextNode(t));
		var x = document.createElement("button");
		x.innerHTML = "&times;";
		x.title = "Remove";
		x.onclick = function () { TARGET.types = TARGET.types.filter(function (y) { return y != t; }); refreshSlots(); };
		tag.appendChild(x);
		row.appendChild(tag);
	});
	var pick = document.createElement("input");
	pick.className = "typepick";
	pick.placeholder = "+ unit type";
	pick.setAttribute("list", "targettypes");
	var list = document.createElement("datalist");
	list.id = "targettypes";
	TARGET_TYPES.filter(function (t) { return TARGET.types.indexOf(t) < 0; }).forEach(function (t) {
		var o = document.createElement("option");
		o.value = t;
		list.appendChild(o);
	});
	var add = function () {
		var t = pick.value.trim();
		if (TARGET_TYPES.indexOf(t) < 0 || TARGET.types.indexOf(t) >= 0) return;
		TARGET.types.push(t);
		refreshSlots();
	};
	pick.onchange = add;
	pick.onkeydown = function (e) { if (e.key == "Enter") add(); };
	row.appendChild(pick);
	row.appendChild(list);
	var number = function (label, key, step) {
		row.appendChild(document.createTextNode(" " + label + " "));
		var box = document.createElement("input");
		box.type = "number";
		box.min = step;
		box.step = step;
		box.value = TARGET[key];
		box.className = "armorbox";
		box.onchange = function () { var v = parseFloat(box.value); TARGET[key] = v > 0 ? v : 1; box.value = TARGET[key]; refreshSlots(); };
		row.appendChild(box);
	};
	number("size", "size", 0.05);
	number("armor", "armor", 1);
	return row;
}

// A check box in the Comparison heading that redraws the chart when changed.
function lineToggle(text, tip, checked, set)
{
	var label = document.createElement("label");
	label.className = "linetoggle";
	label.title = tip;
	var box = document.createElement("input");
	box.type = "checkbox";
	box.checked = checked;
	box.onchange = function () { set(box.checked); refreshSlots(); };
	label.appendChild(box);
	label.appendChild(document.createTextNode(" " + text));
	return label;
}

function renderSlotPanel()
{
	var panel = document.getElementById("modpanel");
	if (!panel) return;
	panel.innerHTML = "";
	var head = document.createElement("div");
	head.className = "modhead";
	head.innerHTML = "<b>Comparison</b> (" + SLOTS.length + "/" + MAX_SLOTS + ") ";
	if (SLOTS.some(function (s) { return isBallistic(s.u, s.k); }))
		head.appendChild(smallButton(ballisticView ? "DPS view" : "Ballistic view", "Single-shot weapons: penetration / reload / damage / AOE bubbles", function () { ballisticView = !ballisticView; refreshSlots(); }));
	if (SLOTS.length)
	{
		head.appendChild(lineToggle("Stationary", "Solid lines: firing while standing", showStanding, function (v) { showStanding = v; }));
		head.appendChild(lineToggle("Moving", "Dashed lines: firing on the move", showMoving, function (v) { showMoving = v; }));
		head.appendChild(smallButton("Reset colors", "Give the slots the colors of their current order", function () { SLOTS.forEach(function (s, i) { s.color = SLOT_COLORS[i % SLOT_COLORS.length]; }); refreshSlots(); }));
		head.appendChild(smallButton("Clear all", "Remove every slot", function () { SLOTS = []; ballisticView = false; refreshSlots(); }));
	}
	var note = document.createElement("span");
	note.id = "slotnote";
	note.className = "slotnote";
	head.appendChild(note);
	panel.appendChild(head);
	panel.appendChild(targetRow());
	SLOTS.forEach(function (s, index) {
		var box = document.createElement("div");
		box.className = "slot";
		box.style.borderLeftColor = s.color;
		var title = document.createElement("div");
		title.className = "slottitle";
		var name = document.createElement("span");
		name.innerHTML = s.name;
		name.style.color = s.color;
		title.appendChild(name);
		// Order (legend and drawing order; a later line is drawn over an earlier one). Colors stay.
		var up = smallButton("&#9650;", "Move up", function () { SLOTS.splice(index - 1, 0, SLOTS.splice(index, 1)[0]); refreshSlots(); });
		var down = smallButton("&#9660;", "Move down", function () { SLOTS.splice(index + 1, 0, SLOTS.splice(index, 1)[0]); refreshSlots(); });
		up.disabled = index == 0;
		down.disabled = index == SLOTS.length - 1;
		title.appendChild(up);
		title.appendChild(down);
		title.appendChild(smallButton("+ Modifier", "A modifier for this slot only", function () { s.mods.push({ type: "accuracy_weapon_modifier", operation: "multiplication", value: 1, enabled: true }); refreshSlots(); }));
		title.appendChild(smallButton("x", "Remove this slot", function () { SLOTS.splice(index, 1); refreshSlots(); }));
		box.appendChild(title);
		s.mods.forEach(function (m, i) { box.appendChild(modifierRow(s.mods, i)); });
		panel.appendChild(box);
	});
}

window.addEventListener("load", function () {
	buildFactionMenu();
	refreshSlots();
	openFromHash();
});
window.addEventListener("hashchange", openFromHash);
