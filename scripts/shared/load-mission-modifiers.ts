// Mission-modifier loaders: modifier groups (the dump carries several
// same-name entries with different XP/weights), the global generation rolls,
// and the weekly Overtime Assignment rotation.

import type {
	CurveData,
	MissionContainerEntry,
	MissionGeneration,
	MissionModifier,
	Region,
	ThreatProfile
} from './data/schema.d';
import { readDump } from './dump';

interface ModifierDump {
	missionModifiers?: Record<string, MissionModifier>;
	missionGeneration?: MissionGeneration;
	missionContainers?: Record<string, MissionContainerEntry>;
	threatProfiles?: Record<string, ThreatProfile>;
	regions?: Record<string, Region>;
}

const dump = () => readDump() as unknown as ModifierDump;

export function modifierName(m: MissionModifier): string {
	return (m.Name ?? '').trim() || m.ModifierName;
}

// ─────────────────────────────────────────────────────────────────────────
// Modifiers + generation weights
// ─────────────────────────────────────────────────────────────────────────

export function loadModifierWeights(): Map<number, number> {
	const out = new Map<number, number>();
	for (const e of dump().missionGeneration?.MissionModifiers ?? []) {
		if (e.Key !== null) out.set(Number(e.Key), e.Weight);
	}
	return out;
}

function variantScore(m: MissionModifier, weights: Map<number, number>): number {
	let s = weights.get(m.ID) ?? 0;
	if ((m.Flags ?? '').includes('AllowInNormalMissions')) s += 0.5;
	return s;
}

// Same-name entries (e.g. two "Dave vs Goliath") are old/new tuning variants.
// The canonical one is the heaviest in the random pool; the rest are listed
// on the page as variants.
export function loadModifierGroups(): Map<string, MissionModifier[]> {
	const all = dump().missionModifiers;
	if (!all || typeof all !== 'object') {
		throw new Error(`Invalid dump shape: expected an object with a 'missionModifiers' property`);
	}
	const weights = loadModifierWeights();
	const groups = new Map<string, MissionModifier[]>();
	for (const m of Object.values(all)) {
		const list = groups.get(modifierName(m)) ?? [];
		list.push(m);
		groups.set(modifierName(m), list);
	}
	for (const list of groups.values()) {
		list.sort((a, b) => variantScore(b, weights) - variantScore(a, weights) || a.ID - b.ID);
	}
	return groups;
}

export function loadMissionModifiers(): MissionModifier[] {
	return [...loadModifierGroups().values()]
		.map((variants) => variants[0])
		.sort((a, b) => modifierName(a).localeCompare(modifierName(b)));
}

// ─────────────────────────────────────────────────────────────────────────
// Modifier count roll
// ─────────────────────────────────────────────────────────────────────────

export interface ModifierCountBand {
	count: number;
	probability: number; // given that the mission rolls modifiers at all
}

// Hermite evaluation of a Unity AnimationCurve (unweighted tangents).
function evalCurve(keys: NonNullable<CurveData['Keys']>, t: number): number {
	if (t <= keys[0].Time!) return keys[0].Value!;
	const last = keys[keys.length - 1];
	if (t >= last.Time!) return last.Value!;
	let i = 0;
	while (keys[i + 1].Time! < t) i++;
	const a = keys[i];
	const b = keys[i + 1];
	const dt = b.Time! - a.Time!;
	const s = (t - a.Time!) / dt;
	const m0 = Number(a.OutTangent) * dt;
	const m1 = Number(b.InTangent) * dt;
	const s2 = s * s;
	const s3 = s2 * s;
	return (
		(2 * s3 - 3 * s2 + 1) * a.Value! +
		(s3 - 2 * s2 + s) * m0 +
		(-2 * s3 + 3 * s2) * b.Value! +
		(s3 - s2) * m1
	);
}

// Modifier count = round(curve(uniform 0..1)); sampled on a fixed grid so the
// output is deterministic.
export function computeCountBands(curve: CurveData | undefined): ModifierCountBand[] {
	const keys = curve?.Keys;
	if (!keys || keys.length === 0) return [];
	const steps = 100000;
	const hits = new Map<number, number>();
	for (let i = 0; i < steps; i++) {
		const count = Math.max(0, Math.round(evalCurve(keys, (i + 0.5) / steps)));
		hits.set(count, (hits.get(count) ?? 0) + 1);
	}
	return [...hits.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([count, n]) => ({ count, probability: n / steps }));
}

export function loadMissionGeneration() {
	const g = dump().missionGeneration;
	return {
		chance: g?.MissionModifierChance ?? 0,
		bands: computeCountBands(g?.MissionModifierCountCurve)
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Overtime Assignment
// ─────────────────────────────────────────────────────────────────────────

interface ObjRef {
	'@ref'?: string;
}

interface RewardRef {
	rid: number;
}

interface RefRid {
	rid: number;
	type: { class: string };
	data: {
		count?: number;
		chance?: number;
		chanceModifier?: ObjRef;
		rarity?: number;
		resource?: { resource?: ObjRef; count?: number };
	};
}

interface OvertimeRaw {
	resetInterval: number;
	minThreat: number;
	minIntensity?: number;
	rewards?: { properties?: RewardRef[] };
	repeatableRewards?: { properties?: RewardRef[] };
	weekData?: { startTime: number; seed: number; modifiers: ObjRef[] }[];
	references?: { RefIds?: RefRid[] };
}

export interface OvertimeReward {
	type: string;
	count: number;
	chance: number;
	rarity?: number;
	resourceKey?: string;
	resourceCount?: number;
	profile?: string;
}

export interface OvertimeWeek {
	startTime: number;
	modifierIDs: number[];
}

export interface OvertimeData {
	resetInterval: number;
	minThreat: number; // 0-based threat index
	minIntensity: number;
	removedFlags: string;
	weeks: OvertimeWeek[];
	rewards: OvertimeReward[];
	repeatableRewards: OvertimeReward[];
	profile: ThreatProfile | undefined;
	regions: { included: Region[]; excluded: Region[] };
}

const OVERTIME_CONTAINER = 'Overtime Assignment';
const OVERTIME_PROFILE = 'OvertimeTheatProfile';

export function loadOvertime(): OvertimeData {
	const d = dump();
	const container = d.missionContainers?.[OVERTIME_CONTAINER];
	const raw = container?.RawData as OvertimeRaw | undefined;
	if (!container || !raw) throw new Error(`Missing missionContainers['${OVERTIME_CONTAINER}']`);

	const refs = new Map((raw.references?.RefIds ?? []).map((r) => [r.rid, r]));
	const toRewards = (list: RewardRef[] | undefined): OvertimeReward[] =>
		(list ?? []).flatMap((p) => {
			const r = refs.get(p.rid);
			if (!r) return [];
			return [
				{
					type: r.type.class,
					count: r.data.count ?? 1,
					chance: r.data.chance ?? 1,
					rarity: r.data.rarity,
					resourceKey: r.data.resource?.resource?.['@ref']?.replace(/^resource:/, ''),
					resourceCount: r.data.resource?.count,
					profile: r.data.chanceModifier?.['@ref']?.replace(/^threatProfile:/, '')
				}
			];
		});

	const regions = Object.values(d.regions ?? {});

	return {
		resetInterval: raw.resetInterval,
		minThreat: raw.minThreat,
		minIntensity: raw.minIntensity ?? 0,
		removedFlags: container.RemovedMissionFlags ?? 'None',
		weeks: (raw.weekData ?? []).map((w) => ({
			startTime: w.startTime,
			modifierIDs: w.modifiers.map((m) => Number(m['@ref']?.replace(/^missionModifier:/, '')))
		})),
		rewards: toRewards(raw.rewards?.properties),
		repeatableRewards: toRewards(raw.repeatableRewards?.properties),
		profile: d.threatProfiles?.[OVERTIME_PROFILE],
		regions: {
			included: regions.filter((r) => !r.ExcludeFromOvertimeAssignment),
			excluded: regions.filter((r) => r.ExcludeFromOvertimeAssignment)
		}
	};
}
