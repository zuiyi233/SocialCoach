# NOTICE — SocialCoach · Love Studio

本目录(`love-studio/`)是 **AnimaVN** 的一个 fork,用作 SocialCoach 恋爱子系统的生成式
Galgame 沙盒(Love Studio)。本文件记录它的来源、授权,以及本 fork 相对上游移除了什么。

## 上游来源(provenance)

- 上游仓库:`JayziLi/AnimaVN-public`(公开仓库)。
- 快照时间:**2026-10-18**;快照里**不含** `.git`(没有提交历史可追)。
- 快照身份指纹(可复现):对 `frontend/src` + `AnimaBackend/app` 求
  「排序后的 `相对路径<TAB>字节数` 清单」的 sha256 —
  **460 个文件**,sha256 =
  `9e5c02e5471e179dda708d94fef3cb37f8f5ec6313fad260f7eb64f25d416426`。
  复现方式(POSIX):

  ```sh
  find frontend/src AnimaBackend/app -type f -printf '%P\t%s\n' 2>/dev/null \
    | LC_ALL=C sort | sha256sum
  ```

  注:若要严格复刻,须在上游快照的同样两棵目录下跑,并按 `path<TAB>size` 规范化(路径相对
  各自目录根、Windows 换行不参与 —— 清单只拼路径与字节数)。本 fork 落地后又改过若干文件,
  指纹对应的是**上游快照原始状态**,不是本 fork 现状。

## 授权(Licensing)

- 上游代码以 **MIT License** 授权,版权归 **Copyright (c) 2026 JayziLi**。许可证全文见
  同目录 [`LICENSE`](./LICENSE),所有上游源文件里的 MIT 版权头**原样保留**。
- 本项目对上游代码的修改同样以 MIT 授权,并保留上游版权声明。
- fork 自带素材的各自授权见 [frontend/public/vn/CREDITS.txt](./frontend/public/vn/CREDITS.txt)
  与各 `seed_data/` 角色目录里的 `CREDITS.txt`。**不随本仓库分发**任何第三方非自由授权素材。

## 本 fork 移除的内容(不外发)

1. **上游自带角色「DeepSeek娘」立绘/角色卡** — 授权为 **CC BY-NC-SA**(不可商用,不在
   MIT 范围内)。本 fork **已删除** `AnimaBackend/app/seed_data/deepseek-chan/`,不再分发。
   种子机制改为扫描 `seed_data/` 下含 `card.json` 的子目录;该目录缺席时安静跳过,应用照常
   启动(见 `AnimaBackend/app/seed.py`)。
2. **《碧蓝档案》(Blue Archive)音效** — `frontend/public/vn/sfx/` 下的
   `emo-*.wav`、`appear-1/2/3.wav`、`cartoon-1/2.wav`、`face-shake.wav`、`shaking.wav`
   版权归 NEXON Games / Yostar,**非自由授权**。本 fork **已删除**这些文件,不再分发。
   `frontend/public/vn/CREDITS.txt` 里已标注为「本 fork 已移除」。
3. **AnimaVN 品牌字标** — UI 里的品牌已改为 `SocialCoach · Love Studio`;加载页/封面原用的
   `AnimaVN` 字标位图(`frontend/public/vn/ui/wordmark.png`)不再被引用,改用本项目自制的
   SVG 字标 `frontend/public/vn/ui/wordmark-studio.svg`。

除此之外,`UPSTREAM-README.md` 是上游 README 的原文留存,仅供对照,不代表本 fork 现状。