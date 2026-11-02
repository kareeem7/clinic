/**
 * ========================================
 * dashboard.js
 * الوظيفة: لوحة تحكم الدكتور: الإحصاءات الشهرية، بطاقات KPI، رسم زيارات الشهر، أحدث المرضى، نبضة اليوم، وهياكل التحميل.
 * الدوال/الكيانات الرئيسية: makeChart، monthlyStats، kpiHTML، renderDashboard، emptyHTML، skelKPIs، skelList، recentPatients، timeAgo، pulseRow
 * الاعتمادات: app.js, state.js, db.js, utils.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/dashboard.js — المرحلة 3: لوحة التحكم الرئيسية
   ============================================================ */
// إنشاء رسم بياني مع تدمير القديم لمنع تسريب الذاكرة
function makeChart(key, canvas, cfg) {
  if (!canvas || !window.Chart) return;
  if (Charts[key]) Charts[key].destroy();
  Charts[key] = new Chart(canvas.getContext('2d'), cfg);
}

// إحصائيات آخر 6 أشهر (تُحسب حيًّا من البيانات في وضع Supabase الحقيقي)
function monthlyStats() {
  const labels = [], visits = [], revenue = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + pad(d.getMonth() + 1);
    labels.push(MONTHS[d.getMonth()]);
    const monthAppts = State.appointments.filter(a => (a.date || '').startsWith(key));
    visits.push(monthAppts.length || (State.stats.visits[5 - i] ?? 0));
    revenue.push(monthAppts.filter(a => a.status === 'done').length * (+State.settings.price || 0) || (State.stats.revenue[5 - i] ?? 0));
  }
  return { labels, visits, revenue };
}

function kpiHTML(icon, color, value, label, sub, subOk) {
  return '<div class="kpi"><div class="kpi-icon ' + color + '"><i class="fa-solid ' + icon + '"></i></div>' +
    '<div><b>' + value + '</b><small>' + label + '</small><br>' +
    '<small class="' + (subOk ? 'sub-ok' : '') + '">' + sub + '</small></div></div>';
}

function renderDashboardHealthAlerts() {
  const root = $('#dashAlerts');
  if (!root) return;
  const alerts = (State.healthAlerts || []).slice(0, 10);
  root.innerHTML = alerts.length
    ? '<section class="dashboard-health-alerts" role="alert"><h3><i class="fa-solid fa-triangle-exclamation"></i> قراءات صحية تتجاوز حدود التنبيه (' + (State.healthAlerts || []).length + ')</h3>' +
      alerts.map(reading => {
        const patient = getPatient(reading.patientId);
        return '<button class="dashboard-health-alert" type="button" data-action="view-patient" data-id="' + esc(reading.patientId) + '"><b>' + esc(patient && patient.name || 'ملف المريض') + '</b><span>' + esc(reading.alertLabel) + '</span><small>' + esc(healthTimestampLabel(reading.recordedAt)) + '</small></button>';
      }).join('') +
      '<small class="muted">تنبيهات داخل التطبيق للقراءات خلال آخر 24 ساعة؛ ليست خدمة طوارئ أو إشعارًا فوريًا خارج التطبيق.</small></section>'
    : '';
}

async function renderDashboard() { // (بند 31) بتستنى الاستعلامات المستهدفة
  const s = State.settings, h = new Date().getHours();
  // هياكل التحميل أثناء جلب البيانات من Firestore
  if (!State.loaded) {
    $('#dashGreeting').textContent = 'جارٍ تحميل بيانات العيادة...';
    $('#dashDate').textContent = longDate(new Date());
    $('#kpiGrid').innerHTML = skelKPIs();
    $('#todayList').innerHTML = skelList(3);
    if ($('#recentList')) $('#recentList').innerHTML = skelList(3);
    if ($('#monthPulse')) $('#monthPulse').innerHTML = skelList(4);
    return;
  }
  $('#dashGreeting').textContent = (h < 12 ? 'صباح الخير، ' : h < 17 ? 'طاب يومك، ' : 'مساء الخير، ') + (s.doctorName || 'دكتور');
  $('#dashDate').textContent = longDate(new Date());
  renderDashboardHealthAlerts();

  // حساب المؤشرات (تُعاد حسابتها من State عند كل تغيير — جمع/حذف/تعديل)
  const mNow = todayISO().slice(0, 7);
  const todayA = State.appointments.filter(a => a.date === todayISO() && a.status !== 'cancelled');
  const monthA = State.appointments.filter(a => (a.date || '').startsWith(mNow));
  const monthDone = monthA.filter(a => a.status === 'done');
  const revenue = monthDone.length * (+s.price || 0);
  const newMonth = rosterArr().filter(p => (p.createdAt || '').startsWith(mNow)).length; // (بند 31)
  // الخطط "النشطة" = مربوطة بمريض واحد نشط على الأقل
  const activePlans = State.plans.filter(pl => rosterArr().some(p => p.planId === pl.id && p.status === 'active')).length; // (بند 31)

  // بطاقات الإحصاء الأربع (حسب مواصفات المرحلة 3)
  $('#kpiGrid').innerHTML =
    kpiHTML('fa-users', 'teal', rosterArr().length, 'إجمالي المرضى', activePatients().length + ' نشط الآن') +
    kpiHTML('fa-calendar-day', 'blue', todayA.length, 'مواعيد اليوم', todayA.filter(a => a.status === 'confirmed').length + ' مؤكدة') +
    kpiHTML('fa-user-plus', 'green', newMonth, 'مرضى جدد هذا الشهر', newMonth ? 'انضموا في ' + MONTHS[new Date().getMonth()] : 'لا جدد بعد', Boolean(newMonth)) +
    kpiHTML('fa-utensils', 'amber', activePlans, 'خطط تغذية نشطة', 'من إجمالي ' + State.plans.length + ' خطة');

  // رسم الزيارات الشهرية
  const ms = monthlyStats();
  const ctx = $('#visitsChart');
  if (ctx && window.Chart) {
    const g = ctx.getContext('2d').createLinearGradient(0, 0, 0, 280);
    g.addColorStop(0, 'rgba(13,148,136,.22)'); g.addColorStop(1, 'rgba(13,148,136,0)');
    makeChart('visits', ctx, {
      type: 'line',
      data: { labels: ms.labels, datasets: [
        { label: 'الزيارات والجلسات', data: ms.visits, borderColor: '#0d9488', backgroundColor: g, fill: true, tension: .45, borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#0d9488', pointBorderWidth: 2.5 },
        { label: 'الإيراد (مئات ج.م)', data: ms.revenue.map(x => Math.round(x / 100)), borderColor: '#d97706', borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: .45, fill: false }
      ]},
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: { legend: { rtl: true, labels: { usePointStyle: true, boxWidth: 8, font: { weight: 700 } } }, tooltip: { rtl: true, textDirection: 'rtl' } },
        scales: { y: { beginAtZero: true, grid: { color: '#edf3f2' } }, x: { grid: { display: false } } }
      }
    });
  }

  // رسم توزيع المرضى
  const pt = activePatients().filter(p => p.type === 'pt').length;
  const nu = activePatients().filter(p => p.type === 'nutrition').length;
  makeChart('dist', $('#distChart'), {
    type: 'doughnut',
    data: { labels: ['علاج طبيعي', 'سمنة ونحافة'],
      datasets: [{ data: [pt, nu], backgroundColor: ['#0d9488', '#d97706'], hoverBackgroundColor: ['#0f766e', '#b45309'], borderWidth: 4, borderColor: '#fff' }] },
    options: { maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { position: 'bottom', rtl: true, labels: { usePointStyle: true, boxWidth: 8, padding: 16, font: { weight: 700 } } }, tooltip: { rtl: true, textDirection: 'rtl' } } }
  });

  // تنبيه القياسات من البيت (المرحلة 16): آخر قياسات سجلها المريض من البوابة
  // (بند 31) استعلام مستهدف (آخر 7 أيام، source=patient) بدل مسح قياسات كل المرضى
  const feedCut = addDaysISO(todayISO(), -7);
  let fresh = [];
  try { fresh = await DB.recentPatientRecords(feedCut); } catch (e) { logError(e, 'dash.feed'); }

  // إلغاءات من بوابة المريض (آخر 3 أيام): appointments فقدت cancelled_at/col
  const cancels = State.appointments.filter(a => a.status === 'cancelled' && a.cancelledAt && a.cancelledAt.slice(0, 10) >= addDaysISO(todayISO(), -3));

  // يبني قسمين محتلين: قياسات المريض أولاً ثم الإلغاءات
  let inner = '';
  if (fresh.length) {
    inner += '<div class="card" style="border-color:#b4e8cd;background:#f3fbef">' +
      '<div class="card-head" style="margin-bottom:10px"><h3><i class="fa-solid fa-mobile-screen-button" style="color:#15803d"></i> من بوابة المرضى — قياسات سجلها المريض من البيت</h3></div>' +
      fresh.slice(0, 3).map(x =>
        '<div class="mini-row"><div class="avatar" style="background:#15803d;width:36px;height:36px;font-size:12px;border-radius:11px">' + esc(initials(x.p.name)) + '</div>' +
        '<div class="grow"><b style="font-size:13.5px">' + esc(x.p.name.split(' ')[0]) + ' سجّل قياساً من البيت: ' + x.m.weight + ' كجم</b>' +
        '<small>' + relDay(x.m.date) + (x.m.waist ? ' — خصر ' + x.m.waist + ' سم' : '') + '</small></div>' +
        '<button class="icon-btn sm" data-action="view-patient" data-id="' + x.p.id + '" title="فتح الملف" aria-label="فتح الملف"><i class="fa-solid fa-eye"></i></button></div>').join('') +
      (fresh.length > 3 ? '<p class="p-small" style="text-align:center;margin-top:8px">+ ' + (fresh.length - 3) + ' قياسات أخرى هذا الأسبوع — افتح ملفات المرضى للتفاصيل</p>' : '') +
      '</div>';
  }
  if (cancels.length) {
    inner += '<div class="card" style="border-color:#f3b2c1;background:#fdf1f3;margin-top:12px">' +
      '<div class="card-head" style="margin-bottom:10px"><h3><i class="fa-solid fa-ban" style="color:#be123c"></i> إلغاءات قادمة من المرضى</h3></div>' +
      cancels.map(x =>
        '<div class="mini-row"><div class="avatar" style="background:#be123c;width:36px;height:36px;font-size:12px;border-radius:11px">' + esc(initials(x.patientName || '؟')) + '</div>' +
        '<div class="grow"><b style="font-size:13.5px">' + esc(x.patientName || 'مريض') + ' ألغى موعد ' + relDay(x.date) + '</b>' +
        '<small>' + (x.cancelReason ? 'السبب: ' + esc(x.cancelReason) : 'بدون سبب مُذكور') + '</small></div>' +
        '<button class="icon-btn sm" data-nav="appointments" title="افتح التقويم" aria-label="افتح التقويم"><i class="fa-solid fa-calendar-days"></i></button></div>').join('') +
      '</div>';
  }
  $('#portalFeed').innerHTML = inner;
  $('#portalFeed').classList.toggle('hide', !fresh.length && !cancels.length);
  const list = todayA.slice().sort((a, b) => a.time.localeCompare(b.time));
  const show = list.slice(0, 5);
  $('#todayList').innerHTML = show.length
    ? show.map(a => apptItemHTML(a)).join('') +
      (list.length > 5 ? '<button class="btn btn-ghost sm block" data-nav="appointments" style="margin-top:10px">عرض ' + (list.length - 5) + ' مواعيد أخرى <i class="fa-solid fa-arrow-left"></i></button>' : '')
    : emptyHTML('fa-mug-hot', 'لا توجد مواعيد اليوم', 'يوم هادئ — يمكنك حجز موعد جديد من زر «حجز موعد»');

  // أحدث 5 مرضى تمت إضافتهم
  const recent = recentPatients(5);
  $('#recentList').innerHTML = recent.length ? recent.map(p =>
    '<button class="mini-row" data-action="view-patient" data-id="' + p.id + '" style="width:100%;text-align:start">' +
      '<div class="avatar" style="background:' + avatarColor(p.name) + ';width:38px;height:38px;font-size:13px;border-radius:11px">' + esc(initials(p.name)) + '</div>' +
      '<div class="grow"><b>' + esc(p.name) + '</b><small>' + timeAgo(p.createdAt) + ' — ' + esc(p.diagnosis || TYPE_LABEL[p.type]) + '</small></div>' +
      typeChip(p.type) + '</button>').join('')
    : emptyHTML('fa-user-plus', 'لا مرضى بعد', 'أضف أول مريض من زر «مريض جديد»');

  // نبضة الشهر: جلسات مكتملة + إيراد + متوسط نزول الوزن + خطط نشطة
  // (بند 31) متوسط النزول من سلسلة أوزان خفيفة (3 أعمدة من السيرفر) بدل كل القياسات
  let avgLoss = null;
  try {
    const series = await DB.weightSeries();
    const losses = activePatients().filter(p => p.type === 'nutrition').map(p => {
      const ws = series[p.id] || [];
      if (ws.length < 2) return 0;
      return +(ws[ws.length - 1].weight - ws[0].weight).toFixed(1);
    }).filter(d => d < 0);
    avgLoss = losses.length ? -(losses.reduce((a, b) => a + b, 0) / losses.length).toFixed(1) : null;
  } catch (e) { logError(e, 'dash.weight'); }
  $('#monthPulse').innerHTML =
    pulseRow('fa-clipboard-list', 'green', monthDone.length + ' / ' + monthA.length, 'جلسة مكتملة هذا الشهر') +
    pulseRow('fa-money-bill-wave', 'amber', fmtNum(revenue) + ' ج.م', 'إيراد الشهر (' + monthDone.length + ' جلسة × ' + (+s.price || 0) + ' ج.م)') +
    pulseRow('fa-arrow-trend-down', 'teal', avgLoss !== null ? avgLoss + ' كجم' : '—', 'متوسط نزول الوزن لمرضى التخسيس') +
    pulseRow('fa-utensils', 'violet', activePlans, 'خطة غذائية نشطة حالياً');
}

// عنصر حالة فارغة موحّد
function emptyHTML(icon, title, text) {
  return '<div class="empty"><i class="fa-solid ' + icon + '"></i><b>' + title + '</b><p>' + text + '</p></div>';
}

// ---- هياكل تحميل مركّبة تظهر أثناء جلب البيانات ----
function skelKPIs() {
  return Array(4).fill('<div class="kpi"><div class="kpi-icon skel"></div><div style="flex:1">' +
    '<div class="skel" style="height:20px;width:52%;margin-bottom:9px"></div>' +
    '<div class="skel" style="height:12px;width:80%"></div></div></div>').join('');
}
function skelList(n) {
  return Array(n).fill('<div class="mini-row"><div class="avatar skel"></div><div style="flex:1">' +
    '<div class="skel" style="height:14px;width:45%;margin-bottom:7px"></div>' +
    '<div class="skel" style="height:11px;width:70%"></div></div></div>').join('');
}

// ---- أحدث المرضى وصياغة «منذ متى» ----
function recentPatients(n) {
  // (بند 31) من الفهرس الخفيف (فيه createdAt وdiagnosis وtype) — مش من صفحة القائمة الحالية
  return rosterArr().slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, n);
}
function timeAgo(s) {
  const d = Math.round((parseISO(todayISO()) - parseISO(s || todayISO())) / 86400000);
  if (d <= 0) return 'اليوم'; if (d === 1) return 'أمس';
  if (d < 7) return 'منذ ' + d + ' يوم'; if (d < 30) return 'منذ ' + Math.round(d / 7) + ' أسبوع';
  return humanDate(s);
}
// صف في قائمة «نبضة الشهر»
function pulseRow(ic, color, val, label) {
  return '<div class="sys-row"><i class="fa-solid ' + ic + '" style="background:var(--' + color + '-soft,var(--teal-50));color:var(--' + color + ',var(--teal-700))"></i>' +
    '<div style="flex:1"><b>' + val + '</b><small>' + label + '</small></div></div>';
}

