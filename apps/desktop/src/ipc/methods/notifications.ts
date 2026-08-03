import { DesktopNotificationOptionsSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const showNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SHOW_NOTIFICATION_CHANNEL,
  payload: DesktopNotificationOptionsSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.notifications.show")(function* (input) {
    const notification = new Electron.Notification({
      title: input.title,
      body: input.body ?? "",
    });
    notification.show();
  }),
});
