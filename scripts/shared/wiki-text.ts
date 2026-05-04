// Generic MediaWiki text helpers, shared across entity generators and uploaders.

const WIKI_BASE_URL = 'https://mycopunk.miraheze.org/wiki/';

export function stripHtml(text: string | null | undefined): string {
	return (text ?? '').replace(/<[^>]+?>/g, '');
}

// Escapes wiki-syntax metacharacters and strips HTML/Unity rich-text tags so
// the result is safe to paste anywhere wikitext is rendered. Also unescapes
// the `\"` / `\\` sequences some game-data names carry from C# source.
export function escapeWikiText(text: string): string {
	return text
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\')
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;')
		.replace(/\|/g, '&#124;')
		.replace(/\[/g, '&#91;')
		.replace(/\]/g, '&#93;')
		.replace(/<[^>]+?>/g, '');
}

// MediaWiki collapses consecutive underscores/whitespace, strips leading/trailing
// underscores, and capitalizes the first character of every page/file title. We
// pre-apply those rules so on-disk filenames match what the wiki saves them as.
export function normalizeWikiTitle(s: string): string {
	let out = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
	if (out.length > 0) out = out[0].toUpperCase() + out.slice(1);
	return out;
}

export function sanitizeAPIName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function pageTitleToUrl(pageTitle: string): string {
	return WIKI_BASE_URL + encodeURIComponent(pageTitle.replace(/ /g, '_'));
}

// Newline-normalize for byte-identical comparisons against MediaWiki content.
export function normalizeContent(content: string): string {
	return content.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Convert Unity rich-text in a description to wikitext.
// `<link=acid><color=#91E915>corrodes</color></link>` → `[[Acid|corrodes]]`.
// Bare `<color=...>...</color>` wrappers have the color stripped (wiki uses
// templates for that). Anything left as raw HTML goes through `stripHtml`.
export function descriptionToWiki(raw: string | undefined): string {
	if (!raw) return '';
	let out = raw;
	out = out.replace(
		/<link=([^>]+)>(?:<color=[^>]+>)?(.*?)(?:<\/color>)?<\/link>/g,
		(_m, target: string, text: string) => {
			const titleCase = target.charAt(0).toUpperCase() + target.slice(1);
			return `[[${titleCase}|${text}]]`;
		}
	);
	out = out.replace(/<color=[^>]+>(.*?)<\/color>/g, '$1');
	return stripHtml(out).replace(/\s+/g, ' ').trim();
}
