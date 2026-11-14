# Teacher demo — Egyptian Arabic narration

اقرأ كل سطر مرة واحدة، بسرعة هادية زي فيديو شرح. كل مشهد فكرة واحدة.

Role: teacher/staff · Tenant: Sunshine (`https://sunshine.kiddyapp.net`) · Capture: 1920x1080, 30 fps

| # | Scene | Tool | Screen | Line | Target |
| --- | --- | --- | --- | --- | --- |
| 01-login | Sign in | Authentication | `/login` | دي شاشة المدرس في Kiddy. سجّل دخول بحساب الروضة اللي المدير ادّاه لك، والتطبيق هيفتح على لوحتك. | 8.6s |
| 02-dashboard | Dashboard | Home dashboard | `/portal/dashboard` | لوحة التحكم هي بداية يومك. بتوريك الأطفال اللي في فصولك، مين حاضر دلوقتي، الموافقات المفتوحة، وآخر التقارير. | 8.6s |
| 03-children | Children | Child list | `/portal/children` | صفحة الأطفال بتعرض كل طفل في الفصول المسندة لك. دوّر بالاسم، فلتر بالحالة، أو افتح ملف الطفل. | 8.6s |
| 04-child-daily-report | Daily report | Child profile / daily report | `/portal/children/[id]?tab=daily` | التقرير اليومي هو قلب ملف الطفل. اختار التاريخ، سجّل الأكل، المود، النوم، الحمام، وملاحظة، وبعدين احفظه للأهل. | 8.6s |
| 05-child-about | Child details | Child profile / about | `/portal/children/[id]?tab=about` | تبويب عن الطفل بيعرض فصله، تاريخ ميلاده، الحساسية، وملاحظات الرعاية، عشان تعرف المهم قبل ما اليوم يبدأ. | 8.6s |
| 06-child-family | Family and pickup | Child profile / family | `/portal/children/[id]?tab=family` | تبويب الاستلام والعائلة فيه الأهل وجهات الاستلام، مع التليفون والإيميل وصلاحية الاستلام. المدير هو اللي بيتحكم في مين يستلم الطفل. | 10.0s |
| 07-child-media | Child media | Child profile / media | `/portal/children/[id]?tab=media` | الوسائط بتحفظ الصور والفيديوهات اللي بتشاركها مع الأهل. ارفع من جهازك، والأهل هيشوفوها في التطبيق. | 7.7s |
| 08-child-documents | Child documents | Child profile / documents | `/portal/children/[id]?tab=documents` | المستندات والموافقات بتعرض طلبات الموافقة اللي اتبعتت للطفل ده، مع رد الأهل والتاريخ. | 6.8s |
| 09-child-schedules | Child schedule | Child profile / schedules | `/portal/children/[id]?tab=schedules` | الجداول بتعرض جدول الطفل الأسبوعي، عشان تعرف هو بييجي إمتى والأنشطة المخططة إيه. | 6.8s |
| 10-child-learning | Child learning history | Child profile / learning history | `/portal/children/[id]?tab=learning` | سجل التعلّم بيجمع ملاحظاتك وتقييماتك للطفل ده في خط زمني واحد ترجع له وقت ما تحتاج. | 8.2s |
| 11-child-incidents | Child incidents | Child profile / incidents | `/portal/children/[id]?tab=incidents` | الحوادث والإصابات بتعرض كل حادثة مرتبطة بالطفل، مع اللي حصل، مين بلّغ، وهل الأهل اعترفوا بالحادثة. | 8.2s |
| 12-attendance | Attendance and bus | Attendance | `/portal/attendance` | الحضور هو دفتر فصلك. اختار اليوم، فلتر بالفصل، دوّر على الطفل، وبعدين سجّل حضوره أو خروجه. أزرار الأتوبيس بتوريك مين راكب. | 10.4s |
| 13-consents | Consents | Consents | `/portal/consents` | ابعت طلب موافقة لطفل واحد أو للفصل كله. قائمة الموافقات بتوريك مين وافق، مين رفض، ومين لسه ما ردش. | 9.5s |
| 14-incidents | Incident reports | Incidents | `/portal/incidents` | صفحة الحوادث بتعرض التقارير الخاصة بفصولك. افتح تقرير عشان تقرا التفاصيل وتشوف الأهل اعترفوا ولا لسه. | 8.2s |
| 15-newsfeed | Newsfeed | Newsfeed | `/portal/newsfeed` | صفحة الأخبار هي طريقة كلامك مع الأهل. اكتب بوست، اختار طفل أو فصل أو كل الأهل، ضيف صورة، وانشر. | 9.5s |
| 16-messages | Messages | Messages | `/portal/messages` | الرسائل هي صندوقك الخاص. ابدأ محادثة مع ولي أمر أو فصل، ارفق ملف، وخلي كل الردود في مكان واحد. | 9.5s |
| 17-calendar | Calendar | Calendar | `/portal/calendar` | التقويم بيعرض فعاليات الروضة والرحلات الشهر ده، مع الوسائط اللي اتشاركت لكل فعالية. | 6.8s |
| 18-events | Events | Events | `/portal/events` | اعمل فعالية من صفحة الفعاليات. ضيف العنوان، التاريخ، الوقت، المكان، والأهل اللي المفروض يشوفوها. | 7.3s |
| 19-drive | Parent drive | Parent drive | `/portal/drive` | الملفات المشتركة بتشارك ملف مع أسرة واحدة أو مع كل الأسر. ارفعه مرة واحدة، وهيظهر في تطبيق الأهل. | 9.1s |
| 20-learning | Development observations | Learning | `/portal/learning` | التطوّر هو مكان تسجيل تطور الطفل. اختار طفل، اختار مجال من المنهج، اكتب اللي شوفته، وضيفه لسجله. | 8.6s |
| 21-activities | Activities | Learning / activities | `/portal/learning/activities` | الأنشطة للجزء الممتع من اليوم. اعمل نشاط بوقت ومكان وجمهور، والأهل هيوصلهم التحديث. | 6.8s |
| 22-homework | Homework | Learning / homework | `/portal/learning/homework` | الواجبات بتخليك تسند مهمة لطفل أو للفصل كله، بموعد تسليم وتعليمات واضحة. | 6.4s |
| 23-staff-profile | My staff profile | Staff / own profile | `/portal/staff` | ملف الموظف بيعرض دورك، فصولك، وبيانات التواصل. المدير هو اللي بيحدّث قائمة الفريق. | 6.8s |
| 24-staff-schedule | My schedule | Staff / schedule | `/portal/staff/schedule` | جدول الموظفين بيعرض شيفتاتك الأسبوعية، عشان تعرف دايماً إمتى المفروض تكون في فصلك. | 6.8s |
| 25-working-hours | Working hours | Staff / working hours | `/portal/staff/hours` | ساعات العمل بتعرض مواعيد فتح الروضة والفصول اللي تقدر تدخلها. | 6.0s |
| 26-notifications | Notifications | Notifications | `/portal/notifications` | الإشعارات بتجمع الرسائل والتقارير والأنشطة. افتح أي عنصر عشان تروح على طول للطفل أو المحادثة. | 7.7s |
| 27-account | Account settings | Account | `/portal/account` | في إعدادات الحساب تقدر تغيّر صورتك، كلمة السر، لغة التطبيق، وإشعارات الموبايل. | 6.4s |
| 28-wrap | Close | Summary | `/portal/dashboard` | دي مساحة المدرس: كل طفل، كل تقرير يومي، وكل رسالة للأهل، في مكان واحد. | 7.3s |

Target total: **223.8s** (~4 min). Re-measured from the uploaded WAVs at assembly.

