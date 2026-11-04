/**
 * ========================================
 * reset.js
 * الوظيفة: صفحة استقبال رابط استعادة كلمة المرور (مستقلة عن shell التطبيق):
 *          تقرأ جلسة الاستعادة من الرابط، تتحقق منها، وتحفظ كلمة المرور الجديدة عبر Supabase Auth.
 * الدوال/الكيانات الرئيسية: ClinicReset.createRecoveryController
 * الاعتمادات: config.js (supabaseConfig + SUPABASE_READY) + مكتبة supabase-js UMD
 * ملاحظة أمنية: لا تُسجَّل الرموز ولا تُعرض، وتُمسح من العنوان بعد المعالجة،
 *              وتُنهى الجلسة بعد الحفظ (الدخول الطبيعي يظل محميًا بـ MFA).
 * ========================================
 */
'use strict';

(function () {
  const MIN_PASSWORD_LENGTH = 8; // نفس حد تسجيل الحساب الجديد في main.js

  function createRecoveryController(deps) {
    const sb = deps.sb;
    const doc = deps.doc;
    const loc = deps.loc;
    const hist = deps.hist;
    const minLength = deps.minLength || MIN_PASSWORD_LENGTH;
    const $ = sel => doc.querySelector(sel);

    const form = $('#recoveryForm');
    const errorBox = $('#recoveryError');
    const okBox = $('#recoveryOk');
    const okText = $('#recoveryOkText');
    const statusBox = $('#recoveryStatus');
    const helpBox = $('#recoveryHelp');

    const state = { ready: false, done: false, submitting: false };

    function setStatus(text) {
      if (!statusBox) return;
      statusBox.textContent = text;
      statusBox.classList.remove('hide');
    }
    function clearStatus() { if (statusBox) statusBox.classList.add('hide'); }
    function showError(text) {
      if (errorBox) { errorBox.textContent = text; errorBox.classList.add('show'); }
      if (okBox) okBox.style.display = 'none';
    }
    function clearError() {
      if (errorBox) { errorBox.textContent = ''; errorBox.classList.remove('show'); }
    }
    function showHelp() { if (helpBox) helpBox.classList.remove('hide'); }
    function hideHelp() { if (helpBox) helpBox.classList.add('hide'); }
    function cleanUrl() {
      if (!hist || typeof hist.replaceState !== 'function') return;
      try { hist.replaceState(null, '', loc.pathname); } catch (_) { /* storage/history may be restricted */ }
    }

    function enable() {
      if (state.ready || state.done) return;
      state.ready = true;
      clearStatus(); clearError(); hideHelp();
      if (form) form.classList.remove('hide');
      const first = $('#recoveryPass');
      if (first && first.focus) first.focus();
    }

    function fail(text) {
      state.ready = false;
      clearStatus(); showError(text); showHelp();
      if (form) form.classList.add('hide');
      cleanUrl();
    }

    function succeed(text) {
      state.done = true;
      clearStatus(); clearError();
      if (form) form.classList.add('hide');
      if (okText) okText.textContent = text;
      if (okBox) okBox.style.display = 'flex';
      showHelp();
    }

    function serverMessage(error) {
      const msg = error && error.message ? String(error.message) : '';
      if (/expired|invalid|token|session/i.test(msg)) return 'انتهت صلاحية رابط الاستعادة — اطلب رابطًا جديدًا من صفحة الدخول.';
      if (/weak|password|short/i.test(msg)) return 'كلمة المرور ضعيفة — استخدم 8 أحرف على الأقل.';
      // لا نعرض رسالة الخادم الخام (قد تحتوي تفاصيل تقنية غير مناسبة للمستخدم)
      return 'تعذّر حفظ كلمة المرور — حاول مرة أخرى أو اطلب رابطًا جديدًا.';
    }

    async function submit(password, confirmation) {
      if (!state.ready || state.done || state.submitting || !sb) return { ok: false, reason: 'not-ready' };
      if (typeof password !== 'string' || password.length < minLength) {
        showError('كلمة المرور لازم تكون 8 أحرف على الأقل.');
        return { ok: false, reason: 'short' };
      }
      if (password !== confirmation) {
        showError('كلمتا المرور غير متطابقتين — أعد كتابتهما.');
        return { ok: false, reason: 'mismatch' };
      }
      state.submitting = true;
      try {
        const { error } = await sb.auth.updateUser({ password: password });
        if (error) {
          showError(serverMessage(error));
          return { ok: false, reason: 'server' };
        }
        succeed('تم تغيير كلمة المرور بنجاح. سجّل الدخول من جديد بكود التحقق بخطوتين.');
        // جلسة الاستعادة aal1 لا تصلح لتشغيل التطبيق؛ ننهيها بعد الحفظ.
        try { await sb.auth.signOut(); } catch (_) { /* الخروج best-effort */ }
        cleanUrl();
        return { ok: true };
      } catch (_) {
        showError('تعذّر الاتصال بالخادم — تحقق من الإنترنت وحاول مرة أخرى.');
        return { ok: false, reason: 'network' };
      } finally {
        state.submitting = false;
      }
    }

    async function init() {
      const search = String(loc.search || '');
      const hash = String(loc.hash || '');
      const params = new URLSearchParams(search);

      // Supabase يرسل الروابط المنتهية/المستخدمة كـ ?error=...&error_code=...
      if (params.get('error') || params.get('error_description') || params.get('error_code')) {
        fail('انتهت صلاحية رابط الاستعادة أو استُخدم بالفعل — اطلب رابطًا جديدًا من صفحة الدخول.');
        return { state: 'invalid' };
      }

      const code = params.get('code'); // مسار PKCE
      let exchanged = false;
      if (code) {
        try {
          const { error } = await sb.auth.exchangeCodeForSession(code);
          if (error) {
            fail('تعذّر تأكيد رابط الاستعادة — اطلب رابطًا جديدًا.');
            return { state: 'invalid' };
          }
          exchanged = true;
        } catch (_) {
          fail('تعذّر تأكيد رابط الاستعادة — تحقق من الاتصال واطلب رابطًا جديدًا.');
          return { state: 'invalid' };
        }
      }

      const recoveryHash = /type=recovery/.test(hash); // مسار implicit
      if (!code && !recoveryHash) {
        fail('هذه الصفحة مخصصة لرابط استعادة كلمة المرور فقط — اطلب رابطًا جديدًا من صفحة الدخول.');
        return { state: 'invalid' };
      }

      try {
        sb.auth.onAuthStateChange(event => {
          if (!state.done && (event === 'PASSWORD_RECOVERY' || (exchanged && event === 'SIGNED_IN'))) {
            enable();
            cleanUrl();
          }
        });
      } catch (_) { /* getSession أدناه هو المسار البديل */ }

      try {
        const { data, error } = await sb.auth.getSession();
        if (!error && data && data.session) {
          enable();
          cleanUrl();
          return { state: 'ready' };
        }
      } catch (_) { /* ننتظر حدث PASSWORD_RECOVERY */ }

      setStatus('جارٍ تأكيد جلسة الاستعادة…');
      return { state: 'pending' };
    }

    return { init, submit, enable, fail, succeed, state };
  }

  const api = { createRecoveryController: createRecoveryController, MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH };
  if (typeof window !== 'undefined') window.ClinicReset = api;

  // الإقلاع الحقيقي في المتصفح فقط؛ الاختبارات تستخدم createRecoveryController مباشرة.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', () => {
      const form = document.querySelector('#recoveryForm');
      if (!form) return;

      let sb = null;
      if (typeof SUPABASE_READY !== 'undefined' && SUPABASE_READY && window.supabase) {
        sb = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
          auth: { detectSessionInUrl: true }
        });
      }

      const controller = createRecoveryController({
        sb: sb, doc: document, loc: window.location, hist: window.history
      });

      if (!sb) {
        controller.fail('تعذّر تحميل مكتبة Supabase أو إعدادات المشروع — حدّث الصفحة أو اطلب رابطًا جديدًا.');
        return;
      }

      form.addEventListener('submit', ev => {
        ev.preventDefault();
        const p1 = document.querySelector('#recoveryPass');
        const p2 = document.querySelector('#recoveryPass2');
        controller.submit(p1 ? p1.value : '', p2 ? p2.value : '');
      });

      controller.init();
    });
  }
})();
