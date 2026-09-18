import { LitElement } from "@swifty.js/lit-jsx";

/** Base class for every element in this app: renders into the light DOM so the
    global Tailwind stylesheet applies (styles don't cross shadow roots). Style
    isolation is deliberately traded away — the app is one design system. */
export class LightElement extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }
}
