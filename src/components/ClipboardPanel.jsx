import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@heroui/react";
import { Check, ChevronRight, ClipboardList, Copy, Image as ImageIcon, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { Icon } from "./Icon";

export function ClipboardFeedbackCapsule({ phase }) {
  const isError = phase === "error";
  return (
    <div className={`clipboard-feedback-capsule ${isError ? "clipboard-feedback-capsule-error" : ""}`} aria-live="polite" aria-label={phase === "loading" ? "正在复制" : isError ? "复制失败" : "复制成功"}>
      <AnimatePresence initial={false} mode="wait">
        {phase === "loading" ? (
          <motion.span key="loading" className="grid place-items-center" initial={{ opacity: 0, scale: 0.55 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.55 }}>
            <span className="clipboard-feedback-spinner" aria-hidden="true" />
          </motion.span>
        ) : isError ? (
          <motion.span key="error" className="grid place-items-center" initial={{ opacity: 0, scale: 0.55 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.55 }} transition={{ type: "spring", stiffness: 480, damping: 25 }}>
            <X className="size-[18px]" strokeWidth={2.2} />
          </motion.span>
        ) : (
          <motion.span key="success" className="grid place-items-center" initial={{ opacity: 0, scale: 0.45, rotate: -18 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.45 }} transition={{ type: "spring", stiffness: 480, damping: 24 }}>
            <Check className="size-[19px]" strokeWidth={2.4} />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function ClipboardCopyStatus({ phase }) {
  return (
    <span className={`clipboard-copy-status clipboard-copy-status-${phase}`} aria-live="polite" aria-label={phase === "success" ? "已复制" : phase === "error" ? "复制失败" : phase === "loading" ? "正在复制" : "复制"}>
      <AnimatePresence initial={false} mode="wait">
        {phase === "loading" ? (
          <motion.span key="loading" className="grid place-items-center" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}>
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.72, ease: "linear", repeat: Infinity }} className="grid place-items-center">
              <LoaderCircle className="size-4" strokeWidth={2} />
            </motion.span>
          </motion.span>
        ) : phase === "success" ? (
          <motion.span key="success" className="grid place-items-center" initial={{ opacity: 0, scale: 0.55, rotate: -18 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ type: "spring", stiffness: 520, damping: 24 }}>
            <Check className="size-4" strokeWidth={2.2} />
          </motion.span>
        ) : phase === "error" ? (
          <motion.span key="error" className="grid place-items-center" initial={{ opacity: 0, scale: 0.55 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}>
            <X className="size-4" strokeWidth={2.2} />
          </motion.span>
        ) : (
          <motion.span key="idle" className="grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Copy className="size-3.5" strokeWidth={1.7} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function ClipboardRow({ item, imagePreview, onOpen }) {
  const isImage = item.kind === "image";
  const preview = isImage ? "图片剪贴板" : item.text.replace(/\s+/g, " ").trim();
  const dimensions = item.width && item.height ? ` · ${item.width} × ${item.height}` : "";
  const statusText = isImage ? `图片${dimensions}` : "文本剪贴板";
  return (
    <Button fullWidth variant="ghost" onPress={onOpen} className={`clipboard-row ${isImage ? "clipboard-row-image" : ""}`}>
      <span className={`clipboard-row-icon ${isImage && imagePreview ? "clipboard-row-thumb" : ""}`}>
        {isImage && imagePreview ? <img src={imagePreview.data_url} alt="剪贴板图片预览" draggable="false" /> : isImage ? <ImageIcon className="size-[15px]" strokeWidth={1.7} /> : <ClipboardList className="size-[15px]" strokeWidth={1.7} />}
      </span>
      <span className="clipboard-row-copy min-w-0">
        <strong className="block truncate text-[11px] font-semibold text-white/84">{preview}</strong>
        <small className="mt-0.5 block text-[9px] font-medium text-white/35">{statusText}</small>
      </span>
      <ChevronRight className="clipboard-row-chevron size-4 shrink-0" strokeWidth={1.7} />
    </Button>
  );
}

function ClipboardDetail({ item, imagePreview, copyPhase, onCopy }) {
  const isImage = item.kind === "image";
  const dimensions = item.width && item.height ? `${item.width} × ${item.height}` : "";
  return (
    <div className="clipboard-detail min-h-0 flex-1">
      <div className="clipboard-detail-meta flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="clipboard-detail-icon grid size-7 shrink-0 place-items-center rounded-lg">
            {isImage ? <ImageIcon className="size-4" strokeWidth={1.7} /> : <ClipboardList className="size-4" strokeWidth={1.7} />}
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-[11px] font-semibold text-white/88">{isImage ? "图片剪贴板" : "文本剪贴板"}</strong>
            <small className="block text-[9px] font-medium text-white/35">{isImage ? dimensions : "完整文本内容"}</small>
          </span>
        </div>
      </div>
      <div className={`clipboard-detail-preview quiet-scrollbar ${isImage ? "clipboard-detail-preview-image" : "clipboard-detail-preview-text"}`}>
        {isImage ? imagePreview ? <img src={imagePreview.data_url} alt="剪贴板图片大图" draggable="false" /> : <span className="text-[10px] text-white/35">正在加载图片…</span> : <pre>{item.text}</pre>}
      </div>
      <Button fullWidth variant="ghost" onPress={onCopy} className="clipboard-detail-copy flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-[11px] font-semibold">
        <ClipboardCopyStatus phase={copyPhase} />
        <span>{isImage ? "复制图片" : "复制文本"}</span>
      </Button>
    </div>
  );
}

export function ClipboardPanel({ model }) {
  const { filteredClipboardItems, clipboardImages, clipboardDetailItem, clipboardQuery, setClipboardQuery, clipboardCopyState, copyClipboardItem, clearClipboardHistory, showClipboardDetail } = model;
  if (clipboardDetailItem) {
    return (
      <div className="clipboard-panel min-h-0 flex-1">
        <ClipboardDetail item={clipboardDetailItem} imagePreview={clipboardImages[clipboardDetailItem.id]} copyPhase={clipboardCopyState.id === clipboardDetailItem.id ? clipboardCopyState.phase : "idle"} onCopy={() => copyClipboardItem(clipboardDetailItem)} />
      </div>
    );
  }
  return (
    <div className="clipboard-panel min-h-0 flex-1">
      <div className="clipboard-search-row flex items-center gap-2 rounded-xl border px-2.5">
        <Search className="size-4 shrink-0 text-white/38" strokeWidth={1.7} />
        <input value={clipboardQuery} onChange={(event) => setClipboardQuery(event.target.value)} placeholder="搜索剪贴板" aria-label="搜索剪贴板" />
        <Button isIconOnly variant="ghost" size="sm" aria-label="清空剪贴板历史" onPress={clearClipboardHistory} className="clipboard-clear-button rounded-lg">
          <Trash2 className="size-3.5" strokeWidth={1.7} />
        </Button>
      </div>
      <div className="clipboard-list quiet-scrollbar min-h-0 flex-1 overflow-y-auto">
        {filteredClipboardItems.length ? filteredClipboardItems.map((item) => <ClipboardRow key={item.id} item={item} imagePreview={clipboardImages[item.id]} onOpen={() => showClipboardDetail(item.id)} />) : (
          <div className="clipboard-empty grid min-h-[150px] place-items-center rounded-xl border border-dashed px-4 text-center text-[10px] leading-relaxed text-white/35">
            <span><ClipboardList className="mx-auto mb-2 size-5 text-white/30" strokeWidth={1.5} />复制过的文本和图片会出现在这里</span>
          </div>
        )}
      </div>
      <div className="clipboard-footer flex items-center justify-between px-1 pt-2 text-[9px] font-medium text-white/35"><span>{filteredClipboardItems.length} 条记录</span><span>点击内容查看</span></div>
    </div>
  );
}
