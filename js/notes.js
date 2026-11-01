/**
 * ========================================
 * notes.js
 * الوظيفة: ملاحظات الزيارات والمتابعة المزمنة: تسجيل قراءات السكر والضغط والأدوية وموعد الزيارة القادمة، عرضها وتصنيفها، وحذفها.
 * الدوال/الكيانات الرئيسية: sugarClass، bpClass، renderPatientNotes، openNoteModal، metaItem، bmiText، drawPatientChart، openMeasureModal
 * الاعتمادات: app.js, state.js, db.js, utils.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/notes.js — ملاحظات الزيارات ومتابعة الأمراض المزمنة
   ============================================================ */
// تصنيف قراءة السكر حسب نوعها (صائم / فاطر) — إرشادي للدكتور
function sugarClass(v, type) {
  if (v == null) return '';
  if (type === 'صائم') return v < 100 ? 'ok' : v <= 126 ? 'warn' : 'bad';
  return v < 140 ? 'ok' : v <= 200 ? 'warn' : 'bad'; // فاطر / عشوائي
}
// تصنيف ضغط الدم حسب الانقباضي والانبساطي
function bpClass(s, d) {
  if (s == null) return '';
  if (s < 120 && d < 80) return 'ok';
  if (s < 140 && d < 90) return 'warn';
  return 'bad';
}

function renderPatientNotes(p) {
  // شريط الأمراض المزمنة وآخر القراءات
  const notes = State.notes.filter(n => n.patientId === p.id).sort((a, b) => b.date.localeCompare(a.date));
  const last = notes[0];
  const chronic = p.chronic || [];
  $('#chronicBar').innerHTML = chronic.length
    ? '<div class="p-chips" style="margin-bottom:10px"><span class="muted" style="font-size:12.5px;font-weight:800">أمراض مزمنة مسجّلة:</span>' + chronicChips(p) + '</div>' +
      (last ? '<div class="note-meta">' +
        (last.sugar != null ? '<span class="vital ' + sugarClass(last.sugar, last.sugarType) + '"><i class="fa-solid fa-droplet"></i> آخر سكر: ' + last.sugar + ' (' + esc(last.sugarType || '') + ')</span>' : '') +
        (last.bpSys != null ? '<span class="vital ' + bpClass(last.bpSys, last.bpDia) + '"><i class="fa-solid fa-heart-pulse"></i> آخر ضغط: ' + last.bpSys + '/' + last.bpDia + '</span>' : '') +
        (last.nextVisit ? '<span class="chip chip-blue"><i class="fa-solid fa-calendar-day"></i> متابعة قادمة: ' + humanDate(last.nextVisit) + '</span>' : '') +
        '</div>' : '')
    : '<div class="tip-card"><i class="fa-solid fa-circle-info"></i><p>هذا المريض غير مسجّل عليه أمراض مزمنة. لتفعيل متابعة السكر أو الضغط اضغط «تعديل» بالأعلى واختر المرض.</p></div>';

  // منحنى متابعة السكر والضغط (يظهر فقط عند وجود قراءتين فأكثر)
  const series = notes.slice().reverse().filter(n => n.sugar != null || n.bpSys != null);
  const wrap = $('#chronicChartWrap');
  if (series.length >= 2 && window.Chart) {
    wrap.classList.remove('hide');
    const ds = [];
    if (series.some(n => n.sugar != null)) ds.push({ label: 'السكر (mg/dL)', data: series.map(n => n.sugar ?? null), spanGaps: true,
      borderColor: '#e11d48', backgroundColor: 'rgba(225,29,72,.1)', borderWidth: 3, tension: .4, fill: true,
      pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#e11d48', pointBorderWidth: 2 });
    if (series.some(n => n.bpSys != null)) {
      ds.push({ label: 'الضغط الانقباضي', data: series.map(n => n.bpSys ?? null), spanGaps: true, yAxisID: 'y1',
        borderColor: '#7c3aed', borderWidth: 2.5, tension: .4, fill: false, pointRadius: 4, pointStyle: 'rectRot',
        pointBackgroundColor: '#fff', pointBorderColor: '#7c3aed', pointBorderWidth: 2 });
      ds.push({ label: 'الانبساطي', data: series.map(n => n.bpDia ?? null), spanGaps: true, yAxisID: 'y1',
        borderColor: '#2563eb', borderDash: [5, 4], borderWidth: 2, tension: .4, fill: false, pointRadius: 3 });
    }
    makeChart('chronic', $('#chronicChart'), { type: 'line',
      data: { labels: series.map(n => humanDate(n.date)), datasets: ds },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { rtl: true, labels: { usePointStyle: true, boxWidth: 8, font: { weight: 700 } } }, tooltip: { rtl: true, textDirection: 'rtl' } },
        scales: { y: { position: 'right', grid: { color: '#edf3f2' } }, y1: { position: 'left', grid: { display: false } }, x: { grid: { display: false } } } } });
  } else { wrap.classList.add('hide'); }

  // قائمة ملاحظات الزيارات (الأحدث أولاً)
  $('#notesList').innerHTML = notes.length ? notes.map(n =>
    '<div class="note-card"><div class="note-head">' +
      '<span class="chip chip-teal"><i class="fa-solid fa-calendar"></i> ' + relDay(n.date) + '</span>' +
      (n.meds ? '<span class="chip chip-gray"><i class="fa-solid fa-pills"></i> ' + esc(n.meds) + '</span>' : '') +
      '<button class="icon-btn sm danger" data-action="del-note" data-id="' + n.id + '" title="حذف الملاحظة"><i class="fa-solid fa-trash"></i></button>' +
    '</div>' +
    (n.note ? '<p class="note-body">' + esc(n.note) + '</p>' : '') +
    '<div class="note-meta">' +
      (n.sugar != null ? '<span class="vital ' + sugarClass(n.sugar, n.sugarType) + '"><i class="fa-solid fa-droplet"></i> سكر ' + n.sugar + ' — ' + esc(n.sugarType || '') + '</span>' : '') +
      (n.bpSys != null ? '<span class="vital ' + bpClass(n.bpSys, n.bpDia) + '"><i class="fa-solid fa-heart-pulse"></i> ضغط ' + n.bpSys + '/' + n.bpDia + '</span>' : '') +
      (n.nextVisit ? '<span class="chip chip-blue"><i class="fa-solid fa-calendar-day"></i> متابعة: ' + humanDate(n.nextVisit) + '</span>' : '') +
    '</div></div>').join('')
    : emptyHTML('fa-notes-medical', 'لا توجد ملاحظات بعد', 'سجّل ملاحظة كل زيارة مع قراءات السكر والضغط لمتابعة دقيقة');
}

// نموذج إضافة ملاحظة زيارة — الحقول تظهر حسب أمراض المريض المزمنة
function openNoteModal(pid) {
  const p = getPatient(pid); if (!p) return;
  const ch = p.chronic || [];
  const hasDia = ch.includes('diabetes'), hasBp = ch.includes('hypertension') || ch.includes('heart');
  openModal('ملاحظة زيارة — ' + esc(p.name),
    '<form id="noteForm" class="form-grid">' +
      (ch.length ? '<div class="p-chips full">' + chronicChips(p) + '</div>' : '') +
      '<div class="field"><label>تاريخ الزيارة</label><input class="input" type="date" id="n_date" value="' + todayISO() + '"></div>' +
      '<div class="field"><label>موعد المتابعة القادم</label><input class="input" type="date" id="n_next" value="' + addDaysISO(todayISO(), 14) + '"></div>' +
      (hasDia
        ? '<div class="field"><label>قراءة السكر (mg/dL)</label><input class="input ltr" id="n_sugar" type="number" min="40" max="600" placeholder="110"></div>' +
          '<div class="field"><label>نوع القراءة</label><select class="input" id="n_stype"><option>صائم</option><option>فاطر</option><option>عشوائي</option></select></div>' : '') +
      (hasBp
        ? '<div class="field"><label>الضغط الانقباضي (العالي)</label><input class="input ltr" id="n_sys" type="number" min="70" max="260" placeholder="120"></div>' +
          '<div class="field"><label>الضغط الانبساطي (الواطي)</label><input class="input ltr" id="n_dia" type="number" min="40" max="160" placeholder="80"></div>' : '') +
      '<div class="field full"><label>الأدوية الحالية</label><input class="input" id="n_meds" value="' + esc((State.notes.filter(x => x.patientId === pid).sort((a, b) => b.date.localeCompare(a.date))[0] || {}).meds || '') + '" placeholder="مثال: ميتفورمين 500 مرتين يومياً"></div>' +
      '<div class="field full"><label>ملاحظة الزيارة *</label><textarea class="input" id="n_note" required placeholder="شكوى المريض، ملاحظات الفحص، التوصيات..."></textarea></div>' +
      '<div id="nErr" class="form-error full"></div>' +
      '<div class="modal-foot full"><button type="button" class="btn btn-ghost" data-close>إلغاء</button>' +
      '<button class="btn btn-primary"><i class="fa-solid fa-check"></i> حفظ الملاحظة</button></div></form>', 600);

  $('#noteForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('.btn-primary'); btn.disabled = true;
    const rec = { patientId: pid, date: $('#n_date').value || todayISO(), note: $('#n_note').value.trim(),
      meds: $('#n_meds').value.trim(), nextVisit: $('#n_next').value || null };
    if (hasDia && +$('#n_sugar').value > 0) { rec.sugar = +$('#n_sugar').value; rec.sugarType = $('#n_stype').value; }
    if (hasBp && +$('#n_sys').value > 0) { rec.bpSys = +$('#n_sys').value; rec.bpDia = +$('#n_dia').value || null; }
    try {
      await DB.addNote(rec);
      toast('تم حفظ ملاحظة الزيارة');
      closeModal(); renderPatientDetail(pid);
    } catch (ex) {
      const er = $('#nErr'); er.textContent = 'تعذّر حفظ الملاحظة — تحقق من الاتصال وحاول مجدداً'; er.classList.add('show');
      btn.disabled = false;
    }
  };
}

// حذف ملاحظة زيارة بعد التأكيد
async function delNote(id) {
  const ok = await confirmDlg('حذف الملاحظة', 'سيتم حذف ملاحظة الزيارة وقراءاتها — يمكن استعادتها من الأرشيف خلال 30 يوماً، بعدها تُمسح نهائياً.', 'حذف');
  if (!ok) return;
  try { await DB.deleteNote(id); toast('تم حذف الملاحظة'); }
  catch (e) { toast('تعذّر الحذف — تحقق من الاتصال', 'error'); }
  renderPatientDetail(State.param);
}

function metaItem(label, value) {
  return '<div class="meta-item"><small>' + label + '</small><b>' + value + '</b></div>';
}
function bmiText(b) {
  return b < 18.5 ? 'نحافة' : b < 25 ? 'طبيعي — ممتاز' : b < 30 ? 'زيادة وزن' : 'سمنة مفرطة';
}

// رسم منحنى المريض: الوزن + محيط الخصر + خط الوزن المستهدف
// (أو مقياس الألم لمرضى العلاج الطبيعي) — مع فلتر الفترة الزمنية
function drawPatientChart(p) {
  const cv = $('#patChart'); if (!cv || !window.Chart) return;
  const box = cv.parentElement;
  box.querySelectorAll('.chart-empty').forEach(el => el.remove());
  let ms = (p.measurements || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  // فلتر الفترة الزمنية المختارة: شهر / 3 شهور / الكل
  if (State.pRange !== 'all') {
    const cut = new Date(); cut.setMonth(cut.getMonth() - (State.pRange === '3m' ? 3 : 1));
    ms = ms.filter(m => m.date >= isoOf(cut));
  }
  // لا بيانات → رسالة واضحة بدل رسم محاور فارغة (لا crash)
  if (!ms.length) {
    cv.style.display = 'none';
    if (Charts.pat) { Charts.pat.destroy(); delete Charts.pat; }
    box.insertAdjacentHTML('beforeend', '<div class="chart-empty">' +
      emptyHTML('fa-chart-line', 'لسه مفيش بيانات', 'أضف أول قياس وسيظهر منحنى التطور هنا مباشرة') + '</div>');
    return;
  }
  cv.style.display = '';
  if (p.type === 'nutrition') {
    const labels = ms.map(m => humanDate(m.date));
    const hasWaist = ms.some(m => m.waist != null);
    const ds = [{ label: 'الوزن (كجم)', data: ms.map(m => m.weight ?? null), spanGaps: true,
      borderColor: '#0d9488', borderWidth: 3, tension: .4, fill: true, backgroundColor: 'rgba(13,148,136,.12)',
      pointRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: '#0d9488', pointBorderWidth: 2.5 }];
    // خط ثانٍ لمحيط الخصر على محور مستقل (بنفسجي)
    if (hasWaist) ds.push({ label: 'محيط الخصر (سم)', data: ms.map(m => m.waist ?? null), spanGaps: true,
      borderColor: '#7c3aed', borderWidth: 2.5, tension: .4, fill: false, yAxisID: 'y1',
      pointRadius: 4, pointStyle: 'rectRot', pointBackgroundColor: '#fff', pointBorderColor: '#7c3aed', pointBorderWidth: 2 });
    // خط أفقي متقطع للوزن المستهدف
    if (p.targetWeight) ds.push({ label: 'الوزن المستهدف', data: labels.map(() => p.targetWeight),
      borderColor: '#d97706', borderDash: [7, 6], borderWidth: 2, pointRadius: 0, fill: false });
    makeChart('pat', cv, { type: 'line',
      data: { labels: labels, datasets: ds },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { rtl: true, labels: { usePointStyle: true, boxWidth: 8, font: { weight: 700 } } }, tooltip: { rtl: true, textDirection: 'rtl' } },
        scales: { y: { position: 'right', grid: { color: '#edf3f2' } },
                  y1: { display: hasWaist, position: 'left', grid: { display: false } },
                  x: { grid: { display: false } } } } });
  } else {
    // مرضى العلاج الطبيعي: منحنى مقياس الألم
    makeChart('pat', cv, { type: 'line',
      data: { labels: ms.map(m => 'ج' + (m.session || '?')), datasets: [{ label: 'مقياس الألم', data: ms.map(m => m.pain),
        borderColor: '#e11d48', backgroundColor: 'rgba(225,29,72,.1)', borderWidth: 3, tension: .4, fill: true,
        pointRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: '#e11d48', pointBorderWidth: 2.5 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { rtl: true, textDirection: 'rtl' } },
        scales: { y: { min: 0, max: 10, grid: { color: '#edf3f2' } }, x: { grid: { display: false } } } } });
  }
}

// ---- نموذج إضافة قياس جديد (يختلف حسب التخصص) ----
function openMeasureModal(pid) {
  const p = getPatient(pid); if (!p) return;
  const isNut = p.type === 'nutrition';
  const nextSession = (p.measurements || []).length + 1;
  openModal(isNut ? 'قياس جديد — ' + esc(p.name) : 'تسجيل جلسة ' + nextSession + ' — ' + esc(p.name),
    '<form id="measureForm" class="form-grid">' +
      '<div class="field"><label>التاريخ</label><input class="input" id="m_date" type="date" value="' + todayISO() + '"></div>' +
      (isNut
        ? '<div class="field"><label>الوزن (كجم) *</label><input class="input ltr" id="m_weight" type="number" step="0.1" min="20" max="350" required placeholder="85.5"></div>' +
          '<div class="field"><label>محيط الخصر (سم)</label><input class="input ltr" id="m_waist" type="number" step="0.5" min="40" max="200" placeholder="95"></div>' +
          '<div class="field"><label>محيط الأرداف (سم)</label><input class="input ltr" id="m_hips" type="number" step="0.5" min="50" max="220" placeholder="110"></div>' +
          '<div class="field"><label>محيط الذراع (سم)</label><input class="input ltr" id="m_arm" type="number" step="0.5" min="20" max="120" placeholder="32"></div>' +
          '<div class="field"><label>نسبة الدهون %</label><input class="input ltr" id="m_fat" type="number" step="0.1" min="3" max="70" placeholder="32"></div>'
        : '<div class="field"><label>مقياس الألم (1 = بسيط، 10 = شديد) *</label><select class="input" id="m_pain">' +
          [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => '<option value="' + n + '">' + n + ' من 10</option>').join('') + '</select></div>') +
      '<div class="field full"><label>ملاحظة</label><input class="input" id="m_note" placeholder="' + (isNut ? 'مثال: التزام جيد بالخطة' : 'مثال: تحسّن مدى الحركة') + '"></div>' +
      '<div id="mErr" class="form-error full"></div>' +
      '<div class="modal-foot full"><button type="button" class="btn btn-ghost" data-close>إلغاء</button>' +
      '<button class="btn btn-primary"><i class="fa-solid fa-check"></i> حفظ القياس</button></div></form>');

  $('#measureForm').onsubmit = async e => {
    e.preventDefault();
    const m = { date: $('#m_date').value || todayISO(), note: $('#m_note').value.trim() };
    if (isNut) {
      const w = +$('#m_weight').value;
      // تحقق: الوزن رقم موجب منطقي
      if (!(w > 0 && w <= 350)) { const er = $('#mErr'); er.textContent = 'الوزن غير منطقي — اكتب رقماً موجباً بالكيلوجرام'; er.classList.add('show'); return; }
      m.weight = w;
      const wa = +$('#m_waist').value, hp = +$('#m_hips').value, ft = +$('#m_fat').value;
      if (wa > 0) m.waist = wa; if (hp > 0) m.hips = hp; if (ft > 0) m.fat = ft;
      const arm2 = +$('#m_arm').value; if (arm2 > 0) m.arm = arm2;
    } else { m.pain = +$('#m_pain').value; m.session = nextSession; }
    try {
      await DB.addRecord(p.id, m); // الحفظ في جدول patient_records
      toast('تم حفظ ' + (isNut ? 'القياس' : 'الجلسة') + ' بنجاح — المنحنى تحدّث فوراً');
      closeModal(); renderPatientDetail(p.id);
    } catch (ex) {
      const er = $('#mErr'); er.textContent = 'تعذّر حفظ القياس — تحقق من الاتصال وحاول مجدداً'; er.classList.add('show');
    }
  };
}

// حذف قياس من سجل المريض (من records sub-collection)
async function delMeasure(pid, mid) {
  const p = getPatient(pid); if (!p) return;
  const ok = await confirmDlg('حذف القياس', 'هل تريد حذف هذا القياس من سجل المريض؟', 'حذف');
  if (!ok) return;
  await DB.deleteRecord(pid, mid);
  toast('تم حذف القياس'); renderPatientDetail(pid);
}

