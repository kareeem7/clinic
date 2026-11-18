/**
 * ========================================
 * js/lang-en.js
 * الوظيفة: القاموس الإنجليزي. المفتاح هو النص العربي بالحرف زي ما هو في الكود
 *   أو في index.html — فأي مفتاح غلط ما بيتترجمش وبيبان عربي، وده بيخلي
 *   الخطأ مرئي بدل ما يعدّي صامت.
 *   الملف بيقفّل نفسه في I18N في آخر سطر، فترتيب التحميل: i18n.js ← lang-en.js.
 * الاعتمادات: i18n.js
 * آخر تعديل: 2026-11-18 — الدفعة الأولى: الدخول، التسجيل، الاستعادة، 2FA،
 *   لوحة التحكم، التنقل، ورسائل المصادقة.
 * ========================================
 */
'use strict';

const I18N_EN = {

  /* ── العلامة والواجهة التعريفية ─────────────────────────────────────── */
  'عيادتي': 'My Clinic',
  'نظام متكامل لإدارة عيادات العلاج الطبيعي والسمنة والنحافة — مرضاك، مواعيدك، وخططك الغذائية في مكان واحد':
    'A clinic system for physiotherapy, weight management and nutrition — patients, appointments and meal plans in one place.',
  'ملفات مرضى كاملة مع منحنيات تطور الوزن والجلسات':
    'Complete patient files with weight and session trends',
  'حجز المواعيد وتأكيدها بضغطة واتساب':
    'Book and confirm appointments with one WhatsApp tap',
  'مكتبة خطط تغذية جاهزة للربط بالمرضى':
    'A library of ready nutrition plans to assign to patients',
  'تقارير وإحصائيات شهرية عن العيادة':
    'Monthly clinic reports and statistics',
  'من أي جهاز، حتى مع ضعف النت':
    'Works on any device, even on a weak connection',

  /* ── شاشة الدخول ───────────────────────────────────────────────────── */
  'تسجيل الدخول': 'Sign in',
  'حساب جديد': 'New account',
  'أهلاً بعودتك يا دكتور': 'Welcome back, doctor',
  'سجّل دخولك لإدارة عيادتك': 'Sign in to manage your clinic',
  'البريد الإلكتروني': 'Email',
  'كلمة المرور': 'Password',
  'نسيت كلمة المرور؟': 'Forgot your password?',
  'دخول': 'Sign in',
  'دخول ديمو — عيادة جاهزة ببياناتها': 'Open the demo — a clinic already filled in',
  'حساب عرض تجريبي. البيانات وهمية، وأي تعديل فيها ما بيأثرش على عيادة حقيقية.':
    'A demo account. The data is synthetic and edits cannot touch a real clinic.',
  'دخول إدارة النظام': 'Platform admin',
  'أنت مريض؟ دخول بوابة المرضى': 'A patient? Open the patient portal',

  /* ── بوابة المريض (شاشة الدخول) ─────────────────────────────────────── */
  'بوابة المرضى': 'Patient portal',
  'أهلاً بيك!': 'Welcome',
  'أدخل رقم الموبايل المسجّل في العيادة والكود اللي استلمته من العيادة':
    'Enter the phone number registered at the clinic and the code they gave you',
  'رقم الموبايل (اللي الدكتور سجّله)': 'Phone number (as registered by the doctor)',
  'كود الدخول (من العيادة)': 'Access code (from the clinic)',
  'الكود مكتوب في كارت العيادة، وبيظهر لك دايماً جوّه البوابة عشان تفضل فاكره. ما تشاركهوش مع حد.':
    'Your code is on the clinic card and stays visible in the portal so you do not lose it. Do not share it.',
  'دخول بوابة المرضى': 'Open the patient portal',

  /* ── إنشاء حساب ────────────────────────────────────────────────────── */
  'إنشاء حساب دكتور': 'Create a doctor account',
  'حساب خاص بك — بيانات مرضاك لا يصل إليها أحد غيرك':
    'Your own account — nobody else can reach your patients',
  'اسم الدكتور *': 'Doctor name *',
  'التخصص': 'Specialty',
  'علاج طبيعي + سمنة ونحافة': 'Physiotherapy + weight management',
  'علاج طبيعي فقط': 'Physiotherapy only',
  'سمنة وتغذية علاجية فقط': 'Weight management and clinical nutrition only',
  'اسم العيادة': 'Clinic name',
  'البريد الإلكتروني *': 'Email *',
  'كلمة المرور * (8 أحرف على الأقل)': 'Password * (8 characters minimum)',
  'تأكيد كلمة المرور *': 'Confirm password *',
  'إنشاء الحساب': 'Create account',
  'الاسم الكامل': 'Full name',
  'اسم العيادة أو المركز': 'Clinic or centre name',

  /* ── استعادة كلمة المرور ───────────────────────────────────────────── */
  'استعادة كلمة المرور': 'Reset your password',
  'اكتب بريدك المسجّل وسيصلك رابط إعادة التعيين فوراً':
    'Enter your registered email and a reset link will arrive shortly',
  'البريد الإلكتروني المسجّل': 'Registered email',
  'إرسال رابط الاستعادة': 'Send reset link',

  /* ── إدارة النظام ──────────────────────────────────────────────────── */
  'مقصور على إدارة المنصة — كل عملية دخول مُسجَّلة':
    'Platform operators only — every sign-in is logged',
  'هذه البوابة للمشغّل فقط، وتتطلب حساباً مسجلاً في جدول superadmins + تحقق بخطوتين':
    'Operator area: requires a row in superadmins plus two-factor verification',
  'البريد الإلكتروني للإدارة': 'Admin email',
  'دخول الإدارة': 'Admin sign-in',

  /* ── التحقق بخطوتين ────────────────────────────────────────────────── */
  'حماية حسابك بطبقة ثانية': 'A second layer of protection',
  'التحقق بخطوتين': 'Two-factor verification',
  'الصق الرمز السري يدوياً إن تعذّر مسح الكود — Google Authenticator / Microsoft Authenticator / 1Password':
    'Paste the secret manually if you cannot scan the code — Google Authenticator / Microsoft Authenticator / 1Password',
  'كود التحقق (6 أرقام)': 'Verification code (6 digits)',
  'تأكيد ودخول': 'Confirm and sign in',
  'رجوع — إلغاء الدخول': 'Back — cancel sign-in',

  /* ── التنقل ────────────────────────────────────────────────────────── */
  'الرئيسية': 'Dashboard',
  'المرضى': 'Patients',
  'المواعيد': 'Appointments',
  'خطط التغذية': 'Nutrition plans',
  'الإعدادات': 'Settings',
  'الدكاترة والعيادات': 'Doctors and clinics',
  'إعدادات النظام': 'System settings',

  /* ── الشريط الجانبي ────────────────────────────────────────────────── */
  'حساب الدكتور': 'Doctor account',
  'مريض جديد': 'New patient',
  'وضع الإدارة': 'Admin mode',
  'اسم العيادة قيد التحميل': 'Clinic name loading',
  'اسم الدكتور قيد التحميل': 'Doctor name loading',
  'الفرع الحالي': 'Current branch',
  'تسجيل الخروج': 'Sign out',
  'إضافة مريض جديد': 'Add a new patient',

  /* ── لوحة التحكم ───────────────────────────────────────────────────── */
  'الزيارات والجلسات — آخر 6 أشهر': 'Visits and sessions — last 6 months',
  'توزيع المرضى': 'Patient distribution',
  'مواعيد اليوم': "Today's appointments",
  'كل المواعيد': 'All appointments',
  'إجراءات سريعة': 'Quick actions',
  'إضافة مريض': 'Add patient',
  'حجز موعد': 'Book appointment',
  'خطة تغذية': 'Nutrition plan',
  'سجل المرضى': 'Patient record',
  'أحدث المرضى': 'Latest patients',
  'كل المرضى': 'All patients',
  'نصيحة اليوم: استخدم زر واتساب بجانب كل موعد لإرسال تذكير للمريض قبل موعده بيوم — يقلل الغياب بنسبة كبيرة.':
    'Tip: the WhatsApp button next to each appointment sends the patient a reminder a day ahead — it cuts no-shows noticeably.',

  /* ── عناصر اللوحة والجداول ─────────────────────────────────────────── */
  'الدكتور': 'Doctor',
  'الكل': 'All',
  'علاج طبيعي': 'Physiotherapy',
  'سمنة ونحافة': 'Weight management',
  'المريض': 'Patient',
  'التشخيص / الهدف': 'Diagnosis / goal',
  'آخر متابعة': 'Last visit',
  'الإجراءات': 'Actions',
  'جارٍ التحميل…': 'Loading…',

    /* ── الدفعة الثانية: الملف السريري، بوابة المريض، الإدارة، والإعدادات ──  */
  'رفع دلوقتي': 'Upload now',
  'محتاج مراجعة': 'Needs review',
  'رجوع لتسجيل الدخول الرئيسي': 'Back to the main sign-in',
  'رجوع لتسجيل الدخول': 'Back to sign-in',
  'رجوع لتسجيل دخول الدكاترة': 'Back to doctor sign-in',
  'تعذّر الاتصال بالسيرفر': 'Could not reach the server',
  'لو استمرت المشكلة تواصل مع إدارة النظام. لا تضف أي مفاتيح أو أكواد إلى هذه الصفحة.': 'If it keeps happening, contact the operator. Do not paste keys or codes into this page.',
  'خروج': 'Exit',
  'كود دخولك': 'Your access code',
  'الكود ده دائم؛ احتفظ بيه عشان تدخل بيه كل مرة. لو ضاع، كلّم العيادة.': 'This code is permanent; keep it to sign in every time. If you lose it, call the clinic.',
  'اشرب كمية كافية من المية وتعود على نظامك — كل يوم التزام هو خطوة لهدفك!': 'Drink enough water and stick to your routine — every consistent day is a step toward your goal.',
  'الوزن (كجم) *': 'Weight (kg) *',
  'رقم بين 30 و 250 بخطوة 0.5 كجم': 'A number between 30 and 250, in steps of 0.5 kg',
  'محيط الخصر (سم)': 'Waist (cm)',
  'محيط الأرداف (سم)': 'Hips (cm)',
  'محيط الذراع (سم)': 'Arm (cm)',
  'تاريخ القياس': 'Measurement date',
  'الافتراضي: النهارده — ممكن ترجع لآخر أسبوع': 'Defaults to today — you can go back up to a week',
  'إحساسك النهاردة (اختياري)': 'How you feel today (optional)',
  'صورة للمتابعة (اختياري)': 'Photo for follow-up (optional)',
  'اضغط للتصوير أو اختيار صورة (حتى 5MB)': 'Tap to take or choose a photo (up to 5MB)',
  'الصورة بتتخزن آمن في حساب العيادة — هيشوفها د. بس': 'The photo is stored securely in the clinic account — only the doctor sees it',
  'حفظ القياس': 'Save measurement',
  'تطورك معانا': 'Your progress',
  'منحنى الوزن والوجبات بشكل بسيط يفهمه أي حد': 'Weight and meals as one simple chart',
  'آخر شهر': 'Last month',
  '3 شهور': '3 months',
  'شوف الكل': 'See all',
  'التاريخ': 'Date',
  'الوزن': 'Weight',
  'الخصر': 'Waist',
  'الملاحظة': 'Note',
  'تطورك': 'Progress',
  'سجّل قياس': 'Log a measurement',
  'مواعيدك': 'Your appointments',
  'نبضة الشهر': 'This month at a glance',
  'رجوع لقائمة المرضى': 'Back to the patient list',
  'كود دخول بوابة المريض': 'Patient portal access code',
  'القياسات': 'Measurements',
  'التحاليل': 'Lab results',
  'متابعة السكر والضغط': 'Glucose and blood pressure',
  'الزيارات': 'Visits',
  'الملاحظات والأمراض المزمنة': 'Notes and chronic conditions',
  'الخطة الغذائية': 'Nutrition plan',
  'منحنى التطور': 'Progress chart',
  'شهر': 'Month',
  'إضافة قياس': 'Add measurement',
  'فحوص InBody': 'InBody scans',
  'إضافة فحص InBody': 'Add an InBody scan',
  'سجل التحاليل': 'Lab history',
  'كل تحليل بتاريخ مستقل؛ يمكن إدخال نتيجة رقمية أو نصية ووحدة اختيارية.': 'Each test keeps its own date; results can be numeric or text, with an optional unit.',
  'إضافة تحليل': 'Add a lab result',
  'سجل الزيارات المكتملة': 'Completed visits',
  'ملاحظات الزيارات ومتابعة الحالة': 'Visit notes and follow-up',
  'ملاحظة زيارة': 'Visit note',
  'مواعيد المريض': 'The patient\'s appointments',
  'اليوم': 'Today',
  'مكتبة خطط التغذية': 'Nutrition plan library',
  'أنشئ خططك الغذائية مرة واحدة واربطها بأي مريض بضغطة واحدة': 'Write your plans once and assign them to any patient in one click',
  'خطة جديدة': 'New plan',
  'لوحة تحكم المنصة': 'Platform dashboard',
  'نظرة عامة على كل العيادات المسجّلة — البيانات السريرية غير متاحة هنا بالتصميم': 'Every registered clinic at a glance — clinical data is deliberately not available here',
  'تسجيلات الدكاترة — آخر 6 أشهر': 'Doctor sign-ups — last 6 months',
  'توزيع التخصصات': 'Specialty breakdown',
  'أحدث الحسابات المسجّلة': 'Newest accounts',
  'نشط': 'Active',
  'تجريبي': 'Trial',
  'منتهي': 'Expired',
  'معلّق': 'Suspended',
  'محذوف': 'Deleted',
  'كل التخصصات': 'All specialties',
  'مشترك (علاج طبيعي + سمنة)': 'Both (physiotherapy + weight)',
  'سمنة وتغذية': 'Weight and nutrition',
  'العيادة': 'Clinic',
  'التسجيل': 'Signed up',
  'الاشتراك': 'Subscription',
  'آخر نشاط': 'Last active',
  'رجوع لقائمة الدكاترة': 'Back to the doctor list',
  'إحصاءات العيادة': 'Clinic statistics',
  'آخر 10 عمليات (سجل التدقيق)': 'Last 10 actions (audit log)',
  'ملاحظات الإدارة': 'Operator notes',
  'إعدادات المنصة العامة': 'Platform settings',
  'مدة التجربة المجانية (يوم)': 'Trial length (days)',
  'سعر الاشتراك الشهري (ج.م)': 'Monthly price (EGP)',
  'سعر الاشتراك السنوي (ج.م)': 'Yearly price (EGP)',
  'رسالة الترحيب الافتراضية للحسابات الجديدة': 'Default welcome message for new accounts',
  'حفظ الإعدادات': 'Save settings',
  'تصدير بيانات المنصة': 'Export platform data',
  'التصدير يشمل بيانات العيادات والإحصاءات فقط — بدون أي بيانات مرضى (بالتصميم).': 'The export covers clinics and statistics only — by design, no patient data.',
  'التصدير يشمل بيانات العيادات والإحصاءات فقط — (بالتصميم).': 'The export covers clinics and statistics only — by design, no patient data.',
  'تنزيل ملف JSON': 'Download the JSON file',
  'سجل الأخطاء المركزي': 'Central error log',
  'بيانات العيادة': 'Clinic details',
  'اسم الدكتور': 'Doctor name',
  'رقم واتساب العيادة': 'Clinic WhatsApp number',
  'سعر الجلسة / الكشف (ج.م)': 'Session / consultation price (EGP)',
  'العنوان': 'Address',
  'فعّل الأقسام التي تستخدمها عيادتك. إيقاف أي قسم يخفيه فقط ولا يحذف بياناته السابقة.': 'Turn on the sections your clinic uses. Hiding one only hides it — it never deletes past data.',
  'تسجيل ومتابعة قياسات الجسم الأساسية.': 'Record and track basic body measurements.',
  'متابعة مؤشرات تحليل تكوين الجسم المتاحة في جهاز العيادة.': 'Track the body-composition values your machine reports.',
  'إضافة التحاليل ونتائجها إلى ملف المريض.': 'Add lab tests and their results to the patient file.',
  'تسجيل قراءات السكر ونوع التحليل.': 'Record glucose readings and the reading type.',
  'تسجيل الضغط الانقباضي والانبساطي والنبض اختياريًا.': 'Record systolic, diastolic and optional pulse.',
  'حفظ البيانات': 'Save',
  'الفروع وأكواد الدخول': 'Branches and access codes',
  'جارٍ تحميل الفروع…': 'Loading branches…',
  'الفرع': 'Branch',
  'بادئة الكود (حروف إنجليزية كبيرة / أرقام)': 'Code prefix (uppercase letters / digits)',
  'حفظ البادئة': 'Save prefix',
  'اسم فرع جديد': 'New branch name',
  'إضافة فرع': 'Add branch',
  'حالة النظام': 'System status',
  'دليل الدكتور — خطوة بخطوة': 'Doctor guide — step by step',
  'البيانات': 'Data',
  'مرضى ومواعيد وقياسات محذوفة — استعادة خلال 30 يوماً ثم مسح نهائي تلقائي': 'Deleted patients, appointments and measurements — restorable for 30 days, then purged',
  'عرض': 'View',
  'تصدير كل بيانات العيادة في ملف JSON مشفّر بكلمة سر (AES-256)': 'Export the whole clinic as a password-encrypted JSON file (AES-256)',
  'تصدير': 'Export',
  'الخروج من حساب الدكتور': 'Sign out of the doctor account',

    /* ── الدفعة الثالثة: الهيرو وأقسام الإعدادات والقائمة الجانبية ──  */
  'سجّل قياساتك النهارده': 'Log today\'s measurements',
  'منحنى الوزن': 'Weight curve',
  'محيط الخصر': 'Waist',
  'سجل القياسات': 'Measurement log',
  'خصائص العيادة الاختيارية': 'Optional clinic features',
  'القياسات الجسدية': 'Body measurements',
  'التحاليل الطبية': 'Lab tests',
  'متابعة السكر': 'Glucose tracking',
  'متابعة ضغط الدم': 'Blood pressure tracking',
  'الأرشيف': 'Archive',
  'نسخة احتياطية': 'Backup',

    'الصورة بتتخزن آمن في حساب العيادة — الطبيب فقط هو اللي يشوفها': 'The photo is stored securely in the clinic account — only the doctor can see it',

    /* ── الدفعة الرابعة: دليل الدكتور وملاحظات الأمان ──  */
  'النظام مش قادر يفتح بياناتك دلوقتي، ومفيش أي إعداد لازم تعمله من هنا. ولو انقطع النت، البيانات تُحفظ مؤقتاً على هذا الجهاز فقط بصيغة مشفّرة حتى تُرفع تلقائياً أول ما يرجع.': 'The system cannot open your data right now, and there is nothing to configure here. If the connection drops, what you enter is kept on this device only, encrypted, and uploaded automatically once you are back online.',
  'كل فحص مؤرخ ومميّز عن القياس اليدوي؛ لا نكرر الطول، وتبقى مؤشرات الجهاز غير المتاحة فارغة.': 'Each scan is dated and kept apart from manual measurements; height is not duplicated, and readings the machine did not report stay empty.',
  'يتفعّل في المرحلة 12 مع Edge Functions: أخطاء العملاء تُجمع مركزياً بمعرّف طلب (بدون أي بيانات مرضى).': 'Enabled with the Edge Functions release: client errors are collected centrally under one request id (no patient data at all).',
  'البادئة فريدة على مستوى المنصة وتُقفل بعد إصدار أول كود مريض. الكود بيظهر في ملف المريض وداخل بوابته دائماً.': 'The prefix is unique across the platform and locks once the first patient code is issued. The code always shows on the patient file and inside their portal.',
  'افتح الموقع ← اضغط «حساب جديد» ← اكتب اسمك والتخصص والعيادة ← اضغط «إنشاء الحساب». لو نسيت الباسورد في أي وقت، «نسيت الباسورد» هتبعتك لينك على إيميلك.': 'Open the site, click "Sign up", enter your name, specialty and clinic, then click "Create account". If you ever forget your password, "Forgot password" emails you a reset link.',
  '١ — أعمل حسابك الأول مرة:': '1 — Create your account:',
  'من أي صفحة اضغط «مريض جديد» فوق، أو روح «المرضى». اكتب الاسم والموبايل والسن، اختار التخصص (علاج طبيعي / سمنة)، ولو مريض تخسيس اكتب وزنه الحالي وهدفه. اضغط «إضافة» — هيظهر فوراً في الجدول وفي لوحة التحكم.': 'From any page click "New patient" at the top, or open "Patients". Enter name, phone and age, pick the specialty (physiotherapy / weight loss), and for a weight-loss patient add current weight and target. Click "Add" — they show up in the table and on the dashboard right away.',
  '٢ — أضف أول مريض:': '2 — Add your first patient:',
  'افتح ملف المريض ← تبويب «القياسات» ← «إضافة قياس». لمريض السمنة اكتب الوزن (والخصر والأرداف والدهون لو حابب). لمريض العلاج الطبيعي اختار رقم الجلسة ودرجة الألم. المنحنى هيتحدث لوالوحده.': 'Open the patient file, go to the "Measurements" tab and click "Add measurement". For a weight-loss patient enter weight (plus waist, hips and fat if you want). For a physiotherapy patient pick the session number and the pain score. The chart updates on its own.',
  '٣ — سجّل قياس:': '3 — Log a measurement:',
  'من «المواعيد» اضغط «حجز موعد» ← اكتب اسم المريض في البحث ← اختار اليوم والفترة (مثلاً 5م—6م) ← «تأكيد الحجز». لو فيه موعد تاني بنفس الوقت النظام هيرفض ويقولك مع مين. بعد الحجز اضغط زر الواتساب الأخضر عشان تبعت تذكير للمريض برسالة جاهزة.': 'In "Appointments" click "Book appointment", search the patient name, pick the day and the slot (e.g. 5–6 pm), then "Confirm". If that slot is already taken the system refuses and tells you who has it. After booking, hit the green WhatsApp button to send a ready-made reminder.',
  '٤ — احجز موعد:': '4 — Book an appointment:',
  'روح «الخطط» واختار من المكتبة (فيها 10 خطط جاهزة: من 1200 سعر لحد بناء عضلات) أو اعمل خطة جديدة. اضغط «ربط بمريض» ← اختار المريض وتاريخ البدء والانتهاء. الخطة هتظهر في ملف المريض، وتقدر تبعتها له واتساب كاملة بضغطة.': 'Open "Plans" and pick from the library (10 ready plans, from 1,200 kcal up to muscle building) or write a new one. Click "Assign to patient", choose the patient and the start and end dates. The plan shows in the patient file, and you can send the whole thing on WhatsApp in one click.',
  '٥ — اربط خطة تغذية:': '5 — Assign a nutrition plan:',
  '٦ — نسخة احتياطية:': '6 — Take a backup:',

    'من «الإعدادات» ← «تصدير» كل أسبوع — هينزل ملف JSON مشفّر بكلمة سر (AES-256) فيه كل بيانات العيادة، وزر القفل المفتوح جنبه لفك التشفير وقت الحاجة. احفظ كلمة السر في مكان منفصل — بدونها النسخة مش هتترجع.': 'In "Settings" click "Export" every week: you get an AES-256 encrypted JSON file with the whole clinic, plus an unlock button for whenever you need it back. Keep that password somewhere separate — without it the backup cannot be restored.',

  /* ── رسائل المصادقة والأخطاء ───────────────────────────────────────── */
  'البريد الإلكتروني أو كلمة المرور غير صحيحة': 'Wrong email or password',
  'لا يوجد حساب بهذا البريد — أنشئ حساباً جديداً من تبويب «حساب جديد»':
    'No account for that email — create one from the “New account” tab',
  'كلمة المرور غير صحيحة — أعد المحاولة': 'Wrong password — try again',
  'هذا البريد مسجّل بالفعل — سجّل الدخول بدلاً من إنشاء حساب':
    'That email is already registered — sign in instead',
  'كلمة المرور ضعيفة — استخدم 6 أحرف على الأقل': 'Weak password — use at least 6 characters',
  'كلمة المرور ضعيفة — استخدم 8 أحرف على الأقل': 'Weak password — use at least 8 characters',
  'صيغة البريد الإلكتروني غير صحيحة': 'That email address is not valid',
  'تعذّر الاتصال بالخادم — تحقق من الإنترنت': 'Could not reach the server — check your connection',
  'محاولات كثيرة متتالية — انتظر دقيقة ثم أعد المحاولة':
    'Too many attempts — wait a minute and try again',
  'محاولات كثيرة متتالية — انتظر قليلاً ثم أعد المحاولة':
    'Too many attempts — wait a moment and try again',
  'انتهت فترة الاشتراك — جدد اشتراكك من إدارة النظام للمتابعة':
    'Subscription expired — renew it to continue',
  'تم تعليق اشتراك العيادة — تواصل مع إدارة النظام لتجديد الاشتراك':
    'Clinic subscription is suspended — contact the operator to renew',
  'كود التحقق غير صحيح — تأكد من ضبط الوقت على جهازك وأعد المحاولة':
    'Wrong verification code — check your device clock and try again',
  'انتهت جلسة الدخول — سجّل الدخول من جديد واكتب رمزاً جديداً':
    'Session expired — sign in again with a fresh code',
  'لازم إكمال التحقق بخطوتين أولاً — سجّل الدخول من جديد واكتب الرمز':
    'Two-factor verification is required first — sign in again and enter the code',
  'هذا الحساب ليس حساب إدارة نظام — الحسابات المصرّح لها فقط تدخل':
    'This is not an operator account — only authorised accounts get in',
  'حدث خطأ غير متوقع — حدّث الصفحة وأعد المحاولة، ولو تكرّر تواصل مع إدارة النظام':
    'Something went wrong — refresh and try again',
  'جارٍ الدخول...': 'Signing in...',
  'إعادة المحاولة': 'Try again',
  'بنجهّز العيادة...': 'Preparing the clinic...',
  'دخول ديمو': 'Demo sign-in'
};

// تسجيل القاموس. الملف ده بيقفّل الطبقة بنفسه عشان ترتيب الـ <script> يبقى كل
// حاجة واضحة في index.html من غير سطر تهيئة مخفي في مكان تاني.
I18N.init({ en: I18N_EN });
