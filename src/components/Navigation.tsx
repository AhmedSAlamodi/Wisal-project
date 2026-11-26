import { useState } from 'react';
import {
  Download,
  FilePlus2,
  FolderHeart,
  GraduationCap,
  Share,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../services/pwaService';
import type { AppMode, StudentTab } from '../types/report';

interface NavigationProps {
  mode: AppMode;
  studentTab: StudentTab;
  myReportsCount: number;
  matchedAlertsCount?: number;
  onChangeMode: (mode: AppMode) => void;
  onChangeStudentTab: (tab: StudentTab) => void;
}

export function Navigation({
  mode,
  studentTab,
  myReportsCount,
  matchedAlertsCount = 0,
  onChangeMode,
  onChangeStudentTab,
}: NavigationProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  return (
    <>
      {/* الهيدر العلوي النظيف */}
      <header className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* الشعار والاسم والوصف الفرعي */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  onChangeMode('student');
                  onChangeStudentTab('report');
                }}
                className="flex items-center gap-2.5 text-right cursor-pointer shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-[#0F2942]"
              >
                <div
                  className="w-9 h-9 rounded-lg bg-[#0F2942] text-white flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3L4 6.5v5.5c0 5 3.4 9.5 8 10.5 4.6-1 8-5.5 8-10.5V6.5L12 3z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <span className="block text-base sm:text-lg font-bold tracking-tight text-[#0F2942] leading-tight whitespace-nowrap">
                    وصال الجامعي
                  </span>
                  <span className="block text-[11px] font-medium text-slate-500 leading-tight mt-0.5 whitespace-nowrap">
                    نظام إدارة المفقودات – مكاتب شؤون الطلاب
                  </span>
                </div>
              </button>

              {/* زر التثبيت السريع على الجوال في الهيدر (يظهر على الشاشات الصغيرة بجانب الشعار إن أمكن) */}
              {!isInstalled && isInstallable && (
                <button
                  type="button"
                  onClick={() => void install()}
                  className="sm:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/70 text-[#0F2942] text-[11px] font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  <span>تثبيت التطبيق</span>
                </button>
              )}

              {!isInstalled && !isInstallable && isIOS && (
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(true)}
                  className="sm:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/70 text-[#0F2942] text-[11px] font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  <span>تثبيت آيفون</span>
                </button>
              )}
            </div>

            {/* مبدّل الأوضاع + زر التثبيت للشاشات المتوسطة والكبيرة */}
            <div className="flex items-center justify-end gap-2">
              {!isInstalled && isInstallable && (
                <button
                  type="button"
                  onClick={() => void install()}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/70 text-[#0F2942] text-xs font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  <span>تثبيت التطبيق على الجوال</span>
                </button>
              )}

              {!isInstalled && !isInstallable && isIOS && (
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(true)}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/70 text-[#0F2942] text-xs font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  <span>تثبيت على آيفون</span>
                </button>
              )}

              <div
                role="group"
                aria-label="التبديل بين وضع الطالب وبوابة شؤون الطلاب"
                className="w-full sm:w-auto grid grid-cols-2 sm:inline-flex items-center p-1 rounded-lg bg-[#F5F7FA] border border-[#E2E8F0] shrink-0"
              >
                <button
                  type="button"
                  onClick={() => onChangeMode('student')}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-md text-xs font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === 'student'
                      ? 'bg-[#0F2942] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#0F2942]'
                  }`}
                >
                  <GraduationCap className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  <span>وضع الطالب</span>
                </button>

                <button
                  type="button"
                  onClick={() => onChangeMode('staff')}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-md text-xs font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === 'staff'
                      ? 'bg-[#0F2942] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#0F2942]'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  <span>بوابة شؤون الطلاب</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* نافذة إرشادات التثبيت على آيفون (iOS Safari) */}
      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2942]/45 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-guide-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowIOSGuide(false);
          }}
        >
          <div className="bg-white w-full max-w-sm rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#0F2942] shrink-0" strokeWidth={1.6} aria-hidden="true" />
                <h2
                  id="ios-install-guide-title"
                  className="text-base font-bold text-[#0F2942]"
                >
                  تثبيت «وصال الجامعي» على آيفون
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                aria-label="إغلاق"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-[#F5F7FA] cursor-pointer"
              >
                <X className="w-4 h-4" strokeWidth={1.6} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm text-slate-700 leading-relaxed">
              <p>
                لتصلك إشعارات الجوال على آيفون، اضغط{' '}
                <strong className="inline-flex items-center gap-1 text-[#0F2942]">
                  <Share className="w-4 h-4 inline shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  مشاركة
                </strong>{' '}
                ثم <strong>&quot;إضافة إلى الشاشة الرئيسية&quot;</strong> وافتح التطبيق من الأيقونة.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2942] hover:bg-[#163859] text-white text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer"
              >
                حسناً
              </button>
            </div>
          </div>
        </div>
      )}

      {/* شريط التنقل السفلي الثابت لشاشات الجوال */}
      <nav
        aria-label="التنقل السفلي للجوال"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-[#E2E8F0]"
      >
        {mode === 'student' ? (
          <div className="grid grid-cols-3 h-full max-w-lg mx-auto">
            <button
              type="button"
              onClick={() => onChangeStudentTab('report')}
              aria-current={studentTab === 'report' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 min-h-[44px] px-1 transition-colors active:scale-[0.99] cursor-pointer ${
                studentTab === 'report'
                  ? 'text-[#0F2942] font-semibold'
                  : 'text-slate-500 hover:text-[#0F2942] font-medium'
              }`}
            >
              <FilePlus2
                className={`w-5 h-5 shrink-0 ${
                  studentTab === 'report' ? 'text-[#0F2942]' : 'text-slate-400'
                }`}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="text-[11px] leading-none whitespace-nowrap">
                إبلاغ عن فقد
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeStudentTab('my-reports')}
              aria-current={studentTab === 'my-reports' ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 min-h-[44px] px-1 transition-colors active:scale-[0.99] cursor-pointer ${
                studentTab === 'my-reports'
                  ? 'text-[#0F2942] font-semibold'
                  : 'text-slate-500 hover:text-[#0F2942] font-medium'
              }`}
            >
              <div className="relative">
                <FolderHeart
                  className={`w-5 h-5 shrink-0 ${
                    studentTab === 'my-reports'
                      ? 'text-[#0F2942]'
                      : 'text-slate-400'
                  }`}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                {matchedAlertsCount > 0 && (
                  <span
                    aria-label={`${matchedAlertsCount} تنبيهات جديدة`}
                    className="absolute -top-1.5 -left-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#166534] text-white text-[10px] font-bold tabular-nums flex items-center justify-center"
                  >
                    {matchedAlertsCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] leading-none whitespace-nowrap tabular-nums">
                بلاغاتي{myReportsCount > 0 ? ` (${myReportsCount})` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeMode('staff')}
              className="flex flex-col items-center justify-center gap-1 min-h-[44px] px-1 text-slate-500 hover:text-[#0F2942] font-medium transition-colors active:scale-[0.99] cursor-pointer"
            >
              <ShieldCheck
                className="w-5 h-5 shrink-0 text-slate-400"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="text-[11px] leading-none whitespace-nowrap">
                بوابة الشؤون
              </span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 h-full max-w-lg mx-auto">
            <div className="flex flex-col items-center justify-center gap-1 min-h-[44px] px-1 text-[#0F2942] font-semibold">
              <ShieldCheck
                className="w-5 h-5 shrink-0 text-[#0F2942]"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="text-[11px] leading-none whitespace-nowrap">
                بوابة شؤون الطلاب
              </span>
            </div>

            <button
              type="button"
              onClick={() => onChangeMode('student')}
              className="flex flex-col items-center justify-center gap-1 min-h-[44px] px-1 text-slate-500 hover:text-[#0F2942] font-medium transition-colors active:scale-[0.99] cursor-pointer"
            >
              <GraduationCap
                className="w-5 h-5 shrink-0 text-slate-400"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="text-[11px] leading-none whitespace-nowrap">
                العودة لوضع الطالب
              </span>
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
