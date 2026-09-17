"use client";
import type { Lang } from "@/data/taxonomy";
import type { LoveTopicId } from "@/data/corpus/love-topics";
import { LOVE_TOPICS } from "@/data/corpus/love-topics";

/** Love-topic proficiency bars, shared by the /love page and the Growth view. */
export function LoveProficiency({ love, lang }: { love: Partial<Record<LoveTopicId, number>>; lang: Lang }) {
  return (
    <div className="flex flex-col gap-3">
      {LOVE_TOPICS.map((top) => {
        const v = love[top.id] ?? 2.5;
        const pct = ((v - 1) / 4) * 100;
        return (
          <div key={top.id} className="flex items-center gap-3 text-[13px]">
            <span className="w-32 shrink-0 text-ink-2">{top.name[lang]}</span>
            <span
              className="flex-1 h-1.5 rounded-full bg-inset overflow-hidden"
              role="meter"
              aria-valuemin={1}
              aria-valuemax={5}
              aria-valuenow={Number(v.toFixed(1))}
              aria-label={`${top.name[lang]} ${v.toFixed(1)} / 5`}
            >
              <span aria-hidden className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-8 text-right num text-ink-3">{v.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}