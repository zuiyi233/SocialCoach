/**
 * On-demand Noto Sans SC subsets for the /og share images.
 *
 * `next/og` (ImageResponse / Satori) only ships a Latin font, so Chinese
 * corpus titles would render as tofu boxes. Instead of committing a multi-MB
 * CJK font, each request loads a tiny subset that contains exactly the glyphs
 * of that request (Google Fonts `text=` subsetting), then caches it for the
 * process lifetime. FYI: Google's default css2 endpoint only serves WOFF2,
 * which Satori cannot parse — the legacy css endpoint returns plain WOFF for
 * this user agent, which ImageResponse does support (see image-response.md:
 * "Only ttf, otf, and woff font formats are supported").
 *
 * Fetch failure returns null and the caller falls back to a Latin-only
 * layout; the image still renders, it just does not contain CJK glyphs.
 */

const FONT_CACHE = new Map<string, ArrayBuffer>();

/** Legacy css endpoint; this UA receives `format('woff')` instead of woff2. */
const WOFF_USER_AGENT =
  "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)";

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: { "user-agent": WOFF_USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a WOFF containing exactly the glyphs in `text` (plus a small
 * reserved ASCII set Google always includes), or null on any failure.
 */
export async function loadNotoSansSC(
  text: string,
  weight: 500 | 600,
): Promise<ArrayBuffer | null> {
  const glyphs = Array.from(new Set(text)).sort().join("");
  const key = `${weight}:${glyphs}`;
  const cached = FONT_CACHE.get(key);
  if (cached) return cached;

  try {
    const cssUrl =
      `https://fonts.googleapis.com/css?family=Noto+Sans+SC:${weight}` +
      `&text=${encodeURIComponent(glyphs)}`;
    const cssRes = await fetchWithTimeout(cssUrl, 8_000);
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const fontUrl = css.match(/src:\s*url\(([^)]+)\)\s*format\('woff'\)/i)?.[1];
    if (!fontUrl) return null;

    const fontRes = await fetchWithTimeout(fontUrl, 12_000);
    if (!fontRes.ok) return null;
    const data = await fontRes.arrayBuffer();
    if (data.byteLength === 0) return null;

    FONT_CACHE.set(key, data);
    return data;
  } catch {
    return null;
  }
}