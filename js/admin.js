/**
 * ========================================
 * admin.js
 * الوظيفة: كونسول السوبر أدمن (المرحلة 10+): الدخول والتحقق، النظرة العامة للمنصة والرسوم، تفاصيل Doctor، تفعيل/تعليق/حذف الاشتراكات، ملاحظات الإدارة، وإعدادات النظام (التجربة والأسعار).
 * الدوال/الكيانات الرئيسية: SYS_DEFAULT، ACC_ST، Admin، humanTS، renderDoctorsIf
 * الاعتمادات: db.js, state.js, utils.js, app.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/admin.js — لوحة تحكم المنصة (المرحلة 10: Super Admin)
   ------------------------------------------------------------
   كل البيانات المعروضة تتجمع عبر RPC محمي بـ is_super_admin().
   البيانات السريرية (المرضى/الملاحظات/الأوزان) لا يمكن للأدمن قراءتها
   لأنه لا توجد سياسة RLS تسمح له بذلك — فقط إحصاءات تجميعية.
   ============================================================ */
const SYS_DEFAULT = { trialDays: 14, monthly: 300, yearly: 3000, welcomeMsg: 'مرحباً بك في منظومة عيادتي' };
const ACC_ST = {
  active:    ['اشتراك نشط', 'green'],
  trial:     ['فترة تجريبية', 'blue'],
  expired:   ['منتهي', 'amber'],
  suspended: ['معلّق', 'rose'],
  deleted:   ['محذوف', 'gray']
};

// صياغة وقت حقيقي مقروءة (تستخدم في سجل النشاط)
function humanTS(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return relDay(isoOf(d)) + ' — ' + fmtTime(pad(d.getHours()) + ':' + pad(d.getMinutes()));
}

const Admin = {
  overview: [], sys: { ...SYS_DEFAULT },
  f: { q: '', spec: 'all', status: 'all' },
  current: null,

  // Effective subscription state (computes trial expiry from system settings)
  accStatus(d) {
    const acc = (d.settings && d.settings.account) || {};
    if (['active', 'suspended', 'deleted'].includes(acc.status)) {
      if (acc.status === 'active' && acc.endsAt && acc.endsAt < todayISO()) return 'expired';
      return acc.status;
    }
    const end = addDaysISO((d.created_at || '').slice(0, 10) || todayISO(), +this.sys.trialDays || 14);
    return end < todayISO() ? 'expired' : 'trial';
  },
  accEnd(d) {
    const acc = (d.settings && d.settings.account) || {};
    return acc.endsAt || addDaysISO((d.created_at || '').slice(0, 10) || todayISO(), +this.sys.trialDays || 14);
  },
  accChip(d) { const x = ACC_ST[this.accStatus(d)] || ACC_ST.trial; return '<span class="chip chip-' + x[1] + '">' + x[0] + '</span>'; },

  // Metadata accessors (never clinical rows)
  nameOf(d)   { return (d.settings && d.settings.doctorName) || 'دكتور جديد'; },
  clinicOf(d) { return (d.settings && d.settings.clinicName) || 'عيادة بدون اسم'; },
  specOf(d)   { return (d.settings && d.settings.specialty) || 'غير محدد'; },

  async load() {
    const ov = await DB.sb.rpc('admin_overview');
    if (ov.error) throw ov.error;
    this.overview = ov.data || [];
    const s = await DB.sb.from('system_settings').select('value').eq('id', 1).maybeSingle();
    if (s.data && s.data.value) this.sys = { ...SYS_DEFAULT, ...s.data.value };
  },

  renderDashboard() {
    const s = {
      doctors: this.overview.length,
      patients: this.overview.reduce((a, b) => a + (+b.patients || 0), 0),
      today: this.overview.reduce((a, b) => a + (+b.today_appts || 0), 0),
      active: this.overview.filter(d => this.accStatus(d) === 'active').length
    };
    s.inactive = s.doctors - s.active;
    s.revenue = s.active * (+this.sys.monthly || 0);

    $('#admKpis').innerHTML =
      kpiHTML('fa-user-doctor', 'teal', s.doctors, 'إجمالي الدكاترة المسجلين', 'في المنصة') +
      kpiHTML('fa-hospital', 'blue', s.active, 'اشتراكات نشطة', s.inactive + ' غير نشطة') +
      kpiHTML('fa-users', 'green', fmtNum(s.patients), 'إجمالي المرضى', 'في كل العيادات') +
      kpiHTML('fa-calendar-day', 'amber', s.today, 'مواعيد اليوم', 'كل العيادات') +
      kpiHTML('fa-money-bill-wave', 'violet', fmtNum(s.revenue) + ' ج.م', 'الإيراد الشهري المتوقع', s.active + ' اشتراك × ' + fmtNum(this.sys.monthly) + ' ج.م');

    // Growth of doctor signups over the last 6 months
    const labels = [], counts = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = dt.getFullYear() + '-' + pad(dt.getMonth() + 1);
      labels.push(MONTHS[dt.getMonth()]);
      counts.push(this.overview.filter(d => (d.created_at || '').startsWith(key)).length);
    }
    makeChart('admGrowth', $('#admGrowth'), { type: 'bar',
      data: { labels, datasets: [{ label: 'تسجيلات جديدة', data: counts, backgroundColor: '#a4133c', hoverBackgroundColor: '#86164a', borderRadius: 8, maxBarThickness: 34 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { rtl: true, textDirection: 'rtl' } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#edf3f2' } }, x: { grid: { display: false } } } } });

    // Specialty distribution
    const cats = { 'مشترك (علاج طبيعي + سمنة)': 0, 'علاج طبيعي فقط': 0, 'سمنة وتغذية فقط': 0, 'بدون تخصص': 0 };
    this.overview.forEach(d => {
      const sp = this.specOf(d);
      if (sp.includes('علاج طبيعي') && sp.includes('سمنة')) cats['مشترك (علاج طبيعي + سمنة)']++;
      else if (sp.includes('علاج طبيعي')) cats['علاج طبيعي فقط']++;
      else if (sp.includes('سمنة')) cats['سمنة وتغذية فقط']++;
      else cats['بدون تخصص']++;
    });
    makeChart('admSpecs', $('#admSpecs'), { type: 'doughnut',
      data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats),
        backgroundColor: ['#a4133c', '#0d9488', '#d97706', '#9db4b2'], hoverBackgroundColor: ['#86164a', '#0f766e', '#b45309', '#7a9491'], borderWidth: 4, borderColor: '#fff' }] },
      options: { maintainAspectRatio: false, cutout: '66%',
        plugins: { legend: { position: 'bottom', rtl: true, labels: { usePointStyle: true, boxWidth: 8, padding: 14, font: { weight: 700 } } }, tooltip: { rtl: true, textDirection: 'rtl' } } } });

    // Latest 5 registered accounts
    const latest = this.overview.slice(0, 5);
    $('#admLatest').innerHTML = latest.length ? latest.map(d =>
      '<button class="mini-row" data-action="adm-view" data-id="' + d.doctor_id + '" style="width:100%;text-align:start">' +
        '<div class="avatar" style="background:#a4133c;width:38px;height:38px;font-size:13px;border-radius:11px">' + esc(initials(this.clinicOf(d))) + '</div>' +
        '<div class="grow"><b>' + esc(this.clinicOf(d)) + '</b><small>' + esc(this.nameOf(d)) + ' — سجّل ' + relDay((d.created_at || '').slice(0, 10)) + '</small></div>' +
        this.accChip(d) + '</button>').join('')
      : emptyHTML('fa-user-doctor', 'لا حسابات مسجّلة بعد', 'أول دكتور يسجّل سيظهر هنا');
  },

  filteredList() {
    let list = this.overview.slice();
    if (this.f.status !== 'all') list = list.filter(d => this.accStatus(d) === this.f.status);
    if (this.f.spec !== 'all') list = list.filter(d => this.specOf(d).includes(this.f.spec));
    const q = this.f.q.trim();
    if (q) list = list.filter(d => this.nameOf(d).includes(q) || this.clinicOf(d).includes(q) || (d.email || '').includes(q));
    // Archived accounts appear only under the "deleted" filter
    if (this.f.status !== 'deleted') list = list.filter(d => this.accStatus(d) !== 'deleted');
    return list;
  },

  renderDoctors() {
    const list = this.filteredList();
    $('#admCount').textContent = 'عرض ' + list.length + ' من إجمالي ' + this.overview.length + ' حساب';
    $('#admTbody').innerHTML = list.map(d => {
      const st = this.accStatus(d);
      const acts =
        '<button class="icon-btn sm" data-action="adm-view" data-id="' + d.doctor_id + '" title="التفاصيل"><i class="fa-solid fa-eye"></i></button>' +
        (st === 'deleted'
          ? '<button class="icon-btn sm" data-action="adm-restore" data-id="' + d.doctor_id + '" title="استعادة الحساب" style="color:var(--green)"><i class="fa-solid fa-rotate-left"></i></button>'
          : (st === 'suspended'
              ? '<button class="icon-btn sm" data-action="adm-activate" data-id="' + d.doctor_id + '" title="تفعيل الحساب" style="color:var(--green)"><i class="fa-solid fa-check"></i></button>'
              : '<button class="icon-btn sm" data-action="adm-suspend" data-id="' + d.doctor_id + '" title="تعليق الحساب" style="color:var(--amber)"><i class="fa-solid fa-pause"></i></button>')) +
        '<button class="icon-btn sm" data-action="adm-reset" data-id="' + d.doctor_id + '" title="إرسال رابط إعادة تعيين كلمة المرور"><i class="fa-solid fa-key"></i></button>' +
        (st !== 'deleted' ? '<button class="icon-btn sm danger" data-action="adm-delete" data-id="' + d.doctor_id + '" title="حذف الحساب"><i class="fa-solid fa-trash"></i></button>' : '');
      return '<tr>' +
        '<td><div class="cell-user"><div class="avatar" style="background:#a4133c">' + esc(initials(this.nameOf(d))) + '</div>' +
          '<div><b>' + esc(this.nameOf(d)) + '</b><small class="ltr" style="display:block">' + esc(d.email || '') + '</small></div></div></td>' +
        '<td>' + esc(this.clinicOf(d)) + '</td>' +
        '<td>' + esc(this.specOf(d)) + '</td>' +
        '<td>' + humanDate((d.created_at || '').slice(0, 10) || todayISO()) + '</td>' +
        '<td>' + this.accChip(d) + '<br><small class="muted">حتى ' + humanDate(this.accEnd(d)) + '</small></td>' +
        '<td><b>' + fmtNum(+d.patients || 0) + '</b></td>' +
        '<td><small>' + humanTS(d.last_activity) + '</small></td>' +
        '<td><div class="admin-row-actions">' + acts + '</div></td></tr>';
    }).join('') || '<tr><td colspan="8">' + emptyHTML('fa-magnifying-glass', 'لا نتائج مطابقة', 'عدّل البحث أو الفلاتر') + '</td></tr>';

    // Filters behave like the patient list: live and idempotent
    $$('#admTabs button').forEach(b => b.onclick = () => {
      $$('#admTabs button').forEach(x => x.classList.toggle('active', x === b));
      this.f.status = b.dataset.ast; this.renderDoctors();
    });
    $('#admSearch').oninput = e => { this.f.q = e.target.value; this.renderDoctors(); };
    $('#admSpecFilter').onchange = e => { this.f.spec = e.target.value; this.renderDoctors(); };
  },

  async renderDoctor(id) {
    const d = this.overview.find(x => x.doctor_id === id) || this.overview.find(x => x.id === id);
    if (!d) return go('admin-doctors');
    this.current = d;
    const st = this.accStatus(d);
    const s = d.settings || {};

    // Hero: identity + actions
    $('#admDocHero').innerHTML =
      '<div class="pat-hero">' +
        '<div class="avatar lg" style="background:#a4133c">' + esc(initials(this.clinicOf(d))) + '</div>' +
        '<div class="who"><h2>' + esc(this.nameOf(d)) + '</h2>' +
          '<small>' + esc(this.clinicOf(d)) + ' — ' + esc(this.specOf(d)) + '</small>' +
          '<div class="p-chips" style="margin-top:8px">' + this.accChip(d) +
            '<span class="chip chip-gray"><i class="fa-solid fa-calendar-plus"></i> سجّل ' + humanDate((d.created_at || '').slice(0, 10) || todayISO()) + '</span>' +
            '<span class="chip chip-gray"><i class="fa-solid fa-clock"></i> آخر نشاط ' + humanTS(d.last_activity) + '</span>' +
          '</div></div>' +
        '<div class="acts">' +
          '<button class="btn btn-outline sm" data-action="adm-edit" data-id="' + d.doctor_id + '"><i class="fa-solid fa-pen"></i> تعديل</button>' +
          (st === 'suspended'
            ? '<button class="btn btn-ghost sm" data-action="adm-activate" data-id="' + d.doctor_id + '" style="color:var(--green)"><i class="fa-solid fa-check"></i> تفعيل</button>'
            : '<button class="btn btn-ghost sm" data-action="adm-suspend" data-id="' + d.doctor_id + '" style="color:var(--amber)"><i class="fa-solid fa-pause"></i> تعليق</button>') +
          (st !== 'deleted' ? '<button class="btn btn-ghost sm danger" data-action="adm-delete" data-id="' + d.doctor_id + '" style="color:var(--rose)"><i class="fa-solid fa-trash"></i> حذف</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="pat-meta">' +
        '<div class="meta-item"><small>البريد (لاتصدير أي بيانات سريرية)</small><b class="ltr" style="font-size:12px">' + esc(d.email || '—') + '</b></div>' +
        '<div class="meta-item"><small>الهاتف</small><b class="ltr">' + esc(s.phone || '—') + '</b></div>' +
        '<div class="meta-item"><small>العنوان</small><b>' + esc(s.address || '—') + '</b></div>' +
        '<div class="meta-item"><small>سعر الجلسة</small><b>' + (s.price ? fmtNum(s.price) + ' ج.م' : '—') + '</b></div>' +
      '</div>';

    // Stats
    $('#admDocStats').innerHTML =
      '<div class="sys-row"><i style="background:var(--blue-soft);color:var(--blue)" class="fa-solid fa-users"></i>' +
        '<div style="flex:1"><b>' + fmtNum(+d.patients || 0) + '</b><small>مريض نشط</small></div></div>' +
      '<div class="sys-row"><i style="background:var(--teal-50);color:#a4133c" class="fa-solid fa-calendar-check"></i>' +
        '<div style="flex:1"><b>' + fmtNum(+d.appointments || 0) + '</b><small>إجمالي المواعيد</small></div></div>' +
      '<div class="sys-row"><i style="background:var(--green-soft);color:var(--green)" class="fa-solid fa-weight-scale"></i>' +
        '<div style="flex:1"><b>' + fmtNum(+d.records || 0) + '</b><small>قياس مسجّل</small></div></div>' +
      '<div class="sys-row"><i style="background:var(--violet-soft);color:var(--violet)" class="fa-solid fa-notes-medical"></i>' +
        '<div style="flex:1"><b>' + fmtNum(+d.notes_cnt || 0) + '</b><small>ملاحظة زيارة</small></div></div>' +
      '<div class="sys-row"><i style="background:var(--amber-soft);color:var(--amber)" class="fa-solid fa-calendar-day"></i>' +
        '<div style="flex:1"><b>' + fmtNum(+d.today_appts || 0) + '</b><small>موعيد اليوم</small></div></div>';

    // Subscription card
    $('#admDocSub').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        'الحالة الحالية' + this.accChip(d) + '</div>' +
      '<div class="sys-row" style="border:none;padding:8px 0"><i style="background:var(--teal-50);color:#a4133c" class="fa-solid fa-calendar"></i>' +
        '<div style="flex:1"><b>حتى ' + humanDate(this.accEnd(d)) + '</b><small>' +
          (st === 'active' ? 'الاشتراك ساري' : st === 'trial' ? 'انتهاء الفترة التجريبية' : st === 'expired' ? 'منتهي — جدد من الأسفل' : st === 'suspended' ? 'الحساب معلّق من الإدارة' : 'محذوف (فترة احتفاظ 30 يوماً)') +
        '</small></div></div>' +
      ((s.account && s.account.note) ? '<p class="muted" style="font-size:12.5px;font-weight:700;margin:6px 0 10px"><i class="fa-solid fa-circle-info"></i> ' + esc(s.account.note) + '</p>' : '') +
      '<div class="quick-grid">' +
        '<button data-action="adm-month" data-id="' + d.doctor_id + '"><i class="fa-solid fa-calendar-week" style="background:var(--teal-50);color:#a4133c"></i><strong>تفعيل شهر (' + fmtNum(this.sys.monthly) + ' ج.م)</strong></button>' +
        '<button data-action="adm-year" data-id="' + d.doctor_id + '"><i class="fa-solid fa-calendar-check" style="background:var(--blue-soft);color:var(--blue)"></i><strong>تفعيل سنة (' + fmtNum(this.sys.yearly) + ' ج.م)</strong></button>' +
      '</div>';

    // Parallel fetch: admin notes + audit trail (both pass through is_super_admin guard)
    // (متوسط 1) الملاحظات بـfetchAll؛ سجل التدقيق مقصود بآخر 10 فقط (limit صريح)
    const [ntRows, lg] = await Promise.all([
      DB.fetchAll(() => DB.sb.from('admin_notes').select('*').eq('doctor_id', d.doctor_id)
        .order('created_at', { ascending: false }).order('id')),
      DB.sb.from('audit_logs').select('*').eq('actor_id', d.doctor_id).order('created_at', { ascending: false }).limit(10)
    ]);
    this.notes = ntRows;

    // Admin notes list
    $('#admNoteList').innerHTML = this.notes.length ? this.notes.map(n =>
      '<div class="mini-row"><div class="grow"><b style="font-size:13px">' + esc(n.note) + '</b>' +
        '<small>بواسطة الإدارة — ' + humanTS(n.created_at) + '</small></div></div>').join('')
      : emptyHTML('fa-note-sticky', 'لا ملاحظات إدارية', 'سترى هنا أي تفاصيل مضافة من المشغّل');

    // Audit trail (last 10) with Arabic labels, no PHI
    const ACT_L = { view: 'عرض', create: 'إضافة', edit: 'تعديل', delete: 'حذف', restore: 'استعادة', export: 'تصدير JSON' };
    const ENT_L = { patients: 'مريض', appointments: 'موعد', patient_records: 'قياس', patient_notes: 'ملاحظة', plans: 'خطة', doctors: 'بيانات العيادة', system_settings: 'إعدادات النظام' };
    $('#admDocLog').innerHTML = (lg.data || []).length ? lg.data.map(l =>
      '<div class="mini-row"><div class="grow">' +
        '<b style="font-size:13px">' + esc((ACT_L[l.action] || l.action) + ' — ' + (ENT_L[l.entity] || l.entity)) + '</b>' +
        '<small class="ltr" style="direction:ltr">' + humanTS(l.created_at) + (l.meta && l.meta.scope ? ' — ' + esc(l.meta.scope) : '') + '</small>' +
      '</div></div>').join('')
      : emptyHTML('fa-clock-rotate-left', 'لا نشاط مسجّل', 'سيظهر كل فعل يقوم به الدكتور هنا');

    // Note form
    $('#admNoteForm').onsubmit = async e => {
      e.preventDefault();
      const txt = $('#admNoteTxt').value.trim();
      if (!txt) return toast('اكتب الملاحظة أولاً', 'error');
      const btn = e.target.querySelector('.btn-primary'); btn.disabled = true;
      const { error } = await DB.sb.from('admin_notes').insert({ doctor_id: d.doctor_id, by_admin: DB.uid, note: txt });
      if (error) { toast('تعذّر حفظ الملاحظة — ' + explainError(error), 'error'); }
      else {
        await DB.audit('edit', 'doctors', d.doctor_id, { scope: 'admin-note' });
        toast('تمت إضافة الملاحظة');
        $('#admNoteTxt').value = '';
        this.renderDoctor(d.doctor_id); // reflect immediately
      }
      btn.disabled = false;
    };
  },

  // Subscription actions (all audited inside the RPC)
  async setStatus(id, status, note, ends) {
    const r = await DB.sb.rpc('admin_set_doctor_status', { target: id, new_status: status, ends_at: ends, note });
    if (r.error) { toast('تعذّر تنفيذ العملية — ' + explainError(r.error), 'error'); return false; }
    toast(status === 'active' ? 'تم تفعيل الحساب' : status === 'suspended' ? 'تم تعليق الحساب' : status === 'deleted' ? 'تم حذف الحساب مؤقتاً (30 يوم احتفاظ)' : 'تم التحديث');
    await this.load();
    renderDoctorsIf(State.route);
    // After deleting from the detail view, leave that profile entirely
    if (status === 'deleted' && State.route === 'admin-doctor') go('admin-doctors');
    else if (State.route === 'admin-doctor') this.renderDoctor(id);
    return true;
  },

  async deleteDoctor(id) {
    const d = this.overview.find(x => x.doctor_id === id);
    const ok = await confirmDlg('حذف حساب دكتور',
      'سيتم إغلاق حساب «' + esc(this.nameOf(d)) + '» فوراً ومنعه من الدخول. بيانات مرضاه تبقى محجوبة بالكامل لمدة 30 يوماً ثم تُمسح نهائياً بمهمة التنظيف التلقائية (purge_deleted_rows — تعمل يومياً عبر pg_cron). لا يمكن التراجع من هنا.',
      'حذف الحساب');
    if (!ok) return;
    await this.setStatus(id, 'deleted', 'حذف من لوحة الإدارة');
  },

  async resetPassword(id) {
    const d = this.overview.find(x => x.doctor_id === id);
    if (!d || !d.email) return toast('لا يوجد بريد مسجّل لهذا الحساب', 'error');
    // Client-side safe: Supabase emails the doctor a fresh reset link without knowing the password
    const { error } = await DB.sb.auth.resetPasswordForEmail(d.email, { redirectTo: location.origin + location.pathname });
    if (error) { toast('تعذّر الإرسال — ' + explainError(error), 'error'); return; }
    await DB.audit('edit', 'doctors', id, { scope: 'password-reset-link' });
    toast('تم إرسال رابط إعادة تعيين كلمة المرور إلى <b class="ltr">' + esc(d.email) + '</b>');
  },

  editInfo(id) {
    const d = this.overview.find(x => x.doctor_id === id);
    if (!d) return;
    const s = d.settings || {};
    openModal('تعديل بيانات الدكتور (إدارة)',
      '<form id="admEditForm" class="form-grid">' +
        '<div class="field full"><label>اسم الدكتور</label><input class="input" id="ei_name" value="' + esc(s.doctorName || '') + '" required></div>' +
        '<div class="field full"><label>اسم العيادة</label><input class="input" id="ei_clinic" value="' + esc(s.clinicName || '') + '"></div>' +
        '<div class="field"><label>الهاتف</label><input class="input ltr" id="ei_phone" value="' + esc(s.phone || '') + '"></div>' +
        '<div class="field"><label>التخصص</label><select class="input" id="ei_spec">' +
          '<option ' + (s.specialty === 'علاج طبيعي وسمنة ونحافة' ? 'selected' : '') + '>علاج طبيعي وسمنة ونحافة</option>' +
          '<option ' + (s.specialty === 'علاج طبيعي' ? 'selected' : '') + '>علاج طبيعي</option>' +
          '<option ' + (s.specialty === 'سمنة وتغذية علاجية' ? 'selected' : '') + '>سمنة وتغذية علاجية</option></select></div>' +
        '<div class="modal-foot full" style="margin-top:8px"><button type="button" class="btn btn-ghost" data-close>إلغاء</button>' +
        '<button class="btn btn-primary"><i class="fa-solid fa-check"></i> حفظ التعديلات</button></div>' +
      '</form>', 520);
    $('#admEditForm').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('.btn-primary'); btn.disabled = true;
      // Only metadata keys are edited here — clinical patient data is never touched by admins
      const r = await DB.sb.rpc('admin_update_doctor', {
        target: id,
        patch: { doctorName: $('#ei_name').value.trim(), clinicName: $('#ei_clinic').value.trim(),
                 phone: $('#ei_phone').value.trim(), specialty: $('#ei_spec').value }
      });
      if (r.error) { toast('تعذّر الحفظ — ' + explainError(r.error), 'error'); btn.disabled = false; return; }
      toast('تم حفظ بيانات الدكتور');
      closeModal();
      await this.load();
      if (State.route === 'admin-doctor') this.renderDoctor(id);
      refreshCurrent();
    };
  },

  renderSettings() {
    $('#sysTrial').value = this.sys.trialDays;
    $('#sysMonthly').value = this.sys.monthly;
    $('#sysYearly').value = this.sys.yearly;
    $('#sysWelcome').value = this.sys.welcomeMsg;

    $('#sysForm').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('.btn-primary'); btn.disabled = true;
      const value = {
        trialDays: +$('#sysTrial').value || 14,
        monthly: +$('#sysMonthly').value || 300,
        yearly: +$('#sysYearly').value || 3000,
        welcomeMsg: $('#sysWelcome').value.trim() || SYS_DEFAULT.welcomeMsg
      };
      const { error } = await DB.sb.from('system_settings').upsert({ id: 1, value, updated_at: new Date().toISOString() });
      if (error) { toast('تعذّر الحفظ — ' + explainError(error), 'error'); }
      else {
        this.sys = value;
        await DB.audit('edit', 'system_settings', 1, { scope: 'platform' });
        toast('تم حفظ إعدادات المنصة');
      }
      btn.disabled = false;
    };
  },

  // (بند 14) نسخة المنصة فيها إيميلات وتليفونات العيادات — بتتشفر بنفس
  // آلية نسخة العيادة (مفيش بيانات سريرية للمرضى هنا أصلاً)
  async exportJSON() {
    const clean = this.overview.map(d => ({
      doctor_id: d.doctor_id, email: d.email, created_at: d.created_at,
      settings: { doctorName: this.nameOf(d), clinicName: this.clinicOf(d), specialty: this.specOf(d), phone: d.settings?.phone, address: d.settings?.address, price: d.settings?.price },
      counts: { patients: +d.patients || 0, appointments: +d.appointments || 0, records: +d.records || 0, notes: +d.notes_cnt || 0 },
      account: (d.settings && d.settings.account) || {}, last_activity: d.last_activity
    }));
    if (!(window.crypto && window.crypto.subtle)) return toast('التشفير مش متاح في المتصفح ده (محتاج HTTPS) — التصدير اتلغى حمايةً للبيانات', 'error');
    const pass = await promptDlg('تشفير نسخة المنصة', 'اختر كلمة سر قوية لتشفير ملف المنصة. <b>بدونها مش هتقدر تفتحه.</b>', 'كلمة السر');
    if (!pass) return;
    if (pass.length < 8) return toast('كلمة السر لازم 8 أحرف على الأقل — التصدير ما حصلش', 'error');
    try {
      const env = await encryptBackupEnvelope({ exportedAt: new Date().toISOString(), platform: this.sys, totalClinics: clean.length, clinics: clean }, pass);
      downloadTextFile(JSON.stringify(env), 'platform-backup-' + todayISO() + '.enc.json');
      toast('تم تنزيل نسخة المنصة مشفّرة (بدون بيانات سريرية) — احتفظ بكلمة السر في مكان آمن');
    } catch (e) { logError(e, 'admin.export'); toast('فشل التصدير المشفّر', 'error'); }
  }
};

// Helper: refresh only if the given route matches the current one (avoids cross-render surprises)
function renderDoctorsIf(route) { if (State.route === route) RENDERERS[route](); }

