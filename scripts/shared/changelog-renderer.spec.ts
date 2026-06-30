import { describe, expect, test } from 'bun:test';
import { renderChangelogSection } from './changelog-renderer.ts';
import { prependBaselineRecords } from './entities/upgrades.ts';
import type { ChangeRecord } from './dump-types.ts';

const upgrade = { Properties: [{ StatNames: ['Damage'] }] };

describe('renderChangelogSection rolls', () => {
	test('renders a roll range delta', () => {
		const history: ChangeRecord[] = [
			{
				version: 'v1.9.1',
				dumpedAt: '2026-06-26T00:00:00Z',
				changes: [
					{
						kind: 'rolls',
						property: 'Test Prop',
						stat: 'Damage',
						fromMin: '-39.5%',
						fromMax: '-30%',
						toMin: '-38%',
						toMax: '-30.5%'
					}
				]
			}
		];
		const out = renderChangelogSection(history, upgrade);
		expect(out).toContain("'''Damage''' rolls: [-39.5% – -30%] → [-38% – -30.5%]");
	});

	test('renders a single value when min equals max', () => {
		const history: ChangeRecord[] = [
			{
				version: 'v1.9.1',
				dumpedAt: '2026-06-26T00:00:00Z',
				changes: [
					{
						kind: 'rolls',
						property: 'Test Prop',
						stat: 'Damage',
						fromMin: '1',
						fromMax: '1',
						toMin: '2',
						toMax: '2'
					}
				]
			}
		];
		const out = renderChangelogSection(history, upgrade);
		expect(out).toContain("'''Damage''' rolls: 1 → 2");
	});

	test('renders the baseline added record under its version heading', () => {
		const history: ChangeRecord[] = [
			{ version: 'v1.7.3', dumpedAt: '2026-04-29T00:00:00Z', changes: [{ kind: 'added' }] }
		];
		const out = renderChangelogSection(history, upgrade);
		expect(out).toContain('=== v1.7.3 <small>(2026-04-29)</small> ===');
		expect(out).toContain('* Added.');
	});
});

describe('renderChangelogSection collapsing', () => {
	const history: ChangeRecord[] = [
		{
			version: 'v1.9.1',
			dumpedAt: '2026-06-26T00:00:00Z',
			changes: [{ kind: 'list-add', field: 'Flags', value: 'CanTurbocharge' }]
		},
		{ version: 'v1.7.3', dumpedAt: '2026-04-29T00:00:00Z', changes: [{ kind: 'added' }] }
	];

	test('keeps every version header visible', () => {
		const out = renderChangelogSection(history, upgrade);
		expect(out).toContain('=== v1.9.1 <small>(2026-06-26)</small> ===');
		expect(out).toContain('=== v1.7.3 <small>(2026-04-29)</small> ===');
	});

	test('wraps each version (including the latest) in its own collapsed block', () => {
		const out = renderChangelogSection(history, upgrade);
		expect((out.match(/mw-collapsible mw-collapsed/g) ?? []).length).toBe(2);
		expect((out.match(/mw-collapsible-content/g) ?? []).length).toBe(2);
	});

	test('places each header before its collapsible content and bullets inside it', () => {
		const out = renderChangelogSection(history, upgrade);
		const headingIdx = out.indexOf('=== v1.9.1');
		const contentIdx = out.indexOf('mw-collapsible-content', headingIdx);
		const bulletIdx = out.indexOf('New flag', headingIdx);
		expect(headingIdx).toBeGreaterThanOrEqual(0);
		expect(contentIdx).toBeGreaterThan(headingIdx);
		expect(bulletIdx).toBeGreaterThan(contentIdx);
	});

	test('a single-version history still collapses its content', () => {
		const out = renderChangelogSection([history[1]], upgrade);
		expect(out).toContain('=== v1.7.3 <small>(2026-04-29)</small> ===');
		expect(out).toContain('mw-collapsible-content');
		expect(out).toContain('* Added.');
	});
});

describe('renderChangelogSection category', () => {
	// 'Adds' is the only StatName here, so the (in <Property>) qualifier is
	// suppressed.
	const gridUpgrade = { Properties: [{ StatNames: ['Adds'] }] };

	test('renders an aggregated categorical change as per-value counts', () => {
		const history: ChangeRecord[] = [
			{
				version: 'v1.9.4',
				dumpedAt: '2026-06-30T00:00:00Z',
				changes: [
					{
						kind: 'category',
						property: 'Grow Grid',
						stat: 'Adds',
						counts: [
							{ value: 'Row', from: 8, to: 3 },
							{ value: 'Column', from: 9, to: 14 }
						]
					}
				]
			}
		];
		const out = renderChangelogSection(history, gridUpgrade);
		expect(out).toContain("'''Adds''': Row 8 → 3, Column 9 → 14");
	});
});

describe('prependBaselineRecords', () => {
	const oldest = { version: 'v1.7.3', dumpedAt: '2026-04-29T00:00:00Z' };

	test('prepends an Added baseline for an upgrade with later changes present in the oldest dump', () => {
		const history = new Map<string, ChangeRecord[]>([
			['1', [{ version: 'v1.9.1', dumpedAt: '2026-06-26T00:00:00Z', changes: [{ kind: 'added' }] }]]
		]);
		prependBaselineRecords(history, ['1'], new Set(['1']), oldest);
		expect(history.get('1')).toEqual([
			{ version: 'v1.7.3', dumpedAt: '2026-04-29T00:00:00Z', changes: [{ kind: 'added' }] },
			{ version: 'v1.9.1', dumpedAt: '2026-06-26T00:00:00Z', changes: [{ kind: 'added' }] }
		]);
	});

	test('creates a lone baseline for an unchanged upgrade in the oldest dump', () => {
		const history = new Map<string, ChangeRecord[]>();
		prependBaselineRecords(history, ['1'], new Set(['1']), oldest);
		expect(history.get('1')).toEqual([
			{ version: 'v1.7.3', dumpedAt: '2026-04-29T00:00:00Z', changes: [{ kind: 'added' }] }
		]);
	});

	test('skips an upgrade absent from the oldest dump', () => {
		const history = new Map<string, ChangeRecord[]>();
		prependBaselineRecords(history, ['2'], new Set(['1']), oldest);
		expect(history.has('2')).toBe(false);
	});
});
