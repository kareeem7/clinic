/**
 * ========================================
 * patient.js
 * الوظيفة: ملف المريض التفصيلي: الرأس والتعريف، جدول القياسات وحذفها، منحنى تطور الوزن ومحيطات الجسم (Chart.js) بفترات 1م/3م/الكل.
 * الدوال/الكيانات الرئيسية: 
 * الاعتمادات: app.js, state.js, db.js, utils.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/patient.js — المرحلة 5: ملف المريض التفصيلي + منحنى التطور
   ============================================================ */
// الدفعة ٣: كود دخول البوابة inside ملف الطبيب.
// الكود دائم بلا أي زر تغيير/تدوير؛ issue_patient_code ثابتة (idempotent)
// فبتعرض الكود الموجود أو بتصدره أول مرة من غير ما تبدّله.
async function renderPatientAccess(p) {
  const box = $('#patAccessBody');
  if (!box) return;
  if (!DB.sb || typeof DB.sb.rpc !== 'function') return;
  box.innerHTML = 'جارٍ التحميل…';
  try {
    const { data, error } = await DB.sb.rpc('issue_patient_code', { p_patient_id: p.id });
    if (error) throw error;
    if (data && data.ok === false) throw { message: data.error || 'تعذّر إصدار الكود' };
    const code = data && (typeof data === 'string' ? data : data.code);
    if (!code) throw { message: 'empty access code' };
    box.innerHTML =
      '<div class="sys-row"><div style="flex:1">' +
        '<b class="ltr" style="font-size:17px;letter-spacing:.5px">' + esc(code) + '</b>' +
        '<small>الكود الدائم للمريض — يدخل بيه كل مرة مع رقم موبايله، وبيظهر له دائماً داخل البوابة. مفيش زر تغيير أو تدوير.</small>' +
      '</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<button class="btn btn-outline sm" type="button" data-action="pt-access-off" data-id="' + esc(p.id) + '"><i class="fa-solid fa-ban"></i> إيقاف دخول البوابة (طوارئ)</button>' +
        '<button class="btn btn-ghost sm" type="button" data-action="pt-access-on" data-id="' + esc(p.id) + '"><i class="fa-solid fa-unlock"></i> إعادة تشغيل الدخول</button>' +
      '</div>';
  } catch (e) {
    logError(e, 'patient.accessCode');
    box.innerHTML = '<b style="color:var(--rose)">تعذّر إصدار الكود.</b> ' +
      esc((e && e.message) || '') + ' — لو الرسالة بتقول «اختار بادئة الفرع»، روح «الإعدادات ← الفروع وأكواد الدخول» واختارها ثم ارجع لملف المريض.';
  }
}

async function renderPatientDetail(id) {
  let p = getPatient(id);
  if (!p) return go('patients');
  // (بند 31) لو وصلنا من الفهرس الخفيف (مواعيد/لوحة/خطط) نجلب الصف الكامل للملف
  if (!p._full) {
    try { const full = await DB.loadPatientFull(id); if (full) p = full; } catch (e) { logError(e, 'patient.full'); }
  }
  // جلب سجل القياسات من جدول patient_records عند العمل على Supabase
  // Every show of a patient profile re-fetches fresh records (and the read is audited)
  if (!p._recordsLoaded) {
    try { await DB.loadRecords(p.id); p._recordsLoaded = true; } catch (e) { logError(e, 'records.lazy'); }
  }
  // (بند 31) ملاحظات هذا المريض تُجلب عند الطلب — مش ملاحظات العيادة كلها عند الإقلاع
  try { await DB.loadNotesFor(p.id); } catch (e) { logError(e, 'notes.lazy'); }
  // Audit the profile view itself — mandatory per compliance rules (contains only an id)
  DB.audit('view', 'patients', p.id, { scope: 'profile' });
  // الدفعة ٣: كود البوابة الدائم في ملف الطبيب (best-effort، ما يعطّلش باقي الملف)
  renderPatientAccess(p);

  // رأس الملف: هوية + أزرار تواصل
  $('#patHeader').innerHTML =
    '<div class="avatar lg" style="background:' + avatarColor(p.name) + '">' + esc(initials(p.name)) + '</div>' +
    '<div class="who"><h2>' + esc(p.name) + typeChip(p.type) + chronicChips(p) + '</h2>' +
      '<small>' + (p.gender || '') + (p.age ? ' — ' + p.age + ' سنة' : '') + (p.height ? ' — ' + p.height + ' سم' : '') + '</small></div>' +
    '<div class="acts">' +
      '<a class="btn btn-outline sm" href="tel:' + esc(p.phone) + '"><i class="fa-solid fa-phone"></i> اتصال</a>' +
      '<button class="btn btn-outline sm" data-action="wa-patient" data-id="' + p.id + '" style="color:#128c4b"><i class="fa-brands fa-whatsapp"></i> واتساب</button>' +
      '<button class="btn btn-ghost sm" data-action="edit-patient" data-id="' + p.id + '"><i class="fa-solid fa-pen"></i> تعديل</button>' +
      '<button class="btn btn-ghost sm" data-action="del-patient" data-id="' + p.id + '" style="color:var(--rose)"><i class="fa-solid fa-trash"></i></button>' +
    '</div>';

  // بيانات تعريفية
  $('#patMeta').innerHTML =
    metaItem('رقم الموبايل', '<span class="ltr">' + esc(p.phone || '—') + '</span>') +
    metaItem('تاريخ الانضمام', humanDate(p.createdAt || todayISO())) +
    metaItem('التشخيص / الهدف', esc(p.diagnosis || '—')) +
    (p.type === 'nutrition'
      ? metaItem('الوزن المستهدف', p.targetWeight ? p.targetWeight + ' كجم' : 'لم يُحدد')
      : metaItem('عدد الجلسات', (p.measurements || []).filter(m => !isInBodyRecord(m)).length + ' جلسة'));

  // المؤشرات حسب التخصص
  let kpis = '';
  if (p.type === 'nutrition') {
    const { diff, current } = weightChange(p);
    const b = bmi(current, p.height);
    kpis =
      kpiHTML('fa-weight-scale', 'teal', current ? current + ' كجم' : '—', 'الوزن الحالي', 'آخر قياس مسجّل') +
      kpiHTML(diff <= 0 ? 'fa-arrow-trend-down' : 'fa-arrow-trend-up', diff <= 0 ? 'green' : 'rose',
        (diff > 0 ? '+' : '') + diff + ' كجم', 'التغير من البداية', diff < 0 ? 'نزول ممتاز' : diff > 0 ? 'زيادة — راجع الخطة' : 'ثابت', diff < 0) +
      kpiHTML('fa-calculator', 'blue', b || '—', 'مؤشر كتلة الجسم', b ? bmiText(b) : 'أدخل الطول والوزن') +
      kpiHTML('fa-bullseye', 'amber', p.targetWeight ? p.targetWeight + ' كجم' : '—', 'الهدف',
        current && p.targetWeight ? 'متبقٍ ' + Math.max(0, +(current - p.targetWeight).toFixed(1)) + ' كجم' : 'حدّد الهدف من التعديل');
  } else {
    const ms = (p.measurements || []).filter(m => !isInBodyRecord(m)).slice().sort((a, b) => a.date.localeCompare(b.date));
    const first = ms[0], last = ms[ms.length - 1];
    kpis =
      kpiHTML('fa-clipboard-list', 'teal', ms.length, 'جلسة مكتملة', 'منذ ' + (first ? humanDate(first.date) : '—')) +
      kpiHTML('fa-face-smile', last && last.pain <= 3 ? 'green' : 'rose', last ? last.pain + '/10' : '—', 'مقياس الألم الحالي',
        first && last ? 'كان ' + first.pain + '/10 عند البداية' : '', last && last.pain <= 3) +
      kpiHTML('fa-notes-medical', 'blue', esc(p.diagnosis || '—').slice(0, 12) + '…', 'التشخيص', '') +
      kpiHTML('fa-calendar-check', 'violet', State.appointments.filter(a => a.patientId === p.id && a.date >= todayISO() && a.status !== 'cancelled').length, 'مواعيد قادمة', '');
  }
  $('#patKpis').innerHTML = kpis;

  // عنوان ومحتوى الرسم البياني حسب التخصص
  $('#patChartTitle').innerHTML = '<i class="fa-solid fa-chart-line"></i> ' + (p.type === 'nutrition' ? 'منحنى تطور الوزن' : 'منحنى مقياس الألم عبر الجلسات');
  drawPatientChart(p);

  // خط زمني للقياسات (الأحدث أولاً) — مع عرض الخصر/الأرداف/الدهون إن وُجدت
  const msDesc = (p.measurements || []).filter(m => !isInBodyRecord(m)).slice().sort((a, b) => b.date.localeCompare(a.date));
  $('#patMeasureList').innerHTML = msDesc.length ? msDesc.map(m => {
    const isNut = p.type === 'nutrition';
    const dotColor = isNut ? 'teal' : (m.pain <= 3 ? 'green' : m.pain <= 6 ? 'amber' : 'rose');
    // رقائق القياسات الإضافية لمرضى السمنة
    // المرحلة 16: علامات مصدر القياس — من البيت (موبايل) بلون مختلف عن من العيادة
    const srcChip = m.source === 'patient'
      ? ' <span class="chip chip-blue"><i class="fa-solid fa-mobile-screen-button"></i> من البيت</span>'
      : ' <span class="chip chip-gray"><i class="fa-solid fa-hospital"></i> من العيادة</span>';
    const photoChip = m.photoPath ? ' <button class="chip chip-teal" style="cursor:pointer" data-action="view-photo" data-x="' + esc(m.photoPath) + '"><i class="fa-solid fa-image"></i> صورة</button>' : '';
    const extras = srcChip + photoChip + (isNut
      ? (m.waist != null ? ' <span class="chip chip-gray">خصر ' + m.waist + ' سم</span>' : '') +
        (m.hips  != null ? ' <span class="chip chip-gray">أرداف ' + m.hips + ' سم</span>' : '') +
        (m.arm   != null ? ' <span class="chip chip-gray">ذراع ' + m.arm + ' سم</span>' : '') +
        (m.fat   != null ? ' <span class="chip chip-gray">دهون ' + m.fat + '%</span>' : '')
      : '');
    return '<div class="tl-item"><div class="tl-dot" style="background:var(--' + dotColor + '-soft,var(--teal-50));color:var(--' + dotColor + ',var(--teal-700))">' +
      '<i class="fa-solid ' + (isNut ? 'fa-weight-scale' : 'fa-hand-holding-medical') + '"></i></div>' +
      '<div class="tl-body"><b>' + (isNut ? m.weight + ' كجم' : 'الجلسة ' + (m.session || '—') + ' — ألم ' + m.pain + '/10') + '</b>' + extras +
      '<small style="display:block;margin-top:3px">' + relDay(m.date) + '</small>' + (m.note ? '<p>' + esc(m.note) + '</p>' : '') + '</div>' +
      '<button class="icon-btn sm danger tl-x" data-action="del-measure" data-id="' + p.id + '" data-x="' + m.id + '" title="حذف القياس"><i class="fa-solid fa-trash"></i></button></div>';
  }).join('') : emptyHTML('fa-scale-balanced', 'لا توجد قياسات بعد', 'أضف أول قياس من الزر بالأعلى لبدء متابعة التطور');
  renderPatientInBody(p);

  // بطاقة الخطة الغذائية المرتبطة
  const plan = getPlan(p.planId);
  $('#patPlan').innerHTML =
    '<div class="card-head"><h3><i class="fa-solid fa-utensils"></i> الخطة الغذائية</h3></div>' +
    (p.type !== 'nutrition'
      ? '<p class="muted" style="font-size:13.5px;font-weight:600">مريض علاج طبيعي — يمكن ربط خطة تغذية مساندة إن رغبت.</p>'
      : plan
        ? '<div class="p-chips" style="margin-bottom:10px"><span class="chip chip-amber"><i class="fa-solid fa-fire"></i>' + plan.calories + ' سعر / يوم</span>' +
          (plan.duration ? '<span class="chip chip-blue"><i class="fa-solid fa-hourglass-half"></i>' + esc(plan.duration) + '</span>' : '') +
          (p.planStart ? '<span class="chip chip-gray"><i class="fa-solid fa-calendar"></i> ' + humanDate(p.planStart) + ' — ' + humanDate(p.planEnd || p.planStart) + '</span>' : '') +
          '</div>' +
          '<b style="font-size:15px">' + esc(plan.title) + '</b><p class="muted" style="font-size:13px;margin:4px 0 12px">' + esc(plan.desc || '') + '</p>' +
          '<ul class="plan-meals">' + plan.meals.slice(0, 4).map(m => '<li><i class="fa-solid fa-circle-check"></i><span><b>' + esc(m.name) + ':</b> ' + esc(m.desc) + '</span></li>').join('') + '</ul>'
        : '<p class="muted" style="font-size:13.5px;font-weight:600;margin-bottom:12px">لم تُربط أي خطة غذائية بهذا المريض بعد.</p>') +
    // شريط رسائل واتساب جاهزة (المرحلة 8): إرسال الخطة / تذكير بالخطة / تهنئة بالنتيجة
    '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
      '<button class="btn btn-primary sm" data-action="assign-plan" data-id="' + p.id + '"><i class="fa-solid fa-link"></i> ' + (plan ? 'تغيير الخطة' : 'ربط خطة') + '</button>' +
      (plan ? '<button class="btn btn-ghost sm" data-action="view-plan" data-id="' + plan.id + '"><i class="fa-solid fa-eye"></i> التفاصيل</button>' +
              '<button class="btn btn-ghost sm" data-action="unassign-plan" data-id="' + p.id + '">إزالة الربط</button>' : '') +
    '</div>' +
    '<div class="p-chips" style="margin-top:12px"><span class="chip chip-green"><i class="fa-brands fa-whatsapp"></i> رسائل جاهزة:</span>' +
      (plan
        ? '<button class="chip chip-green" style="cursor:pointer" data-action="wa-plan" data-id="' + p.id + '">إرسال الخطة كاملة</button>' +
          '<button class="chip chip-green" style="cursor:pointer" data-action="wa-remind-plan" data-id="' + p.id + '">تذكير بالخطة</button>'
        : '') +
      (p.type === 'nutrition' ? '<button class="chip chip-green" style="cursor:pointer" data-action="wa-congrats" data-id="' + p.id + '">تهنئة بالنتيجة</button>' : '') +
    '</div>';

  // تبويب المواعيد: القادمة مرتبة تصاعدياً
  const future = State.appointments.filter(a => a.patientId === p.id && a.date >= todayISO() && a.status !== 'cancelled')
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  $('#patAppts').innerHTML = future.length ? future.map(a => apptItemHTML(a, false, true)).join('')
    : emptyHTML('fa-calendar-xmark', 'لا مواعيد قادمة', 'احجز موعداً جديداً من الزر بالأعلى');

  // تبويب الزيارات: المواعيد المكتملة مرتبة تنازلياً مع ملاحظاتها
  const visits = State.appointments.filter(a => a.patientId === p.id && a.status === 'done')
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  $('#patVisits').innerHTML = visits.length ? visits.map(v =>
    '<div class="tl-item"><div class="tl-dot" style="background:var(--green-soft);color:var(--green)"><i class="fa-solid fa-check"></i></div>' +
    '<div class="tl-body"><b>' + esc(v.type || 'زيارة') + '</b> ' + stChip('done') +
    '<small style="display:block;margin-top:3px"><i class="fa-solid fa-calendar"></i> ' + relDay(v.date) + ' — ' + fmtTime(v.time) + '</small>' +
    (v.note ? '<p>' + esc(v.note) + '</p>' : '') + '</div></div>').join('')
    : emptyHTML('fa-clipboard', 'لا زيارات مكتملة بعد', 'بعد تعليم أي موعد «تمت» ستظهر الزيارة هنا مع ملاحظاتها');

  // الملاحظات
  $('#patNotes').innerHTML = '<div class="card-head"><h3><i class="fa-solid fa-note-sticky"></i> ملاحظات</h3></div>' +
    '<p style="font-size:14px;font-weight:600;color:#3d5654">' + (esc(p.notes || '') || 'لا توجد ملاحظات مسجلة.') + '</p>';

  // مزامنة واجهة فلتر فترة المنحنى مع الحالة الحفوظة (تبقى عند التنقل بين المرضى)
  $$('#rangeTabs button').forEach(b => b.classList.toggle('active', b.dataset.range === State.pRange));

  await loadPatientHealthMonitoring(p); // إعداد وسجل طبيبان فقط بحسب تفعيل العيادة والمريض
  await loadPatientLabs(p); // لا نجلب النتائج الطبية إلا إذا كانت ميزة التحاليل مفعّلة
  renderPatientNotes(p); // تبويب الملاحظات والأمراض المزمنة
}

function renderPatientInBody(p) {
  const enabled = normalizeClinicalFeatures((State.settings || {}).clinicalFeatures).inbody;
  $('#patInbodySection').classList.toggle('hide', !enabled);
  if (!enabled) return; // keep source rows in p.measurements; only hide the feature UI

  const records = (p.measurements || []).filter(m => m && m.recordType === 'inbody')
    .slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const metric = (label, value, unit) => value == null ? '' :
    '<span class="chip chip-gray">' + label + ': ' + esc(value) + (unit ? ' ' + unit : '') + '</span>';
  $('#patInbodyList').innerHTML = records.length ? records.map(m =>
    '<article class="inbody-record"><div class="inbody-record-head"><b>' + esc(humanDate(m.date)) +
      '</b><span class="chip chip-blue"><i class="fa-solid fa-wave-square"></i> InBody</span>' +
      '<span class="inbody-record-actions"><button class="icon-btn sm" data-action="edit-inbody" data-id="' + esc(p.id) + '" data-x="' + esc(m.id) + '" aria-label="تعديل فحص InBody"><i class="fa-solid fa-pen"></i></button>' +
      '<button class="icon-btn sm danger" data-action="del-inbody" data-id="' + esc(p.id) + '" data-x="' + esc(m.id) + '" aria-label="حذف فحص InBody"><i class="fa-solid fa-trash"></i></button></span></div>' +
      '<div class="inbody-metrics">' +
        metric('الوزن', m.weight, 'كجم') + metric('BMI', m.bmi, 'كجم/م²') +
        metric('نسبة الدهون', m.fat, '%') + metric('كتلة الدهون', m.bodyFatMass, 'كجم') +
        metric('كتلة العضلات الهيكلية', m.skeletalMuscleMass, 'كجم') +
        metric('الدهون الحشوية', m.visceralFatLevel, 'مستوى') + metric('نسبة الماء', m.bodyWaterPct, '%') +
      '</div>' + (m.note ? '<p class="inbody-note">' + esc(m.note) + '</p>' : '') + '</article>'
  ).join('') : emptyHTML('fa-wave-square', 'لا توجد فحوص InBody بعد', 'أضف فحصًا لبدء سجل مكونات الجسم');
}

