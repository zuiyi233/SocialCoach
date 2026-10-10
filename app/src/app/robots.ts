import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// 练习数据只在设备上：这些路径要么是个地区，要么是服务端接口，抓到了也没有内容。
const DISALLOW = ["/api/", "/practice/", "/progress", "/settings", "/rehearse", "/onboarding"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOW },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
