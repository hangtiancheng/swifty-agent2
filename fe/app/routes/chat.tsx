import { createRef, customElement, state } from "@swifty.js/lit-jsx";

import "~/components/chat/cite-popover";
import "~/components/chat/message-bubble";
import "~/components/chat/modals";
import "~/components/chat/sidebar";
import "~/components/lottie";
import "~/components/theme-toggle";
import {
  CONV_KEY,
  REPLAY_ACTIONS,
  SUGGESTIONS,
  getUserId,
  type BotMsg,
  type Msg,
} from "~/components/chat/chat-state";
import type { CiteTarget } from "~/components/chat/cite-popover";
import type { BubbleCallbacks } from "~/components/chat/message-bubble";
import { api, jsonPost } from "~/lib/api";
import { Icon } from "~/lib/icons";
import { LightElement } from "~/lib/light-element";
import { enterOnce } from "~/lib/motion";
import { setPageTitle } from "~/lib/router";
import { readSSEStream } from "~/lib/sse";
import type { ConversationItem, HistoryMessage } from "~/lib/types";

/* Chat page: SSE streaming, conversation sidebar, interrupts (order picker /
   ticket confirm), actions (transfer / ticket / refund), citations and feedback.
   All of the React useChat hook's logic lives on this element now — messages are
   updated immutably so each <message-bubble> only re-renders when its own msg
   object changes (the Lit property-identity equivalent of React.memo). */

@customElement("chat-page")
export class ChatPage extends LightElement {
  @state() private messages: Msg[] = [];
  @state() private busy = false;
  @state() private conversations: ConversationItem[] = [];
  @state() private conversationId: number | null = null;
  @state() private drawer = false;
  @state() private cite: CiteTarget | null = null;
  @state() private ticketFor: number | null = null;
  @state() private refundFor: { msgId: number; order: string } | null = null;

  private nextId = 1;
  private busyFlag = false;
  private listRef = createRef<HTMLDivElement>();
  private inputRef = createRef<HTMLTextAreaElement>();

  /** Stable callback bundle handed to every bubble (identity never changes, so
      bubbles don't re-render because of it). */
  private cb: BubbleCallbacks = {
    onCite: (c, el) => {
      this.cite = { c, rect: el.getBoundingClientRect() };
    },
    onFeedback: (id, rating) => {
      this.giveFeedback(id, rating);
    },
    onTransfer: () => {
      this.transferHuman();
    },
    onCreateTicket: (msgId) => {
      this.ticketFor = msgId;
    },
    onRefund: (msgId, draft) => {
      this.refundFor = { msgId, order: draft.order_id ?? "" };
    },
    onPickOrderResume: (msgId, o) => {
      this.markDecided(msgId);
      void this.resume("I choose order " + o.order_id, {
        order_id: o.order_id,
      });
    },
    onPickOrderAsk: (msgId, o) => {
      this.markDecided(msgId);
      void this.send("Look up order " + o.order_id);
    },
    onConfirmTicket: (msgId, confirmed) => {
      this.markDecided(msgId);
      void this.resume(
        confirmed ? "Confirm ticket submission" : "Cancel ticket creation",
        { confirmed },
      );
    },
  };

  override connectedCallback(): void {
    super.connectedCallback();
    setPageTitle("MeowMeow Select · AI Assistant");
    // Chat page renders client-side only (SPA); restore the current conversation id
    const v = localStorage.getItem(CONV_KEY);
    this.conversationId = v ? Number(v) : null;
    getUserId();
    void this.loadConversations();
  }

  protected override updated(
    changed: Map<string | number | symbol, unknown>,
  ): void {
    // Scroll to the bottom after every message update
    if (changed.has("messages")) {
      const el = this.listRef.value;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
    // Focus the input when idle (after sending, switching conversations, or new chat)
    if (changed.has("busy") && !this.busy) {
      this.inputRef.value?.focus();
    }
  }

  /** The composer textarea is uncontrolled (no value binding): lit-jsx commits
      props as property writes, and re-writing .value on every keystroke would
      reset the caret. State lives in the DOM; we only touch it programmatically
      to clear after send. */
  private growInput(): void {
    const el = this.inputRef.value;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${String(Math.min(el.scrollHeight, 128))}px`;
    }
  }

  /* ---------- store plumbing ---------- */

  private persistConvId(id: number | null): void {
    if (id === null) {
      localStorage.removeItem(CONV_KEY);
    } else {
      localStorage.setItem(CONV_KEY, String(id));
    }
    this.conversationId = id;
  }

  private async loadConversations(): Promise<void> {
    try {
      const d = await api<{ items: ConversationItem[] }>(
        "/api/conversations?user_id=" + encodeURIComponent(getUserId()),
      );
      this.conversations = d.items ?? [];
    } catch {
      /* A sidebar failure should not break the chat */
    }
  }

  private updateBot(id: number, fn: (m: BotMsg) => BotMsg): void {
    this.messages = this.messages.map((m) =>
      m.id === id && m.role === "bot" ? fn(m) : m,
    );
  }

  private mkBot(): BotMsg {
    return {
      id: this.nextId++,
      role: "bot",
      raw: "",
      tools: [],
      citations: [],
      actions: [],
      streaming: true,
    };
  }

  /** Render one SSE stream into the given bot message; on interrupt, store the
      conversation id so it can be resumed */
  private async streamInto(
    botId: number,
    doFetch: () => Promise<Response>,
  ): Promise<void> {
    try {
      const resp = await doFetch();
      await readSSEStream(resp, {
        delta: (d) => {
          this.updateBot(botId, (m) => ({ ...m, raw: m.raw + d }));
        },
        tool: (name) => {
          this.updateBot(botId, (m) => ({ ...m, tools: [...m.tools, name] }));
        },
        citations: (items) => {
          this.updateBot(botId, (m) => ({ ...m, citations: items }));
        },
        actions: (items) => {
          this.updateBot(botId, (m) => ({ ...m, actions: items }));
        },
        interrupt: (data) => {
          // Interrupts send no done frame, so capture the conversation id here for resume
          if (data.conversation_id) {
            this.persistConvId(data.conversation_id);
          }
          this.updateBot(botId, (m) => ({
            ...m,
            interrupt: data,
            streaming: false,
          }));
        },
        done: (cid) => {
          this.persistConvId(cid);
        },
      });
      this.updateBot(botId, (m) => ({ ...m, streaming: false }));
    } catch {
      this.updateBot(botId, (m) => ({
        ...m,
        streaming: false,
        error: "Reply failed, please try again",
        raw: "",
        tools: [],
      }));
    }
  }

  /** Send a message and stream the reply */
  private async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || this.busyFlag) {
      return;
    }
    this.busyFlag = true;
    this.busy = true;
    const userMsg: Msg = { id: this.nextId++, role: "user", text: message };
    const botMsg = this.mkBot();
    const bid = botMsg.id;
    this.messages = [...this.messages, userMsg, botMsg];
    try {
      await this.streamInto(bid, () =>
        fetch(
          "/api/chat",
          jsonPost({
            user_id: getUserId(),
            message,
            conversation_id: this.conversationId,
          }),
        ),
      );
    } finally {
      this.busyFlag = false;
      this.busy = false;
      void this.loadConversations(); // Refresh the sidebar after each turn
    }
  }

  /** Resume the graph suspended by an interrupt (pick order / confirm ticket) */
  private async resume(
    userText: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.busyFlag) {
      return;
    }
    this.busyFlag = true;
    this.busy = true;
    const userMsg: Msg = { id: this.nextId++, role: "user", text: userText };
    const botMsg = this.mkBot();
    const bid = botMsg.id;
    this.messages = [...this.messages, userMsg, botMsg];
    try {
      await this.streamInto(bid, () =>
        fetch(
          "/api/actions/resume",
          jsonPost({
            conversation_id: this.conversationId,
            ...payload,
          }),
        ),
      );
    } finally {
      this.busyFlag = false;
      this.busy = false;
    }
  }

  /** Client-side simulation of transferring to a human agent: shows a transferred
      notice + a greeting from Meow (no real agent system) */
  private transferHuman(): void {
    const sys: BotMsg = {
      id: this.nextId++,
      role: "bot",
      raw: "Transferred to a human agent",
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    const greet: BotMsg = {
      id: this.nextId++,
      role: "bot",
      raw: "Hi, I'm Meow from customer support. How can I help you?",
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    this.messages = [...this.messages, sys, greet];
  }

  /** Plain-text system message (ticket created / refund submitted) */
  private pushSystem(text: string): void {
    const sys: BotMsg = {
      id: this.nextId++,
      role: "bot",
      raw: text,
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    this.messages = [...this.messages, sys];
  }

  /** One-shot 👍/👎 feedback: 👎 sends the question to the low-confidence pool for
      the flywheel, 👍 is only logged by the backend; fail silently */
  private giveFeedback(botId: number, rating: "up" | "down"): void {
    const xs = this.messages;
    const idx = xs.findIndex((m) => m.id === botId);
    const target = xs[idx];
    if (target?.role !== "bot" || target.feedback) {
      return;
    }
    // Find the nearest user bubble above this reply and pass that turn's original
    // question to the backend (needed for the 👎 pool)
    let question = "";
    for (let i = idx - 1; i >= 0; i--) {
      const m = xs[i];
      if (m?.role === "user") {
        question = m.text;
        break;
      }
    }
    this.updateBot(botId, (m) => ({ ...m, feedback: rating }));
    void fetch(
      "/api/feedback",
      jsonPost({
        conversation_id: this.conversationId,
        rating,
        question,
      }),
    ).catch(() => undefined);
  }

  private markDecided(botId: number): void {
    this.updateBot(botId, (m) => ({ ...m, decided: true }));
  }

  private markActed(botId: number): void {
    this.updateBot(botId, (m) => ({ ...m, acted: true }));
  }

  private async switchConversation(cid: number): Promise<void> {
    if (this.busyFlag) {
      return;
    }
    // Skip only when this is already the current conversation with content loaded;
    // right after a refresh the list is empty, so clicking it must still reload
    if (cid === this.conversationId && this.messages.length > 0) {
      return;
    }
    this.persistConvId(cid);
    this.messages = [];
    try {
      const d = await api<{ items: HistoryMessage[] }>(
        "/api/conversations/" + String(cid) + "/messages",
      );
      const msgs: Msg[] = [];
      for (const m of d.items ?? []) {
        if (!m.content) {
          continue;
        }
        if (m.role === "user") {
          msgs.push({ id: this.nextId++, role: "user", text: m.content });
        } else {
          const hit = REPLAY_ACTIONS.find((ra) => m.content.trim() === ra.text);
          msgs.push({
            id: this.nextId++,
            role: "bot",
            raw: m.content,
            tools: [],
            citations: [],
            actions: hit ? hit.actions : [],
            streaming: false,
          });
        }
      }
      this.messages = msgs;
    } catch {
      /* The chat can continue even if history fails to load */
    }
    void this.loadConversations(); // Refresh the active highlight
  }

  private newChat(): void {
    this.persistConvId(null); // Drop the current conversation_id (old one stays in the sidebar)
    this.messages = [];
    void this.loadConversations(); // Clear the active highlight
  }

  private submit(preset?: string): void {
    const el = this.inputRef.value;
    const message = (preset ?? el?.value ?? "").trim();
    if (!message || this.busy) {
      return;
    }
    if (el) {
      el.value = "";
      this.growInput();
    }
    void this.send(message);
  }

  /* ---------- view ---------- */

  private emptyState() {
    return (
      <div class="m-auto flex flex-col items-center px-3 py-6 text-center">
        <div
          ref={(el: Element | undefined) => {
            enterOnce(el, { scale: 0.8, duration: 0.45 });
          }}
          class="bg-primary-container shadow-e2 mb-5 grid h-28 w-28 place-items-center overflow-hidden rounded-3xl"
        >
          <lottie-anim
            src="/lottie/cat-hero.lottie"
            loop
            autoplay
            class="h-24 w-24"
          ></lottie-anim>
        </div>
        <h1
          ref={(el: Element | undefined) => {
            enterOnce(el, { y: 10, duration: 0.4, delay: 0.08 });
          }}
          class="text-headline-small text-on-surface font-medium"
        >
          Hi, I'm Meow
        </h1>
        <p
          ref={(el: Element | undefined) => {
            enterOnce(el, { y: 10, duration: 0.4, delay: 0.14 });
          }}
          class="text-body-medium text-on-surface-variant mt-2 max-w-sm leading-6"
        >
          MeowMeow Select's AI Assistant — ask me about products, orders, and
          after-sales support.
        </p>
        <div class="mt-6 flex max-w-110 flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s, i) => (
            <button
              type="button"
              ref={(el: Element | undefined) => {
                enterOnce(el, {
                  y: 14,
                  duration: 0.35,
                  delay: 0.18 + 0.06 * i,
                });
              }}
              class="bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface text-body-small shadow-e1 cursor-pointer rounded-xl px-4 py-2.5 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
              onClick={() => {
                if (!this.busy) {
                  this.submit(s);
                }
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  protected override render() {
    return (
      <div class="bg-card flex h-dvh w-full overflow-hidden">
        <conv-sidebar
          className="max-md:hidden"
          items={this.conversations}
          current={this.conversationId}
          busy={this.busy}
          onSwitch={(id: number) => {
            void this.switchConversation(id);
          }}
        ></conv-sidebar>
        <div class="flex min-w-0 flex-1 flex-col">
          <header class="border-outline-variant flex items-center gap-3 border-b px-3 py-3 sm:px-5">
            <button
              type="button"
              class="text-on-surface-variant hover:bg-on-surface/8 active:bg-on-surface/12 grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-200 md:hidden"
              onClick={() => {
                this.drawer = true;
              }}
              aria-label="Open conversation list"
            >
              <Icon name="menu" class="h-5 w-5" />
            </button>
            <div class="bg-primary-container grid h-11 w-11 shrink-0 place-items-center rounded-2xl">
              <Icon
                name="cat"
                class="text-primary h-6.5 w-6.5"
                strokeWidth={1.5}
              />
            </div>
            <div class="flex min-w-0 flex-col leading-tight">
              <span class="text-title-medium text-on-surface truncate">
                Meow · AI Assistant
              </span>
              <span class="text-label-small text-on-surface-variant flex items-center gap-1.5">
                <span class="bg-success h-2 w-2 rounded-full" />
                Online · MeowMeow Select
              </span>
            </div>
            <div class="flex-1" />
            <theme-toggle></theme-toggle>
            <button
              type="button"
              class="bg-secondary-container text-on-secondary-container hover:bg-secondary-container-hover text-label-large flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 transition-all duration-200 active:scale-[0.97] max-sm:px-3"
              onClick={() => {
                this.newChat();
              }}
            >
              <Icon name="plus" class="h-4.5 w-4.5" />
              <span class="max-sm:hidden">New chat</span>
            </button>
          </header>

          <div ref={this.listRef} class="scroll-slim flex-1 overflow-y-auto">
            <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-3 pt-5 pb-2 sm:px-5">
              {this.messages.length === 0
                ? this.emptyState()
                : this.messages.map((m) => (
                    <message-bubble key={m.id} msg={m} cb={this.cb} />
                  ))}
            </div>
          </div>

          <footer class="border-outline-variant border-t p-3 sm:p-4">
            <div class="mx-auto w-full max-w-3xl">
              <div class="bg-surface-container-high focus-within:shadow-e2 flex items-end gap-2 rounded-2xl px-4 py-2.5 transition-shadow duration-200">
                <textarea
                  ref={this.inputRef}
                  rows={1}
                  disabled={this.busy}
                  placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
                  onInput={() => {
                    this.growInput();
                  }}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      this.submit();
                    }
                  }}
                  class="placeholder:text-on-surface-variant text-on-surface max-h-32 flex-1 resize-none border-none bg-transparent p-1.5 text-[15px] leading-normal outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  aria-label="Send"
                  disabled={this.busy}
                  onClick={() => {
                    this.submit();
                  }}
                  class="bg-primary text-on-primary hover:bg-primary-hover hover:shadow-e1 disabled:bg-on-surface/12 disabled:text-on-surface-variant grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  <Icon name="send" class="h-5 w-5" />
                </button>
              </div>
              <p class="text-on-surface-variant text-label-small mt-2.5 text-center">
                Meow is an AI assistant. For questions about specific orders,
                we'll transfer you to a human agent to verify.
              </p>
            </div>
          </footer>
        </div>

        <mobile-drawer
          open={this.drawer}
          onClose={() => {
            this.drawer = false;
          }}
          items={this.conversations}
          current={this.conversationId}
          busy={this.busy}
          onSwitch={(id: number) => {
            void this.switchConversation(id);
          }}
          onNewChat={() => {
            this.newChat();
          }}
        ></mobile-drawer>
        <cite-popover
          target={this.cite}
          onClose={() => {
            this.cite = null;
          }}
        ></cite-popover>
        <ticket-modal
          open={this.ticketFor !== null}
          conversationId={this.conversationId}
          onClose={() => {
            this.ticketFor = null;
          }}
          onSuccess={(no: string) => {
            if (this.ticketFor !== null) {
              this.markActed(this.ticketFor);
            }
            this.ticketFor = null;
            this.pushSystem("Ticket created: " + no);
          }}
        ></ticket-modal>
        <refund-modal
          open={this.refundFor !== null}
          order={this.refundFor?.order ?? ""}
          conversationId={this.conversationId}
          onClose={() => {
            this.refundFor = null;
          }}
          onSuccess={(no: string) => {
            if (this.refundFor) {
              this.markActed(this.refundFor.msgId);
            }
            this.refundFor = null;
            this.pushSystem("Refund request submitted: " + no);
          }}
        ></refund-modal>
      </div>
    );
  }
}
