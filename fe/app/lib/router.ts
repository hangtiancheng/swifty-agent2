import type { Router } from "@lit-labs/router";

/* SPA navigation helpers around @lit-labs/router.
   The Router's global click interceptor pushes the full href into history but
   only feeds `pathname` to goto() — query strings never reach route matching.
   Pages that ride the URL (?label=, ?status=, ?page=) therefore receive
   `location.search` as a property from their route render callback, and
   programmatic navigation goes through navigate() below, which updates history
   first and then triggers the route re-render. */

let activeRouter: Router | null = null;

export function setRouter(router: Router): void {
  activeRouter = router;
}

/** Programmatic in-app navigation that preserves query strings. */
export function navigate(url: string): void {
  const u = new URL(url, location.href);
  if (u.href === location.href) {
    return;
  }
  history.pushState({}, "", u.href);
  void activeRouter?.goto(u.pathname);
}

export function setPageTitle(title: string): void {
  document.title = title;
}
