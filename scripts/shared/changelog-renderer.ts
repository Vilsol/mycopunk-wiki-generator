// Render structured per-upgrade `ChangeRecord[]` history into wikitext
// for the `<section begin="changelog" />` block of an upgrade's /source
// page.
//
// Conventions implemented from the spec:
//   - Newest version inline; older versions wrapped in
//     `<div class="mw-collapsible mw-collapsed">` so the answer to "did
//     this just get nerfed?" is always immediately visible.
//   - Single-version case omits the collapsible wrapper.
//   - `=== v1.8 <small>(date)</small> ===` headings — anchor-able, in TOC.
//   - `(in <Property.Label>)` qualifier on stat records is omitted when
//     the stat name is unique on this upgrade.
//   - Every interpolated value passes through `escapeWiki` to neutralize
//     stray `]]`, `|`, `{{`.

import type { Change, ChangeRecord } from './dump-types.ts';

// ---------- escape --------------------------------------------------------

export function escapeWiki(s: string): string {
	return s.replaceAll('|', '{{!}}').replaceAll(']]', ']&#93;').replaceAll('{{', '&#123;&#123;');
}

function isoToYmd(iso: string): string {
	const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
	return m ? m[1] : iso;
}

// ---------- per-Change rendering ------------------------------------------

interface RenderContext {
	// Stat names that appear in exactly one property on this upgrade.
	// When a `stat` record references one of these, the renderer omits
	// the `(in <Property.Label>)` qualifier — readers don't think in
	// internal property-class names.
	uniqueStatNames: Set<string>;
}

function renderCost(c: Extract<Change, { kind: 'cost' }>): string {
	if (c.changes.length === 1) {
		const r = c.changes[0];
		return `* '''${escapeWiki(c.currency)} cost''': [[${escapeWiki(r.resourceName)}]]: ${r.from} → ${r.to}`;
	}
	const lines: string[] = [`* '''${escapeWiki(c.currency)} cost''' changed:`];
	for (const r of c.changes) {
		lines.push(`** [[${escapeWiki(r.resourceName)}]]: ${r.from} → ${r.to}`);
	}
	return lines.join('\n');
}

function fmtRange(min: string, max: string): string {
	return min === max ? escapeWiki(min) : `[${escapeWiki(min)} – ${escapeWiki(max)}]`;
}

function renderRolls(c: Extract<Change, { kind: 'rolls' }>): string {
	return `* '''${escapeWiki(c.stat)}''' rolls: ${fmtRange(c.fromMin, c.fromMax)} → ${fmtRange(c.toMin, c.toMax)}`;
}

function renderStatLine(
	c: Extract<Change, { kind: 'stat' | 'stat-add' | 'stat-remove' }>,
	ctx: RenderContext
): string {
	const showQualifier = !ctx.uniqueStatNames.has(c.stat);
	const inLabel = showQualifier ? ` (in ''${escapeWiki(c.property)}'')` : '';
	switch (c.kind) {
		case 'stat':
			return `* '''${escapeWiki(c.stat)}'''${inLabel}: ${escapeWiki(c.from)} → ${escapeWiki(c.to)}`;
		case 'stat-add':
			return showQualifier
				? `* New stat in ''${escapeWiki(c.property)}'': '''${escapeWiki(c.stat)}'''`
				: `* New stat: '''${escapeWiki(c.stat)}'''`;
		case 'stat-remove':
			return showQualifier
				? `* Removed stat from ''${escapeWiki(c.property)}'': '''${escapeWiki(c.stat)}'''`
				: `* Removed stat: '''${escapeWiki(c.stat)}'''`;
	}
}

function renderChange(c: Change, ctx: RenderContext): string | null {
	switch (c.kind) {
		case 'added':
			return '* Added.';
		case 'renamed':
			return `* Renamed: '''${escapeWiki(c.from)}''' → '''${escapeWiki(c.to)}'''.`;
		case 'description':
			// Suppress entry when the strip-equal check accidentally let
			// through a no-op (defensive — the diff engine should already
			// suppress these, but the spec says drop if equal post-strip).
			if (c.from === c.to) return null;
			return `* Description was: ''${escapeWiki(c.from)}'' → now: ''${escapeWiki(c.to)}''.`;
		case 'field':
			return `* '''${escapeWiki(c.field)}''': ${escapeWiki(c.from)} → ${escapeWiki(c.to)}`;
		case 'list-add':
			if (c.field === 'Flags') return `* New flag: '''${escapeWiki(c.value)}'''`;
			return `* Now applies to: [[${escapeWiki(c.value)}]]`;
		case 'list-remove':
			if (c.field === 'Flags') return `* Removed flag: '''${escapeWiki(c.value)}'''`;
			return `* No longer applies to: [[${escapeWiki(c.value)}]]`;
		case 'cost':
			return renderCost(c);
		case 'stat':
		case 'stat-add':
		case 'stat-remove':
			return renderStatLine(c, ctx);
		case 'rolls':
			return renderRolls(c);
		case 'property-add':
			return `* New property: ''${escapeWiki(c.property)}''`;
		case 'property-remove':
			return `* Removed property: ''${escapeWiki(c.property)}''`;
	}
}

// ---------- per-upgrade context -------------------------------------------

interface UpgradeForContext {
	Properties?: { StatNames?: string[] }[];
}

// Build the set of stat names that appear in exactly one of this
// upgrade's properties' `StatNames` lists. Used to decide whether to
// suppress the `(in <Label>)` qualifier on stat records.
function buildContext(currentUpgrade: UpgradeForContext): RenderContext {
	const counts = new Map<string, number>();
	for (const p of currentUpgrade.Properties ?? []) {
		const seenInThisProp = new Set<string>();
		for (const raw of p.StatNames ?? []) {
			const name = raw.replace(/<[^>]+?>/g, '').trim();
			if (!name || seenInThisProp.has(name)) continue;
			seenInThisProp.add(name);
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
	}
	const unique = new Set<string>();
	for (const [name, n] of counts) if (n === 1) unique.add(name);
	return { uniqueStatNames: unique };
}

// ---------- top-level rendering -------------------------------------------

export function renderChangelogSection(
	history: ChangeRecord[],
	currentUpgrade: UpgradeForContext
): string {
	if (history.length === 0) return '';
	const ctx = buildContext(currentUpgrade);

	// Sort newest-first by version order in the array (caller supplies
	// the order). Skip empty-changes records.
	const nonEmpty = history.filter((r) => r.changes.length > 0);
	if (nonEmpty.length === 0) return '';

	// Each version keeps a visible header with its bullets collapsed beneath
	// it — the canonical MediaWiki "visible header, collapsible body" idiom.
	// The heading sits inside `mw-collapsible` (so the toggle attaches to it)
	// but outside `mw-collapsible-content` (so it stays visible when
	// collapsed).
	const renderRecord = (r: ChangeRecord): string => {
		const heading = `=== ${escapeWiki(r.version)} <small>(${escapeWiki(isoToYmd(r.dumpedAt))})</small> ===`;
		const bullets: string[] = [];
		for (const c of r.changes) {
			const line = renderChange(c, ctx);
			if (line) bullets.push(line);
		}
		return [
			'<div class="mw-collapsible mw-collapsed">',
			heading,
			'<div class="mw-collapsible-content">',
			...bullets,
			'</div>',
			'</div>'
		].join('\n');
	};

	return nonEmpty.map(renderRecord).join('\n\n');
}
