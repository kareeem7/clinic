/**
 * ========================================
 * state.js
 * الوظيفة: حالة التطبيق العامة: State (البيانات والفلاتر والمسار)، مؤشر التقويم Cal، سجل الرسوم Charts.
 * الدوال/الكيانات الرئيسية: State، Cal، Charts، TYPE_LABEL، APPT_ST، weightChange، getPatient، activePatients، lastMeasure، bmi، typeChip، stChip
 * الاعتمادات: utils.js (todayISO)
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/state.js — حالة التطبيق العامة
   ============================================================ */
const State = {
  patients: [], appointments: [], plans: [], notes: [],
  isAdmin: false, // وضع إدارة المنصة — يفعّل أقسام الأدمن ويمنع أقسام الدكتور
  settings: {}, stats: { visits: [], revenue: [] },
  route: 'dashboard', param: null,
  pFilter: 'all', pSearch: '', pPage: 1, // فلتر وبحث ورقم صفحة سجل المرضى
  pRange: 'all', // فترة منحنى المريض: 1m | 3m | all
  loaded: false, // هل انتهى تحميل البيانات؟ (لعرض هياكل التحميل)
  // (بند 31) فهرس خفيف id→مريض (أعمدة أساسية) لحسم الأسماء والعدّادات،
  // وإجمالي المطابقين الحاليين للترقيم القادم من السيرفر
  patientIndex: {},
  pTotal: 0
};
const Cal = { anchor: todayISO(), selected: todayISO() }; // مؤشر التقويم
const Charts = {}; // سجل الرسوم البيانية لمنع التكرار

// اختصارات وصول للبيانات
const byId   = (arr, id) => arr.find(x => x.id === id);
// (بند 31) كل صفوف الفهرس الخفيف — مصدر العدّادات والقوائم المجمعة
const rosterArr = () => Object.values(State.patientIndex);
// الصف الكامل (صفحة القائمة الحالية) له الأولوية، وبعده الفهرس الخفيف
const getPatient = id => byId(State.patients, id) || State.patientIndex[id] || null;
const getPlan    = id => byId(State.plans, id);
const activePatients = () => rosterArr().filter(p => p.status === 'active'); // (بند 31) من الفهرس الخفيف
const lastMeasure = p => (p.measurements || []).slice().sort((a, b) => b.date.localeCompare(a.date))[0];

// حساب إجمالي تغير الوزن (سالب = نزول)
function weightChange(p) {
  const ws = (p.measurements || []).filter(m => m.weight != null).sort((a, b) => a.date.localeCompare(b.date));
  if (ws.length < 2) return { diff: 0, current: ws[0]?.weight || null };
  return { diff: +(ws[ws.length - 1].weight - ws[0].weight).toFixed(1), current: ws[ws.length - 1].weight };
}
const bmi = (w, h) => w && h ? +(w / Math.pow(h / 100, 2)).toFixed(1) : null;

// ---- الرقائق الجاهزة ----
const TYPE_LABEL = { pt: 'علاج طبيعي', nutrition: 'سمنة ونحافة' };
// ألوان الحالات حسب المواصفة: مؤكد أخضر — ملغي أحمر — تمت رمادي — بانتظار كهرماني
const APPT_ST = {
  pending:   { label: 'بانتظار التأكيد', cls: 'amber' },
  confirmed: { label: 'مؤكد',            cls: 'green' },
  done:      { label: 'تمت',             cls: 'gray'  },
  cancelled: { label: 'ملغي',            cls: 'rose'  }
};
const typeChip = t => t === 'pt'
  ? '<span class="chip chip-teal"><i class="fa-solid fa-hand-holding-medical"></i>' + TYPE_LABEL[t] + '</span>'
  : '<span class="chip chip-amber"><i class="fa-solid fa-weight-scale"></i>' + TYPE_LABEL[t] + '</span>';
const stChip = s => { const x = APPT_ST[s] || APPT_ST.pending; return '<span class="chip chip-' + x.cls + '">' + x.label + '</span>'; };

