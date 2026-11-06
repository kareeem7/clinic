"""رسم شاشات «عيادتي» الحقيقية — نفس الألوان والخط والهيكل اللي في css/.

البيئة مش بتسمح بتشغيل متصفح (كروميوم بيفشل)، فبنعيد بناء الواجهة بالكود
بنفس الـ CSS variables من css/variables.css عشان اللقطات تطابق الموقع.
"""
import math
from PIL import Image, ImageDraw, ImageFilter

import artext as T

BLACK = "/tmp/CairoFull-Black.ttf"
BOLD = "/tmp/CairoFull-Bold.ttf"

# من css/variables.css
TEAL900 = (8, 54, 52)
TEAL800 = (12, 79, 74)
TEAL700 = (15, 118, 110)
TEAL600 = (13, 148, 136)
TEAL500 = (20, 184, 166)
TEAL100 = (201, 240, 236)
TEAL50 = (238, 250, 248)
AMBER = (217, 119, 6)
AMBER_SOFT = (253, 241, 222)
ROSE = (225, 29, 72)
ROSE_SOFT = (253, 232, 237)
BLUE = (37, 99, 235)
BLUE_SOFT = (230, 238, 253)
GREEN = (22, 163, 74)
GREEN_SOFT = (229, 246, 235)
VIOLET = (124, 58, 237)
VIOLET_SOFT = (240, 233, 253)
BG = (242, 246, 246)
SURFACE = (255, 255, 255)
INK = (18, 33, 31)
MUTED = (100, 116, 139)
LINE = (227, 235, 235)
SIDEBAR_W = 266

S = 1.5          # نرسم بدقة أعلى ثم نصغّر — يطلع أنضف
W, H = int(1280 * S), int(720 * S)


def px(v):
    return int(round(v * S))


def font_for(weight):
    return BLACK if weight >= 800 else BOLD


# ───────────────────────── أدوات رسم ─────────────────────────

def rrect(d, box, r, fill=None, outline=None, width=1):
    x0, y0, x1, y1 = [px(v) for v in box]
    d.rounded_rectangle([x0, y0, x1, y1], radius=px(r), fill=fill,
                        outline=outline, width=int(width * S))


def text_r(dst, s, x_right, y_base, size, color, weight=700):
    T.draw_right(dst, s, font_for(weight), px(size), color, px(x_right), px(y_base))


def text_c(dst, s, cx, y_base, size, color, weight=700):
    T.draw_center(dst, s, font_for(weight), px(size), color, px(cx), px(y_base))


def text_l(dst, s, x_left, y_base, size, color, weight=700):
    w = T.measure(s, font_for(weight), px(size))[0]
    T.draw_right(dst, s, font_for(weight), px(size), color,
                 px(x_left) + int(w), px(y_base))


def line(d, p1, p2, color, width=1):
    d.line([px(p1[0]), px(p1[1]), px(p2[0]), px(p2[1])], fill=color,
           width=max(1, int(width * S)))


# ───────────────────────── أيقونات مبسطة ─────────────────────────

def icon(dst, kind, cx, cy, size, color):
    """أيقونات هندسية بسيطة بدل خط FontAwesome."""
    d = ImageDraw.Draw(dst)
    s = size
    if kind == "home":
        pts = [(cx - s, cy + s * 0.1), (cx, cy - s * 0.8), (cx + s, cy + s * 0.1)]
        d.line([(px(x), px(y)) for x, y in pts], fill=color, width=max(2, int(s * 0.28)))
        rrect(d, (cx - s * 0.66, cy - s * 0.05, cx + s * 0.66, cy + s * 0.85), s * 0.14, outline=color, width=s * 0.2)
    elif kind == "users":
        d.ellipse([px(cx - s * 0.45), px(cy - s * 0.85), px(cx + s * 0.25), px(cy - s * 0.15)], outline=color, width=max(2, int(s * 0.2)))
        d.arc([px(cx - s * 0.85), px(cy - s * 0.25), px(cx + s * 0.65), px(cy + s * 0.95)], 180, 360, fill=color, width=max(2, int(s * 0.2)))
    elif kind == "calendar":
        rrect(d, (cx - s * 0.8, cy - s * 0.65, cx + s * 0.8, cy + s * 0.8), s * 0.16, outline=color, width=s * 0.18)
        line(d, (cx - s * 0.8, cy - s * 0.18), (cx + s * 0.8, cy - s * 0.18), color, s * 0.18)
    elif kind == "chart":
        for i, hh in enumerate((0.45, 0.8, 0.6)):
            x = cx - s * 0.6 + i * s * 0.6
            rrect(d, (x, cy + s * 0.7 - s * hh, x + s * 0.34, cy + s * 0.7), s * 0.1, color)
    elif kind == "gear":
        d.ellipse([px(cx - s * 0.62), px(cy - s * 0.62), px(cx + s * 0.62), px(cy + s * 0.62)],
                  outline=color, width=max(2, int(s * 0.22)))
    elif kind == "pulse":
        pts = [(cx - s, cy), (cx - s * 0.35, cy), (cx - s * 0.05, cy - s * 0.7),
               (cx + s * 0.3, cy + s * 0.7), (cx + s * 0.6, cy), (cx + s, cy)]
        d.line([(px(x), px(y)) for x, y in pts], fill=color, width=max(2, int(s * 0.22)), joint="curve")
    elif kind == "plus":
        line(d, (cx - s * 0.6, cy), (cx + s * 0.6, cy), color, s * 0.26)
        line(d, (cx, cy - s * 0.6), (cx, cy + s * 0.6), color, s * 0.26)
    elif kind == "link":
        # حلقتين أفقيتين متشابكتين (زي أيقونة الرابط)
        d.rounded_rectangle([px(cx - s), px(cy - s * 0.42), px(cx + s * 0.2), px(cy + s * 0.42)],
                            radius=px(s * 0.42), outline=color, width=max(2, int(s * 0.24)))
        d.rounded_rectangle([px(cx - s * 0.2), px(cy - s * 0.42), px(cx + s), px(cy + s * 0.42)],
                            radius=px(s * 0.42), outline=color, width=max(2, int(s * 0.24)))
    elif kind == "star":
        pts = []
        import math as _m
        for k in range(10):
            ang = -_m.pi / 2 + k * _m.pi / 5
            rr = s if k % 2 == 0 else s * 0.45
            pts.append((cx + rr * _m.cos(ang), cy + rr * _m.sin(ang)))
        d.polygon([(px(x), px(y)) for x, y in pts], fill=color)
    elif kind == "meal":
        d.ellipse([px(cx - s * 0.95), px(cy - s * 0.5), px(cx + s * 0.95), px(cy + s * 0.9)],
                  outline=color, width=max(2, int(s * 0.18)))
        d.ellipse([px(cx - s * 0.55), px(cy - s * 0.15), px(cx + s * 0.55), px(cy + s * 0.55)],
                  fill=color)
        line(d, (cx - s * 0.2, cy - s * 0.9), (cx - s * 0.2, cy - s * 0.3), color, s * 0.16)
        line(d, (cx + s * 0.2, cy - s * 0.9), (cx + s * 0.2, cy - s * 0.3), color, s * 0.16)
    elif kind == "flask":
        line(d, (cx - s * 0.2, cy - s * 0.9), (cx - s * 0.2, cy - s * 0.1), color, s * 0.2)
        line(d, (cx + s * 0.2, cy - s * 0.9), (cx + s * 0.2, cy - s * 0.1), color, s * 0.2)
        d.line([(px(cx - s * 0.7), px(cy + s * 0.85)), (px(cx - s * 0.2), px(cy - s * 0.1)),
                (px(cx + s * 0.2), px(cy - s * 0.1)), (px(cx + s * 0.7), px(cy + s * 0.85)),
                (px(cx - s * 0.7), px(cy + s * 0.85))], fill=color,
               width=max(2, int(s * 0.2)), joint="curve")
    elif kind == "pill":
        d.rounded_rectangle([px(cx - s * 0.95), px(cy - s * 0.45), px(cx + s * 0.95), px(cy + s * 0.45)],
                            radius=px(s * 0.45), outline=color, width=max(2, int(s * 0.18)))
        line(d, (cx, cy - s * 0.45), (cx, cy + s * 0.45), color, s * 0.16)
    elif kind == "drop":
        d.ellipse([px(cx - s * 0.62), px(cy - s * 0.1), px(cx + s * 0.62), px(cy + s * 0.95)], fill=color)
        d.polygon([(px(cx), px(cy - s * 0.95)), (px(cx - s * 0.55), px(cy + s * 0.15)),
                   (px(cx + s * 0.55), px(cy + s * 0.15))], fill=color)
    elif kind == "alert":
        d.polygon([(px(cx), px(cy - s)), (px(cx + s), px(cy + s * 0.8)), (px(cx - s), px(cy + s * 0.8))],
                  outline=color, width=max(2, int(s * 0.18)))
        line(d, (cx, cy - s * 0.35), (cx, cy + s * 0.28), color, s * 0.22)
        d.ellipse([px(cx - s * 0.09), px(cy + s * 0.45), px(cx + s * 0.09), px(cy + s * 0.63)], fill=color)
    elif kind == "moon":
        d.ellipse([px(cx - s * 0.9), px(cy - s * 0.9), px(cx + s * 0.9), px(cy + s * 0.9)],
                  outline=color, width=max(2, int(s * 0.18)))
        d.ellipse([px(cx - s * 0.25), px(cy - s * 1.05), px(cx + s * 1.05), px(cy + s * 0.35)],
                  fill=(255, 255, 255))
    elif kind == "whatsapp":
        d.ellipse([px(cx - s), px(cy - s), px(cx + s), px(cy + s)], fill=color)
        pts = [(cx - s * 0.42, cy + s * 0.05), (cx - s * 0.1, cy - s * 0.42),
               (cx + s * 0.42, cy - s * 0.05), (cx + s * 0.05, cy + s * 0.45)]
        d.line([(px(x), px(y)) for x, y in pts], fill=(255, 255, 255), width=max(2, int(s * 0.3)))


# ───────────────────────── هيكل التطبيق ─────────────────────────

NAV = [("الرئيسية", "home", True), ("المرضى", "users", False),
       ("المواعيد", "calendar", False), ("خطط التغذية", "chart", False),
       ("الإعدادات", "gear", False)]


def shell(active="الرئيسية", title="الرئيسية", subtitle="الخميس، 6 نوفمبر 2025",
          offset=(0, 0)):
    """واجهة التطبيق كاملة (RTL): الشريط الجانبي على اليمين، المحتوى على الشمال."""
    img = Image.new("RGBA", (W, H), BG + (255,))
    d = ImageDraw.Draw(img)

    # الشريط الجانبي — على اليمين (inset-inline-start في RTL)
    SX = 1280 - SIDEBAR_W
    sb = Image.new("RGBA", (px(SIDEBAR_W), H), TEAL900 + (255,))
    sd = ImageDraw.Draw(sb)
    for y in range(H):
        t = y / H
        c = tuple(int(TEAL900[i] + (TEAL800[i] - TEAL900[i]) * min(1, t * 1.35)) for i in range(3))
        sd.line([(0, y), (px(SIDEBAR_W), y)], fill=c + (255,))
    img.alpha_composite(sb, (px(SX), 0))
    d = ImageDraw.Draw(img)

    R = 1280 - 22          # الحافة اليمنى للشريط الجانبي

    # اللوجو
    rrect(d, (R - 44, 28, R, 72), 14, fill=TEAL500)
    icon(img, "pulse", R - 22, 50, 12, (255, 255, 255))
    text_r(img, "عيادتي", R - 56, 54, 19, (255, 255, 255), 900)
    text_r(img, "مركز الشروق", R - 56, 76, 11.5, (142, 207, 199), 600)
    line(d, (SX + 22, 96), (R, 96), (255, 255, 255, 46), 1)

    # عناصر القائمة
    y = 124
    for label, ic, _ in NAV:
        is_active = label == active
        if is_active:
            rrect(d, (SX + 16, y - 22, R, y + 24), 13, fill=TEAL600)
        icon(img, ic, R - 22, y, 9.5, (255, 255, 255) if is_active else (169, 216, 210))
        text_r(img, label, R - 44, y + 8, 14.5,
               (255, 255, 255) if is_active else (169, 216, 210), 700)
        y += 52

    # بطاقة المستخدم
    uy = 720 - 116
    rrect(d, (SX + 16, uy, R, uy + 74), 15, fill=(255, 255, 255, 22))
    d.ellipse([px(R - 74), px(uy + 16), px(R - 30), px(uy + 60)], fill=TEAL600)
    icon(img, "users", R - 52, uy + 38, 10, (255, 255, 255))
    text_r(img, "د. أحمد سامي", R - 86, uy + 40, 13.5, (255, 255, 255), 800)
    text_r(img, "حساب الدكتور", R - 86, uy + 58, 10.5, (142, 207, 199), 600)

    # الشريط العلوي
    top_h = 66
    rrect(d, (0, 0, SX, top_h), 0, fill=(250, 252, 252))
    line(d, (0, top_h), (SX, top_h), LINE, 1)
    text_r(img, title, SX - 26, 36, 20, INK, 900)
    text_r(img, subtitle, SX - 26, 56, 12, MUTED, 600)
    # زر مريض جديد — على الشمال
    rrect(d, (24, 17, 128, 50), 10, fill=TEAL600)
    icon(img, "plus", 44, 33, 6, (255, 255, 255))
    text_c(img, "مريض جديد", 92, 39, 11, (255, 255, 255), 800)
    return img, d


def kpi_card(img, d, x, y, w, ic, ic_bg, ic_col, value, label, sub, sub_col):
    rrect(d, (x, y, x + w, y + 84), 16, fill=SURFACE, outline=LINE, width=1)
    rrect(d, (x + 16, y + 17, x + 66, y + 67), 15, fill=ic_bg)
    icon(img, ic, x + 41, y + 42, 10, ic_col)
    text_r(img, str(value), x + w - 16, y + 36, 22, INK, 900)
    text_r(img, label, x + w - 16, y + 54, 11.5, MUTED, 700)
    text_r(img, sub, x + w - 16, y + 72, 10.5, sub_col, 700)


def card(img, d, x, y, w, h, title, icon_kind=TEAL600):
    rrect(d, (x, y, x + w, y + h), 22, fill=SURFACE, outline=LINE, width=1)
    if title:
        icon(img, "chart", x + w - 26, y + 28, 8, icon_kind)
        text_r(img, title, x + w - 42, y + 34, 15.5, INK, 800)


# ───────────────────────── الشاشات ─────────────────────────

def screen_dashboard():
    img, d = shell("الرئيسية", "الرئيسية", "الخميس، 6 نوفمبر 2025")
    x0 = 26
    cw = 1014 - 26

    text_r(img, "صباح الخير، د. أحمد", x0 + cw - 26, 108, 23, INK, 900)
    text_r(img, "عندك 3 مواعيد النهاردة — و2 محتاجين متابعة", x0 + cw - 26, 130, 12.5, MUTED, 600)

    # بطاقات المؤشرات
    kw = (cw - 26 * 2 - 48) / 4
    for i, args in enumerate([
        ("users", TEAL50, TEAL600, 42, "إجمالي المرضى", "+5 نشط الآن", GREEN),
        ("calendar", BLUE_SOFT, BLUE, 3, "مواعيد اليوم", "2 مؤكدة", MUTED),
        ("plus", GREEN_SOFT, GREEN, 7, "مرضى جدد هذا الشهر", "انضموا في نوفمبر", GREEN),
        ("chart", AMBER_SOFT, AMBER, 3, "خطط تغذية نشطة", "من إجمالي 5 خطة", MUTED),
    ]):
        kpi_card(img, d, x0 + i * (kw + 16), 152, kw, *args)

    # رسم الزيارات
    card(img, d, x0, 256, cw * 0.62 - 8, 214, "الزيارات والجلسات — آخر 6 أشهر")
    cx, cy, cw2, ch = x0 + 24, 322, cw * 0.62 - 56, 116
    for i in range(4):
        yy = cy + i * (ch / 3)
        line(d, (cx, yy), (cx + cw2, yy), (237, 243, 242), 1)
    pts = [0.30, 0.45, 0.40, 0.62, 0.70, 0.92]
    coords = [(cx + i * (cw2 / 5), cy + ch - p * ch) for i, p in enumerate(pts)]
    poly = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(poly)
    pd.polygon([(px(x), px(y)) for x, y in coords] + [(px(cx + cw2), px(cy + ch)), (px(cx), px(cy + ch))],
               fill=TEAL600 + (52,))
    img.alpha_composite(poly)
    d = ImageDraw.Draw(img)
    d.line([(px(x), px(y)) for x, y in coords], fill=TEAL600, width=int(3 * S), joint="curve")
    for x, y in coords:
        d.ellipse([px(x - 4), px(y - 4), px(x + 4), px(y + 4)], fill=(255, 255, 255),
                  outline=TEAL600, width=int(2.5 * S))
    for i, m in enumerate(["يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر"]):
        text_c(img, m, cx + i * (cw2 / 5), cy + ch + 22, 10.5, MUTED, 600)

    # توزيع المرضى (دونات)
    rx = x0 + cw * 0.62 + 8
    card(img, d, rx, 256, cw * 0.38 - 26 + 26, 214, "توزيع المرضى")
    ccx, ccy, rr = rx + (cw * 0.38) / 2, 372, 52
    d.ellipse([px(ccx - rr), px(ccy - rr), px(ccx + rr), px(ccy + rr)], outline=(237, 243, 242), width=int(18 * S))
    d.arc([px(ccx - rr), px(ccy - rr), px(ccx + rr), px(ccy + rr)], -90, 130,
          fill=TEAL600, width=int(18 * S))
    d.arc([px(ccx - rr), px(ccy - rr), px(ccx + rr), px(ccy + rr)], 130, 270,
          fill=AMBER, width=int(18 * S))
    text_c(img, "42", ccx, ccy + 4, 22, INK, 900)
    text_c(img, "مريض", ccx, ccy + 22, 10, MUTED, 700)
    for i, (lab, col) in enumerate([("علاج طبيعي", TEAL600), ("سمنة ونحافة", AMBER)]):
        ly = 440 + i * 17
        d.ellipse([px(rx + 34), px(ly - 5), px(rx + 43), px(ly + 4)], fill=col)
        text_r(img, lab, rx + 118, ly + 4, 10.5, MUTED, 700)

    # مواعيد اليوم
    card(img, d, x0, 484, cw - 26, 202, "مواعيد اليوم")
    appts = [("منى عبد الرحمن", "17:00", "متابعة شهرية", GREEN, "مؤكد"),
             ("محمود فتحي", "18:00", "جلسة 5", GREEN, "مؤكد"),
             ("سارة إبراهيم", "19:00", "جلسة 3", AMBER, "انتظار")]
    for i, (name, tm, note, col, st) in enumerate(appts):
        y = 536 + i * 46
        rrect(d, (x0 + 22, y, x0 + cw - 48, y + 40), 16, fill=(255, 255, 255), outline=LINE, width=1)
        d.rounded_rectangle([px(x0 + 22), px(y), px(x0 + 26), px(y + 40)], radius=px(2), fill=col)
        rrect(d, (x0 + 34, y + 6, x0 + 108, y + 34), 12, fill=TEAL50)
        text_c(img, tm, x0 + 71, y + 26, 12.5, TEAL800, 900)
        text_r(img, name, x0 + cw - 100, y + 26, 14, INK, 800)
        text_r(img, note, x0 + cw - 300, y + 26, 11, MUTED, 700)
        icon(img, "whatsapp", x0 + cw - 74, y + 20, 8, (37, 211, 102))
    return img


def screen_patients():
    img, d = shell("المرضى", "المرضى", "42 مريض — 38 نشط")
    x0 = 26
    cw = 1014 - 26

    rrect(d, (x0, 96, x0 + cw - 26, 664), 22, fill=SURFACE, outline=LINE, width=1)
    # تبويبات
    rrect(d, (x0 + 14, 110, x0 + 336, 154), 13, fill=(238, 243, 242))
    tx = x0 + 330
    for lab, tw, act in [("الكل", 62, True), ("علاج طبيعي", 96, False), ("سمنة ونحافة", 108, False)]:
        if act:
            rrect(d, (tx - tw, 114, tx - 4, 150), 10, fill=(255, 255, 255))
        text_c(img, lab, tx - tw / 2 - 2, 137, 10, TEAL700 if act else (91, 118, 115), 800)
        tx -= tw + 4
    # بحث
    rrect(d, (x0 + cw - 320, 114, x0 + cw - 44, 150), 12, fill=(247, 250, 249), outline=LINE, width=1)
    text_r(img, "ابحث بالاسم أو رقم الموبايل...", x0 + cw - 56, 137, 11.5, (150, 165, 163), 600)

    # رأس الجدول
    heads = [("المريض", 0.30), ("التخصص", 0.52), ("التشخيص / الهدف", 0.72), ("آخر متابعة", 0.86), ("", 1.0)]
    for lab, fx in heads:
        if lab:
            text_r(img, lab, x0 + 30 + (cw - 60) * fx, 184, 10.5, MUTED, 800)
    line(d, (x0 + 20, 194), (x0 + cw - 46, 194), LINE, 1.5)

    rows = [("منى عبد الرحمن", "+201900000101", "سمنة ونحافة", "برنامج إنقاص 12 كجم", "منذ 3 أيام", TEAL50, TEAL600),
            ("محمود فتحي", "+201900000103", "علاج طبيعي", "ديسك أسفل الظهر L4-L5", "منذ 5 أيام", BLUE_SOFT, BLUE),
            ("سارة إبراهيم", "+201900000104", "علاج طبيعي", "تأهيل ركبة بعد ACL", "أمس", BLUE_SOFT, BLUE),
            ("هدى مصطفى", "+201900000102", "سمنة ونحافة", "تثبيت وزن بعد نزول 14 كجم", "منذ أسبوع", TEAL50, TEAL600),
            ("أحمد عبد الله", "+201900000105", "سمنة ونحافة", "برنامج زيادة وزن", "منذ 12 يوم", TEAL50, TEAL600),
            ("نور حسن", "+201900000106", "علاج طبيعي", "تأهيل ما بعد كسر", "منذ 9 أيام", BLUE_SOFT, BLUE),
            ("كريم فؤاد", "+201900000107", "سمنة ونحافة", "برنامج إنقاص 8 كجم", "منذ 3 أسابيع", TEAL50, TEAL600)]
    for i, (name, phone, spec, diag, last, chip_bg, chip_col) in enumerate(rows):
        y = 206 + i * 58
        if i % 2 == 1:
            d.rectangle([px(x0 + 20), px(y), px(x0 + cw - 46), px(y + 56)], fill=(250, 252, 252))
        d.ellipse([px(x0 + 30), px(y + 8), px(x0 + 74), px(y + 52)], fill=chip_bg)
        text_c(img, name.strip()[0], x0 + 52, y + 37, 17, chip_col, 900)
        text_r(img, name, x0 + 30 + (cw - 60) * 0.245, y + 34, 14, INK, 800)
        text_r(img, phone, x0 + 30 + (cw - 60) * 0.245, y + 48, 11, MUTED, 600)
        rrect(d, (x0 + 30 + (cw - 60) * 0.52 - 62, y + 15, x0 + 30 + (cw - 60) * 0.52, y + 41), 10,
              fill=chip_bg)
        text_c(img, spec, x0 + 30 + (cw - 60) * 0.52 - 31, y + 33, 10.5, chip_col, 800)
        text_r(img, diag, x0 + 30 + (cw - 60) * 0.86, y + 38, 12.5, (61, 86, 84), 700)
        text_r(img, last, x0 + cw - 52, y + 38, 11, MUTED, 600)
        line(d, (x0 + 30, y + 56), (x0 + cw - 56, y + 56), (238, 243, 242), 1)
    return img


def screen_patient():
    img, d = shell("المرضى", "ملف المريض", "منى عبد الرحمن — سمنة ونحافة")
    x0 = 26
    cw = 1014 - 26

    # بطاقة المريض
    rrect(d, (x0, 92, x0 + cw - 26, 196), 22, fill=SURFACE, outline=LINE, width=1)
    d.ellipse([px(x0 + 24), px(110), px(x0 + 108), px(194)], fill=TEAL50)
    text_c(img, "م", x0 + 66, 166, 32, TEAL600, 900)
    text_r(img, "منى عبد الرحمن", x0 + cw - 44, 132, 22, INK, 900)
    text_r(img, "34 سنة · 165 سم · سمنة ونحافة · +201900000101", x0 + cw - 44, 156, 11.5, MUTED, 600)
    for i, (lab, val) in enumerate([("الوزن الحالي", "83.2 كجم"), ("المستهدف", "72 كجم"),
                                   ("الجلسات", "8 من 12")]):
        bx = x0 + 132 + i * 152
        rrect(d, (bx, 118, bx + 140, 176), 14, fill=(247, 250, 249))
        text_r(img, lab, bx + 128, 140, 10.5, MUTED, 700)
        text_r(img, val, bx + 128, 164, 15, TEAL700, 900)

    # المنحنى — المشهد المهم
    card(img, d, x0, 210, cw * 0.60 - 6, 240, "منحنى الوزن — 8 قياسات")
    cx, cy, cw2, ch = x0 + 34, 268, cw * 0.60 - 6 - 68, 140
    for i in range(5):
        yy = cy + i * (ch / 4)
        line(d, (cx, yy), (cx + cw2, yy), (237, 243, 242), 1)
    vals = [92.4, 91.0, 90.2, 88.6, 87.1, 85.8, 84.0, 83.2]
    lo, hi = 80.0, 94.0
    pts = [(cx + i * (cw2 / (len(vals) - 1)), cy + ch - ((v - lo) / (hi - lo)) * ch)
           for i, v in enumerate(vals)]
    under = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ud = ImageDraw.Draw(under)
    ud.polygon([(px(x), px(y)) for x, y in pts] + [(px(cx + cw2), px(cy + ch)), (px(cx), px(cy + ch))],
               fill=TEAL600 + (40,))
    img.alpha_composite(under)
    d = ImageDraw.Draw(img)
    d.line([(px(x), px(y)) for x, y in pts], fill=TEAL600, width=int(3.2 * S), joint="curve")
    for x, y in pts:
        d.ellipse([px(x - 5), px(y - 5), px(x + 5), px(y + 5)], fill=(255, 255, 255),
                  outline=TEAL600, width=int(2.6 * S))
    text_c(img, "92.4", cx, cy - 6, 10.5, MUTED, 700)
    text_c(img, "83.2", cx + cw2, cy + ch - 46, 10.5, TEAL700, 800)
    rrect(d, (cx + cw2 - 150, cy + 12, cx + cw2, cy + 46), 12, fill=TEAL50)
    text_c(img, "9.2 كجم أقل", cx + cw2 - 75, cy + 38, 13, TEAL700, 900)

    # القياسات
    card(img, d, x0 + cw * 0.60, 210, cw * 0.40 - 26, 240, "آخر القياسات")
    meas = [("6 نوفمبر", "83.2 كجم", "29.4"), ("9 أكتوبر", "85.8 كجم", "31.0"),
            ("11 سبتمبر", "88.6 كجم", "32.6")]
    for i, (dt, wt, bmi) in enumerate(meas):
        y = 266 + i * 56
        rrect(d, (x0 + cw * 0.60 + 16, y, x0 + cw - 44, y + 46), 14, fill=(247, 250, 249))
        text_r(img, wt, x0 + cw - 58, y + 30, 14, TEAL700, 900)
        text_r(img, dt, x0 + cw - 170, y + 29, 11.5, INK, 700)
        text_r(img, "BMI " + bmi, x0 + cw - 250, y + 29, 11, MUTED, 600)

    # خطة التغذية
    card(img, d, x0, 462, cw * 0.60 - 6, 200, "خطة التغذية النشطة")
    for i, (meal, txt) in enumerate([("الفطار", "بيض + جبن قريش + خضار"),
                                     ("الغدا", "فراخ مشوية + رز + سلطة"),
                                     ("العشا", "زبادي + فاكهة")]):
        y = 516 + i * 44
        rrect(d, (x0 + 20, y - 22, x0 + 96, y + 12), 10, fill=AMBER_SOFT)
        text_c(img, meal, x0 + 58, y + 4, 10.5, (146, 96, 10), 800)
        text_r(img, txt, x0 + cw * 0.60 - 30, y + 4, 12.5, (40, 62, 60), 700)

    # تنبيه
    rrect(d, (x0 + cw * 0.60, 462, x0 + cw - 26, 662), 22, fill=TEAL50, outline=TEAL100, width=1.5)
    icon(img, "pulse", x0 + cw * 0.60 + cw * 0.20 - 20, 512, 14, TEAL600)
    text_c(img, "التزام ممتاز", x0 + cw * 0.60 + cw * 0.20 - 20, 566, 17, TEAL700, 900)
    text_c(img, "نزلت 9.2 كجم في 6 شهور", x0 + cw * 0.60 + cw * 0.20 - 20, 594, 12.5, (11, 94, 88), 700)
    text_c(img, "بعد 8 قياسات مسجلة", x0 + cw * 0.60 + cw * 0.20 - 20, 616, 11, MUTED, 600)
    return img


def screen_appointments():
    img, d = shell("المواعيد", "المواعيد", "الأسبوع 3 – 9 نوفمبر")
    x0 = 26
    cw = 1014 - 26

    # شريط الأيام
    days = [("السبت", "3"), ("الأحد", "4"), ("الاتنين", "5"), ("التلات", "6", True),
            ("الأربع", "7"), ("الخميس", "8"), ("الجمعة", "9")]
    dw = (cw - 26 - 48) / 7
    for i, item in enumerate(days):
        i = len(days) - 1 - i
        name, num = item[0], item[1]
        sel = len(item) > 2
        bx = x0 + i * (dw + 8)
        if sel:
            rrect(d, (bx, 100, bx + dw, 168), 16, fill=TEAL600)
        else:
            rrect(d, (bx, 100, bx + dw, 168), 16, fill=SURFACE, outline=LINE, width=1.5)
        text_c(img, name, bx + dw / 2, 124, 10.5, (201, 240, 236) if sel else MUTED, 700)
        text_c(img, num, bx + dw / 2, 150, 16, (255, 255, 255) if sel else INK, 900)
        for k in range(2 if i % 2 == 0 else 1):
            cc = (255, 255, 255) if sel else TEAL500
            d.ellipse([px(bx + dw / 2 - 8 + k * 9), px(158), px(bx + dw / 2 - 3 + k * 9), px(163)], fill=cc)

    # القائمة
    card(img, d, x0, 186, cw - 26, 476, "")
    text_r(img, "مواعيد اليوم — 3 مواعيد", x0 + cw - 48, 218, 15.5, INK, 800)
    appts = [("17:00", "منى عبد الرحمن", "متابعة شهرية", GREEN, "مؤكد", "متابعة"),
             ("18:00", "محمود فتحي", "جلسة 5 — علاج طبيعي", GREEN, "مؤكد", "جلسة"),
             ("19:00", "سارة إبراهيم", "جلسة 3 — تأهيل ركبة", AMBER, "انتظار", "جلسة"),
             ("20:00", "هدى مصطفى", "استشارة أولى", TEAL600, "جديد", "استشارة")]
    for i, (tm, name, note, col, st, _kind) in enumerate(appts):
        y = 246 + i * 74
        right = x0 + cw - 46
        rrect(d, (x0 + 20, y, right, y + 64), 16, fill=(255, 255, 255), outline=LINE, width=1.5)
        # شريط حالة على اليمين (border-inline-start)
        d.rounded_rectangle([px(right - 4), px(y), px(right), px(y + 64)], radius=px(2), fill=col)
        # بلوك الوقت — أقصى اليمين زي الموقع
        rrect(d, (right - 116, y + 12, right - 20, y + 52), 12, fill=TEAL50)
        text_c(img, tm, right - 68, y + 39, 14.5, TEAL800, 900)
        # اسم المريض والملاحظة
        text_r(img, name, right - 136, y + 32, 14.5, INK, 800)
        text_r(img, note, right - 136, y + 52, 11.5, MUTED, 700)
        # شريحة الحالة
        rrect(d, (x0 + 190, y + 18, x0 + 270, y + 46), 10, fill=(240, 250, 248))
        text_c(img, st, x0 + 230, y + 38, 10.5, col, 800)
        # زر تذكير واتساب — أقصى الشمال
        rrect(d, (x0 + 34, y + 14, x0 + 186, y + 50), 10, fill=(37, 211, 102))
        icon(img, "whatsapp", x0 + 56, y + 32, 7.5, (255, 255, 255))
        text_c(img, "تذكير واتساب", x0 + 132, y + 38, 10.5, (255, 255, 255), 800)
    return img




# ═════════════════════ بوابة المريض (المرحلة 14) ═════════════════════
# من css/portal.css: أخضر #16a34a / #15803d، كروت 22px، عرض أقصى 680px

GREEN_P = (22, 163, 74)
GREEN_D = (21, 128, 61)
GREEN_L = (34, 197, 94)
P_BG = (242, 246, 246)


def _portal_base():
    """خلفية البوابة: تدرّج أخضر فاتح لفوق + عرض 680px في النص."""
    img = Image.new("RGBA", (W, H), P_BG + (255,))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = min(1.0, y / (H * 0.40))
        c = tuple(int((234, 246, 235)[i] + (P_BG[i] - (234, 246, 235)[i]) * t) for i in range(3))
        d.line([(0, y), (W, y)], fill=c + (255,))
    return img, d


def _portal_top(img, d, header="#15803d"):
    """الشريط العلوي للبوابة."""
    cx0, cx1 = 300, 980            # عرض 680px متمركز
    d.ellipse([px(cx1 - 58), px(20), px(cx1 - 16), px(62)], fill=GREEN_P)
    icon(img, "pulse", cx1 - 37, 41, 11, (255, 255, 255))
    text_r(img, "مركز الشروق", cx1 - 70, 38, 16, INK, 900)
    text_r(img, "د. أحمد سامي — أخصائي تغذية", cx1 - 70, 56, 11.5, MUTED, 700)
    rrect(d, (cx0, 24, cx0 + 84, 58), 12, fill=SURFACE, outline=LINE, width=1)
    text_c(img, "خروج", cx0 + 42, 46, 11, (61, 86, 84), 800)
    return cx0, cx1



def _grad_card(img, x0, y0, x1, y1, c1, c2, radius):
    """كارت بتدرّج رأسي مقصوص على الحواف المستديرة."""
    w, h = int((x1 - x0) * S), int((y1 - y0) * S)
    lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)
    for y in range(h):
        t = y / max(1, h)
        c = tuple(int(c1[i] + (c2[i] - c1[i]) * t * 0.92) for i in range(3))
        ld.line([(0, y), (w, y)], fill=c + (255,))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(radius * S), fill=255)
    img.paste(lay, (px(x0), px(y0)), mask)


def _p_card(img, d, x0, y, w, h, fill=SURFACE, radius=22, outline=LINE):
    rrect(d, (x0, y, x0 + w, y + h), radius, fill=fill, outline=outline, width=1)


def screen_portal_home():
    """صفحة المريض الرئيسية — موعده القادم + قياسه + تقدمه."""
    img, d = _portal_base()
    cx0, cx1 = _portal_top(img, d)
    w = cx1 - cx0

    # ترحيب
    d.rounded_rectangle([px(cx1 - 52), px(86), px(cx1), px(138)], radius=px(16), fill=GREEN_P)
    text_c(img, "م", cx1 - 26, 128, 26, (255, 255, 255), 900)
    text_r(img, "أهلاً منى", cx1 - 64, 108, 22, INK, 900)
    text_r(img, "خطوتك النهاردة أقرب لهدفك", cx1 - 64, 128, 12.5, MUTED, 700)

    # كارت الموعد القادم — تدرّج أخضر مقصوص بشكل صحيح
    _grad_card(img, cx0, 156, cx1, 272, GREEN_D, GREEN_P, 22)
    text_r(img, "◷  موعدك القادم", cx1 - 24, 182, 12.5, (212, 236, 217), 800)
    text_r(img, "الخميس 6 نوفمبر — 3:45 م", cx1 - 24, 212, 22, (255, 255, 255), 900)
    text_r(img, "متابعة شهرية · د. أحمد سامي", cx1 - 24, 234, 12, (212, 236, 217), 700)
    rrect(d, (cx0 + 22, 240, cx0 + 150, 268), 12, fill=(255, 255, 255))
    text_c(img, "أكّد الحضور", cx0 + 86, 259, 11, GREEN_D, 900)

    # آخر قياس + الخطة
    half = (w - 14) / 2
    _p_card(img, d, cx0, 288, half, 108)
    text_r(img, "آخر قياس", cx0 + half - 20, 314, 12, MUTED, 800)
    text_r(img, "83.2 كجم", cx0 + half - 20, 350, 26, GREEN_D, 900)
    text_r(img, "نزلت 9.2 كجم", cx0 + half - 20, 378, 11.5, GREEN_P, 800)

    bx = cx0 + half + 14
    _p_card(img, d, bx, 288, half, 108)
    text_r(img, "خطتك الغذائية", bx + half - 20, 314, 12, MUTED, 800)
    text_r(img, "4 وجبات", bx + half - 20, 348, 22, INK, 900)
    text_r(img, "النهاردة جاهزة", bx + half - 20, 376, 11.5, MUTED, 700)

    # تقدمك
    _p_card(img, d, cx0, 412, w, 106)
    text_r(img, "تقدمك نحو الهدف", cx1 - 22, 440, 14, INK, 900)
    text_l(img, "83.2 من 72 كجم", cx0 + 24, 440, 12, MUTED, 800)
    pct = 0.68
    rrect(d, (cx0 + 22, 462, cx1 - 22, 478), 8, fill=(229, 237, 230))
    rrect(d, (cx0 + 22, 462, cx0 + 22 + (w - 44) * pct, 478), 8, fill=GREEN_P)
    text_r(img, "خلصت 68% — فاضل 11.2 كجم", cx1 - 22, 502, 12, GREEN_D, 800)

    # نصيحة + تواصل
    rrect(d, (cx0, 534, cx1, 592), 16, fill=(253, 251, 247), outline=(229, 216, 184), width=1.5)
    text_r(img, "اشرب كمية كافية من المية — كل يوم التزام خطوة لهدفك!", cx1 - 20, 570, 13, (138, 109, 29), 700)

    # شريط التنقل السفلي (4 تبويبات من الموقع)
    _pt_bottom(img, d, "home")
    return img


def _pt_bottom(img, d, active="home"):
    """`.pt-bottom` — 4 تبويبات، العرض 680px."""
    cx0, cx1 = 300, 980
    y0 = 606
    rrect(d, (cx0, y0, cx1, y0 + 78), 20, fill=SURFACE, outline=LINE, width=1)
    tabs = [("home", "الرئيسية", "home"), ("progress", "تطورك", "chart"),
            ("log", "سجّل قياس", "plus"), ("appointments", "مواعيدك", "calendar")]
    tw = (cx1 - cx0 - 16) / 4
    for i, (key, label, ic) in enumerate(tabs):
        bx = cx1 - 8 - (i + 1) * tw
        on = key == active
        if on:
            rrect(d, (bx + 3, y0 + 8, bx + tw - 3, y0 + 70), 14, fill=GREEN_P)
        col = (255, 255, 255) if on else (122, 148, 145)
        icon(img, ic, bx + tw / 2, y0 + 32, 9, col)
        text_c(img, label, bx + tw / 2, y0 + 60, 10.5, col, 800)


def screen_portal_log():
    """تبويب «سجّل قياس» — المريض يسجّل وزنه من البيت."""
    img, d = _portal_base()
    cx0, cx1 = _portal_top(img, d)
    w = cx1 - cx0

    text_r(img, "سجّل قياساتك النهاردة", cx1, 100, 20, INK, 900)
    text_r(img, "الرقم ده هيوصل للدكتور على طول", cx1, 122, 12, MUTED, 700)

    _p_card(img, d, cx0, 142, w, 400)
    text_r(img, "الوزن (كجم) *", cx1 - 22, 176, 12.5, (43, 92, 63), 900)

    # stepper — نفس عنصر الموقع
    rrect(d, (cx0 + 22, 192, cx1 - 22, 250), 16, fill=(247, 250, 249), outline=LINE, width=1.5)
    rrect(d, (cx0 + 30, 200, cx0 + 74, 242), 12, fill=(255, 255, 255))
    text_c(img, "−", cx0 + 52, 234, 22, GREEN_D, 900)
    text_c(img, "83.5", (cx0 + cx1) / 2, 234, 30, INK, 900)
    rrect(d, (cx1 - 74, 200, cx1 - 30, 242), 12, fill=(255, 255, 255))
    text_c(img, "+", cx1 - 52, 234, 22, GREEN_D, 900)
    text_r(img, "رقم بين 30 و 250 بخطوة 0.5 كجم", cx1 - 22, 268, 11, MUTED, 700)

    # حقول اختيارية
    text_r(img, "محيط الخصر (سم)", cx1 - 22, 300, 11.5, (43, 92, 63), 900)
    text_r(img, "محيط الأرداف (سم)", cx1 - w / 2 - 6, 300, 11.5, (43, 92, 63), 900)
    for i, v in enumerate(["95", "110"]):
        bx1 = cx1 - 22 - i * (w / 2 - 8)
        bx0 = bx1 - (w / 2 - 22)
        rrect(d, (bx0, 312, bx1, 356), 12, fill=(255, 255, 255), outline=LINE, width=1)
        text_r(img, v, bx1 - 16, 342, 16, INK, 700)

    # إحساسك النهاردة
    text_r(img, "إحساسك النهاردة (اختياري)", cx1 - 22, 390, 11.5, (43, 92, 63), 900)
    rrect(d, (cx0 + 22, 402, cx1 - 22, 466), 14, fill=(255, 255, 255), outline=LINE, width=1)
    text_r(img, "حاسة أخف، والنوم بقى أحسن بكتير", cx1 - 38, 430, 12.5, (120, 140, 138), 600)

    # صورة المتابعة
    rrect(d, (cx0 + 22, 480, cx1 - 22, 520), 14, fill=(247, 250, 249), outline=(214, 228, 216), width=1.5)
    text_c(img, "اضغط للتصوير أو اختيار صورة", (cx0 + cx1) / 2, 506, 12, (120, 140, 138), 700)

    # زر الحفظ
    rrect(d, (cx0 + 22, 560, cx1 - 22, 608), 14, fill=GREEN_P)
    text_c(img, "حفظ القياس", (cx0 + cx1) / 2, 591, 15, (255, 255, 255), 900)
    text_r(img, "الصورة بتتخزن آمن — هيشوفها د. أحمد بس", cx1 - 22, 632, 10.5, MUTED, 600)

    # تأكيد الإرسال للدكتور
    rrect(d, (cx0, 648, cx1, 690), 14, fill=(230, 246, 237), outline=(180, 232, 205), width=1.5)
    text_r(img, "وصل للدكتور — هيتابع معاك", cx1 - 20, 676, 12.5, GREEN_D, 800)
    return img


def screen_portal_progress():
    """تبويب «تطورك» — منحنى الوزن بلغة بسيطة."""
    img, d = _portal_base()
    cx0, cx1 = _portal_top(img, d)
    w = cx1 - cx0

    icon(img, "chart", cx1 - 16, 96, 11, GREEN_P)
    text_r(img, "تطورك معانا", cx1 - 36, 104, 20, INK, 900)
    text_r(img, "منحنى الوزن بشكل بسيط يفهمه أي حد", cx1 - 36, 124, 11.5, MUTED, 700)

    # ملخص الرحلة — 3 مربعات
    stats = [("نزلت", "9.2", "كجم", True), ("النهاردة", "83.2", "كجم", False),
             ("فاضل", "11.2", "كجم", False)]
    sw = (w - 20) / 3
    for i, (lab, val, unit, good) in enumerate(stats):
        bx = cx1 - (i + 1) * sw - i * 10
        rrect(d, (bx, 142, bx + sw, 214), 16,
              fill=(236, 249, 240) if good else (246, 250, 246),
              outline=(180, 232, 205) if good else LINE, width=1.5)
        text_c(img, lab, bx + sw / 2, 166, 10.5, MUTED, 800)
        text_c(img, val, bx + sw / 2, 194, 20, GREEN_D if good else INK, 900)
        text_c(img, unit, bx + sw / 2, 208, 9.5, MUTED, 800)

    # منحنى
    _p_card(img, d, cx0, 228, w, 224)
    text_r(img, "منحنى الوزن", cx1 - 22, 258, 14, INK, 900)
    rrect(d, (cx0 + 22, 246, cx0 + 168, 276), 11, fill=(238, 243, 242))
    for i, (lab, on) in enumerate([("آخر شهر", False), ("3 شهور", False), ("الكل", True)]):
        bx = cx0 + 26 + i * 47
        if on:
            rrect(d, (bx - 2, 250, bx + 44, 272), 8, fill=(255, 255, 255))
        text_c(img, lab, bx + 21, 267, 9.5, GREEN_D if on else (91, 118, 115), 800)

    gx, gy, gw, gh = cx0 + 32, 320, w - 64, 116
    vals = [92.4, 91.0, 90.2, 88.6, 87.1, 85.8, 84.0, 83.2]
    lo, hi = 80.0, 94.0
    for i in range(4):
        yy = gy + i * (gh / 3)
        line(d, (gx, yy), (gx + gw, yy), (237, 243, 242), 1)
    pts = [(gx + i * (gw / (len(vals) - 1)), gy + gh - ((v - lo) / (hi - lo)) * gh)
           for i, v in enumerate(vals)]
    under = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ud = ImageDraw.Draw(under)
    ud.polygon([(px(x), px(y)) for x, y in pts] + [(px(gx + gw), px(gy + gh)), (px(gx), px(gy + gh))],
               fill=GREEN_P + (38,))
    img.alpha_composite(under)
    d = ImageDraw.Draw(img)
    d.line([(px(x), px(y)) for x, y in pts], fill=GREEN_P, width=int(3.2 * S), joint="curve")
    for x, y in pts:
        d.ellipse([px(x - 5), px(y - 5), px(x + 5), px(y + 5)], fill=(255, 255, 255),
                  outline=GREEN_P, width=int(2.6 * S))
    text_c(img, "92.4", gx, gy - 6, 10, MUTED, 700)
    text_c(img, "83.2", gx + gw, gy + gh - 44, 10.5, GREEN_D, 800)

    # رسالة تحفيز
    rrect(d, (cx0, 468, cx1, 534), 16, fill=(230, 246, 237), outline=(180, 232, 205), width=1.5)
    text_r(img, "إنت في الطريق الصح — كمّل!", cx1 - 20, 496, 14, GREEN_D, 900)
    text_r(img, "نزلت 9.2 كجم في 6 شهور", cx1 - 20, 518, 11.5, (21, 128, 61), 700)

    _pt_bottom(img, d, "progress")
    return img


def screen_portal_appointments():
    """تبويب «مواعيدك» — المريض يشوف ويأكد."""
    img, d = _portal_base()
    cx0, cx1 = _portal_top(img, d)
    w = cx1 - cx0

    text_r(img, "مواعيدك", cx1, 102, 20, INK, 900)
    text_r(img, "3 مواعيد قادمة", cx1, 124, 12, MUTED, 700)

    appts = [("الخميس 6 نوفمبر", "3:45", "متابعة شهرية", "مؤكد", GREEN_P),
             ("الأحد 9 نوفمبر", "4:30", "قياس InBody", "مؤكد", GREEN_P),
             ("الخميس 13 نوفمبر", "3:45", "متابعة شهرية", "بانتظار تأكيدك", AMBER)]
    for i, (day, tm, kind, st, col) in enumerate(appts):
        y = 148 + i * 106
        _p_card(img, d, cx0, y, w, 92)
        d.rounded_rectangle([px(cx1 - 6), px(y + 2), px(cx1), px(y + 90)], radius=px(3), fill=col)
        # بلوك الوقت — أقصى اليمين زي الموقع
        rrect(d, (cx1 - 128, y + 20, cx1 - 34, y + 72), 12, fill=(247, 250, 249))
        text_c(img, tm, cx1 - 81, y + 44, 12.5, GREEN_D, 900)
        text_c(img, "م", cx1 - 81, y + 62, 9, MUTED, 700)
        # اليوم ونوع الموعد على شماله
        text_r(img, day, cx1 - 146, y + 42, 15, INK, 900)
        text_r(img, kind, cx1 - 146, y + 64, 11.5, MUTED, 700)
        rrect(d, (cx0 + 22, y + 26, cx0 + 152, y + 56), 12,
              fill=(230, 246, 237) if col == GREEN_P else (253, 241, 222))
        text_c(img, st, cx0 + 87, y + 47, 10.5, col, 800)

    # التواصل مع الدكتور
    _grad_card(img, cx0, 472, cx1, 556, GREEN_D, GREEN_P, 18)
    text_r(img, "عندك سؤال؟ كلّم د. أحمد", cx1 - 22, 504, 16, (255, 255, 255), 900)
    text_r(img, "رد في نفس اليوم على واتساب", cx1 - 22, 526, 11.5, (212, 236, 217), 700)
    rrect(d, (cx0 + 22, 516, cx0 + 176, 548), 14, fill=(255, 255, 255))
    icon(img, "whatsapp", cx0 + 44, 532, 8, GREEN_P)
    text_c(img, "واتساب العيادة", cx0 + 112, 538, 11, GREEN_D, 900)

    _pt_bottom(img, d, "appointments")
    return img



# ═════════════════ شاشات v5: التحاليل / السكر والضغط / الأدوية ═════════════════

def screen_labs():
    """تبويب «التحاليل» في ملف المريض — سجل تحاليل بتاريخ ونتائج.

    مطابق لـ js/labs.js: COMMON_LAB_TESTS (سكر تراكمي HbA1c / دهون الدم / وظائف كلى).
    """
    img, d = shell("المرضى", "ملف المريض", "منى عبد الرحمن — سمنة ونحافة")
    x0 = 26
    cw = 1014 - 26

    # ترويسة المريض المختصرة
    rrect(d, (x0, 88, x0 + cw - 26, 146), 18, fill=SURFACE, outline=LINE, width=1)
    d.ellipse([px(x0 + 16), px(98), px(x0 + 66), px(138)], fill=TEAL50)
    text_c(img, "م", x0 + 41, 126, 18, TEAL600, 900)
    text_r(img, "منى عبد الرحمن", x0 + cw - 44, 116, 16, INK, 900)
    text_r(img, "34 سنة · سمنة ونحافة · 8 جلسات", x0 + cw - 44, 136, 11, MUTED, 600)

    # التبويبات — التحاليل مفعّلة
    tabs = ["الخطة الغذائية", "الملاحظات", "متابعة السكر والضغط", "التحاليل", "الزيارات"]
    tw = (cw - 26) / len(tabs)
    for i, t in enumerate(tabs):
        bx = x0 + cw - 26 - (i + 1) * tw
        on = t == "التحاليل"
        if on:
            rrect(d, (bx + 4, 158, bx + tw - 4, 196), 12, fill=TEAL600)
        text_c(img, t, bx + tw / 2, 183, 11.5, (255, 255, 255) if on else (91, 118, 115), 800)

    # كارت سجل التحاليل — الارتفاع محسوب على أساس 3 تحاليل
    card(img, d, x0, 210, cw - 26, 520, "سجل التحاليل")
    rrect(d, (x0 + 20, 250, x0 + 176, 288), 12, fill=TEAL600)
    text_c(img, "+ إضافة تحليل", x0 + 98, 274, 11.5, (255, 255, 255), 900)

    labs = [
        ("سكر تراكمي", "(HbA1c)", "6 نوفمبر 2025", [("HbA1c", "6.4", "%", "bad"),
                                               ("الجلوكوز الصائم", "104", "mg/dL", "warn")]),
        ("دهون الدم", "(Lipid profile)", "9 أكتوبر 2025", [("الكوليسترول الكلي", "212", "mg/dL", "bad"),
                                                       ("LDL", "138", "mg/dL", "bad"),
                                                       ("HDL", "46", "mg/dL", "ok")]),
        ("وظائف كلى", "(Renal profile)", "11 سبتمبر 2025", [("الكرياتينين", "0.9", "mg/dL", "ok"),
                                                        ("اليوريا", "28", "mg/dL", "ok")]),
    ]
    y = 292
    for name, en, date, rows in labs:
        h = 50 + len(rows) * 30
        rrect(d, (x0 + 20, y, x0 + cw - 46, y + h), 16, fill=(247, 250, 249), outline=LINE, width=1)
        # رأس التحليل — العربي يمين، اللاتيني شمال منه، التاريخ على الشمال
        text_r(img, name, x0 + cw - 66, y + 26, 13.5, INK, 900)
        nw = T.measure(name, BLACK, px(13.5))[0]
        ew = T.measure(en, BOLD, px(10.5))[0]
        text_r(img, en, x0 + cw - 66 - nw - 10, y + 26, 10.5, (130, 150, 148), 700)
        text_r(img, date, x0 + cw - 66 - nw - ew - 26, y + 26, 10.5, MUTED, 700)
        icon(img, "flask", x0 + 44, y + 20, 9, TEAL600)
        # النتائج
        for j, (comp, val, unit, lvl) in enumerate(rows):
            ry = y + 54 + j * 30
            col = {"ok": TEAL700, "warn": AMBER, "bad": (190, 60, 60)}[lvl]
            line(d, (x0 + 34, ry - 12), (x0 + cw - 60, ry - 12), (237, 243, 242), 1)
            text_r(img, comp, x0 + cw - 66, ry + 12, 11.5, (40, 62, 60), 700)
            # القيمة والوحدة مقطوعين (اللاتيني جوه العربي بيتعكس)
            vw = T.measure(val, BLACK, px(12.5))[0]
            text_l(img, val, x0 + 40, ry + 12, 12.5, col, 900)
            text_l(img, unit, x0 + 40 + vw + 8, ry + 12, 9.5, (140, 158, 156), 700)
            if lvl != "ok":
                d.ellipse([px(x0 + 40 + vw + 8 + T.measure(unit, BOLD, px(9.5))[0] + 10),
                           px(ry + 2),
                           px(x0 + 40 + vw + 8 + T.measure(unit, BOLD, px(9.5))[0] + 20),
                           px(ry + 12)], fill=col)
        y += h + 12
    return img


def screen_health():
    """تبويب «متابعة السكر والضغط» للطبيب — قراءات من البيت + تنبيه.

    مطابق لـ js/health-monitoring.js: قراءة سكر / ضغط انقباضي وانبساطي.
    القاعدة: كل حاجة متثبتة على الحافة اليمين للكارت بتاعها (RTL).
    """
    img, d = shell("المرضى", "ملف المريض", "منى عبد الرحمن — سمنة ونحافة")
    x0 = 26
    xr = 1014 - 26
    cw = xr - x0

    rrect(d, (x0, 88, xr, 146), 18, fill=SURFACE, outline=LINE, width=1)
    d.ellipse([px(x0 + 16), px(98), px(x0 + 66), px(138)], fill=TEAL50)
    text_c(img, "م", x0 + 41, 126, 18, TEAL600, 900)
    text_r(img, "منى عبد الرحمن", xr - 18, 116, 16, INK, 900)
    text_r(img, "أمراض مزمنة: السكري · ضغط الدم", xr - 18, 136, 11, MUTED, 600)

    tabs = ["الخطة الغذائية", "الملاحظات", "متابعة السكر والضغط", "التحاليل", "الزيارات"]
    tw = cw / len(tabs)
    for i, t in enumerate(tabs):
        bx = xr - (i + 1) * tw
        on = t == "متابعة السكر والضغط"
        if on:
            rrect(d, (bx + 4, 158, bx + tw - 4, 196), 12, fill=TEAL600)
        text_c(img, t, bx + tw / 2, 183, 11.5, (255, 255, 255) if on else (91, 118, 115), 800)

    # ── كارتين: السكر يمين، الضغط شمال (اتجاه RTL) ──
    half = (cw - 14) / 2
    gx0 = xr - half                     # السكر — يمين
    px0 = x0                            # الضغط — شمال
    R = 26                              # مسافة الحافة اليمين الداخلية

    # السكر
    card(img, d, gx0, 210, half, 238, "متابعة السكر")
    icon(img, "drop", gx0 + half - 30, 268, 8, (225, 29, 72))
    text_r(img, "آخر قراءة صائم", gx0 + half - R, 300, 10.5, MUTED, 800)
    text_r(img, "104", gx0 + half - R, 336, 24, (190, 30, 60), 900)
    w104 = T.measure("104", BLACK, px(24))[0]
    text_r(img, "mg/dL", gx0 + half - R - w104 - 8, 336, 9.5, (140, 158, 156), 700)
    text_r(img, "بتنازل — كويس", gx0 + half - R, 358, 10.5, TEAL700, 800)

    # منحنى السكر — تحت الأرقام
    gx, gy, gw, gh = gx0 + 26, 372, half - 2 * R, 60
    vals = [128, 121, 116, 112, 108, 104]
    pts = [(gx + i * (gw / (len(vals) - 1)), gy + gh - ((v - 90) / 50) * gh)
           for i, v in enumerate(vals)]
    d.line([(px(x), px(y)) for x, y in pts], fill=(225, 29, 72), width=int(2.4 * S), joint="curve")
    for x, y2 in pts:
        d.ellipse([px(x - 3.5), px(y2 - 3.5), px(x + 3.5), px(y2 + 3.5)], fill=(255, 255, 255),
                  outline=(225, 29, 72), width=int(1.8 * S))

    # الضغط
    card(img, d, px0, 210, half, 238, "متابعة ضغط الدم")
    icon(img, "pulse", px0 + half - 30, 268, 9, (37, 99, 235))
    text_r(img, "آخر قراءة", px0 + half - R, 300, 10.5, MUTED, 800)
    text_r(img, "124 / 82", px0 + half - R, 336, 24, (37, 99, 235), 900)
    text_r(img, "mmHg", px0 + half - R, 358, 9.5, (140, 158, 156), 700)
    text_l(img, "النبض", px0 + R, 358, 10.5, MUTED, 700)
    text_l(img, "76", px0 + R + T.measure("النبض", BOLD, px(10.5))[0] + 6, 358, 10.5, INK, 800)

    ptx, pty, ptw, pth = px0 + 26, 372, half - 2 * R, 60
    sysv = [148, 138, 132, 128, 124]
    pts2 = [(ptx + i * (ptw / (len(sysv) - 1)), pty + pth - ((v - 110) / 50) * pth)
            for i, v in enumerate(sysv)]
    d.line([(px(x), px(y)) for x, y in pts2], fill=(37, 99, 235), width=int(2.4 * S), joint="curve")
    for x, y2 in pts2:
        d.ellipse([px(x - 3.5), px(y2 - 3.5), px(x + 3.5), px(y2 + 3.5)], fill=(255, 255, 255),
                  outline=(37, 99, 235), width=int(1.8 * S))

    # ── قراءات واردة من البوابة ──
    card(img, d, x0, 466, cw, 236, "قراءات المريض من البوابة")
    rows = [("6 نوفمبر — 8:15 ص", "سكر صائم", "104", "mg/dL", "ok"),
            ("5 نوفمبر — 11:40 م", "ضغط", "124 / 82", "mmHg", "ok"),
            ("4 نوفمبر — 9:02 ص", "سكر صائم", "112", "mg/dL", "ok"),
            ("3 نوفمبر — 10:20 م", "ضغط", "162 / 98", "mmHg", "warn")]
    for i, (when, kind, val, unit, lvl) in enumerate(rows):
        y = 510 + i * 44
        rrect(d, (x0 + 18, y, xr - 18, y + 40), 12, fill=(247, 250, 249))
        col = TEAL700 if lvl == "ok" else AMBER
        text_r(img, when, xr - 34, y + 26, 10.5, MUTED, 700)
        text_r(img, kind, xr - 210, y + 26, 11.5, (40, 62, 60), 800)
        # القيمة + الوحدة على الشمال
        text_l(img, val, x0 + 40, y + 26, 12.5, col, 900)
        vw = T.measure(val, BLACK, px(12.5))[0]
        text_l(img, unit, x0 + 40 + vw + 8, y + 26, 9.5, (140, 158, 156), 700)
        if lvl != "ok":
            icon(img, "alert", x0 + 40 + vw + 34, y + 20, 7, AMBER)
    return img


def screen_meds():
    """ملاحظة زيارة فيها الأدوية الحالية — مطابق لـ js/notes.js (حقل meds)."""
    img, d = shell("المرضى", "ملف المريض", "منى عبد الرحمن — سمنة ونحافة")
    x0 = 26
    cw = 1014 - 26

    rrect(d, (x0, 88, x0 + cw - 26, 146), 18, fill=SURFACE, outline=LINE, width=1)
    d.ellipse([px(x0 + 16), px(98), px(x0 + 66), px(138)], fill=TEAL50)
    text_c(img, "م", x0 + 41, 126, 18, TEAL600, 900)
    text_r(img, "منى عبد الرحمن", x0 + cw - 44, 116, 16, INK, 900)
    text_r(img, "السكري · ضغط الدم · كوليسترول", x0 + cw - 44, 136, 11, MUTED, 600)

    # بطاقة الأدوية الحالية
    card(img, d, x0, 164, cw - 26, 300, "الأدوية الحالية")
    icon(img, "pill", x0 + 40, 222, 11, TEAL600)

    meds = [("ميتفورمين 500 مجم", "قرص بعد الفطار والعشا", "من 12 سبتمبر", TEAL600),
            ("أملوديبين 5 مجم", "قرص مرة يوميًا — صباحًا", "من 20 أكتوبر", (37, 99, 235)),
            ("أتورفاستاتين 20 مجم", "قرص مساءً قبل النوم", "من 2 نوفمبر", (147, 51, 234))]
    for i, (name, dose, since, col) in enumerate(meds):
        y = 246 + i * 66
        rrect(d, (x0 + 18, y, x0 + cw - 44, y + 56), 14, fill=(247, 250, 249), outline=LINE, width=1)
        d.rounded_rectangle([px(x0 + 18), px(y + 4), px(x0 + 24), px(y + 52)], radius=px(3), fill=col)
        text_r(img, name, x0 + cw - 62, y + 26, 13.5, INK, 900)
        text_r(img, dose, x0 + cw - 62, y + 44, 11, (91, 118, 115), 700)
        rrect(d, (x0 + 30, y + 14, x0 + 150, y + 42), 10, fill=(236, 243, 242))
        text_c(img, since, x0 + 90, y + 32, 10, (91, 118, 115), 800)

    # آخر ملاحظة زيارة
    card(img, d, x0, 482, cw - 26, 194, "آخر ملاحظة زيارة — 6 نوفمبر 2025")
    text_r(img, "الالتزام ممتاز · الوِزن نازل 9.2 كجم في 6 شهور", x0 + cw - 46, 540, 13, INK, 800)
    text_r(img, "السكر الصائم نزل من 128 لـ 104 — نكمل بنفس الجرعة", x0 + cw - 46, 566, 12, (40, 62, 60), 700)
    text_r(img, "الضغط استقر على 124 / 82 · نتابع الأملوديبين شهر كمان", x0 + cw - 46, 590, 12, (40, 62, 60), 700)
    rrect(d, (x0 + 24, 606, x0 + 300, 648), 12, fill=(253, 241, 222))
    icon(img, "calendar", x0 + 46, 627, 8, AMBER)
    text_c(img, "متابعة قادمة: 6 ديسمبر", x0 + 178, 633, 11, (146, 96, 10), 900)
    return img


def screen_after_hours():
    """المريض بيسأل بعد مواعيد العيادة — السؤال بيوصل مش بيضيع.

    بوابة المريض: «كلّم العيادة» + رسالة إن السؤال اتسجل، والطبيب يشوفه الصبح.
    """
    img, d = _portal_base()
    cx0, cx1 = _portal_top(img, d)
    w = cx1 - cx0

    # شريط الوقت — برة مواعيد العيادة
    rrect(d, (cx0, 84, cx1, 148), 18, fill=(30, 41, 59))
    icon(img, "moon", cx0 + 32, 106, 9, (250, 204, 21))
    text_r(img, "11:24 م", cx1 - 22, 108, 20, (255, 255, 255), 900)
    text_r(img, "العيادة مقفولة — برة المواعيد", cx1 - 22, 130, 11.5, (203, 213, 225), 700)

    # المحادثة
    _p_card(img, d, cx0, 164, w, 118, fill=(255, 255, 255))
    text_r(img, "منى عبد الرحمن", cx1 - 22, 192, 13, INK, 900)
    text_r(img, "«دكتور، سكرى الصبح كان 148… أعمل إيه؟»", cx1 - 22, 220, 13, (40, 62, 60), 700)
    text_r(img, "السؤال محفوظ ومش هيضيع", cx1 - 22, 246, 11, MUTED, 700)
    d.rounded_rectangle([px(cx0 + 22), px(196), px(cx0 + 28), px(258)], radius=px(3), fill=(37, 99, 235))

    # الرد التلقائي: وصل
    _p_card(img, d, cx0, 294, w * 0.86, 96, fill=(236, 249, 240), outline=(180, 232, 205))
    text_r(img, "تم الاستلام", cx0 + w * 0.86 - 20, 322, 12.5, GREEN_D, 900)
    text_r(img, "د. أحمد هيرد عليك أول ما يفتح العيادة", cx0 + w * 0.86 - 20, 346, 11.5, (21, 128, 61), 700)
    text_r(img, "الصبح · 9:00 ص", cx0 + w * 0.86 - 20, 372, 10.5, MUTED, 700)

    # زر واتساب
    _grad_card(img, cx0, 404, cx1, 484, GREEN_D, GREEN_P, 18)
    text_r(img, "كلّم د. أحمد على واتساب", cx1 - 22, 434, 16, (255, 255, 255), 900)
    text_r(img, "ضغطة واحدة — من غير ما تدوّر على الرقم", cx1 - 22, 458, 11.5, (212, 236, 217), 700)
    rrect(d, (cx0 + 22, 424, cx0 + 226, 468), 14, fill=(255, 255, 255))
    icon(img, "whatsapp", cx0 + 48, 446, 8, GREEN_P)
    text_c(img, "واتساب العيادة", cx0 + 140, 452, 11.5, GREEN_D, 900)

    # النتيجة للطبيب
    rrect(d, (cx0, 500, cx1, 590), 18, fill=SURFACE, outline=LINE, width=1)
    text_r(img, "عند الطبيب — الصبح", cx1 - 22, 532, 13.5, INK, 900)
    text_r(img, "3 أسئلة من 3 مرضى — كلها في قايمة واحدة", cx1 - 22, 558, 12, (40, 62, 60), 700)
    text_r(img, "مفيش مكالمات فايتة · مفيش وقت ضايع", cx1 - 22, 580, 11, TEAL700, 800)
    return img



def screen_portal_health():
    """تبويب البوابة: المريض يسجّل قراءة سكر وقراءة ضغط من البيت.

    مطابق لـ renderPortalHealthTracking في js/patient-portal.js
    (قيمة السكر mg/dL + نوع التحليل، والضغط انقباضي/انبساطي + نبض اختياري).
    """
    img, d = _portal_base()
    cx0, cx1 = _portal_top(img, d)
    w = cx1 - cx0
    R = 22

    text_r(img, "قياساتك من البيت", cx1, 100, 20, INK, 900)
    text_r(img, "بتوصل للدكتور على طول — مش محتاج تكلّمه", cx1, 122, 12, MUTED, 700)

    # ── كارت السكر ──
    _p_card(img, d, cx0, 140, w, 200)
    icon(img, "drop", cx1 - 30, 172, 7.5, (225, 29, 72))
    text_r(img, "تسجيل قراءة سكر", cx1 - 46, 178, 13.5, INK, 900)
    text_r(img, "قيمة السكر", cx1 - R, 210, 11, (43, 92, 63), 900)
    text_r(img, "mg/dL", cx1 - R - T.measure("قيمة السكر", BLACK, px(11))[0] - 6, 210, 10,
           (140, 158, 156), 700)
    rrect(d, (cx0 + R, 220, cx1 - R, 264), 12, fill=(255, 255, 255), outline=LINE, width=1.5)
    text_r(img, "148", cx1 - R - 16, 250, 19, INK, 900)
    text_r(img, "نوع التحليل", cx1 - R, 288, 11, (43, 92, 63), 900)
    for i, (t, on) in enumerate([("صائم", False), ("بعد الأكل", False), ("عشوائي", True)]):
        bw = 92
        bx = cx1 - R - (i + 1) * bw - i * 8
        rrect(d, (bx, 298, bx + bw, 326), 11, fill=(236, 249, 240) if on else (247, 250, 249),
              outline=(180, 232, 205) if on else LINE, width=1.5)
        text_c(img, t, bx + bw / 2, 317, 10.5, GREEN_D if on else (91, 118, 115), 800)

    # ── كارت الضغط ──
    _p_card(img, d, cx0, 356, w, 168)
    icon(img, "pulse", cx1 - 30, 388, 8, (37, 99, 235))
    text_r(img, "تسجيل قراءة ضغط", cx1 - 46, 394, 13.5, INK, 900)
    text_r(img, "الانقباضي", cx1 - R, 424, 11, (43, 92, 63), 900)
    text_r(img, "الانبساطي", cx1 - w / 2 - 4, 424, 11, (43, 92, 63), 900)
    for i, v in enumerate(["124", "82"]):
        bx1 = cx1 - R - i * (w / 2 - 8)
        bx0 = bx1 - (w / 2 - R)
        rrect(d, (bx0, 434, bx1, 474), 12, fill=(255, 255, 255), outline=LINE, width=1)
        text_r(img, v, bx1 - 14, 462, 15, INK, 700)
    text_l(img, "النبض (اختياري)", cx0 + R, 424, 10.5, MUTED, 700)

    # ── زر الحفظ ──
    rrect(d, (cx0 + R, 540, cx1 - R, 584), 14, fill=GREEN_P)
    text_c(img, "حفظ القراءة", (cx0 + cx1) / 2, 566, 14, (255, 255, 255), 900)

    # ── تأكيد + تنبيه ──
    rrect(d, (cx0, 598, cx1, 638), 14, fill=(230, 246, 237), outline=(180, 232, 205), width=1.5)
    text_r(img, "وصلت للدكتور — هيتابع معاك", cx1 - 20, 623, 12.5, GREEN_D, 800)
    rrect(d, (cx0, 650, cx1, 700), 14, fill=(254, 242, 242), outline=(252, 202, 202), width=1.5)
    icon(img, "alert", cx1 - 28, 668, 6.5, (200, 60, 60))
    text_r(img, "الضغط 162 / 98 — أعلى من حد التنبيه", cx1 - 44, 670, 11.5, (170, 45, 45), 900)
    text_r(img, "الدكتور بيوصله تنبيه فوري — مش مستني مكالمة", cx1 - 44, 690, 10.5, (180, 80, 70), 700)
    return img



# ═════════════════ شاشات v6: خطط التغذية ═════════════════

def screen_plans():
    """مكتبة خطط التغذية — 10 خطط جاهزة + عدد المرضى المربوطين بكل خطة.

    مطابق لـ js/plans.js → renderPlans() و js/defaults.js (10 خطط).
    """
    img, d = shell("خطط التغذية", "خطط التغذية", "مكتبة الخطط — 10 خطط جاهزة")
    x0 = 26
    xr = 1014 - 26
    cw = xr - x0

    # تنويه الاسترشادية (موجود حرفيًا في plans.js)
    rrect(d, (x0, 88, xr, 130), 14, fill=(253, 251, 247), outline=(229, 216, 184), width=1.5)
    icon(img, "alert", xr - 26, 104, 6.5, (146, 96, 10))
    text_r(img, "خطط استرشادية — راجع الموانع وحالة كل مريض قبل الصرف", xr - 40, 110, 10.5, (138, 109, 29), 800)

    # زر خطة جديدة
    rrect(d, (x0, 140, x0 + 156, 176), 11, fill=TEAL600)
    text_c(img, "+ خطة جديدة", x0 + 78, 164, 11, (255, 255, 255), 900)

    plans = [
        ("خطة 1200 سعر — نحافة سريعة", "1200", "4 أسابيع", 3,
         ["فطار: بيض + جبن قريش", "غدا: فراخ مشوية + سلطة", "عشا: زبادي + فاكهة"], False),
        ("خطة 1500 سعر — نحافة معتدلة", "1500", "8 أسابيع", 12,
         ["فطار: شوفان + لبن + موز", "غدا: سمك + رز بني", "عشا: جبن + خضار سوتيه"], False),
        ("خطة 2000 سعر — تثبيت الوزن", "2000", "6 أسابيع", 5,
         ["فطار: فول + جبن + عيش بلدي", "غدا: لحمة + رز + سلطة", "عشا: تونة + خضار"], False),
        ("خطة مرضى السكر — 1600 سعر", "1600", "12 أسبوع", 7,
         ["فطار: بيض + خبز أسمر", "غدا: فراخ + كوسة + سلطة", "عشا: زبادي يوناني"], True),
        ("خطة مرضى الضغط — 1700 (DASH)", "1700", "12 أسبوع", 4,
         ["فطار: شوفان + موز", "غدا: سمك + بطاطا مشوية", "عشا: سلطة تونة"], True),
        ("خطة عالية البروتين — 1800 سعر", "1800", "6 أسابيع", 2,
         ["فطار: 3 بيضات + لبن", "غدا: صدور فراخ + برغل", "عشا: جبن قريش + لوز"], False),
    ]

    pw = (cw - 18) / 2
    ph = 250
    for i, (title, kcal, dur, used, meals, contra) in enumerate(plans):
        col = i % 2
        row = i // 2
        bx = xr - (col + 1) * pw - col * 18
        by = 192 + row * (ph + 14)
        rrect(d, (bx, by, bx + pw, by + ph), 18, fill=SURFACE, outline=LINE, width=1)

        # العنوان — أقصى اليمين
        text_r(img, title, bx + pw - 18, by + 34, 13.5, INK, 900)
        # شارة السعرات شمال العنوان
        kcalw = T.measure(kcal + " سعر", BLACK, px(11))[0] + 46
        rrect(d, (bx + 14, by + 12, bx + 14 + kcalw, by + 46), 11, fill=(253, 241, 222))
        icon(img, "meal", bx + 32, by + 29, 5.5, AMBER)
        text_c(img, kcal + " سعر", bx + 14 + (kcalw + 22) / 2, by + 36, 11, (146, 96, 10), 900)

        # شرائح المدة / الموانع
        chip_y = by + 58
        cxp = bx + pw - 18
        cw2 = T.measure(dur, BOLD, px(10))[0] + 26
        rrect(d, (cxp - cw2, chip_y, cxp, chip_y + 26), 9, fill=(233, 240, 253))
        text_c(img, dur, cxp - cw2 / 2, chip_y + 18, 10, (37, 99, 235), 800)
        cxp -= cw2 + 7
        if contra:
            cw3 = T.measure("لها موانع", BOLD, px(10))[0] + 26
            rrect(d, (cxp - cw3, chip_y, cxp, chip_y + 26), 9, fill=(254, 232, 232))
            text_c(img, "لها موانع", cxp - cw3 / 2, chip_y + 18, 10, (190, 60, 60), 800)

        # الوجبات الثلاثة
        for j, m in enumerate(meals):
            my = by + 104 + j * 30
            d.ellipse([px(bx + pw - 26), px(my - 9), px(bx + pw - 18), px(my - 1)], fill=TEAL500)
            text_r(img, m, bx + pw - 34, my + 4, 10.5, (60, 84, 82), 700)

        # التذييل
        line(d, (bx + 14, by + ph - 44), (bx + pw - 14, by + ph - 44), (237, 243, 242), 1)
        icon(img, "users", bx + 30, by + ph - 24, 6, TEAL600 if used else (170, 186, 184))
        text_r(img, (f"مربوطة بـ {used} مريض" if used else "غير مربوطة"),
               bx + pw - 18, by + ph - 18, 10.5, TEAL700 if used else (150, 168, 166), 800)
    return img


def screen_assign_plan():
    """نافذة «ربط خطة غذائية» — المريض + الخطة + تاريخ البدء والانتهاء.

    مطابق لـ js/plans.js → openAssignModal().
    """
    img, d = shell("خطط التغذية", "خطط التغذية", "مكتبة الخطط — 10 خطط جاهزة")

    # تعتيم الخلفية
    ov = Image.new("RGBA", img.size, (8, 20, 24, 150))
    img.alpha_composite(ov)
    d = ImageDraw.Draw(img)

    # المودال في النص
    mw, mh = 560, 400
    mx0 = (1280 - mw) / 2
    my0 = (720 - mh) / 2
    rrect(d, (mx0, my0, mx0 + mw, my0 + mh), 22, fill=SURFACE, outline=LINE, width=1)
    text_r(img, "ربط خطة غذائية", mx0 + mw - 26, my0 + 40, 17, INK, 900)
    line(d, (mx0 + 22, my0 + 58), (mx0 + mw - 22, my0 + 58), (237, 243, 242), 1)

    # المريض
    text_r(img, "المريض", mx0 + mw - 26, my0 + 96, 11, (43, 92, 63), 900)
    rrect(d, (mx0 + 26, my0 + 106, mx0 + mw - 26, my0 + 152), 12, fill=(247, 250, 249), outline=LINE, width=1)
    text_r(img, "منى عبد الرحمن", mx0 + mw - 44, my0 + 136, 13, INK, 800)
    d.polygon([(px(mx0 + 44), px(my0 + 126)), (px(mx0 + 64), px(my0 + 126)),
               (px(mx0 + 54), px(my0 + 138))], fill=(120, 140, 138))

    # الخطة
    text_r(img, "الخطة الغذائية", mx0 + mw - 26, my0 + 186, 11, (43, 92, 63), 900)
    rrect(d, (mx0 + 26, my0 + 196, mx0 + mw - 26, my0 + 242), 12, fill=(247, 250, 249), outline=TEAL600, width=1.5)
    text_r(img, "خطة 1500 سعر — نحافة معتدلة", mx0 + mw - 44, my0 + 220, 12.5, INK, 800)
    text_r(img, "1500 سعر", mx0 + mw - 44, my0 + 238, 9.5, (146, 96, 10), 800)
    d.polygon([(px(mx0 + 44), px(my0 + 216)), (px(mx0 + 64), px(my0 + 216)),
               (px(mx0 + 54), px(my0 + 228))], fill=(120, 140, 138))

    # التواريخ
    text_r(img, "تاريخ البدء", mx0 + mw - 26, my0 + 276, 11, (43, 92, 63), 900)
    text_r(img, "تاريخ الانتهاء", mx0 + mw / 2 - 6, my0 + 276, 11, (43, 92, 63), 900)
    for i, v in enumerate(["6 نوفمبر 2025", "6 ديسمبر 2025"]):
        bx1 = mx0 + mw - 26 - i * (mw / 2 - 8)
        bx0 = bx1 - (mw / 2 - 34)
        rrect(d, (bx0, my0 + 286, bx1, my0 + 330), 12, fill=(255, 255, 255), outline=LINE, width=1)
        text_r(img, v, bx1 - 16, my0 + 314, 11.5, INK, 700)

    # الأزرار
    rrect(d, (mx0 + 26, my0 + 348, mx0 + 200, my0 + 388), 11, fill=(240, 244, 243))
    text_c(img, "إلغاء", mx0 + 113, my0 + 373, 11.5, (91, 118, 115), 800)
    rb0, rb1 = mx0 + 212, mx0 + mw - 26
    rrect(d, (rb0, my0 + 348, rb1, my0 + 388), 11, fill=TEAL600)
    icon(img, "link", rb0 + 44, my0 + 368, 5.5, (255, 255, 255))
    text_c(img, "ربط الخطة", (rb0 + 78 + rb1) / 2, my0 + 374, 12, (255, 255, 255), 900)
    return img


def screen_portal_plan():
    """صفحة الخطة عند المريض — اليوم كام من كام + الوجبات + تعليمات.

    مطابق لـ portalPlanSheet() في js/patient-portal.js.
    """
    img, d = _portal_base()
    cx0, cx1 = _portal_top(img, d)
    w = cx1 - cx0
    R = 22

    text_r(img, "خطتك الغذائية", cx1, 100, 20, INK, 900)
    text_r(img, "خطة 1500 سعر — نحافة معتدلة", cx1, 122, 12.5, GREEN_D, 800)

    # شرائح
    chips = [("1500 سعر/يوم", (253, 241, 222), (146, 96, 10)),
             ("8 أسابيع", (233, 240, 253), (37, 99, 235)),
             ("6 نوفمبر — 6 ديسمبر", (238, 243, 242), (91, 118, 115))]
    cxp = cx1
    for lab, bg, fg in chips:
        cw = T.measure(lab, BOLD, px(10))[0] + 26
        rrect(d, (cxp - cw, 138, cxp, 166), 9, fill=bg)
        text_c(img, lab, cxp - cw / 2, 158, 10, fg, 800)
        cxp -= cw + 8

    # اليوم 12 من 56 + شريط التقدم
    _p_card(img, d, cx0, 178, w, 92)
    text_r(img, "اليوم 12 من 56", cx1 - R, 208, 15, INK, 900)
    text_l(img, "21% من البرنامج", cx0 + R, 208, 11.5, GREEN_D, 800)
    rrect(d, (cx0 + R, 224, cx1 - R, 240), 8, fill=(229, 237, 230))
    rrect(d, (cx0 + R, 224, cx0 + R + (w - 2 * R) * 0.21, 240), 8, fill=GREEN_P)

    # الوجبات
    meals = [("الفطار", "بيض مسلوق + جبن قريش + خيار وطماطم", True),
             ("الغدا", "فراخ مشوية + رز بني + سلطة خضراء", True),
             ("العشا", "زبادي + تفاحة + حفنة لوز", False)]
    y = 284
    for name, desc, alt in meals:
        _p_card(img, d, cx0, y, w, 84)
        rrect(d, (cx1 - R - 40, y + 14, cx1 - R, y + 54), 12, fill=(238, 247, 236))
        icon(img, "meal", cx1 - R - 20, y + 34, 8, GREEN_D)
        text_r(img, name, cx1 - R - 52, y + 38, 13.5, INK, 900)
        text_r(img, desc, cx1 - R - 52, y + 62, 11.5, (60, 84, 82), 700)
        if alt:
            rrect(d, (cx0 + R, y + 26, cx0 + R + 84, y + 56), 10, fill=(247, 250, 249))
            text_c(img, "شوف بدائل", cx0 + R + 42, y + 46, 9.5, GREEN_D, 800)
        y += 94

    # نصيحة اليوم
    rrect(d, (cx0, y + 4, cx1, y + 62), 14, fill=(255, 248, 230), outline=(244, 227, 177), width=1.5)
    icon(img, "star", cx1 - 28, y + 24, 6.5, AMBER)
    text_r(img, "نصيحة اليوم: كل ببطء — الشبع بياخد 20 دقيقة", cx1 - 44, y + 28, 10.5, (138, 109, 29), 800)

    # توقيع الدكتور
    rrect(d, (cx0, y + 70, cx1, y + 118), 14, fill=(236, 249, 240), outline=(180, 232, 205), width=1.5)
    text_r(img, "الخطة دي مخصصة ليك من د. أحمد سامي", cx1 - 20, y + 98, 11, GREEN_D, 800)
    return img


SCREENS = {
    "dashboard": screen_dashboard,
    "patients": screen_patients,
    "patient": screen_patient,
    "appointments": screen_appointments,
    "portal_home": screen_portal_home,
    "portal_log": screen_portal_log,
    "portal_progress": screen_portal_progress,
    "portal_appointments": screen_portal_appointments,
    "labs": screen_labs,
    "health": screen_health,
    "meds": screen_meds,
    "after_hours": screen_after_hours,
    "portal_health": screen_portal_health,
    "plans": screen_plans,
    "assign_plan": screen_assign_plan,
    "portal_plan": screen_portal_plan,
}

if __name__ == "__main__":
    for k, fn in SCREENS.items():
        im = fn()
        im.convert("RGB").resize((1280, 720), Image.LANCZOS).save(f"/tmp/ui_{k}.png")
        print("ok", k)
