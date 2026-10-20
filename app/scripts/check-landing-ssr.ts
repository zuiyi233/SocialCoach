/** Run from app/ after `pnpm build`:
 *   npx tsx scripts/check-landing-ssr.ts
 *
 * Stage C exists so a crawler that never runs JavaScript can read the corpus.
 * `hydrated` starts false in the device store, and AppProviders used to render
 * nothing until it flips — which shipped an empty <body> for all 698 pages.
 * No earlier check looked at build output, so it passed with a green ✅.
 * This asserts both halves of the promise: the article is in the server HTML,
 * and the spoilers are not.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CASES, SCENARIOS, THEORIES } from "../src/data/corpus";
import { pick } from "../src/lib/i18n";
import type { Lang } from "../src/data/taxonomy";

const BUILD = ".next/server/app";
if (!existsSync(BUILD)) {
  console.error(`FAIL no build output at ${BUILD} — run \`pnpm build\` first`);
  process.exit(1);
}

/** React escapes text nodes (`You&#x27;re`) and the embedded flight payload
 * escapes quotes as `\"`; corpus strings are written unescaped. Both forms are
 * searched, otherwise an escaping difference could hide a real leak. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#x22;|&#34;|&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** What a no-JS crawler actually sees: HTML minus scripts, styles and tags. */
function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

const pages = new Map<string, string>();
for (const dir of ["scenarios", "library", "en/scenarios", "en/library"]) {
  const root = join(BUILD, dir);
  for (const file of htmlFiles(root)) {
    const slug = relative(root, file).slice(0, -".html".length);
    if (slug.includes("/")) continue; // prerendered fragments live in subdirectories
    pages.set(`${dir}/${slug}`, readFileSync(file, "utf8"));
  }
}
assert.equal(pages.size, 704, `expected 704 landing pages, found ${pages.size}`);

const langOf = (key: string): Lang => (key.startsWith("en/") ? "en" : "zh");
const MIN_BODY = 300;
const libraryCount = THEORIES.length + CASES.length;

/** Assert a built page renders the given corpus fragments without running JS. */
function visible(prefix: string, id: string, expect: string[], label: string): string {
  const html = pages.get(`${prefix}/${id}`);
  assert.ok(html, `${prefix}/${id} has no built page`);
  const text = visibleText(html);
  for (const fragment of expect) {
    assert.ok(
      text.includes(fragment),
      `${prefix}/${id}: ${label} missing from server HTML — ${JSON.stringify(text.slice(0, 120))}`,
    );
  }
  return text;
}

// Positive: every page carries its own article text in the server HTML. Cases
// are legitimately short, so this checks the actual fields, not an arbitrary
// length — the only floor is on scenarios, whose background and objectives must
// both be present.
for (const s of SCENARIOS) {
  for (const prefix of ["scenarios", "en/scenarios"]) {
    const lang = langOf(prefix);
    const text = visible(prefix, s.id, [pick(s.title, lang), pick(s.background, lang)], "background");
    assert.ok(text.length >= MIN_BODY, `${prefix}/${s.id}: only ${text.length} chars without JS`);
  }
}
for (const t of THEORIES) {
  for (const prefix of ["library", "en/library"]) {
    const lang = langOf(prefix);
    visible(prefix, t.id, [pick(t.title, lang), pick(t.principle, lang)], "principle");
  }
}
for (const c of CASES) {
  for (const prefix of ["library", "en/library"]) {
    const lang = langOf(prefix);
    visible(prefix, c.id, [pick(c.title, lang), pick(c.situation, lang), pick(c.takeaway, lang)], "takeaway");
  }
}
console.log(
  `PASS all ${SCENARIOS.length} scenarios and ${libraryCount} theory/case pages carry their own text with JS disabled`,
);

// Negative: private and outcome fields stay out of every page, including the
// RSC flight payload embedded in the same file.
const spoilerStrings = new Set<string>();
for (const s of SCENARIOS) {
  for (const value of [s.simulationFacts, s.simulationDirection, s.success, s.failure]) {
    if (!value) continue;
    for (const lang of ["zh", "en"] as Lang[]) spoilerStrings.add(pick(value, lang));
  }
  for (const c of s.characters) {
    if (!c.hidden) continue;
    for (const lang of ["zh", "en"] as Lang[]) spoilerStrings.add(pick(c.hidden, lang));
  }
}
const leaks: string[] = [];
for (const [key, html] of pages) {
  const haystack = `${html}\n${decodeEntities(html).replace(/\\(["'\\])/g, "$1")}`;
  for (const value of spoilerStrings) {
    const probe = value.length > 40 ? value.slice(0, 40) : value;
    if (haystack.includes(probe)) leaks.push(`${key} leaks ${JSON.stringify(probe.slice(0, 24))}`);
  }
}
assert.equal(leaks.length, 0, `spoiler fields reached the public page:\n${leaks.slice(0, 8).join("\n")}`);
console.log(`PASS none of ${spoilerStrings.size} spoiler strings appear in the ${pages.size} public pages`);

// The hydration gate still protects archive-backed pages: they must not paint
// content before `hydrated`, or a corrupted archive could flash real data.
for (const rel of ["index.html", "learn.html", "3d.html"]) {
  const html = readFileSync(join(BUILD, rel), "utf8");
  assert.ok(html.includes("min-h-dvh"), `${rel} lost its pre-hydration placeholder`);
  assert.ok(visibleText(html).length < MIN_BODY, `${rel} ships article text pre-hydration`);
}
console.log("PASS app pages keep the pre-hydration placeholder");

// Indexing plumbing is part of the same promise.
const sitemap = readFileSync(join(BUILD, "sitemap.xml.body"), "utf8");
assert.equal((sitemap.match(/<url>/g) || []).length, 709, "sitemap lost entries");
const robots = readFileSync(join(BUILD, "robots.txt.body"), "utf8");
assert.match(robots, /^Sitemap: https:\/\//m, "robots.txt lost its absolute Sitemap line");
assert.match(robots, /^Disallow: \/api\//m, "robots.txt no longer blocks /api/");
console.log("PASS sitemap 709 entries, robots.txt absolute Sitemap and /api/ disallow");
