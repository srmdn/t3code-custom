import { useState } from "react";
import type { CSSProperties } from "react";

import {
  MAX_NOTIFICATION_SOUND_VOLUME,
  MIN_NOTIFICATION_SOUND_VOLUME,
} from "@t3tools/contracts/settings";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  NOTIFICATION_SOUND_PRESET_LABELS,
  previewNotificationSound,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const soundPreset = useScopedSettings((settings) => settings.notificationSoundPreset);
  const soundVolume = useScopedSettings((settings) => settings.notificationSoundVolume);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const soundEnabled = hasNotificationSound(mode);
  const volumeRatio =
    (soundVolume - MIN_NOTIFICATION_SOUND_VOLUME) /
    (MAX_NOTIFICATION_SOUND_VOLUME - MIN_NOTIFICATION_SOUND_VOLUME);
  const volumeSliderStyle = {
    "--settings-slider-progress": `${volumeRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - volumeRatio}rem`,
  } as CSSProperties;

  return (
    <>
      <SettingsRow
        {...searchableSetting("thread-notifications")}
        description={
          permissionMessage ??
          "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open."
        }
        control={
          <Select
            value={mode}
            disabled={requesting}
            onValueChange={async (value) => {
              if (
                value !== "off" &&
                value !== "notifications" &&
                value !== "sound" &&
                value !== "notifications-and-sound"
              )
                return;
              setPermissionMessage(null);
              if (hasNotificationSound(value)) unlockNotificationAudio();
              if (hasDesktopNotifications(value)) {
                if (typeof Notification === "undefined" || !window.isSecureContext) {
                  setPermissionMessage(
                    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                  );
                  return;
                }
                setRequesting(true);
                try {
                  const permission = await Notification.requestPermission();
                  if (permission !== "granted") {
                    setPermissionMessage(
                      "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                    );
                    return;
                  }
                } catch {
                  setPermissionMessage(
                    "Notifications are unavailable in this browser. Sound only is still available.",
                  );
                  return;
                } finally {
                  setRequesting(false);
                }
              }
              updateSettings({ notificationMode: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
              <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />

      {soundEnabled ? (
        <SettingsRow
          {...searchableSetting("notification-sound")}
          description="The chime played when a thread finishes. Preview it before you commit."
          control={
            <div className="flex w-full items-center gap-2 sm:w-56">
              <Select
                value={soundPreset}
                onValueChange={(value) => {
                  if (typeof value === "string" && value in NOTIFICATION_SOUND_PRESET_LABELS) {
                    updateSettings({
                      notificationSoundPreset:
                        value as keyof typeof NOTIFICATION_SOUND_PRESET_LABELS,
                    });
                  }
                }}
              >
                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Notification sound">
                  <SelectValue>{NOTIFICATION_SOUND_PRESET_LABELS[soundPreset]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(NOTIFICATION_SOUND_PRESET_LABELS).map(([value, label]) => (
                    <SelectItem key={value} hideIndicator value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void previewNotificationSound(soundPreset, soundVolume);
                }}
              >
                Preview
              </Button>
            </div>
          }
        />
      ) : null}

      {soundEnabled ? (
        <SettingsRow
          {...searchableSetting("notification-sound-volume")}
          description="How loud the completion chime plays."
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="notification-sound-volume"
              >
                {soundVolume}%
              </output>
              <input
                aria-label="Notification sound volume"
                className="settings-slider min-w-0 flex-1"
                id="notification-sound-volume"
                max={MAX_NOTIFICATION_SOUND_VOLUME}
                min={MIN_NOTIFICATION_SOUND_VOLUME}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(next) &&
                    next >= MIN_NOTIFICATION_SOUND_VOLUME &&
                    next <= MAX_NOTIFICATION_SOUND_VOLUME
                  ) {
                    updateSettings({ notificationSoundVolume: next });
                  }
                }}
                step={5}
                style={volumeSliderStyle}
                type="range"
                value={soundVolume}
              />
            </div>
          }
        />
      ) : null}
    </>
  );
}
