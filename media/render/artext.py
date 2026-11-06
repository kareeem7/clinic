"""رسم نص عربي حقيقي (shaping + RTL) عبر HarfBuzz + FreeType."""

import re
import freetype
import uharfbuzz as hb
from PIL import Image

_cache = {}


def _hb_font(path, size):
    key = ("hb", path, size)
    if key not in _cache:
        blob = hb.Blob.from_file_path(path)
        face = hb.Face(blob)
        f = hb.Font(face)
        f.scale = (size * 64, size * 64)
        _cache[key] = f
    return _cache[key]


def _ft_face(path, size):
    key = ("ft", path, size)
    if key not in _cache:
        f = freetype.Face(path)
        f.set_char_size(int(round(size * 64)))
        _cache[key] = f
    return _cache[key]


def _fix_digits(text):
    """في مقطع RTL، HarfBuzz بيرصف أرقام لاتينية من الشمال لليمين فبتطلع معكوسة.
    نعكس كل تجميعة أرقام قبل التشكيل عشان تظهر صح بعد الرصف."""
    def rev(m):
        return m.group(0)[::-1]
    return re.sub(r"[0-9]+(?:[:.,/][0-9]+)*", rev, text)


_RTL_RE = re.compile("[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]")


def _has_rtl(text):
    return bool(_RTL_RE.search(text))


def layout(text, path, size):
    """يرجع (glyphs, width, ascender, descender) بوحدات البكسل.

    glyphs: [(gid, x_offset, y_offset, x_advance), ...] بترتيب الرسم من اليمين.
    """
    hbf = _hb_font(path, size)
    buf = hb.Buffer()
    buf.add_str(_fix_digits(text) if _has_rtl(text) else text)
    buf.guess_segment_properties()
    hb.shape(hbf, buf)

    # hbf.scale محدد بالفعل بـ size*64 → القيم في 26.6 fixed point (64 = 1px)
    out, x = [], 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append((info.codepoint, x + pos.x_offset / 64.0, -pos.y_offset / 64.0,
                    pos.x_advance / 64.0))
        x += pos.x_advance / 64.0

    ft = _ft_face(path, size)
    asc = ft.size.ascender / 64.0
    desc = ft.size.descender / 64.0
    return out, x, asc, desc


def measure(text, path, size):
    _, w, asc, desc = layout(text, path, size)
    return w, asc, desc


def text_layer(text, path, size, color=(255, 255, 255)):
    """يرجع (صورة RGBA, (dx, dy)) حيث dx,dy إزاحة القص. النص بمحاذاة يسار-أعلى."""
    glyphs, width, asc, desc = layout(text, path, size)
    pad = size  # هامش علوي/سفلي لعلامات التشكيل والامتدادات
    W = int(width) + pad * 2
    H = int(asc - desc) + pad * 2
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    ft = _ft_face(path, size)
    for gid, gx, gy, _ in glyphs:
        try:
            ft.load_glyph(gid, freetype.FT_LOAD_RENDER)
        except Exception:
            continue
        bmp = ft.glyph.bitmap
        if bmp.width == 0 or bmp.rows == 0:
            continue
        gl = Image.frombytes("L", (bmp.width, bmp.rows), bytes(bmp.buffer))
        # الموضع: خط الأساس عند pad+asc، والنص يبدأ من pad
        px = int(pad + gx + ft.glyph.bitmap_left)
        py = int(pad + asc - ft.glyph.bitmap_top + gy)
        if gl.getbbox() is None:
            continue
        tint = Image.new("RGBA", gl.size, color + (0,))
        tint.putalpha(gl)
        img.alpha_composite(tint, (px, py))

    return img, (pad, pad + asc), (int(width), int(asc - desc))


def draw_center(dst, text, path, size, color, cx, cy):
    """يرسم النص موسّطًا أفقيًا حول cx وخط الأساس عند cy."""
    img, baseline, _ = text_layer(text, path, size, color)
    x = cx - img.width // 2
    y = cy - int(baseline[1])
    dst.alpha_composite(img, (x, y))
    return img


def draw_right(dst, text, path, size, color, x_right, cy):
    img, baseline, _ = text_layer(text, path, size, color)
    x = x_right - img.width
    y = cy - int(baseline[1])
    dst.alpha_composite(img, (x, y))
    return img


def wrap(text, path, size, max_width):
    """يقسّم النص لأسطر تناسب العرض. يعتمد على المسافات."""
    words, lines, cur = text.split(" "), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if measure(test, path, size)[0] <= max_width or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines
