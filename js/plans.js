/**
 * ========================================
 * plans.js
 * الوظيفة: مكتبة خطط التغذية: بطاقات الخطط مع شارات الموانع، نافذة العرض التفصيلي، محرر الخطة والوجبات، الحذف، ونافذة الربط بمريض من الاتجاهين.
 * الدوال/الكيانات الرئيسية: renderPlans، openPlanModal، openPlanView، openAssignModal، waPlan
 * الاعتمادات: app.js, state.js, db.js, utils.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/plans.js — المرحلة 7: مكتبة خطط التغذية + الربط بالمرضى
   ============================================================ */
function renderPlans() {
  const grid = $('#plansGrid');
  // (بند 13) تنويه ثابت: الخطط قوالب استرشادية مش وصفات جاهزة لكل مريض
  const banner = '<div class="tip-card" style="margin-bottom:12px"><i class="fa-solid fa-triangle-exclamation"></i><p style="font-size:12.5px"><b>خطط استرشادية:</b> راجع موانع الاستعمال وحالة كل مريض (أدوية، كلى، قلب، حمل) قبل الصرف — وعدّل الخطة لكل حالة.</p></div>';
  grid.innerHTML = banner + State.plans.map(pl => {
    const usedBy = rosterArr().filter(p => p.planId === pl.id && p.status === 'active'); // (بند 31) من الفهرس
    return '<div class="plan-card">' +
      '<div class="plan-top"><div><h4><button class="link" data-action="view-plan" data-id="' + pl.id + '" style="font-size:16px">' + esc(pl.title) + '</button></h4>' +
        '<p class="desc">' + esc(pl.desc || '') + '</p></div>' +
        '<span class="chip chip-amber plan-kcal"><i class="fa-solid fa-fire"></i>' + pl.calories + ' سعر</span></div>' +
      '<div class="p-chips">' +
        '<span class="chip chip-teal"><i class="fa-solid fa-utensils"></i> ' + pl.meals.length + ' وجبة</span>' +
        (pl.duration ? '<span class="chip chip-blue"><i class="fa-solid fa-hourglass-half"></i> ' + esc(pl.duration) + '</span>' : '') +
        (pl.contraindications ? '<span class="chip chip-rose" title="' + esc(pl.contraindications) + '"><i class="fa-solid fa-triangle-exclamation"></i> لها موانع</span>' : '') +
      '</div>' +
      '<ul class="plan-meals">' +
        pl.meals.slice(0, 3).map(m => '<li><i class="fa-solid fa-circle-check"></i><span><b>' + esc(m.name) + ':</b> ' + esc(m.desc) + '</span></li>').join('') +
        (pl.meals.length > 3 ? '<li><i class="fa-solid fa-ellipsis"></i><span class="muted">+' + (pl.meals.length - 3) + ' وجبة أخرى</span></li>' : '') +
      '</ul>' +
      '<div class="plan-foot">' +
        '<span class="used"><i class="fa-solid fa-user-check"></i> ' + (usedBy.length ? 'مربوطة بـ ' + usedBy.length + ' مريض' : 'غير مربوطة') + '</span>' +
        '<button class="icon-btn sm" data-action="view-plan" data-id="' + pl.id + '" title="عرض التفاصيل"><i class="fa-solid fa-eye"></i></button>' +
        '<button class="icon-btn sm" data-action="assign-plan-top" data-id="' + pl.id + '" title="ربط بمريض"><i class="fa-solid fa-link"></i></button>' +
        '<button class="icon-btn sm" data-action="edit-plan" data-id="' + pl.id + '" title="تعديل" aria-label="تعديل الخطة"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="icon-btn sm danger" data-action="del-plan" data-id="' + pl.id + '" title="حذف" aria-label="حذف الخطة"><i class="fa-solid fa-trash"></i></button>' +
      '</div></div>';
  }).join('') || emptyHTML('fa-utensils', 'لا توجد خطط بعد', 'أنشئ أول خطة تغذية من الزر بالأعلى');
}

// نموذج إضافة/تعديل خطة — مع محرر وجبات ديناميكي
function openPlanModal(pl) {
  const edit = Boolean(pl); pl = pl || { meals: [{ name: '', desc: '' }] };
  const mealRow = (m = { name: '', desc: '', alt: '' }) =>
    '<div class="meal-row"><input class="input" placeholder="الوجبة (فطار)" value="' + esc(m.name) + '" data-mn>' +
    '<input class="input" placeholder="المكونات / الوصف" value="' + esc(m.desc) + '" data-md>' +
    '<input class="input" placeholder="البدائل المتاحة (اختياري)" value="' + esc(m.alt || '') + '" data-ma>' +
    '<button type="button" class="icon-btn sm danger" data-rm title="حذف الوجبة"><i class="fa-solid fa-trash"></i></button></div>';

  openModal(edit ? 'تعديل الخطة الغذائية' : 'خطة تغذية جديدة',
    '<form id="planForm" class="form-grid">' +
      '<div class="field"><label>اسم الخطة *</label><input class="input" id="pl_title" required value="' + esc(pl.title || '') + '" placeholder="نظام 1500 سعر"></div>' +
      '<div class="field"><label>السعرات اليومية</label><input class="input ltr" id="pl_kcal" type="number" min="600" max="4000" value="' + (pl.calories || 1500) + '"></div>' +
      '<div class="field full"><label>وصف قصير</label><input class="input" id="pl_desc" value="' + esc(pl.desc || '') + '" placeholder="لمن تناسب هذه الخطة؟"></div>' +
      '<div class="field"><label>المدة المقترحة</label><input class="input" id="pl_dur" value="' + esc(pl.duration || '') + '" placeholder="مثال: 6 أسابيع"></div>' +
      '<div class="field"><label>ملاحظات عامة عن الخطة</label><input class="input" id="pl_notes" value="' + esc(pl.notes || '') + '" placeholder="تعليمات هامة تظهر للدكتور والمريض"></div>' +
      '<div class="field full"><label>موانع الاستعمال والتحذيرات</label><textarea class="input" id="pl_contra" rows="2" placeholder="مثال: ممنوعة لمرضى الكلى / الحوامل / مرضى السكر على أنسولين...">' + esc(pl.contraindications || '') + '</textarea>' +
        '<small class="muted">تظهر للدكتور عند العرض، وتُضمَّن تلقائياً في رسالة الخطة على واتساب</small></div>' +
      '<div class="field full"><label>الوجبات</label><div id="mealsWrap">' + pl.meals.map(mealRow).join('') + '</div>' +
        '<button type="button" class="btn btn-ghost sm" id="addMealBtn"><i class="fa-solid fa-plus"></i> إضافة وجبة</button></div>' +
      '<div class="modal-foot full"><button type="button" class="btn btn-ghost" data-close>إلغاء</button>' +
      '<button class="btn btn-primary"><i class="fa-solid fa-check"></i> ' + (edit ? 'حفظ' : 'إنشاء الخطة') + '</button></div></form>', 640);

  $('#addMealBtn').onclick = () => $('#mealsWrap').insertAdjacentHTML('beforeend', mealRow());
  $('#mealsWrap').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm && $$('#mealsWrap .meal-row').length > 1) rm.closest('.meal-row').remove();
  });

  $('#planForm').onsubmit = async e => {
    e.preventDefault();
    const meals = $$('#mealsWrap .meal-row').map(r => ({ name: r.querySelector('[data-mn]').value.trim(), desc: r.querySelector('[data-md]').value.trim(), alt: r.querySelector('[data-ma]').value.trim() }))
      .filter(m => m.name || m.desc);
    const data = { title: $('#pl_title').value.trim(), calories: +$('#pl_kcal').value || 1500, desc: $('#pl_desc').value.trim(),
      duration: $('#pl_dur').value.trim(), notes: $('#pl_notes').value.trim(),
      contraindications: $('#pl_contra').value.trim(), meals };
    if (edit) { await DB.update('plans', pl.id, data); toast('تم حفظ الخطة'); }
    else { await DB.add('plans', data); toast('تم إنشاء الخطة «' + data.title + '»'); }
    closeModal(); refreshCurrent();
  };
}

// حذف خطة وفك ارتباطها من المرضى
async function deletePlan(id) {
  const pl = getPlan(id); if (!pl) return;
  const ok = await confirmDlg('حذف الخطة', 'سيتم حذف «' + esc(pl.title) + '» وفك ارتباطها من ' + rosterArr().filter(p => p.planId === id).length + ' مريض.', 'حذف');
  if (!ok) return;
  try {
    for (const p of rosterArr().filter(x => x.planId === id)) await DB.update('patients', p.id, { planId: null }); // (بند 31)
    await DB.remove('plans', id);
    toast('تم حذف الخطة');
  } catch (e) { toast('تعذّر حذف الخطة — تحقق من الاتصال وحاول مجدداً', 'error'); }
  refreshCurrent();
}

// نافذة تفاصيل خطة تغذية: جدول الوجبات + البدائل + الملاحظات العامة
function openPlanView(id) {
  const pl = getPlan(id); if (!pl) return;
  const usedBy = activePatients().filter(p => p.planId === id);
  openModal(esc(pl.title),
    '<div class="p-chips" style="margin-bottom:10px">' +
      '<span class="chip chip-amber"><i class="fa-solid fa-fire"></i> ' + pl.calories + ' سعر / يوم</span>' +
      (pl.duration ? '<span class="chip chip-blue"><i class="fa-solid fa-hourglass-half"></i> ' + esc(pl.duration) + '</span>' : '') +
      '<span class="chip chip-teal"><i class="fa-solid fa-utensils"></i> ' + pl.meals.length + ' وجبة</span>' +
      (usedBy.length ? '<span class="chip chip-green"><i class="fa-solid fa-user-check"></i> مربوطة بـ ' + usedBy.length + ' مريض</span>' : '') +
    '</div>' +
    (pl.desc ? '<p class="muted" style="font-weight:600;margin-bottom:12px">' + esc(pl.desc) + '</p>' : '') +
    // جدول الوجبات مع البدائل المتاحة
    '<div style="overflow-x:auto;border:1px solid var(--line);border-radius:14px"><table style="min-width:480px;border-collapse:collapse">' +
      '<thead><tr><th>الوجبة</th><th>المكونات</th><th>البدائل المتاحة</th></tr></thead><tbody>' +
      pl.meals.map(m => '<tr><td style="white-space:nowrap"><b>' + esc(m.name) + '</b></td><td>' + esc(m.desc) + '</td>' +
        '<td>' + (m.alt ? esc(m.alt) : '<span class="muted">—</span>') + '</td></tr>').join('') +
    '</tbody></table></div>' +
    (pl.notes ? '<div class="tip-card" style="margin-top:12px"><i class="fa-solid fa-circle-info"></i><p><b>ملاحظات عامة:</b> ' + esc(pl.notes) + '</p></div>' : '') +
    (pl.contraindications ? '<div class="tip-card" style="margin-top:8px;background:var(--rose-soft)"><i class="fa-solid fa-triangle-exclamation" style="color:var(--rose)"></i><p style="color:#9f1239"><b>موانع الاستعمال:</b> ' + esc(pl.contraindications) + '</p></div>' : '') +
    '<div class="modal-foot"><button class="btn btn-ghost" data-close>إغلاق</button>' +
    '<button class="btn btn-primary" id="pvAssign"><i class="fa-solid fa-link"></i> ربط بمريض</button></div>', 640);
  $('#pvAssign').onclick = () => { closeModal(); openAssignModal(id); };
}

// نافذة ربط خطة بمريض — تعمل من الاتجاهين (من الخطة أو من المريض)
function openAssignModal(arg) {
  // arg قد يكون معرّف مريض أو معرّف خطة حسب المصدر
  const planFirst = getPlan(arg) ? 'plan' : 'patient';
  const pl = planFirst === 'plan' ? getPlan(arg) : null;
  const pt = planFirst === 'patient' ? getPatient(arg) : null;
  const pts = activePatients().filter(p => p.type === 'nutrition');
  const plans = State.plans;
  if (!pt && !pts.length) return toast('لا يوجد مرضى سمنة نشطين لربطهم بالخطة', 'error');
  if (!plans.length) return toast('أنشئ خطة غذائية أولاً', 'error');
  openModal('ربط خطة غذائية',
    '<form id="assignForm" class="form-grid">' +
      '<div class="field full"><label>المريض</label><select class="input" id="as_patient">' +
        (pt ? '<option value="' + pt.id + '" selected>' + esc(pt.name) + '</option>'
            : pts.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('')) + '</select></div>' +
      '<div class="field full"><label>الخطة الغذائية</label><select class="input" id="as_plan">' +
        plans.map(x => '<option value="' + x.id + '"' + ((pl && pl.id === x.id) || (pt && pt.planId === x.id) ? ' selected' : '') + '>' + esc(x.title) + ' — ' + x.calories + ' سعر</option>').join('') +
        '</select></div>' +
      // تحديد فترة الربط: تاريخ بدء وانتهاء (افتراضياً شهر)
      '<div class="field"><label>تاريخ البدء</label><input class="input" type="date" id="as_start" value="' + todayISO() + '"></div>' +
      '<div class="field"><label>تاريخ الانتهاء</label><input class="input" type="date" id="as_end" value="' + addDaysISO(todayISO(), 30) + '"></div>' +
      '<div class="modal-foot full"><button type="button" class="btn btn-ghost" data-close>إلغاء</button>' +
      '<button class="btn btn-primary"><i class="fa-solid fa-link"></i> ربط الخطة</button></div></form>', 480);

  $('#assignForm').onsubmit = async e => {
    e.preventDefault();
    const pid = $('#as_patient').value, planId = $('#as_plan').value;
    // حفظ الربط مع فترة سريانه (patient_plans)
    try {
      await DB.update('patients', pid, { planId, planStart: $('#as_start').value, planEnd: $('#as_end').value });
      toast('تم ربط الخطة بالمريض ' + getPatient(pid).name.split(' ')[0] + ' من ' + humanDate($('#as_start').value));
      closeModal();
    } catch (e) { toast('تعذّر ربط الخطة — تحقق من الاتصال وحاول مجدداً', 'error'); }
    refreshCurrent();
  };
}

// إرسال الخطة الغذائية كاملة عبر واتساب (مع ستايل الدكتور: توقيع + إيموجي)
function waPlan(pid) {
  const p = getPatient(pid), pl = getPlan(p?.planId); const s = State.settings;
  if (!p || !pl) return;
  // (بند 13) الرسالة ضمّت ملاحظات الخطة وموانعها، ونصيحة الماء بقت بإحالة
  // للدكتور بدل كمية عامة (2-3 لتر) ممكن تضر مرضى قلب/كلى على تقييد سوائل
  const body = '🥗 خطتك الغذائية من ' + (s.clinicName || 'العيادة') + '\n' +
    '— ' + pl.title + ' (' + pl.calories + ' سعر/يوم) —\n\n' +
    pl.meals.map(m => '• ' + m.name + ':\n  ' + m.desc).join('\n\n') +
    (pl.notes ? '\n\n📌 تعليمات الخطة: ' + pl.notes : '') +
    (pl.contraindications ? '\n\n⚠️ انتبه: ' + pl.contraindications : '') +
    '\n\n💧 اشرب الماء حسب إرشادات دكتورك. بالهناء والشفاء!';
  openComposeWA(p.phone, styleWrap(body), { pid, type: 'full_plan' });
}

