import { describe, expect, test } from 'bun:test';
import { diffDumps } from './dump-diff.ts';

// Minimal dump with one upgrade, one property carrying rolled values for
// one stat under one upgradable. Mirrors the dump shape diffDumps reads.
function dump(rolls: string[]) {
	return {
		upgrades: {
			'1': {
				ID: '1',
				Name: 'Test',
				Properties: [
					{
						Type: 'UpgradeProperty_Test',
						Label: 'Test Prop',
						RolledValuesByUpgradable: { Gun: { Damage: rolls } }
					}
				]
			}
		}
	};
}

describe('diffDumps rolls', () => {
	test('emits a range delta when the rolled min or max shifts', () => {
		const prev = dump(['0.82', '0.9', '1']);
		const curr = dump(['0.77', '0.9', '1']);
		const change = diffDumps(prev, curr)
			.get('1')
			?.find((c) => c.kind === 'rolls');
		expect(change).toEqual({
			kind: 'rolls',
			property: 'Test Prop',
			stat: 'Damage',
			fromMin: '0.82',
			fromMax: '1',
			toMin: '0.77',
			toMax: '1'
		});
	});

	test('suppresses the rolls change when min and max are unchanged', () => {
		const prev = dump(['0.77', '0.82', '1']);
		const curr = dump(['0.77', '0.9', '1']); // shuffled within [0.77, 1]
		const rolls =
			diffDumps(prev, curr)
				.get('1')
				?.filter((c) => c.kind === 'rolls') ?? [];
		expect(rolls).toEqual([]);
	});

	test('parses signed-percent values for ordering', () => {
		const prev = dump(['-30%', '-35%', '-39.5%']);
		const curr = dump(['-30.5%', '-35%', '-38%']);
		const change = diffDumps(prev, curr)
			.get('1')
			?.find((c) => c.kind === 'rolls');
		// numeric order: -39.5 is min, -30 is max (prev); -38 min, -30.5 max (curr)
		expect(change).toMatchObject({
			fromMin: '-39.5%',
			fromMax: '-30%',
			toMin: '-38%',
			toMax: '-30.5%'
		});
	});
});

// Dump with one upgrade, one property, a single stat under N upgradable keys.
function statDump(perKey: Record<string, string>, statName = 'Adds') {
	const StatsByUpgradable: Record<string, { name: string; value: string; IsValid: boolean }[]> = {};
	for (const [k, v] of Object.entries(perKey)) {
		StatsByUpgradable[k] = [{ name: statName, value: v, IsValid: true }];
	}
	return {
		upgrades: {
			'1': {
				ID: '1',
				Name: 'Grid',
				Properties: [{ Type: 'UpgradeProperty_Grid', Label: 'Grow Grid', StatsByUpgradable }]
			}
		}
	};
}

describe('diffDumps categorical aggregation', () => {
	test('aggregates a multi-key categorical change into per-value counts', () => {
		const prev = statDump({ s0: 'Row', s1: 'Row', s2: 'Column' });
		const curr = statDump({ s0: 'Column', s1: 'Column', s2: 'Column' });
		const change = diffDumps(prev, curr)
			.get('1')
			?.find((c) => c.kind === 'category');
		expect(change).toEqual({
			kind: 'category',
			property: 'Grow Grid',
			stat: 'Adds',
			counts: [
				{ value: 'Column', from: 1, to: 3 },
				{ value: 'Row', from: 2, to: 0 }
			]
		});
	});

	test('suppresses a pure reshuffle (multiset unchanged)', () => {
		const prev = statDump({ s0: 'Row', s1: 'Column' });
		const curr = statDump({ s0: 'Column', s1: 'Row' });
		expect(diffDumps(prev, curr).get('1')).toBeUndefined();
	});

	test('single-key categorical stays a plain stat change', () => {
		const prev = statDump({ s0: 'Row' });
		const curr = statDump({ s0: 'Column' });
		const changes = diffDumps(prev, curr).get('1') ?? [];
		expect(changes).toEqual([
			{ kind: 'stat', property: 'Grow Grid', stat: 'Adds', from: 'Row', to: 'Column' }
		]);
	});

	test('numeric multi-key stats keep per-key stat changes', () => {
		const prev = statDump({ a: '+10%', b: '+10%' }, 'Damage');
		const curr = statDump({ a: '+20%', b: '+10%' }, 'Damage');
		const changes = diffDumps(prev, curr).get('1') ?? [];
		expect(changes.filter((c) => c.kind === 'category')).toEqual([]);
		expect(changes).toContainEqual({
			kind: 'stat',
			property: 'Grow Grid',
			stat: 'Damage',
			from: '+10%',
			to: '+20%'
		});
	});

	test('does not aggregate when the categorical stat is absent on one side', () => {
		// A wholly-new (or removed) multi-key categorical stat is already
		// reported by the StatNames set diff; the category branch must not
		// also emit a redundant "0 → n" line. Mirrors the numeric branch's
		// both-sides guard.
		const prev = statDump({});
		const curr = statDump({ s0: 'Row', s1: 'Column' });
		const changes = diffDumps(prev, curr).get('1') ?? [];
		expect(changes.filter((c) => c.kind === 'category')).toEqual([]);
	});
});

describe('diffDumps flags', () => {
	const withFlags = (Flags: string) => ({ upgrades: { '1': { ID: '1', Name: 'Flagged', Flags } } });

	test('ignores internal-only flags', () => {
		expect(
			diffDumps(withFlags('SkillTreeUpgrade, CanStack'), withFlags('CanStack')).get('1')
		).toBeUndefined();
		expect(diffDumps(withFlags('None'), withFlags('CanStack')).get('1')).toEqual([
			{ kind: 'list-add', field: 'Flags', value: 'CanStack' }
		]);
	});

	test('treats flag reordering as no change', () => {
		const prev = withFlags('CanStack, CanTurbocharge');
		const curr = withFlags('CanTurbocharge, CanStack');
		expect(diffDumps(prev, curr).get('1')).toBeUndefined();
	});
});

interface RangeStat {
	value: string;
	minValue: string;
	maxValue: string;
}

function rangeDump(stat: RangeStat, extra: Record<string, unknown> = {}) {
	return {
		upgrades: {
			'1': {
				ID: '1',
				Name: 'Range',
				...extra,
				Properties: [
					{
						Type: 'UpgradeProperty_Range',
						Label: 'Dev Label Typo',
						StatNames: ['Range'],
						StatsByUpgradable: { gun: [{ name: 'Range', IsValid: true, ...stat }] }
					}
				]
			}
		}
	};
}

describe('diffDumps range format', () => {
	test('multiplier ranges equal to the new percent display are not a change', () => {
		const prev = rangeDump({ value: '+22.5%', minValue: '1.204819', maxValue: '1.265823' });
		const curr = rangeDump({ value: '+22.5%', minValue: '+20.48%', maxValue: '+26.58%' });
		expect(diffDumps(prev, curr).get('1')).toBeUndefined();
	});

	test('rounded integer percents and swapped min/max are not a change', () => {
		const prev = rangeDump({ value: '+105.87%', minValue: '1.75', maxValue: '2.1' });
		const curr = rangeDump({ value: '+105.87%', minValue: '+110%', maxValue: '+75%' });
		expect(diffDumps(prev, curr).get('1')).toBeUndefined();
	});

	test('a real numeric shift is reported in matching percent format', () => {
		const prev = rangeDump({ value: '+105.87%', minValue: '1.75', maxValue: '2.1' });
		const curr = rangeDump({ value: '+105.87%', minValue: '+80%', maxValue: '+110%' });
		expect(diffDumps(prev, curr).get('1')).toEqual([
			{
				kind: 'stat',
				property: 'Range',
				stat: 'Range',
				from: '[+75% – +110%]',
				to: '[+80% – +110%]'
			}
		]);
	});

	test('uses StatNames, not the internal Label, as the property name', () => {
		const prev = { upgrades: {} };
		const curr = rangeDump({ value: '1', minValue: '1', maxValue: '1' });
		const withProp = { upgrades: { '1': { ...curr.upgrades['1'], Properties: [] } } };
		expect(diffDumps(withProp, curr).get('1')).toEqual([
			{ kind: 'property-add', property: 'Range' }
		]);
		expect(diffDumps(prev, curr).get('1')).toEqual([{ kind: 'added' }]);
	});
});

describe('diffDumps turbocharge cost', () => {
	const cost = [{ Count: 100, Resource: 'Romphus', ResourceID: 'romphus' }];

	test('ignores the cost disappearing once the upgrade cannot be turbocharged', () => {
		const stat = { value: '1', minValue: '1', maxValue: '1' };
		const prev = rangeDump(stat, { TurbochargeCost: cost });
		const curr = rangeDump(stat, { CanTurbocharge: false });
		expect(diffDumps(prev, curr).get('1')).toBeUndefined();
	});

	test('still reports a real turbocharge cost change', () => {
		const stat = { value: '1', minValue: '1', maxValue: '1' };
		const prev = rangeDump(stat, { TurbochargeCost: cost });
		const curr = rangeDump(stat, {
			CanTurbocharge: true,
			TurbochargeCost: [{ Count: 150, Resource: 'Romphus', ResourceID: 'romphus' }]
		});
		expect(diffDumps(prev, curr).get('1')?.[0]).toMatchObject({
			kind: 'cost',
			currency: 'Turbocharge'
		});
	});
});
