// Game Mechanics entity: a single page collecting the global tuning tables —
// difficulty scaling per threat, mission economy, combat constants, status
// effect globals and player buff stacks.

import type { StatusEffectGlobals } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, stripHtml } from '../wiki-text';
import { defineEntity } from '../entity-registry';
import { fmtNum, fmtPct } from '../format-utils';
import {
	ENEMY_TYPES,
	PLAYER_HEADERS,
	fmtMult,
	fmtProfileValue,
	getDifficulty,
	getThreatProfiles,
	humanize,
	playerCells
} from '../difficulty';
import { entity as threatEntity, loadThreats } from './threats';

interface GameMechanicsPage {
	ID: string;
}

export const PAGE_TITLE = 'Game Mechanics';

// ─────────────────────────────────────────────────────────────────────────
// Table helpers
// ─────────────────────────────────────────────────────────────────────────

function table(headers: string[], rows: string[][]): string[] {
	const out = ['{| class="wikitable"', `! ${headers.join(' !! ')}`];
	for (const r of rows) {
		out.push('|-');
		out.push(`| ${r.join(' || ')}`);
	}
	out.push('|}');
	return out;
}

function titleCase(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// "[[Safe Title|Safe]]" per threat tier, in tier order.
function threatLinks(): string[] {
	return loadThreats().map((t) => {
		const title = threatEntity.pageTitle(t);
		const name = stripHtml(t.Name ?? t.ID).trim() || t.ID;
		return title === name ? `[[${title}]]` : `[[${title}|${name}]]`;
	});
}

// Weighted list → [label, weight, share] rows.
function weightRows(
	entries: { label: string; weight: number; count?: number }[],
	withCount = false
): string[][] {
	const total = entries.reduce((sum, e) => sum + e.weight, 0);
	return entries.map((e) => [
		e.label,
		...(withCount ? [String(e.count ?? 1)] : []),
		fmtNum(e.weight),
		fmtPct(e.weight / total)
	]);
}

// ─────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────

function buildDifficultySection(): string {
	const diff = getDifficulty();
	const threats = threatLinks();
	const out: string[] = [];
	const add = (heading: string, lines: string[]) => {
		if (lines.length === 0) return;
		if (out.length > 0) out.push('');
		out.push(`=== ${heading} ===`, ...lines);
	};

	const gridTable = (grids: Parameters<typeof playerCells>[0][] | undefined, label: string) =>
		grids && grids.length > 0
			? table(
					[label, ...PLAYER_HEADERS, 'Per player beyond 4'],
					grids.map((g, i) => [threats[i] ?? `Threat ${i + 1}`, ...playerCells(g)])
				)
			: [];

	for (const type of ENEMY_TYPES) {
		add(`${type} health`, gridTable(diff.EnemyHealthScaling?.[type], 'Threat'));
	}
	add('Enemy damage', gridTable(diff.EnemyDamageScaling, 'Threat'));
	add('Wave size', gridTable(diff.EnemyWaveSize, 'Threat'));
	add('Wave interval', gridTable(diff.EnemyWaveInterval, 'Threat'));

	const economy = readDump().economy;
	const speed = diff.EnemyMoveSpeedScaling ?? [];
	const attack = diff.EnemyAttackSpeedScaling ?? [];
	const seek = diff.LookForPartIntervalScaling ?? [];
	const resource = economy?.ResourceAmountMultiplier ?? [];
	add(
		'Per-threat modifiers',
		table(
			['Threat', 'Move speed', 'Attack speed', 'Part-seek interval', 'Resource reward amount'],
			threats.map((t, i) => [
				t,
				fmtMult(speed[i]),
				fmtMult(attack[i]),
				fmtMult(seek[i]),
				fmtMult(resource[i])
			])
		)
	);

	const profiles = getThreatProfiles();
	add(
		'Threat profiles',
		profiles.length === 0
			? []
			: [
					"''Per-threat values used by the spawn system. Additive profiles add to a base chance; the others multiply a base value.''",
					...table(
						[
							'Threat',
							...profiles.map(
								(p) => `${humanize(p.Name)} (${p.Additive ? 'added chance' : 'multiplier'})`
							)
						],
						threats.map((t, i) => [t, ...profiles.map((p) => fmtProfileValue(p, p.Threats[i]))])
					)
				]
	);

	const intensityNames = ['Low', 'Medium', 'High'];
	const intensityRows = intensityNames.map((name, i) => [
		name,
		fmtMult(diff.IntensityWaveInterval?.[i]),
		fmtMult(diff.IntensityMinOpenWaveSlots?.[i]),
		fmtMult(economy?.IntensityScripAndXPMultiplier?.[i])
	]);
	add(
		'Mission intensity',
		table(
			[
				'Intensity',
				'Wave interval',
				'Open enemy slots needed for next wave',
				'Scrip and XP reward'
			],
			intensityRows
		)
	);

	const revive = diff.DefaultTeamReviveCount;
	if (revive?.Values) {
		add('Team revives', table(PLAYER_HEADERS, [revive.Values.map((v) => String(v))]));
	}
	return out.join('\n');
}

function buildEconomySection(): string {
	const eco = readDump().economy;
	if (!eco) return '';
	const resources = readDump().resources as Record<string, { Name?: string }>;
	const out: string[] = [];
	const add = (heading: string, lines: string[]) => {
		if (lines.length === 0) return;
		if (out.length > 0) out.push('');
		out.push(`=== ${heading} ===`, ...lines);
	};

	const base: [string, number | undefined][] = [
		['Mission XP', eco.BaseMissionXP],
		['Scrip for completing a mission', eco.BaseScripForMissionCompletion],
		['XP for a side objective', eco.BaseXPForSideObjective],
		['Scrip for a side objective', eco.BaseScripForSideObjective],
		['Resources for a side objective', eco.BaseResourcesForSideObjective]
	];
	add(
		'Base mission rewards',
		table(
			['Reward', 'Base amount'],
			base.filter(([, v]) => v !== undefined).map(([k, v]) => [k, fmtNum(v)])
		)
	);

	const dropRows = Object.entries(eco.EnemyUpgradeDropChances ?? {}).map(([type, chance]) => [
		type,
		fmtPct(chance)
	]);
	const extra: string[][] = [];
	if (eco.CombatResourceSpawnChance !== undefined)
		extra.push(['Combat resource part per enemy spawn', fmtPct(eco.CombatResourceSpawnChance)]);
	for (const group of eco.GlobalEnemyAttachments ?? []) {
		const hasUpgradeDrop = group.Parts?.some((p) => p.Key === 'UpgradeDropPart');
		if (hasUpgradeDrop && group.Chance !== undefined)
			extra.push(['Upgrade drop part per enemy spawn', fmtPct(group.Chance)]);
	}
	add('Enemy drops', [
		...table(['Enemy type', 'Upgrade drop chance'], dropRows),
		'',
		...table(['Other drop', 'Chance'], extra)
	]);

	add(
		'Upgrade rarity roll',
		table(
			['Rarity', 'Weight', 'Chance'],
			weightRows(
				(eco.RarityWeights ?? [])
					.filter((w) => w.Key)
					.map((w) => ({ label: titleCase(w.Key as string), weight: w.Weight }))
					.sort((a, b) => b.weight - a.weight)
			)
		)
	);
	add(
		'Skin rarity roll',
		table(
			['Rarity', 'Weight', 'Chance'],
			weightRows(
				(eco.SkinRarityWeights ?? [])
					.filter((w) => w.Key)
					.map((w) => ({ label: titleCase(w.Key as string), weight: w.Weight }))
					.sort((a, b) => b.weight - a.weight)
			)
		)
	);

	add('Random enemy drop', [
		"''Rolled when a Brute-sized or larger enemy core dies.''",
		...table(
			['Reward', 'Count', 'Weight', 'Chance'],
			weightRows(
				(eco.RandomRewards ?? []).map((r) => ({
					label: r.Resource
						? `[[${stripHtml(resources[r.Resource]?.Name ?? r.Resource)}]]`
						: 'Nothing',
					weight: r.Weight,
					count: r.Count
				})),
				true
			)
		)
	]);
	return out.join('\n');
}

function buildCombatSection(): string {
	const combat = readDump().combatGlobals;
	if (!combat) return '';
	const out: string[] = [];
	const lightning = combat.LightningForkDamage;
	if (lightning) {
		out.push(
			'=== Lightning fork ===',
			...table(
				['Property', 'Value'],
				[
					['Damage per fork', fmtNum(lightning.Damage)],
					['Status effect', escapeWikiText(lightning.Effect ?? 'None')],
					['Status effect amount', fmtNum(lightning.EffectAmount)]
				]
			)
		);
	}
	const keys = combat.CoreExplosionDamageFalloff?.Keys ?? [];
	if (keys.length > 0) {
		if (out.length > 0) out.push('');
		out.push(
			'=== Core explosion falloff ===',
			"''Overclocked core explosions deal 40 damage to players at full strength and a flat 500 to other targets. Player damage is scaled by this curve.''",
			...table(
				['Distance (fraction of blast radius)', 'Player damage multiplier'],
				keys.map((k) => [fmtPct(k.Time), fmtPct(k.Value)])
			)
		);
	}
	return out.join('\n');
}

function buildStatusGlobalsSection(): string {
	const g = readDump().statusEffectGlobals as StatusEffectGlobals | undefined;
	if (!g) return '';
	const rows: [string, number | undefined][] = [
		['Saturation gained per hit (× effect amount)', g.SaturationAddMultiplier],
		['Damage on reaching full saturation (enemies)', g.FullSaturationDamage],
		['Damage per tick while fully saturated (players)', g.PlayerDamageOnTick],
		['Saturation explosion damage (enemies)', g.ExplosionDamage],
		['Saturation explosion damage (players)', g.ExplosionPlayerDamage],
		['Explosive damage multiplier', g.ExplosiveDamageMultiplier]
	];
	return table(
		['Rule', 'Value'],
		rows.filter(([, v]) => v !== undefined).map(([k, v]) => [k, fmtNum(v, 3)])
	).join('\n');
}

// A few stacks only carry their internal lowercase ID as a name ("scrap").
function displayStackName(name: string): string {
	const plain = stripHtml(name).trim();
	return plain === plain.toLowerCase() ? titleCase(plain) : plain;
}

function buildStacksSection(): string {
	const stacks = Object.values(readDump().stacks ?? {});
	const secs = (n: number | undefined) => (n ? fmtNum(n, 2) : '—');
	const rows = stacks
		.map((s) => ({ ...s, label: displayStackName(s.Name) }))
		.sort((a, b) => a.label.localeCompare(b.label))
		.map((s) => [
			escapeWikiText(s.label),
			fmtNum(s.MaxStacks) || '—',
			secs(s.LoseStackInterval),
			secs(s.TimeOutDuration),
			s.TimeoutOnLevelLoad ? 'Yes' : 'No'
		]);
	return table(
		[
			'Stack',
			'Max stacks',
			'Loses a stack every (s)',
			'All stacks expire after (s)',
			'Clears on level load'
		],
		rows
	).join('\n');
}

function buildPartWavesSection(): string {
	const waves = Object.values(readDump().customWaves ?? {})
		.filter((w) => w.AddAttachments && w.PartChance !== undefined)
		.sort((a, b) => a.Name.localeCompare(b.Name));
	if (waves.length === 0) return '';
	const rows = waves.map((w) => {
		const total = (w.Parts ?? []).reduce((sum, p) => sum + p.Weight, 0);
		const count = w.PartCount;
		return [
			humanize(w.Name),
			fmtPct(w.PartChance),
			count?.Min === count?.Max ? String(count?.Min ?? 1) : `${count?.Min ?? 1}–${count?.Max ?? 1}`,
			(w.Parts ?? [])
				.map((p) => `${escapeWikiText(humanize(p.Key ?? '?'))} (${fmtPct(p.Weight / total)})`)
				.join('<br />')
		];
	});
	return table(['Wave', 'Chance per enemy', 'Parts per enemy', 'Possible parts'], rows).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder + registry
// ─────────────────────────────────────────────────────────────────────────

export function buildGameMechanicsContext(): Record<string, unknown> {
	const difficultySection = buildDifficultySection();
	const economySection = buildEconomySection();
	const combatSection = buildCombatSection();
	const statusSection = buildStatusGlobalsSection();
	const stacksSection = buildStacksSection();
	const partWavesSection = buildPartWavesSection();
	return {
		name: PAGE_TITLE,
		pageTitle: PAGE_TITLE,
		seoDescription:
			'Global game mechanics in Mycopunk: threat difficulty scaling, mission economy, combat constants, status effect rules and buff stacks.',
		difficultySection,
		hasDifficultySection: difficultySection.length > 0,
		economySection,
		hasEconomySection: economySection.length > 0,
		combatSection,
		hasCombatSection: combatSection.length > 0,
		statusSection,
		hasStatusSection: statusSection.length > 0,
		stacksSection,
		hasStacksSection: stacksSection.length > 0,
		partWavesSection,
		hasPartWavesSection: partWavesSection.length > 0
	};
}

export const entity = defineEntity<GameMechanicsPage>({
	name: 'game-mechanics',
	dumpKey: 'difficulty',
	loadItems: () => [{ ID: 'game-mechanics' }],
	safeFilename: (p) => p.ID,
	displayFilename: () => PAGE_TITLE,
	pageTitle: () => PAGE_TITLE,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['notes', 'trivia', 'patch history'],
		autoGenSections: [
			'difficulty scaling',
			'economy',
			'combat',
			'status effects',
			'buff stacks',
			'enemy part waves',
			'overview'
		],
		infoboxTemplateName: 'Infobox game mechanics'
	},
	templateName: 'game-mechanics-source.wiki',
	skeletonTemplateName: 'game-mechanics-skeleton.wiki',
	contextBuilder: () => buildGameMechanicsContext()
});
