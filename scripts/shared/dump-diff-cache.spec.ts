import { describe, expect, test } from 'bun:test';
import { CHANGE_FORMAT_VERSION, isCachedDiffFresh } from './dump-diff-cache.ts';

const expected = {
	prevVersion: 'v1.8',
	currVersion: 'v1.9',
	prevMtimeMs: 100,
	currMtimeMs: 200
};

describe('isCachedDiffFresh', () => {
	test('fresh when versions, mtimes, and format version all match', () => {
		expect(isCachedDiffFresh({ ...expected, formatVersion: CHANGE_FORMAT_VERSION }, expected)).toBe(
			true
		);
	});

	test('stale when the cached format version is missing (old-format cache)', () => {
		// A pre-format-version cache file has no formatVersion field.
		expect(isCachedDiffFresh({ ...expected }, expected)).toBe(false);
	});

	test('stale when the cached format version is older', () => {
		expect(
			isCachedDiffFresh({ ...expected, formatVersion: CHANGE_FORMAT_VERSION - 1 }, expected)
		).toBe(false);
	});

	test('stale when a dump mtime differs', () => {
		expect(
			isCachedDiffFresh(
				{ ...expected, formatVersion: CHANGE_FORMAT_VERSION, currMtimeMs: 999 },
				expected
			)
		).toBe(false);
	});

	test('stale when the cache is null', () => {
		expect(isCachedDiffFresh(null, expected)).toBe(false);
	});
});
