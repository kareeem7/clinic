"""يبني إطارات فيديو الديمو (1280×720، 30fps) ويصدّرها PNG."""

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import artext as T

F_BLACK = "/tmp/CairoFull-Black.ttf"
F_BOLD = "/tmp/CairoFull-Bold.ttf"

W, H = 1280, 720
FPS = 30

TEAL = (13, 148, 136)
TEAL_L = (94, 234, 212)
WHITE = (255, 255, 255)
MUTED = (167, 216, 209)
WARN = (251, 191, 36)
RED = (248, 113, 113)


def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_out_back(t):
    t = max(0.0, min(1.0, t))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def bg(top, bottom):
    img = Image.new("RGB", (W, H), top)
    d = ImageDraw.Draw(img)
    for y in range(H):
        k = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))
    return img.convert("RGBA")


def glow(img, cx, cy, r, color, alpha):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (alpha,))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(r // 2)))


def grid(img, step=80, a=9):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x in range(0, W, step):
        d.line([(x, 0), (x, H)], fill=(255, 255, 255, a))
    for y in range(0, H, step):
        d.line([(0, y), (W, y)], fill=(255, 255, 255, a))
    img.alpha_composite(layer)


def card(img, box, radius=24, fill=WHITE, alpha=255, border=None):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=fill + (alpha,),
                        outline=border, width=2 if border else 0)
    img.alpha_composite(layer)


def with_alpha(layer, a):
    if a >= 0.995:
        return layer
    if a <= 0.005:
        return None
    out = layer.copy()
    out.putalpha(out.getchannel("A").point(lambda v: int(v * a)))
    return out


def text_block(text, size, color, font=F_BLACK):
    layer = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    tw, asc, desc = T.measure(text, font, size)
    lh = int((asc - desc) * 1.28)
    layer = Image.new("RGBA", (int(tw) + size * 2, lh + size), (0, 0, 0, 0))
    T.draw_center(layer, text, font, size, color, layer.width // 2, size // 2 + int(asc))
    return layer


def paste_center(img, layer, cy, a=1.0):
    if layer is None:
        return
    layer = with_alpha(layer, a)
    if layer is None:
        return
    img.alpha_composite(layer, ((W - layer.width) // 2, int(cy) - layer.height // 2))


# ══════════════ المشاهد ══════════════

def sc_pain(lt):
    """0.0–6.5 : الكشكول والورق"""
    img = bg((38, 16, 14), (18, 11, 10))
    glow(img, 640, 640, 320, (185, 78, 30), 40)

    # كارت ورق مائل في الخلفية
    bx, by, bw, bh = 430, 250, 420, 300
    rot = math.sin(lt * 1.4) * 2.5
    paper = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    pd = ImageDraw.Draw(paper)
    pd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=8, fill=(247, 243, 234, 240))
    for i in range(9):
        y = 46 + i * 28
        pd.line([(34, y), (bw - 34 - (i % 3) * 60, y)], fill=(180, 172, 158, 190), width=3)
    pd.line([(34, 40), (bw - 34, 40)], fill=(200, 90, 70, 220), width=4)
    paper = paper.rotate(rot, expand=False, resample=Image.BICUBIC)
    img.alpha_composite(paper, (bx, by))

    # علامات استفهام / تشويش
    for i, (dx, dy) in enumerate([(300, 200), (980, 300), (250, 480), (1010, 520)]):
        a = 0.12 + 0.30 * (0.5 + 0.5 * math.sin(lt * 2.2 + i * 1.7))
        q = text_block("؟", 74, (255, 200, 120))
        q = with_alpha(q, a)
        if q:
            img.alpha_composite(q, (dx, dy))

    t1 = text_block("مواعيدك في كشكول؟", 56, (255, 236, 210))
    t2 = text_block("ومريض يسألك: نزلت قد إيه؟", 40, (255, 198, 160))
    a1 = ease(lt / 1.1)
    a2 = ease((lt - 1.3) / 1.1)
    paste_center(img, t1, 600, a1)
    paste_center(img, t2, 668, a2)
    return img


def sc_question(lt):
    """6.5–11.0 : علامات استفهام كبيرة"""
    img = bg((26, 20, 12), (12, 10, 8))
    glow(img, 640, 360, 380, (180, 140, 40), 45)
    q = text_block("؟", 300, (255, 210, 120))
    pulse = 1.0 + 0.05 * math.sin(lt * 4)
    q = q.resize((int(q.width * pulse), int(q.height * pulse)))
    paste_center(img, q, 300, ease(lt / 0.6) * 0.85)

    t1 = text_block("وكل مرة تدوّر في الورق", 46, (255, 232, 200))
    paste_center(img, t1, 560, ease((lt - 0.5) / 0.9))
    return img


def sc_logo(lt):
    """11.0–14.0 : الظهور — عيادتي"""
    img = bg((8, 32, 30), (14, 62, 58))
    glow(img, 640, 300, 420, TEAL, 70)
    grid(img)

    logo = text_block("عيادتي", 132, WHITE)
    s = 0.82 + 0.18 * ease_out_back(min(1.0, lt / 0.85))
    logo = logo.resize((max(1, int(logo.width * s)), max(1, int(logo.height * s))))
    paste_center(img, logo, 268, ease(lt / 0.5))

    sub = text_block("نظام إدارة العيادة — كله في شاشة واحدة", 40, TEAL_L)
    paste_center(img, sub, 420, ease((lt - 0.45) / 0.8))

    line_w = int(300 * ease((lt - 0.9) / 0.7))
    if line_w > 2:
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([640 - line_w // 2, 470, 640 + line_w // 2, 474], 2, fill=TEAL_L + (220,))
    return img


def sc_patients(lt):
    """بطاقة MRIضى"""
    img = bg((8, 32, 30), (12, 52, 48))
    glow(img, 200, 150, 280, TEAL, 45)
    grid(img)

    t = text_block("ملف كل مريض", 46, WHITE)
    paste_center(img, t, 120, ease(lt / 0.6))

    rows = [
        ("منى عبد الرحمن", "92.4 كجم", "سمنة"),
        ("محمود فتحي", "ألم 3/10", "علاج طبيعي"),
        ("هدى مصطفى", "61.9 كجم", "تثبيت"),
    ]
    card(img, [200, 176, 1080, 604], 26, WHITE, 255)
    for i, (name, val, tag) in enumerate(rows):
        a = ease((lt - 0.35 - i * 0.22) / 0.5)
        if a <= 0:
            continue
        y = 232 + i * 112
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.rounded_rectangle([228, y, 1052, y + 88], 16, fill=(240, 250, 248, 255))
        T.draw_right(layer, name, F_BOLD, 30, (12, 42, 40), 1030, y + 54)
        T.draw_right(layer, val, F_BOLD, 26, TEAL, 700, y + 54)
        T.draw_right(layer, tag, F_BOLD, 20, (110, 140, 136), 420, y + 54)
        layer = with_alpha(layer, a)
        if layer:
            img.alpha_composite(layer)
    return img


def sc_chart(lt):
    """المنحنى — أقوى مشهد"""
    img = bg((8, 32, 30), (12, 52, 48))
    glow(img, 640, 420, 420, TEAL, 45)
    grid(img)

    t = text_block("منحنى تقدم المريض", 44, WHITE)
    paste_center(img, t, 96, ease(lt / 0.5))

    card(img, [120, 150, 1160, 604], 26, (255, 255, 255), 255)
    # منطقة الرسم
    x0, y0, x1, y1 = 210, 220, 1080, 540

    # نقاط الوزن (تنازلي)
    data = [92.4, 90.8, 89.1, 87.6, 86.2, 84.9, 83.5, 83.2]
    n = len(data)
    hi, lo = 94, 82
    pts = []
    for i, v in enumerate(data):
        px = x0 + (x1 - x0) * i / (n - 1)
        py = y0 + (y1 - y0) * (hi - v) / (hi - lo)
        pts.append((px, py))

    revealed = ease(lt / 1.9) * (n - 1)
    d = ImageDraw.Draw(img)
    # خطوط أفقية
    for gy in range(y0, y1 + 1, 80):
        d.line([(x0, gy), (x1, gy)], fill=(228, 240, 238), width=2)

    # الخط المتدرج
    seg = int(revealed)
    frac = revealed - seg
    draw_pts = pts[:seg + 1]
    if seg < n - 1 and frac > 0:
        ax, ay = pts[seg]
        bx, by = pts[seg + 1]
        draw_pts.append((ax + (bx - ax) * frac, ay + (by - ay) * frac))
    if len(draw_pts) > 1:
        d.line(draw_pts, fill=TEAL, width=6, joint="curve")
    for i, (px, py) in enumerate(draw_pts):
        r = 9 if i < len(draw_pts) - 1 else 13
        d.ellipse([px - r, py - r, px + r, py + r], fill=WHITE, outline=TEAL, width=4)

    # تسميات
    if seg >= n - 1:
        lab = text_block("9.2 كجم أقل", 34, (13, 148, 136))
        img.alpha_composite(with_alpha(lab, ease((lt - 1.9) / 0.5)) or lab, (520, 208))
    lab2 = with_alpha(text_block("خلال 6 شهور", 26, (168, 218, 210)), ease((lt - 0.8) / 0.5))
    if lab2:
        img.alpha_composite(lab2, (560, 588))
    return img


def sc_features(lt):
    """٣ مزايا"""
    img = bg((8, 32, 30), (12, 52, 48))
    glow(img, 1060, 620, 300, TEAL, 40)
    grid(img)

    items = [
        ("مواعيد", "بتذكير واتساب"),
        ("قياسات", "InBody وسكر وضغط"),
        ("خطط", "تغذية جاهزة للربط"),
    ]
    a0 = ease(lt / 0.6)
    t = text_block("كل حاجة في مكانها", 46, WHITE)
    paste_center(img, t, 110, a0)

    for i, (k, v) in enumerate(items):
        a = ease((lt - 0.3 - i * 0.28) / 0.55)
        if a <= 0:
            continue
        x = 140 + i * 360
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.rounded_rectangle([x, 220, x + 300, 500], 24, fill=(255, 255, 255, 255))
        d.rounded_rectangle([x + 30, 260, x + 94, 324], 18, fill=TEAL + (255,))
        T.draw_center(layer, k, F_BLACK, 34, (12, 42, 40), x + 150, 400)
        for j, line in enumerate(T.wrap(v, F_BOLD, 22, 240)):
            T.draw_center(layer, line, F_BOLD, 22, (120, 150, 146), x + 150, 448 + j * 32)
        layer = with_alpha(layer, a)
        if layer:
            img.alpha_composite(layer)
    return img


def sc_price(lt):
    """السعر والتجربة"""
    img = bg((8, 32, 30), (16, 70, 64))
    glow(img, 640, 380, 420, TEAL, 60)
    grid(img)

    t = text_block("جرّبه 14 يوم مجانًا", 62, WHITE)
    paste_center(img, t, 210, ease(lt / 0.6))

    card(img, [400, 320, 880, 500], 26, WHITE, 255)
    p1 = text_block("250", 84, (12, 42, 40))
    paste_center(img, p1, 392, ease((lt - 0.3) / 0.5))
    p2 = text_block("جنيه في الشهر", 30, (120, 150, 146))
    paste_center(img, p2, 462, ease((lt - 0.5) / 0.5))

    t3 = text_block("من غير بطاقة… ومن غير أي التزام", 34, TEAL_L)
    paste_center(img, t3, 570, ease((lt - 0.8) / 0.6))
    return img


def sc_end(lt):
    """الخاتمة"""
    img = bg((7, 28, 26), (13, 60, 56))
    glow(img, 640, 340, 460, TEAL, 75)
    grid(img)

    logo = text_block("عيادتي", 118, WHITE)
    s = 0.9 + 0.1 * ease_out_back(min(1.0, lt / 0.8))
    logo = logo.resize((max(1, int(logo.width * s)), max(1, int(logo.height * s))))
    paste_center(img, logo, 280, ease(lt / 0.5))

    tag = text_block("عيادتك… في جيبك", 46, TEAL_L)
    paste_center(img, tag, 420, ease((lt - 0.4) / 0.7))

    cta = text_block("عيادتي — نظام إدارة العيادة", 26, (150, 200, 195))
    paste_center(img, cta, 600, ease((lt - 0.8) / 0.7))
    return img


SCENES = [
    (0.0, 6.5, sc_pain),
    (6.5, 11.0, sc_question),
    (11.0, 14.5, sc_logo),
    (14.5, 18.5, sc_patients),
    (18.5, 22.5, sc_chart),
    (22.5, 25.5, sc_features),
    (25.5, 28.2, sc_price),
    (28.2, 30.5, sc_end),
]


def frame_at(t):
    for i, (a, b, fn) in enumerate(SCENES):
        if a <= t < b or i == len(SCENES) - 1:
            lt = t - a
            img = fn(lt)
            # انتقال ناعم بين المشاهد
            fade = 0.35
            if lt < fade:
                prev = SCENES[i - 1][2](SCENES[i][1] - SCENES[i - 1][0]) if i > 0 else None
                k = ease(lt / fade)
                if prev is not None:
                    img = Image.blend(prev.convert("RGB"), img.convert("RGB"), k).convert("RGBA")
                else:
                    img = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), img.convert("RGB"), k).convert("RGBA")
            return img
    return SCENES[-1][2](0)


if __name__ == "__main__":
    print("render module ok")
