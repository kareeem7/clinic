/**
 * ========================================
 * patient-portal.js
 * الوظيفة: بوابة المريض (المراحل 14-17): الدخول بالتليفون+تاريخ الميلاد، جلسة التوكن، الصفحة الرئيسية، صفحة التقدم والمنحنيات، تسجيل القياسات من البيت مع رفع الصور، صفحة المواعيد والإلغاء بالسبب، وصفحة الخطة مع النصائح اليومية.
 * الدوال/الكيانات الرئيسية: Portal، portalGo، renderWeightStory، renderPainStory، sumCell، cutRange، drawPatientPortalChart، drawWaistChart، drawPainChart، renderMeasTable، portalPlanSheet، DAILY_TIPS
 * الاعتمادات: db.js, utils.js, app.js, state.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/patient-portal.js — المرحلة 14: بوابة المريض
   ------------------------------------------------------------
   منفصلة تماماً عن لوحة الدكتور: التوكن عشوائي ومضبوط الصلاحية،
   والبيانات تتجاب عبر RPCs محمية فقط — ممنوع قراءة بيانات مريض آخر
   أو كتابة أي شيء خارج المسارات الأربعة المسموحة.
   ============================================================ */
const Portal = {
  token: sessionStorage.getItem('clinic_patient_token') || null,
  data: null,

  async login(phone, birth) {
    const { data, error } = await DB.sb.rpc('patient_portal_login', { p_phone: phone, p_birth: birth });
    if (error) throw error;
    if (!data || !data.ok) throw { message: (data && data.error) || 'تعذّر تسجيل الدخول' };
    resetPortalSessionState();
    sessionStorage.setItem('clinic_patient_token', data.token);
    this.token = data.token;
    await this.load(); // pulls the first portal payload right after login
  },

  async load(silentFail) {
    const token = this.token;
    const { data, error } = await DB.sb.rpc('patient_portal_data', { p_token: token });
    if (token !== this.token) return; // an older session must not update the current UI
    if (error) throw error;
    if (!data.ok) {
      this.token = null; this.data = null;
      sessionStorage.removeItem('clinic_patient_token');
      resetPortalSessionState();
      if (!silentFail) toast(data.error || 'انتهت جلستك', 'error');
      switchAuthTab('patient'); showScreen('login');
      return;
    }
    this.data = data;
    document.body.classList.add('theme-patient');
    this.render();
    showScreen('portal');
  },

  async logout() {
    const token = this.token;
    this.token = null; this.data = null;
    sessionStorage.removeItem('clinic_patient_token');
    resetPortalSessionState();
    document.body.classList.remove('theme-patient');
    toast('تم تسجيل خروجك — بالسلامة!', 'info');
    switchAuthTab('patient'); showScreen('login');
    if (token) { try { await DB.sb.rpc('patient_portal_logout', { p_token: token }); } catch (e) { /* networkless shutdown is fine */ } }
  },

  // ---- الواجهة ----
  render() {
    const d = this.data, p = d.patient, c = d.clinic;

    $('#ptHello').textContent = 'أهلاً يا ' + (p.name || '').split(' ')[0]; // icon-free per design rule
    $('#ptClinicName').textContent = c.clinicName || 'عيادتك';
    $('#ptDoctorLine').textContent = c.doctorName || 'الدكتور';
    $('#ptWelcomeLine').textContent = 'كل اللي محتاج تعرفه عن زياراتك وتقدمك تحت إيدك';
    $('#ptAvatar').textContent = (() => { const p0 = p.name.trim().split(/\s+/); return (p0[0]?.[0] || '') + (p0[1]?.[0] || ''); })();

    // موعدك القادم
    const a = d.nextAppointment;
    if (!a || !a.date) {
      $('#ptNextCard').innerHTML =
        '<div class="p-empty"><i class="fa-solid fa-calendar-xmark"></i><b>مفيش مواعيد حالية</b>' +
        '<p class="p-small" style="margin-top:4px">لما العيادة تحجزلك موعد هتلاقيه هنا فوراً</p></div>';
    } else {
      $('#ptNextCard').innerHTML =
        '<div class="p-title"><i class="fa-solid fa-calendar-star"></i> موعدك القادم</div>' +
        '<div class="p-day">' + relDay(a.date) + '</div>' +
        '<div class="p-meta">' +
          '<span class="chip"><i class="fa-solid fa-clock"></i> الساعة ' + fmtTime(a.time) + '</span>' +
          '<span class="chip"><i class="fa-solid fa-notes-medical"></i> ' + esc(a.type || 'جلسة') + '</span>' +
          '<span class="chip"><i class="fa-solid fa-hourglass-half"></i> ' + (a.duration || 30) + ' دقيقة</span>' +
        '</div>' +
        '<p style="margin:12px 0 0;font-size:13.5px;color:#d4ecd9;font-weight:600">' +
          'الحضور المنتظم بيخلي الدكتور يعدّل برنامجك بالظبط — ' + esc(d.clinic.doctorName || '') + '</p>';
      // actions: whatsapp + cancel
      const acts = document.createElement('div');
      acts.className = 'p-acts';
      acts.innerHTML =
        '<button class="btn btn-outline" id="ptWaBtn" style="background:#fff;color:#128c4b;border-color:#b4e8cd"><i class="fa-brands fa-whatsapp"></i> كلّم العيادة</button>' +
        '<button class="btn btn-ghost" id="ptCancelBtn" style="color:#fff;background:rgba(255,255,255,.14)"><i class="fa-solid fa-ban"></i> إلغاء الموعد</button>';
      $('#ptNextCard').appendChild(acts);
      $('#ptWaBtn').onclick = () => {
        const message = 'أهلاً، أنا ' + p.name + ' — معايا استفسار عن موعدي يوم ' + relDay(a.date) + ' الساعة ' + fmtTime(a.time) + '.';
        openWA(c.phone, message);
      };
      $('#ptCancelBtn').onclick = async () => {
        const ok = await confirmDlg('إلغاء الموعد', 'متأكد إنك عايز تلغي موعد يوم ' + relDay(a.date) + ' الساعة ' + fmtTime(a.time) + '؟', 'نعم، إلغاء');
        if (!ok) return;
        const { data: r } = await DB.sb.rpc('patient_portal_cancel', { p_token: this.token, p_appt: a.id, p_reason: '' });
        if (r && r.ok) { toast('تم إلغاء الموعد — لو احتجت موعد تاني كلّم العيادة'); await this.load(); }
        else toast(r && r.error ? r.error : 'تعذّر الإلغاء — كلّم العيادة', 'error');
      };
    }

    // آخر قياس
    const m = d.lastMeasure, pm = d.prevMeasure;
    const arrow = m && pm ? (m.weight < pm.weight
        ? '<span class="chip chip-green"><i class="fa-solid fa-arrow-trend-down"></i> ' + (pm.weight - m.weight).toFixed(1) + ' كجم أقل</span>'
        : m.weight > pm.weight
          ? '<span class="chip chip-rose"><i class="fa-solid fa-arrow-trend-up"></i> +' + (m.weight - pm.weight).toFixed(1) + ' كجم</span>'
          : '<span class="chip chip-gray">ثابت</span>'
      ) : '';
    $('#ptMeasureCard').innerHTML = m && m.weight != null
      ? '<b>آخر قياساتك</b><div class="p-num">' + m.weight + '<small style="font-size:15px;color:var(--muted);font-weight:800"> كجم</small></div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">' + arrow + '<span class="p-small">' + humanDate(m.date) + '</span></div>'
      : '<b>آخر قياساتك</b><div class="p-empty" style="padding:4px 0 2px"><i class="fa-solid fa-weight-scale"></i><b>لسه مفيش قياسات</b></div>' +
        '<p class="p-small" style="margin-top:6px">أول قياس من العيادة هيظهر هنا مع الفرق عن قبل</p>';

    // خطتك الغذائية
    const plan = d.plan;
    $('#ptPlanCard').innerHTML = plan && plan.meals
      ? '<b>خطتك الغذائية</b>' +
        '<p style="font-size:14.5px;font-weight:800;margin-bottom:4px">' + esc(plan.title) + '</p>' +
        '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px">' +
          '<span class="chip chip-amber"><i class="fa-solid fa-fire"></i> ' + plan.calories + ' سعر/يوم</span>' +
          (plan.duration ? '<span class="chip chip-gray"><i class="fa-solid fa-hourglass-half"></i> ' + esc(plan.duration) + '</span>' : '') +
        '</div>' +
        '<button class="btn btn-outline block" id="ptPlanBtn"><i class="fa-solid fa-utensils"></i> شوف الخطة كاملة</button>'
      : '<b>خطتك الغذائية</b><div class="p-empty" style="padding:4px 0 2px"><i class="fa-solid fa-utensils"></i><b>لسه مفيش خطة مربوطة</b></div>' +
        '<p class="p-small" style="margin-top:6px">الدكتور لما يربطك بخطة هتلاقيها هنا مع كل الوجبات</p>';
    if (plan && plan.meals) {
      $('#ptPlanBtn').onclick = () => portalPlanSheet();
    }

    // تقدمك: progress bar for nutrition, session counter for physiotherapy
    if (p.type === 'nutrition' && p.targetWeight && m && m.weight != null && d.firstMeasure && d.firstMeasure.weight != null) {
      const start = d.firstMeasure.weight, cur = m.weight, tgt = p.targetWeight;
      const total = Math.max(0, start - tgt), done = Math.max(0, start - cur);
      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
      const remaining = Math.max(0, +(cur - tgt).toFixed(1));
      $('#ptProgressCard').innerHTML =
        '<b>تقدمك نحو الهدف</b>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">' +
          '<span style="font-size:15px;font-weight:800">الوزن الحالي: <span class="p-num" style="font-size:22px">' + cur + '</span> كجم</span>' +
          '<span class="p-small">الهدف: ' + tgt + ' كجم</span>' +
        '</div>' +
        '<div class="p-progress"><div style="width:' + pct + '%"></div></div>' +
        '<p style="font-size:13.5px;font-weight:700;color:#2b5c3f">' + (remaining > 0 ? 'باقي لك ' + remaining + ' كجم على هدفك — كمّل!' : 'برافو! وصلت لهدفك بالفعل — حافظ عليه') + '</p>';
    } else {
      $('#ptProgressCard').innerHTML =
        '<b>تقدمك</b>' +
        '<p style="font-size:15px;font-weight:800;margin-top:4px">أتممت ' + fmtNum(p.sessions || 0) + ' جلسة/قياس حتى الآن.</p>' +
        '<div class="p-progress"><div style="width:' + Math.min(100, (p.sessions || 0) * 8) + '%"></div></div>' +
        '<p class="p-small">الاستمرارية هي اللي بتحدد الفرق — شوفك الزيارة الجاية!</p>';
    }

    // تسجيل الوزن — بطاقة المرحلة 16 (المريض من البيت): تُعرض لمرضى السمنة فقط
    $('#ptAddWeight').classList.toggle('hide', p.type !== 'nutrition');
    $('#lgDocName').textContent = d.clinic.doctorName || 'الدكتور';
    $('#lgDate').value = todayISO();
    $('#lgDate').max = todayISO(); // ممنوع التاريخ الأكبر من النهارده

    // أزرار + / - للوزن (تحرك بنص كجم)
    $('#lgDown').onclick = () => { const el = $('#lgWeight'); const v = (+el.value || p.targetWeight || 85) - 0.5; el.value = v < 30 ? 30 : v.toFixed(1); };
    $('#lgUp').onclick   = () => { const el = $('#lgWeight'); const v = (+el.value || p.targetWeight || 85) + 0.5; el.value = v > 250 ? 250 : v.toFixed(1); };

    // اختيار الصورة + معاينة صغيرة
    $('#lgPhoto').onchange = e => {
      const f = e.target.files && e.target.files[0];
      if (!f) { $('#lgPhotoPrev').classList.add('hide'); $('#lgPhotoTxt').textContent = 'اضغط للتصوير أو اختيار صورة (حتى 5MB)'; return; }
      if (f.size > 5 * 1024 * 1024) { $('#lgPhoto').value = ''; toast('الصورة كبيرة قوي (أكتر من 5MB) — اختار أصغر', 'error'); return; }
      const token = this.token;
      const fr = new FileReader();
      fr.onload = ev => { if (token !== this.token) return; $('#lgPhotoPrev').src = ev.target.result; $('#lgPhotoPrev').classList.remove('hide'); };
      fr.readAsDataURL(f);
      $('#lgPhotoTxt').textContent = f.name;
    };

    // الحفظ: نفس البوابة الفردية portalSubmitMeasurement (تتضمن التحذير والتحديث)
    $('#lgSave').onclick = () => portalSubmitMeasurement();
  }
};

/* ===== js/patient-log.js — المرحلة 16: تسجيل قياسات المريض من البيت ===== */

// Upload through the Edge Function; the server validates the patient token,
// derives the path and enforces its own file type and size limits.
async function portalUploadPhoto(file, token) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw { message: 'اختار صورة بصيغة JPG أو PNG أو WebP' };
  if (file.size > 5 * 1024 * 1024) throw { message: 'الصورة كبيرة قوي — اختار صورة أصغر (حتى 5MB)' };
  const { data, error } = await DB.sb.functions.invoke('portal-photo-upload', {
    headers: { 'x-patient-token': token, 'Content-Type': file.type }, body: file
  });
  if (error || !data || typeof data.path !== 'string' || !data.path) throw { message: 'تعذّر رفع الصورة' };
  return data.path;
}
// Signed read URL (valid 60 min) — works for both sides by RLS rules
async function storagePhotoUrl(path) {
  const { data, error } = await DB.sb.storage.from('patient-photos').createSignedUrl(path, 3600);
  if (error) return null;
  return data && data.signedUrl;
}

// Patient portal tester: one-shot validation + save + motivational feedback
async function portalSubmitMeasurement() {
  const token = Portal.token;
  if (!token || !Portal.data || !Portal.data.patient) return;
  const w = +$('#lgWeight').value;
  const err = $('#lgErr'); err.classList.remove('show');

  // client validation mirrors the RPC ranges
  if (!(w >= 30 && w <= 250)) { err.textContent = 'الوزن لازم يكون بين 30 و 250 كجم — راجع الرقم'; err.classList.add('show'); return; }
  const wa = +$('#lgWaist').value, hips = +$('#lgHips').value, arm = +$('#lgArm').value;
  const date = $('#lgDate').value || todayISO();
  const note = $('#lgNote').value.trim().slice(0, 500);
 /**
   * ممنوع التاريخه أكبر من النهارده، والمحيط لو اتكتب يبقى 30-200
   */
  if (date > todayISO()) { err.textContent = 'التاريخ مش ممكن يبقى قدام النهارده'; err.classList.add('show'); return; }
  if ((wa && (wa < 30 || wa > 200)) || (hips && (hips < 30 || hips > 200)) || (arm && (arm < 30 || arm > 200))) {
    err.textContent = 'المحيطات الاختيارية بين 30 و 200 سم'; err.classList.add('show'); return;
  }

  // Big-diff guard: >5kg from last known measurement gets a friendly block-confirm
  const lastW = Portal.data.lastMeasure && Portal.data.lastMeasure.weight;
  if (lastW != null && Math.abs(w - lastW) > 5) {
    const ok = await confirmDlg('فرق وزن كبير',
      'آخر قياس عندك كان ' + lastW + ' كجم، والنهارده كتبت ' + w + ' كجم — يعني فرق ' + Math.abs(w - lastW).toFixed(1) + ' كجم. متأكد إن الرقم صح؟',
      'نعم، الرقم صح');
    if (!ok || token !== Portal.token) return;
  }

  if (token !== Portal.token) return;
  const btn = $('#lgSave'); btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ الحفظ...</span>';

  try {
    // optional photo upload first (its path is stored with the measurement)
    let photoPath = null;
    const file = $('#lgPhoto').files && $('#lgPhoto').files[0];
    if (file) {
      try { photoPath = await portalUploadPhoto(file, token); }
      catch (pe) {
        if (token !== Portal.token) return;
        toast('الصورة ماترفعتش — القياس هيتحفظ بدونها: ' + (pe.message || ''), 'info');
      }
    }

    if (token !== Portal.token) return;
    const payload = {
      p_token: token, p_weight: w,
      p_waist: wa || null, p_hips: hips || null, p_arm: arm || null,
      p_note: note, p_date: date, p_photo_path: photoPath
    };
    const { data: r, error } = await DB.sb.rpc('patient_portal_add_measurement', payload);
    if (token !== Portal.token) return;
    if (error) throw error;
    if (!r || !r.ok) { err.textContent = r && r.error ? r.error : 'تعذّر الحفظ'; err.classList.add('show'); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> حفظ القياس'; return; }

    // The write has succeeded. Invalidate the cache and clear the form even if
    // the subsequent refresh fails, so the patient does not retry a saved entry.
    portalRecordsCache = null;
    ['lgWeight', 'lgWaist', 'lgHips', 'lgArm', 'lgNote'].forEach(id => { $('#' + id).value = ''; });
    $('#lgPhoto').value = '';
    $('#lgPhotoPrev').classList.add('hide');
    $('#lgPhotoTxt').textContent = 'اضغط للتصوير أو اختيار صورة (حتى 5MB)';

    let refreshed = true;
    try { await Portal.load(); }
    catch (refreshError) { refreshed = false; }
    if (token !== Portal.token) return;
    if (!refreshed) {
      toast('تم حفظ القياس، لكن تعذّر تحديث البيانات — حدّث الصفحة لاحقاً', 'info');
    } else if (Portal.token) {
      let msg;
      if (lastW != null) {
        const d = w - lastW;
        if (d < 0) msg = 'مبروك! نزلت ' + Math.abs(d).toFixed(1) + ' كجم عن آخر قياس 🔥'.replace('🔥','');
        else if (d === 0) msg = 'وزنك ثابت — وده تمام في مرحلة الثبات، كمّل';
        else msg = 'الوزن طلع ' + d.toFixed(1) + ' كجم من آخر مرة — هنراجعها مع الدكتور في الزيارة الجاية';
      } else msg = 'أول قياس مسجّل لك — أهلاً ببدايتك!';
      toast(msg);
      if (!$('#ptProgressView').classList.contains('hide')) portalRenderProgress(); // منحنى التطور يتحدث فوراً
    }
  } catch (ex2) {
    if (token !== Portal.token) return;
    err.textContent = 'تعذّر الحفظ — تحقق من الإنترنت وحاول تاني';
    err.classList.add('show');
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-check"></i> حفظ القياس';
}

/* ===== js/patient-progress.js — المرحلة 15: منحنى تطور المريض ===== */
let portalRecordsCache = null;   // measurements fetched once per session, refetched after adding one
let portalRecordsToken = null;
let portalRange = 'all';          // فترة المنحنى: 1m | 3m | all
let portalTableExpanded = false;

// Clear patient-specific state and visible remnants before another session starts.
function resetPortalSessionState() {
  portalRecordsCache = null; portalRecordsToken = null;
  portalRange = 'all'; portalTableExpanded = false;
  ['lgWeight', 'lgWaist', 'lgHips', 'lgArm', 'lgNote', 'lgPhoto'].forEach(id => { $('#' + id).value = ''; });
  $('#lgPhotoPrev').classList.add('hide');
  $('#lgPhotoPrev').removeAttribute('src');
  $('#lgPhotoTxt').textContent = 'اضغط للتصوير أو اختيار صورة (حتى 5MB)';
  $('#lgErr').classList.remove('show');
  $('#lgSave').disabled = false;
  $('#lgSave').innerHTML = '<i class="fa-solid fa-check"></i> حفظ القياس';
  ['ptSummary', 'ptRows', 'ptRowsNote', 'ptMotive', 'ptAppointmentsView'].forEach(id => { $('#' + id).innerHTML = ''; });
  ['pw1', 'pw2'].forEach(key => { if (Charts[key]) { Charts[key].destroy(); delete Charts[key]; } });
  $('#ptHomeMain').classList.remove('hide');
  ['ptProgressView', 'ptLogView', 'ptAppointmentsView'].forEach(id => { $('#' + id).classList.add('hide'); });
  $$('#patientPortal .pt-bottom button').forEach(b => b.classList.toggle('active', b.dataset.pview === 'home'));
  $$('#ptRangeTabs button').forEach(b => b.classList.toggle('active', b.dataset.prange === 'all'));
}

async function portalLoadRecords(force) {
  const token = Portal.token;
  if (!token) return null;
  if (portalRecordsCache && portalRecordsToken === token && !force) return portalRecordsCache;
  const { data, error } = await DB.sb.rpc('patient_portal_records', { p_token: token });
  if (token !== Portal.token) return null;
  if (error) throw error;
  if (!data.ok) {
    portalRecordsCache = null;
    toast(data.error || 'انتهت جلستك', 'error');
    Portal.logout();
    return null;
  }
  portalRecordsCache = data.records || [];
  portalRecordsToken = token;
  return portalRecordsCache;
}

function portalGo(view) {
  // ناڤ البوابة: يوجد type الآن في الشريط السفلي (4 تبويبات)
  $$('#patientPortal .pt-bottom button').forEach(b => b.classList.toggle('active', b.dataset.pview === view));
  $('#ptHomeMain').classList.toggle('hide', view !== 'home');
  $('#ptProgressView').classList.toggle('hide', view !== 'progress');
  $('#ptLogView').classList.toggle('hide', view !== 'log');
  $('#ptAppointmentsView').classList.toggle('hide', view !== 'appointments');
  if (view === 'progress') portalRenderProgress();
  if (view === 'appointments') portalRenderAppointments();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function portalRenderProgress() {
  const token = Portal.token;
  const sum = $('#ptSummary');
  sum.innerHTML = '<div class="skel" style="height:78px"></div>'.repeat(3);
  const rows = await portalLoadRecords().catch(() => { if (token === Portal.token) toast('تعذّر تحميل سجل القياسات', 'error'); return null; });
  if (!rows || token !== Portal.token || !Portal.data) return;
  const p = Portal.data.patient;

  // Empty state — المريض لسه مفيش عنده قياسات
  if (!rows.length) {
    sum.innerHTML = '';
    $('#ptProgressView').querySelector('#ptMotive').innerHTML = '';
    if (Charts.pw1) { Charts.pw1.destroy(); delete Charts.pw1; }
    if (Charts.pw2) { Charts.pw2.destroy(); delete Charts.pw2; }
    $('#ptWaistCard').classList.add('hide');
    $('#ptRows').innerHTML = '';
    const wCard = document.querySelector('#ptProgressView .chart-box').closest('.p-card');
    wCard.querySelector('.chart-box').style.display = 'none';
    wCard.querySelector('#ptMotive').innerHTML =
      '<div class="p-empty" style="padding:16px"><i class="fa-solid fa-chart-line"></i><b>لسه مفيش قياسات</b>' +
      '<p class="p-small" style="margin-top:4px">الدكتور هيسجل أول قياس في زيارتك الجاية — وهيوصلك منحنى هنا فوراً</p></div>';
    return;
  }

  // return cards to visible if previously in empty state
  document.querySelector('#ptProgressView .chart-box').style.display = '';

  const withWeight = rows.filter(r => r.weight != null);
  const withWaist = rows.filter(r => r.waist != null);
  const sessions = rows.filter(r => r.session != null);

  if (p.type === 'nutrition' && !withWeight.length) {
    sum.innerHTML = '';
    if (Charts.pw1) { Charts.pw1.destroy(); delete Charts.pw1; }
    document.querySelector('#ptProgressView .chart-box').style.display = 'none';
    $('#ptMotive').innerHTML = '<div class="p-empty"><b>لسه مفيش قياسات وزن</b></div>';
    drawWaistChart(withWaist);
    renderMeasTable(rows);
    return;
  }
  if (p.type === 'nutrition') renderWeightStory(withWeight, withWaist, p);
  else renderPainStory(sessions, p);
}

/* ---- فرع مرضى السمنة ---- */
function renderWeightStory(rows, waistRows, p) {
  const rangeRows = cutRange(rows, portalRange);
  const first = rows[0], last = rows[rows.length - 1];
  const diff = +(last.weight - first.weight).toFixed(1);
  const tgt = p.targetWeight;
  const remaining = tgt != null ? +(last.weight - tgt).toFixed(1) : null;
  const avg = +(rows.reduce((a, r) => a + r.weight, 0) / rows.length).toFixed(1);

  // الإحصائيات السريعة
  $('#ptSummary').innerHTML =
    sumCell('بدأت بـ', first.weight + ' <span>كجم</span>', '') +
    sumCell('دلوقتي', last.weight + ' <span>كجم</span>', '') +
    sumCell(diff < 0 ? 'خسرت' : diff > 0 ? 'كسبت' : 'ثابت', Math.abs(diff) + ' <span>كجم</span>', diff < 0 ? 'good' : '') +
    sumCell('هدفك', (tgt != null ? tgt + ' <span>كجم</span>' : '—'), '') +
    sumCell('باقي لك', (remaining != null ? Math.max(0, remaining) + ' <span>كجم</span>' : '—'), '') +
    sumCell('متوسط وزنك', avg + ' <span>كجم</span>', '');

  // رسم الوزن + خط الهدف
  drawPatientPortalChart('pw1', $('#ptwChart'), rangeRows, tgt);
  drawWaistChart(waistRows);

  // message the trend
  const icon = diff < 0 ? 'fa-arrow-trend-down' : diff === 0 ? 'fa-arrows-left-right' : 'fa-arrow-trend-up';
  const msg = diff < 0 ? 'أداء ممتاز! كمّل كده — التزامك باين على المنحنى'
             : diff === 0 ? 'ثبات الوزن مرحلة طبيعية — متوقفش، الدكتور هيوجّهك'
             : 'مفيش مشكلة — راجع الدكتور في الزيارة الجاية وهنعدّل الخطة مع بعض';
  $('#ptMotive').innerHTML = '<div class="p-motive ' + (diff < 0 ? 'ok' : diff === 0 ? 'warn' : 'bad') + '">' +
    '<i class="fa-solid ' + icon + '"></i><span>' + msg + '</span></div>';

  renderMeasTable(rows);
}

/* ---- فرع مرضى العلاج الطبيعي ---- */
function renderPainStory(rows, p) {
  const rangeRows = cutRange(rows.filter(r => r.pain != null), portalRange);
  const first = rows.find(r => r.pain != null), last = rows.filter(r => r.pain != null).slice(-1)[0];
  $('#ptSummary').innerHTML =
    sumCell('عدد الجلسات', rows.length, '') +
    sumCell('الألم الأول', (first ? first.pain : '—') + ' <span>/10</span>', '') +
    sumCell('الألم الحالي', (last ? last.pain : '—') + ' <span>/10</span>', first && last ? (last.pain < first.pain ? 'good' : '') : '') +
    sumCell('التحسن', first && last ? (first.pain - last.pain > 0 ? (first.pain - last.pain) + ' <span>درجة</span>' : '—') : '—', '');
  drawPainChart(rangeRows);
  renderMeasTable(rows);
}

// قصير ومساعد — خلية إحصاء موحدة
function sumCell(label, value, cls) {
  return '<div class="psum ' + cls + '"><small>' + label + '</small><b>' + value + '</b></div>';
}
// فلتر الفترة الزمنية
function cutRange(rows, range) {
  if (range === 'all') return rows;
  const cut = new Date(); cut.setMonth(cut.getMonth() - (range === '3m' ? 3 : 1));
  const cutISO = isoOf(cut);
  return rows.filter(r => r.date >= cutISO);
}

/* ---- رسم المنحنى: آخر نقطة مميزة بـ radius أكبر + لون أغمق ---- */
function drawPatientPortalChart(key, canvas, rows, target) {
  if (!canvas || !window.Chart) return;
  const n = rows.length;
  const datasets = [{
    label: 'وزنك (كجم)', data: rows.map(r => r.weight), borderColor: '#2563eb', borderWidth: 3, tension: .45, fill: true,
    backgroundColor: 'rgba(37,99,235,.14)',
    pointRadius: rows.map((_, i) => i === n - 1 ? 7 : 3.5),         // آخر نقطة أوضح
    pointHoverRadius: rows.map((_, i) => i === n - 1 ? 9 : 6),
    pointBackgroundColor: rows.map((_, i) => i === n - 1 ? '#16a34a' : '#fff'),
    pointBorderColor: rows.map((_, i) => i === n - 1 ? '#16a34a' : '#2563eb'),
    pointBorderWidth: rows.map((_, i) => i === n - 1 ? 3 : 2)
  }];
  if (target != null) datasets.push({
    label: 'هدفك', data: rows.map(() => target), borderColor: '#16a34a', borderDash: [8, 7], borderWidth: 2.5,
    pointRadius: 0, fill: false
  });
  makeChart(key, canvas, {
    type: 'line',
    data: { labels: rows.map(r => humanDate(r.date)), datasets },
    options: {
      maintainAspectRatio: false, responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { rtl: true, labels: { usePointStyle: true, boxWidth: 8, font: { weight: 700 } } },
        tooltip: {
          rtl: true, textDirection: 'rtl',
          callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y + ' كجم' }
        }
      },
      scales: {
        y: { grid: { color: '#eef3f2' }, ticks: { maxTicksLimit: 5, font: { size: 12 } } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 11.5 } } }
      }
    }
  });
}

function drawWaistChart(waistRows) {
  // Waist section shows only when at least 2 waist readings exist
  const card = $('#ptWaistCard');
  if (!card) return;
  if (!waistRows || waistRows.length < 2) { card.classList.add('hide'); return; }
  card.classList.remove('hide');
  makeChart('pw2', $('#ptwWaist'), {
    type: 'line',
    data: { labels: waistRows.map(r => humanDate(r.date)), datasets: [{
      label: 'محيط الخصر (سم)', data: waistRows.map(r => r.waist), borderColor: '#0d9488', borderWidth: 3, tension: .45,
      backgroundColor: 'rgba(13,148,136,.13)', fill: true,
      pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#0d9488', pointBorderWidth: 2.5
    }] },
    options: { maintainAspectRatio: false, plugins: { legend: { rtl: true, labels: { usePointStyle: true, boxWidth: 8, font: { weight: 700 } } },
      tooltip: { rtl: true, textDirection: 'rtl', callbacks: { label: ctx => ctx.parsed.y + ' سم' } } },
      scales: { y: { grid: { color: '#eef3f2' }, ticks: { maxTicksLimit: 5 } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } } } }
  });
}

function drawPainChart(rows) {
  makeChart('pw1', $('#ptwChart'), {
    type: 'line',
    data: { labels: rows.map(r => 'ج' + (r.session || '?')), datasets: [{
      label: 'مقياس الألم', data: rows.map(r => r.pain), borderColor: '#e11d48', backgroundColor: 'rgba(225,29,72,.1)',
      borderWidth: 3, tension: .45, fill: true, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#e11d48', pointBorderWidth: 2
    }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false },
      tooltip: { rtl: true, textDirection: 'rtl', callbacks: { label: ctx => ctx.parsed.y + ' /10' } } },
      scales: { y: { min: 0, max: 10, grid: { color: '#eef3f2' } }, x: { grid: { display: false } } } }
  });
}

// جدول القياسات: أحدث 10 أولاً، والباقي بزر «شوف الكل»
function renderMeasTable(rows) {
  const reversed = rows.slice().reverse();
  const show = portalTableExpanded ? reversed : reversed.slice(0, 10);
  $('#ptRows').innerHTML = show.map(r =>
    '<tr><td>' + humanDate(r.date) + '</td>' +
    '<td><b>' + (r.weight != null ? r.weight + ' كجم' : (r.session != null ? 'جلسة ' + r.session : '—')) + '</b></td>' +
    '<td>' + (r.waist != null ? r.waist + ' سم' : '—') + '</td>' +
    '<td><small>' + esc(r.note || '—') + '</small></td></tr>').join('');
  const more = reversed.length - show.length;
  $('#ptAllRows').textContent = more > 0 && !portalTableExpanded ? 'شوف الكل (' + more + ' أكتر)' : 'رجّع آخر 10 بس';
  $('#ptRowsNote').textContent = portalTableExpanded ? 'كل القياسات اللي العيادة سجلتها لك' : 'عرض آخر ' + show.length + ' من إجمالي ' + reversed.length + ' قياس — التواريخ من الأحدث للأقدم';
}

/* ===== js/patient-plan.js + patient-appointments.js — المرحلة 17 ===== */

// نصائح يومية متغيرة (تتغير مع رقم اليوم) — لصفحة الخطة
// (بند 13) نصائح عامة بلا ادعاءات علاجية وبلا أخطاء إملائية — صياغات
// محايدة من التغذية الأساسية؛ أي توصية طبية فردية مكانها الخطة نفسها
const DAILY_TIPS = [
  'وزّع شرب الماء على اليوم — واسأل دكتورك عن الكمية المناسبة لحالتك',
  'امشي 30 دقيقة معظم أيام الأسبوع — النشاط المنتظم بيدعم صحتك العامة',
  'قلة النوم بتزود الإحساس بالجوع — نوم كافي بيسهّل التزامك بالخطة',
  'لو جعت بين الوجبات، اختار ثمرة فاكهة أو خضار بدل السناك المصنّع',
  'قلّل الملح والأكل المصنّع بالتدريج — ذوقك بيتعود على الملح الأقل في أسابيع',
  'لما تحس بجوع بين الوجبات اشرب ماء واستنى 10 دقايق — أحياناً العطش بيتشابه مع الجوع',
  'كل ببطء (15-20 دقيقة للوجبة) — إشارة الشبع بتاخد وقت توصل للمخ',
  'لو نفسك في حاجة حلوة، جرب تمرة أو تفاحة بقرفة قبل أي سناك معلّب',
  'لو فاتتك وجبة ما تضغطش على نفسك — كمّل خطتك عادي في الوجبة اللي بعدها',
  'سجّل قياساتك بانتظام — اللي بيتابع تقدمه بيلتزم أكتر'
];

// صفحة الخطة الكاملة: تثبت شكلها بعتبارها «صفحة كاملة» جوا المودال
function portalPlanSheet() {
  const plan = Portal.data.plan;
  const p = Portal.data.patient, c = Portal.data.clinic;
  if (!plan) return toast('لسه مفيش خطة مربوطة', 'error');

  const start = p.planStart || todayISO(), end = p.planEnd || addDaysISO(todayISO(), 30);
  const totalDays = Math.max(1, Math.round((parseISO(end) - parseISO(start)) / 86400000) + 1);
  const dayNow = Math.min(totalDays, Math.max(1, Math.round((parseISO(todayISO()) - parseISO(start)) / 86400000) + 1));
  const pct = Math.round((dayNow / totalDays) * 100);

  const mealIcon = n => {
    if (n.includes('فطار')) return 'fa-egg';
    if (n.includes('غد') || n.includes('غدا')) return 'fa-bowl-food';
    if (n.includes('عش')) return 'fa-utensils';
    return 'fa-apple-whole';
  };
  const tip = DAILY_TIPS[Math.floor(new Date().getTime() / 86400000) % DAILY_TIPS.length];

  openModal('خطتك الغذائية',
    '<div style="margin-bottom:12px">' +
      '<div class="p-chips" style="margin-bottom:8px">' +
        '<span class="chip chip-amber"><i class="fa-solid fa-fire"></i> ' + plan.calories + ' سعر/يوم</span>' +
        (plan.duration ? '<span class="chip chip-teal"><i class="fa-solid fa-hourglass-half"></i> ' + esc(plan.duration) + '</span>' : '') +
        (start ? '<span class="chip chip-gray"><i class="fa-solid fa-calendar"></i> ' + humanDate(start) + ' — ' + humanDate(end) + '</span>' : '') +
      '</div>' +
      (plan.desc ? '<p class="muted" style="font-size:13px;font-weight:700;margin-bottom:10px">' + esc(plan.desc) + '</p>' : '') +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">' +
        '<b style="font-size:15px">' + 'اليوم ' + dayNow + ' من ' + totalDays + '</b><span class="p-small">' + pct + '% من البرنامج</span></div>' +
      '<div class="p-progress" style="margin:0 0 10px"><div style="width:' + pct + '%"></div></div>' +
      '<div class="tip-card" style="background:#fff8e6;border-color:#f4e3b1">' +
        '<i class="fa-solid fa-lightbulb" style="color:#d97706"></i><p><b>نصيحة اليوم:</b> ' + esc(tip) + '</p></div>' +
    '</div>' +

    // الوجبات مع تبديل البدائل
    (plan.meals || []).map((m, i) =>
      '<div style="border:1.5px solid var(--line);border-radius:16px;padding:13px 14px;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">' +
          '<div style="width:38px;height:38px;border-radius:11px;background:#eef7ec;color:#15803d;display:grid;place-items:center;font-size:15px"><i class="fa-solid ' + mealIcon(m.name || '') + '"></i></div>' +
          '<b style="font-size:14px;flex:1">' + esc(m.name) + '</b>' +
          (m.alt ? '<button class="btn btn-ghost sm" data-meal-alt="' + i + '" style="font-size:12px;padding:6px 11px">شوف بدائل</button>' : '') +
        '</div>' +
        '<p style="font-size:13.5px;font-weight:700;color:#334d4b;line-height:1.75;margin-inline-start:48px">' + esc(m.desc) + '</p>' +
        (m.alt ? '<div class="tip-card meals-alt hide" id="mealAlt' + i + '" style="margin:8px 0 0 48px;padding:9px 12px;font-size:12.5px">' +
          '<i class="fa-solid fa-arrows-rotate" style="color:#0d9488"></i><p><b>بدائل:</b> ' + esc(m.alt) + '</p></div>' : '') +
      '</div>').join('') +

    '<div class="p-motive ok" style="margin-top:14px;font-size:13px">' +
      '<i class="fa-solid fa-shield-heart"></i>' +
      '<span>الخطة دي مخصصة ليك من د. ' + esc(c.doctorName || '') + '. لو حسيت بأي مشكلة، كلم الدكتور قبل ما تغيّر أي حاجة بنفسك.</span>' +
    '</div>' +
    '<div class="modal-foot"><button class="btn btn-primary block" data-close>تمام، هحافظ عليها</button></div>',
    600);

  // toggles البدائل
  $$('#modalRoot [data-meal-alt]').forEach(b => {
    b.onclick = () => {
      const box = document.getElementById('mealAlt' + b.dataset.mealAlt);
      box.classList.toggle('hide');
      b.textContent = box.classList.contains('hide') ? 'شوف بدائل' : 'خمّي البدائل';
    };
  });
}

// صفحة مواعيدك: قادمة + آخر 5 زيارات
async function portalRenderAppointments() {
  const token = Portal.token;
  const view = $('#ptAppointmentsView');
  view.innerHTML = '<div class="p-card">' + '<div class="skel" style="height:120px"></div>'.repeat(3) + '</div>';
  let apptsData = null; // يفضل متاح خارج try عشان handlers بتستخدمه
  try {
    const { data, error } = await DB.sb.rpc('patient_portal_appointments', { p_token: token });
    if (token !== Portal.token) return;
    if (error) throw error;
    if (!data.ok) { toast(data.error || 'تعذّر تحميل المواعيد', 'error'); return; }
    apptsData = data;

    const c = Portal.data.clinic, p = Portal.data.patient;
    const up = data.upcoming || [], past = data.past || [];

    // حالات واضحة للمريض
    const stShort = { pending: 'بانتظار تأكيد', confirmed: 'مؤكد', done: 'تمت', cancelled: 'ملغي' };
    const stCls = { pending: 'amber', confirmed: 'teal', done: 'green', cancelled: 'rose' };
    const statusClass = status => Object.prototype.hasOwnProperty.call(stCls, status) ? stCls[status] : 'gray';
    const statusLabel = status => esc(Object.prototype.hasOwnProperty.call(stShort, status) ? stShort[status] : status);

    view.innerHTML =
      '<div class="p-hero" style="align-items:flex-start;gap:11px;margin-bottom:2px">' +
        '<i class="fa-solid fa-calendar-check" style="font-size:22px;color:#16a34a;margin-top:6px"></i>' +
        '<div><h2 style="font-size:21px;font-weight:900">مواعيدك</h2><p class="p-small">القادمة بالترتيب، وقديمها تحت للمراجعة</p></div>' +
      '</div>' +

      (up.length ? up.map(a =>
        '<div class="p-card" style="padding:16px">' +
          '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
            '<div style="flex:1;min-width:140px">' +
              '<b style="font-size:16.5px;display:block">' + relDay(a.date) + '</b>' +
              '<div class="p-chips" style="margin-top:7px">' +
                '<span class="chip chip-' + statusClass(a.status) + '">' + statusLabel(a.status) + '</span>' +
                '<span class="chip chip-gray"><i class="fa-solid fa-clock"></i> ' + fmtTime(a.time) + '</span>' +
                '<span class="chip chip-gray"><i class="fa-solid fa-hourglass-half"></i> ' + (a.duration || 30) + ' دقيقة</span>' +
              '</div>' +
              '<p class="p-small" style="margin-top:6px">' + esc(a.type || 'جلسة') + '</p>' +
            '</div>' +
          '</div>' +
          (a.status !== 'cancelled'
            ? '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
              '<button class="btn btn-outline sm" data-ptwa="' + a.id + '" style="flex:1;color:#128c4b;justify-content:center"><i class="fa-brands fa-whatsapp"></i> كلّم العيادة</button>' +
              '<button class="btn btn-ghost sm" data-ptcancel="' + a.id + '" style="flex:1;color:#be123c;justify-content:center;background:var(--rose-soft)"><i class="fa-solid fa-ban"></i> إلغاء الموعد</button>' +
              '</div>'
            : '') +
        '</div>').join('')
      : '<div class="p-card"><div class="p-empty"><i class="fa-solid fa-calendar-xmark"></i><b>مفيش مواعيد قادمة حالياً</b>' +
        '<p class="p-small" style="margin-top:4px">عملت حجز؟ المواعيد اللي العيادة بتحجزهالك هتظهر هنا — أو كلّمنا واتساب</p></div></div>') +

      // القديمة
      (past.length
        ? '<p style="font-size:14px;font-weight:900;color:#2b5c3f;margin:16px 0 8px"><i class="fa-solid fa-clock-rotate-left"></i> آخر الزيارات والمواعيد</p>' +
          past.map(a =>
            '<div class="p-card" style="padding:13px 16px;margin-bottom:10px">' +
              '<div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">' +
                '<b style="font-size:14px;flex:1">' + esc(a.type || 'زيارة') + '</b>' +
                '<span class="chip chip-' + statusClass(a.status) + '" style="font-size:11.5px">' + statusLabel(a.status) + '</span>' +
                '<small class="muted" style="font-weight:700">' + humanDate(a.date) + ' — ' + fmtTime(a.time) + '</small>' +
              '</div>' +
              (a.note ? '<p style="font-size:13px;color:#3d5654;font-weight:600;margin-top:7px;line-height:1.7;background:#f6faf6;padding:9px 11px;border-radius:11px">' + esc(a.note) + '</p>' : '') +
              (a.status === 'cancelled' && a.cancel_reason ? '<p class="p-small" style="margin-top:6px;color:#be123c">سبب الإلغاء: ' + esc(a.cancel_reason) + '</p>' : '') +
            '</div>').join('')
        : '<p class="p-small" style="margin-top:14px;text-align:center">لسه مفيش زيارات سابقة مسجّلة — الزيارات بتتجمع هنا بمجرد ما تخلص كل جلسة</p>');
  } catch (e2) {
    if (token !== Portal.token) return;
    view.innerHTML = '<div class="p-card"><div class="p-empty"><b>تعذّر تحميل المواعيد</b><p class="p-small">حدّث الصفحة أو اسأل العيادة</p></div></div>';
  }

  // واتساب العيادة لأي موعد قادم
  $$('#ptAppointmentsView [data-ptwa]').forEach(b => {
    b.onclick = () => {
      const a = ((apptsData && apptsData.upcoming) || []).find(x => x.id === b.dataset.ptwa);
      if (!a) return;
      const message = 'أهلاً، أنا ' + Portal.data.patient.name + ' — معايا سؤال عن موعد يوم ' + relDay(a.date) + ' الساعة ' + fmtTime(a.time) + '.';
      openWA(Portal.data.clinic.phone, message);
    };
  });

  // الإلغاء مع التأكيد والسبب (المرحلة 17)
  $$('#ptAppointmentsView [data-ptcancel]').forEach(b => {
    b.onclick = async () => {
      const a = ((apptsData && apptsData.upcoming) || []).find(x => x.id === b.dataset.ptcancel);
      if (!a) return;
      openModal('إلغاء الموعد',
        '<p style="font-size:14px;font-weight:600;color:#3d5654;line-height:1.75;margin-bottom:12px">' +
          'متأكد إنك تلغي موعد <b>' + relDay(a.date) + ' الساعة ' + fmtTime(a.time) + '</b>؟<br>' +
          '<small>الدكتور هيستناك — لو فيه أي ظرف طارئ اكتب السبب علشان يقدر يحجزلك موعد جديد:</small></p>' +
        '<div class="field"><textarea class="input" id="ptCancelReason" rows="2" maxlength="200" placeholder="مثال: تعب صحي مفاجئ / مواصلات / ظرف طارئ..."></textarea></div>' +
        '<div class="modal-foot"><button class="btn btn-ghost" data-close>تراجع</button>' +
        '<button class="btn btn-danger" id="ptCancelConfirm"><i class="fa-solid fa-ban"></i> تأكيد الإلغاء</button></div>', 520);
      $('#ptCancelConfirm').onclick = async () => {
        const btn = $('#ptCancelConfirm'); btn.disabled = true;
        const { data: r } = await DB.sb.rpc('patient_portal_cancel', {
          p_token: Portal.token,
          p_appt: a.id,
          p_reason: $('#ptCancelReason').value.trim()
        });
        btn.disabled = false;
        if (r && r.ok) {
          toast('تم إلغاء الموعد — الدكتور عرف وأنشأ حجزتك متاحة لغيره');
          closeModal();
          portalRenderAppointments();
          // الـ home تنعش عشان كارت الموأ تتحدث فوراً
          Portal.load && Portal.load();
        } else {
          closeModal();
          toast(r && r.error ? r.error : 'تعذّر الإلغاء — كلّم العيادة', 'error');
        }
      };
    };
  });
}

