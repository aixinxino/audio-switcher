import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardList } from "lucide-react";
import { COLLAPSED_GEOMETRY, ISLAND_SPRING, ISLAND_WIDTH } from "../lib/app-config";
import { MainPanel } from "./AudioPanel";
import { ClipboardFeedbackCapsule } from "./ClipboardPanel";
import { Icon } from "./Icon";
import { IslandSettingsPanel } from "./SettingsPanel";

function Capsule({ input, onInputMute, onClipboard, clipboardPhase = "idle" }) {
  if (clipboardPhase !== "idle") return <ClipboardFeedbackCapsule phase={clipboardPhase} />;

  const muted = input?.muted;
  return (
    <div className="capsule-content grid h-full w-full items-center gap-0 px-2">
      <button type="button" aria-label={muted ? "解除麦克风静音" : "麦克风静音"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void onInputMute(); }} className="capsule-action rounded-full">
        <span className="relative grid place-items-center">
          <Icon name={muted ? "micOff" : "mic"} className={`size-[18px] ${muted ? "capsule-icon-muted" : "capsule-icon-live"}`} />
        </span>
      </button>
      <span className="capsule-divider" />
      <button type="button" aria-label="打开剪贴板" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void onClipboard(); }} className="capsule-action rounded-full">
        <span className="relative grid place-items-center">
          <ClipboardList className="size-[17px] text-white/76" strokeWidth={1.8} />
        </span>
      </button>
    </div>
  );
}

export function MainWindow({ model }) {
  const input = model.currentDevice("input");
  const isExpandedTarget = model.islandState === "expanding" || model.islandState === "expanded";
  const isAttached = model.settings.displayMode === "attached";
  const geometry = isExpandedTarget ? { width: ISLAND_WIDTH, height: model.expandedHeight, radius: 28 } : COLLAPSED_GEOMETRY;
  const motionGeometry = {
    width: geometry.width,
    height: geometry.height,
    borderTopLeftRadius: isAttached ? 0 : geometry.radius,
    borderTopRightRadius: isAttached ? 0 : geometry.radius,
    borderBottomLeftRadius: geometry.radius,
    borderBottomRightRadius: geometry.radius,
  };
  return (
    <main className={`island-host island-host-${isAttached ? "top" : model.settings.position}`}>
      <motion.div
        ref={model.islandElementRef}
        className={`island-shell ${isAttached ? "island-shell-attached" : ""} ${isExpandedTarget ? "island-shell-expanded" : "island-shell-collapsed"}`}
        initial={false}
        animate={motionGeometry}
        transition={ISLAND_SPRING}
        onClick={model.handleIslandClick}
        onMouseEnter={model.handleIslandMouseEnter}
        onMouseLeave={model.handleIslandMouseLeave}
        onAnimationComplete={model.onIslandAnimationComplete}
      >
        {/* Keep both states in the same island transition. `wait` leaves a
            visible gap between the capsule exit and panel enter. */}
        <AnimatePresence initial={false} mode="sync" presenceAffectsLayout={false}>
          {isExpandedTarget ? (
            <motion.div key={model.isSettingsView ? "settings" : "expanded"} className="island-content island-content-expanded" style={{ pointerEvents: isExpandedTarget ? "auto" : "none" }} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.14, ease: "easeOut" }}>
              {model.isSettingsView ? <IslandSettingsPanel model={model} /> : <MainPanel model={model} />}
            </motion.div>
          ) : (
            <motion.div key="collapsed" className="island-content island-content-collapsed" style={{ pointerEvents: isExpandedTarget ? "none" : "auto" }} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 1, scale: 1 }} transition={{ duration: 0.14, ease: "easeOut" }}>
              <div className="capsule-transition-frame">
                <Capsule input={input} clipboardPhase={model.clipboardCopyState.phase} onInputMute={() => model.toggleMute("input")} onClipboard={model.showClipboardPanel} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  );
}
