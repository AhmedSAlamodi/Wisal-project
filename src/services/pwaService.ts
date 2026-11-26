import { useEffect, useState } from 'react';
import type { PushSubscriptionPayload } from '../types/report';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const PUSH_SUBSCRIPTION_STORAGE_KEY = 'wisal_push_subscription_v1';

export function detectIsIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isAppleTouch =
    /iphone|ipad|ipod/.test(ua) ||
    (window.navigator.platform === 'MacIntel' &&
      window.navigator.maxTouchPoints > 1);
  return isAppleTouch;
}

export function detectIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    detectIsStandalone()
  );
  const [isIOS, setIsIOS] = useState<boolean>(() => detectIsIOS());

  useEffect(() => {
    setIsInstalled(detectIsStandalone());
    setIsIOS(detectIsIOS());

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export function readSavedPushSubscription(): PushSubscriptionPayload | null {
  try {
    const raw = localStorage.getItem(PUSH_SUBSCRIPTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PushSubscriptionPayload;
    if (parsed && typeof parsed.endpoint === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePushSubscriptionLocally(
  subscription: PushSubscriptionPayload | null
): void {
  try {
    if (!subscription) {
      localStorage.removeItem(PUSH_SUBSCRIPTION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      PUSH_SUBSCRIPTION_STORAGE_KEY,
      JSON.stringify(subscription)
    );
  } catch {
    // تجاهل
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getOrCreatePushSubscription(): Promise<PushSubscriptionPayload | null> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return readSavedPushSubscription();
  }

  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500)),
    ]);

    if (!registration || !registration.pushManager) {
      return readSavedPushSubscription();
    }

    let sub = await registration.pushManager.getSubscription();
    if (!sub) {
      const vapidKey = (
        import.meta as unknown as { env?: Record<string, string | undefined> }
      ).env?.VITE_VAPID_PUBLIC_KEY;

      if (vapidKey) {
        const converted = urlBase64ToUint8Array(vapidKey);
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: converted.buffer as ArrayBuffer,
        });
      }
    }

    if (sub) {
      const json = sub.toJSON() as PushSubscriptionPayload;
      if (json && json.endpoint) {
        savePushSubscriptionLocally(json);
        return json;
      }
    }
  } catch {
    // المتابعة بدون مقاطعة تدفق الطالب في حال عدم توفر VAPID
  }

  return readSavedPushSubscription();
}

export async function showServiceWorkerNotification(options: {
  title: string;
  body: string;
  tag: string;
  reportId?: string;
  reportCode?: string;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  const notificationOptions: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
  } = {
    body: options.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    vibrate: [200, 100, 200],
    dir: 'rtl',
    lang: 'ar',
    tag: options.tag,
    renotify: true,
    data: {
      url: '/?tab=my-reports',
      reportId: options.reportId || null,
      reportCode: options.reportCode || null,
    },
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration =
        (await navigator.serviceWorker.getRegistration('/')) ||
        (await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<undefined>((resolve) =>
            window.setTimeout(() => resolve(undefined), 1200)
          ),
        ]));

      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(options.title, notificationOptions);
        return true;
      }
    }

    new Notification(options.title, notificationOptions);
    return true;
  } catch {
    return false;
  }
}
