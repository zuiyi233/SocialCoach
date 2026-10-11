import { SITE_URL } from "@/lib/site-url";

/**
 * Homepage structured data (wiki/12-stage-c.md, C4 — JSON-LD). Rendered into
 * the root layout body as two `<script type="application/ld+json">` blocks:
 * a SoftwareApplication card for the product and a ScholarlyArticle for the
 * arXiv paper the app is based on.
 */
const AUTHORS = [
  "Tianfu Wang",
  "Max Xiong",
  "Yuxuan Lei",
  "Jianxun Lian",
  "Hongyuan Zhu",
  "Zhengyu Hu",
  "Linxiao Gong",
  "Dapeng Hu",
  "Xiaofang Li",
  "Peiting Tsai",
  "Nicholas Jing Yuan",
  "Qi Zhang",
];

const softwareApplication = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "SocialCoach",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  description: "想说的话，说出来。",
  url: SITE_URL,
  inLanguage: ["zh-CN", "en"],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

const scholarlyArticle = {
  "@context": "https://schema.org",
  "@type": "ScholarlyArticle",
  headline: "SocialCoach: Personalized Social Skill Learning with Agentic Tutoring and Practice",
  author: AUTHORS.map((name) => ({ "@type": "Person", name })),
  datePublished: "2026-08-16",
  identifier: "arXiv:2606.04155",
  url: "https://arxiv.org/abs/2606.04155",
  publisher: { "@type": "Organization", name: "arXiv" },
};

export function SiteJsonLd() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(scholarlyArticle) }}
      />
    </>
  );
}