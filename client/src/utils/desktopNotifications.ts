import {
  isPermissionGranted,
  requestPermission,
  sendNotification as sendNativeNotification,
} from "@tauri-apps/plugin-notification";
import { isTauriRuntime } from "./platform";

type DesktopNotificationPermission = NotificationPermission;

export function desktopNotificationsSupported(): boolean {
  return isTauriRuntime() || typeof Notification !== "undefined";
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (isTauriRuntime()) {
    if (await isPermissionGranted()) {
      return "granted";
    }

    return await requestPermission();
  }

  if (typeof Notification === "undefined") {
    return "denied";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  return await Notification.requestPermission();
}

export async function sendDesktopNotification(
  title: string,
  options: { body?: string; tag?: string } = {},
): Promise<void> {
  if (isTauriRuntime()) {
    await sendNativeNotification({
      title,
      body: options.body,
    });
    return;
  }

  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }

  const notification = new Notification(title, {
    body: options.body,
    tag: options.tag,
  });

  notification.onclick = () => {
    window.focus();
  };
}
