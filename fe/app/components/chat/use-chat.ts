import { useCallback, useEffect, useRef, useState } from "react";

import { api, jsonPost } from "~/lib/api";
import { readSSEStream } from "~/lib/sse";
import type {
  ActionItem,
  Citation,
  ConversationItem,
  HistoryMessage,
  InterruptFrame,
} from "~/lib/types";

const SESSION_KEY = "mewhelp_session_id"; // 稳定用户标识,作 user_id
const CONV_KEY = "mewhelp_conversation_id"; // 当前会话 id,由后端 done 帧回传

export const SUGGESTIONS = [
  "退换货政策是怎样的?",
  "怎么查我的物流进度?",
  "猫粮怎么选?",
  "会员有什么权益?",
];

/** 历史回载时补挂按钮:suggested_actions 不落库,但这两句话术是固定文案,
    且转人工/建工单按钮不依赖当轮上下文(转人工纯前端模拟,建工单表单用户现填),
    按文案精确匹配重建即可。话术改了这里要跟着改(单一来源在后端 prompts.py)。 */
const REPLAY_ACTIONS: { text: string; actions: ActionItem[] }[] = [
  {
    text: "抱歉,这个问题我暂时没有查到确切信息,不敢乱答。建议您联系人工客服进一步确认,以免给您错误的指引。",
    actions: [{ type: "transfer_human" }],
  },
  {
    text: "非常抱歉给您带来了不好的体验,我理解您的心情。您可以选择转接人工客服,或让我为您登记一张工单跟进处理。",
    actions: [{ type: "transfer_human" }, { type: "create_ticket", draft: {} }],
  },
];

export interface UserMsg {
  id: number;
  role: "user";
  text: string;
}

export interface BotMsg {
  id: number;
  role: "bot";
  /** 累积的 markdown 原文(plain 消息为纯文本) */
  raw: string;
  tools: string[];
  citations: Citation[];
  actions: ActionItem[];
  interrupt?: InterruptFrame;
  error?: string;
  /** 仍在接收 SSE 帧 */
  streaming: boolean;
  /** 本条已点过 👍/👎 */
  feedback?: "up" | "down";
  /** 中断卡/订单卡已点过,置灰 */
  decided?: boolean;
  /** 建工单/退款提交成功,对应按钮置灰 */
  acted?: boolean;
  /** 纯文本系统消息(转人工模拟、工单已创建等):不走 markdown、无反馈条 */
  plain?: boolean;
}

export type Msg = UserMsg | BotMsg;

function getUserId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function useChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  // 聊天页只在客户端渲染(SPA),初始值直接从 localStorage 恢复当前会话号
  const [conversationId, setConvId] = useState<number | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const v = localStorage.getItem(CONV_KEY);
    return v ? Number(v) : null;
  });
  const nextId = useRef(1);
  const busyRef = useRef(false);
  const messagesRef = useRef(messages);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    messagesRef.current = messages;
    conversationIdRef.current = conversationId;
  });

  const persistConvId = useCallback((id: number | null) => {
    if (id === null) {
      localStorage.removeItem(CONV_KEY);
    } else {
      localStorage.setItem(CONV_KEY, String(id));
    }
    setConvId(id);
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const d = await api<{ items: ConversationItem[] }>(
        "/api/conversations?user_id=" + encodeURIComponent(getUserId()),
      );
      setConversations(d.items ?? []);
    } catch {
      /* 侧栏失败不影响聊天 */
    }
  }, []);

  // 进页面:确保 user_id 存在、先拉会话列表
  useEffect(() => {
    getUserId();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversations();
  }, [loadConversations]);

  const updateBot = useCallback((id: number, fn: (m: BotMsg) => BotMsg) => {
    setMessages((xs) =>
      xs.map((m) => (m.id === id && m.role === "bot" ? fn(m) : m)),
    );
  }, []);

  const mkBot = useCallback((): BotMsg => {
    return {
      id: nextId.current++,
      role: "bot",
      raw: "",
      tools: [],
      citations: [],
      actions: [],
      streaming: true,
    };
  }, []);

  /** 把一次 SSE 流渲染进指定 bot 消息;遇 interrupt 记下会话号供续跑 */
  const streamInto = useCallback(
    async (botId: number, doFetch: () => Promise<Response>) => {
      try {
        const resp = await doFetch();
        await readSSEStream(resp, {
          delta: (d) => { updateBot(botId, (m) => ({ ...m, raw: m.raw + d })); },
          tool: (name) => { updateBot(botId, (m) => ({ ...m, tools: [...m.tools, name] })); },
          citations: (items) => { updateBot(botId, (m) => ({ ...m, citations: items })); },
          actions: (items) => { updateBot(botId, (m) => ({ ...m, actions: items })); },
          interrupt: (data) => {
            // 中断无 done 帧,靠这里记会话号供续跑
            if (data.conversation_id) {
              persistConvId(data.conversation_id);
            }
            updateBot(botId, (m) => ({
              ...m,
              interrupt: data,
              streaming: false,
            }));
          },
          done: (cid) => { persistConvId(cid); },
        });
        updateBot(botId, (m) => ({ ...m, streaming: false }));
      } catch {
        updateBot(botId, (m) => ({
          ...m,
          streaming: false,
          error: "回复失败,请稍后重试",
          raw: "",
          tools: [],
        }));
      }
    },
    [persistConvId, updateBot],
  );

  /** 发一条消息,流式接收回复 */
  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const userMsg: UserMsg = {
        id: nextId.current++,
        role: "user",
        text: message,
      };
      const botMsg = mkBot();
      const bid = botMsg.id;
      setMessages((xs) => [...xs, userMsg, botMsg]);
      try {
        await streamInto(bid, () =>
          fetch(
            "/api/chat",
            jsonPost({
              user_id: getUserId(),
              message,
              conversation_id: conversationIdRef.current,
            }),
          ),
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
        void loadConversations(); // 每轮后刷新侧栏(新会话入列/摘要标记更新)
      }
    },
    [loadConversations, mkBot, streamInto],
  );

  /** 续跑被 interrupt 挂起的图(选订单 / 确认工单) */
  const resume = useCallback(
    async (userText: string, payload: Record<string, unknown>) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const userMsg: UserMsg = {
        id: nextId.current++,
        role: "user",
        text: userText,
      };
      const botMsg = mkBot();
      const bid = botMsg.id;
      setMessages((xs) => [...xs, userMsg, botMsg]);
      try {
        await streamInto(bid, () =>
          fetch(
            "/api/actions/resume",
            jsonPost({
              conversation_id: conversationIdRef.current,
              ...payload,
            }),
          ),
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [mkBot, streamInto],
  );

  /** 纯前端模拟转人工:显示已转接 + 客服小猫问候(不接真人系统) */
  const transferHuman = useCallback(() => {
    const sys: BotMsg = {
      id: nextId.current++,
      role: "bot",
      raw: "已转接人工客服",
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    const greet: BotMsg = {
      id: nextId.current++,
      role: "bot",
      raw: "您好,我是客服小猫,请问有什么可以帮您的",
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    setMessages((xs) => [...xs, sys, greet]);
  }, []);

  /** 纯文本系统消息(工单已创建 / 退款已提交) */
  const pushSystem = useCallback((text: string) => {
    const sys: BotMsg = {
      id: nextId.current++,
      role: "bot",
      raw: text,
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    setMessages((xs) => [...xs, sys]);
  }, []);

  /** 👍/👎 一次性反馈:👎 落低置信度问题池进飞轮,👍 后端只记日志;失败静默 */
  const giveFeedback = useCallback(
    (botId: number, rating: "up" | "down") => {
      const xs = messagesRef.current;
      const idx = xs.findIndex((m) => m.id === botId);
      const target = xs[idx];
      if (target?.role !== "bot" || target.feedback) {
        return;
      }
      // 向上找这条回答之前最近的用户气泡,把该轮用户原话带给后端(👎 落池要用)
      let question = "";
      for (let i = idx - 1; i >= 0; i--) {
        const m = xs[i];
        if (m?.role === "user") {
          question = m.text;
          break;
        }
      }
      updateBot(botId, (m) => ({ ...m, feedback: rating }));
      void fetch(
        "/api/feedback",
        jsonPost({
          conversation_id: conversationIdRef.current,
          rating,
          question,
        }),
      ).catch(() => undefined);
    },
    [updateBot],
  );

  const markDecided = useCallback(
    (botId: number) => { updateBot(botId, (m) => ({ ...m, decided: true })); },
    [updateBot],
  );
  const markActed = useCallback(
    (botId: number) => { updateBot(botId, (m) => ({ ...m, acted: true })); },
    [updateBot],
  );

  const switchConversation = useCallback(
    async (cid: number) => {
      if (busyRef.current) {
        return;
      }
      // 已是当前会话且聊天区有内容才跳过;页面刚刷新时聊天区是空的,点当前会话也要回载
      if (cid === conversationIdRef.current && messagesRef.current.length > 0) {
        return;
      }
      persistConvId(cid);
      setMessages([]);
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
            msgs.push({ id: nextId.current++, role: "user", text: m.content });
          } else {
            const hit = REPLAY_ACTIONS.find(
              (ra) => m.content.trim() === ra.text,
            );
            msgs.push({
              id: nextId.current++,
              role: "bot",
              raw: m.content,
              tools: [],
              citations: [],
              actions: hit ? hit.actions : [],
              streaming: false,
            });
          }
        }
        setMessages(msgs);
      } catch {
        /* 历史加载失败仍可继续聊 */
      }
      void loadConversations(); // 刷新 active 高亮
    },
    [loadConversations, persistConvId],
  );

  const newChat = useCallback(() => {
    persistConvId(null); // 开新会话:丢弃当前 conversation_id(旧会话仍在侧栏可切回)
    setMessages([]);
    void loadConversations(); // 清 active 高亮
  }, [loadConversations, persistConvId]);

  return {
    messages,
    busy,
    conversations,
    conversationId,
    send,
    resume,
    transferHuman,
    pushSystem,
    giveFeedback,
    markDecided,
    markActed,
    switchConversation,
    newChat,
  };
}

export type ChatApi = ReturnType<typeof useChat>;
