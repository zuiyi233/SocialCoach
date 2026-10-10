import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

/**
 * 现阶段可索引的公开页。语料落地页（Stage C 的正文）接进来之前，练习流程页与
 * 设备数据页都不列在这里——它们没有可被抓取的内容，也不该被索引。
 */
const PUBLIC_PATHS = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/arena", changeFrequency: "weekly", priority: 0.9 },
  { path: "/love", changeFrequency: "weekly", priority: 0.8 },
  { path: "/learn", changeFrequency: "monthly", priority: 0.7 },
  { path: "/3d", changeFrequency: "monthly", priority: 0.7 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PATHS.map((p) => ({
    url: `${SITE_URL}${p.path === "/" ? "" : p.path}`,
    lastModified,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
