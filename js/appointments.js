/**
 * ========================================
 * appointments.js
 * الوظيفة: المواعيد: التقويم الأسبوعي، قائمة اليوم المختار، نموذج الحجز مع فحص التعارض، تغيير الحالة، والتذكير عبر واتساب.
 * الدوال/الكيانات الرئيسية: renderAppointments، apptItemHTML
 * الاعتمادات: app.js, state.js, db.js, utils.js, whatsapp.js (وقت النداء)
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/appointments.js — المرحلة 6: نظام حجز المواعيد
   ============================================================ */
function renderAppointments() {
  const ws = weekStartISO(Cal.anchor);
  const startD = parseISO(ws), endD = parseISO(addDaysISO(ws, 6));
  $('#calWeekLabel').textContent = 'أسبوع ' + startD.getDate() + ' ' + MONTHS[startD.getMonth()] + ' — ' +
    endD.getDate() + ' ' + MONTHS[endD.getMonth()] + ' ' + endD.getFullYear();

  // شريط أيام الأسبوع السبعة
  const apptDates = new Set(State.appointments.filter(a => a.status !== 'cancelled').map(a => a.date));
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const iso = addDaysISO(ws, i), d = parseISO(iso);
    const cls = ['day-cell', iso === Cal.selected ? 'selected' : '', iso === todayISO() ? 'is-today' : ''].join(' ');
    const count = State.appointments.filter(a => a.date === iso && a.status !== 'cancelled').length;
    // (بند 30) النقاط مش لغة — اسم اليوم وعدد مواعيده ناطقين لقارئ الشاشة
    strip += '<button class="' + cls + '" data-day="' + iso + '"' +
      ' aria-label="' + DAYS_S[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' — ' + count + (count === 1 ? ' موعد' : ' مواعيد') + (iso === todayISO() ? ' — اليوم' : '') + '"' +
      (iso === Cal.selected ? ' aria-current="date"' : '') + '>' +
      '<span class="d-name">' + DAYS_S[d.getDay()] + '</span><span class="d-num">' + d.getDate() + '</span>' +
      '<span class="d-dots" aria-hidden="true">' + '<i></i>'.repeat(Math.min(count, 3)) + '</span></button>';
  }
  $('#weekStrip').innerHTML = strip;
  $$('#weekStrip [data-day]').forEach(b => b.onclick = () => { Cal.selected = b.dataset.day; renderAppointments(); });

  // قائمة مواعيد اليوم المحدد
  const list = State.appointments.filter(a => a.date === Cal.selected).sort((a, b) => a.time.localeCompare(b.time));
  $('#dayLabel').innerHTML = '<i class="fa-solid fa-calendar-day"></i> مواعيد ' + relDay(Cal.selected);
  $('#dayCount').textContent = list.filter(a => a.status !== 'cancelled').length + ' موعد';
  $('#dayList').innerHTML = list.length ? list.map(a => apptItemHTML(a, true)).join('')
    : emptyHTML('fa-calendar-xmark', 'لا مواعيد في هذا اليوم', 'اضغط «حجز موعد» لإضافة أول موعد');
}

// عنصر موعد موحّد (يُستخدم في الرئيسية والتقويم وملف المريض)
function apptItemHTML(a, fullActions, showDate) {
  const p = getPatient(a.patientId);
  const dim = (a.status === 'cancelled') ? ' dim' : '';
  let acts = '';
  if (a.status === 'pending') {
    acts += '<button class="icon-btn sm" data-action="appt-set" data-id="' + a.id + '" data-status="confirmed" title="تأكيد الموعد" aria-label="تأكيد الموعد"><i class="fa-solid fa-check"></i></button>';
  }
  if (a.status === 'confirmed' || a.status === 'pending') {
    acts += '<button class="icon-btn sm wa" data-action="appt-wa" data-id="' + a.id + '" title="تذكير واتساب" aria-label="تذكير واتساب"><i class="fa-brands fa-whatsapp"></i></button>' +
      '<button class="icon-btn sm" data-action="appt-set" data-id="' + a.id + '" data-status="done" title="تمت الجلسة" aria-label="تمت الجلسة" style="color:var(--green)"><i class="fa-solid fa-circle-check"></i></button>' +
      '<button class="icon-btn sm danger" data-action="appt-set" data-id="' + a.id + '" data-status="cancelled" title="إلغاء الموعد" aria-label="إلغاء الموعد"><i class="fa-solid fa-ban"></i></button>';
  }
  if (a.status === 'cancelled' || a.status === 'done') {
    acts += '<button class="icon-btn sm" data-action="appt-set" data-id="' + a.id + '" data-status="confirmed" title="إعادة فتح" aria-label="إعادة فتح الموعد"><i class="fa-solid fa-rotate-left"></i></button>';
  }
  return '<div class="appt st-' + a.status + dim + '">' +
    '<div class="appt-time"><strong>' + fmtTime(a.time) + '</strong><small>' + (a.duration || 30) + ' دقيقة</small></div>' +
    '<div class="appt-info">' +
      '<button class="link" data-action="view-patient" data-id="' + a.patientId + '">' + esc(p ? p.name : a.patientName || 'مريض محذوف') + '</button>' +
      '<div class="appt-meta">' + (showDate ? '<span><i class="fa-solid fa-calendar"></i>' + relDay(a.date) + '</span>' : '') +
        '<span><i class="fa-solid fa-notes-medical"></i>' + esc(a.type || 'موعد') + '</span>' + stChip(a.status) + '</div></div>' +
    '<div class="appt-acts">' + acts + '</div></div>';
}

// تغيير حالة موعد (محمي بمعالجة أخطاء + يحدّث كل الشاشات المتأثرة)
async function setApptStatus(id, status) {
  try {
    await DB.update('appointments', id, { status });
    toast(status === 'done' ? 'تمت الجلسة — أحسنت' : status === 'cancelled' ? 'تم إلغاء الموعد' : 'تم تحديث الموعد');
  } catch (e) { toast('تعذّر تحديث حالة الموعد — تحقق من الاتصال', 'error'); }
  renderAppointments();
  if (State.route === 'dashboard') renderDashboard();
  if (State.route === 'patient') renderPatientDetail(State.param); // تحديث تبويب مواعيد المريض إن كان مفتوحاً
}

