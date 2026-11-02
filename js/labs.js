'use strict';

// Common panels use independent components so partial reports retain their meaning.
const COMMON_LAB_TESTS = [
  { name: 'صورة دم كاملة (CBC)', components: [
    ['الهيموجلوبين Hb', 'g/dL'], ['الهيماتوكريت Hct', '%'], ['كريات الدم الحمراء RBC', '10^6/µL'],
    ['كريات الدم البيضاء WBC', '10^3/µL'], ['الصفائح الدموية Platelets', '10^3/µL'],
    ['متوسط حجم الكرية MCV', 'fL'], ['متوسط هيموجلوبين الكرية MCH', 'pg'],
    ['تركيز هيموجلوبين الكرية MCHC', 'g/dL'], ['تباين حجم الكريات RDW-CV', '%'],
    ['العدلات Neutrophils', '%'], ['الخلايا الليمفاوية Lymphocytes', '%'],
    ['الخلايا الوحيدة Monocytes', '%'], ['الحمضات Eosinophils', '%'], ['القعدات Basophils', '%']
  ] },
  { name: 'سكر صائم', components: [['الجلوكوز الصائم', 'mg/dL']] },
  { name: 'سكر عشوائي', components: [['الجلوكوز العشوائي', 'mg/dL']] },
  { name: 'سكر تراكمي HbA1c', components: [['HbA1c', '%']] },
  { name: 'دهون الدم (Lipid profile)', components: [
    ['الكوليسترول الكلي Total cholesterol', 'mg/dL'], ['LDL', 'mg/dL'], ['HDL', 'mg/dL'], ['الدهون الثلاثية Triglycerides', 'mg/dL']
  ] },
  { name: 'وظائف كبد (LFT)', components: [
    ['ALT', 'U/L'], ['AST', 'U/L'], ['ALP', 'U/L'], ['GGT', 'U/L'],
    ['البيليروبين الكلي Total bilirubin', 'mg/dL'], ['البيليروبين المباشر Direct bilirubin', 'mg/dL'],
    ['الألبومين Albumin', 'g/dL'], ['البروتين الكلي Total protein', 'g/dL']
  ] },
  { name: 'وظائف كلى (Renal profile)', components: [
    ['اليوريا Urea', 'mg/dL'], ['الكرياتينين Creatinine', 'mg/dL'], ['معدل الترشيح eGFR', 'mL/min/1.73m²'], ['حمض اليوريك Uric acid', 'mg/dL']
  ] },
  { name: 'فحوص الغدة الدرقية (Thyroid profile)', components: [
    ['TSH', 'µIU/mL'], ['Free T4', 'ng/dL'], ['Free T3', 'pg/mL']
  ] }
];

function labComponentRowHTML(component) {
  const c = component || {};
  const kind = c.kind === 'text' || typeof c.value === 'string' ? 'text' : 'number';
  const value = c.value == null ? '' : String(c.value);
  return '<div class="lab-result-row">' +
    '<div class="field"><label>اسم المؤشر / المكوّن</label><input class="input lab-component-name" maxlength="100" value="' + esc(c.name || '') + '" placeholder="اسم النتيجة"></div>' +
    '<div class="field"><label>نوع القيمة</label><select class="input lab-component-kind"><option value="number"' + (kind === 'number' ? ' selected' : '') + '>رقمية</option><option value="text"' + (kind === 'text' ? ' selected' : '') + '>نصية</option></select></div>' +
    '<div class="field"><label>القيمة</label><input class="input lab-component-value ltr" type="' + kind + '"' + (kind === 'number' ? ' step="any"' : '') + ' maxlength="500" value="' + esc(value) + '" placeholder="أدخل النتيجة"></div>' +
    '<div class="field"><label>الوحدة (اختياري)</label><input class="input lab-component-unit" maxlength="40" value="' + esc(c.unit || '') + '" placeholder="مثال: mg/dL"></div>' +
    '<button type="button" class="btn btn-ghost sm lab-remove-component" aria-label="إزالة هذا المؤشر">إزالة المؤشر</button>' +
  '</div>';
}

function wireLabComponentRows() {
  $$('#labComponents .lab-component-kind').forEach(select => {
    select.onchange = () => {
      const input = select.closest('.lab-result-row').querySelector('.lab-component-value');
      input.type = select.value === 'text' ? 'text' : 'number';
      if (input.type === 'number') input.step = 'any';
    };
  });
  $$('#labComponents .lab-remove-component').forEach(button => {
    button.onclick = () => button.closest('.lab-result-row').remove();
  });
}

function renderLabComponentRows(components) {
  $('#labComponents').innerHTML = components.map(labComponentRowHTML).join('');
  wireLabComponentRows();
}

function readLabFormResults(testName) {
  const rows = $$('#labComponents .lab-result-row');
  const results = [];
  for (const row of rows) {
    const raw = row.querySelector('.lab-component-value').value;
    if (String(raw ?? '').trim() === '') continue;
    const name = String(row.querySelector('.lab-component-name').value || '').trim() || testName;
    const kind = row.querySelector('.lab-component-kind').value;
    const unit = String(row.querySelector('.lab-component-unit').value || '').trim();
    const value = kind === 'number' ? Number(raw) : String(raw).trim();
    if (!name || name.length > 100 || unit.length > 40 ||
        (kind === 'number' && !Number.isFinite(value)) ||
        (kind === 'text' && (!value || value.length > 500))) throw { code: 'invalid_lab_results' };
    results.push({ name, value, ...(unit ? { unit } : {}) });
  }
  if (!results.length || results.length > 100) throw { code: 'invalid_lab_results' };
  return results;
}

function validLabFormDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date <= todayISO();
}

async function loadPatientLabs(p) {
  const tab = $('#patLabsTab'), panel = $('#ptab-labs');
  const enabled = normalizeClinicalFeatures((State.settings || {}).clinicalFeatures).labs;
  if (tab) tab.classList.toggle('hide', !enabled);
  if (!enabled) {
    if (panel) panel.classList.add('hide');
    if (tab && tab.classList.contains('active') && typeof switchPTab === 'function') switchPTab('measure');
    return; // keep persisted and cached rows; only hide the feature UI
  }
  if (!tab || !panel) return;
  try {
    const labs = await DB.loadLabs(p.id);
    if (State.route === 'patient' && State.param != null && State.param !== p.id) return;
    p.labs = labs;
    renderPatientLabs(p, labs);
  } catch (_) {
    // Do not log database errors that could contain clinical result details.
    $('#patLabsList').innerHTML = '<p class="form-error show" role="status">تعذّر تحميل سجل التحاليل. أعد فتح الملف أو تحقق من الاتصال.</p>';
  }
}

function renderPatientLabs(p, labs) {
  const list = $('#patLabsList');
  list.innerHTML = labs.length ? labs.map(lab =>
    '<article class="lab-record"><div class="lab-record-head"><div><b>' + esc(lab.testName) + '</b><small>' + esc(humanDate(lab.testedOn)) + '</small></div>' +
      '<span class="lab-record-actions"><button type="button" class="icon-btn sm" data-action="edit-lab" data-id="' + esc(p.id) + '" data-x="' + esc(lab.id) + '" aria-label="تصحيح سجل التحليل"><i class="fa-solid fa-pen"></i></button>' +
      '<button type="button" class="icon-btn sm danger" data-action="del-lab" data-id="' + esc(p.id) + '" data-x="' + esc(lab.id) + '" aria-label="حذف سجل التحليل"><i class="fa-solid fa-trash"></i></button></span></div>' +
      '<div class="lab-results">' + (Array.isArray(lab.results) ? lab.results : []).map(result =>
        '<div class="lab-result"><span>' + esc(result.name) + '</span><b>' + esc(result.value) + (result.unit ? ' <small>' + esc(result.unit) + '</small>' : '') + '</b></div>'
      ).join('') + '</div></article>'
  ).join('') : emptyHTML('fa-flask', 'لا توجد نتائج تحاليل بعد', 'أضف نتيجة من قائمة التحاليل الشائعة أو اكتب اسم تحليل مخصص.');
}

function openLabModal(pid, existing) {
  if (!normalizeClinicalFeatures((State.settings || {}).clinicalFeatures).labs) {
    toast('قسم التحاليل غير مفعّل لهذه العيادة', 'info'); return;
  }
  const p = getPatient(pid); if (!p) return;
  const edit = Boolean(existing);
  const initialTestName = existing ? existing.testName : '';
  const match = COMMON_LAB_TESTS.find(item => item.name === initialTestName) || null;
  let selectedTest = match;
  const initialComponents = existing
    ? existing.results.map(r => ({ name: r.name, value: r.value, unit: r.unit || '', kind: typeof r.value === 'string' ? 'text' : 'number' }))
    : (match ? match.components.map(([name, unit]) => ({ name, unit, kind: 'number' })) : [{ name: '', unit: '', kind: 'number' }]);

  const datalist = COMMON_LAB_TESTS.map(item => '<option value="' + esc(item.name) + '"></option>').join('');
  openModal(edit ? 'تصحيح نتيجة تحليل — ' + esc(p.name) : 'إضافة نتيجة تحليل — ' + esc(p.name),
    '<form id="labForm" class="form-grid">' +
      '<div class="field full"><label for="labTestName">اسم التحليل *</label><input class="input" id="labTestName" list="labCommonTests" maxlength="160" value="' + esc(initialTestName) + '" placeholder="ابحث أو اكتب اسم التحليل كاملًا" required autocomplete="off"><datalist id="labCommonTests">' + datalist + '</datalist><small class="muted">يمكنك الاختيار من القائمة أو كتابة اسم مخصص بالكامل دون اختيار اقتراح.</small></div>' +
      '<div class="field"><label for="labTestDate">تاريخ التحليل *</label><input class="input" id="labTestDate" type="date" max="' + todayISO() + '" value="' + esc(existing ? existing.testedOn : todayISO()) + '" required></div>' +
      '<div class="field full"><div class="lab-components-head"><b>مكونات النتيجة</b><button type="button" class="btn btn-ghost sm" id="labAddComponent"><i class="fa-solid fa-plus"></i> إضافة مكوّن</button></div><div id="labComponents"></div></div>' +
      '<div id="labError" class="form-error full" role="alert" aria-live="polite"></div>' +
      '<div class="modal-foot full"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary"><i class="fa-solid fa-check"></i> ' + (edit ? 'حفظ التصحيح' : 'حفظ النتيجة') + '</button></div>' +
    '</form>', 680);

  const container = $('#labComponents'), testInput = $('#labTestName');
  renderLabComponentRows(initialComponents);
  let lastInputName = initialTestName;
  testInput.oninput = () => {
    const typed = testInput.value.trim();
    const preset = COMMON_LAB_TESTS.find(item => item.name === typed) || null;
    if (preset && preset !== selectedTest) {
      selectedTest = preset; lastInputName = typed;
      renderLabComponentRows(preset.components.map(([name, unit]) => ({ name, unit, kind: 'number' })));
      return;
    }
    if (!preset && selectedTest && typed !== lastInputName) {
      selectedTest = null; lastInputName = typed;
      renderLabComponentRows([{ name: typed, unit: '', kind: 'number' }]);
      return;
    }
    if (!preset && !selectedTest) {
      const nameInput = container.querySelector('.lab-result-row .lab-component-name');
      if (nameInput && !nameInput.dataset.customized) nameInput.value = typed;
    }
  };
  testInput.onchange = testInput.oninput;
  $('#labAddComponent').onclick = () => {
    container.insertAdjacentHTML('beforeend', labComponentRowHTML({ name: '', unit: '', kind: 'number' }));
    wireLabComponentRows();
  };
  container.querySelectorAll('.lab-component-name').forEach(input => {
    input.addEventListener('input', () => { input.dataset.customized = 'true'; });
  });

  $('#labForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('.btn-primary'), error = $('#labError');
    button.disabled = true; error.textContent = ''; error.classList.remove('show');
    const testName = testInput.value.trim(), testedOn = $('#labTestDate').value;
    let results;
    try {
      if (!testName || testName.length > 160 || !validLabFormDate(testedOn)) throw { code: 'invalid_lab_test' };
      results = readLabFormResults(testName);
    } catch (_) {
      error.textContent = 'اكتب اسمًا وتاريخًا صالحين، وأدخل مكوّنًا واحدًا على الأقل بقيمة صالحة.';
      error.classList.add('show'); button.disabled = false; return;
    }
    try {
      const payload = { testName, testedOn, results };
      if (edit) await DB.updateLab(pid, existing.id, payload);
      else await DB.addLab(pid, payload);
      toast(edit ? 'تم تصحيح سجل التحليل' : 'تم حفظ نتيجة التحليل');
      closeModal(); renderPatientDetail(pid);
    } catch (_) {
      error.textContent = 'تعذّر حفظ نتيجة التحليل — تحقق من الاتصال وحاول مجددًا.';
      error.classList.add('show'); button.disabled = false;
    }
  };
}

async function deletePatientLab(pid, id) {
  if (!normalizeClinicalFeatures((State.settings || {}).clinicalFeatures).labs) return;
  const p = getPatient(pid), lab = p && (p.labs || []).find(item => item.id === id);
  if (!lab) { toast('سجل التحليل غير موجود', 'error'); return; }
  if (!await confirmDlg('حذف سجل التحليل', 'سيُخفى هذا السجل من ملف المريض ويمكن استعادته من الأرشيف.', 'حذف')) return;
  try { await DB.deleteLab(pid, id); toast('تم حذف سجل التحليل'); renderPatientDetail(pid); }
  catch (_) { toast('تعذّر حذف سجل التحليل — تحقق من الاتصال', 'error'); }
}
