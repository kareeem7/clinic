/**
 * ========================================
 * export.js
 * الوظيفة: النسخ الاحتياطية المشفرة (AES-256-GCM + PBKDF2): تصدير بيانات العيادة مشفرة بكلمة سر، أداة فك التشفير، ونسخة المنصة للأدمن — مع helpers الترميز base64.
 * الدوال/الكيانات الرئيسية: bufToB64، b64ToBytes، downloadTextFile
 * الاعتمادات: utils.js, state.js, db.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/export.js — نسخة احتياطية JSON
   ============================================================ */
/* ===== (بند 14) نسخ احتياطية مشفّرة =====
   البيانات الصحية ما تخرجش من الجهاز في ملف JSON مكشوف:
   AES-256-GCM بمفتاح مشتق من كلمة سر الدكتور (PBKDF2-SHA256، 210 ألف
   دورة، salt عشوائي). صيغة الملف: {format, salt, iv, data} بـbase64. */
function bufToB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(str) {
  const bin = atob(str); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function deriveBackupKey(pass, salt) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: 210000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptBackupEnvelope(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(pass, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key,
    new TextEncoder().encode(JSON.stringify(obj, null, 2)));
  return { format: 'clinic-backup-enc-v1', salt: bufToB64(salt), iv: bufToB64(iv), data: bufToB64(ct) };
}
function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  a.click(); URL.revokeObjectURL(a.href);
}

async function exportBackup() {
  if (!(window.crypto && window.crypto.subtle)) {
    toast('التشفير مش متاح في المتصفح ده (محتاج HTTPS أو localhost) — التصدير اتلغى حمايةً للبيانات', 'error');
    return;
  }
  const pass = await promptDlg('تشفير النسخة الاحتياطية',
    'اختر كلمة سر قوية لتشفير الملف — الملف يحتوي بيانات مرضى. <b>تحذير: لو ضاعت كلمة السر النسخة مش هتترجع أبداً.</b>',
    'كلمة سر التشفير');
  if (!pass) return;
  if (pass.length < 8) return toast('كلمة السر لازم 8 أحرف على الأقل — التصدير ما حصلش', 'error');
  try {
    // (بند 31) النسخة الاحتياطية كاملة من السيرفر مباشرة (كل الصفوف + كل القياسات)
    // — مش من الذاكرة اللي بقت مرقّمة ومؤقتة — النسخة أمانة ولازم تبقى كاملة
    const dump = await DB.dumpAll();
    const env = await encryptBackupEnvelope({ exportedAt: new Date().toISOString(), settings: State.settings,
      patients: dump.patients, appointments: dump.appointments, notes: dump.notes, plans: dump.plans }, pass);
    downloadTextFile(JSON.stringify(env), 'clinic-backup-' + todayISO() + '.enc.json');
    toast('تم تنزيل النسخة الاحتياطية مشفّرة — احتفظ بكلمة السر في مكان منفصل وآمن');
    // Audit the export — requirement: every export is tracked without PHI
    DB.audit('export', 'patients', null, { scope: 'clinic-backup', count: dump.patients.length, encrypted: true });
  } catch (e) {
    logError(e, 'export.encrypt');
    toast('فشل التصدير المشفّر — ' + explainError(e), 'error');
  }
}

// فك تشفير نسخة احتياطية → تنزيل JSON صريح (على أي جهاز فيه نفس النظام)
async function decryptBackup() {
  if (!(window.crypto && window.crypto.subtle)) return toast('التشفير مش متاح في المتصفح ده — الفك مش ممكن', 'error');
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const env = JSON.parse(await file.text());
      if (!env || env.format !== 'clinic-backup-enc-v1') return toast('ملف مش معروف — اختار نسخة احتياطية مشفّرة (.enc.json) من النظام ده', 'error');
      const pass = await promptDlg('فك تشفير النسخة', 'اكتب كلمة السر المستخدمة وقت التصدير', 'كلمة السر');
      if (!pass) return;
      const key = await deriveBackupKey(pass, b64ToBytes(env.salt));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, key, b64ToBytes(env.data));
      downloadTextFile(new TextDecoder().decode(plain), file.name.replace(/\.enc\.json$/, '') + '.decrypted.json');
      toast('تم فك التشفير وتنزيل الملف الصريح — احذفه من الجهاز بعد الاستخدام');
      DB.audit('export', 'patients', null, { scope: 'backup-decrypt' });
    } catch (e) {
      toast('فك التشفير فشل — كلمة السر غلط أو الملف تالف', 'error');
    }
  };
  input.click();
}

