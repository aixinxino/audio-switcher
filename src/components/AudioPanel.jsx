import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, ScrollShadow, Slider } from "@heroui/react";
import { ArrowLeft, ClipboardList, Settings2 } from "lucide-react";
import { ClipboardPanel } from "./ClipboardPanel";
import { Icon } from "./Icon";

function VolumeControl({ kind, device, onMute, onChange }) {
  if (!device) return null;
  const percent = Math.round((device.volume ?? 0.75) * 100);
  const isOutput = kind === "output";
  return (
    <div className="audio-volume-row flex min-h-9 items-center gap-2 rounded-xl border px-2">
      <Button isIconOnly variant="ghost" size="sm" aria-label={device.muted ? "取消静音" : "静音"} onPress={onMute} className="audio-icon-button h-6 w-6 min-w-6 rounded-lg">
        <Icon name={device.muted ? (isOutput ? "speakerOff" : "micOff") : (isOutput ? "speaker" : "mic")} className="size-4" />
      </Button>
      <Slider aria-label={isOutput ? "输出音量" : "输入音量"} value={percent} minValue={0} maxValue={100} step={1} onChange={(value) => onChange(Array.isArray(value) ? value[0] : value)} className="audio-volume-slider min-w-0 flex-1 gap-0">
        <Slider.Track className="audio-volume-track h-1.5 border-x-0">
          <Slider.Fill className="audio-volume-fill" />
          <Slider.Thumb className="audio-volume-thumb" />
        </Slider.Track>
      </Slider>
      <span className="audio-volume-value min-w-9 text-right text-[10px] font-semibold">{percent}%</span>
    </div>
  );
}

function DeviceRow({ kind, device, onSelect }) {
  const selected = device.is_default;
  const iconName = kind === "output" ? (device.name.includes("耳机") ? "headset" : "desktop") : (device.name.includes("耳机") ? "headset" : "mic");
  return (
    <Button fullWidth variant="ghost" onPress={onSelect} aria-label={`选择${device.name}`} className={`audio-device-row group flex h-[52px] min-h-[52px] justify-start gap-3 rounded-[15px] border px-3 text-left ${selected ? "audio-device-row-selected" : ""}`}>
      <span className="grid size-7 shrink-0 place-items-center text-white/80"><Icon name={iconName} className="size-[20px]" /></span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <strong className="truncate text-[13px] font-semibold text-white/88">{device.name}</strong>
        <small className="truncate text-[10px] font-medium text-white/42">{selected ? "当前使用中" : kind === "output" ? "可用输出" : "可用输入"}</small>
      </span>
      <span className={`device-status-dot ${selected ? "device-status-dot-active" : "device-status-dot-idle"}`} aria-label={selected ? "当前使用中" : "可用设备"} />
    </Button>
  );
}

function DeviceGroup({ kind, devices, loading, currentDevice, onMute, onVolume, onSelect }) {
  const isOutput = kind === "output";
  const device = currentDevice(kind);
  return (
    <section className="audio-device-group flex h-full min-h-0 flex-col gap-2" data-kind={kind}>
      <ScrollShadow hideScrollBar={false} size={12} className="audio-device-scroll quiet-scrollbar min-h-0 flex-1" orientation="vertical">
        <div className="audio-device-list grid gap-2 px-0.5 pb-2 pt-0.5">
          {loading ? <div className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-xs text-white/45">正在读取设备…</div> : !devices.length ? <div className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-xs text-white/45">没有可用的{isOutput ? "输出" : "输入"}设备</div> : devices.map((item) => <DeviceRow key={item.id} kind={kind} device={item} onSelect={() => onSelect(kind, item.id)} />)}
        </div>
      </ScrollShadow>
      <div className="audio-device-control-footer grid shrink-0 gap-2">
        <div className="flex items-center gap-2 px-1 text-[12px] font-semibold text-white/62">
          <Icon name={isOutput ? "speaker" : "mic"} className="size-[16px] text-white/72" />
          <span>{isOutput ? "输出设备" : "输入设备"}</span>
        </div>
        <VolumeControl kind={kind} device={device} onMute={onMute} onChange={(value) => device && onVolume(kind, device.id, value)} />
      </div>
    </section>
  );
}

export function SegmentButton({ active, children, onPress }) {
  return <Button variant="ghost" onPress={onPress} className={`audio-segment-button min-w-0 flex-1 rounded-lg px-3 text-[11px] font-semibold ${active ? "audio-segment-active" : ""}`}>{children}</Button>;
}

export function MainPanel({ model }) {
  const { devices, activeGroup, loading, currentDevice, loadDevices, selectDevice, toggleMute, setDeviceVolume, error, panelMode, clipboardDetailId } = model;
  const isClipboardMode = panelMode === "clipboard";
  const isClipboardDetail = isClipboardMode && Boolean(clipboardDetailId);
  return (
    <div className="island-panel flex h-full min-h-0 w-full flex-col px-3 pb-3 pt-3">
      <div className="island-toolbar audio-panel-toolbar flex items-center gap-2 px-1">
        <Button isIconOnly variant="ghost" size="sm" aria-label={isClipboardDetail ? "返回剪贴板列表" : isClipboardMode ? "返回音频面板" : "刷新设备"} onPress={isClipboardDetail ? () => model.setClipboardDetailId("") : isClipboardMode ? () => model.setPanelMode("audio") : loadDevices} className="audio-toolbar-button audio-toolbar-button-edge shrink-0 rounded-full">
          {isClipboardMode ? <ArrowLeft className="size-[17px]" strokeWidth={1.8} /> : <Icon name="refresh" className="size-4" />}
        </Button>
        <div className="audio-panel-title flex min-w-0 flex-1 items-center justify-center gap-1.5" aria-live="polite">
          <Icon name={isClipboardMode ? "clipboard" : "speaker"} className="size-[13px] text-white/48" />
          <span>{isClipboardDetail ? "内容详情" : isClipboardMode ? "剪贴板" : "音频设备"}</span>
        </div>
        <div className="audio-panel-actions flex shrink-0 items-center gap-0.5">
          {!isClipboardMode && <Button isIconOnly variant="ghost" size="sm" aria-label="打开剪贴板" onPress={model.showClipboardPanel} className="audio-toolbar-button audio-toolbar-button-edge rounded-full"><ClipboardList className="size-[16px]" strokeWidth={1.8} /></Button>}
          <Button isIconOnly variant="ghost" size="sm" aria-label="打开设置" onPress={model.openSettings} className="audio-toolbar-button audio-toolbar-button-edge rounded-full">
            <Settings2 strokeWidth={1.8} className="size-[17px]" />
          </Button>
        </div>
      </div>
      <div className="island-panel-view-area min-h-0 flex-1">
        <AnimatePresence mode="sync" initial={false}>
          {isClipboardMode ? (
            <motion.div key="clipboard" className="island-panel-view h-full" initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }} transition={{ duration: 0.14, ease: "easeOut" }}>
              <ClipboardPanel model={model} />
            </motion.div>
          ) : (
            <motion.div key="audio" className="island-panel-view h-full" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ duration: 0.14, ease: "easeOut" }}>
              <div className="audio-sub-toolbar flex items-center gap-2 pt-2">
                <div className="audio-segment-control flex min-w-0 flex-1" role="tablist" aria-label="设备类型">
                  <SegmentButton active={activeGroup === "output"} onPress={() => model.setActiveGroup("output")}><Icon name="speaker" className="mr-1.5 inline size-3.5" />输出</SegmentButton>
                  <SegmentButton active={activeGroup === "input"} onPress={() => model.setActiveGroup("input")}><Icon name="mic" className="mr-1.5 inline size-3.5" />输入</SegmentButton>
                </div>
              </div>
              <div className="island-panel-body audio-panel-body min-h-0 flex-1 pt-2">
                <AnimatePresence mode="sync" initial={false}>
                  <motion.div key={activeGroup} initial={{ opacity: 0, scale: 0.98, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -2 }} transition={{ duration: 0.14, ease: "easeOut" }} className="audio-panel-group h-full">
                    <DeviceGroup kind={activeGroup} devices={devices[activeGroup]} loading={loading} currentDevice={currentDevice} onMute={() => toggleMute(activeGroup)} onVolume={setDeviceVolume} onSelect={selectDevice} />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="island-footer flex items-center justify-between px-1 pt-2 text-[9px] font-medium text-white/35"><span>{activeGroup === "output" ? "输出控制" : "输入控制"}</span><span><kbd>Esc</kbd> 收起</span></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && <div className="mt-2 rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-center text-[10px] text-red-200">{error}</div>}
    </div>
  );
}
