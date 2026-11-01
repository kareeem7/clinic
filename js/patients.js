/**
 * ========================================
 * patients.js
 * الوظيفة: صفحة المرضى: العرض بالبطاقات/الجدول، البحث والفلترة والترقيم، ونموذج إضافة/تعديل مريض (يشمل موافقة واتساب والأمراض المزمنة).
 * الدوال/الكيانات الرئيسية: renderPatients، openPatientModal، waPatient
 * الاعتمادات: app.js, state.js, db.js, utils.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/patients.js — المرحلة 4: إدارة المرضى
   ============================================================ */
async function renderPatients() {
  // (بند 31) القائمة من السيرفر: بحث/فلترة/ترقيم هناك — كل صفحة (10 مرضى)
  // بصفوفها الكاملة + قياساتها الظاهرة فقط، بدل كل مرضى العيادة في الذاكرة
  const per = 10;
  let page;
  try {
    page = await DB.pagePatients({ q: State.pSearch, type: State.pFilter, page: State.pPage, per });
  } catch (e) {
    logError(e, 'patients.page');
    toast('تعذر تحميل قائمة المرضى — ' + explainError(e), 'error');
    return;
  }
  const totalPages = Math.max(1, Math.ceil(page.total / per));
  if (State.pPage > totalPages) { State.pPage = totalPages; return renderPatients(); }
  State.patients = page.rows; State.pTotal = page.total;
  // قياسات الصفحة الحالية فقط لعمود «آخر متابعة»
  try { await DB.loadRecordsFor(page.rows.map(p => p.id)); } catch (e) { logError(e, 'patients.records'); }
  const list = page.rows, pageItems = list;
  const from = page.total ? (State.pPage - 1) * per + 1 : 0;
  const to = Math.min(State.pPage * per, page.total);

  $('#patientsCount').textContent = page.total
    ? 'عرض ' + from + '–' + to + ' من ' + page.total + ' مريض (إجمالي النشطين: ' + activePatients().length + ')'
    : 'لا يوجد مرضى مطابقون لبحثك';

  // ملخص آخر متابعة + تاريخ آخر زيارة (وزن أو جلسة)
  const lastInfo = p => {
    const m = lastMeasure(p);
    if (!m) return '<span class="muted">لا قياسات بعد</span>';
    let core;
    if (p.type === 'nutrition') {
      const { diff } = weightChange(p);
      const arrow = diff < 0 ? '<span class="sub-ok"><i class="fa-solid fa-arrow-trend-down"></i> ' + Math.abs(diff) + ' كجم</span>' :
                    diff > 0 ? '<span style="color:var(--rose)"><i class="fa-solid fa-arrow-trend-up"></i> +' + diff + ' كجم</span>' : '<span class="muted">ثابت</span>';
      core = '<b>' + m.weight + ' كجم</b> ' + arrow;
    } else {
      core = '<b>جلسة ' + (m.session || '—') + '</b> <span class="muted">ألم ' + m.pain + '/10</span>';
    }
    // تاريخ آخر زيارة بشكل صريح كما في المواصفات
    return core + '<br><small class="muted"><i class="fa-solid fa-calendar"></i> آخر زيارة: ' + humanDate(m.date) + '</small>';
  };

  // جدول الديسكتوب (عناصر الصفحة الحالية فقط)
  $('#patientsTbody').innerHTML = pageItems.map(p =>
    '<tr><td><div class="cell-user"><div class="avatar" style="background:' + avatarColor(p.name) + '">' + esc(initials(p.name)) + '</div>' +
      '<div><b>' + esc(p.name) + '</b><small class="ltr">' + esc(p.phone) + '</small></div></div></td>' +
    '<td>' + typeChip(p.type) + '</td>' +
    '<td>' + esc(p.diagnosis || '—') + '</td>' +
    '<td>' + lastInfo(p) + '</td>' +
    '<td><div class="cell-actions">' +
      '<button class="icon-btn sm" data-action="view-patient" data-id="' + p.id + '" title="فتح الملف" aria-label="فتح الملف"><i class="fa-solid fa-eye"></i></button>' +
      '<button class="icon-btn sm wa" data-action="wa-patient" data-id="' + p.id + '" title="واتساب" aria-label="إرسال رسالة واتساب"><i class="fa-brands fa-whatsapp"></i></button>' +
      '<button class="icon-btn sm" data-action="edit-patient" data-id="' + p.id + '" title="تعديل" aria-label="تعديل بيانات المريض"><i class="fa-solid fa-pen"></i></button>' +
      '<button class="icon-btn sm danger" data-action="del-patient" data-id="' + p.id + '" title="حذف" aria-label="حذف المريض"><i class="fa-solid fa-trash"></i></button>' +
    '</div></td></tr>').join('') ||
    '<tr><td colspan="5">' + emptyHTML('fa-user-slash', 'لا يوجد مرضى مطابقون', 'جرّب تغيير البحث أو أضف مريضاً جديداً') + '</td></tr>';

  // بطاقات الموبايل (عناصر الصفحة الحالية فقط)
  $('#patientsCards').innerHTML = pageItems.map(p =>
    '<div class="p-card"><div class="p-card-top">' +
      '<div class="avatar" style="background:' + avatarColor(p.name) + '">' + esc(initials(p.name)) + '</div>' +
      '<div style="flex:1"><b>' + esc(p.name) + '</b><small class="ltr" style="display:block">' + esc(p.phone) + '</small></div>' +
      '<button class="icon-btn sm" data-action="view-patient" data-id="' + p.id + '" aria-label="فتح الملف"><i class="fa-solid fa-chevron-left"></i></button></div>' +
    '<div class="p-chips">' + typeChip(p.type) + chronicChips(p) + '<span class="chip chip-gray">' + (p.age || '—') + ' سنة</span>' +
      (p.targetWeight ? '<span class="chip chip-blue">هدف: ' + p.targetWeight + ' كجم</span>' : '') + '</div>' +
    '<div class="p-card-foot"><span class="grow">' + lastInfo(p) + '</span>' +
      '<button class="icon-btn sm wa" data-action="wa-patient" data-id="' + p.id + '" aria-label="إرسال رسالة واتساب"><i class="fa-brands fa-whatsapp"></i></button>' +
      '<button class="icon-btn sm" data-action="edit-patient" data-id="' + p.id + '" aria-label="تعديل بيانات المريض"><i class="fa-solid fa-pen"></i></button>' +
      '<button class="icon-btn sm danger" data-action="del-patient" data-id="' + p.id + '" aria-label="حذف المريض"><i class="fa-solid fa-trash"></i></button></div></div>'
  ).join('') || emptyHTML('fa-user-slash', 'لا يوجد مرضى مطابقون', 'أضف أول مريض من الزر بالأعلى');

  // أزرار ترقيم الصفحات (تظهر فقط عند تجاوز صفحة واحدة)
  const pagi = $('#patientsPagi');
  if (totalPages > 1) {
    pagi.innerHTML =
      '<button class="icon-btn" id="pgPrev"' + (State.pPage === 1 ? ' disabled' : '') + ' title="السابق" aria-label="الصفحة السابقة"><i class="fa-solid fa-chevron-right"></i></button>' +
      '<span role="status">صفحة ' + State.pPage + ' من ' + totalPages + '</span>' +
      '<button class="icon-btn" id="pgNext"' + (State.pPage === totalPages ? ' disabled' : '') + ' title="التالي" aria-label="الصفحة التالية"><i class="fa-solid fa-chevron-left"></i></button>';
    if ($('#pgPrev')) $('#pgPrev').onclick = () => { State.pPage--; renderPatients(); };
    if ($('#pgNext')) $('#pgNext').onclick = () => { State.pPage++; renderPatients(); };
  } else pagi.innerHTML = '';
}

function customChronicValue(chronic) {
  if (!Array.isArray(chronic)) return '';
  const item = chronic.find(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.customCondition === 'string');
  return item ? item.customCondition.trim().slice(0, 100) : '';
}

function hasBodyMeasurement(rows) {
  return Array.isArray(rows) && rows.some(m => m && ['weight', 'height', 'waist', 'hips', 'arm'].some(k => m[k] != null));
}

function optionalMeasure(selector, min, max) {
  const input = $(selector);
  if (!input || String(input.value ?? '').trim() === '') return null;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < min || value > max) throw { code: 'invalid_initial_measurement' };
  return value;
}

function patientBMI(weight, height) {
  if (!(weight >= 20 && weight <= 350 && height >= 80 && height <= 230)) return null;
  return +(weight / Math.pow(height / 100, 2)).toFixed(1);
}

function validMeasurementDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date <= todayISO();
}

// ---- نموذج إضافة / تعديل مريض ----
function openPatientModal(p) {
  const edit = Boolean(p); p = p || {};
  const chronic = Array.isArray(p.chronic) ? p.chronic : [];
  const customCondition = customChronicValue(chronic);
  const measurementsEnabled = normalizeClinicalFeatures((State.settings || {}).clinicalFeatures).measurements;
  const records = Array.isArray(p.measurements) ? p.measurements : [];
  const existingBodyMeasurement = edit && hasBodyMeasurement(records);
  const latestBody = existingBodyMeasurement
    ? records.filter(m => m && ['weight', 'height', 'waist', 'hips', 'arm'].some(k => m[k] != null)).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).at(-1)
    : null;

  const bodyFields = !measurementsEnabled ? '' :
    '<fieldset class="patient-measurements full" aria-describedby="patientMeasureHint">' +
      '<legend>قياسات البداية (اختياري)</legend>' +
      '<p id="patientMeasureHint" class="patient-measurements-hint">تُحفظ القياسات كسجل بتاريخ مستقل، ولا تستبدل القياسات السابقة.</p>' +
      '<div class="form-grid">' +
        '<div class="field"><label for="f_height">' + (existingBodyMeasurement ? 'الطول المسجل (سم)' : 'الطول (سم)') + '</label><input class="input ltr" id="f_height" type="number" min="80" max="230" step="0.1"' + (existingBodyMeasurement ? ' disabled' : '') + ' value="' + (p.height ?? (latestBody && latestBody.height) ?? '') + '" placeholder="170"></div>' +
        (existingBodyMeasurement
          ? '<div class="field"><label for="f_weight">آخر وزن مسجل</label><input class="input ltr" id="f_weight" type="number" disabled value="' + (latestBody.weight ?? '') + '"><small class="muted">لإضافة قياس جديد استخدم «إضافة قياس» من ملف المريض.</small></div>'
          : '<div class="field"><label for="f_weight">الوزن (كجم)</label><input class="input ltr" id="f_weight" type="number" min="20" max="350" step="0.1" placeholder="85.5"></div>' +
            '<div class="field"><label for="f_waist">محيط الخصر (سم)</label><input class="input ltr" id="f_waist" type="number" min="40" max="200" step="0.5" placeholder="95"></div>' +
            '<div class="field"><label for="f_hips">محيط الأرداف (سم)</label><input class="input ltr" id="f_hips" type="number" min="50" max="220" step="0.5" placeholder="110"></div>' +
            '<div class="field"><label for="f_arm">محيط الذراع (سم)</label><input class="input ltr" id="f_arm" type="number" min="20" max="120" step="0.5" placeholder="32"></div>') +
        '<div class="field full"><label for="f_bmi">مؤشر كتلة الجسم</label><output id="f_bmi" class="bmi-preview" aria-live="polite">سيظهر عند إدخال وزن وطول صالحين</output></div>' +
        (existingBodyMeasurement ? '<p class="patient-measurements-hint full">القياسات المسجلة محفوظة في سجل المريض. تعديل هذا النموذج لا يحذفها.</p>' :
          '<div class="field"><label for="f_measure_date">تاريخ قياس البداية</label><input class="input" id="f_measure_date" type="date" max="' + todayISO() + '" value="' + todayISO() + '"></div>') +
      '</div>' +
    '</fieldset>';

  openModal(edit ? 'تعديل بيانات المريض' : 'إضافة مريض جديد',
    '<form id="patientForm" class="form-grid">' +
      '<div class="field full"><label for="f_name">اسم المريض *</label><input class="input" id="f_name" required value="' + esc(p.name || '') + '" placeholder="الاسم ثلاثي"></div>' +
      '<div class="field"><label for="f_phone">رقم الموبايل (واتساب) *</label><input class="input ltr" id="f_phone" required inputmode="tel" value="' + esc(p.phone || '') + '" placeholder="01xxxxxxxxx"></div>' +
      '<div class="field"><label for="f_age">السن</label><input class="input ltr" id="f_age" type="number" min="1" max="120" value="' + (p.age || '') + '"></div>' +
      '<div class="field"><label for="f_gender">النوع</label><select class="input" id="f_gender">' +
        '<option ' + (p.gender === 'ذكر' ? 'selected' : '') + '>ذكر</option><option ' + (p.gender === 'أنثى' ? 'selected' : '') + '>أنثى</option></select></div>' +
      '<div class="field"><label for="f_type">التخصص</label><select class="input" id="f_type">' +
        '<option value="pt" ' + (p.type === 'pt' ? 'selected' : '') + '>علاج طبيعي</option>' +
        '<option value="nutrition" ' + (p.type === 'nutrition' ? 'selected' : '') + '>سمنة ونحافة</option></select></div>' +
      bodyFields +
      '<div class="field"><label for="f_target">الوزن المستهدف (كجم)</label><input class="input ltr" id="f_target" type="number" step="0.1" min="20" max="250" value="' + (p.targetWeight || '') + '"></div>' +
      '<div class="field"><label for="f_birth">تاريخ الميلاد</label><input class="input" type="date" id="f_birth" value="' + esc(p.birthDate || '') + '">' +
        '<small class="muted" style="font-size:11.5px;font-weight:700">ضروري لدخول المريض على بوابته — المحفظة من تليفونه</small></div>' +
      '<div class="field full"><label for="f_diag">التشخيص / الهدف</label><input class="input" id="f_diag" value="' + esc(p.diagnosis || '') + '" placeholder="مثال: آلام أسفل الظهر — أو: نزول 15 كجم"></div>' +
      '<div class="field full"><label>أمراض أو حالات صحية (اختر ما ينطبق)</label><div class="chk-grid">' +
        Object.keys(CHRONIC).map(k =>
          '<label class="chk' + (chronic.includes(k) ? ' on' : '') + '">' +
          '<input type="checkbox" value="' + k + '" data-chronic' + (chronic.includes(k) ? ' checked' : '') + '>' +
          '<i class="fa-solid ' + CHRONIC[k].icon + '" aria-hidden="true"></i> ' + CHRONIC[k].label + '</label>').join('') +
      '</div>' +
      '<div class="chronic-custom"><label for="f_chronic_other"><input type="checkbox" id="f_chronic_other"' + (customCondition ? ' checked' : '') + '> حالة أخرى غير موجودة في القائمة</label>' +
      '<div class="field" style="margin-top:9px"><label for="f_chronic_other_name">اسم الحالة</label><input class="input" id="f_chronic_other_name" maxlength="100" value="' + esc(customCondition) + '" placeholder="اكتب اسم المرض أو الحالة"></div></div></div>' +
      '<div class="field full"><label for="f_consent" style="display:flex;align-items:center;gap:9px;cursor:pointer;font-weight:700">' +
        '<input type="checkbox" id="f_consent"' + (p.consentWa ? ' checked' : '') + ' style="width:17px;height:17px">' +
        '<i class="fa-brands fa-whatsapp" style="color:#128c4b" aria-hidden="true"></i> المريض وافق على استقبال رسائل واتساب (متابعة وتذكير مواعيد)</label>' +
        '<small class="muted" style="font-size:11.5px;font-weight:700">موافقة موثقة في الملف — بدونها كل رسائل واتساب اللي فيها بيانات المريض بتتقفل تلقائياً</small></div>' +
      '<div class="field full"><label for="f_notes">ملاحظات</label><textarea class="input" id="f_notes" placeholder="أي ملاحظات طبية أو شخصية...">' + esc(p.notes || '') + '</textarea></div>' +
      '<div id="patientFormError" class="form-error full" role="alert" aria-live="polite"></div>' +
      '<div class="modal-foot full"><button type="button" class="btn btn-ghost" data-close>إلغاء</button>' +
      '<button class="btn btn-primary"><i class="fa-solid fa-check"></i> ' + (edit ? 'حفظ التعديلات' : 'إضافة المريض') + '</button></div>' +
    '</form>', 620);

  if (measurementsEnabled && !existingBodyMeasurement) {
    const updateBMI = () => {
      const weight = Number($('#f_weight').value), height = Number($('#f_height').value);
      const value = patientBMI(weight, height);
      $('#f_bmi').textContent = value == null ? 'سيظهر عند إدخال وزن وطول صالحين' : value + ' — قيمة محسوبة تلقائيًا';
    };
    ['#f_weight', '#f_height'].forEach(selector => {
      $(selector).addEventListener('input', updateBMI);
      $(selector).addEventListener('change', updateBMI);
    });
    updateBMI();
  } else if (measurementsEnabled && existingBodyMeasurement) {
    const value = patientBMI(latestBody.weight, Number($('#f_height').value));
    $('#f_bmi').textContent = value == null ? 'أدخل طولًا صالحًا لحساب BMI' : value + ' — قيمة محسوبة تلقائيًا';
  }

  $('#patientForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('.btn-primary');
    const formError = $('#patientFormError');
    formError.textContent = ''; formError.classList.remove('show');
    btn.disabled = true;
    const data = {
      name: $('#f_name').value.trim(), phone: $('#f_phone').value.trim(),
      age: +$('#f_age').value || null, gender: $('#f_gender').value, type: $('#f_type').value,
      targetWeight: +$('#f_target').value || null, birthDate: $('#f_birth').value || null,
      consentWa: $('#f_consent').checked,
      diagnosis: $('#f_diag').value.trim(), notes: $('#f_notes').value.trim()
    };
    const otherChecked = $('#f_chronic_other').checked;
    const otherName = $('#f_chronic_other_name').value.trim();
    if (otherChecked && (!otherName || otherName.length > 100)) {
      formError.textContent = 'اكتب اسم الحالة الأخرى بحد أقصى 100 حرف، أو ألغِ تحديد الخيار.';
      formError.classList.add('show'); btn.disabled = false; return;
    }
    const selected = $$('[data-chronic]:checked').map(c => c.value);
    data.chronic = selected.concat(otherChecked ? [{ customCondition: otherName }] : []);

    let baseline = null;
    try {
      if (measurementsEnabled && !existingBodyMeasurement) {
        const height = optionalMeasure('#f_height', 80, 230);
        data.height = height;
        const weight = optionalMeasure('#f_weight', 20, 350);
        const waist = optionalMeasure('#f_waist', 40, 200);
        const hips = optionalMeasure('#f_hips', 50, 220);
        const arm = optionalMeasure('#f_arm', 20, 120);
        const computedBMI = patientBMI(weight, height);
        const hasAny = [height, weight, waist, hips, arm].some(v => v != null);
        const usefulForExistingPatient = [weight, waist, hips, arm].some(v => v != null);
        const measurementDate = $('#f_measure_date').value || todayISO();
        if (hasAny && (!edit || usefulForExistingPatient)) {
          if (!validMeasurementDate(measurementDate)) throw { code: 'invalid_initial_measurement_date' };
          baseline = {
            date: measurementDate, height, weight, waist, hips, arm,
            bmi: computedBMI, recordType: 'manual', note: edit ? 'قياسات بداية أُضيفت من نموذج المريض' : 'قياسات البداية'
          };
        }
      }
    } catch (err) {
      formError.textContent = 'راجع قياسات البداية: أدخل أرقامًا ضمن الحدود الموضحة.';
      formError.classList.add('show'); btn.disabled = false; return;
    }

    try {
      if (edit) {
        await DB.update('patients', p.id, data);
        if (baseline) await DB.addRecord(p.id, baseline);
        toast('تم حفظ تعديلات ' + data.name);
      } else {
        data.status = 'active'; data.planId = null; data.createdAt = todayISO();
        data.measurements = baseline ? [baseline] : [];
        await DB.add('patients', data);
        toast('تمت إضافة المريض ' + data.name + ' بنجاح');
      }
      closeModal(); refreshCurrent();
    } catch (err) {
      toast('حدث خطأ أثناء الحفظ — تحقق من الاتصال وحاول مجدداً', 'error');
      btn.disabled = false;
    }
  };
}

// حذف مريض مع تأكيد
async function deletePatient(id) {
  const p = getPatient(id); if (!p) return;
  const ok = await confirmDlg('حذف المريض', 'سيُحذف ملف «' + esc(p.name) + '» مع قياساته ومواعيده وينتقل للأرشيف — يمكن استعادته خلال 30 يوماً، بعدها يُمسح نهائياً بمهمة التنظيف التلقائية.', 'حذف');
  if (!ok) return;
  // حذف مواعيد المريض المرتبطة أيضاً (قياساته تُحذف تلقائياً عبر cascade في قاعدة البيانات)
  try {
    // (بند 31) من السيرفر مباشرة — النافذة المحمّلة (±730 يوم) قد لا تشمل مواعيد أقدم
    for (const a of await DB.appointmentsOf(id)) await DB.remove('appointments', a.id);
    await DB.remove('patients', id);
    toast('تم حذف المريض');
  } catch (e) { toast('تعذّر حذف المريض — تحقق من الاتصال وحاول مجدداً', 'error'); }
  if (State.route === 'patient') go('patients'); else refreshCurrent();
}

// رسالة متابعة سريعة للمريض — بنبرة الدكتور (مثلاً: طمنّي عليك / متابعتك الأسبوعية)
async function waPatient(id) {
  const p = getPatient(id); if (!p) return;
  // (بند 31) لو الصف من الفهرس الخفيف، نجيب قياساته الأول عشان سطر التحفيز بالوزن
  if (p.type === 'nutrition' && !p._recordsLoaded) {
    try { await DB.loadRecords(p.id); } catch (e) { logError(e, 'wa.records'); }
  }
  const first = p.name.split(' ')[0];
  // لو مريض سمنة وله قياس حديث، نحط آخر رقم وزنه للحفز (بدون دخول تشخيص أو أدوية)
  const hc = p.type === 'nutrition' ? weightChange(p) : null;
  const diffLine = hc && hc.diff < 0
    ? 'آخر وزن سجلناه عندك كان ' + hc.current + ' كجم — وقد نقصت ' + Math.abs(hc.diff) + ' كجم من البداية. كمّل!'
    : '';
  const body = buildStyledMessage('followup', { first: first }, diffLine ? '\n' + diffLine : '');
  openComposeWA(p.phone, body, { pid: id, type: 'weekly_followup' });
}
