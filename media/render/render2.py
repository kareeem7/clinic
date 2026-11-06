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
    bb = out.getbbox()
    return out.crop(bb) if bb else out


def with_alpha(im, a):
    if a >= 1:
        return im
    if a <= 0:
        return None
    out = im.copy()
    out.putalpha(out.getchannel("A").point(lambda v: int(v * a)))
    return out


def paste_center(img, blk, cy, a=1.0, cx=W // 2, dy=0):
    """cy = مركز الكتلة فعليًا (مش خط الأساس)."""
    if blk is None:
        return
    b = with_alpha(blk, a) if a < 1 else blk
    if b is None:
        return
    img.alpha_composite(b, (int(cx - b.width / 2), int(cy - b.height / 2 + dy)))




def text_c(dst, txt, cx, y_base, size, color, weight=700):
    """موسّط — بإحداثيات 1280×720 الخام (من غير تكبير ui.S)."""
    T.draw_center(dst, txt, BLACK_F if weight >= 800 else BOLD_F, size, color, int(cx), int(y_base))


def text_r(dst, txt, x_right, y_base, size, color, weight=700):
    """محاذاة يمين — بإحداثيات 1280×720 الخام."""
    T.draw_right(dst, txt, BLACK_F if weight >= 800 else BOLD_F, size, color, int(x_right), int(y_base))


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
    push = ease((lt - 1.7) / 0.6)
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
    fade = 1.0 - ease((lt - 1.75) / 0.5)
    if fade > 0.01:
        pp = with_alpha(paper, fade)
        if pp:
            img.alpha_composite(pp, (430, int(by)))

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
    dim = 1.0 - 0.75 * ease((lt - 1.7) / 0.45)
    paste_center(img, t1, 600, a1 * dim)
    paste_center(img, t2, 668, a2 * dim)

    # «بَطِّل!» — يدخل بضربة قوية
    bp = ease_out_back(min(1.0, (lt - 1.75) / 0.45))
    ba = ease((lt - 1.75) / 0.25)
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
    k = ease((lt - 0.7) / 1.5) if lt > 0.7 else 0.0
    zoom = 1.03 + 0.10 * k
    img = zoom_pan(src, 1.0, z0=zoom, z1=zoom,
                   p0=(-0.04 * k, -0.07 * k), p1=(-0.04 * k, -0.07 * k))
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
    cap = text_block(caption, 42, WHITE)
    a = ease(lt / 0.5)
    b = with_alpha(cap, a)
    if b:
        pw = b.width + 60
        ph = max(64, b.height + 20)
        px0 = (W - pw) // 2
        py0 = 716 - ph
        d.rounded_rectangle([px0, py0, px0 + pw, py0 + ph], radius=20,
                            fill=(13, 148, 136, int(228 * a)))
        base.alpha_composite(b, ((W - b.width) // 2, py0 + (ph - b.height) // 2))
    return base


def sc_price(lt):
    """23.0–26.4 : التجربة والسعر"""
    img = bg((8, 32, 30), (16, 70, 64))
    glow(img, 640, 380, 420, TEAL, 60)
    grid(img)

    t = text_block("جرّبه 14 يوم مجانًا", 62, WHITE)
    paste_center(img, t, 200, ease(lt / 0.5))

    card(img, [400, 292, 880, 486], 26, WHITE, 255)
    p1 = text_block("250", 84, (12, 42, 40))
    paste_center(img, p1, 358, ease((lt - 0.35) / 0.5))
    p2 = text_block("جنيه في الشهر", 32, (110, 140, 136))
    paste_center(img, p2, 432, ease((lt - 0.55) / 0.5))

    sub = text_block("من غير بطاقة… ومن غير أي التزام", 36, TEAL_100)
    paste_center(img, sub, 566, ease((lt - 0.9) / 0.6))
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




# ═════════════ واجهة بوابة المريض ═════════════

def _phone_frame(shot, lt, k=0.0):
    """يحط شاشة البوابة جوه موبايل — عشان يبان إنه من جيب المريض."""
    base = bg((6, 30, 24), (10, 48, 38))
    glow(base, 640, 330, 520, (34, 197, 94), 40)
    grid(base, 44, (255, 255, 255), 6)

    pw, ph = 306, 568
    px0 = 640 - pw // 2
    py0 = 52

    # ظل
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([px0, py0 + 16, px0 + pw, py0 + ph + 16],
                                         radius=40, fill=(0, 0, 0, 150))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(20)))

    # جسم الموبايل
    body = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.rounded_rectangle([0, 0, pw - 1, ph - 1], radius=40, fill=(12, 22, 20, 255))
    base.paste(body, (px0, py0), body)

    # الشاشة
    inset, top_inset = 9, 26
    sw, shh = pw - inset * 2, ph - top_inset - 22
    screen = shot.convert("RGB").resize((sw, shh), Image.LANCZOS)
    mask = Image.new("L", (sw, shh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, shh - 1], radius=30, fill=255)
    base.paste(screen, (px0 + inset, py0 + top_inset), mask)

    # نوتش
    d = ImageDraw.Draw(base)
    d.rounded_rectangle([px0 + pw // 2 - 44, py0 + 12, px0 + pw // 2 + 44, py0 + 24],
                        radius=6, fill=(20, 30, 28))
    d.rounded_rectangle([px0, py0, px0 + pw, py0 + ph], radius=40,
                        outline=(60, 190, 130, 120), width=2)
    return base


def sc_portal_intro(lt):
    """17.6–20.6 : «وكل مريض عنده صفحته» — الموبايل بيظهر"""
    base = bg((6, 30, 24), (10, 48, 38))
    glow(base, 640, 360, 560, (34, 197, 94), 44)
    grid(base, 44, (255, 255, 255), 6)

    t1 = text_block("وكل مريض عنده صفحته", 50, WHITE)
    paste_center(base, t1, 620, ease(lt / 0.55))

    # موبايل.svg مبسّط: كود الدخول
    pw, ph = 300, 396
    px0, py0 = 640 - pw // 2, 96
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([px0, py0 + 14, px0 + pw, py0 + ph + 14],
                                         radius=36, fill=(0, 0, 0, 150))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle([px0, py0, px0 + pw, py0 + ph], radius=36, fill=(255, 255, 255))
    d.rounded_rectangle([px0, py0, px0 + pw, py0 + ph], radius=36,
                        outline=(34, 197, 94, 160), width=2)

    # شعار العيادة
    d.ellipse([px0 + pw // 2 - 27, py0 + 30, px0 + pw // 2 + 27, py0 + 84], fill=(22, 163, 74))
    ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ui.icon(ov, "pulse", px0 + pw // 2, py0 + 57, 13, (255, 255, 255))
    base.alpha_composite(ov)
    text_c(base, "عيادتي — بوابة المريض", px0 + pw // 2, py0 + 112, 15, (18, 33, 31), 900)
    text_c(base, "ادخل بكودك", px0 + pw // 2, py0 + 136, 12, (100, 116, 139), 700)

    # كود الدخول
    code = "4821"
    tw = 48
    for i, ch in enumerate(code):
        bx = px0 + pw // 2 + (1.5 - i) * (tw + 10) - tw / 2
        d.rounded_rectangle([bx, py0 + 162, bx + tw, py0 + 214], radius=12, fill=(238, 250, 241))
        text_c(base, ch, bx + tw / 2, py0 + 198, 26, (21, 128, 61), 900)

    # زر دخول
    a = ease((lt - 0.7) / 0.5)
    if a > 0:
        d.rounded_rectangle([px0 + 26, py0 + 240, px0 + pw - 26, py0 + 292],
                            radius=15, fill=(22, 163, 74))
        ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
        text_c(ov, "دخول", px0 + pw // 2, py0 + 275, 16, (255, 255, 255), 900)
        b = with_alpha(ov, a)
        if b:
            base.alpha_composite(b)

    text_c(base, "مفيش تحميل · مفيش حساب · كود وبس", px0 + pw // 2, py0 + 322, 11, (100, 116, 139), 700)
    return base




def frame_portal(img, lt, caption):
    """إطار شاشة كامل (بحجم مقروء) مع شارة إنها من موبايل المريض."""
    base = bg((5, 28, 22), (9, 44, 34))
    glow(base, 640, 300, 540, (34, 197, 94), 36)
    grid(base, 40, (255, 255, 255), 7)

    bx, by, bw, bh = 74, 30, 1132, 590
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([bx, by + 10, bx + bw, by + bh + 10],
                                         radius=20, fill=(0, 0, 0, 140))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))

    shot = img.convert("RGB").resize((bw, bh), Image.LANCZOS)
    mask = Image.new("L", (bw, bh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, bw - 1, bh - 1], radius=18, fill=255)
    base.paste(shot, (bx, by), mask)
    d = ImageDraw.Draw(base)
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=18,
                        outline=(34, 197, 94, 110), width=2)

    # شارة «من موبايل المريض»
    chip = text_block("من موبايل المريض", 22, (6, 40, 30))
    if chip:
        cw = chip.width + 46
        d.rounded_rectangle([bx + 18, by - 15, bx + 18 + cw, by + 21], radius=18,
                            fill=(74, 222, 128))
        base.alpha_composite(chip, (bx + 41, by - 15 + (36 - chip.height) // 2))

    # كابشن
    cap = text_block(caption, 40, WHITE)
    a = ease(lt / 0.5)
    b = with_alpha(cap, a)
    if b:
        pw = b.width + 58
        ph = max(60, b.height + 18)
        py0 = 714 - ph
        d.rounded_rectangle([(W - pw) // 2, py0, (W + pw) // 2, py0 + ph], radius=20,
                            fill=(22, 163, 74, int(230 * a)))
        base.alpha_composite(b, ((W - b.width) // 2, py0 + (ph - b.height) // 2))
    return base


def sc_portal_home(lt):
    """20.6–24.2 : الصفحة الرئيسية للمريض جوه موبايل"""
    shot = ui.SCREENS["portal_home"]().convert("RGB")
    return frame_portal(shot, lt, "المريض شايف موعده وتقدمه")


def sc_portal_log(lt):
    """24.2–27.6 : يسجّل قياسه من البيت"""
    shot = ui.SCREENS["portal_log"]().convert("RGB")
    return frame_portal(shot, lt, "يسجّل وزنه من البيت… ويوصل للدكتور")


def sc_portal_progress(lt):
    """29.0–31.4 : تقدمه لوحده"""
    shot = ui.SCREENS["portal_progress"]().convert("RGB")
    return frame_portal(shot, lt, "ويتابع تقدمه بنفسه")


def sc_portal_appt(lt):
    """27.6–29.4 : مواعيد المريض + تواصل مباشر"""
    shot = ui.SCREENS["portal_appointments"]().convert("RGB")
    return frame_portal(shot, lt, "ويتواصل معاك على طول")


def sc_referral(lt):
    """31.4–35.4 : الدعاية من فم لودن"""
    img = bg((8, 34, 30), (16, 64, 56))
    glow(img, 640, 400, 520, TEAL, 54)
    grid(img, 46, (255, 255, 255), 7)

    t1 = text_block("مريض مبسوط…", 56, WHITE)
    paste_center(img, t1, 118, ease(lt / 0.45))
    t2 = text_block("بيجيب اللي بعده", 56, TEAL_L)
    paste_center(img, t2, 190, ease((lt - 0.35) / 0.45))

    # صف من المرضى بيتزايدوا — دعاية بتنتشر
    names = ["منى", "هدى", "سارة", "ياسمين"]
    base_x, cy, gap = 640 + 288, 330, 192
    for i in range(4):
        a = ease((lt - 0.9 - i * 0.26) / 0.45)
        if a <= 0:
            continue
        cx = base_x - i * gap
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        # خط ربط
        if i < 3:
            d.line([(cx - 56, cy), (cx - gap + 56, cy)],
                   fill=(45, 212, 191, 190), width=5)
        r = 48
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  fill=(20, 184, 166) if i == 0 else (13, 148, 136))
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  outline=(94, 234, 212, 150), width=3)
        # حرف الاسم
        T.draw_center(lay, names[i][0], BOLD_F, 30, (255, 255, 255), cx, cy + 12)
        # علامة صح
        d.ellipse([cx + 24, cy + 24, cx + 58, cy + 58], fill=(74, 222, 128))
        d.line([(cx + 33, cy + 41), (cx + 40, cy + 48), (cx + 50, cy + 33)],
               fill=(6, 40, 30), width=4, joint="curve")
        b = with_alpha(lay, a)
        if b:
            img.alpha_composite(b)

    sub = text_block("جرّب ونزل… فإنت كمان عايز", 34, (206, 240, 232))
    paste_center(img, sub, 430, ease((lt - 1.9) / 0.5))

    # شريط ذهبي: دعاية ببلاش
    aa = ease((lt - 2.3) / 0.45)
    if aa > 0:
        pill = text_block("دعاية ببلاش — من فم لودن", 38, (255, 244, 200))
        if pill:
            pw = pill.width + 76
            lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            d = ImageDraw.Draw(lay)
            d.rounded_rectangle([640 - pw / 2, 496, 640 + pw / 2, 566], radius=24,
                                fill=(180, 100, 6))
            lay.alpha_composite(pill, (int(640 - pill.width / 2), 496 + (70 - pill.height) // 2))
            b = with_alpha(lay, aa)
            if b:
                img.alpha_composite(b)
    return img


def sc_doctor_bond(lt):
    """27.6–30.0 : الطبيب معاه أكتر"""
    img = bg((6, 30, 26), (12, 56, 46))
    glow(img, 640, 340, 460, (34, 197, 94), 46)
    grid(img, 46, (255, 255, 255), 7)

    t = text_block("الدكتور معاه… حتى وهو بعيد", 46, WHITE, max_w=980)
    paste_center(img, t, 130, ease(lt / 0.5))

    items = [("قياس من البيت", "يوصل للعيادة على طول"),
             ("تذكير واتساب", "قبل الموعد بيوم"),
             ("منحنى التقدم", "المريض شايفه بنفسه")]
    for i, (k, v) in enumerate(items):
        a = ease((lt - 0.5 - i * 0.22) / 0.5)
        if a <= 0:
            continue
        cx = 640 + (1 - i) * 330
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        d.rounded_rectangle([cx - 150, 236, cx + 150, 452], radius=24,
                            fill=(255, 255, 255, 248))
        d.rounded_rectangle([cx - 40, 264, cx + 40, 344], radius=20, fill=(230, 246, 237, 255))
        ui.icon(lay, ["pulse", "whatsapp", "chart"][i], cx, 304, 18, (21, 128, 61))
        text_c(lay, k, cx, 392, 17, (18, 33, 31), 900)
        for j, ln in enumerate(T.wrap(v, BOLD_F, 13, 250)):
            text_c(lay, ln, cx, 416 + j * 20, 13, (100, 116, 139), 700)
        b = with_alpha(lay, a)
        if b:
            img.alpha_composite(b)

    foot = text_block("علاقة بتكمّل… مش بتنتهي عند آخر جلسة", 36, TEAL_100)
    paste_center(img, foot, 540, ease((lt - 1.3) / 0.6))
    return img


def frame_ui_caption(img, lt, caption, _x):
    """كابشن تحتي على غير إطار المتصفح (للموبايل)."""
    cap = text_block(caption, 40, WHITE)
    a = ease(lt / 0.5)
    b = with_alpha(cap, a)
    if b:
        d = ImageDraw.Draw(img)
        pw = b.width + 52
        d.rounded_rectangle([(W - pw) // 2, 626, (W + pw) // 2, 626 + 58], radius=20,
                            fill=(22, 163, 74, int(228 * a)))
        img.alpha_composite(b, ((W - b.width) // 2, 626 + (58 - b.height) // 2))
    return img


def sc_after_hours(lt):
    """سؤال بعد مواعيد العيادة — بيوصل، مش بيضيع."""
    shot = ui.SCREENS["after_hours"]().convert("RGB")
    img = frame_portal(shot, lt, "مريض بيسأل الساعة 11 بالليل")
    return img


def sc_labs(lt):
    """التحاليل — سجل لكل تحليل بتاريخه ونتايجه."""
    src = ui.SCREENS["labs"]().convert("RGB").resize((W, H), Image.LANCZOS)
    k = ease((lt - 0.6) / 1.8) if lt > 0.6 else 0.0
    zoom = 1.01 + 0.035 * k
    img = zoom_pan(src, 1.0, z0=zoom, z1=zoom,
                   p0=(-0.035 * k, -0.03 * k), p1=(-0.035 * k, -0.03 * k))
    return frame_ui(img, lt, "كل تحليل… بتاريخه ونتايجه")


def sc_health(lt):
    """السكر والضغط من البيت — للطبيب."""
    src = ui.SCREENS["health"]().convert("RGB").resize((W, H), Image.LANCZOS)
    k = ease((lt - 0.8) / 1.8) if lt > 0.8 else 0.0
    zoom = 1.02 + 0.06 * k
    img = zoom_pan(src, 1.0, z0=zoom, z1=zoom,
                   p0=(0.0, 0.06 * k), p1=(0.0, 0.06 * k))
    return frame_ui(img, lt, "قراءات البيت… وتنبيه على الخطر")


def sc_portal_health(lt):
    """المريض يسجّل السكر والضغط من موبايله."""
    shot = ui.SCREENS["portal_health"]().convert("RGB")
    return frame_portal(shot, lt, "ويسجّلها لوحده… من البيت")


def sc_meds(lt):
    """الأدوية في ملف المريض — الطبيب شايفها مع كل زيارة."""
    src = ui.SCREENS["meds"]().convert("RGB").resize((W, H), Image.LANCZOS)
    k = ease((lt - 0.7) / 1.8) if lt > 0.7 else 0.0
    zoom = 1.01 + 0.03 * k
    img = zoom_pan(src, 1.0, z0=zoom, z1=zoom,
                   p0=(-0.02 * k, -0.03 * k), p1=(-0.02 * k, -0.03 * k))
    return frame_ui(img, lt, "والأدوية… مكتوبة في ملفه")


def sc_offhours_summary(lt):
    """مفيش مكالمات فايتة — كل سؤال في مكانه."""
    img = bg((8, 32, 30), (14, 60, 54))
    glow(img, 640, 380, 480, TEAL, 50)
    grid(img, 46, (255, 255, 255), 7)

    t1 = text_block("مش هتضيّع وقتك", 60, WHITE)
    paste_center(img, t1, 190, ease(lt / 0.5))
    t2 = text_block("ولا سؤال هيضيع", 44, TEAL_L)
    paste_center(img, t2, 268, ease((lt - 0.3) / 0.5))

    items = [("سؤال بعد المواعيد", "يوصل في قايمة الصبح", "38.0?"),
             ("قراءة خطر", "تنبيه فوري على الموبايل", ""),
             ("متابعة مستمرة", "المريض حاسس إنك معاه", "")]
    for i, (k, v, _) in enumerate(items):
        a = ease((lt - 0.8 - i * 0.25) / 0.45)
        if a <= 0:
            continue
        cy = 360 + i * 78
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        d.rounded_rectangle([300, cy, 980, cy + 64], radius=18, fill=(255, 255, 255, 246))
        d.ellipse([932, cy + 12, 972, cy + 52], fill=(230, 246, 237))
        d.line([(940, cy + 32), (948, cy + 41), (963, cy + 23)],
               fill=(21, 128, 61), width=4, joint="curve")
        T.draw_right(lay, k, BLACK_F, 20, (18, 33, 31), 872, cy + 40)
        T.draw_right(lay, v, BOLD_F, 14, (95, 118, 115), 640, cy + 40)
        b = with_alpha(lay, a)
        if b:
            img.alpha_composite(b)
    return img



def sc_plans(lt):
    """مكتبة خطط الدكتور — كل خططه في مكان واحد."""
    src = ui.SCREENS["plans"]().convert("RGB").resize((W, H), Image.LANCZOS)
    k = ease((lt - 0.5) / 1.6) if lt > 0.5 else 0.0
    zoom = 1.01 + 0.03 * k
    img = zoom_pan(src, 1.0, z0=zoom, z1=zoom, p0=(-0.02 * k, -0.02 * k), p1=(-0.02 * k, -0.02 * k))
    return frame_ui(img, lt, "خططك… تضيفها مرة واحدة")


def sc_assign_plan(lt):
    """ربط الخطة بمريض + تواريخ."""
    src = ui.SCREENS["assign_plan"]().convert("RGB").resize((W, H), Image.LANCZOS)
    return frame_ui(src, lt, "وتربطها بأي مريض… بضغطة")


def sc_wa_plan(lt):
    """إرسال الخطة كاملة على واتساب بضغطة."""
    shot = ui.SCREENS["wa_plan"]().convert("RGB").resize((W, H), Image.LANCZOS)
    # إجراء الدكتور — إطار متصفح مش شارة موبايل المريض
    return frame_ui(shot, lt, "وتبعتها واتساب… بضغطة")


def sc_portal_plan(lt):
    """المريض يشوف خطته: يوم كام من كام + وجبات النهاردة."""
    shot = ui.SCREENS["portal_plan"]().convert("RGB")
    return frame_portal(shot, lt, "والمريض شايف يومه ووجباته")

SCENES = [
    (0.00, 2.06, sc_pain),
    (2.06, 3.38, sc_question),
    (3.38, 6.68, sc_after_hours),
    (6.68, 8.16, sc_offhours_summary),
    (8.16, 10.32, sc_intro),
    (10.32, 13.90, sc_labs),
    (13.90, 17.62, sc_plans),
    (17.62, 21.70, sc_assign_plan),
    (21.70, 26.84, sc_wa_plan),
    (26.84, 32.54, sc_portal_plan),
    (32.54, 36.02, sc_portal_intro),
    (36.02, 39.20, sc_portal_health),
    (39.20, 42.90, sc_meds),
    (42.90, 46.44, sc_doctor_bond),
    (46.44, 51.24, sc_referral),
    (51.24, 56.86, sc_price),
    (56.86, 58.87, sc_end),
]


DURATION = 58.87


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
