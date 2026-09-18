import { Router, type RouteConfig } from "@lit-labs/router";
import { customElement } from "@swifty.js/lit-jsx";

import "~/routes/acceptance/data";
import "~/routes/acceptance/errors";
import "~/routes/acceptance/eval";
import "~/routes/acceptance/index";
import "~/routes/admin";
import "~/routes/chat";
import "~/routes/kb";
import "~/routes/not-found";
import "~/routes/observability";
import "~/routes/rageval";
import "~/routes/review";
import "~/routes/topic-questions";
import "~/routes/topics";
import { LightElement } from "~/lib/light-element";
import { setRouter } from "~/lib/router";

/* Route table (replaces the React Router routes.ts config). Query strings ride
   location.search — the Router only matches pathnames — so pages that depend on
   them (?label=, ?status=, ?page=) receive the current search as a property
   from their render callback and reload when it changes. */
const routes: RouteConfig[] = [
  { path: "/", render: () => <chat-page /> },
  { path: "/admin", render: () => <admin-page /> },
  { path: "/kb", render: () => <kb-page /> },
  { path: "/rag-eval", render: () => <rageval-page /> },
  { path: "/review", render: () => <review-page search={location.search} /> },
  { path: "/observability", render: () => <observability-page /> },
  { path: "/topics/questions", render: () => <topic-questions-page search={location.search} /> },
  { path: "/topics", render: () => <topics-page /> },
  { path: "/acceptance", render: () => <acceptance-page /> },
  { path: "/acceptance/eval", render: () => <acceptance-eval-page /> },
  { path: "/acceptance/data", render: () => <acceptance-data-page /> },
  { path: "/acceptance/errors", render: () => <acceptance-errors-page /> },
];

@customElement("app-shell")
export class AppShell extends LightElement {
  private router = new Router(this, routes, {
    fallback: { render: () => <not-found-page /> },
  });

  override connectedCallback(): void {
    super.connectedCallback();
    setRouter(this.router);
  }

  protected override render() {
    return this.router.outlet();
  }
}
