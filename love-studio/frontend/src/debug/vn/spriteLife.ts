/**
 * 立绘的「活着」层：眨眼、呼吸、情绪动作。
 *
 * 全都不需要视频模型，也不需要新的美术格式：
 * - 眨眼 = 同一张立绘 + 一张派生出来的「闭眼」帧，交叉淡一下（0.1 秒），靠 pack 里多一条
 *   label 为「闭眼」的立绘实现；没有这条就安静地不眨，不是所有角色都得有。
 * - 呼吸 = CSS 关键帧，几乎零成本。
 * - 情绪动作 = 复用 plugins/spriteFx 的关键帧，按表情名挑一个播一次。
 *
 * 这套做法的出处：L:\refs\talking-picture（MIT）——「原图像素不动，只在要动的地方换帧」。
 * 真正逐帧口型要 no_mouth 底 + 程序化嘴型（那套在 WebGL 里），这一层只做不碰像素的动效。
 */

export const BLINK_LABEL = '闭眼';
/** 两次眨眼之间的间隔（毫秒）：太规律会像节拍器，所以给一个区间随机取 */
export const BLINK_DELAY_MIN = 2600;
export const BLINK_DELAY_MAX = 6200;
/** 闭眼那一帧停留多久。真人眨眼 100–150ms，取中间偏低 */
export const BLINK_CLOSE_MS = 110;

type SpriteLike = { label: string; has_image?: boolean };

/** 立绘包里那张「闭眼」。没有、或者那张还没上传图，就当这个角色不眨眼。 */
export function blinkSprite<T extends SpriteLike>(sprites: T[]): T | null {
  const hit = sprites.find((s) => s.label === BLINK_LABEL);
  return hit && hit.has_image !== false ? hit : null;
}

/** 下一次眨眼的等待时间。rand 传 Math.random，测试里传固定值。 */
export function nextBlinkDelay(rand: () => number = Math.random): number {
  return BLINK_DELAY_MIN + Math.round(rand() * (BLINK_DELAY_MAX - BLINK_DELAY_MIN));
}

/**
 * 表情名 → 动作 id（对应 plugins/spriteFx 的 MOTION_FRAMES）。
 * 用中文关键词匹配：内置卡和 AI 生成的卡表情名都是中文，比让模型多吐一个字段稳。
 * 认不出就不动 —— 乱抖比不动更像 bug。
 */
const MOTION_RULES: [string[], string][] = [
  [['震惊', '惊讶', '吃惊', '惊', '错愕', '愕然'], 'shake'],
  [['生气', '愤怒', '怒', '恼'], 'shiver'],
  [['害怕', '紧张', '不安', '慌'], 'shiver'],
  [['害羞', '脸红', '腼腆', '窘', '羞'], 'sink'],
  [['难过', '悲伤', '失落', '沮丧', '疲惫', '低落'], 'sink'],
  [['开心', '高兴', '笑', '兴奋', '愉快'], 'hop'],
  [['凑近', '靠近', '贴近'], 'closer'],
];

export function motionForLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  for (const [words, motion] of MOTION_RULES) {
    if (words.some((w) => label.includes(w))) return motion;
  }
  return null;
}
