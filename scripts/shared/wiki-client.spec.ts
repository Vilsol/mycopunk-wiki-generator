import { describe, expect, test } from 'bun:test';
import { withRateLimitRetry } from './wiki-client.ts';

describe('withRateLimitRetry', () => {
	test('retries ratelimited responses then returns the eventual success', async () => {
		let calls = 0;
		const delays: number[] = [];
		const res = await withRateLimitRetry(
			async () => {
				calls++;
				return calls < 3
					? { error: { code: 'ratelimited', info: 'slow down' } }
					: { edit: { result: 'Success' } };
			},
			{ baseDelayMs: 10, sleep: async (ms) => void delays.push(ms) }
		);
		expect(calls).toBe(3);
		expect(res).toEqual({ edit: { result: 'Success' } });
		// Exponential backoff before retry attempts 2 and 3.
		expect(delays).toEqual([10, 20]);
	});

	test('gives up after the retry budget and returns the last ratelimited response', async () => {
		let calls = 0;
		const res = await withRateLimitRetry(
			async () => {
				calls++;
				return { error: { code: 'ratelimited' as const } };
			},
			{ retries: 4, baseDelayMs: 1, sleep: async () => {} }
		);
		expect(calls).toBe(5); // initial attempt + 4 retries
		expect(res.error?.code).toBe('ratelimited');
	});

	test('does not retry non-ratelimited errors', async () => {
		let calls = 0;
		const res = await withRateLimitRetry(
			async () => {
				calls++;
				return { error: { code: 'badtoken' as const } };
			},
			{ sleep: async () => {} }
		);
		expect(calls).toBe(1);
		expect(res.error?.code).toBe('badtoken');
	});

	test('caps the backoff delay at maxDelayMs', async () => {
		const delays: number[] = [];
		await withRateLimitRetry(async () => ({ error: { code: 'ratelimited' as const } }), {
			retries: 4,
			baseDelayMs: 1000,
			maxDelayMs: 2500,
			sleep: async (ms) => void delays.push(ms)
		});
		expect(delays).toEqual([1000, 2000, 2500, 2500]);
	});
});
