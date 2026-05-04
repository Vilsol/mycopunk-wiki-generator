// Pure diff engine: compare two parsed game-data dumps and emit
// structured per-upgrade change records.
//
// The output is the dump-format-agnostic `Change` shape from
// `dump-types.ts`. The renderer (`changelog-renderer.ts`) translates
// these into wikitext.
//
// Design constraints from the spec:
//   - User-facing fields only (whitelist below).
//   - Match upgrades by ID, properties by C# `Type`, stats by HTML-stripped name.
//   - Suppress OuroborosCost when fully derived from Rarity.
//   - Pre-v2.0 ApplicableTo guard: skip the diff when "Character" appears
//     as an APIName (collapses old data with new gear-keyed data).

import type { Change, ChangeRecord, CostResourceChange } from './dump-types.ts';

// ---------- helpers --------------------------------------------------------

const HTML_TAG_RE = /<[^>]+?>/g;
function stripHtml(s: string | undefined | null): string {
	return (s ?? '').replace(HTML_TAG_RE, '').trim();
}

function setDiff<T>(a: Set<T>, b: Set<T>): { added: T[]; removed: T[] } {
	const added: T[] = [];
	const removed: T[] = [];
	for (const v of b) if (!a.has(v)) added.push(v);
	for (const v of a) if (!b.has(v)) removed.push(v);
	return { added, removed };
}

function arrToSet<T>(xs: readonly T[] | undefined): Set<T> {
	return new Set(xs ?? []);
}

// Map a Rarity name to its Ouroboros-redemption cost per the dumper's
// formula `5 + Rarity*2`. Used to suppress derived OuroborosCost noise
// when the only thing that changed was rarity.
const OUROBOROS_COST_BY_RARITY: Record<string, number> = {
	Standard: 5,
	Rare: 7,
	Epic: 9,
	Exotic: 11,
	Oddity: 13,
	Contraband: 15
};

// ---------- typed helpers over the dump shape ------------------------------

interface ResourceCostEntry {
	Count: number;
	Resource?: string;
	ResourceID?: string;
}

interface UpgradablesMap {
	[upgradable: string]: StatEntry[];
}

interface StatEntry {
	name?: string;
	value?: string;
	minValue?: string;
	maxValue?: string;
	IsValid?: boolean;
}

interface RollsMap {
	[upgradable: string]: { [statName: string]: string[] };
}

interface ModifyTextMap {
	[upgradable: string]: string[];
}

interface DumpProperty {
	Type: string;
	Label?: string;
	StatNames?: string[];
	StatsByUpgradable?: UpgradablesMap;
	RolledValuesByUpgradable?: RollsMap;
	ModifyTextByUpgradable?: ModifyTextMap;
}

interface DumpUpgrade {
	ID: string;
	Name?: string;
	Description?: string;
	Rarity?: string;
	EffectType?: string;
	UpgradeType?: string;
	CollectionSource?: string;
	Flags?: string;
	Pattern?: { width?: number; height?: number };
	ApplicableTo?: { APIName?: string }[];
	Properties?: DumpProperty[];
	OuroborosCost?: ResourceCostEntry[];
	TurbochargeCost?: ResourceCostEntry[];
}

interface DumpShape {
	upgrades?: { [id: string]: DumpUpgrade };
}

// ---------- ApplicableTo migration guard ----------------------------------

// Pre-v2.0 dumps used the C# class name "Character" for all character
// applicabilities (collapsing all four playable characters under one
// key). When either side of a diff contains this sentinel, set-comparing
// `ApplicableTo` would emit a flood of false positives for every
// character upgrade, so we skip the field for that upgrade.
function applicableToContainsLegacyChar(u: DumpUpgrade): boolean {
	for (const a of u.ApplicableTo ?? []) {
		if (a.APIName === 'Character') return true;
	}
	return false;
}

// ---------- field-level comparisons ---------------------------------------

function diffPlainField(
	field: string,
	a: string | undefined,
	b: string | undefined
): Change | null {
	if ((a ?? '') === (b ?? '')) return null;
	return { kind: 'field', field, from: a ?? '', to: b ?? '' };
}

function diffApplicableTo(prev: DumpUpgrade, curr: DumpUpgrade): Change[] {
	if (applicableToContainsLegacyChar(prev) || applicableToContainsLegacyChar(curr)) {
		return [];
	}
	const a = arrToSet((prev.ApplicableTo ?? []).map((x) => x.APIName ?? '').filter(Boolean));
	const b = arrToSet((curr.ApplicableTo ?? []).map((x) => x.APIName ?? '').filter(Boolean));
	const { added, removed } = setDiff(a, b);
	const out: Change[] = [];
	for (const v of added) out.push({ kind: 'list-add', field: 'ApplicableTo', value: v });
	for (const v of removed) out.push({ kind: 'list-remove', field: 'ApplicableTo', value: v });
	return out;
}

function diffPattern(prev: DumpUpgrade, curr: DumpUpgrade): Change | null {
	const ap = prev.Pattern;
	const bp = curr.Pattern;
	if (!ap && !bp) return null;
	const aw = ap?.width ?? 0;
	const ah = ap?.height ?? 0;
	const bw = bp?.width ?? 0;
	const bh = bp?.height ?? 0;
	if (aw === bw && ah === bh) return null;
	return {
		kind: 'field',
		field: 'Pattern',
		from: `${aw}×${ah}`,
		to: `${bw}×${bh}`
	};
}

function diffCost(
	currency: 'Ouroboros' | 'Turbocharge',
	prev: ResourceCostEntry[] | undefined,
	curr: ResourceCostEntry[] | undefined
): Change | null {
	const byRid = (xs: ResourceCostEntry[] | undefined) => {
		const m = new Map<string, ResourceCostEntry>();
		for (const x of xs ?? []) {
			const rid = x.ResourceID ?? x.Resource ?? '';
			if (rid) m.set(rid, x);
		}
		return m;
	};
	const a = byRid(prev);
	const b = byRid(curr);
	const allRids = new Set<string>([...a.keys(), ...b.keys()]);
	const changes: CostResourceChange[] = [];
	for (const rid of allRids) {
		const ca = a.get(rid);
		const cb = b.get(rid);
		const fromCount = ca?.Count ?? 0;
		const toCount = cb?.Count ?? 0;
		if (fromCount === toCount) continue;
		const resourceName = stripHtml(cb?.Resource ?? ca?.Resource ?? rid);
		changes.push({ resourceID: rid, resourceName, from: fromCount, to: toCount });
	}
	if (changes.length === 0) return null;
	return { kind: 'cost', currency, changes };
}

// True iff the only OuroborosCost change is the single ouroscrap entry
// moving from formula(prev.Rarity) to formula(curr.Rarity).
function ouroborosCostIsRarityDerived(
	prev: DumpUpgrade,
	curr: DumpUpgrade,
	costChange: Change | null
): boolean {
	if (!costChange || costChange.kind !== 'cost' || costChange.currency !== 'Ouroboros') {
		return false;
	}
	if (prev.Rarity === curr.Rarity) return false;
	if (costChange.changes.length !== 1) return false;
	const c = costChange.changes[0];
	if (c.resourceID !== 'ouroscrap') return false;
	const expectedFrom = OUROBOROS_COST_BY_RARITY[prev.Rarity ?? ''];
	const expectedTo = OUROBOROS_COST_BY_RARITY[curr.Rarity ?? ''];
	return expectedFrom === c.from && expectedTo === c.to;
}

// ---------- per-property comparisons --------------------------------------

// Match properties by Type, disambiguating duplicates by their
// position-within-Type-subset. Returns parallel arrays of (prev, curr)
// indexed by stable key.
function pairProperties(
	prevProps: DumpProperty[],
	currProps: DumpProperty[]
): {
	matched: { key: string; prev: DumpProperty; curr: DumpProperty }[];
	addedKeys: { key: string; prop: DumpProperty }[];
	removedKeys: { key: string; prop: DumpProperty }[];
} {
	const keyOf = (props: DumpProperty[]) => {
		const counts = new Map<string, number>();
		return props.map((p) => {
			const t = p.Type;
			const idx = counts.get(t) ?? 0;
			counts.set(t, idx + 1);
			return idx === 0 ? t : `${t}[${idx}]`;
		});
	};
	const prevKeys = keyOf(prevProps);
	const currKeys = keyOf(currProps);
	const prevByKey = new Map<string, DumpProperty>();
	const currByKey = new Map<string, DumpProperty>();
	prevKeys.forEach((k, i) => prevByKey.set(k, prevProps[i]));
	currKeys.forEach((k, i) => currByKey.set(k, currProps[i]));

	const matched: { key: string; prev: DumpProperty; curr: DumpProperty }[] = [];
	const addedKeys: { key: string; prop: DumpProperty }[] = [];
	const removedKeys: { key: string; prop: DumpProperty }[] = [];
	for (const [k, p] of currByKey) {
		const a = prevByKey.get(k);
		if (a) matched.push({ key: k, prev: a, curr: p });
		else addedKeys.push({ key: k, prop: p });
	}
	for (const [k, p] of prevByKey) {
		if (!currByKey.has(k)) removedKeys.push({ key: k, prop: p });
	}
	return { matched, addedKeys, removedKeys };
}

// Build a flat map of (upgradable, normalizedStatName) → stat entry, plus
// preserve the original (un-stripped) display name for rendering.
interface NormalizedStat {
	displayName: string;
	value: string;
	minValue?: string;
	maxValue?: string;
}

function collectStats(prop: DumpProperty): Map<string, NormalizedStat> {
	const out = new Map<string, NormalizedStat>();
	for (const [upgradable, stats] of Object.entries(prop.StatsByUpgradable ?? {})) {
		for (const s of stats) {
			if (s.IsValid === false) continue;
			const rawName = s.name ?? '';
			const norm = stripHtml(rawName);
			if (!norm) continue;
			const key = `${upgradable}\x00${norm}`;
			out.set(key, {
				displayName: norm,
				value: s.value ?? '',
				minValue: s.minValue,
				maxValue: s.maxValue
			});
		}
	}
	return out;
}

function collectRolls(prop: DumpProperty): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const [upgradable, perStat] of Object.entries(prop.RolledValuesByUpgradable ?? {})) {
		for (const [rawName, vals] of Object.entries(perStat)) {
			const norm = stripHtml(rawName);
			if (!norm) continue;
			out.set(`${upgradable}\x00${norm}`, new Set(vals));
		}
	}
	return out;
}

// Lines like "Range: +14.43%" — split on the first ": " separator.
function parseModifyTextLine(line: string): { name: string; value: string } | null {
	const stripped = stripHtml(line);
	const idx = stripped.indexOf(':');
	if (idx === -1) return null;
	const name = stripped.slice(0, idx).trim();
	const value = stripped.slice(idx + 1).trim();
	if (!name || !value) return null;
	return { name, value };
}

function collectModifyText(prop: DumpProperty): Map<string, string> {
	// Map "<upgradable>\x00<name>" → value
	const out = new Map<string, string>();
	for (const [upgradable, lines] of Object.entries(prop.ModifyTextByUpgradable ?? {})) {
		for (const line of lines) {
			const parsed = parseModifyTextLine(line);
			if (!parsed) continue;
			out.set(`${upgradable}\x00${parsed.name}`, parsed.value);
		}
	}
	return out;
}

function rangeRender(stat: NormalizedStat): string {
	if (
		stat.minValue !== undefined &&
		stat.maxValue !== undefined &&
		stat.minValue !== stat.maxValue
	) {
		return `[${stat.minValue} – ${stat.maxValue}]`;
	}
	return stat.value;
}

function diffOneProperty(propLabel: string, prev: DumpProperty, curr: DumpProperty): Change[] {
	const out: Change[] = [];

	// StatNames set diff.
	const prevNames = new Set((prev.StatNames ?? []).map(stripHtml).filter(Boolean));
	const currNames = new Set((curr.StatNames ?? []).map(stripHtml).filter(Boolean));
	const namesDiff = setDiff(prevNames, currNames);
	for (const stat of namesDiff.added) out.push({ kind: 'stat-add', property: propLabel, stat });
	for (const stat of namesDiff.removed)
		out.push({ kind: 'stat-remove', property: propLabel, stat });

	// Stat value diffs (StatsByUpgradable + ModifyTextByUpgradable, merged).
	const prevStats = collectStats(prev);
	const currStats = collectStats(curr);
	for (const [k, lines] of collectModifyText(prev)) {
		// Only inject if not already present from StatsByUpgradable.
		if (!prevStats.has(k)) {
			const [, name] = k.split('\x00');
			prevStats.set(k, { displayName: name, value: lines });
		}
	}
	for (const [k, lines] of collectModifyText(curr)) {
		if (!currStats.has(k)) {
			const [, name] = k.split('\x00');
			currStats.set(k, { displayName: name, value: lines });
		}
	}

	// Compare per-key. Stats added under a NEW upgradable show up as adds.
	const allKeys = new Set([...prevStats.keys(), ...currStats.keys()]);
	for (const key of allKeys) {
		const a = prevStats.get(key);
		const b = currStats.get(key);
		if (a && b) {
			const fa = rangeRender(a);
			const fb = rangeRender(b);
			if (fa !== fb) {
				out.push({
					kind: 'stat',
					property: propLabel,
					stat: a.displayName,
					from: fa,
					to: fb
				});
			}
		}
		// We don't emit stat-add/stat-remove for cross-version single-stat
		// appearances on the same property — those are already covered by
		// the StatNames set diff above (which is per-upgrade-wide). If the
		// only thing that changed is a stat appearing under a new
		// upgradable key for an existing stat name, we treat that as a
		// new value (handled by the `b && !a` branch falling through —
		// no entry, since adds are tracked at StatNames level).
	}

	// Rolled-values set diffs.
	const prevRolls = collectRolls(prev);
	const currRolls = collectRolls(curr);
	const allRollKeys = new Set([...prevRolls.keys(), ...currRolls.keys()]);
	for (const key of allRollKeys) {
		const a = prevRolls.get(key) ?? new Set();
		const b = currRolls.get(key) ?? new Set();
		const { added, removed } = setDiff(a, b);
		if (added.length === 0 && removed.length === 0) continue;
		const [, name] = key.split('\x00');
		out.push({
			kind: 'rolls',
			property: propLabel,
			stat: name,
			added,
			removed
		});
	}

	return out;
}

// ---------- main entry point ----------------------------------------------

function diffOneUpgrade(prev: DumpUpgrade, curr: DumpUpgrade): Change[] {
	const out: Change[] = [];

	// Rename — emit first per the spec's ordering rule.
	const prevName = stripHtml(prev.Name);
	const currName = stripHtml(curr.Name);
	if (prevName !== currName) {
		out.push({ kind: 'renamed', from: prevName, to: currName });
	}

	// Description (HTML-stripped both sides).
	const prevDesc = stripHtml(prev.Description);
	const currDesc = stripHtml(curr.Description);
	if (prevDesc !== currDesc) {
		out.push({ kind: 'description', from: prevDesc, to: currDesc });
	}

	// Plain string fields.
	for (const f of ['Rarity', 'EffectType', 'UpgradeType', 'CollectionSource'] as const) {
		const c = diffPlainField(f, prev[f], curr[f]);
		if (c) out.push(c);
	}

	// Pattern dimensions.
	const patternChange = diffPattern(prev, curr);
	if (patternChange) out.push(patternChange);

	// ApplicableTo (with pre-v2.0 guard).
	out.push(...diffApplicableTo(prev, curr));

	// Flags — comma-separated string in the dump. Set-diff to make
	// ordering changes irrelevant while still catching real flag
	// additions/removals (e.g. CanStack gained between versions).
	const parseFlags = (s: string | undefined) =>
		new Set(
			(s ?? '')
				.split(',')
				.map((f) => f.trim())
				.filter(Boolean)
		);
	const flagsDiff = setDiff(parseFlags(prev.Flags), parseFlags(curr.Flags));
	for (const v of flagsDiff.added) out.push({ kind: 'list-add', field: 'Flags', value: v });
	for (const v of flagsDiff.removed) out.push({ kind: 'list-remove', field: 'Flags', value: v });

	// Costs (with OuroborosCost-derived suppression).
	const ouro = diffCost('Ouroboros', prev.OuroborosCost, curr.OuroborosCost);
	if (ouro && !ouroborosCostIsRarityDerived(prev, curr, ouro)) out.push(ouro);
	const turbo = diffCost('Turbocharge', prev.TurbochargeCost, curr.TurbochargeCost);
	if (turbo) out.push(turbo);

	// Properties.
	const { matched, addedKeys, removedKeys } = pairProperties(
		prev.Properties ?? [],
		curr.Properties ?? []
	);
	for (const { prop } of addedKeys) {
		out.push({ kind: 'property-add', property: prop.Label ?? prop.Type });
	}
	for (const { prop } of removedKeys) {
		out.push({ kind: 'property-remove', property: prop.Label ?? prop.Type });
	}
	for (const { prev: pp, curr: cp } of matched) {
		const label = cp.Label ?? cp.Type;
		out.push(...diffOneProperty(label, pp, cp));
	}

	return out;
}

export function diffDumps(prev: DumpShape, curr: DumpShape): Map<string, Change[]> {
	const out = new Map<string, Change[]>();
	const prevUps = prev.upgrades ?? {};
	const currUps = curr.upgrades ?? {};

	for (const [id, upgrade] of Object.entries(currUps)) {
		const key = String(id);
		const prevUp = prevUps[key];
		if (!prevUp) {
			out.set(key, [{ kind: 'added' }]);
			continue;
		}
		const changes = diffOneUpgrade(prevUp, upgrade);
		if (changes.length > 0) out.set(key, changes);
	}
	// Removed upgrades (in prev but not in curr) are intentionally
	// omitted — there's no /source page for them to render onto.

	return out;
}

// Inverse grouping for Phase 2's per-version patch-notes page. Designed
// in now to avoid a refactor when Phase 2 lands.
export function buildPatchIndex(
	allHistory: Map<string, ChangeRecord[]>
): Map<string, { upgradeID: string; changes: Change[] }[]> {
	const out = new Map<string, { upgradeID: string; changes: Change[] }[]>();
	for (const [upgradeID, history] of allHistory) {
		for (const record of history) {
			const list = out.get(record.version) ?? [];
			list.push({ upgradeID, changes: record.changes });
			out.set(record.version, list);
		}
	}
	return out;
}
