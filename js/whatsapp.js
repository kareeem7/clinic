/**
 * ========================================
 * whatsapp.js
 * الوظيفة: رسائل المتابعة الجاهزة: تذكير موعد، تهنئة بالنتيجة، تذكير بالخطة، إرسال الخطة كاملة (بالملاحظات والموانع)، ومودال التأليف مع المعاينة القابلة للتعديل + بوابة موافقة المريض.
 * الدوال/الكيانات الرئيسية: waLink، waAppt، waCongrats، waPlanReminder، openApptModal
 * الاعتمادات: message-style.js, utils.js, state.js, db.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/whatsapp.js — المرحلة 8 + 13: تكامل واتساب (wa.me)
   Every message goes: raw type → doctor's style → real data →
   footer → editable compose modal → wa.me. Nothing logged to servers.
   ============================================================ */
// دالة مركزية: توليد wa.me/رقم مع رسالة مشفّرة (encodeURIComponent)
function waLink(phone, text) { return 'https://wa.me/' + normPhoneEG(phone) + '?text=' + encodeURIComponent(text); }

// 1) رسالة تأكيد موعد — بالقالب المطلوب حرفياً
function waAppt(id) {
  const a = byId(State.appointments, id); if (!a) return;
  const p = getPatient(a.patientId);
  const name = (p ? p.name : a.patientName || '').split(' ')[0];
  const body = buildStyledMessage('reminder', {
    first: name,
    weekday: DAYS[parseISO(a.date).getDay()],
    date: humanDate(a.date),
    time: fmtTime(a.time)
  });
  openComposeWA(p ? p.phone : '', body, { pid: a.patientId, type: 'reminder' });
}

// 2) رسالة تهنئة بالنتيجة — بنبرة الدكتور، مع وزن حقيقي مقروء من آخر قياس
function waCongrats(pid) {
  const p = getPatient(pid); if (!p) return;
  const { diff, current } = weightChange(p);
  if (diff >= 0) return toast('لا يوجد نزول مسجّل لهذا المريض بعد — أضف قياسات أولاً', 'info');
  const body = buildStyledMessage('congrats', {
    first: p.name.split(' ')[0],
    weight: current, diff: Math.abs(diff)
  });
  openComposeWA(p.phone, body, { pid, type: 'congrats_weight' });
}

// 3) رسالة تذكير بالخطة — برقم الوزن الحالي لو موجود + موعد القياس القادم
function waPlanReminder(pid) {
  const p = getPatient(pid), pl = getPlan(p?.planId); const s = State.settings;
  if (!p) return;
  if (!pl) return toast('هذا المريض غير مربوط بخطة — اربط خطة أولاً', 'error');
  const next = State.appointments
    .filter(a => a.patientId === p.id && a.date >= todayISO() && a.status !== 'cancelled')
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const weight = weightChange(p).current;
  const extra = (weight ? 'آخر قياس لك: ' + weight + ' كجم. ' : '') +
    'نتشرف باستمرارك على خطة «' + pl.title + '» (' + pl.calories + ' سعر/يوم).' +
    (next ? ' موعد القياس القادم: ' + DAYS[parseISO(next.date).getDay()] + ' ' + humanDate(next.date) + ' الساعة ' + fmtTime(next.time) + '.' : '');
  openComposeWA(p.phone, styleWrap(extra.trim()), { pid, type: 'plan_reminder' });
}

// ---- نموذج حجز موعد (قائمة مرضى قابلة للبحث + فترات ساعة + فحص التعارض) ----
function openApptModal(presetPatient) {
  const pts = activePatients().slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  if (!pts.length) return toast('أضف مريضاً أولاً قبل حجز المواعيد', 'error');
  // فترات المواعيد: كل ساعة من 9 صباحاً حتى 10 مساءً — معروضة كنطاق «5:00 م — 6:00 م»
  let times = '';
  for (let h = 9; h <= 21; h++) {
    const t = pad(h) + ':00';
    times += '<option value="' + t + '"' + (t === '17:00' ? ' selected' : '') + '>' +
      fmtTime(t) + ' — ' + fmtTime(pad(h + 1) + ':00') + '</option>';
  }
  openModal('حجز موعد جديد',
    '<form id="apptForm" class="form-grid">' +
      // اختيار المريض عبر قائمة قابلة للبحث الفوري
      '<div class="field full"><label>المريض *</label>' +
        '<div class="in-wrap"><i class="fa-solid fa-magnifying-glass"></i><input id="a_search" placeholder="ابحث بالاسم داخل القائمة..." autocomplete="off"></div>' +
        '<select class="input ltr" id="a_patient" size="5" style="margin-top:8px;text-align:right">' +
          pts.map(p => '<option value="' + p.id + '"' + (presetPatient === p.id ? ' selected' : '') + '>' +
            esc(p.name) + ' — ' + TYPE_LABEL[p.type] + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>التاريخ *</label><input class="input" type="date" id="a_date" required value="' + (Cal.selected || todayISO()) + '"></div>' +
      '<div class="field"><label>الفترة *</label><select class="input" id="a_time">' + times + '</select></div>' +
      '<div class="field"><label>نوع الجلسة</label><select class="input" id="a_type">' +
        '<option>جلسة علاج طبيعي</option><option>متابعة سمنة ونحافة</option><option>قياسات ومراجعة</option><option>استشارة</option><option>كشف جديد</option></select></div>' +
      '<div class="field"><label>المدة الفعلية</label><select class="input" id="a_dur">' +
        '<option value="60" selected>60 دقيقة</option><option value="45">45 دقيقة</option><option value="30">30 دقيقة</option></select></div>' +
      '<div class="field full"><label>ملاحظات</label><input class="input" id="a_note" placeholder="اختياري — تظهر في سجل الزيارات"></div>' +
      '<div id="aErr" class="form-error full"></div>' +
      '<div class="modal-foot full"><button type="button" class="btn btn-ghost" data-close>إلغاء</button>' +
      '<button class="btn btn-primary"><i class="fa-solid fa-calendar-check"></i> تأكيد الحجز</button></div></form>');

  // بحث فوري داخل قائمة المرضى
  const sel = $('#a_patient');
  $('#a_search').addEventListener('input', e => {
    const q = e.target.value.trim();
    [...sel.options].forEach(o => o.style.display = (!q || o.textContent.includes(q)) ? '' : 'none');
  });

  $('#apptForm').onsubmit = async e => {
    e.preventDefault();
    const errBox = $('#aErr'); errBox.classList.remove('show');
    const pid = sel.value, p = getPatient(pid);
    if (!p) { errBox.textContent = 'اختر مريضاً من القائمة أولاً'; errBox.classList.add('show'); return; }
    const date = $('#a_date').value, time = $('#a_time').value, dur = +$('#a_dur').value;
    if (!date) { errBox.textContent = 'اختر تاريخ الموعد'; errBox.classList.add('show'); return; }
    // ===== فحص تعارض المواعيد: منع موعدين متداخلين في نفس اليوم =====
    const toMin = t => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; };
    const ns = toMin(time), ne = ns + dur;
    const clash = State.appointments.find(x => x.date === date && x.status !== 'cancelled' &&
      ns < toMin(x.time) + (x.duration || 30) && toMin(x.time) < ne);
    if (clash) {
      const cp = getPatient(clash.patientId);
      errBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <b>تعارض مواعيد:</b> يوجد موعد محجوز مع «' +
        esc(cp ? cp.name : clash.patientName) + '» الساعة ' + fmtTime(clash.time) + ' في نفس اليوم — اختر فترة أخرى';
      errBox.classList.add('show');
      return;
    }
    const sBtn = e.target.querySelector('.btn-primary'); sBtn.disabled = true; // منع الضغط المزدوج أثناء الحفظ
    try {
      await DB.add('appointments', {
        patientId: pid, patientName: p.name, date, time,
        duration: dur, type: $('#a_type').value, status: 'pending', note: $('#a_note').value.trim()
      });
      toast('تم حجز الموعد مع ' + p.name + ' — بانتظار التأكيد');
      closeModal();
      Cal.selected = date; // الانتقال لليوم المحجوز مباشرة
      refreshCurrent();
    } catch (ex) { // فشل الشبكة/الخادم → رسالة واضحة بدل الصمت
      errBox.textContent = 'تعذّر حفظ الموعد — تحقق من الاتصال بالإنترنت وحاول مجدداً';
      errBox.classList.add('show'); sBtn.disabled = false;
    }
  };
}
