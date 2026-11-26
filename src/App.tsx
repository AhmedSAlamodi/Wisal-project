import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircle, Trash2, WifiOff } from 'lucide-react';
import { MyReportsView } from './components/MyReportsView';
import { Navigation } from './components/Navigation';
import { ReportLostView } from './components/ReportLostView';
import {
  ConfirmDeliveryModal,
  NotifyNotFoundModal,
  NotifyStudentModal,
} from './components/StaffModals';
import { StaffPortalView } from './components/StaffPortalView';
import { Toast, type ToastState, type ToastVariant } from './components/Toast';
import {
  apiService,
  buildOfficialWhatsAppUrl,
  clearInMemoryStaffToken,
  hasInMemoryStaffToken,
  OFFICIAL_WHATSAPP_DISPLAY,
  readMyReportEntries,
  readStudentProfile,
  removeMyReportEntry,
  saveMyReportEntry,
  triggerMatchedBrowserNotification,
  triggerNotFoundBrowserNotification,
  triggerPickupReminderBrowserNotification,
} from './services/apiService';
import { useOnlineStatus } from './services/pwaService';
import type {
  AppMode,
  CreateLostReportPayload,
  LostReport,
  MyReportEntry,
  StudentProfile,
  StudentTab,
  UniversityFaculty,
  UpdateLostReportPayload,
} from './types/report';

const APP_MODE_KEY = 'wisal_app_mode_v1';
const STUDENT_TAB_KEY = 'wisal_student_tab_v1';
const LEGACY_STAFF_FACULTY_KEY = 'wisal_staff_faculty_v1';

export default function App() {
  const [myReportEntries, setMyReportEntries] = useState<MyReportEntry[]>(() =>
    readMyReportEntries()
  );
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(
    () => readStudentProfile()
  );

  const [mode, setModeState] = useState<AppMode>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'my-reports') return 'student';
      const saved = sessionStorage.getItem(APP_MODE_KEY);
      if (saved === 'student' || saved === 'staff') return saved;
    } catch {
      // تجاهل
    }
    return 'student';
  });

  const setMode = useCallback((nextMode: AppMode) => {
    setModeState(nextMode);
    try {
      sessionStorage.setItem(APP_MODE_KEY, nextMode);
    } catch {
      // تجاهل
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const [studentTab, setStudentTabState] = useState<StudentTab>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'my-reports') return 'my-reports';
      const saved = sessionStorage.getItem(STUDENT_TAB_KEY);
      if (saved === 'report' || saved === 'my-reports') return saved;
    } catch {
      // تجاهل
    }
    return readMyReportEntries().length > 0 ? 'my-reports' : 'report';
  });

  const setStudentTab = useCallback((tab: StudentTab) => {
    setStudentTabState(tab);
    try {
      sessionStorage.setItem(STUDENT_TAB_KEY, tab);
    } catch {
      // تجاهل
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // جلسة الموظف تُحفظ في الذاكرة فقط وتُوثّق عبر الخادم
  const [staffFaculty, setStaffFaculty] = useState<UniversityFaculty | null>(
    null
  );

  useEffect(() => {
    try {
      sessionStorage.removeItem(LEGACY_STAFF_FACULTY_KEY);
    } catch {
      // تجاهل
    }
  }, []);

  const [reports, setReports] = useState<LostReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [notifyModalState, setNotifyModalState] = useState<{
    report: LostReport;
    mode: 'matched' | 'reminder';
  } | null>(null);
  const [notFoundReport, setNotFoundReport] = useState<LostReport | null>(null);
  const [deliveryReport, setDeliveryReport] = useState<LostReport | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      setToast({ message, variant });
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleUnauthorizedSession = useCallback(
    (message?: string) => {
      clearInMemoryStaffToken();
      setStaffFaculty(null);
      showToast(
        message || 'انتهت جلسة بوابة المكتب، يرجى تسجيل الدخول مجدداً.',
        'error'
      );
    },
    [showToast]
  );

  const staffFacultyRef = useRef<UniversityFaculty | null>(staffFaculty);
  useEffect(() => {
    staffFacultyRef.current = staffFaculty;
  }, [staffFaculty]);

  const fetchReports = useCallback(
    async (options?: { silent?: boolean }) => {
      if (options?.silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      const response = await apiService.getReports();
      if (response.success && response.data) {
        setReports(response.data);
      } else if (response.statusCode === 401 && staffFacultyRef.current) {
        handleUnauthorizedSession(response.error || undefined);
      } else if (!options?.silent) {
        showToast(
          response.error || 'تعذر تحميل البيانات، يرجى المحاولة مجدداً.',
          'error'
        );
      }
      setIsLoading(false);
      setIsRefreshing(false);
    },
    [handleUnauthorizedSession, showToast]
  );

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  const isOnline = useOnlineStatus();
  const lastSyncRef = useRef<number>(0);

  useEffect(() => {
    const syncIfNeeded = () => {
      const now = Date.now();
      if (now - lastSyncRef.current < 4000) return;
      lastSyncRef.current = now;
      void fetchReports({ silent: true });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncIfNeeded();
      }
    };
    const handleOnline = () => {
      syncIfNeeded();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [fetchReports]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'OPEN_MY_REPORTS') {
        setMode('student');
        setStudentTab('my-reports');
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [setMode, setStudentTab]);

  // بلاغات الطالب الخاصة (المحفوظة في myReportIds فقط)
  const myReports = useMemo(() => {
    const reportById = new Map(reports.map((r) => [r.id, r]));
    return myReportEntries
      .map((entry) => {
        const report = reportById.get(entry.id);
        if (!report) return null;
        return { report, ownedInBrowser: entry.ownedInBrowser };
      })
      .filter(
        (
          item
        ): item is { report: LostReport; ownedInBrowser: boolean } =>
          item !== null
      );
  }, [reports, myReportEntries]);

  const matchedAlertsCount = useMemo(() => {
    return myReports.filter(
      ({ report }) =>
        report.status === 'matched' || Boolean(report.notification?.unread)
    ).length;
  }, [myReports]);

  const handleCreateReport = async (
    payload: CreateLostReportPayload
  ): Promise<LostReport> => {
    const response = await apiService.createReport(payload);
    if (!response.success || !response.data) {
      const msg = response.error || 'تعذر إرسال البلاغ، يرجى المحاولة مجدداً.';
      showToast(msg, 'error');
      throw new Error(msg);
    }
    const { ownerToken, ...created } = response.data;
    setReports((prev) => [created, ...prev]);

    // حفظ البلاغ تلقائياً في سجل بلاغات الطالب الخاصة (myReportIds) وتحديث الكلية الأساسية
    const updatedEntries = saveMyReportEntry({
      id: created.id,
      ownedInBrowser: true,
      ...(ownerToken ? { ownerToken } : {}),
    });
    setMyReportEntries(updatedEntries);
    setStudentProfile(readStudentProfile());

    showToast(
      `تم تسجيل البلاغ ${created.reportCode} وحفظه تلقائياً في «بلاغاتي».`,
      'success'
    );
    return created;
  };

  const handleUpdateReport = async (
    reportId: string,
    payload: UpdateLostReportPayload
  ) => {
    const response = await apiService.updateReport(reportId, payload);
    if (!response.success || !response.data) {
      const msg = response.error || 'تعذر تحديث بيانات البلاغ.';
      showToast(msg, 'error');
      throw new Error(msg);
    }

    const updated = response.data;
    setReports((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    showToast(`تم تحديث بيانات البلاغ (${updated.reportCode}) بنجاح.`, 'success');
  };

  const handleDeleteReport = async (reportId: string) => {
    const response = await apiService.deleteReport(reportId);
    if (!response.success) {
      if (response.statusCode === 401 && staffFaculty) {
        handleUnauthorizedSession(response.error || undefined);
      } else {
        showToast(response.error || 'تعذر حذف البلاغ من السجل.', 'error');
      }
      return;
    }

    const updatedEntries = removeMyReportEntry(reportId);
    setMyReportEntries(updatedEntries);
    setReports((prev) => prev.filter((item) => item.id !== reportId));
    showToast('تم حذف البلاغ نهائياً من السجل.', 'info');
  };

  const handleLookupByCode = async (reportCode: string) => {
    const response = await apiService.getReportByCode(reportCode);
    if (!response.success || !response.data) {
      const msg = response.error || 'لم يتم العثور على بلاغ بهذا الرقم.';
      showToast(msg, 'error');
      throw new Error(msg);
    }

    const found = response.data;
    setReports((prev) => {
      if (prev.some((item) => item.id === found.id)) {
        return prev.map((item) => (item.id === found.id ? found : item));
      }
      return [found, ...prev];
    });

    const updatedEntries = saveMyReportEntry({
      id: found.id,
      ownedInBrowser: false,
    });
    setMyReportEntries(updatedEntries);

    showToast(
      `تمت إضافة البلاغ (${found.reportCode}) إلى «بلاغاتي» لمتابعة حالته.`,
      'info'
    );
  };

  const handleRemoveFromMyList = (reportId: string) => {
    const updated = removeMyReportEntry(reportId);
    setMyReportEntries(updated);
    showToast('تمت إزالة البلاغ من قائمة «بلاغاتي» في هذا المتصفح.', 'info');
  };

  const handleMarkAsMatched = async (report: LostReport) => {
    const response = await apiService.markAsMatched(report.id);
    if (!response.success || !response.data) {
      if (response.statusCode === 401) {
        handleUnauthorizedSession(response.error || undefined);
        return;
      }
      showToast(
        response.error || 'تعذر تحديث حالة البلاغ إلى موجود بالمكتب.',
        'error'
      );
      return;
    }

    const updated = response.data;
    setReports((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    triggerMatchedBrowserNotification(updated);
    setNotifyModalState({ report: updated, mode: 'matched' });
    showToast(
      `تم تأكيد العثور على غرض البلاغ ${updated.reportCode} وإصدار الإشعار.`,
      'success'
    );
  };

  const handleResendPickupReminder = async (report: LostReport) => {
    const response = await apiService.resendPickupReminder(report.id);
    if (!response.success || !response.data) {
      if (response.statusCode === 401) {
        handleUnauthorizedSession(response.error || undefined);
        return;
      }
      showToast(response.error || 'تعذر إرسال تذكير الاستلام.', 'error');
      return;
    }

    const updated = response.data;
    setReports((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    triggerPickupReminderBrowserNotification(updated);
    setNotifyModalState({ report: updated, mode: 'reminder' });
    showToast(
      `تم إرسال تذكير الاستلام للطالب بخصوص البلاغ (${updated.reportCode}).`,
      'info'
    );
  };

  const handleConfirmDelivery = async (reportId: string) => {
    const response = await apiService.confirmDelivery(reportId);
    if (!response.success || !response.data) {
      if (response.statusCode === 401) {
        setDeliveryReport(null);
        handleUnauthorizedSession(response.error || undefined);
        return;
      }
      const msg =
        response.error || 'تعذر تأكيد التسليم النهائي، يرجى المحاولة مرة أخرى.';
      showToast(msg, 'error');
      throw new Error(msg);
    }

    const updated = response.data;
    setReports((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    setDeliveryReport(null);
    showToast(
      `تم تأكيد التسليم النهائي للبلاغ ${updated.reportCode} بنجاح.`,
      'success'
    );
  };

  const handleCancelReport = async (reportId: string) => {
    const response = await apiService.cancelReport(reportId);
    if (!response.success || !response.data) {
      const msg = response.error || 'تعذر سحب البلاغ، يرجى المحاولة مجدداً.';
      showToast(msg, 'error');
      throw new Error(msg);
    }

    const updated = response.data;
    setReports((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    showToast(`تم سحب البلاغ (${updated.reportCode}) وإلغاؤه بنجاح.`, 'info');
  };

  const handleMarkNotificationRead = async (reportId: string) => {
    const response = await apiService.markNotificationAsRead(reportId);
    if (!response.success || !response.data) {
      showToast(response.error || 'تعذر تحديث حالة التنبيه.', 'error');
      return;
    }

    const updated = response.data;
    setReports((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    showToast(`تم تأكيد قراءة تنبيه البلاغ (${updated.reportCode}).`, 'success');
  };

  const handleNotifyNotFound = async (report: LostReport) => {
    const response = await apiService.notifyNotFoundYet(report.id);
    if (!response.success || !response.data) {
      if (response.statusCode === 401) {
        handleUnauthorizedSession(response.error || undefined);
        return;
      }
      showToast(response.error || 'تعذر تسجيل إشعار المراجعة.', 'error');
      return;
    }

    const updated = response.data;
    setReports((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    triggerNotFoundBrowserNotification(updated);
    setNotFoundReport(updated);
    showToast(
      `تم إرسال إشعار بعدم العثور على غرض البلاغ (${updated.reportCode}) مع إبقائه نشطاً.`,
      'info'
    );
  };

  const handleClearLocalData = async () => {
    if (isResetting) return;
    setIsResetting(true);
    const response = await apiService.clearAllReports();
    if (response.success) {
      setMyReportEntries([]);
      setStudentProfile(null);
      if (!hasInMemoryStaffToken()) {
        setReports([]);
      }
      showToast('تم مسح سجل هذا المتصفح المحلي بنجاح.', 'info');
    } else {
      showToast(response.error || 'تعذر مسح البيانات المحلية.', 'error');
    }
    setIsResetting(false);
  };

  const handleStaffLoginSuccess = (faculty: UniversityFaculty) => {
    setStaffFaculty(faculty);
    showToast(`تم الدخول إلى مكتب شؤون الطلاب — ${faculty}.`, 'success');
    void fetchReports({ silent: true });
  };

  const handleStaffLogout = async () => {
    await apiService.staffLogout();
    setStaffFaculty(null);
    showToast('تم تسجيل الخروج من بوابة المكتب.', 'info');
    void fetchReports({ silent: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA] text-slate-900">
      <Navigation
        mode={mode}
        studentTab={studentTab}
        myReportsCount={myReports.length}
        matchedAlertsCount={matchedAlertsCount}
        onChangeMode={setMode}
        onChangeStudentTab={(tab) => {
          setMode('student');
          setStudentTab(tab);
        }}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-12">
        {!isOnline && (
          <div
            role="status"
            className="mb-4 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] px-3.5 py-2.5 text-xs font-semibold text-[#92400E] flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
            <span>وضع عدم الاتصال — يتم عرض البيانات المحفوظة محلياً على جهازك.</span>
          </div>
        )}

        {mode === 'student' ? (
          <div className="space-y-6">
            {/* شريط التبويبات الفرعي لتجربة الطالب */}
            <div
              role="tablist"
              aria-label="خطوات الطالب"
              className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-white border border-[#E2E8F0] shadow-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={studentTab === 'report'}
                onClick={() => setStudentTab('report')}
                className={`inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[42px] rounded-md text-xs sm:text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                  studentTab === 'report'
                    ? 'bg-[#0F2942] text-white'
                    : 'text-slate-600 hover:text-[#0F2942] hover:bg-[#F5F7FA]'
                }`}
              >
                <span>(1) إبلاغ عن فقد غرض</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={studentTab === 'my-reports'}
                onClick={() => setStudentTab('my-reports')}
                className={`inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[42px] rounded-md text-xs sm:text-sm font-semibold transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                  studentTab === 'my-reports'
                    ? 'bg-[#0F2942] text-white'
                    : 'text-slate-600 hover:text-[#0F2942] hover:bg-[#F5F7FA]'
                }`}
              >
                <span>(2) متابعة بلاغاتي</span>
                {matchedAlertsCount > 0 ? (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums ${
                      studentTab === 'my-reports'
                        ? 'bg-[#166534] text-white'
                        : 'bg-[#DCFCE7] border border-[#BBF7D0] text-[#166534]'
                    }`}
                  >
                    {matchedAlertsCount} تنبيه
                  </span>
                ) : (
                  myReports.length > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums ${
                        studentTab === 'my-reports'
                          ? 'bg-white/20 text-white'
                          : 'bg-[#F5F7FA] border border-[#E2E8F0] text-[#0F2942]'
                      }`}
                    >
                      {myReports.length}
                    </span>
                  )
                )}
              </button>
            </div>

            {studentTab === 'report' ? (
              <ReportLostView
                studentProfile={studentProfile}
                onCreateReport={handleCreateReport}
                onCopyReceipt={(msg) => showToast(msg, 'info')}
                onGoToTracking={() => setStudentTab('my-reports')}
              />
            ) : (
              <MyReportsView
                myReports={myReports}
                isLoading={isLoading}
                isRefreshing={isRefreshing}
                onRefresh={() => void fetchReports({ silent: true })}
                onLookupByCode={handleLookupByCode}
                onUpdateReport={handleUpdateReport}
                onCancelReport={handleCancelReport}
                onDeleteReport={handleDeleteReport}
                onMarkNotificationRead={handleMarkNotificationRead}
                onRemoveFromMyList={handleRemoveFromMyList}
                onGoToReportForm={() => setStudentTab('report')}
                onCopyFeedback={(msg) => showToast(msg, 'info')}
              />
            )}
          </div>
        ) : (
          <StaffPortalView
            reports={reports}
            staffFaculty={staffFaculty}
            isRefreshing={isRefreshing}
            onRefresh={() => void fetchReports({ silent: true })}
            onLogin={handleStaffLoginSuccess}
            onLogout={() => void handleStaffLogout()}
            onMarkAsMatched={handleMarkAsMatched}
            onNotifyNotFound={handleNotifyNotFound}
            onResendPickupReminder={handleResendPickupReminder}
            onOpenDeliveryModal={(report) => setDeliveryReport(report)}
            onLoginError={(msg) => showToast(msg, 'error')}
          />
        )}
      </main>

      <footer className="border-t border-[#E2E8F0] bg-white mb-16 md:mb-0">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p className="font-medium text-slate-600 text-center sm:text-right">
            وصال الجامعي · نظام إدارة المفقودات – مكاتب شؤون الطلاب
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href={buildOfficialWhatsAppUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg border border-[#E2E8F0] bg-[#F5F7FA] hover:bg-slate-200/60 text-[#0F2942] text-xs font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0"
            >
              <MessageCircle className="w-3.5 h-3.5 text-[#166534] shrink-0" strokeWidth={1.6} aria-hidden="true" />
              <span className="tabular-nums">
                واتساب وصال الرسمي: {OFFICIAL_WHATSAPP_DISPLAY}
              </span>
            </a>

            <button
              type="button"
              onClick={() => void handleClearLocalData()}
              disabled={isResetting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-lg text-slate-500 hover:text-[#0F2942] hover:bg-[#F5F7FA] disabled:opacity-60 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isResetting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
              ) : (
                <Trash2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              )}
              <span>مسح السجل المحلي</span>
            </button>
          </div>
        </div>
      </footer>

      <NotifyStudentModal
        report={notifyModalState?.report ?? null}
        mode={notifyModalState?.mode ?? 'matched'}
        onClose={() => setNotifyModalState(null)}
        onCopyMessage={(msg) => showToast(msg, 'info')}
      />

      <NotifyNotFoundModal
        report={notFoundReport}
        onClose={() => setNotFoundReport(null)}
        onCopyMessage={(msg) => showToast(msg, 'info')}
      />

      <ConfirmDeliveryModal
        report={deliveryReport}
        onClose={() => setDeliveryReport(null)}
        onConfirm={handleConfirmDelivery}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
