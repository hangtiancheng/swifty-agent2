import { DotLottie } from "@lottiefiles/dotlottie-web";
import { createRef, customElement, property } from "@swifty.js/lit-jsx";

import { LightElement } from "~/lib/light-element";

/** Decorative Lottie animation (dotLottie player). Assets are self-hosted under
    /lottie/ and the player WASM under /wasm/ (wired up in main.ts via
    DotLottie.setWasmUrl) — no runtime CDN dependency. Size the host element with
    a class; the canvas fills it. */
@customElement("lottie-anim")
export class LottieAnim extends LightElement {
  @property() src = "";
  @property({ type: Boolean }) loop = true;
  @property({ type: Boolean }) autoplay = true;

  private player?: DotLottie;
  private canvasRef = createRef<HTMLCanvasElement>();

  protected override updated(
    changed: Map<string | number | symbol, unknown>,
  ): void {
    if (!this.player) {
      const canvas = this.canvasRef.value;
      if (!canvas || !this.src) {
        return;
      }
      this.player = new DotLottie({
        canvas,
        src: this.src,
        loop: this.loop,
        autoplay: this.autoplay,
        renderConfig: { autoResize: true },
      });
      return;
    }
    if (changed.has("src")) {
      this.player.load({ src: this.src });
    }
    if (changed.has("loop")) {
      this.player.setLoop(this.loop);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.player?.destroy();
    this.player = undefined;
  }

  protected override render() {
    return <canvas ref={this.canvasRef} class="block h-full w-full" />;
  }
}
