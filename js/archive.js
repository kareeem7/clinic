/**
 * ========================================
 * archive.js
 * الوظيفة: الأرشيف: عرض العناصر المحذوفة ناعماً (مرضى/مواعيد/قياسات/ملاحظات/خطط) مع العد التنازلي للمسح واستعادة أي عنصر.
 * الدوال/الكيانات الرئيسية: archiveLabel، leaveAdmin، buildNav
 * الاعتمادات: db.js, state.js, utils.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/archive.js — archive of soft-deleted rows (Phase 1)
   ============================================================ */
function archiveLabel(t, r) {
  if (t === 'patients') return r.name || 'مريض بدون اسم';
  if (t === 'appointments') return (r.patientName || 'موعد') + ' — ' + humanDate(r.date) + ' ' + fmtTime(r.time);
  if (t === 'patient_records') return 'قياس بتاريخ ' + humanDate(r.date);
  return 'ملاحظة زيارة بتاريخ ' + humanDate(r.date);
}

async function openArchiveModal() {
  openModal('الأرشيف — العناصر المحذوفة (فترة احتفاظ 30 يوماً)',
    '<p class="muted" style="font-size:13px;font-weight:600;margin-bottom:12px">الحذف في النظام ناعم: تُخفى العناصر من العرض ولا تُمحى فعلياً. استعدها من هنا متى شئت.</p>' +
    '<div id="arcBody"><div class="skel" style="height:130px"></div></div>', 640);
  const tables = [['patients', 'مرضى'], ['appointments', 'مواعيد'], ['patient_records', 'قياسات المرضى'], ['patient_notes', 'ملاحظات الزيارات']];
  let html = '', anyFound = false;
  for (const [t, label] of tables) {
    try {
      const rows = await DB.loadArchive(t);
      if (!rows.length) continue;
      anyFound = true;
      html += '<p style="font-weight:800;font-size:13.5px;margin:14px 0 8px;color:#3d5654">' + label + ' (' + rows.length + ')</p>' +
        rows.map(r => '<div class="mini-row"><div class="grow"><b style="font-size:13.5px">' + esc(archiveLabel(t, r)) + '</b>' +
          '<small>حُذف ' + relDay((r.deleted_at || '').slice(0, 10) || todayISO()) + '</small></div>' +
          '<button class="btn btn-ghost sm" data-action="restore-row" data-t="' + t + '" data-id="' + r.id + '"><i class="fa-solid fa-rotate-left"></i> استعادة</button></div>').join('');
    } catch (e) { logError(e, 'archive.read.' + t); }
  }
  $('#arcBody').innerHTML = html || emptyHTML('fa-box-archive', 'الأرشيف فارغ', 'أي عنصر تحذفه من المرضى أو المواعيد أو القياسات سيظهر هنا');
}

async function enterAdmin() {
  State.isAdmin = true;
  document.body.classList.add('theme-admin');
  buildNav();
  syncShellIdentity();
  showScreen('app');
  try { await Admin.load(); } catch (e) { toast('تعذّر تحميل بيانات الإدارة — تأكد من صلاحية حسابك', 'error'); throw e; }
  go('admin-dashboard');
  toast('مرحباً يا مدير النظام');
}

function leaveAdmin() {
  State.isAdmin = false;
  document.body.classList.remove('theme-admin');
  buildNav();
  syncShellIdentity();
}

// Rebuild navigation rails for the current role
function buildNav() {
  const set = State.isAdmin
    ? [['admin-dashboard', 'الرئيسية', 'fa-gauge-high'], ['admin-doctors', 'الدكاترة والعيادات', 'fa-user-doctor'], ['admin-settings', 'إعدادات النظام', 'fa-gears']]
    : [['dashboard', 'الرئيسية', 'fa-house'], ['patients', 'المرضى', 'fa-users'], ['appointments', 'المواعيد', 'fa-calendar-check'], ['plans', 'خطط التغذية', 'fa-utensils'], ['settings', 'الإعدادات', 'fa-gear']];
  $('#sideNav').innerHTML = set.map(r =>
    '<button data-route="' + r[0] + '"' + (r[0] === (State.isAdmin ? 'admin-dashboard' : 'dashboard') ? ' class="active"' : '') + '>' +
    '<i class="fa-solid ' + r[2] + '"></i><span>' + r[1] + '</span></button>').join('');
  $('#bottomNavIn').innerHTML = set.map(r =>
    '<button data-route="' + r[0] + '"' + (r[0] === (State.isAdmin ? 'admin-dashboard' : 'dashboard') ? ' class="active"' : '') + '>' +
    '<i class="fa-solid ' + r[2] + '"></i><span>' + r[1] + '</span></button>').join('');
}

