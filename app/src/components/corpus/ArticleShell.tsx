import type { ReactNode } from "react";
import Link from "next/link";
import type { L, Lang, SkillId } from "@/data/taxonomy";
import { SkillTag } from "@/components/SkillBits";

/* ── 落地页 UI 文案（双语；read-only server 渲染，不读 localStorage）── */
const COPY = {
  brand: { zh: "SocialCoach", en: "SocialCoach" },
  brand_home: { zh: "回到首页", en: "Back to home" },
  cta: { zh: "开始练习", en: "Start practicing" },
  cta_sub: {
    zh: "读到这里只完成了一半——真正难的是开口说出来。去练习里试一遍，拿到引用你原话的复盘。",
    en: "Reading is only half of it; saying it is the hard part. Try the practice and get a debrief that quotes your own words.",
  },
} satisfies Record<string, L>;

export const PICK = (v: L, lang: Lang) => v[lang];

/**
 * 语料落地页公共外壳：品牌条 + 文章头 + 正文 + 底部 CTA。
 * 页面级通用文案与结构都收敛在这里，中文与英文路由共用。
 */
export function ArticleShell({
  lang,
  eyebrow,
  title,
  lead,
  meta,
  children,
}: {
  lang: Lang;
  eyebrow?: ReactNode;
  title: string;
  lead?: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="app-page px-5 md:px-8 lg:px-10 pt-5 pb-safe flex flex-col gap-7 lg:gap-9">
      <nav aria-label={PICK(COPY.brand_home, lang)}>
        <Link href="/" className="press -ml-1 inline-flex items-center gap-1.5 min-h-9 px-1 rounded-full">
          <span className="display text-[16px] leading-none tracking-tight">{PICK(COPY.brand, lang)}</span>
        </Link>
      </nav>
      <div className="max-w-[var(--measure)] mx-auto w-full flex flex-col gap-8 lg:gap-10">
        <header className="flex flex-col gap-3">
          {eyebrow && <div className="flex flex-wrap items-center gap-2">{eyebrow}</div>}
          <h1 className="display text-[clamp(30px, 3vw, 42px)] leading-[1.14] tracking-tight">{title}</h1>
          {meta && <div className="flex flex-wrap items-center gap-1.5 mt-0.5">{meta}</div>}
          {lead && <p className="text-[15px] lg:text-[16.5px] text-ink-2 leading-[1.75] mt-1">{lead}</p>}
        </header>
        <div className="flex flex-col gap-8">{children}</div>
        <footer className="dotted pt-7 flex flex-col items-start gap-3">
          <p className="text-[13px] text-ink-3 leading-relaxed max-w-[46ch]">{PICK(COPY.cta_sub, lang)}</p>
          <a
            href="/arena"
            className="app-button press inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] min-h-14 px-7 text-[15px] font-semibold bg-action text-accent-ink hover:bg-action-hover"
          >
            {PICK(COPY.cta, lang)}
            <span aria-hidden>→</span>
          </a>
        </footer>
      </div>
    </main>
  );
}

/** 文章内小节标题：短横线 + 标题，符号式分层，不喧宾不压正文。 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2.5 text-[13px] font-semibold tracking-wide text-ink-2">
        <span aria-hidden className="h-px w-6 bg-line-strong shrink-0" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 胶囊信息片（背景/上下文/时长/难度共用）。 */
export function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="h-7 px-2.5 inline-flex items-center rounded-full bg-inset text-[12px] font-medium text-ink-3">
      {children}
    </span>
  );
}

/** 技能标签行（复用 SkillTag，色值与体系一致）。 */
export function SkillRow({ ids, lang }: { ids: SkillId[]; lang: Lang }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="skills">
      {ids.map((id) => (
        <SkillTag key={id} id={id} lang={lang} />
      ))}
    </div>
  );
}

/** JSON-LD 结构化数据；转义 `<` 防止语料文本闭合 script。 */
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}