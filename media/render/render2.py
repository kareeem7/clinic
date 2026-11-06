"""فيديو ديمو «عيادتي» — نسخة 3: حماس + موسيقى + لقطات من الواجهة الحقيقية.

الصوتيات:
  voice2_master.wav  — التعليق الصوتي (مصري متحمّس، مضبوط اللاودنس)
  music_master.wav   — موسيقى متولّدة بالكود (128 BPM، Am–F–C–G)
  mix.wav            — الميكس النهائي
"""
import math

from PIL import Image, ImageDraw, ImageFilter

import artext as T
import ui

W, H = 1280, 720

BLACK_F = ui.BLACK
BOLD_F = ui.BOLD

TEAL = ui.TEAL600
TEAL_L = ui.TEAL500
TEAL_100 = ui.TEAL100
WHITE = (255, 255, 255)
INK = ui.INK
MUTED = ui.MUTED


def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def ease_out_back(x):
    x = max(0.0, min(1.0, x))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2


def clamp01(x):
    return max(0.0, min(1.0, x))


# ───────────────────────── أدوات ─────────────────────────

def bg(c1, c2, w=W, h=H):
    img = Image.new("RGBA", (w, h), c1 + (255,))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        c = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c + (255,))
    return img


def glow(img, cx, cy, r, color, a=60):
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    lay = lay.filter(ImageFilter.GaussianBlur(r * 0.55))
    img.alpha_composite(lay)


def grid(img, step=48, color=(255, 255, 255), a=9):
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for x in range(0, img.width, step):
        d.line([(x, 0), (x, img.height)], fill=color + (a,))
    for y in range(0, img.height, step):
        d.line([(0, y), (img.width, y)], fill=color + (a,))
    img.alpha_composite(lay)


def text_block(s, size, color=(255, 255, 255), font=None, max_w=None):
    """يرجع صورة RGBA للنص (سطر واحد أو ملتف)."""
    font = font or BLACK_F
    lines = T.wrap(s, font, size, max_w) if max_w else [s]
    imgs = []
    for ln in lines:
        lay, _, _ = T.text_layer(ln, font, size, color)
        imgs.append(lay)
    w = max(i.width for i in imgs)
    h = sum(i.height for i in imgs) - (len(imgs) - 1) * int(size * 0.34)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    y = 0
    for i in imgs:
        out.alpha_composite(i, ((w - i.width) // 2, y))
        y += i.height - int(size * 0.34)
    return out


def with_alpha(im, a):
    if a >= 1:
        return im
    if a <= 0:
        return None
    out = im.copy()
    out.putalpha(out.getchannel("A").point(lambda v: int(v * a)))
    return out


def paste_center(img, blk, cy, a=1.0, cx=W // 2, dy=0):
    if blk is None:
        return
    b = with_alpha(blk, a) if a < 1 else blk
    if b is None:
        return
    img.alpha_composite(b, (int(cx - b.width / 2), int(cy - b.height / 2 + dy)))


def card(img, box, r, fill, alpha=255):
    if alpha <= 0:
        return
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle(box, radius=r, fill=fill + (alpha,))
    img.alpha_composite(lay)


def zoom_pan(src, t, z0=1.0, z1=1.06, p0=(0, 0), p1=(0, 0)):
    """حركة كاميرا ناعمة على لقطة ثابتة."""
    z = z0 + (z1 - z0) * ease(t)
    w, h = src.size
    cw, ch = int(w / z), int(h / z)
    cx = (p0[0] + (p1[0] - p0[0]) * ease(t)) * w + (w - cw) / 2
    cy = (p0[1] + (p1[1] - p0[1]) * ease(t)) * h + (h - ch) / 2
    cx = max(0, min(w - cw, cx))
    cy = max(0, min(h - ch, cy))
    return src.crop((int(cx), int(cy), int(cx + cw), int(cy + ch))).resize((w, h), Image.LANCZOS)


# ───────────────────────── مشاهد ─────────────────────────

def sc_pain(lt):
    """0.0–6.6 : الكشكول، وبعدها كلمة «بَطِّل!» بتنضرب في النص"""
    img = bg((38, 16, 14), (18, 11, 10))
    glow(img, 640, 640, 320, (185, 78, 30), 40)

    # الكشكول يزحف لفوق شوية بعد الضربة
    push = ease((lt - 2.3) / 0.6)
    by = 250 + math.sin(lt * 1.2) * 1.5 + push * 250
    rot = math.sin(lt * 1.4) * 2.5 + push * 9.0
    paper = Image.new("RGBA", (420, 300), (0, 0, 0, 0))
    pd = ImageDraw.Draw(paper)
    pd.rounded_rectangle([0, 0, 419, 299], radius=8, fill=(247, 243, 234, 240))
    for i in range(9):
        y = 46 + i * 28
        pd.line([(34, y), (386 - (i % 3) * 60, y)], fill=(180, 172, 158, 190), width=3)
    pd.line([(34, 40), (386, 40)], fill=(200, 90, 70, 220), width=4)
    paper = paper.rotate(rot, expand=False, resample=Image.BICUBIC)
    img.alpha_composite(paper, (430, int(by)))

    for i, (dx, dy) in enumerate([(168, 120), (1046, 150), (150, 430), (1078, 400)]):
        a = 0.12 + 0.30 * (0.5 + 0.5 * math.sin(lt * 2.2 + i * 1.7))
        q = text_block("؟", 74, (255, 200, 120))
        qq = with_alpha(q, a)
        if qq:
            img.alpha_composite(qq, (dx, dy))

    t1 = text_block("مواعيدك في كشكول؟", 56, (255, 236, 210))
    t2 = text_block("ومريض يسألك: نزلت قد إيه؟", 40, (255, 198, 160))
    a1 = ease(lt / 0.9)
    a2 = ease((lt - 0.9) / 0.9)
    # بعد الضربة، النصين يخفّوا
    dim = 1.0 - 0.75 * ease((lt - 2.3) / 0.45)
    paste_center(img, t1, 600, a1 * dim)
    paste_center(img, t2, 668, a2 * dim)

    # «بَطِّل!» — يدخل بضربة قوية
    bp = ease_out_back(min(1.0, (lt - 2.35) / 0.5))
    ba = ease((lt - 2.35) / 0.28)
    if ba > 0:
        kick = text_block("بَطِّل!", 118, (255, 92, 60))
        sc = 1.6 - 0.6 * bp
        k = kick.resize((max(1, int(kick.width * sc)), max(1, int(kick.height * sc))))
        paste_center(img, k, 372, ba)
        # خطين سريعين حوليها
        d = ImageDraw.Draw(img)
        wdt = int(k.width * 0.86)
        yy = 448
        d.rounded_rectangle([640 - wdt // 2, yy, 640 + wdt // 2, yy + 6], 3,
                            fill=(255, 92, 60, int(200 * ba)))
    return img


def sc_question(lt):
    """5.6–8.2 : تدوّر في الورق"""
    img = bg((26, 20, 12), (12, 10, 8))
    glow(img, 640, 360, 380, (180, 140, 40), 45)
    q = text_block("؟", 300, (255, 210, 120))
    pulse = 1.0 + 0.05 * math.sin(lt * 4)
    q = q.resize((int(q.width * pulse), int(q.height * pulse)))
    paste_center(img, q, 300, ease(lt / 0.55) * 0.85)
    t1 = text_block("وكل مرة تدوّر في الورق", 46, (255, 232, 200))
    paste_center(img, t1, 560, ease((lt - 0.35) / 0.8))
    return img


def sc_intro(lt):
    """8.2–10.6 : اسم المنتج"""
    img = bg((8, 32, 30), (14, 62, 58))
    glow(img, 640, 300, 420, TEAL, 70)
    grid(img)

    logo = text_block("عيادتي", 132, WHITE)
    s = 0.82 + 0.18 * ease_out_back(min(1.0, lt / 0.7))
    logo = logo.resize((max(1, int(logo.width * s)), max(1, int(logo.height * s))))
    paste_center(img, logo, 268, ease(lt / 0.4))

    sub = text_block("نظام إدارة العيادة — كله في شاشة واحدة", 40, TEAL_100)
    paste_center(img, sub, 420, ease((lt - 0.3) / 0.6))

    line_w = int(300 * ease((lt - 0.55) / 0.5))
    if line_w > 2:
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([640 - line_w // 2, 470, 640 + line_w // 2, 474], 2, fill=TEAL_L + (220,))
    return img


# ── لقطات الواجهة بحركة كاميرا ──

def sc_ui_dashboard(lt):
    """10.6–13.4 : لوحة التحكم"""
    src = ui.SCREENS["dashboard"]().convert("RGB").resize((W, H), Image.LANCZOS)
    img = zoom_pan(src, lt / 2.8, z0=1.00, z1=1.05, p0=(-0.02, -0.02), p1=(0.02, 0.0))
    return frame_ui(img, lt, "كل عيادتك في شاشة واحدة")


def sc_ui_patients(lt):
    """13.4–16.2 : المرضى"""
    src = ui.SCREENS["patients"]().convert("RGB").resize((W, H), Image.LANCZOS)
    img = zoom_pan(src, lt / 2.8, z0=1.05, z1=1.00, p0=(0.03, 0.02), p1=(-0.01, 0.0))
    return frame_ui(img, lt, "مرضاك كلهم… منظّمين")


def sc_ui_patient(lt):
    """16.2–19.6 : ملف المريض والمنحنى"""
    src = ui.SCREENS["patient"]().convert("RGB").resize((W, H), Image.LANCZOS)
    k = ease((lt - 1.0) / 1.0) if lt > 1.0 else 0.0
    zoom = 1.00 + 0.11 * k
    img = zoom_pan(src, 1.0, z0=zoom, z1=zoom,
                   p0=(0.02 * k, -0.06 * k), p1=(0.02 * k, -0.06 * k))
    return frame_ui(img, lt, "منحنى واضح لكل مريض")


def sc_ui_appointments(lt):
    """19.6–23.0 : المواعيد وواتساب"""
    src = ui.SCREENS["appointments"]().convert("RGB").resize((W, H), Image.LANCZOS)
    img = zoom_pan(src, lt / 3.4, z0=1.04, z1=1.00, p0=(-0.02, 0.03), p1=(0.01, 0.0))
    return frame_ui(img, lt, "تذكير واتساب… بضغطة")


def frame_ui(img, lt, caption, fade_in=0.0):
    """يحط اللقطة في إطار متصفح أنيق على خلفية داكنة + كابشن تحتها."""
    base = bg((6, 26, 25), (10, 44, 41))
    glow(base, 640, 300, 520, TEAL, 34)
    grid(base, 40, (255, 255, 255), 7)

    # إطار الكارت
    bx, by, bw, bh = 107, 14, 1066, 600
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([bx, by + 10, bx + bw, by + bh + 10], radius=18, fill=(0, 0, 0, 130))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    base.alpha_composite(shadow)

    shot = img.convert("RGB").resize((bw, bh), Image.LANCZOS)
    mask = Image.new("L", (bw, bh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, bw - 1, bh - 1], radius=18, fill=255)
    base.paste(shot, (bx, by), mask)
    d = ImageDraw.Draw(base)
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=18, outline=(255, 255, 255, 46), width=2)

    # كابشن
    cap = text_block(caption, 44, WHITE)
    a = ease(lt / 0.5)
    b = with_alpha(cap, a)
    if b:
        pw = b.width + 56
        px0 = (W - pw) // 2
        d.rounded_rectangle([px0, 628, px0 + pw, 628 + 62], radius=20,
                            fill=(13, 148, 136, int(228 * a)))
        base.alpha_composite(b, ((W - b.width) // 2, 628 + (62 - b.height) // 2))
    return base


def sc_price(lt):
    """23.0–26.4 : التجربة والسعر"""
    img = bg((8, 32, 30), (16, 70, 64))
    glow(img, 640, 380, 420, TEAL, 60)
    grid(img)

    t = text_block("جرّبه 14 يوم مجانًا", 62, WHITE)
    paste_center(img, t, 200, ease(lt / 0.5))

    card(img, [400, 300, 880, 470], 26, WHITE, 255)
    p1 = text_block("250", 84, (12, 42, 40))
    paste_center(img, p1, 378, ease((lt - 0.35) / 0.5))
    p2 = text_block("جنيه في الشهر", 34, (110, 140, 136))
    paste_center(img, p2, 448, ease((lt - 0.55) / 0.5))

    sub = text_block("من غير بطاقة… ومن غير أي التزام", 36, TEAL_100)
    paste_center(img, sub, 552, ease((lt - 0.9) / 0.6))
    return img


def sc_end(lt):
    """26.4–29.8 : الإغلاق"""
    img = bg((8, 32, 30), (14, 62, 58))
    glow(img, 640, 320, 460, TEAL, 74)
    grid(img)

    logo = text_block("عيادتي", 146, WHITE)
    paste_center(img, logo, 262, ease(lt / 0.45))

    tag = text_block("عيادتك… في جيبك", 48, TEAL_100)
    paste_center(img, tag, 452, ease((lt - 0.3) / 0.6))

    cta = text_block("عيادتي — نظام إدارة العيادة", 26, (150, 200, 195))
    paste_center(img, cta, 596, ease((lt - 0.6) / 0.6))
    return img


SCENES = [
    (0.0, 6.6, sc_pain),
    (6.6, 9.6, sc_intro),
    (9.6, 12.2, sc_ui_dashboard),
    (12.2, 14.4, sc_ui_patients),
    (14.4, 17.6, sc_ui_patient),
    (17.6, 21.4, sc_ui_appointments),
    (21.4, 26.2, sc_price),
    (26.2, 31.4, sc_end),
]

DURATION = 31.4


def frame_at(t):
    for i, (a, b, fn) in enumerate(SCENES):
        if a <= t < b or i == len(SCENES) - 1:
            lt = t - a
            img = fn(lt)
            fade = 0.30
            if lt < fade:
                k = ease(lt / fade)
                if i > 0:
                    prev = SCENES[i - 1][2](SCENES[i][1] - SCENES[i - 1][0])
                    img = Image.blend(prev.convert("RGB"), img.convert("RGB"), k).convert("RGBA")
                else:
                    img = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)),
                                      img.convert("RGB"), k).convert("RGBA")
            return img
    return SCENES[-1][2](0)


if __name__ == "__main__":
    import sys
    for t, name in [(1.5, "pain"), (3.2, "battel"), (8.2, "intro"), (10.8, "dash"),
                    (13.0, "pts"), (16.4, "pat"), (19.6, "appt"), (23.5, "price"),
                    (29.5, "end")]:
        frame_at(t).convert("RGB").save(f"/tmp/v3_{name}.png")
        print("ok", name)
