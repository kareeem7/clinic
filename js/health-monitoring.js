'use strict';

const HEALTH_READING_TYPES = Object.freeze({
  fasting: 'صائم', post_meal: 'بعد الأكل', random: 'عشوائي'
});

function healthTimestampLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'تاريخ غير صالح';
  return date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function healthReadingMarkup(patient, reading) {
  const glucose = reading.readingType === 'glucose';
  const metrics = glucose
    ? '<span class="health-reading-value"><b>قيمة السكر</b><strong>' + esc(reading.glucoseValue) + '</strong></span>' +
      '<span class="health-reading-value"><b>نوع القراءة</b><strong>' + esc(HEALTH_READING_TYPES[reading.glucoseType] || reading.glucoseType) + '</strong></span>'
    : '<span class="health-reading-value"><b>الانقباضي</b><strong>' + esc(reading.systolic) + ' <small>mmHg</small></strong></span>' +
      '<span class="health-reading-value"><b>الانبساطي</b><strong>' + esc(reading.diastolic) + ' <small>mmHg</small></strong></span>' +
      (reading.pulse == null ? '' : '<span class="health-reading-value"><b>النبض</b><strong>' + esc(reading.pulse) + ' <small>نبضة/دقيقة</small></strong></span>');
  return '<article class="health-reading-record"><div class="health-reading-head"><div><b>' + (glucose ? 'قراءة سكر' : 'قراءة ضغط') + '</b><small>' + esc(healthTimestampLabel(reading.recordedAt)) + '</small></div>' +
    '<span class="chip ' + (reading.source === 'patient' ? 'chip-blue' : 'chip-gray') + '">' + (reading.source === 'patient' ? 'من بوابة المريض' : 'من العيادة') + '</span>' +
    '<button type="button" class="icon-btn sm" data-action="edit-health-reading" data-id="' + esc(patient.id) + '" data-x="' + esc(reading.id) + '" aria-label="تصحيح القراءة"><i class="fa-solid fa-pen"></i></button>' +
    '</div><div class="health-reading-metrics">' + metrics + '</div></article>';
}

function destroyHealthCharts() {
  ['healthGlucose', 'healthPressure'].forEach(key => {
    if (Charts[key]) { Charts[key].destroy(); delete Charts[key]; }
  });
}

function drawHealthReadingCharts(readings, glucoseEnabled, pressureEnabled) {
  destroyHealthCharts();
  const chart = (canvasId, rows, datasets) => {
    const canvas = $('#' + canvasId);
    if (!canvas) return;
    const box = canvas.parentElement;
    if (!window.Chart || !rows.length) { if (box) box.classList.add('hide'); return; }
    if (box) box.classList.remove('hide');
    const ordered = rows.slice().sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
    Charts[canvasId === 'healthGlucoseChart' ? 'healthGlucose' : 'healthPressure'] = new window.Chart(canvas, {
      type: 'line',
      data: {
        labels: ordered.map(r => {
          const date = new Date(r.recordedAt);
          return Number.isFinite(date.getTime()) ? date.toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
        }),
        datasets: datasets(ordered)
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { rtl: true, labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { rtl: true, textDirection: 'rtl' } },
        scales: { y: { beginAtZero: false } }
      }
    });
  };
  if (glucoseEnabled) chart('healthGlucoseChart', readings.filter(r => r.readingType === 'glucose'), rows => [{
    label: 'قيمة السكر', data: rows.map(r => r.glucoseValue), borderColor: '#0d9488', backgroundColor: 'rgba(13,148,136,.12)',
    borderWidth: 2.5, tension: .25, pointRadius: 4, spanGaps: true
  }]);
  if (pressureEnabled) chart('healthPressureChart', readings.filter(r => r.readingType === 'blood_pressure'), rows => [
    { label: 'الانقباضي', data: rows.map(r => r.systolic), borderColor: '#2563eb', borderWidth: 2.5, tension: .25, pointRadius: 4 },
    { label: 'الانبساطي', data: rows.map(r => r.diastolic), borderColor: '#7c3aed', borderWidth: 2.5, tension: .25, pointRadius: 4 }
  ]);
}

function renderPatientHealthMonitoring(patient, readings) {
  const root = $('#patHealthMonitoring');
  if (!root) return;
  const clinicFeatures = normalizeClinicalFeatures((State.settings || {}).clinicalFeatures);
  const canTrackGlucose = clinicFeatures.glucoseTracking;
  const canTrackPressure = clinicFeatures.bloodPressureTracking;
  const glucoseEnabled = patient.glucoseTrackingEnabled === true;
  const pressureEnabled = patient.bloodPressureTrackingEnabled === true;
  const section = (kind, clinicEnabled, patientEnabled) => {
    if (!clinicEnabled) return '';
    const glucose = kind === 'glucose';
    const records = readings.filter(r => r.readingType === kind || (glucose ? r.readingType === 'glucose' : r.readingType === 'blood_pressure'));
    const chartId = glucose ? 'healthGlucoseChart' : 'healthPressureChart';
    const addAction = '<button type="button" class="btn btn-primary sm" data-action="add-health-reading" data-id="' + esc(patient.id) + '" data-x="' + kind + '"' + (patientEnabled ? '' : ' disabled title="فعّل المتابعة لهذا المريض أولاً"') + '><i class="fa-solid fa-plus"></i> إضافة قراءة</button>';
    const history = records.length ? records.map(r => healthReadingMarkup(patient, r)).join('') :
      '<div class="health-empty">لا توجد قراءات مسجلة لهذا المريض بعد.</div>';
    const note = patientEnabled ? '' : '<p class="health-monitoring-note">المتابعة متوقفة لهذا المريض؛ السجل السابق محفوظ ويمكن عرضه.</p>';
    return '<section class="health-monitoring-card"><div class="health-monitoring-head"><div><h4><i class="fa-solid ' + (glucose ? 'fa-droplet' : 'fa-heart-pulse') + '"></i> ' + (glucose ? 'متابعة السكر' : 'متابعة ضغط الدم') + '</h4><small>' + (glucose ? 'قراءات مؤرخة مع نوع القياس.' : 'الانقباضي والانبساطي والنبض الاختياري.') + '</small></div>' + addAction + '</div>' +
      note + '<div class="chart-box sm health-reading-chart"><canvas id="' + chartId + '"></canvas></div>' +
      '<div class="health-reading-list">' + history + '</div></section>';
  };
  root.innerHTML = '<div class="card health-monitoring-settings"><div class="card-head"><div><h3><i class="fa-solid fa-sliders"></i> إعداد متابعة هذا المريض</h3><small class="muted">خيارات مستقلة عن التشخيص المسجل في الملف.</small></div></div>' +
    '<div class="health-monitoring-toggles">' +
      (canTrackGlucose ? '<label class="feature-toggle" for="patientTrackGlucose"><span class="feature-toggle-copy"><b>متابعة السكر</b><small>تفعيل إدخال وعرض سجل السكر لهذا المريض.</small></span><input type="checkbox" id="patientTrackGlucose"' + (glucoseEnabled ? ' checked' : '') + '></label>' : '') +
      (canTrackPressure ? '<label class="feature-toggle" for="patientTrackPressure"><span class="feature-toggle-copy"><b>متابعة ضغط الدم</b><small>تفعيل إدخال وعرض سجل الضغط لهذا المريض.</small></span><input type="checkbox" id="patientTrackPressure"' + (pressureEnabled ? ' checked' : '') + '></label>' : '') +
    '</div></div>' +
    '<div class="health-monitoring-grid">' + section('glucose', canTrackGlucose, glucoseEnabled) + section('blood_pressure', canTrackPressure, pressureEnabled) + '</div>';
  const glucoseToggle = $('#patientTrackGlucose');
  if (glucoseToggle) glucoseToggle.onchange = () => savePatientTrackingPreference(patient.id, 'glucoseTrackingEnabled', glucoseToggle);
  const pressureToggle = $('#patientTrackPressure');
  if (pressureToggle) pressureToggle.onchange = () => savePatientTrackingPreference(patient.id, 'bloodPressureTrackingEnabled', pressureToggle);
  drawHealthReadingCharts(readings, canTrackGlucose, canTrackPressure);
}

async function savePatientTrackingPreference(pid, field, control) {
  const patient = getPatient(pid);
  if (!patient) return;
  const previous = patient[field] === true;
  control.disabled = true;
  try {
    await DB.updatePatientMonitoring(pid, { [field]: control.checked === true });
    const current = getPatient(pid) || patient;
    renderPatientHealthMonitoring(current, current.healthReadings || []);
    toast('تم حفظ إعداد المتابعة');
  } catch (_) {
    control.checked = previous;
    control.disabled = false;
    toast('تعذّر حفظ إعداد المتابعة — تحقق من الاتصال وحاول مجددًا.', 'error');
  }
}

async function loadPatientHealthMonitoring(patient) {
  const tab = $('#patHealthTab'), panel = $('#ptab-health');
  const features = normalizeClinicalFeatures((State.settings || {}).clinicalFeatures);
  const available = features.glucoseTracking || features.bloodPressureTracking;
  if (tab) tab.classList.toggle('hide', !available);
  if (!available) {
    if (panel) panel.classList.add('hide');
    if (tab && tab.classList.contains('active')) switchPTab('measure');
    return;
  }
  if (!tab || !panel) return;
  try {
    const readings = await DB.loadHealthReadings(patient.id);
    if (State.route === 'patient' && State.param != null && State.param !== patient.id) return;
    patient.healthReadings = readings;
    renderPatientHealthMonitoring(patient, readings);
  } catch (_) {
    $('#patHealthMonitoring').innerHTML = '<p class="form-error show" role="status">تعذّر تحميل سجل المتابعة. أعد فتح الملف أو تحقق من الاتصال.</p>';
  }
}

function localDateTimeValue(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return { date: todayISO(), time: '09:00' };
  const pad = n => String(n).padStart(2, '0');
  return { date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()), time: pad(date.getHours()) + ':' + pad(date.getMinutes()) };
}

function openHealthReadingModal(pid, kind, existing) {
  const patient = getPatient(pid);
  const features = normalizeClinicalFeatures((State.settings || {}).clinicalFeatures);
  const isGlucose = kind === 'glucose';
  const enabled = isGlucose ? features.glucoseTracking && patient && patient.glucoseTrackingEnabled === true
    : features.bloodPressureTracking && patient && patient.bloodPressureTrackingEnabled === true;
  if (!patient || !enabled) { toast('فعّل نوع المتابعة لهذا المريض أولاً', 'info'); return; }
  const reading = existing || {};
  const parts = localDateTimeValue(reading.recordedAt);
  const fields = isGlucose
    ? '<div class="field"><label for="healthGlucoseValue">قيمة السكر *</label><input class="input ltr" id="healthGlucoseValue" type="number" step="any" value="' + esc(reading.glucoseValue ?? '') + '" required></div>' +
      '<div class="field"><label for="healthGlucoseType">نوع التحليل *</label><select class="input" id="healthGlucoseType" required><option value="">اختر النوع</option>' +
        Object.entries(HEALTH_READING_TYPES).map(([value, label]) => '<option value="' + value + '"' + (reading.glucoseType === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></div>'
    : '<div class="field"><label for="healthSystolic">الضغط الانقباضي *</label><input class="input ltr" id="healthSystolic" type="number" step="1" value="' + esc(reading.systolic ?? '') + '" required></div>' +
      '<div class="field"><label for="healthDiastolic">الضغط الانبساطي *</label><input class="input ltr" id="healthDiastolic" type="number" step="1" value="' + esc(reading.diastolic ?? '') + '" required></div>' +
      '<div class="field"><label for="healthPulse">النبض (اختياري)</label><input class="input ltr" id="healthPulse" type="number" step="1" value="' + esc(reading.pulse ?? '') + '"></div>';
  openModal((existing ? 'تصحيح' : 'إضافة') + (isGlucose ? ' قراءة سكر — ' : ' قراءة ضغط — ') + esc(patient.name),
    '<form id="healthReadingForm" class="form-grid"><div class="field"><label for="healthDate">التاريخ *</label><input class="input" id="healthDate" type="date" value="' + esc(parts.date) + '" required></div>' +
      '<div class="field"><label for="healthTime">الوقت *</label><input class="input" id="healthTime" type="time" value="' + esc(parts.time) + '" required></div>' + fields +
      '<p class="muted full">تُحفظ القراءة كسجل مستقل مع مصدرها. لا تظهر تنبيهات أو توصيات طبية هنا.</p>' +
      '<div id="healthReadingError" class="form-error full" role="alert" aria-live="polite"></div>' +
      '<div class="modal-foot full"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">' + (existing ? 'حفظ التصحيح' : 'حفظ القراءة') + '</button></div></form>', 560);
  $('#healthReadingForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('.btn-primary'), error = $('#healthReadingError');
    button.disabled = true; error.textContent = ''; error.classList.remove('show');
    const date = $('#healthDate').value, time = $('#healthTime').value;
    const stamp = new Date(date + 'T' + time);
    if (!date || !time || !Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== date) {
      error.textContent = 'أدخل تاريخًا ووقتًا صالحين.'; error.classList.add('show'); button.disabled = false; return;
    }
    const payload = { readingType: isGlucose ? 'glucose' : 'blood_pressure', recordedAt: stamp.toISOString() };
    if (isGlucose) { payload.glucoseValue = $('#healthGlucoseValue').value; payload.glucoseType = $('#healthGlucoseType').value; }
    else { payload.systolic = $('#healthSystolic').value; payload.diastolic = $('#healthDiastolic').value; payload.pulse = $('#healthPulse').value || null; }
    try {
      if (existing) await DB.updateHealthReading(pid, existing.id, payload);
      else await DB.addHealthReading(pid, payload);
      closeModal();
      toast(existing ? 'تم تصحيح القراءة' : 'تم حفظ القراءة');
      await loadPatientHealthMonitoring(getPatient(pid) || patient);
    } catch (_) {
      error.textContent = 'تعذّر حفظ القراءة — تحقق من القيم والاتصال وحاول مجددًا.';
      error.classList.add('show'); button.disabled = false;
    }
  };
}

function editPatientHealthReading(pid, id) {
  const patient = getPatient(pid);
  const reading = patient && (patient.healthReadings || []).find(item => item.id === id);
  if (!reading) { toast('القراءة غير موجودة في سجل هذا المريض', 'error'); return; }
  openHealthReadingModal(pid, reading.readingType, reading);
}
