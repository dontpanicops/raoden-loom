import type { BrowserWindowConstructorOptions } from "electron";

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "frame" | "titleBarStyle" | "trafficLightPosition"
>;

export function mainWindowChromeOptions(
  platform: NodeJS.Platform = process.platform
): WindowChromeOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 16, y: 15 }
    };
  }

  return { frame: false };
}
