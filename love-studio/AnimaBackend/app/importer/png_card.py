"""把卡写回 PNG 的 tEXt 块（keyword `chara`，内容 base64(V2 JSON)），保留原图像素。

spec-love-user-cards §3：Studio 的 PNG 卡导出要与主站 love-card.ts 的解析器对齐 ——
同一个 PNG 在主站 / Studio 之间往返，字段不丢、name/first_mes/description 不变。
这里锁死的契约（tests/test_png_card.py 里逐条对）：
- keyword 固定 `chara`（不要改成别的），正文 = base64(UTF-8 编码的 JSON)。
- JSON 形状是标准 `{"spec":"chara_card_v2","data":{...}}`。
- 有原 PNG 时保留全部原图像素：只剥掉旧的卡数据块（`chara` / `ccv3`，
  免得导入器先读到旧的）再把新的 `chara` 块插到 IEND 前面。
- 没有原 PNG（或不是合法 PNG）时用 PIL 画一张纯色 + 角色名的占位图并标注。
  不新增依赖：base64 / struct / zlib 都是标准库，PIL 仓库里已有。
"""

from __future__ import annotations

import base64
import io
import struct
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
KEYWORD = "chara"
# 导入器(cards.py)想的是 ccv3 优先、chara 其次;导出时把这两个旧块都剥掉,
# 保证同一个 PNG 解析回来读到的是这次导出的内容,而不是旧的卡数据
_CARD_KEYS = (b"ccv3", KEYWORD.encode("latin1"))

# 占位图:纯色底 + 角色名。角色名没原图时画在图上,重新导入时一眼能看出不是原头像
_PLACEHOLDER_W, _PLACEHOLDER_H = 768, 1024
_PLACEHOLDER_BG = (58, 63, 82)
_PLACEHOLDER_NAME_FILL = (246, 243, 233)
_PLACEHOLDER_NOTE_FILL = (168, 174, 188)
_PLACEHOLDER_NOTE = "占位图 · 无原图"
_PLACEHOLDER_NOTE_ASCII = "PLACEHOLDER - NO ORIGINAL IMAGE"
# 中文 / 日文角色名要一个能画的字体;按平台常见的列表找,找不到就用默认字体(只能画 ASCII)
_FONT_CANDIDATES = (
    "C:/Windows/Fonts/msyh.ttc",  # 微软雅黑
    "C:/Windows/Fonts/msyhbd.ttc",  # 微软雅黑(粗)
    "C:/Windows/Fonts/simhei.ttf",  # 黑体
    "/System/Library/Fonts/PingFang.ttc",  # macOS 苹方
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",  # Linux DejaVu
)


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _card_chunk(v2_json: str) -> bytes:
    """`chara\x00<base64(utf-8 json)>` 的 tEXt 块。正文按 latin1 写(和 cards.py 读法一致)。"""
    return _chunk(b"tEXt", KEYWORD.encode("latin1") + b"\x00" + base64.b64encode(v2_json.encode("utf-8")))


def _inject(png: bytes, card_chunk: bytes, name: str) -> bytes:
    """把 card_chunk 插到一个合法 PNG 的 IEND 前面;同时剥掉旧卡数据块。
    不是合法的 PNG(签名不对 / 没有 IEND / 块被截断)就直接画占位图。"""
    if not png.startswith(PNG_SIGNATURE):
        return _placeholder(card_chunk, name)
    f = io.BytesIO(png)
    out = bytearray(f.read(8))
    while True:
        head = f.read(8)
        if len(head) < 8:
            return _placeholder(card_chunk, name)  # 没有 IEND
        length, kind = struct.unpack(">I4s", head)
        body = f.read(length)
        crc = f.read(4)
        if len(body) < length or len(crc) < 4:
            return _placeholder(card_chunk, name)
        if kind == b"IEND":
            out += card_chunk
            out += head + body + crc
            return bytes(out)
        if kind == b"tEXt":
            nul = body.find(b"\x00")
            if nul != -1 and body[:nul] in _CARD_KEYS:
                continue  # 旧卡数据盖掉,导入器只会读到新的
        out += head + body + crc


def _truetype(size: int):
    from PIL import ImageFont

    for path in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return None


def _ascii_only(text: str) -> str:
    return text.encode("ascii", "ignore").decode("ascii").strip()


def _wrap(draw, text: str, font, max_w: int) -> list[str]:
    """按字 greedy 折行;没有字体时不用量宽度,整行画(反正只有 ASCII)。"""
    if font is None:
        return [text]
    lines: list[str] = []
    cur = ""
    for ch in text:
        if cur and draw.textlength(cur + ch, font=font) > max_w:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines or [text]


def _placeholder(card_chunk: bytes, name: str) -> bytes:
    """纯色底 + 角色名 + 标注的占位图。名字画不了的字(找不到字体)退成 ASCII。"""
    from PIL import Image, ImageDraw

    w, h = _PLACEHOLDER_W, _PLACEHOLDER_H
    img = Image.new("RGB", (w, h), _PLACEHOLDER_BG)
    draw = ImageDraw.Draw(img)

    font = _truetype(64)
    if font is None:
        text = _ascii_only(name) or "Character"
        note = _PLACEHOLDER_NOTE_ASCII
    else:
        text = (name or "Character").strip() or "Character"
        note = _PLACEHOLDER_NOTE

    lines = _wrap(draw, text, font, w - 160)
    line_h = 78 if font is not None else 16
    total = len(lines) * line_h
    y = (h - total - 140) / 2
    for line in lines:
        tw = draw.textlength(line, font=font) if font is not None else 0
        draw.text(((w - tw) / 2, y), line, font=font, fill=_PLACEHOLDER_NAME_FILL)
        y += line_h

    note_font = _truetype(28)
    if note_font is None and font is None:
        note = _ascii_only(note)
    nw = draw.textlength(note, font=note_font) if note_font is not None else 0
    draw.text(((w - nw) / 2, y + 70), note, font=note_font, fill=_PLACEHOLDER_NOTE_FILL)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return _inject(buf.getvalue(), card_chunk, name)


def write_card_into_png(png: bytes | None, v2_json: str, name: str = "") -> bytes:
    """把 v2_json 写进 PNG 并返回新 PNG。
    - png: 原图(<chara> 的数据 URL 解出来的字节 / 前端缓存的头像);None = 没有原图,用占位图。
    - v2_json: 标准的 `{"spec":"chara_card_v2","data":{...}}` JSON 字符串(base64 后进 tEXt)。
    - name: 画占位图时用的角色名。
    """
    card = _card_chunk(v2_json)
    if png is None:
        return _placeholder(card, name)
    return _inject(png, card, name)