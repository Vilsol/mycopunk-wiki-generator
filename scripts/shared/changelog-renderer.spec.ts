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
