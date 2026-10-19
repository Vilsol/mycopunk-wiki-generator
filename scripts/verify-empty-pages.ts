// Independent re-check of host pages the uploader classified as safe to
// overwrite. Deliberately shares no logic with `classifyHostPage` in
// upload-wiki.ts — it diffs the live wikitext line-by-line against the
// skeleton the bot would write, and inspects revision history to tell bot
// edits from human ones.
//
// The bot has edited under several accounts (including the operator's own,
// which also makes human edits), so authorship can't separate bot from
// human; a revision counts as bot-made when it carries the uploader's fixed
// edit summary.
//
// Usage: bun scripts/verify-empty-pages.ts (--entity=NAME | --all)

import fs from 'node:fs';
import path from 'node:path';
import { fetchPagesContent, queryWikiApi } from './shared/wiki-client';
import { getProjectRoot } from './shared/paths';

const BOT_SUMMARY = /^Update auto-generated content for /;

type Verdict =
	| 'empty'
	| 'old-bot-skeleton'
	| 'curator-content'
	| 'curator-removed'
	| 'missing'
	| 'no-skeleton';

interface Revision {
	revid: number;
	user?: string;
	comment?: string;
	timestamp: string;
	size: number;
}

interface PageResult {
	pageTitle: string;
	verdict: Verdict;
	lastEditor: 'bot' | 'human' | 'unknown';
	extraLines: string[];
	missingLines: string[];
	humanRevisions: number;
	// Human revisions that were later replaced by a bot edit — curator content
	// that may already have been lost (recoverable from history).
	overwrittenHumanRevisions: { revid: number; user?: string; timestamp: string; size: number }[];
}

const root = getProjectRoot(import.meta.url);
const sourceDir = path.join(root, 'generated-wiki-source');

function parseArgs() {
	const args = process.argv.slice(2);
	const entity = args.find((a) => a.startsWith('--entity='))?.slice('--entity='.length);
	const all = args.includes('--all');
	if (!entity && !all) {
		console.error('Pass --entity=<name> or --all.');
		process.exit(1);
	}
	return { entity, all };
}

const isBot = (r: Revision) => BOT_SUMMARY.test(r.comment ?? '');

function normalizeLine(line: string): string {
	return decodeEntities(line)
		.replace(/\{\{\s*#lst\s*:\s*([^|}]+?)\s*\|\s*([^}]+?)\s*\}\}/g, (_, page, sec) => {
			const title = page.replace(/_/g, ' ');
			return `{{#lst:${title.charAt(0).toUpperCase()}${title.slice(1)}|${sec}}}`;
		})
		.replace(/^(=+)\s*(.*?)\s*\1$/, '$1 $2 $1')
		.replace(/\s+/g, ' ')
		.trim();
}

function meaningfulLines(text: string): string[] {
	return text.split('\n').map(normalizeLine).filter(Boolean);
}

// Multiset difference: lines in `a` not matched by a line in `b`.
function lineResidue(a: string[], b: string[]): string[] {
	const pool = new Map<string, number>();
	for (const l of b) pool.set(l, (pool.get(l) ?? 0) + 1);
	const out: string[] = [];
	for (const l of a) {
		const n = pool.get(l) ?? 0;
		if (n > 0) pool.set(l, n - 1);
		else out.push(l);
	}
	return out;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

// Skeletons reference their own title via `{{#lst:<Title>/source|...}}`;
// templates HTML-escape it (`Crow&#39;s Nest`), MediaWiki decodes it.
function loadSkeletonsByTitle(entityDir: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const f of fs.readdirSync(entityDir)) {
		if (!f.endsWith('.skeleton.wiki')) continue;
		const text = fs.readFileSync(path.join(entityDir, f), 'utf8');
		const m = text.match(/\{\{#lst:(.+?)\/source\|/);
		if (m) out.set(decodeEntities(m[1]), text);
	}
	return out;
}

async function fetchHistory(title: string): Promise<Revision[]> {
	const revs: Revision[] = [];
	let cont: Record<string, string> = {};
	for (;;) {
		const data = await queryWikiApi<{
			continue?: Record<string, string>;
			query?: { pages: Record<string, { revisions?: Revision[] }> };
		}>({
			action: 'query',
			prop: 'revisions',
			titles: title,
			rvprop: 'ids|user|comment|timestamp|size',
			rvlimit: 'max',
			...cont
		});
		for (const p of Object.values(data.query?.pages ?? {})) revs.push(...(p.revisions ?? []));
		if (!data.continue) break;
		cont = data.continue;
	}
	return revs; // newest first
}

async function fetchRevisionContent(revid: number): Promise<string> {
	const data = await queryWikiApi<{
		query?: { pages: Record<string, { revisions?: { slots?: { main?: { '*'?: string } } }[] }> };
	}>({
		action: 'query',
		prop: 'revisions',
		revids: String(revid),
		rvprop: 'content',
		rvslots: 'main'
	});
	const page = Object.values(data.query?.pages ?? {})[0];
	return page?.revisions?.[0]?.slots?.main?.['*'] ?? '';
}

async function verifyEntity(entity: string): Promise<PageResult[]> {
	const entityDir = path.join(sourceDir, entity);
	const reportPath = path.join(entityDir, 'upload-report.json');
	if (!fs.existsSync(reportPath)) {
		console.warn(`(no upload report for ${entity} — skip)`);
		return [];
	}
	const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
		flaggedHostPages: { pageTitle: string; safeToOverwrite: boolean }[];
	};
	const titles = report.flaggedHostPages.filter((p) => p.safeToOverwrite).map((p) => p.pageTitle);
	console.log(`\n──── ${entity}: ${titles.length} page(s) classified safe ────`);
	if (titles.length === 0) return [];

	const skeletons = loadSkeletonsByTitle(entityDir);
	const live = await fetchPagesContent(titles);

	const results: PageResult[] = [];
	for (const [i, title] of titles.entries()) {
		if ((i + 1) % 50 === 0) console.log(`  … ${i + 1}/${titles.length}`);
		const page = live.get(title);
		const skeleton = skeletons.get(title);
		const base = {
			pageTitle: title,
			extraLines: [],
			missingLines: [],
			humanRevisions: 0,
			overwrittenHumanRevisions: []
		};
		if (!page?.exists) {
			results.push({ ...base, verdict: 'missing', lastEditor: 'unknown' });
			continue;
		}
		if (!skeleton) {
			results.push({ ...base, verdict: 'no-skeleton', lastEditor: 'unknown' });
			continue;
		}

		const history = await fetchHistory(title);
		const lastEditor = history.length === 0 ? 'unknown' : isBot(history[0]) ? 'bot' : 'human';
		const lastBotIdx = history.findIndex(isBot);
		const overwritten =
			lastBotIdx < 0
				? []
				: history
						.slice(lastBotIdx + 1)
						.filter((r) => !isBot(r))
						.map(({ revid, user, timestamp, size }) => ({ revid, user, timestamp, size }));

		const liveLines = meaningfulLines(page.content ?? '');
		const skelLines = meaningfulLines(skeleton);
		const extraLines = lineResidue(liveLines, skelLines);
		const missingLines = lineResidue(skelLines, liveLines);

		// A human stripping lines the bot wrote (e.g. blanking a moved page) is
		// a curator decision even though nothing was added. Lines missing only
		// because the skeleton grew since the last bot edit don't count.
		let removedByHuman = false;
		if (extraLines.length === 0 && missingLines.length > 0 && lastEditor === 'human') {
			removedByHuman =
				lastBotIdx < 0 ||
				lineResidue(
					meaningfulLines(await fetchRevisionContent(history[lastBotIdx].revid)),
					liveLines
				).length > 0;
		}

		let verdict: Verdict;
		if (removedByHuman) verdict = 'curator-removed';
		else if (extraLines.length === 0) verdict = 'empty';
		else if (lastEditor === 'bot') verdict = 'old-bot-skeleton';
		else verdict = 'curator-content';

		results.push({
			pageTitle: title,
			verdict,
			lastEditor,
			extraLines,
			missingLines,
			humanRevisions: history.filter((r) => !isBot(r)).length,
			overwrittenHumanRevisions: overwritten
		});
	}

	const outPath = path.join(entityDir, 'empty-verification.json');
	fs.writeFileSync(outPath, JSON.stringify(results, null, '\t'));

	const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
	console.log(`  empty              ${count('empty')}`);
	console.log(`  old-bot-skeleton   ${count('old-bot-skeleton')}`);
	console.log(`  curator-content    ${count('curator-content')}`);
	console.log(`  curator-removed    ${count('curator-removed')}`);
	console.log(`  missing            ${count('missing')}`);
	console.log(`  no-skeleton        ${count('no-skeleton')}`);
	console.log(
		`  bot overwrote human edits in history: ${results.filter((r) => r.overwrittenHumanRevisions.length > 0).length}`
	);
	for (const r of results.filter((r) => r.verdict === 'curator-removed')) {
		console.log(`  ✗ ${r.pageTitle} (removed ${r.missingLines.length} bot line(s))`);
	}
	for (const r of results.filter((r) => r.verdict === 'curator-content')) {
		console.log(`  ✗ ${r.pageTitle}`);
		for (const l of r.extraLines.slice(0, 5)) console.log(`      + ${l.slice(0, 140)}`);
		if (r.extraLines.length > 5) console.log(`      … ${r.extraLines.length - 5} more`);
	}
	console.log(`  report             ${path.relative(root, outPath)}`);
	return results;
}

const { entity, all } = parseArgs();
const entities = all
	? fs
			.readdirSync(sourceDir)
			.filter((d) => fs.existsSync(path.join(sourceDir, d, 'upload-report.json')))
	: [entity!];

// old-bot-skeleton text is bot-authored, so it's as safe as empty.
let notEmpty = 0;
for (const e of entities) {
	const results = await verifyEntity(e);
	notEmpty += results.filter(
		(r) => r.verdict !== 'empty' && r.verdict !== 'old-bot-skeleton'
	).length;
}
process.exit(notEmpty > 0 ? 1 : 0);
