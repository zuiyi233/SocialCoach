# 恋爱检索排序基线（quality gate C）

> 记录日期：2026-10-09　|　脚本：`app/scripts/check-love-retrieval.ts`（已挂 `pnpm check` 回归链）
> 目的：确认 8 个 loveTopic 在复盘知识检索下的 top 2-3 排序对味，产出调优依据，防止后续语料批次把排序质量调坏。

## 一、方法

对每个 loveTopic 各跑一次 `retrieveKnowledge`（`context: romantic`，`acquisition: true`），模拟真实复盘调用：

- **query**：主题无关的学习者措辞——刻意不碰理论标题/关键词，让排序只能靠 skill 匹配与 loveTopic 加权（+3）区分，而不是词面命中。
- **skills**：该主题典型场景的主技能（取该主题现有场景的 skills 交集）。
- **得分构成**：脚本内复算 `skill(×2) + loveTopic(+3) + context(+0.5) + lexical(×3)` 四项分解，并用 `assert.deepEqual` 与 `retrieveKnowledge` 实际返回做一致性校验——报告与真实调用不同步即失败。

主题 probe 配置：

| topic | skills | query（主题无关） |
|---|---|---|
| approach | building-relationships, initiative | 认识了一个人，聊过几次，想继续了解，又怕太主动把人吓跑 |
| define-relationship | communication | 相处两个月了，我想知道我们到底算什么，又怕一开口就把气氛弄僵 |
| rejection | emotion-regulation, self-efficacy | 我把心里的话说出来了，对方的回应不是我想的，现在不知道怎么收场 |
| breakup | communication, emotion-regulation | 在一起很久了，感觉越来越远，我想结束，又舍不得 |
| boundary | standing-up, communication | 有些事我不想配合，又不想把关系搞僵，不知道怎么开口 |
| long-distance | communication, perspective-taking | 隔着很远，消息回复时快时慢，心里一直没底 |
| family | communication, social-norms | 见了对方家里人，饭桌上问了很多，我有点招架不住 |
| trust | communication, empathy | 发现对方瞒了我一些事，我不知道还能不能像以前一样相信 |

## 二、基线表（调优后，2026-10-09）

每行：rank / 理论 id（`*` = 本主题）；sc = skill + love + ctx + lex。

| topic | rank1 | rank2 | rank3 |
|---|---|---|---|
| approach | love-th-approachable-presence* 7.50 | love-th-identity-is-plastic* 5.60 | love-th-reciprocal-self-disclosure* 5.59 |
| define-relationship | love-th-define-relationship-not-pressure* 5.71 | love-th-modern-love-vocabulary* 5.58 | love-th-premarital-ten-topics* 5.54 |
| rejection | love-th-rejection-graceful-close* 7.69 | love-th-rejection-process-goal* 5.71 | love-theory-rejection* 5.61 |
| breakup | love-theory-closure* 5.54 | love-th-breakup-recovery* 5.50 | love-th-stop-ex-monitoring* 5.50 |
| boundary | love-th-manipulation-ethical-alternatives* 7.50 | love-th-consent-boundary-proportion* 7.50 | love-th-digital-control-redline* 5.59 |
| long-distance | love-th-ld-joint-arrangement* 7.55 | love-theory-long-distance* 5.58 | love-th-ld-presence-substitute* 5.55 |
| family | love-theory-family* 7.57 | love-th-inlaw-boundary-three-principles* 5.60 | love-th-exit-arrangements* 5.50 |
| trust | love-th-facts-interpretation-feelings-action* 5.61 | love-theory-responsiveness* 5.58 | love-th-apology-structure* 5.56 |

**结果：8/8 主题 top3 全部为本主题理论（3/3 命中）。** 验收线（≥6 主题 top3 有 ≥2 条实质相关）以 8/8 远超通过。

## 三、基线发现问题与调优

调优前（仅从索引可推）：
- **rejection**：全库仅 1 条 loveTopic 理论（love-theory-after-no），top2/3 被 trust（love-th-avoidant-side-guide）、breakup（love-th-breakup-decision）的 skill 命中条目占掉。
- **long-distance**：全库仅 1 条 loveTopic 理论（love-theory-long-distance），top2/3 被 approach 条目占掉。
- 其余 6 主题均有 ≥2 条本主题理论，排序正常。

**调优决定（已执行）**：
1. **补理论（映射表未提取条目）**，不动权重：
   - 新增 `love-theories-deep-rejection.ts` 3 条：`love-th-rejection-process-goal`（过程目标，knowledge-20 [过程目标]）、`love-th-rejection-graceful-close`（体面收尾，practical 主动表达/实战话术编排器）、`love-th-rejection-clear-no`（清楚拒绝不吊着，practical 高情商拒绝/场景感）。
   - 新增 `love-theories-deep-long-distance.ts` 2 条：`love-th-ld-joint-arrangement`（共同安排不数消息，practical 关系投入失衡）、`love-th-ld-presence-substitute`（不在场陪伴即小仪式，practical 情绪价值）。
   - 全部标 `Goutoujunshi skill (community practice)` 类源（无学术出处，符合「无出处不进理论层」边界的经验级例外），`context: romantic`。
2. **loveTopic 权重保持 +3**：调优后 8/8 主题 top3 无旁主题占位，不存在"同 skill 旁主题条目挤占"的分化不足，+3→+4 无必要，不引入回归风险。

## 四、回归保护

- `app/scripts/check-love-retrieval.ts` 含硬门禁：**每个 loveTopic 的 top3 必须出现至少 1 条本主题理论**，否则断言失败——锁住 loveTopic 加权不被未来批次破坏。
- 已挂入 `app/package.json` 的 `pnpm check` 链（`tsc --noEmit` 之后）：后续任何语料批次动理论/场景，`pnpm check` 即守护本轮排序质量。
- 恋爱理论数：121 → **126**（rejection 1→4，long-distance 1→3）。