<!-- Last verified: 2026-10-12 | Current stage: E -->

# Stage C — 可索引化与 GEO

> 2026-10-12：C1–C6 已全部实现并通过运行时验收——349 条语料 × 中英 = 698 张落地页 SSG、sitemap 703 条、动态中文 OG、首页与每页 JSON-LD、llms.txt、hreflang 互指。官网 `site/` 的五个双语预览页并存，语料页 canonical 指向自身。下文原始方案保留作决策记录。
>
> **验收范围只到本地**：这一批在 `pnpm build` 的路由表与构建产物抽查上通过，但线上直连域名 `socialcoach-ai.vercel.app` 实测 `/robots.txt`、`/sitemap.xml`、`/scenarios/refuse-overtime` 均 404（旧构建）。生产发布走 `upstream/main`，本线只推 `origin` 二开分支，所以「爬虫真的读到 698 页」这条还没成立——发布后要按 [roadmap 的发布边界](./01-project-roadmap.md#里程碑) 重新 `curl` 一遍才算收口。
>
> **2026-10-12 复核实测：原来的「运行时验收」漏掉了正文。** 把产物 HTML 去掉 `<script>` 后只剩 9 个字符——`AppProviders` 在 `hydrated` 为假时渲染占位 `div` 而非 `children`，而 `hydrated` 初值是 false，于是 SSG 把**空壳**预渲染了 698 份，head 里的 title / canonical / hreflang / JSON-LD 全对，正文只在 flight payload 里，不执行 JS 的爬虫读不到。已修：`corpusLanding` 路由直接渲染 `children`，档案相关页面闸门保持不变。新增 `app/scripts/check-landing-ssr.ts` 并接在 CI 的 `pnpm build` 之后，实测结果：**698 页**（`scenarios` 142 + `library` 207 + `/en` 两份）逐页含自己的标题与背景 / 原则 / 结论，**1034 条**剧透串（`hidden` / `success` / `failure` / `simulationFacts` / `simulationDirection` 的 zh+en）零出现，应用页仍保留占位，sitemap **703** 条 `<url>`、robots 含绝对 Sitemap 与 `Disallow: /api/`。现象与教训见 [80-known-pitfalls](./80-known-pitfalls.md#hydration-闸门把-ssg-的正文吃掉了)。

## 问题陈述

**官网已有可索引入口，应用内语料仍缺可索引页面。** `site/` 的中英首页及五对场景预览页已提供正文、canonical、hreflang、sitemap、OG 图；首页另有论文与产品结构化数据。2026-09-23 补充了 AI 社交技能练习与 SEL 的准确说明。以下缺口限定于 `app/`：

```
8 / 8 页面路由全是 "use client"      爬虫拿到的是空壳
零 generateMetadata                  所有页面共用同一个 title
缺 sitemap.ts  robots.ts  metadataBase
app/ 缺 OG 图  JSON-LD  hreflang(zh/en)
```

应用首页依赖客户端状态，原始 HTML 缺少可读正文。不同爬虫对 JavaScript 的处理不同，因此不能把应用内交互页当作稳定的内容入口；官网目前承担产品与论文的公开介绍，C 阶段再让语料页可直接读取。

## 两张未启用的资产

| 资产 | 内容 |
|---|---|
| **语料 = 698 个现成落地页** | `src/data/corpus/` 里 349 条内容（142 场景 + 168 理论 + 39 案例，按 `corpus/index.ts` 实测；旧稿的 118 / 46+42+30 已经落后于两次 practical 批次）× 中英。场景标题本身就是高意图长尾搜索词（「如何跟老板谈加薪」、「how to decline extra work」），**搜这些词的人和晚上 11 点打开 App 的人是同一批**（A 类客户）。内容已写完，只是索引不到 |
| **论文 = 可核验的研究来源** | 当前是 arXiv 预印本，官网已链接原文并提供 `ScholarlyArticle`、`SoftwareApplication` 结构化数据与 `llms.txt`。这些有助于机器理解产品与论文的关系，但不能保证搜索排名或 AI 引用 |

## 功能汇总

| # | 功能 | 状态 | 备注 |
|---|---|---|---|
| C1 | 语料落地页 SSG（698 页） | ✅ 2026-10-12 | `/scenarios/[slug]` ×142、`/library/[slug]` ×207（理论+案例），英文在 `/en/...`；slug=语料 id（349 条无冲突）；渲染组件在 `components/corpus/`（ArticleShell/ScenarioArticle/LibraryArticle），中英路由共用；剧透字段（hidden/success/failure/simulationFacts）硬性不渲染，构建后 grep 抽查无泄露 |
| C2 | `sitemap.ts` / `robots.ts` / `metadataBase` | ✅ 2026-10-12 | sitemap 703 条（5 入口 + 349×2，alternates.languages 互指）；robots/metadataBase 沿用 10-10 地基 |
| C3 | 动态 OG 图 | ✅ 2026-10-12 | `/og/[kind]/[slug]/route.tsx`（next/og，nodejs）：中文走 Google Fonts Noto Sans SC 按需子集（`lib/og-font.ts`），色板为 globals.css OKLCH 换算 hex；1200×630 实测 49KB，未知 slug 404。坑：Satori 要求 div 多子节点必须显式 flex |
| C4 | JSON-LD 结构化数据 | ✅ 2026-10-12 | 首页 `SiteJsonLd`（SoftwareApplication + ScholarlyArticle arXiv:2606.04155）；每张语料页内嵌各自 JSON-LD（citation 指向 theory source） |
| C5 | `llms.txt` | ✅ 2026-10-12 | `app/public/llms.txt`（53KB：定位/论文/边界/全部语料 URL）；生成脚本 `scripts/gen-llms-txt.ts`，语料更新后重跑 |
| C6 | hreflang（zh / en） | ✅ 2026-10-12 | 中文在根 + `/en/` 前缀（与官网同构）；每页 metadata alternates + sitemap alternates.languages；x-default 指中文 |

---

## C1: 语料落地页

### 边界

**只把语料变成可索引页面，不动练习流程。** `/practice/[id]`、`/arena`、`/progress` 等交互页保持 `use client`——它们依赖 localStorage，本来也不该被索引。

### 地基（2026-10-10 已落地）

`app/src/lib/site-url.ts` 定义 `SITE_URL`（`NEXT_PUBLIC_SITE_URL` 可覆盖，默认 Vercel 直连域名；地域分流短域名会丢子路径，不能当规范地址）；根 layout 加 `metadataBase`；`app/robots.ts` 放行公开页并禁止 `/api/`、`/practice/`、`/progress`、`/settings`、`/rehearse`、`/onboarding`；`app/sitemap.ts` 先列 `/`、`/arena`、`/love`、`/learn`、`/3d` 五条。逐页 canonical 与 hreflang 留到落地页那轮：`/arena`、`/love`、`/learn` 都是 `use client`，导出不了 `metadata`，需要先拆出 server component 壳。`llms.txt`（C5）也留到那时一起做，避免在没有语料 URL 时先写一份要马上过期的索引。

### 待定的关键决策

| 决策点 | 待定 | 说明 |
|---|---|---|
| 路由形态 | `/scenarios/[slug]` + `/library/[slug]`？还是统一 `/s/[slug]`？ | slug 影响 URL 永久性，改一次就丢外链 |
| i18n 路由 | `/[lang]/...` 前缀，还是 `/en/...` + 中文在根？ | 决定 hreflang 怎么写；中文是主语言（`<html lang="zh-CN">`） |
| 与 `/learn` 的关系 | 新落地页替代 `/learn`，还是并存（`/learn` 为登录态浏览器） | 并存会有重复内容风险，需要 canonical |
| 页面上的 CTA | 落地页读者是搜索来的陌生人，主动作应是「练这一场」还是「先读」 | 决定转化路径 |

### 验收标准

- `curl` 一个落地页，`<body>` 里能看到场景标题、背景、目标——**不执行 JS 的前提下**
- 每页有独立 `title` / `description` / canonical / hreflang
- `sitemap.xml` 列出全部 698 页
- 已练过的场景不在落地页泄露用户数据（落地页不读 localStorage）

### 受影响文件（预估）

| 文件 | 改动 |
|---|---|
| `app/src/app/scenarios/[slug]/page.tsx` | 新增，server component + `generateStaticParams` |
| `app/src/app/library/[slug]/page.tsx` | 新增 |
| `app/src/app/sitemap.ts` · `robots.ts` | 新增 |
| `app/src/app/layout.tsx` | 加 `metadataBase`；`description` 已是定稿文案 |
| `app/src/data/corpus/index.ts` | 可能需要导出 slug 映射 |

---

## C4: JSON-LD

| 类型 | 挂在哪 | 关键字段 |
|---|---|---|
| `SoftwareApplication` | 首页 | `name` `applicationCategory` `operatingSystem` `offers` `description`（用定稿主句） |
| `ScholarlyArticle` | `Research` 落地页 / 首页 | `headline` `author`（12 位）`identifier: arXiv:2606.04155` `datePublished: 2026-08-16` |
| `HowTo` 或 `Article` | 每个场景落地页 | 场景标题 + 目标 + 策略；`citation` 指向对应 `Theory.source` |

**每条理论 / 案例都有 `source`（书名 + 作者），这是可以直接映射成 `citation` 的**——多数内容站没有这个。

## C5: `llms.txt`

放 `app/public/llms.txt`。内容：产品一句话定位、论文引用、语料索引（分类 + 落地页 URL 列表）、明确的使用边界（不做临床评估）。目的是让 LLM 在不爬全站的情况下拿到准确摘要。

---

## 前置依赖

C 阶段开工前需要 Stage B 收口：**必须先有线上地址**（`metadataBase`、canonical、sitemap 都要绝对 URL），且 `socialcoach.vercel.app` 已被占用。→ [80-known-pitfalls.md](./80-known-pitfalls.md#部署)

## 遗留讨论

用户 2026-09-03 表示正在另一个 session 专门构建 GEO / SEO / marketing 的可复用 skill（`~/.claude/skills/` 下已有 `geo-optimizer`、`seo-optimizer`、`launch-marketer` 等）。**本阶段开工前先看那些 skill**，避免两边重复决策。
