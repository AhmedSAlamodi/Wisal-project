import { useState } from 'react';
import { Bell, BellRing, Check, Loader2, Share, Smartphone } from 'lucide-react';
import { apiService, readMyReportEntries } from '../services/apiService';
import {
  getOrCreatePushSubscription,
  usePWAInstall,
} from '../services/pwaService';

type BrowserNotifState = NotificationPermission | 'unsupported';

function getBrowserNotificationPermission(): BrowserNotifState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

interface MobileNotificationPromptProps {
  onStatusFeedback?: (message: string) => void;
  compact?: boolean;
}

export function MobileNotificationPrompt({
  onStatusFeedback,
  compact = false,
}: MobileNotificationPromptProps) {
  const { isInstalled, isIOS } = usePWAInstall();
  const [notifPermission, setNotifPermission] = useState<BrowserNotifState>(() =>
    getBrowserNotificationPermission()
  );
  const [isRequesting, setIsRequesting] = useState(false);

  const handleEnableMobileNotifications = async () => {
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      isRequesting
    ) {
      return;
    }

    setIsRequesting(true);
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);

      if (result === 'granted') {
        const subscription = await getOrCreatePushSubscription();
        if (subscription) {
          const myIds = readMyReportEntries().map((entry) => entry.id);
          await apiService.registerPushSubscription(subscription, myIds);
        }
        onStatusFeedback?.(
          'تم تفعيل إشعارات الجوال بنجاح؛ سيصلك تنبيه فوري فور تحديث حالة بلاغك.'
        );
      } else if (result === 'denied') {
        onStatusFeedback?.(
          'تم حظر الإشعارات في المتصفح؛ يمكنك السماح بها من إعدادات الموقع.'
        );
      }
    } catch {
      // تجاهل
    } finally {
      setIsRequesting(false);
    }
  };

  // توجيه خاص لمستخدمي آيفون عندما لا يكون التطبيق مثبتاً كـ Standalone PWA
  if (isIOS && !isInstalled) {
    return (
      <section
        aria-label="توجيه تفعيل الإشعارات على آيفون"
        className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs p-4 text-right space-y-2"
      >
        <div className="flex items-start gap-2.5">
          <Smartphone
            className="w-4 h-4 text-[#0F2942] mt-0.5 shrink-0"
            strokeWidth={1.6}
            aria-hidden="true"
          />
          <div className="space-y-1 text-xs leading-relaxed">
            <p className="font-bold text-[#0F2942]">
              تفعيل إشعارات الجوال على آيفون (iPhone)
            </p>
            <p className="text-slate-600">
              لتصلك إشعارات الجوال على آيفون، اضغط{' '}
              <span className="inline-flex items-center gap-1 font-semibold text-[#0F2942]">
                <Share className="w-3.5 h-3.5 inline shrink-0" strokeWidth={1.6} aria-hidden="true" />
                مشاركة
              </span>{' '}
              ثم <strong>&quot;إضافة إلى الشاشة الرئيسية&quot;</strong> وافتح التطبيق من الأيقونة.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (notifPermission === 'unsupported') {
    return null;
  }

  if (notifPermission === 'granted') {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs px-4 py-3 flex items-center justify-between gap-3 text-right">
        <div className="flex items-center gap-2.5 min-w-0">
          <Bell
            className="w-4 h-4 text-[#166534] shrink-0"
            strokeWidth={1.6}
            aria-hidden="true"
          />
          <p className="text-xs font-semibold text-[#0F2942] leading-snug">
            إشعارات الجوال مفعّلة — سيصلك تنبيه فوري على جهازك فور تحديث البلاغ
          </p>
        </div>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#DCFCE7] border border-[#BBF7D0] text-[#166534] text-[11px] font-bold whitespace-nowrap shrink-0">
          <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
          <span>مفعّل</span>
        </span>
      </div>
    );
  }

  return (
    <section
      aria-label="تفعيل إشعارات الجوال"
      className={`bg-white border border-[#E2E8F0] rounded-xl shadow-xs text-right ${
        compact ? 'p-4' : 'p-4 sm:p-5'
      } flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}
    >
      <div className="flex items-start gap-2.5">
        <BellRing
          className="w-5 h-5 text-[#0F2942] mt-0.5 shrink-0"
          strokeWidth={1.6}
          aria-hidden="true"
        />
        <div className="text-xs leading-relaxed space-y-0.5">
          <p className="font-bold text-[#0F2942]">
            {notifPermission === 'denied'
              ? 'إشعارات الجوال محظورة في إعدادات المتصفح'
              : 'تفعيل إشعارات الجوال الفورية'}
          </p>
          <p className="text-slate-600">
            {notifPermission === 'denied'
              ? 'للحصول على تنبيه فوري عند العثور على غرضك، اسمح بالإشعارات من إعدادات الموقع في متصفحك.'
              : 'فعّل إشعارات الجوال ليصلك تنبيه نظام فوري فور مراجعة بلاغك أو العثور على غرضك.'}
          </p>
        </div>
      </div>

      {notifPermission === 'default' && (
        <button
          type="button"
          disabled={isRequesting}
          onClick={() => void handleEnableMobileNotifications()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] rounded-lg bg-[#0F2942] hover:bg-[#163859] disabled:opacity-70 text-white text-xs font-semibold transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isRequesting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <BellRing className="w-3.5 h-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
          )}
          <span>{isRequesting ? 'جاري التفعيل...' : 'تفعيل إشعارات الجوال'}</span>
        </button>
      )}
    </section>
  );
}
