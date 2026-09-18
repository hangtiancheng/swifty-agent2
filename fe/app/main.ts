import { DotLottie } from "@lottiefiles/dotlottie-web";
import "./app.css";
import "~/components/app-shell";
import "~/components/toast";
import { createRoot, html } from "@swifty.js/lit-jsx";

// Self-host the dotLottie player WASM (no CDN at runtime) and warm it up before
// the first animation needs it.
DotLottie.setWasmUrl("/wasm/dotlottie-player.wasm");
void DotLottie.preload();

const container = document.getElementById("app") ?? document.body;
container.replaceChildren();
const root = createRoot(container);
root.render(html`<app-shell></app-shell>`);

// Global toast host lives outside the routed outlet so it survives navigation
document.body.appendChild(document.createElement("toast-host"));
