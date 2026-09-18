import { unsafeHTML } from "lit/directives/unsafe-html.js";
import catSvg from "lucide-static/icons/cat.svg?raw";
import circleAlertSvg from "lucide-static/icons/circle-alert.svg?raw";
import circleCheckSvg from "lucide-static/icons/circle-check.svg?raw";
import clipboardListSvg from "lucide-static/icons/clipboard-list.svg?raw";
import loaderCircleSvg from "lucide-static/icons/loader-circle.svg?raw";
import menuSvg from "lucide-static/icons/menu.svg?raw";
import messageSquareSvg from "lucide-static/icons/message-square.svg?raw";
import moonSvg from "lucide-static/icons/moon.svg?raw";
import plusSvg from "lucide-static/icons/plus.svg?raw";
import refreshCwSvg from "lucide-static/icons/refresh-cw.svg?raw";
import rotateCwSvg from "lucide-static/icons/rotate-cw.svg?raw";
import searchSvg from "lucide-static/icons/search.svg?raw";
import sendSvg from "lucide-static/icons/send.svg?raw";
import sunSvg from "lucide-static/icons/sun.svg?raw";
import thumbsDownSvg from "lucide-static/icons/thumbs-down.svg?raw";
import thumbsUpSvg from "lucide-static/icons/thumbs-up.svg?raw";
import wrenchSvg from "lucide-static/icons/wrench.svg?raw";
import xSvg from "lucide-static/icons/x.svg?raw";

/* Icons come from lucide-static: the raw SVG files are bundled at build time
   (vite ?raw imports) and injected inline, so they inherit currentColor and are
   sized by the CSS class — same visual contract as the lucide-react components
   they replace, with no runtime icon package. */

const SVGS = {
  cat: catSvg,
  "circle-alert": circleAlertSvg,
  "circle-check": circleCheckSvg,
  "clipboard-list": clipboardListSvg,
  "loader-circle": loaderCircleSvg,
  menu: menuSvg,
  "message-square": messageSquareSvg,
  moon: moonSvg,
  plus: plusSvg,
  "refresh-cw": refreshCwSvg,
  "rotate-cw": rotateCwSvg,
  search: searchSvg,
  send: sendSvg,
  sun: sunSvg,
  "thumbs-down": thumbsDownSvg,
  "thumbs-up": thumbsUpSvg,
  wrench: wrenchSvg,
  x: xSvg,
} satisfies Record<string, string>;

export type IconName = keyof typeof SVGS;

export interface IconProps {
  name: IconName;
  /** Tailwind sizing classes applied to the <svg> (default "h-5 w-5") */
  class?: string;
  strokeWidth?: number;
}

/** Inline a lucide icon. The SVG source is a trusted build-time constant from
    lucide-static; only the class/stroke-width substitutions below are dynamic
    and both come from internal call sites, never from user data. */
export function Icon({ name, class: cls, strokeWidth }: IconProps) {
  let svg = SVGS[name]
    .replace(/<!--[\s\S]*?-->\s*/, "")
    .replace(/class="[^"]*"/, `class="${cls ?? "h-5 w-5"}"`)
    .replace("<svg", '<svg aria-hidden="true"');
  if (strokeWidth !== undefined) {
    svg = svg.replace(
      /stroke-width="[\d.]+"/,
      `stroke-width="${String(strokeWidth)}"`,
    );
  }
  return unsafeHTML(svg);
}
