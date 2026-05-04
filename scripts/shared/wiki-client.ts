import ky from 'ky';
import fs from 'node:fs';
import path from 'node:path';

// Minimal cookie jar — Bun/undici don't persist cookies across fetch calls,
// so we capture Set-Cookie response headers and replay them on subsequent
// requests. Sufficient for a single-host MediaWiki session.
const cookieJar = new Map<string, string>();

function cookieHeader(): string {
	return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function captureSetCookie(res: Response): void {
	const raw = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
	for (const line of raw) {
		const [pair] = line.split(';');
		const eq = pair.indexOf('=');
		if (eq <= 0) continue;
		const name = pair.slice(0, eq).trim();
		const value = pair.slice(eq + 1).trim();
		cookieJar.set(name, value);
	}
}

const wikiApi = ky.create({
	prefixUrl: 'https://mycopunk.miraheze.org/w/',
	timeout: 30000,
	hooks: {
		beforeRequest: [
			(req) => {
				const ck = cookieHeader();
				if (ck) req.headers.set('cookie', ck);
			}
		],
		afterResponse: [
			(_req, _opts, res) => {
				captureSetCookie(res);
			}
		]
	}
});

export async function queryWikiApi<T>(params: Record<string, string>): Promise<T> {
	const searchParams = new URLSearchParams({ format: 'json', ...params });
	return wikiApi.get('api.php', { searchParams }).json<T>();
}

interface WikiQueryPagesResponse {
	query?: {
		pages: Record<
			string,
			{
				title?: string;
				missing?: boolean;
				revisions?: Array<{ slots?: { main?: { '*'?: string } } }>;
				imageinfo?: Array<{ sha1?: string }>;
			}
		>;
		normalized?: Array<{ from: string; to: string }>;
	};
}

export interface WikiPageContent {
	exists: boolean;
	content?: string;
}

// Fetch existence + content for a single wiki page by exact title (no
// suffix manipulation). Callers pass the full title they want to query.
export async function checkWikiPageExists(pageTitle: string): Promise<WikiPageContent> {
	const map = await fetchPagesContent([pageTitle]);
	return map.get(pageTitle) ?? { exists: false };
}

// Batched version. MediaWiki's `query` API accepts up to 50 titles per call;
// this chunks larger lists. Returns a `Map` keyed by the requested title
// (with normalization from MediaWiki resolved transparently — e.g. a
// submitted title `cannonball Upgrade` returned as `Cannonball Upgrade` is
// re-keyed back to the submitted form so the caller doesn't have to worry
// about MediaWiki's first-letter capitalization rules).
export async function fetchPagesContent(titles: string[]): Promise<Map<string, WikiPageContent>> {
	const out = new Map<string, WikiPageContent>();
	if (titles.length === 0) return out;

	for (let i = 0; i < titles.length; i += 50) {
		const chunk = titles.slice(i, i + 50);
		try {
			const data = await queryWikiApi<WikiQueryPagesResponse>({
				action: 'query',
				titles: chunk.join('|'),
				prop: 'revisions',
				rvprop: 'content',
				rvslots: 'main'
			});

			// Build a normalized→submitted lookup so we can map back to the
			// caller's title strings.
			const normalizedToSubmitted = new Map<string, string>();
			for (const sub of chunk) normalizedToSubmitted.set(sub, sub);
			for (const n of data.query?.normalized ?? []) {
				normalizedToSubmitted.set(n.to, n.from);
			}

			const pages = data.query?.pages ?? {};
			for (const [pageId, page] of Object.entries(pages)) {
				const responseTitle = page.title ?? '';
				const submittedTitle = normalizedToSubmitted.get(responseTitle) ?? responseTitle;
				const exists = !page.missing && parseInt(pageId) > 0;
				const content = page.revisions?.[0]?.slots?.main?.['*'];
				out.set(submittedTitle, {
					exists,
					content: exists ? (content ?? '') : undefined
				});
			}
		} catch (error) {
			console.error(`Error fetching pages [${chunk.slice(0, 3).join(', ')}…]:`, error);
			// Mark unfetched titles as not-exists so caller can decide how to
			// proceed (uploader treats this as "create").
			for (const t of chunk) if (!out.has(t)) out.set(t, { exists: false });
		}
	}

	return out;
}

export interface FileCheckResult {
	exists: boolean;
	sha1?: string;
}

interface TokensResponse {
	query?: { tokens?: Record<string, string> };
}

async function fetchToken(type: 'login' | 'csrf'): Promise<string> {
	const data = await queryWikiApi<TokensResponse>({ action: 'query', meta: 'tokens', type });
	const token = data.query?.tokens?.[`${type}token`];
	if (!token) throw new Error(`Failed to obtain ${type} token`);
	return token;
}

interface LoginResponse {
	login?: { result?: string; reason?: string };
	clientlogin?: { status?: string; message?: string };
}

let loggedIn = false;
let cachedCsrfToken: string | undefined;

// Resolve bot credentials, preferring real env vars (CI-friendly) and
// falling back to a `.local.env` file at the project root. The file is a
// minimal `KEY=VALUE` dotenv — no quote stripping, no interpolation, `#`
// for comments. Required keys: MYCOPUNK_BOT_USER (form: "User@botname"),
// MYCOPUNK_BOT_PASSWORD.
function readBotPassword(projectRoot: string): { user: string; password: string } {
	const fromEnv = (k: string) => (process.env[k] ?? '').trim() || undefined;
	let user = fromEnv('MYCOPUNK_BOT_USER');
	let password = fromEnv('MYCOPUNK_BOT_PASSWORD');

	if (!user || !password) {
		const file = path.join(projectRoot, '.local.env');
		if (fs.existsSync(file)) {
			for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#')) continue;
				const eq = trimmed.indexOf('=');
				if (eq < 0) continue;
				const key = trimmed.slice(0, eq).trim();
				const val = trimmed.slice(eq + 1).trim();
				if (key === 'MYCOPUNK_BOT_USER' && !user) user = val;
				else if (key === 'MYCOPUNK_BOT_PASSWORD' && !password) password = val;
			}
		}
	}

	if (!user || !password) {
		throw new Error(
			'Missing bot credentials. Set MYCOPUNK_BOT_USER and MYCOPUNK_BOT_PASSWORD ' +
				'as env vars, or create .local.env at the project root with those keys.'
		);
	}
	return { user, password };
}

export async function loginBot(projectRoot: string): Promise<void> {
	if (loggedIn) return;
	const { user, password } = readBotPassword(projectRoot);
	const lgtoken = await fetchToken('login');

	const body = new URLSearchParams({
		action: 'login',
		format: 'json',
		lgname: user,
		lgpassword: password,
		lgtoken
	});
	const res = await wikiApi.post('api.php', { body }).json<LoginResponse>();
	if (res.login?.result !== 'Success') {
		throw new Error(`Login failed: ${res.login?.result} ${res.login?.reason ?? ''}`);
	}
	loggedIn = true;
}

interface EditResponse {
	edit?: { result?: string; nochange?: boolean };
	error?: { code?: string; info?: string };
}

export async function editPage(title: string, content: string, summary: string): Promise<void> {
	if (!loggedIn) throw new Error('editPage called before loginBot');

	const attempt = async (token: string) => {
		const body = new URLSearchParams({
			action: 'edit',
			format: 'json',
			title,
			text: content,
			summary,
			bot: '1',
			token
		});
		return wikiApi.post('api.php', { body }).json<EditResponse>();
	};

	if (!cachedCsrfToken) cachedCsrfToken = await fetchToken('csrf');
	let res = await attempt(cachedCsrfToken);
	if (res.error?.code === 'badtoken') {
		cachedCsrfToken = await fetchToken('csrf');
		res = await attempt(cachedCsrfToken);
	}
	if (res.error) throw new Error(`${res.error.code}: ${res.error.info}`);
	if (res.edit?.result !== 'Success') {
		throw new Error(`Edit failed: ${JSON.stringify(res.edit)}`);
	}
}

interface UploadResponse {
	upload?: { result?: string; warnings?: Record<string, unknown> };
	error?: { code?: string; info?: string };
}

// MIME hint for the few file types we actually upload (icons + SVG patterns).
function mimeFor(filename: string): string {
	const ext = filename.toLowerCase().split('.').pop();
	if (ext === 'svg') return 'image/svg+xml';
	if (ext === 'png') return 'image/png';
	if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
	if (ext === 'webp') return 'image/webp';
	if (ext === 'gif') return 'image/gif';
	return 'application/octet-stream';
}

export async function uploadFile(
	localPath: string,
	targetFilename: string,
	comment: string,
	ignoreWarnings = false
): Promise<void> {
	if (!loggedIn) throw new Error('uploadFile called before loginBot');
	if (!cachedCsrfToken) cachedCsrfToken = await fetchToken('csrf');

	const buf = fs.readFileSync(localPath);
	const blob = new Blob([buf], { type: mimeFor(targetFilename) });

	const attempt = async (token: string) => {
		const form = new FormData();
		form.append('action', 'upload');
		form.append('format', 'json');
		form.append('filename', targetFilename);
		form.append('comment', comment);
		form.append('token', token);
		if (ignoreWarnings) form.append('ignorewarnings', '1');
		form.append('file', blob, targetFilename);
		return wikiApi.post('api.php', { body: form, timeout: 120_000 }).json<UploadResponse>();
	};

	let res = await attempt(cachedCsrfToken);
	if (res.error?.code === 'badtoken') {
		cachedCsrfToken = await fetchToken('csrf');
		res = await attempt(cachedCsrfToken);
	}
	if (res.error) throw new Error(`${res.error.code}: ${res.error.info}`);
	if (res.upload?.result !== 'Success') {
		throw new Error(`Upload failed: ${JSON.stringify(res.upload)}`);
	}
}

export async function checkFileExistsAndHash(filename: string): Promise<FileCheckResult> {
	try {
		const data = await queryWikiApi<WikiQueryPagesResponse>({
			action: 'query',
			titles: `File:${filename}`,
			prop: 'imageinfo',
			iiprop: 'url|sha1'
		});

		const pages = data.query?.pages;
		if (!pages) {
			return { exists: false };
		}

		const pageId = Object.keys(pages)[0];
		const page = pages[pageId];

		if (page.missing) {
			return { exists: false };
		}

		if (page.imageinfo && page.imageinfo.length > 0) {
			return {
				exists: true,
				sha1: page.imageinfo[0].sha1
			};
		}

		return { exists: false };
	} catch (error) {
		console.warn(`Error checking file existence and hash for ${filename}:`, error);
		return { exists: true };
	}
}
