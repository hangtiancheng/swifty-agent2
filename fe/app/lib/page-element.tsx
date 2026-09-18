import { state } from "@swifty.js/lit-jsx";

import { Btn } from "~/components/ui";
import { errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { Icon } from "~/lib/icons";
import { LightElement } from "~/lib/light-element";
import { setPageTitle } from "~/lib/router";

/** Base for route pages (replaces React Router's clientLoader + useRevalidator):
    sets the document title, scrolls to top on mount, loads data once on connect,
    and exposes reload() for the Refresh button / job-finish callbacks.
    Pages render three states: loading (no data yet) → error → data. */
export abstract class DataLoaderElement<T> extends LightElement {
  @state() protected data: T | null = null;
  @state() protected loadError = "";
  @state() protected loading = false;

  private everLoaded = false;
  protected pageTitle = "MeowMeow Select";

  override connectedCallback(): void {
    super.connectedCallback();
    setPageTitle(this.pageTitle);
    window.scrollTo(0, 0);
    if (!this.everLoaded) {
      this.everLoaded = true;
      void this.reload();
    }
  }

  /** Fetch this page's data; throw on failure (reload turns it into loadError). */
  protected abstract load(): Promise<T>;

  protected async reload(): Promise<void> {
    this.loading = true;
    try {
      this.data = await this.load();
      this.loadError = "";
    } catch (e) {
      this.loadError = errMsg(e);
      this.data = null;
    }
    this.loading = false;
  }

  /** The Refresh button every page's top bar carries. */
  protected refreshBtn() {
    return (
      <Btn
        onClick={() => {
          void this.reload();
        }}
        disabled={this.loading}
      >
        <Icon
          name="refresh-cw"
          class={cn("h-4 w-4", this.loading && "animate-spin")}
        />
        Refresh
      </Btn>
    );
  }
}
