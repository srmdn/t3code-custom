import type { ClientSettings, NotificationSoundPreset } from "@t3tools/contracts/settings";

import inputUrl from "./assets/notification-input.mp3";

type NotificationMode = ClientSettings["notificationMode"];
export const NOTIFICATION_MODE_LABELS = {
  off: "Off",
  notifications: "Notifications only",
  sound: "Sound only",
  "notifications-and-sound": "Notifications with sound",
} satisfies Record<NotificationMode, string>;

export const NOTIFICATION_SOUND_PRESET_LABELS = {
  codex: "Codex",
  ping: "Ping",
  "classic-ding-dong": "Classic Ding-Dong",
  hero: "Hero",
  "rich-double": "Rich Double",
} satisfies Record<NotificationSoundPreset, string>;

const COMPLETION_SOUND_URLS = {
  "classic-ding-dong": "/sounds/classic-ding-dong.wav",
  codex: "/sounds/codex.wav",
  hero: "/sounds/hero.wav",
  ping: "/sounds/ping.wav",
  "rich-double": "/sounds/rich-double.wav",
} satisfies Record<NotificationSoundPreset, string>;

const DEFAULT_COMPLETION_SOUND_PRESET: NotificationSoundPreset = "codex";
const DEFAULT_COMPLETION_SOUND_VOLUME = 80;

function clampVolumeGain(volume: number): number {
  return Math.max(0, Math.min(1, volume / 100));
}

export function hasNotificationSound(mode: NotificationMode) {
  return mode === "sound" || mode === "notifications-and-sound";
}

export function hasDesktopNotifications(mode: NotificationMode) {
  return mode === "notifications" || mode === "notifications-and-sound";
}

let originalFavicon: HTMLLinkElement | undefined;
let badgeFavicon: HTMLLinkElement | undefined;

export function setNotificationBadge(count: number) {
  const bridge = window.desktopBridge;
  let image: string | null = null;
  if (count > 0 && (!bridge || bridge.getClientPlatform?.() === "win32")) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#e5484d";
      context.beginPath();
      context.arc(32, 32, 28, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.font = `600 ${count > 9 ? 30 : 40}px "Segoe UI", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(count > 9 ? "9+" : String(count), 32, 34);
      image = canvas.toDataURL("image/png");
    }
  }
  if (!bridge) {
    if (image) {
      if (!badgeFavicon) {
        originalFavicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? undefined;
        badgeFavicon = document.createElement("link");
        badgeFavicon.rel = "icon";
        badgeFavicon.type = "image/png";
        badgeFavicon.sizes.value = "64x64";
        originalFavicon?.remove();
        document.head.append(badgeFavicon);
      }
      badgeFavicon.href = image;
    } else if (badgeFavicon) {
      badgeFavicon.remove();
      badgeFavicon = undefined;
      if (originalFavicon) document.head.append(originalFavicon);
      originalFavicon = undefined;
    }
  }
  void bridge?.setNotificationBadge?.({ count, image }).catch(() => undefined);
}

let audioContext: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();

/** Called from a gesture so browsers allow later background playback. */
export function unlockNotificationAudio() {
  audioContext ??= new AudioContext();
  void audioContext.resume().catch(() => undefined);
}

export async function playNotificationSound(
  kind: "completion" | "input",
  shouldPlay: () => boolean,
  options?: {
    readonly preset?: NotificationSoundPreset;
    readonly volume?: number;
  },
) {
  if (!audioContext || audioContext.state !== "running") return;
  const context = audioContext;
  const url =
    kind === "completion"
      ? COMPLETION_SOUND_URLS[options?.preset ?? DEFAULT_COMPLETION_SOUND_PRESET]
      : inputUrl;
  const gain =
    kind === "completion" ? clampVolumeGain(options?.volume ?? DEFAULT_COMPLETION_SOUND_VOLUME) : 1;
  try {
    let buffer = buffers.get(url);
    if (!buffer) {
      buffer = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data));
      buffers.set(url, buffer);
    }
    const decoded = await buffer;
    if (!shouldPlay() || context.state !== "running") return;
    const source = context.createBufferSource();
    source.buffer = decoded;
    if (gain >= 1) {
      source.connect(context.destination);
    } else {
      const gainNode = context.createGain();
      gainNode.gain.value = gain;
      source.connect(gainNode);
      gainNode.connect(context.destination);
    }
    source.start();
  } catch {
    buffers.delete(url);
  }
}

/**
 * Play the selected completion preset on demand (the settings preview button).
 * Resumes the shared audio context first, since the click is a valid gesture.
 */
export async function previewNotificationSound(
  preset: NotificationSoundPreset,
  volume: number,
): Promise<void> {
  unlockNotificationAudio();
  await audioContext?.resume().catch(() => undefined);
  await playNotificationSound("completion", () => true, { preset, volume });
}
