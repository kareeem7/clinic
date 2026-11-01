/**
 * ========================================
 * settings.js
 * الوظيفة: عرض شاشة إعدادات العيادة (الاسم، التخصص، التليفون، السعر، العنوان) وربط نموذج الحفظ.
 * الدوال/الكيانات الرئيسية: renderSettings
 * الاعتمادات: state.js, db.js, utils.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/settings.js — الإعدادات وحالة النظام
   ============================================================ */
function renderSettings() {
  const s = State.settings;
  $('#setClinic').value = s.clinicName || ''; $('#setDoctor').value = s.doctorName || '';
  $('#setPhone').value = s.phone || ''; $('#setPrice').value = s.price || ''; $('#setAddress').value = s.address || '';

  // Message-style card: build once, fill with saved styles, live preview engine
  ensureMsgStyleUI();

  // (بند 32) حالة اتصال حقيقية: فحص فعلي لنقطة صحة Supabase بدل نص ثابت
  // — الشاشة ما تقولش «متصل» والاتصال واقع أو المفتاح ناقص
  const host = supabaseConfig.url.replace('https://', '').split('/')[0];
  const acc = s.account || {};
  $('#fbStatus').innerHTML =
    '<div class="sys-row"><i id="supaStatusIcon" style="background:var(--teal-50);color:var(--teal-700)" class="fa-solid fa-bolt"></i>' +
      '<div style="flex:1"><b id="supaStatus">Supabase — جارٍ فحص الاتصال…</b><small>' + esc(host) + ' — بياناتك في Postgres ومعزولة بحسابك عبر سياسات RLS</small></div></div>' +
    '<div class="sys-row"><i style="background:var(--teal-50);color:var(--teal-700)" class="fa-solid fa-shield-halved"></i>' +
      '<div style="flex:1"><b>العزل والسجلات نشطة</b><small>حذف ناعم + سجل تدقيق إلزامي + تحقق بخطوتين</small></div></div>' +
    (acc.status ? '<div class="sys-row"><i style="background:var(--blue-soft);color:var(--blue)" class="fa-solid fa-credit-card"></i>' +
      '<div style="flex:1"><b>' + (acc.status === 'active' ? 'اشتراك نشط حتى ' + humanDate(acc.endsAt || '') : acc.status === 'suspended' ? 'الحساب معلّق' : 'فترة تجريبية') + '</b></div></div>' : '');
    // archive entry point lives in the "البيانات" card — single place, no duplicates

  // (بند 32) الفحص الفعلي يشتغل بعد الرسم — النص واللون يتحدثوا حسب النتيجة الحقيقية
  DB.healthProbe().then(st => {
    const b = document.getElementById('supaStatus'), ic = document.getElementById('supaStatusIcon');
    if (!b) return; // المستخدم غادر شاشة الإعدادات قبل ما الفحص يخلص
    b.textContent = 'Supabase ' + st.label;
    if (ic) {
      ic.style.background = st.ok ? 'var(--green-soft)' : 'var(--rose-soft, #fee2e2)';
      ic.style.color = st.ok ? 'var(--green)' : 'var(--rose)';
    }
  }).catch(() => { /* healthProbe محمية داخلياً — ما تسقطش الشاشة */ });
}

