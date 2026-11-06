/**
 * ========================================
 * message-style.js
 * الوظيفة: أسلوب رسائل الواتساب (المرحلة 13): النبرات العربية/الرسمية/الإنجليزية/المختلطة، القوالب، التوقيع، الجمع واللف styleWrap/buildStyledMessage، وشاشة اختيار الأسلوب مع المعاينة الحية.
 * الدوال/الكيانات الرئيسية: MSG_STYLE_DEFAULT، TONE_AR، TONE_FORMAL، TONE_EN، TONE_MIXED، LANG_FOOTER، stripEmoji، getMsgStyle، collectMsgStyle، styleFooter، styleCtx، buildStyledMessage، styleWrap، openComposeWA …وغيرها
 * الاعتمادات: utils.js, state.js, db.js
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

const MSG_BRAND = (typeof APP_BRAND !== 'undefined' && APP_BRAND) || {};

/* ============================================================
   js/message-style.js — المرحلة 13: تخصيص أسلوب رسائل الواتساب
   ------------------------------------------------------------
   التدفق: قالب خام → تطبيق نبرة الدكتور → بيانات المريض الحقيقية
   → التوقيع/المعلومات الإضافية → رسالة نهائية قابلة للتعديل قبل
   الإرسال (وهو ما يجعل النبرة "مخصص بالكامل" تعمل يدوياً اليوم،
   وستستوعبها AI لاحقاً).
   ============================================================ */

const MSG_STYLE_DEFAULT = {
  tone: 'friendly', useEmoji: true,
  includeDoctorName: true, includeClinicName: true, includeClinicPhone: false,
  language: 'ar_egyptian', signature: '', customToneDescription: ''
};

const MSG_TONES = [
  { id: 'formal',      label: 'رسمي واحترافي',   icon: 'fa-user-tie',   sample: '«تحية طيبة، نود إعلامكم...»' },
  { id: 'friendly',    label: 'ودي وقريب',        icon: 'fa-face-smile', sample: '«أهلاً يا بطل، إيه الأخبار؟»' },
  { id: 'brief',       label: 'مختصر ومباشر',     icon: 'fa-bolt',       sample: '«موعدك يوم السبت 10 ص»' },
  { id: 'motivational',label: 'تحفيزي ومشجع',     icon: 'fa-fire',       sample: '«كمّل يا بطل، أنت على الطريق الصح!»' },
  { id: 'custom',      label: 'مخصص بالكامل',      icon: 'fa-pen-nib',    sample: '«عايز أكون أبوي وأبعته بدعاء في الآخر»' }
];

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
function stripEmoji(t) {
  return String(t || '').replace(EMOJI_RE, ' ').replace(/[ \t]+/g, ' ').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* قوالب عربية مصرية — كل نبرة × 3 أنواع رسالة */
const TONE_AR = {
  formal: {
    followup: d => `تحية طيبة للسيد/ة ${d.first}،\nنود الاطمئنان على سير برنامجكم العلاجي لهذا الأسبوع.\nنرجو الالتزام بالتعليمات والتمارين الموضوعة لكم.`,
    congrats: d => `تحية طيبة للسيد/ة ${d.first}،\nيسعدنا إعلامكم بأن وزنكم الحالي بلغ ${d.weight} كجم${d.diff ? ` — تحسّناً ملحوظاً بمقدار ${d.diff} كجم منذ البداية` : ''}.\nنرجو الاستمرار على نفس المنوال.`,
    reminder: d => `تحية طيبة للسيد/ة ${d.first}،\nنود تذكيركم بموعدكم يوم ${d.weekday} ${d.date} الساعة ${d.time}.\nيرجى الحضور قبل الموعد بعشر دقائق.`
  },
  friendly: {
    followup: d => `أهلاً يا ${d.first} 😊\nطمنّي عليك، إيه أخبار الأسبوع ده؟ ومتنساش تمارين الأسبوع ده.`,
    congrats: d => `أهلاً يا ${d.first} 😊\nيا بطل الوزن بقى ${d.weight} كجم!${d.diff ? ` فرق ${d.diff} كجم عن أول ما جيتلنا` : ''} 💪\nكمّل كده وهتوصل لهدفك في أقرب وقت إن شاء الله!`,
    reminder: d => `أهلاً يا ${d.first} 😊\nمتنساش موعدك يوم ${d.weekday} ${d.date} الساعة ${d.time} — مستنينك!`
  },
  brief: {
    followup: d => `${d.first}، إيه جديد الأسبوع ده؟ أرسلي تحديثاً سريعاً.`,
    congrats: d => `${d.first}، وزنك ${d.weight} كجم. تحسن ممتاز. كمّل.`,
    reminder: d => `${d.first}، موعدك يوم ${d.weekday} ${d.date} الساعة ${d.time}.`
  },
  motivational: {
    followup: d => `يا بطل يا ${d.first}! 🔥\nكل يوم التزام منك بيوصّلك أقرب لهدفك — طمنّي عليك، أنت على الطريق الصح!`,
    congrats: d => `يا بطل يا ${d.first}! 🔥🔥🔥\n${d.weight} كجم!! إنت كده حطيت قدمك على أول الطريق! فاكر لما جيتلنا أول مرة؟\nكمّل وأنا معاك خطوة بخطوة 💪💪`,
    reminder: d => `يا بطل ${d.first}! 💪\nموعدك يوم ${d.weekday} ${d.date} الساعة ${d.time} — حضورك التزام تجاه صحتك إنت!`
  }
  // 'custom' has NO canned text — the compose modal shows the doctor's own tone description instead
};

/* فصحى هادئة — الهيكل نفسه بصيغة فصيحة */
const TONE_FORMAL = {
  formal: {
    followup: d => `تحية طيبة للسيد/ة ${d.first}،\nنود الاطمئنان على سير البرنامج العلاجي لهذا الأسبوع.`,
    congrats: d => `تحية طيبة للسيد/ة ${d.first}،\nيسعدنا إبلاغكم بأن الوزن الحالي وصل ${d.weight} كجم${d.diff ? ` (تحسن ${d.diff} كجم)` : ''}.`,
    reminder: d => `تحية طيبة للسيد/ة ${d.first}،\nنذكّركم بموعدكم يوم ${d.weekday} ${d.date} ${d.time}.`
  },
  friendly: {
    followup: d => `مرحباً أستاذ/ة ${d.first}،\nكيف تسير الأمور؟ نود سماع جديدك هذا الأسبوع.`,
    congrats: d => `مرحباً أستاذ/ة ${d.first}،\nمبروك! الوزن أصبح ${d.weight} كجم. استمر في الالتزام، النتيجة تتحدث عن نفسها.`,
    reminder: d => `مرحباً أستاذ/ة ${d.first}،\nنتمنى تذكيركم بموعدكم يوم ${d.weekday} ${d.date} ${d.time}.`
  },
  brief: {
    followup: d => `السيد/ة ${d.first}، نأمل مشاركة تحديث أسبوعي.`,
    congrats: d => `السيد/ة ${d.first}، الوزن ${d.weight} كجم. تحسّن ملحوظ.`,
    reminder: d => `السيد/ة ${d.first}، الموعد: ${d.weekday} ${d.date} ${d.time}.`
  },
  motivational: {
    followup: d => `أستاذ/ة ${d.first}،\nكل أسبوع من الالتزام يقربك من الهدف أكثر. استمر، نحن فخورون بك.`,
    congrats: d => `أستاذ/ة ${d.first}،\nوصل الوزن إلى ${d.weight} كجم. خطوة ممتازة تستحق الإعجاب. كمّل بنفس العزيمة.`,
    reminder: d => `أستاذ/ة ${d.first}،\nنتطلع لرؤيتك يوم ${d.weekday} ${d.date} ${d.time}.`
  }
};

/* إنجليزية مختصرة ومقبولة إجتماعياً */
const TONE_EN = {
  followup: d => `Hello ${d.first}, just checking on your progress this week — how are you doing?`,
  congrats: d => `Hello ${d.first}, your current weight is ${d.weight} kg${d.diff ? ` — that's ${d.diff} kg down from where you started` : ''}. Well done, keep it up!`,
  reminder: d => `Hello ${d.first}, friendly reminder: your appointment is ${d.weekday}, ${d.date} at ${d.time}.`
};

/* عربي + إنجليزي مختلط بشكل طبيعي */
const TONE_MIXED = {
  followup: d => `أهلاً يا ${d.first} 😊 Weekly check-in — إيه الأخبار الأسبوع ده؟ Keep going 💪`,
  congrats: d => `أهلاً يا ${d.first} 😊 Mabrook! الوزن ${d.weight} kg${d.diff ? ` (${d.diff} kg down)` : ''} — Great progress!`,
  reminder: d => `Reminder 📅 موعدك يوم ${d.weekday} ${d.date} الساعة ${d.time} — See you there!`
};

/* عبارات التوقيع/الإلحاق بلغة الرسالة */
const LANG_FOOTER = {
  ar_egyptian: { phoneLabel: 'تواصل: ' },
  ar_formal:   { phoneLabel: 'للتواصل: ' },
  en:          { phoneLabel: 'Contact: ' },
  mixed:       { phoneLabel: 'تواصل Call: ' }
};

/**
 * getMsgStyle: current doctor's saved message style, merged with defaults.
 * Loaded once after login with the clinic settings (tenant isolation comes
 * free from the doctors row's RLS).
 */
function getMsgStyle() {
  return { ...MSG_STYLE_DEFAULT, ...(State.settings.messageStyle || {}) };
}

// Collect the form's current (possibly unsaved) values — used for the live preview
function collectMsgStyle() {
  return {
    tone: (document.querySelector('input[name="ms_tone"]:checked') || {}).value || 'friendly',
    useEmoji: $('#ms_emoji').checked,
    includeDoctorName: $('#ms_doc').checked,
    includeClinicName: $('#ms_clinic').checked,
    includeClinicPhone: $('#ms_phone').checked,
    language: $('#ms_lang').value,
    signature: $('#ms_sign').value.trim().slice(0, 200),
    customToneDescription: $('#ms_custom').value.trim().slice(0, 500)
  };
}

// Footer lines: doctor / clinic / phone / free signature
function styleFooter(ms, d) {
  const names = [];
  if (ms.includeDoctorName && d.doctor) names.push(d.doctor);
  if (ms.includeClinicName && d.clinic) names.push(d.clinic);
  let f = names.join(' — ');
  if (ms.includeClinicPhone && d.phone) f += (f ? '\n' : '') + (LANG_FOOTER[ms.language] || LANG_FOOTER.ar_egyptian).phoneLabel + d.phone;
  if (ms.signature) f += (f ? '\n' : '') + ms.signature;
  return f ? '\n\n' + f : '';
}

function styleCtx() {
  const s = State.settings;
  return { doctor: s.doctorName || '', clinic: s.clinicName || '', phone: s.phone || '' };
}

/* The core engine: tonality → language table → extra content → footer → emoji rule */
function buildStyledMessage(type, dataWithCtx, extra) {
  const ms = getMsgStyle();
  const d = { ...styleCtx(), ...dataWithCtx };
  const table = ms.language === 'en' ? TONE_EN : ms.language === 'mixed' ? TONE_MIXED : ms.language === 'ar_formal' ? TONE_FORMAL : TONE_AR;
  const toneKey = (ms.tone === 'custom') ? 'friendly' : ms.tone; // custom starts from the friendly baseline for manual editing
  const body = table[toneKey][type](d);
  let out = body + (extra || '') + styleFooter(ms, d);
  if (!ms.useEmoji) out = stripEmoji(out);
  return out;
}

// Same footer/emoji rule applied to any raw body (e.g. plan body)
function styleWrap(body) {
  const ms = getMsgStyle();
  let t = body + styleFooter(ms, styleCtx());
  if (!ms.useEmoji) t = stripEmoji(t);
  return t;
}

/* ===== المرحلة 13: مودال التأليف — المعاينة القابلة للتعديل للإرسال الفعلي ===== */
function openComposeWA(phone, builtText, opts = {}) {
  // (بند 14) مفيش بيانات صحية تخرج على واتساب بدون موافقة موثقة من المريض:
  // كل رسائل الدكتور بتمر من هنا بـopts.pid — البوابة (مريض بيكلم العيادة)
  // بتستخدم openWA مباشرة وما بتعديش على البوابة دي
  if (opts.pid) {
    const pt = getPatient(opts.pid);
    if (!pt || !pt.consentWa) {
      return toast('المريض ما وافقش على التواصل عبر واتساب — افتح ملفه وفعّل خيار الموافقة أولاً', 'error');
    }
  }
  const ms = getMsgStyle();
  openModal('رسالة واتساب — راجع قبل الإرسال',
    '<p class="muted" style="font-size:12.5px;font-weight:700;margin-bottom:12px">' +
      '<i class="fa-brands fa-whatsapp" style="color:#128c4b"></i> إلى: <b class="ltr">' + esc(normPhoneEG(phone)) + '</b> • النبرة: <b>' + (MSG_TONES.find(t => t.id === ms.tone) || {}).label + '</b></p>' +
    // WhatsApp-style preview bubble above the editable textarea
    '<div class="wa-bubble">' + esc(builtText) + '</div>' +
    (ms.tone === 'custom'
      ? '<div class="custom-tone-hint"><i class="fa-solid fa-pen-nib"></i> <b>نبرتك المخصصة:</b> «' + esc(ms.customToneDescription || '') + '»<br><small>عدّل الرسالة يدوياً بالأسفل لتطابق أسلوبك (حتى نضيف الذكاء الاصطناعي لاحقاً).</small></div>'
      : '') +
    '<div style="margin-top:12px"><b style="font-size:13px;font-weight:800">النص النهائي (قابل للتعديل):</b>' +
    '<textarea class="input" id="cmpText" rows="8" style="margin-top:7px;resize:vertical">' + esc(builtText) + '</textarea></div>' +
    '<div class="modal-foot"><button class="btn btn-ghost" data-close>إلغاء</button>' +
    '<button class="btn btn-primary" id="cmpSend"><i class="fa-brands fa-whatsapp"></i> فتح واتساب بالنص ده</button></div>', 620);

  $('#cmpSend').onclick = () => {
    const finalText = $('#cmpText').value.trim();
    if (!finalText) return toast('اكتب الرسالة أولاً', 'error');
    openWA(phone, finalText);
    // Audit: every send action is traceable (no message body is logged)
    DB.audit('export', 'patients', opts.pid || null, { scope: 'whatsapp', type: opts.type || 'generic' });
    closeModal();
    toast('فتحنا واتساب — الرسالة جاهزة للإرسال من هناك');
  };
}

/* ===== المعاينة الحية في الإعدادات ===== */
function pvData(style) {
  return {
    first: 'أحمد', weight: '85', diff: '7',
    weekday: 'السبت', date: '15 نوفمبر', time: '5:30 م',
    doctor: State.settings.doctorName || MSG_BRAND.doctor || 'الدكتور',
    clinic: State.settings.clinicName || MSG_BRAND.clinic || 'عيادتي',
    phone: State.settings.phone || '01xxxxxxxxx'
  };
}

// Render the three live examples with the current (unsaved) form state
function renderMsgPreviews(style) {
  const ms = style;
  const d = pvData(ms);
  const base = { ...d };
  const wData = { ...base };
  const aData = { ...base };

  const make = (type, extra) => {
    const table = ms.language === 'en' ? TONE_EN : ms.language === 'mixed' ? TONE_MIXED : ms.language === 'ar_formal' ? TONE_FORMAL : TONE_AR;
    const toneKey = (ms.tone === 'custom') ? 'friendly' : ms.tone;
    let b = table[toneKey][type](base) + (extra || '') + styleFooter(ms, d);
    return ms.useEmoji ? b : stripEmoji(b);
  };

  $('#pvFollow').innerHTML = '<div class="wa-bubble">' + esc(make('followup')) + '</div>';
  $('#pvCongrats').innerHTML = '<div class="wa-bubble">' + esc(make('congrats')) + '</div>';
  $('#pvReminder').innerHTML = '<div class="wa-bubble">' + esc(make('reminder')) + '</div>';

  // Custom tone hint visible only when custom is chosen
  $('#customToneHint').style.display = ms.tone === 'custom' ? 'block' : 'none';
}

// Build the settings card once (only in the doctor's settings view)
function ensureMsgStyleUI() {
  if (document.getElementById('msWrap')) return;
  const host = document.querySelector('#view-settings .set-grid');
  if (!host) return;
  host.insertAdjacentHTML('afterend',
    '<div class="grid-2" style="margin-top:18px" id="msWrap">' +
      // Left: choices
      '<div class="card">' +
        '<div class="card-head"><h3><i class="fa-brands fa-whatsapp" style="color:#128c4b"></i> أسلوب رسائل الواتساب</h3></div>' +

        '<div style="margin-bottom:16px">' +
          '<b style="font-size:13.5px;font-weight:800;display:block;margin-bottom:10px">اختر نبرة الرسالة:</b>' +
          '<div class="tone-grid">' +
            MSG_TONES.map(t =>
              '<label class="tone-opt"><input type="radio" name="ms_tone" value="' + t.id + '">' +
              '<i class="fa-solid ' + t.icon + '"></i><b>' + t.label + '</b><small>' + t.sample + '</small></label>'
            ).join('') +
          '</div>' +
          '<div id="customToneHint" class="custom-tone-hint" style="display:none;margin-top:10px">' +
            '<i class="fa-solid fa-pen-nib"></i> <b>اكتب أسلوبك بالتفصيل</b> — وسيبدأ كل قالب ودي جاهز للتعديل اليدوي قبل الإرسال:' +
            '<textarea class="input" id="ms_custom" maxlength="500" rows="2" style="margin-top:8px" placeholder="مثال: أنا بحب أكون أبوي، بستخدم «يا حبيبي» وأضيف دعاء في آخر كل رسالة"></textarea>' +
          '</div>' +
        '</div>' +

        '<div class="field-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          '<label class="tone-toggle"><input type="checkbox" id="ms_emoji" checked> إيموجي في الرسائل؟</label>' +
          '<label class="tone-toggle"><input type="checkbox" id="ms_doc" checked> إضافة اسم الدكتور؟</label>' +
          '<label class="tone-toggle"><input type="checkbox" id="ms_clinic" checked> إضافة اسم العيادة؟</label>' +
          '<label class="tone-toggle"><input type="checkbox" id="ms_phone"> إضافة رقم العيادة؟</label>' +
        '</div>' +

        '<div class="form-grid" style="margin-top:12px">' +
          '<div class="field"><label>لغة الرسالة</label><select class="input" id="ms_lang">' +
            '<option value="ar_egyptian">عامي مصري (فطري)</option>' +
            '<option value="ar_formal">عربي فصحى مهذب</option>' +
            '<option value="en">English</option>' +
            '<option value="mixed">عربي + English مختلط</option>' +
          '</select></div>' +
          '<div class="field"><label>التوقيع الثابت (اختياري — يظهر في آخر كل رسالة)</label>' +
            '<input class="input" id="ms_sign" maxlength="200" placeholder="مثال: صحتك أمانة — د. محمد"></div>' +
        '</div>' +

        '<button class="btn btn-primary block" id="msSave" style="margin-top:16px"><i class="fa-solid fa-check"></i> حفظ النبرة والإعدادات</button>' +
      '</div>' +

      // Right: live preview of the three core message types
      '<div class="card">' +
        '<div class="card-head"><h3><i class="fa-solid fa-eye"></i> معاينة حية</h3><span class="chip chip-green"><i class="fa-brands fa-whatsapp"></i> بيانات مريض وهمية</span></div>' +
        '<p class="muted" style="font-size:12.5px;font-weight:600;margin-bottom:2px">بيانات المثال: المريض «أحمد»، آخر وزن 85 كجم، نزل 7 كجم، موعد السبت 15 نوفمبر 5:30 م</p>' +

        '<div class="pv-title">متابعة أسبوعية</div><div id="pvFollow"></div>' +
        '<div class="pv-title">تهنئة بنزول الوزن</div><div id="pvCongrats"></div>' +
        '<div class="pv-title">تذكير بموعد</div><div id="pvReminder"></div>' +
      '</div>' +
    '</div>');

  // Any input/change re-renders previews instantly from the CURRENT choices
  const live = () => {
    const cur = collectMsgStyle();
    renderMsgPreviews(cur);
  };
  $('#msWrap').addEventListener('input', live);
  $('#msWrap').addEventListener('change', live);

  // Restore saved values into the controls then render previews
  const saved = getMsgStyle();
  const radio = document.querySelector('input[name="ms_tone"][value="' + saved.tone + '"]') || document.querySelector('input[name="ms_tone"][value="friendly"]');
  if (radio) radio.checked = true;
  $('#ms_emoji').checked = saved.useEmoji;
  $('#ms_doc').checked = saved.includeDoctorName;
  $('#ms_clinic').checked = saved.includeClinicName;
  $('#ms_phone').checked = saved.includeClinicPhone;
  $('#ms_lang').value = saved.language;
  $('#ms_sign').value = saved.signature;
  $('#ms_custom').value = saved.customToneDescription;

  // Save: merge into the clinic settings row (this is a doctors row edit, audited by saveSettings)
  $('#msSave').onclick = async () => {
    const btn = $('#msSave'); btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ الحفظ...</span>';
    const fresh = collectMsgStyle();
    try {
      State.settings.messageStyle = fresh;
      await DB.saveSettings(State.settings);   // writes settings JSONB + audited as edit on doctors
      toast('تم حفظ أسلوب رسائل الواتساب');
      renderMsgPreviews(fresh);                 // reflect even if the doctor hasn't saved yet
    } catch (e) {
      toast('تعذّر الحفظ — ' + explainError(e), 'error');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i><span>حفظ النبرة والإعدادات</span>';
  };

  renderMsgPreviews(saved);
}

