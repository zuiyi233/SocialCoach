import { describe, expect, it } from 'vitest';
import { BLINK_LABEL, blinkSprite, motionForLabel, nextBlinkDelay } from './spriteLife';

const sp = (label: string, has_image = true) => ({ label, has_image });

describe('blinkSprite', () => {
  it('取 label 为「闭眼」的那张', () => {
    const blink = sp(BLINK_LABEL);
    expect(blinkSprite([sp('平静'), blink, sp('微笑')])).toBe(blink);
  });

  it('没有闭眼帧就返回 null（安静地不眨，不报错）', () => {
    expect(blinkSprite([sp('平静'), sp('微笑')])).toBeNull();
  });

  it('闭眼帧还没上传图时也不用（否则会闪一下空图）', () => {
    expect(blinkSprite([sp('平静'), sp(BLINK_LABEL, false)])).toBeNull();
  });
});

describe('nextBlinkDelay', () => {
  it('落在区间内，且随机数两端取到端点', () => {
    expect(nextBlinkDelay(() => 0)).toBe(2600);
    expect(nextBlinkDelay(() => 1)).toBe(6200);
    const mid = nextBlinkDelay(() => 0.5);
    expect(mid).toBeGreaterThan(2600);
    expect(mid).toBeLessThan(6200);
  });
});

describe('motionForLabel', () => {
  it('认出惊讶 / 害羞 / 生气 / 笑', () => {
    expect(motionForLabel('惊讶')).toBe('shake');
    expect(motionForLabel('震惊')).toBe('shake');
    expect(motionForLabel('腼腆微笑')).toBe('sink');
    expect(motionForLabel('生气')).toBe('shiver');
    expect(motionForLabel('微笑')).toBe('hop');
  });

  it('平静、空值、认不出的都不动', () => {
    expect(motionForLabel('平静')).toBeNull();
    expect(motionForLabel(null)).toBeNull();
    expect(motionForLabel('')).toBeNull();
  });
});
