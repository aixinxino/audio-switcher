import React from "react";
import { Button } from "@heroui/react";
import { Settings2 } from "lucide-react";
import { APP_VERSION, formatShortcut } from "../lib/app-config";
import { Icon } from "./Icon";

function InlineShortcutRow({ target, label, description, model }) {
  const capturing = model.capturingShortcut === target;
  return (
    <Button fullWidth variant="ghost" onPress={() => model.setCapturingShortcut(capturing ? "" : target)} className={`inline-shortcut-row flex h-auto min-h-[48px] items-center justify-between gap-3 rounded-xl border px-3 text-left ${capturing ? "inline-shortcut-row-capturing" : ""}`}>
      <span className="min-w-0">
        <strong className="block truncate text-[11px] font-semibold text-white/88">{label}</strong>
        <small className="mt-0.5 block truncate text-[9px] font-medium text-white/40">{description}</small>
      </span>
      <kbd className="inline-shortcut-key shrink-0">{capturing ? "按下组合键…" : formatShortcut(model.settings.shortcuts[target])}</kbd>
    </Button>
  );
}

function UpdateSection({ model }) {
  const statusLabels = {
    idle: "未检查",
    checking: "检查中…",
    available: "发现新版本",
    downloading: `下载中 ${model.updateProgress}%`,
    installed: "正在重启",
    "up-to-date": "已是最新",
    error: "检查失败",
  };
  const hasUpdate = model.updateStatus === "available";
  const isUpToDate = model.updateStatus === "up-to-date";
  const busy = ["checking", "downloading", "installed"].includes(model.updateStatus);
  const latestVersion = model.updateInfo?.version || (isUpToDate ? APP_VERSION : "—");
  return (
    <section className="update-section mt-3">
      <div className="update-card rounded-2xl border p-2.5">
        <div className="inline-settings-section-heading">
          <div><strong>应用版本</strong><small>检查并保持应用处于最新状态</small></div>
          <span className={`inline-settings-value ${hasUpdate ? "inline-settings-value-highlight" : ""}`}>{statusLabels[model.updateStatus]}</span>
        </div>
        <div className="update-card-body flex items-center justify-between gap-3">
          <div className="update-version-grid min-w-0">
            <div className="update-version-item">
              <small>当前版本</small>
              <strong>v{APP_VERSION}</strong>
            </div>
            <div className="update-version-item">
              <small>最新版本</small>
              <strong>{latestVersion === "—" ? latestVersion : `v${latestVersion}`}</strong>
            </div>
          </div>
          <Button size="sm" variant="ghost" isDisabled={busy || isUpToDate} onPress={hasUpdate ? model.installUpdate : model.checkForUpdates} className={`update-action shrink-0 rounded-lg px-3 text-[10px] font-semibold ${isUpToDate ? "update-action-done" : ""}`}>
            {hasUpdate ? "安装更新" : isUpToDate ? "已是最新" : busy ? statusLabels[model.updateStatus] : "检查更新"}
          </Button>
        </div>
        {model.updateStatus === "downloading" && <div className="update-progress mt-2"><span style={{ width: `${model.updateProgress}%` }} /></div>}
        {model.updateError && <p className="mt-2 text-[9px] font-medium text-red-200/80">{model.updateError}</p>}
      </div>
    </section>
  );
}

export function IslandSettingsPanel({ model }) {
  const { settings, commitSettings, error } = model;
  return (
    <div className="island-panel island-settings-panel flex h-full min-h-0 w-full flex-col px-3 pb-3 pt-3">
      <div className="inline-settings-header flex items-center justify-between gap-3 px-1">
        <div className="inline-settings-title flex min-w-0 items-center gap-2">
          <span className="inline-settings-title-icon"><Settings2 strokeWidth={1.8} className="size-[15px]" /></span>
          <div className="min-w-0">
            <span className="inline-settings-eyebrow">PREFERENCES</span>
            <h2 className="mt-1 text-[18px] font-bold tracking-tight text-white">设置</h2>
          </div>
        </div>
        <Button isIconOnly variant="ghost" size="sm" aria-label="返回设备面板" onPress={model.closeSettings} className="audio-toolbar-button rounded-full">
          <Icon name="close" className="size-4" />
        </Button>
      </div>

      <div className="inline-settings-content min-h-0 flex-1 overflow-y-auto px-1 pt-3">
        <section className="inline-settings-section">
          <div className="inline-settings-section-heading">
            <div><strong>展示模式</strong><small>选择灵动岛展开方式</small></div>
            <span className="inline-settings-value">{settings.displayMode.toUpperCase()}</span>
          </div>
          <div className="inline-settings-mode-grid">
            <Button variant="ghost" onPress={() => commitSettings((current) => ({ ...current, displayMode: "pill" }))} className={`inline-mode-button flex min-w-0 items-center gap-2 rounded-xl border px-3 text-left ${settings.displayMode === "pill" ? "inline-mode-button-selected" : ""}`}>
              <span className="inline-mode-icon"><Icon name="pill" className="size-[17px]" /></span>
              <span className="min-w-0"><strong className="block truncate text-[11px] font-semibold text-white">Pill</strong><small className="mt-0.5 block truncate text-[9px] font-medium text-white/40">独立浮动</small></span>
            </Button>
            <Button variant="ghost" onPress={() => commitSettings((current) => ({ ...current, displayMode: "attached", position: "top" }))} className={`inline-mode-button flex min-w-0 items-center gap-2 rounded-xl border px-3 text-left ${settings.displayMode === "attached" ? "inline-mode-button-selected" : ""}`}>
              <span className="inline-mode-icon"><Icon name="attached" className="size-[17px]" /></span>
              <span className="min-w-0"><strong className="block truncate text-[11px] font-semibold text-white">Attached</strong><small className="mt-0.5 block truncate text-[9px] font-medium text-white/40">贴住顶部</small></span>
            </Button>
          </div>
        </section>

        <UpdateSection model={model} />

        <section className="inline-settings-section mt-3">
          <div className="inline-settings-section-heading">
            <span>快捷键</span>
            <span className="text-[9px] font-medium text-white/35">点击后重新录入</span>
          </div>
          <div className="grid gap-2">
            <InlineShortcutRow target="togglePanel" label="唤出 / 收起面板" description="全局切换悬浮窗" model={model} />
            <InlineShortcutRow target="toggleMic" label="开麦 / 闭麦" description="切换默认麦克风静音" model={model} />
            <InlineShortcutRow target="toggleClipboard" label="打开剪贴板" description="直接打开剪贴板历史" model={model} />
          </div>
          <p className="mt-2 text-[9px] font-medium leading-relaxed text-white/30">按 Esc 取消录入，不会修改原快捷键。</p>
        </section>
      </div>

      {error && <div className="mt-2 rounded-lg border border-red-300/20 bg-red-400/10 px-2 py-1.5 text-center text-[9px] text-red-200">{error}</div>}
      <div className="inline-settings-footer flex items-center justify-between px-1 pt-2 text-[9px] font-medium text-white/35"><span>设置自动保存</span><span><kbd>Esc</kbd> 返回面板</span></div>
    </div>
  );
}
