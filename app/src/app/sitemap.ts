import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";
import { CASES, SCENARIOS, THEORIES } from "@/data/corpus";
import { corpusUrl } from "@/lib/corpus";

/**
 * 可索引公开页：5 条既有入口 + 349 条语料 × 中英两 URL（698 页，合计 703 条）。
 * 语料页带 alternates.languages 的 hreflang 互指（zh 中文 / en /en/ / x-default 中文）。
 * 练习流程页与设备数据页仍不列——没有可抓取内容，见 robots.ts。
 */
const PUBLIC_PATHS = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/arena", changeFrequency: "weekly", priority: 0.9 },
  { path: "/love", changeFrequency: "weekly", priority: 0.8 },
  { path: "/learn", changeFrequency: "monthly", priority: 0.7 },
  { path: "/3d", changeFrequency: "monthly", priority: 0.7 },
] as const;

type CorpusEntry = { kind: "scenario" | "theory" | "case"; slug: string };

const CORPUS_ROUTES: CorpusEntry[] = [
  ...SCENARIOS.map((scenario) => ({ kind: "scenario" as const, slug: scenario.id })),
  ...THEORIES.map((theory) => ({ kind: "theory" as const, slug: theory.id })),
  ...CASES.map((caseItem) => ({ kind: "case" as const, slug: caseItem.id })),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = PUBLIC_PATHS.map((p) => ({
    url: `${SITE_URL}${p.path === "/" ? "" : p.path}`,
    lastModified,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  const corpusEntries: MetadataRoute.Sitemap = CORPUS_ROUTES.flatMap((entry) => {
    const zh = corpusUrl("zh", entry.kind, entry.slug);
    const en = corpusUrl("en", entry.kind, entry.slug);
    const languages = { zh, en, "x-default": zh };
    const shared = {
      lastModified,
      changeFrequency: "monthly" as const,
      // 场景本身就是搜索长尾词，优先级略高于理论/案例。
      priority: entry.kind === "scenario" ? 0.7 : 0.6,
    };
    return [
      { url: zh, ...shared, alternates: { languages } },
      { url: en, ...shared, alternates: { languages } },
    ];
  });

  return [...staticEntries, ...corpusEntries];
}