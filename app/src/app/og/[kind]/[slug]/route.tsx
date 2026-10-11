import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { SCENARIOS, THEORIES, CASES } from "@/data/corpus/index";
import { SITE_URL } from "@/lib/site-url";
import { loadNotoSansSC } from "@/lib/og-font";

/**
 * Dynamic 1200×630 Open Graph share image: /og/{kind}/{slug}.
 *
 * kind ∈ { scenario, theory, case }, slug = corpus item id (see C3 in
 * wiki/12-stage-c.md). Landing pages reference this route from their
 * metadata (`/og/...`), so a working route here is a hard requirement.
 * Unknown kind or slug returns 404.
 *
 * The image is a restrained "warm paper" share card: eyebrow label + big
 * Chinese title + English subtitle + wordmark. It intentionally matches the
 * app's design tokens and the paper tone of docs/banner.svg.
 */

/**
 * ISR rather than force-dynamic: the first crawler to ask pays the one-time
 * font-subset fetch (~1-2s), then the rendered card is cached at the edge for
 * a day. Corpus content is static per build, so a stale image is not a real
 * risk; the window only bounds how fast a redeploy's changed titles appear.
 */
export const revalidate = 86400;
export const runtime = "nodejs";

/**
 * Palette derived from app/src/app/globals.css `:root` OKLCH tokens (light
 * theme, the shared default). Hex obtained with the same OKLCH→sRGB math as
 * site/design-tokens.mjs hexToken(). CSS variables do not exist inside
 * `next/og` images, so these are baked-in values with their source noted.
 */
const PALETTE = {
  paper: "#fcf9f5", // --paper  oklch(0.984 0.006 84)
  line: "#ded8d1", // --line   oklch(0.885 0.012 75)
  ink: "#221d18", // --ink    oklch(0.235 0.012 65)
  ink2: "#50453d", // --ink-2  oklch(0.4 0.02 60)
  ink3: "#71675f", // --ink-3  oklch(0.52 0.018 62)
  accent: "#9e6538", // --accent oklch(0.56 0.095 58)
} as const;

/** Content-type labels match the app's own library tabs (src/lib/i18n.ts). */
const KIND_META = {
  scenario: { zh: "场景", en: "SCENARIO", lookup: (id: string) => SCENARIOS.find((s) => s.id === id) },
  theory: { zh: "理论", en: "THEORY", lookup: (id: string) => THEORIES.find((t) => t.id === id) },
  case: { zh: "案例", en: "CASE", lookup: (id: string) => CASES.find((c) => c.id === id) },
} as const;
type Kind = keyof typeof KIND_META;
type Entry = {
  title: { zh: string; en: string };
};

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;
const PADDING = 72;
const FONT_NAME = "Noto Sans SC";

const WORDMARK = "SocialCoach";
const TAGLINE_ZH = "想说的话，说出来。";
const HOST = new URL(SITE_URL).host;

/** Big title size shrinks as the title grows so long corpus titles still fit. */
function zhTitleSize(zh: string): number {
  const n = Array.from(zh).length;
  if (n <= 10) return 72;
  if (n <= 18) return 58;
  if (n <= 30) return 48;
  return 40;
}

/** Unit size for the English subtitle line. */
function enTitleSize(en: string): number {
  return en.length > 64 ? 28 : 32;
}

function Wordmark() {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          backgroundColor: PALETTE.accent,
          marginRight: 12,
        }}
      />
      <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "0.05em", color: PALETTE.ink }}>{WORDMARK}</div>
    </div>
  );
}

function FooterRow() {
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontSize: 21, color: PALETTE.ink2, letterSpacing: "0.02em" }}>{HOST}</div>
      <div style={{ fontSize: 20, color: PALETTE.ink3 }}>{TAGLINE_ZH}</div>
    </div>
  );
}

/**
 * The CJK share card: eyebrow + Chinese title (big) + English subtitle,
 * on the paper ground with a hairline. Only reached when a Chinese-capable
 * font subset actually loaded.
 */
function ChineseCard({ kind, entry }: { kind: Kind; entry: Entry }) {
  const kindMeta = KIND_META[kind];
  const zh = entry.title.zh;
  const en = entry.title.en;
  return (
    <div
      style={{
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        backgroundColor: PALETTE.paper,
        color: PALETTE.ink,
        fontFamily: FONT_NAME,
        display: "flex",
        flexDirection: "column",
        padding: PADDING,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark />
        <div style={{ fontSize: 21, fontWeight: 500, letterSpacing: "0.16em", color: PALETTE.accent }}>
          {`${kindMeta.en} · ${kindMeta.zh}`}
        </div>
      </div>
      <div style={{ height: 2, backgroundColor: PALETTE.line, marginTop: 28 }} />
      <div
        style={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          maxWidth: IMAGE_WIDTH - PADDING * 2,
        }}
      >
        <div style={{ fontSize: zhTitleSize(zh), fontWeight: 600, lineHeight: 1.25, letterSpacing: "-0.01em" }}>
          {zh}
        </div>
        <div style={{ marginTop: 20, fontSize: enTitleSize(en), fontWeight: 500, lineHeight: 1.4, color: PALETTE.ink2 }}>
          {en}
        </div>
      </div>
      <FooterRow />
    </div>
  );
}

/**
 * Latin-only fallback share card, used only when the CJK font subset could
 * not be fetched (offline, upstream blocked). Relies on ImageResponse's
 * bundled Latin font, so the card stays informative instead of tofu.
 */
function LatinOnlyCard({ kind, entry }: { kind: Kind; entry: Entry }) {
  const kindMeta = KIND_META[kind];
  return (
    <div
      style={{
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        backgroundColor: PALETTE.paper,
        color: PALETTE.ink,
        display: "flex",
        flexDirection: "column",
        padding: PADDING,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark />
        <div style={{ fontSize: 21, fontWeight: 500, letterSpacing: "0.16em", color: PALETTE.accent }}>
          {kindMeta.en}
        </div>
      </div>
      <div style={{ height: 2, backgroundColor: PALETTE.line, marginTop: 28 }} />
      <div
        style={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          maxWidth: IMAGE_WIDTH - PADDING * 2,
        }}
      >
        <div style={{ fontSize: enTitleSize(entry.title.en), fontWeight: 600, lineHeight: 1.25 }}>
          {entry.title.en}
        </div>
        <div style={{ marginTop: 20, fontSize: 20, color: PALETTE.ink3 }}>An AI social-skills practice from SocialCoach</div>
      </div>
      <FooterRow />
    </div>
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; slug: string }> },
): Promise<Response> {
  const { kind, slug } = await params;
  if (!(kind in KIND_META)) notFound();
  const meta = KIND_META[kind as Kind];
  const entry = meta.lookup(slug);
  if (!entry) notFound();

  // Characters this card actually renders: wordmark, kind label, bilingual
  // title, host and tagline — the exact set the font subset must contain.
  const text =
    WORDMARK +
    meta.en +
    meta.zh +
    entry.title.zh +
    entry.title.en +
    HOST +
    TAGLINE_ZH;

  const [f600, f500] = await Promise.all([
    loadNotoSansSC(text, 600),
    loadNotoSansSC(text, 500),
  ]);

  const hasCjk = f600 !== null || f500 !== null;
  type OgFont = { name: string; data: ArrayBuffer; weight: 500 | 600; style: "normal" };
  const fonts: OgFont[] = hasCjk
    ? [
        f600
          ? { name: FONT_NAME, data: f600, weight: 600, style: "normal" }
          : { name: FONT_NAME, data: f500 as ArrayBuffer, weight: 600, style: "normal" },
        f500
          ? { name: FONT_NAME, data: f500, weight: 500, style: "normal" }
          : { name: FONT_NAME, data: f600 as ArrayBuffer, weight: 500, style: "normal" },
      ]
    : [];

  return new ImageResponse(
    hasCjk ? ChineseCard({ kind: kind as Kind, entry }) : LatinOnlyCard({ kind: kind as Kind, entry }),
    {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      fonts,
    },
  );
}