import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { useToast } from "~/components/toast";
import { Btn } from "~/components/ui";
import { api, jsonPost } from "~/lib/api";

/* 建工单 / 退款两个表单弹窗(原 index.html)。
   提交成功回调 onSuccess(工单号),由页面置灰触发按钮并追加系统消息。 */

const FIELD_LABEL = "mb-1.5 block text-[12.5px] font-bold";
const FIELD_INPUT =
  "w-full border-3 border-ink bg-cream p-2.5 text-[13px] text-ink shadow-hard-sm outline-none focus:bg-paper";

function ModalShell({
  open,
  title,
  sub,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  sub: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="scroll-cat max-h-[90dvh] w-full max-w-[420px] overflow-y-auto border-4 border-ink bg-paper p-5 shadow-hard-lg"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.16 }}
          >
            <h3 className="text-base font-bold">{title}</h3>
            <p className="mt-1 mb-4 text-xs text-muted">{sub}</p>
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function FieldError({ text }: { text: string }) {
  return (
    <div className="-mt-1.5 mb-2.5 min-h-4 text-xs text-error">{text}</div>
  );
}

export function TicketModal({
  open,
  conversationId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  conversationId: number | null;
  onClose: () => void;
  onSuccess: (ticketNo: string) => void;
}) {
  const [type, setType] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置:不预选类别、留空描述,用户自己填。
  // 弹窗带退场动画不能靠卸载重置,只能在 open 变 true 时同步清状态
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开瞬间重置表单是有意的同步行为
      setType("");
      setDesc("");
      setErr("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    if (!type) {
      setErr("请选择反馈类别");
      return;
    }
    if (!desc.trim()) {
      setErr("请填写反馈描述");
      return;
    }
    setErr("");
    setSubmitting(true);
    try {
      const d = await api<{ ticket_no: string }>(
        "/api/actions/create-ticket",
        jsonPost({
          conversation_id: conversationId,
          description: desc.trim(),
          ticket_type: type,
        }),
      );
      onSuccess(d.ticket_no);
    } catch {
      setErr("工单创建失败,请稍后重试");
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      open={open}
      title="创建工单"
      sub="小喵会把问题登记成工单跟进处理"
      onClose={onClose}
    >
      <div className="mb-3.5">
        <label className={FIELD_LABEL} htmlFor="ticketType">
          反馈类别 <span className="text-error">*</span>
        </label>
        <select
          id="ticketType"
          className={FIELD_INPUT}
          value={type}
          onChange={(e) => { setType(e.target.value); }}
        >
          <option value="" disabled>
            请选择反馈类别…
          </option>
          <option value="售后">售后</option>
          <option value="投诉">投诉</option>
          <option value="咨询">咨询</option>
        </select>
      </div>
      <div className="mb-3.5">
        <label className={FIELD_LABEL} htmlFor="ticketDesc">
          反馈描述 <span className="text-error">*</span>
        </label>
        <textarea
          id="ticketDesc"
          className={FIELD_INPUT + " min-h-22 resize-y"}
          placeholder="请描述您遇到的问题…"
          value={desc}
          onChange={(e) => { setDesc(e.target.value); }}
        />
      </div>
      <FieldError text={err} />
      <div className="flex justify-end gap-2.5">
        <Btn onClick={onClose}>取消</Btn>
        <Btn
          variant="go"
          disabled={submitting}
          onClick={() => {
            void submit();
          }}
        >
          {submitting ? "提交中…" : "提交工单"}
        </Btn>
      </div>
    </ModalShell>
  );
}

export function RefundModal({
  open,
  order,
  conversationId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  order: string;
  conversationId: number | null;
  onClose: () => void;
  onSuccess: (ticketNo: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  // 同 TicketModal:打开瞬间重置,退场动画期间不能卸载
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开瞬间重置表单是有意的同步行为
      setReason("");
      setErr("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    if (!reason) {
      setErr("请选择退款原因");
      return;
    }
    setErr("");
    setSubmitting(true);
    try {
      const d = await api<{ ticket_no: string }>(
        "/api/actions/create-refund",
        jsonPost({ conversation_id: conversationId, order_id: order, reason }),
      );
      onSuccess(d.ticket_no);
    } catch {
      setErr("退款提交失败,请稍后重试");
      setSubmitting(false);
      toast("退款提交失败,请稍后重试", true);
    }
  };

  return (
    <ModalShell
      open={open}
      title="提交退款工单"
      sub="确认订单与退款原因后提交,小喵会为您登记退款申请"
      onClose={onClose}
    >
      <div className="mb-3.5">
        <label className={FIELD_LABEL} htmlFor="refundOrder">
          订单号
        </label>
        <input
          id="refundOrder"
          type="text"
          readOnly
          value={order}
          className={FIELD_INPUT + " cursor-not-allowed bg-track text-muted"}
        />
      </div>
      <div className="mb-3.5">
        <label className={FIELD_LABEL} htmlFor="refundReason">
          退款原因 <span className="text-error">*</span>
        </label>
        <select
          id="refundReason"
          className={FIELD_INPUT}
          value={reason}
          onChange={(e) => { setReason(e.target.value); }}
        >
          <option value="" disabled>
            请选择退款原因…
          </option>
          <option value="七天无理由">七天无理由</option>
          <option value="质量问题">质量问题</option>
          <option value="发错货">发错货</option>
          <option value="不想要了">不想要了</option>
          <option value="其他">其他</option>
        </select>
      </div>
      <FieldError text={err} />
      <div className="flex justify-end gap-2.5">
        <Btn onClick={onClose}>取消</Btn>
        <Btn
          variant="go"
          disabled={submitting}
          onClick={() => {
            void submit();
          }}
        >
          {submitting ? "提交中…" : "提交退款"}
        </Btn>
      </div>
    </ModalShell>
  );
}
