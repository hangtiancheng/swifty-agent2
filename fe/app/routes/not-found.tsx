import { customElement } from "@swifty.js/lit-jsx";

import "~/components/lottie";
import { BtnLink } from "~/components/ui";
import { LightElement } from "~/lib/light-element";
import { enterOnce } from "~/lib/motion";
import { setPageTitle } from "~/lib/router";

@customElement("not-found-page")
export class NotFoundPage extends LightElement {
  override connectedCallback(): void {
    super.connectedCallback();
    setPageTitle("MeowMeow Select · Not Found");
  }

  protected override render() {
    return (
      <main class="bg-surface flex min-h-dvh items-center justify-center p-4">
        <div
          ref={(el: Element | undefined) => {
            enterOnce(el, { y: 16, duration: 0.35 });
          }}
          class="bg-card shadow-e3 w-full max-w-md rounded-xl p-8 text-center"
        >
          <lottie-anim src="/lottie/notfound.lottie" loop autoplay class="mx-auto h-40 w-40"></lottie-anim>
          <h1 class="text-headline-medium text-on-surface mt-2 font-medium">404</h1>
          <p class="text-body-medium text-on-surface-variant mt-2 leading-6">
            This page does not exist. Ask the AI Assistant on the chat page, or head back to the Admin Console.
          </p>
          <div class="mt-7 flex flex-wrap justify-center gap-2.5">
            <BtnLink to="/" variant="go">
              Back to chat
            </BtnLink>
            <BtnLink to="/admin">Admin Console</BtnLink>
          </div>
        </div>
      </main>
    );
  }
}
