// Character entity: skill-tree per-tier tables, default-ability resolution
// from `playerUpgrades`, inverted upgrades-by-character index, default emotes.

import type { CharacterEntry, QuipEntry, SkillTreeNode } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import { escapeWikiText, stripHtml } from '../wiki-text';
import {
	loadCharacters,
	displayFilename,
	safeFilename,
	characterPageTitle
} from '../load-characters';
import { loadSkins, skinPageTitle, variantPreviewFilename, type Skin } from '../load-skins';
import type { EntityClassifierConfig } from '../upload-pipeline';
import { layoutSkillTree } from './character-skill-tree';
export { layoutSkillTree } from './character-skill-tree';
// `import.meta.url` of this module is needed by the layout fn to resolve the
// upgrade icons directory; callers can pass their own meta URL too.
const SHARED_META_URL = import.meta.url;

export { loadCharacters, displayFilename, safeFilename, characterPageTitle };

// ─────────────────────────────────────────────────────────────────────────
// playerUpgrades lookup: Subclass → entry. Used to resolve a character's
// `DefaultUpgradeType` (e.g. "AirDashUpgrade") to a named ability.
// ─────────────────────────────────────────────────────────────────────────

interface PlayerUpgradeEntry {
	Name: string;
	Subclass: string;
	Character?: string | null;
	RawData?: { id?: number };
}

function loadPlayerUpgradesBySubclass(): Map<string, PlayerUpgradeEntry> {
	const data = readDump() as unknown as {
		playerUpgrades?: Record<string, PlayerUpgradeEntry>;
	};
	const out = new Map<string, PlayerUpgradeEntry>();
	for (const e of Object.values(data.playerUpgrades ?? {})) {
		if (e.Subclass) out.set(e.Subclass, e);
	}
	return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Upgrade-ID → upgrade lookup (full upgrades map, including cosmetics —
// caller filters as needed).
// ─────────────────────────────────────────────────────────────────────────

export function loadUpgradesByID(): Map<string, GenericGunUpgrade> {
	const data = readDump() as unknown as {
		upgrades?: Record<string, GenericGunUpgrade>;
	};
	const out = new Map<string, GenericGunUpgrade>();
	for (const u of Object.values(data.upgrades ?? {})) {
		out.set(String(u.ID), u);
	}
	return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Skill-tree rendering: group by Layer, format as per-tier bullet tables
// with MinSpentSkillPointsToUnlock as the layer's gate.
// ─────────────────────────────────────────────────────────────────────────

const RARITY_COLORS: Record<string, string> = {
	Standard: 'green',
	Rare: 'cornflowerblue',
	Epic: 'magenta',
	Exotic: 'orange',
	Oddity: 'red',
	Contraband: 'purple'
};

const RARITY_ORDER: Record<string, number> = {
	Standard: 1,
	Rare: 2,
	Epic: 3,
	Exotic: 4,
	Oddity: 5,
	Contraband: 6
};

function rarityCell(rarity: string): string {
	const order = RARITY_ORDER[rarity] ?? 99;
	const color = RARITY_COLORS[rarity];
	const inner = color ? `<span style="color:${color}">${rarity}</span>` : rarity;
	return `data-sort-value="${order}" | ${inner}`;
}

interface ResolvedNode {
	node: SkillTreeNode;
	upgrade: GenericGunUpgrade | undefined;
}

function buildSkillTreeSection(
	tree: SkillTreeNode[],
	upgradesByID: Map<string, GenericGunUpgrade>
): string {
	if (!tree || tree.length === 0) return '';

	// Group by Layer.
	const byLayer = new Map<number, ResolvedNode[]>();
	for (const node of tree) {
		const layer = node.Layer ?? 0;
		const list = byLayer.get(layer) ?? [];
		list.push({ node, upgrade: upgradesByID.get(String(node.Upgrade)) });
		byLayer.set(layer, list);
	}

	const layers = [...byLayer.keys()].sort((a, b) => a - b);
	const out: string[] = [];

	for (const layer of layers) {
		const nodes = byLayer.get(layer)!;
		// Per-layer SP gate: take the minimum (all nodes in a layer share it).
		const sp = Math.min(...nodes.map((n) => n.node.MinSpentSkillPointsToUnlock ?? 0));
		const tierLabel = `Tier ${layer + 1}`;
		const spLabel = sp === 0 ? 'starter' : `${sp} skill point${sp === 1 ? '' : 's'}`;

		out.push(`==== ${tierLabel} (${spLabel}) ====`);
		out.push('{| class="wikitable sortable"');
		out.push('! Upgrade !! Rarity !! Description');
		nodes.sort((a, b) => {
			const an = stripHtml(a.upgrade?.Name ?? '');
			const bn = stripHtml(b.upgrade?.Name ?? '');
			return an.localeCompare(bn);
		});
		for (const { node, upgrade } of nodes) {
			out.push('|-');
			if (!upgrade) {
				out.push(`| (unknown upgrade ${node.Upgrade}) || || `);
				continue;
			}
			const name = stripHtml(upgrade.Name);
			const desc = stripHtml(upgrade.Description ?? '')
				.replace(/\s+/g, ' ')
				.trim();
			out.push(`| [[${name} Upgrade|${name}]] || ${rarityCell(upgrade.Rarity)} || ${desc}`);
		}
		out.push('|}');
		out.push('');
	}

	return out.join('\n').trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregate "all upgrades available to this character" — flat sortable
// table, equivalent to what the existing wiki pages render manually.
// ─────────────────────────────────────────────────────────────────────────

function buildUpgradesTable(
	tree: SkillTreeNode[],
	upgradesByID: Map<string, GenericGunUpgrade>
): string {
	if (!tree || tree.length === 0) return '';
	const upgrades: GenericGunUpgrade[] = [];
	for (const node of tree) {
		const u = upgradesByID.get(String(node.Upgrade));
		if (u) upgrades.push(u);
	}
	upgrades.sort((a, b) => stripHtml(a.Name).localeCompare(stripHtml(b.Name)));

	const out = ['{| class="wikitable sortable"', '! Name !! Rarity !! Description'];
	for (const u of upgrades) {
		const name = stripHtml(u.Name);
		const desc = stripHtml(u.Description ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		out.push('|-');
		out.push(`| [[${name} Upgrade|${name}]] || ${rarityCell(u.Rarity)} || ${desc}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Drop-only upgrades + skins — surfaces upgrades whose `ApplicableTo` matches
// this character but which aren't in the character's SkillTree (e.g. Saxonite
// Shackles for Glider, Cannonball for Bruiser). These have
// `CollectionSource: "DropsFromSource"` and are acquired in-world rather than
// via skill points.
// ─────────────────────────────────────────────────────────────────────────

interface UpgradesByCharacter {
	upgrades: Map<string, GenericGunUpgrade[]>; // keyed by character APIName, Normal type only
	skins: Map<string, GenericGunUpgrade[]>; // keyed by character APIName, Cosmetic type only
}

// Inverse index: walk every upgrade, group by `ApplicableTo` entries that
// reference a character (Name suffix "(Character)"), split by Cosmetic vs
// Normal upgrade type. Used to surface drop-only character entries the
// SkillTree doesn't include.
export function loadUpgradesByCharacter(): UpgradesByCharacter {
	const data = readDump() as unknown as { upgrades?: Record<string, GenericGunUpgrade> };
	const upgrades = new Map<string, GenericGunUpgrade[]>();
	const skins = new Map<string, GenericGunUpgrade[]>();
	for (const u of Object.values(data.upgrades ?? {})) {
		for (const ap of u.ApplicableTo ?? []) {
			const apName = ap.Name ?? '';
			if (!apName.endsWith('(Character)')) continue;
			const key = ap.APIName ?? '';
			if (!key) continue;
			const target = u.UpgradeType === 'Cosmetic' ? skins : upgrades;
			const list = target.get(key) ?? [];
			list.push(u);
			target.set(key, list);
		}
	}
	for (const m of [upgrades, skins]) {
		for (const list of m.values()) {
			list.sort((a, b) => stripHtml(a.Name).localeCompare(stripHtml(b.Name)));
		}
	}
	return { upgrades, skins };
}

// Filter `applicable` to the upgrades NOT already in the SkillTree.
function dropOnlyFor(applicable: GenericGunUpgrade[], tree: SkillTreeNode[]): GenericGunUpgrade[] {
	const treeIDs = new Set(tree.map((n) => String(n.Upgrade)));
	return applicable.filter((u) => !treeIDs.has(String(u.ID)));
}

function buildDropOnlyUpgradesTable(upgrades: GenericGunUpgrade[]): string {
	if (upgrades.length === 0) return '';
	const out = ['{| class="wikitable sortable"', '! Name !! Rarity !! Description'];
	for (const u of upgrades) {
		const name = stripHtml(u.Name);
		const desc = stripHtml(u.Description ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		out.push('|-');
		out.push(`| [[${name} Upgrade|${name}]] || ${rarityCell(u.Rarity)} || ${desc}`);
	}
	out.push('|}');
	return out.join('\n');
}

// Index of Skin entries by upgrade ID. Each character's applicable skins are
// matched against this so the table can link to the dedicated skin page (with
// base thumbnail) rather than a non-existent `[[<Name> Upgrade]]`.
function loadSkinsByID(): Map<string, Skin> {
	const out = new Map<string, Skin>();
	for (const s of loadSkins()) out.set(String(s.upgrade.ID), s);
	return out;
}

function basePreviewThumb(s: Skin): string {
	// Pick the first preview variant (preferring "base") for a 60px row thumb.
	const previews = s.skin.Previews ?? {};
	for (const parent of Object.keys(previews)) {
		const variants = previews[parent] ?? {};
		const preset = 'base' in variants ? 'base' : Object.keys(variants)[0];
		if (!preset) continue;
		const file = variantPreviewFilename(s, parent, preset, 'jpg');
		return `[[File:${file}|60px|link=${skinPageTitle(s)}]]`;
	}
	return '';
}

function buildSkinsTable(skins: GenericGunUpgrade[]): string {
	if (skins.length === 0) return '';
	const skinsByID = loadSkinsByID();
	// Dedupe by skin page title — the dump can ship multiple cosmetic upgrade
	// IDs that resolve to the same skin page (re-issues, rarity dupes). Pick
	// the entry with the most rendered variants.
	const byPage = new Map<string, Skin>();
	for (const u of skins) {
		const found = skinsByID.get(String(u.ID));
		if (!found) continue;
		const title = skinPageTitle(found);
		const prior = byPage.get(title);
		const foundCount = Object.values(found.skin.Previews ?? {}).reduce(
			(n, m) => n + Object.keys(m).length,
			0
		);
		const priorCount = prior
			? Object.values(prior.skin.Previews ?? {}).reduce((n, m) => n + Object.keys(m).length, 0)
			: -1;
		if (!prior || foundCount > priorCount) byPage.set(title, found);
	}
	if (byPage.size === 0) return '';

	const matched = [...byPage.values()].sort((a, b) =>
		stripHtml(a.upgrade.Name ?? '').localeCompare(stripHtml(b.upgrade.Name ?? ''))
	);

	const out = ['{| class="wikitable sortable"', '! Preview !! Name !! Rarity !! Variants'];
	for (const s of matched) {
		const name = stripHtml(s.upgrade.Name ?? '');
		const variantCount = Object.values(s.skin.Previews ?? {}).reduce(
			(n, m) => n + Object.keys(m).length,
			0
		);
		out.push('|-');
		out.push(
			`| ${basePreviewThumb(s) || '—'} || [[${skinPageTitle(s)}|${name}]] || ${rarityCell(s.upgrade.Rarity)} || ${variantCount || '—'}`
		);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Quips/voicelines table — `quips` top-level table grouped by Character.
// Supersedes the old "Default Emotes" section: every entry that was on
// `CharacterEntry.DefaultEmotes` is also a quip, and DefaultEmotes' only
// unique signal (which 7 entries are bound to the quick wheel) is now a
// "Default" column on this table.
// ─────────────────────────────────────────────────────────────────────────

interface EmoteEntry {
	Label?: string;
	APIName?: string;
}

function loadQuipsByCharacter(): Map<string, QuipEntry[]> {
	const data = readDump() as unknown as { quips?: Record<string, QuipEntry> };
	const out = new Map<string, QuipEntry[]>();
	for (const q of Object.values(data.quips ?? {})) {
		const ch = (q.Character ?? '').trim();
		if (!ch) continue;
		// Skip entries with no Label — observed once per character (data
		// artefact — likely a placeholder/test slot).
		if (!q.Label || !q.Label.trim()) continue;
		const list = out.get(ch) ?? [];
		list.push(q);
		out.set(ch, list);
	}
	for (const list of out.values()) {
		list.sort((a, b) => (a.Label ?? '').localeCompare(b.Label ?? ''));
	}
	return out;
}

function prettyLabel(q: QuipEntry): string {
	// Labels are `e_no`, `e_heli`, `d_dance_gl` etc. The first segment marks the
	// kind (`e_` emote, `d_` dance); strip it for display so the wiki shows just
	// the action. Raw label still appears in the trailing <code> column.
	const raw = q.Label ?? '';
	const base = raw
		.replace(/^[ed]_/, '')
		.replace(/[_-]+/g, ' ')
		.trim();
	if (!base) return raw;
	return base[0].toUpperCase() + base.slice(1);
}

function quipTypeLabel(t: string | undefined): string {
	// "-1" appears in the dump for some entries (flag-enum sentinel for "all" or
	// "invalid" — treat like no-type). "None" is the explicit empty value.
	if (!t || t === 'None' || t === '-1') return '';
	return t
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.join(', ');
}

function buildQuipsTable(
	quips: QuipEntry[] | undefined,
	defaultEmoteLabels: ReadonlySet<string>
): string {
	if (!quips || quips.length === 0) return '';
	const out = [
		'{| class="wikitable sortable"',
		'! Emote !! Default !! Type !! Voiceline !! <code>Label</code>'
	];
	for (const q of quips) {
		const label = prettyLabel(q);
		const text = (q.VoicelineText ?? '').trim();
		const type = quipTypeLabel(q.QuipType);
		const voiceCell = text ? `''"${text}"''` : '<small>(silent)</small>';
		const isDefault = q.Label ? defaultEmoteLabels.has(q.Label) : false;
		const defaultCell = isDefault ? 'data-sort-value="1" | ✓' : 'data-sort-value="0" | —';
		out.push('|-');
		out.push(
			`| '''${label}''' || ${defaultCell} || ${type || '—'} || ${voiceCell} || <code>${q.Label}</code>`
		);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Default-ability label (from playerUpgrades by Subclass).
// ─────────────────────────────────────────────────────────────────────────

function resolveDefaultAbility(
	c: CharacterEntry,
	playerByClass: Map<string, PlayerUpgradeEntry>
): string {
	const cls = (c as { DefaultUpgradeType?: string }).DefaultUpgradeType;
	if (!cls) return '';
	const entry = playerByClass.get(cls);
	if (!entry) return '';
	// Skip generic placeholders (e.g. Glider's "GenericPlayerUpgrade").
	if (entry.Name === 'GenericPlayerUpgrade' || /^Generic/.test(entry.Name)) return '';
	return entry.Name;
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildCharacterContext(c: CharacterEntry): Record<string, unknown> {
	const playerByClass = loadPlayerUpgradesBySubclass();
	const upgradesByID = loadUpgradesByID();
	const quipsByCharacter = loadQuipsByCharacter();
	const upgradesByCharacter = loadUpgradesByCharacter();
	const tree = (c as { SkillTree?: SkillTreeNode[] }).SkillTree ?? [];
	const emotes = (c as { DefaultEmotes?: EmoteEntry[] }).DefaultEmotes ?? [];
	const defaultEmoteLabels = new Set(
		emotes.map((e) => e.APIName).filter((s): s is string => typeof s === 'string' && s.length > 0)
	);
	const quips = quipsByCharacter.get(c.Name ?? '') ?? [];
	const quipsTable = buildQuipsTable(quips, defaultEmoteLabels);

	// Drop-only / skin tables — upgrades whose ApplicableTo references this
	// character but which aren't in the SkillTree.
	const charKey = c.APIName ?? '';
	const applicableUpgrades = upgradesByCharacter.upgrades.get(charKey) ?? [];
	const applicableSkins = upgradesByCharacter.skins.get(charKey) ?? [];
	const dropOnlyUpgrades = dropOnlyFor(applicableUpgrades, tree);
	const dropOnlySkins = dropOnlyFor(applicableSkins, tree);
	const dropOnlyUpgradesTable = buildDropOnlyUpgradesTable(dropOnlyUpgrades);
	const skinsTable = buildSkinsTable(dropOnlySkins);
	const colorTag = (c as { PrimaryColorTag?: string }).PrimaryColorTag;
	const textColorTag = (c as { TextColorTag?: string }).TextColorTag;
	const employeeID = (c as { EmployeeID?: string }).EmployeeID;

	// V2 suffix forces a new CDN path after the v1 (circle-based) upload was
	// stuck behind Wikitide's URL-keyed CDN cache. Rename whenever a content
	// change must invalidate the CDN faster than its TTL would allow.
	const skillTreeFile = `${displayFilename(c)}_SkillTreeV7.svg`;
	const layout = layoutSkillTree(tree, upgradesByID, c.Name, SHARED_META_URL);
	// Miraheze doesn't have the ImageMap extension, so per-node clicks aren't
	// possible — embed the SVG as a plain image. The per-tier wikitables
	// below it provide clickable navigation to each upgrade.
	//
	// Vector 2022's dark-mode auto-card / auto-invert CSS targets figures
	// that are *direct children* of `.mw-parser-output`, `section`, `dd` or
	// `p` (`> figure[typeof^="mw:File"]`). Wrapping the image in a `<div>`
	// breaks that direct-child relationship — the same way upgrade patterns
	// inside Portable Infobox dodge the rule via `<div class="pi-data-value">`.
	const skillTreeImage = layout.nodeCount
		? `<div>\n[[File:${skillTreeFile}|center|600px|alt=${c.Name} skill tree map]]\n</div>`
		: '';

	return {
		name: escapeWikiText(c.Name),
		pageTitle: characterPageTitle(c),
		apiName: escapeWikiText(c.APIName ?? c.Name),
		employeeID: employeeID ?? '',
		index: c.Index ?? 0,
		isPlayable: c.IsPlayable ? 'Yes' : 'No',
		maxLevel: c.MaxLevel ?? 0,
		minUnlockLevel: c.MinUnlockLevel ?? 0,
		skinCount: c.SkinCount ?? 0,
		primaryColor: colorTag ? `#${colorTag.toLowerCase()}` : '',
		textColor: textColorTag ? `#${textColorTag.toLowerCase()}` : '',
		defaultAbility: resolveDefaultAbility(c, playerByClass),
		icon: `${displayFilename(c)}_Icon.png`,
		skillTreeFile,
		seoDescription: `${c.Name} — playable character in Mycopunk.`,
		skillTreeImage,
		hasSkillTreeImage: skillTreeImage.length > 0,
		skillTreeSection: buildSkillTreeSection(tree, upgradesByID),
		upgradesSection: buildUpgradesTable(tree, upgradesByID),
		dropOnlyUpgradesSection: dropOnlyUpgradesTable,
		hasDropOnlyUpgrades: dropOnlyUpgradesTable.length > 0,
		dropOnlyUpgradeCount: dropOnlyUpgrades.length,
		skinsSection: skinsTable,
		hasSkins: skinsTable.length > 0,
		quipsSection: quipsTable,
		hasQuips: quipsTable.length > 0,
		quipCount: quips.length,
		hasSkillTree: tree.length > 0
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Classifier config — host pages have heavy curator content (lore
// blockquote, abilities prose, strategy, dialogue voice lines). Classifier
// flags any non-empty page as legacy-edited so we never overwrite by
// default; the user merges manually after the first push.
// ─────────────────────────────────────────────────────────────────────────

export const CHARACTER_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'abilities', 'strategy', 'dialogue', 'trivia', 'notes', 'patch history'].map((s) =>
			s.toLowerCase()
		)
	),
	autoGenSections: new Set([
		'skill tree',
		'upgrades',
		'drop-only upgrades',
		'other upgrades',
		'skins',
		'default emotes',
		'emotes',
		'quips'
	]),
	// "default emotes" / "emotes" remain in autoGenSections (above) so the
	// classifier doesn't flag old bot-emitted sections as curator content while
	// host pages catch up to the merged-into-Quips schema.
	infoboxStripPattern: /\{\{Infobox character[\s\S]*?\}\}/g
};
