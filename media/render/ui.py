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


SCREENS = {
    "dashboard": screen_dashboard,
    "patients": screen_patients,
    "patient": screen_patient,
    "appointments": screen_appointments,
}

if __name__ == "__main__":
    for k, fn in SCREENS.items():
        im = fn()
        im.convert("RGB").resize((1280, 720), Image.LANCZOS).save(f"/tmp/ui_{k}.png")
        print("ok", k)
