<!-- Last verified: 2026-10-20 | Current stage: E -->

# 验收记录：恋爱 GALGAME 基本盘 + Rio 第 4 幕（2026-10-20）

规格：[spec-love-galgame-foundation.md](../specs/spec-love-galgame-foundation.md)、[spec-love-rio-route.md](../specs/spec-love-rio-route.md)。本记录只写实际跑过的证据与仍未销账的门禁；不把本地实现当线上发布。

## 1. 交付范围

- **E8 基本盘**：story slot（自动存档 / 刷新续玩 / 坏档保留 / 跨标签页 revision / 删除感知）、冻结快照回想 + 单句重播、按人物声线外部 TTS、`LovePlayRecord` 记录与统计正门、导出 / 恢复 / 擦除 / 重置收口。
- **引擎债**：G01–G05、G07–G16、G20–G23 本批处理；G06 只做 Rio 与通用回退；G17–G19、G24 明确留待下批。
- **E9 第 4 幕**：`RioRelationshipState` 与迁移、两结局纯函数、前 3 幕 `order` 与静态过去断言清理、第 4 幕开场变体、两组共 6 个作者拍点、`{rio, appliedBeats}` 快照、收束时 `routes` 提交。
- **未写**：第 5–6 幕、两结局的完整场景。按 spec 的硬闸门，先做 3–5 人试玩。

## 2. 自动化证据

| 命令 | 结果 |
|---|---|
| `pnpm check`（lint / typegen / tsc / retrieval / core / dinner） | 通过，core 308/308，dinner 257/257 |
| `pnpm build` | 通过；727 个静态页面生成 |
| `tsx scripts/check-corpus.ts` | 通过 |
| `tsx scripts/check-landing-ssr.ts` | 700 个公开页、1042 条剧透探针零泄漏、sitemap 705 |
| `tsx scripts/check-love-play-live.ts`（第 4 幕，6 回合） | 红线通过；标准 / 施压 / 追问 / 玩笑 / 修复 / 续聊可取；hidden 只在合法问题后出现；施压不让步。1 次可修复的 JSON 走有界修复，不计内容缺陷 |

## 3. 桌面浏览器实测（生产构建，localhost:3010，Chromium）

用固定存档 fixture 直接验证 UI；模型调用不参与以下断言。

- **续玩**：种入合法 save 后打开第 2 幕，显示「已回到上次停下的地方」、最后一句话与 2 个选项；未重新请求模型。
- **回想**：打开 sheet，出现标题、开场 / 最新跳转、逐句「重播这句」；转录按顺序；不含选项文本、结局文案。
- **坏档恢复**：story slot 写入 `{broken` 后打开本幕，出现「本幕进度无法读取」sheet（下载原件 / 清空并重新开始本幕 / 取消），**未自动开新局**，localStorage 原文仍是 `{broken`；点明确清空后才开始新局，slot 变为空。
- **删除感知**：播放中清空 story slot 并派发 storage 事件，出现「进度已在另一标签页被清空」，slot 没有被重建。
- **系列页坏进度**：series slot 写入 `{broken` 后进入 Rio 系列页，显示损坏提示；四幕仍可单独进入，CTA 正常。
- **第 4 幕拍点**：种入第 4 幕进行中存档后，显示组标题「先问她想要什么」与 3 条作者选项；点「如果我不在这里，你会怎么选？」后，自动存档里的 `appliedBeats=["ask-without-me"]`、`secondmentPreference="stay"`、`secondmentDisclosed=true`、冲突 `narrowed`、`lastAct=4`、`lastOutcome=success`。

浏览器实测时该生产进程的模型请求返回「暂时无法连接模型」；因此**浏览器内的真实生成未验证**，上面的 live 证据来自独立脚本。这是网关当时可达性问题，不是本轮 UI 断言的替代。

## 4. 未销账的门禁

- **3–5 人真人试玩**：未做。玩家说不出「哪一幕改变了第 4 幕的哪句 / 哪个选项」时，停止第 5–6 幕。
- **真机**：无实体 iPhone / Android，iOS Safari 手势解锁、麦克风授权与拒绝、开麦回声、长句分块断句均未实测；不得用模拟视口销账。
- **真实双标签页**：只做了单元层 revision/冲突与合成的 storage 删除事件；没有两台真实标签页互写回归。
- **冲突 UI 的两按钮**（载入最新 / 保留本页）：代码已接，但只在单元层覆盖写入冲突；浏览器未制造真实冲突。

## 5. 已知边界

- `ended-only` 存档没有 `endingKind` 字段，刷新后按 `partial` 文案显示（不会误显示为 success）。
- G06 仍只有 Rio 专属承接句；其余 NPC 共用通用回退。
- G17–G19、G24 未动，理由见 foundation spec §6。
