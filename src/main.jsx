import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { Button, ScrollShadow, Slider } from "@heroui/react";
import { Settings2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, cursorPosition, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { register as registerGlobalShortcut, unregister as unregisterGlobalShortcut, unregisterAll as unregisterAllGlobalShortcuts } from "@tauri-apps/plugin-global-shortcut";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import "./app.css";

const SETTINGS_KEY = "audio-switcher-settings";
const SETTINGS_VERSION = 3;
const COLLAPSED_GEOMETRY = { width: 168, height: 42, radius: 21 };
const ISLAND_WIDTH = 360;
const ISLAND_SPRING = { type: "spring", stiffness: 380, damping: 36, mass: 0.8 };
const PANEL_MIN_HEIGHT = 320;
const PANEL_MAX_HEIGHT = 620;
const DEFAULT_PANEL_MAX_HEIGHT = 480;
const currentWindow = getCurrentWindow();

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  displayMode: "pill",
  position: "top",
  panelHeight: DEFAULT_PANEL_MAX_HEIGHT,
  shortcuts: {
    togglePanel: "Control+Shift+Space",
    toggleMic: "Control+Shift+M",
  },
};

const fallbackDevices = {
  output: [
    { id: "fallback-headset", name: "耳机", kind: "output", is_default: true, muted: false, volume: 0.72 },
    { id: "fallback-speakers", name: "桌面音箱", kind: "output", is_default: false, muted: true, volume: 0.55 },
  ],
  input: [
    { id: "fallback-mic", name: "桌面麦克风", kind: "input", is_default: true, muted: false, volume: 0.84 },
    { id: "fallback-headset-mic", name: "耳机麦克风", kind: "input", is_default: false, muted: true, volume: 0.66 },
  ],
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    const panelHeight = Number(saved?.panelHeight);
    const isLegacySettings = Number(saved?.version) !== SETTINGS_VERSION;
    const displayMode = ["pill", "attached"].includes(saved?.displayMode) ? saved.displayMode : DEFAULT_SETTINGS.displayMode;
    const savedPosition = saved?.position;
    const migratedPosition = isLegacySettings && savedPosition === "center" ? "top" : savedPosition;
    const position = displayMode === "attached" ? "top" : migratedPosition;
    const savedShortcuts = saved?.shortcuts ?? {};
    return {
      ...DEFAULT_SETTINGS,
      version: SETTINGS_VERSION,
      displayMode,
      position: ["top", "bottom", "right", "center"].includes(position) ? position : DEFAULT_SETTINGS.position,
      panelHeight: Number.isFinite(panelHeight)
        ? Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, panelHeight))
        : DEFAULT_SETTINGS.panelHeight,
      shortcuts: {
        togglePanel: normalizeShortcut(savedShortcuts.togglePanel ?? DEFAULT_SETTINGS.shortcuts.togglePanel),
        toggleMic: normalizeShortcut(savedShortcuts.toggleMic ?? DEFAULT_SETTINGS.shortcuts.toggleMic),
      },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function persistSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function formatShortcut(shortcut = "") {
  return shortcut
    .replaceAll("CommandOrControl", "Ctrl")
    .replaceAll("Control", "Ctrl")
    .replaceAll("ArrowUp", "↑")
    .replaceAll("ArrowDown", "↓")
    .replaceAll("ArrowLeft", "←")
    .replaceAll("ArrowRight", "→");
}

function normalizeShortcut(shortcut = "") {
  return String(shortcut)
    .replaceAll("CommandOrControl", "Control")
    .replaceAll("Ctrl", "Control");
}

function shortcutFromEvent(event) {
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return "";

  let key = event.code;
  if (key.startsWith("Key")) key = key.slice(3);
  if (key.startsWith("Digit")) key = key.slice(5);
  if (key.startsWith("Numpad")) key = key.slice(6);
  if (["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(event.code)) return "";
  if (!key || key === "Unidentified") return "";
  return [...modifiers, key].join("+");
}

function Icon({ name, className = "size-5" }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.7, "aria-hidden": true };
  const paths = {
    speaker: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9.2a4 4 0 0 1 0 5.6M18.8 6.4a8 8 0 0 1 0 11.2" /></>,
    speakerOff: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="m18 9 4 6m0-6-4 6" /></>,
    mic: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    micOff: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8M4 4l16 16" /></>,
    headset: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5Zm16 0h-3v6h2a1 1 0 0 1 1-1v-5Z" /><path d="M17 20h-2" /></>,
    desktop: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-4L4 9" /><path d="M4 5v4h4M4 13a8 8 0 0 0 14 4l2-2M20 19v-4h-4" /></>,
    sliders: <><path d="M4 7h8M16 7h4M4 12h3M11 12h9M4 17h10M18 17h2" /><circle cx="14" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="16" cy="17" r="2" /></>,
    pill: <rect x="2.5" y="6" width="19" height="12" rx="6" />,
    attached: <path d="M2.5 5.5h19v7.5a6 6 0 0 1-6 6h-7a6 6 0 0 1-6-6V5.5Z" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
  };
  return <svg {...common}>{paths[name] ?? paths.speaker}</svg>;
}

function applyThemeVariables() {
  const root = document.documentElement;
  root.dataset.theme = "black";
  root.style.setProperty("--accent", "#eef2f7");
  root.style.setProperty("--accent-hover", "#ffffff");
  root.style.setProperty("--accent-foreground", "#08090b");
  root.style.setProperty("--app-accent", "#eef2f7");
  root.style.setProperty("--app-surface", "#08090b");
  root.style.setProperty("--app-panel", "#0d0f12");
  root.style.setProperty("--app-panel-deep", "#08090b");
  root.style.setProperty("--app-card", "#12151a");
  root.style.setProperty("--app-border", "#343a43");
  root.style.setProperty("--background", "#08090b");
  root.style.setProperty("--foreground", "#f4f6f8");
  root.style.setProperty("--surface", "#0d0f12");
  root.style.setProperty("--surface-foreground", "#f4f6f8");
  root.style.setProperty("--default", "#1a1e24");
  root.style.setProperty("--default-foreground", "#e8ebef");
  root.style.setProperty("--border", "#343a43");
  root.style.setProperty("--separator", "rgba(255,255,255,.10)");
}

function panelHeightFor(devices, maxHeight) {
  const listHeight = Math.max(54, Math.min(330, devices.length * 54 + Math.max(0, devices.length - 1) * 8));
  return Math.min(maxHeight, Math.max(252, 152 + listHeight));
}

function useAudioSwitcher() {
  const initialSettings = useMemo(() => loadSettings(), []);
  const [settings, setSettings] = useState(initialSettings);
  const settingsRef = useRef(initialSettings);
  const [devices, setDevices] = useState({ output: [], input: [] });
  const [islandState, setIslandState] = useState("collapsed");
  const islandStateRef = useRef("collapsed");
  const [activeGroup, setActiveGroup] = useState("output");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [capturingShortcut, setCapturingShortcut] = useState("");
  const [isSettingsView, setIsSettingsView] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("idle");
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState("");
  const hidePanelPromise = useRef(null);
  const pendingUpdate = useRef(null);
  const registeredShortcuts = useRef(new Set());
  const shortcutRegistrationQueue = useRef(Promise.resolve());
  const nativeGeometryRef = useRef({ ...COLLAPSED_GEOMETRY });
  const nativeGeometryPending = useRef(null);
  const nativeGeometryFrame = useRef(0);
  const nativeGeometryBusy = useRef(false);
  const nativeFrameKeyRef = useRef("");
  const nativeScaleRef = useRef(1);
  const islandElementRef = useRef(null);
  const ignoreCursorEventsRef = useRef(null);
  const cursorPollBusyRef = useRef(false);

  const expanded = islandState === "expanding" || islandState === "expanded";
  const activeDevices = devices[activeGroup] ?? [];
  const expandedHeight = isSettingsView ? 430 : panelHeightFor(activeDevices, settings.panelHeight);

  useEffect(() => {
    applyThemeVariables();
    document.documentElement.style.setProperty("--panel-max-height", `${settings.panelHeight}px`);
  }, [settings.panelHeight]);

  const commitSettings = useCallback((updater) => {
    const previous = settingsRef.current;
    const next = typeof updater === "function" ? updater(previous) : { ...previous, ...updater };
    settingsRef.current = next;
    setSettings(next);
    persistSettings(next);
    return next;
  }, []);

  const currentDevice = useCallback((kind) => devices[kind].find((device) => device.is_default) ?? devices[kind][0], [devices]);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke("get_audio_devices");
      setDevices({
        output: result.filter((device) => device.kind === "output"),
        input: result.filter((device) => device.kind === "input"),
      });
      setError("");
    } catch (loadError) {
      setDevices(structuredClone(fallbackDevices));
      setError("原生音频接口暂不可用，当前显示预览设备");
      console.warn(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAutostart = useCallback(async () => {
    try {
      setAutostartEnabled(await invoke("is_autostart_enabled"));
    } catch (loadError) {
      console.warn(loadError);
    }
  }, []);

  const selectDevice = useCallback(async (kind, id) => {
    try {
      await invoke("set_default_device", { id, kind });
      setDevices((previous) => ({ ...previous, [kind]: previous[kind].map((device) => ({ ...device, is_default: device.id === id })) }));
      setError("");
    } catch (selectError) {
      setError("设备切换失败，请检查系统权限");
      console.warn(selectError);
    }
  }, []);

  const toggleMute = useCallback(async (kind) => {
    const device = devices[kind].find((item) => item.is_default) ?? devices[kind][0];
    if (!device) return;
    const muted = !device.muted;
    try {
      await invoke("set_device_mute", { id: device.id, muted });
      setDevices((previous) => ({ ...previous, [kind]: previous[kind].map((item) => item.id === device.id ? { ...item, muted } : item) }));
      setError("");
    } catch (muteError) {
      setError("静音切换失败，请检查系统权限");
      console.warn(muteError);
    }
  }, [devices]);

  const setDeviceVolume = useCallback(async (kind, id, value) => {
    const volume = value / 100;
    setDevices((previous) => ({ ...previous, [kind]: previous[kind].map((device) => device.id === id ? { ...device, volume } : device) }));
    try {
      await invoke("set_device_volume", { id, volume });
      setError("");
    } catch (volumeError) {
      setError("音量调整失败，请检查系统权限");
      console.warn(volumeError);
    }
  }, []);

  const setIslandStateSafe = useCallback((nextState) => {
    islandStateRef.current = nextState;
    setIslandState(nextState);
  }, []);

  const setIgnoreCursorEvents = useCallback(async (ignore) => {
    if (ignoreCursorEventsRef.current === ignore) return;
    ignoreCursorEventsRef.current = ignore;
    try {
      await currentWindow.setIgnoreCursorEvents(ignore);
    } catch (cursorError) {
      ignoreCursorEventsRef.current = null;
      console.warn("window cursor mode synchronization failed", cursorError);
    }
  }, []);

  const syncNativeFrame = useCallback(async (frame, geometry) => {
    if (!frame || !geometry) return;
    const displayMode = settingsRef.current.displayMode;
    const position = displayMode === "attached" ? "top" : settingsRef.current.position;
    const frameKey = `${Math.round(frame.width)}:${Math.round(frame.height)}:${position}:${displayMode}`;
    let scale = nativeScaleRef.current || 1;

    // Keep the native frame stable through a spring transition. The visible
    // shape is drawn by CSS, matching WinIsland's transparent-window approach.
    if (frameKey !== nativeFrameKeyRef.current) {
      const monitor = await currentMonitor();
      if (!monitor) return;
      scale = monitor.scaleFactor || 1;
      nativeScaleRef.current = scale;
      const physicalFrameWidth = Math.max(1, Math.round(frame.width * scale));
      const physicalFrameHeight = Math.max(1, Math.round(frame.height * scale));
      const area = displayMode === "attached" ? monitor : monitor.workArea;
      const margin = Math.round(16 * scale);
      const xCenter = Math.round(area.position.x + (area.size.width - physicalFrameWidth) / 2);
      const yCenter = Math.round(area.position.y + (area.size.height - physicalFrameHeight) / 2);
      const x = position === "right" ? area.position.x + area.size.width - physicalFrameWidth - margin : xCenter;
      const y = position === "top" ? area.position.y : position === "bottom" ? area.position.y + area.size.height - physicalFrameHeight - margin : yCenter;
      await currentWindow.setSize(new LogicalSize(Math.round(frame.width), Math.round(frame.height)));
      await currentWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
      nativeFrameKeyRef.current = frameKey;
    }

    nativeGeometryRef.current = geometry;
  }, []);

  const requestNativeGeometry = useCallback((geometry) => {
    if (!geometry) return;
    nativeGeometryPending.current = {
      geometry: {
        width: Math.max(1, Number(geometry.width)),
        height: Math.max(1, Number(geometry.height)),
        radius: Math.max(1, Number(geometry.radius ?? 20)),
      },
      frame: {
        // The native frame follows the target state, not every spring frame.
        // The shell itself remains CSS-rounded, so no native region clipping is needed.
        width: islandStateRef.current === "collapsed" ? COLLAPSED_GEOMETRY.width : ISLAND_WIDTH,
        height: islandStateRef.current === "collapsed" ? COLLAPSED_GEOMETRY.height : expandedHeight,
      },
    };
    if (nativeGeometryFrame.current) return;
    nativeGeometryFrame.current = requestAnimationFrame(() => {
      nativeGeometryFrame.current = 0;
      if (nativeGeometryBusy.current) return;
      const next = nativeGeometryPending.current;
      nativeGeometryPending.current = null;
      if (!next) return;
      nativeGeometryBusy.current = true;
      void syncNativeFrame(next.frame, next.geometry)
        .catch((geometryError) => console.warn("window geometry synchronization failed", geometryError))
        .finally(() => {
          nativeGeometryBusy.current = false;
          if (nativeGeometryPending.current) requestNativeGeometry(nativeGeometryPending.current.geometry);
        });
    });
  }, [expandedHeight, syncNativeFrame]);

  useEffect(() => {
    let active = true;
    void syncNativeFrame(
      COLLAPSED_GEOMETRY,
      COLLAPSED_GEOMETRY,
    )
      .then(() => {
        if (active) return currentWindow.show();
        return undefined;
      })
      .catch((geometryError) => console.warn("initial window preparation failed", geometryError));
    return () => {
      active = false;
      if (nativeGeometryFrame.current) cancelAnimationFrame(nativeGeometryFrame.current);
    };
  }, [syncNativeFrame]);

  useEffect(() => {
    requestNativeGeometry(nativeGeometryRef.current);
  }, [requestNativeGeometry, settings.displayMode, settings.panelHeight, settings.position]);

  const syncCollapsedCursorEvents = useCallback(async () => {
    if (islandStateRef.current !== "collapsed" || !islandElementRef.current) return;
    const [cursor, windowPosition] = await Promise.all([cursorPosition(), currentWindow.innerPosition()]);
    const rect = islandElementRef.current.getBoundingClientRect();
    const scale = window.devicePixelRatio || nativeScaleRef.current || 1;
    const left = windowPosition.x + rect.left * scale;
    const top = windowPosition.y + rect.top * scale;
    const right = left + rect.width * scale;
    const bottom = top + rect.height * scale;
    const inside = cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom;
    await setIgnoreCursorEvents(!inside);
  }, [setIgnoreCursorEvents]);

  useEffect(() => {
    // Keep the tiny collapsed frame interactive. The cursor poll below turns
    // click-through back on as soon as the pointer leaves it.
    void setIgnoreCursorEvents(false);
    return undefined;
  }, [islandState, setIgnoreCursorEvents]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (cursorPollBusyRef.current || islandStateRef.current !== "collapsed") return;
      cursorPollBusyRef.current = true;
      void syncCollapsedCursorEvents().finally(() => {
        cursorPollBusyRef.current = false;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [syncCollapsedCursorEvents]);

  const expandPanel = useCallback(() => {
    if (islandStateRef.current === "expanded" || islandStateRef.current === "expanding") return;
    setIslandStateSafe("expanding");
  }, [setIslandStateSafe]);

  const collapsePanel = useCallback(() => {
    setIsSettingsView(false);
    if (islandStateRef.current === "collapsed" || islandStateRef.current === "collapsing") return;
    setCapturingShortcut("");
    setIslandStateSafe("collapsing");
  }, [setIslandStateSafe]);

  const handleIslandClick = useCallback((event) => {
    // The capsule buttons are actions, not the expand surface. HeroUI's
    // press event can still be followed by the parent DOM click, so guard at
    // the island boundary as well as stopping propagation inside Capsule.
    if (event?.target?.closest?.("button")) return;
    if (islandStateRef.current === "collapsed" || islandStateRef.current === "collapsing") expandPanel();
  }, [expandPanel]);

  const handleIslandMouseEnter = useCallback(() => {
    void setIgnoreCursorEvents(false);
  }, [setIgnoreCursorEvents]);

  const handleIslandMouseLeave = useCallback(() => {
    if (islandStateRef.current === "collapsed") void setIgnoreCursorEvents(true);
  }, [setIgnoreCursorEvents]);

  const onIslandAnimationComplete = useCallback(() => {
    if (islandStateRef.current === "expanding") setIslandStateSafe("expanded");
    if (islandStateRef.current === "collapsing") {
      setIslandStateSafe("collapsed");
      requestNativeGeometry(COLLAPSED_GEOMETRY);
    }
  }, [requestNativeGeometry, setIslandStateSafe]);

  const toggleCurrentMic = useCallback(async () => {
    try {
      await invoke("toggle_default_input_mute");
      await loadDevices();
    } catch (micError) {
      setError("快捷键切换麦克风失败");
      console.warn(micError);
    }
  }, [loadDevices]);

  const shortcutHandler = useCallback((handler) => (event) => {
    if (event?.state !== "Pressed") return;
    void Promise.resolve(handler()).catch((shortcutError) => {
      setError("快捷键执行失败");
      console.warn(shortcutError);
    });
  }, []);

  const unregisterTrackedShortcuts = useCallback(async () => {
    const shortcuts = [...registeredShortcuts.current];
    registeredShortcuts.current.clear();
    await Promise.all(shortcuts.map((shortcut) => unregisterGlobalShortcut(shortcut).catch(() => {})));
    await unregisterAllGlobalShortcuts().catch(() => {});
  }, []);

  const showOrHidePanel = useCallback(async () => {
    const visible = await currentWindow.isVisible();
    if (!visible) {
      setIsSettingsView(false);
      setIslandStateSafe("collapsed");
      requestNativeGeometry(COLLAPSED_GEOMETRY);
      await currentWindow.show();
      await currentWindow.setFocus();
      return;
    }
    if (islandStateRef.current === "collapsed" || islandStateRef.current === "collapsing") expandPanel();
    else collapsePanel();
  }, [collapsePanel, expandPanel, requestNativeGeometry, setIslandStateSafe]);

  const initializeShortcuts = useCallback(() => {
    const registerTask = async () => {
      const shortcuts = settingsRef.current.shortcuts;
      const entries = [
        [normalizeShortcut(shortcuts.togglePanel), shortcutHandler(() => {
          void showOrHidePanel();
        })],
        [normalizeShortcut(shortcuts.toggleMic), shortcutHandler(toggleCurrentMic)],
      ];
      const uniqueEntries = entries.filter(([shortcut], index) => shortcut && entries.findIndex(([candidate]) => candidate === shortcut) === index);
      try {
        await unregisterTrackedShortcuts();
        for (const [shortcut, handler] of uniqueEntries) {
          await registerGlobalShortcut(shortcut, handler);
          registeredShortcuts.current.add(shortcut);
        }
        setError("");
      } catch (shortcutError) {
        await unregisterTrackedShortcuts();
        setError("快捷键注册失败，请在设置中重新录入");
        console.warn(shortcutError);
      }
    };

    const queuedTask = shortcutRegistrationQueue.current.then(registerTask, registerTask);
    shortcutRegistrationQueue.current = queuedTask.catch(() => {});
    return queuedTask;
  }, [shortcutHandler, showOrHidePanel, toggleCurrentMic, unregisterTrackedShortcuts]);

  const updateShortcut = useCallback(async (target, nextShortcut) => {
    const previousSettings = settingsRef.current;
    const otherTarget = target === "togglePanel" ? "toggleMic" : "togglePanel";
    if (nextShortcut === previousSettings.shortcuts[otherTarget]) {
      setError("两个快捷键不能重复");
      setCapturingShortcut("");
      return;
    }
    commitSettings((current) => ({ ...current, shortcuts: { ...current.shortcuts, [target]: nextShortcut } }));
    setCapturingShortcut("");
    setError("");
    await initializeShortcuts();
  }, [commitSettings, initializeShortcuts]);

  const openSettings = useCallback(() => {
    setIsSettingsView(true);
    if (islandStateRef.current === "collapsed" || islandStateRef.current === "collapsing") expandPanel();
  }, [expandPanel]);

  const closeSettings = useCallback(() => {
    setIsSettingsView(false);
  }, []);

  const checkForUpdates = useCallback(async ({ silent = false } = {}) => {
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const update = await checkForUpdate({ timeout: 15000 });
      pendingUpdate.current = update;
      if (update) {
        setUpdateInfo({
          version: update.version,
          notes: update.body || update.rawJson?.notes || "",
        });
        setUpdateStatus("available");
      } else {
        setUpdateInfo(null);
        setUpdateStatus("up-to-date");
      }
    } catch (updateCheckError) {
      pendingUpdate.current = null;
      setUpdateStatus("error");
      if (!silent) setUpdateError("暂时无法连接 GitHub 更新源");
      console.warn("update check failed", updateCheckError);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;
    setUpdateStatus("downloading");
    setUpdateProgress(0);
    setUpdateError("");
    let downloaded = 0;
    let contentLength = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength || 0;
          setUpdateProgress(0);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength || 0;
          if (contentLength > 0) setUpdateProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        } else if (event.event === "Finished") {
          setUpdateProgress(100);
        }
      });
      setUpdateStatus("installed");
      await relaunch();
    } catch (updateInstallError) {
      setUpdateStatus("error");
      setUpdateError("更新安装失败，请稍后重试");
      console.warn("update install failed", updateInstallError);
    }
  }, []);

  const toggleAutostart = useCallback(async () => {
    const nextValue = !autostartEnabled;
    try {
      await invoke(nextValue ? "enable_autostart" : "disable_autostart");
      setAutostartEnabled(nextValue);
      setError("");
    } catch (autostartError) {
      setError("开机自启设置失败");
      console.warn(autostartError);
    }
  }, [autostartEnabled]);

  useEffect(() => {
    void loadDevices();
    void loadAutostart();

    let focusCleanup;
    void currentWindow.onFocusChanged(({ payload: focused }) => {
      if (!focused && islandStateRef.current !== "collapsed") collapsePanel();
    }).then((cleanup) => { focusCleanup = cleanup; }).catch((focusError) => console.warn("focus listener unavailable", focusError));

    return () => {
      focusCleanup?.();
      void unregisterTrackedShortcuts();
    };
  }, [collapsePanel, loadAutostart, loadDevices]);

  useEffect(() => {
    void initializeShortcuts();
    return () => {
      void unregisterTrackedShortcuts();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkForUpdates({ silent: true }), 1600);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const isEscape = event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
      if (capturingShortcut) {
        event.preventDefault();
        event.stopPropagation();
        if (isEscape) {
          setCapturingShortcut("");
          return;
        }
        const shortcut = shortcutFromEvent(event);
        if (shortcut) void updateShortcut(capturingShortcut, shortcut);
        return;
      }
      if (isEscape) {
        event.preventDefault();
        if (isSettingsView) closeSettings();
        else collapsePanel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [capturingShortcut, closeSettings, collapsePanel, isSettingsView, updateShortcut]);

  return {
    settings,
    devices,
    islandState,
    expanded,
    activeGroup,
    setActiveGroup,
    loading,
    error,
    setError,
    autostartEnabled,
    capturingShortcut,
    setCapturingShortcut,
    isSettingsView,
    currentDevice,
    loadDevices,
    selectDevice,
    toggleMute,
    setDeviceVolume,
    commitSettings,
    toggleAutostart,
    expandedHeight,
    openSettings,
    closeSettings,
    expandPanel,
    collapsePanel,
    handleIslandClick,
    handleIslandMouseEnter,
    handleIslandMouseLeave,
    islandElementRef,
    onIslandAnimationComplete,
    requestNativeGeometry,
    showOrHidePanel,
    updateStatus,
    updateInfo,
    updateProgress,
    updateError,
    checkForUpdates,
    installUpdate,
  };
}

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
    <section className="grid min-h-0 gap-2" data-kind={kind}>
      <div className="flex items-center gap-2 px-1 text-[12px] font-semibold text-white/62">
        <Icon name={isOutput ? "speaker" : "mic"} className="size-[16px] text-white/72" />
        <span>{isOutput ? "输出设备" : "输入设备"}</span>
      </div>
      <VolumeControl kind={kind} device={device} onMute={onMute} onChange={(value) => device && onVolume(kind, device.id, value)} />
      <ScrollShadow hideScrollBar={false} className="min-h-0" orientation="vertical">
        <div className="audio-device-list grid max-h-[310px] gap-2 overflow-y-auto px-0.5 py-0.5">
          {loading ? <div className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-xs text-white/45">正在读取设备…</div> : !devices.length ? <div className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-xs text-white/45">没有可用的{isOutput ? "输出" : "输入"}设备</div> : devices.map((item) => <DeviceRow key={item.id} kind={kind} device={item} onSelect={() => onSelect(kind, item.id)} />)}
        </div>
      </ScrollShadow>
    </section>
  );
}

function Capsule({ output, input, onOutputMute, onInputMute }) {
  const item = (device, kind, onMute) => {
    const muted = device?.muted;
    const isOutput = kind === "output";
    return (
      <button type="button" aria-label={muted ? `解除${isOutput ? "扬声器" : "麦克风"}静音` : `${isOutput ? "扬声器" : "麦克风"}静音`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void onMute(); }} className="capsule-action rounded-full">
        <span className="relative grid place-items-center">
          <Icon name={muted ? (isOutput ? "speakerOff" : "micOff") : (isOutput ? "speaker" : "mic")} className={`size-[18px] ${muted ? "capsule-icon-muted" : "capsule-icon-live"}`} />
        </span>
      </button>
    );
  };
  return <div className="capsule-content grid h-full w-full items-center gap-0 px-2">{item(output, "output", onOutputMute)}<span className="capsule-divider" />{item(input, "input", onInputMute)}</div>;
}

function SegmentButton({ active, children, onPress }) {
  return <Button variant="ghost" onPress={onPress} className={`audio-segment-button min-w-0 flex-1 rounded-lg px-3 text-[11px] font-semibold ${active ? "audio-segment-active" : ""}`}>{children}</Button>;
}

function MainPanel({ model }) {
  const { settings, devices, activeGroup, loading, currentDevice, loadDevices, selectDevice, toggleMute, setDeviceVolume, error } = model;
  return (
    <div className="island-panel flex h-full min-h-0 w-full flex-col px-3 pb-3 pt-3">
      <div className="island-toolbar flex items-center gap-2 px-1">
        <Button isIconOnly variant="ghost" size="sm" aria-label="刷新设备" onPress={loadDevices} className="audio-toolbar-button shrink-0 rounded-full"><Icon name="refresh" className="size-4" /></Button>
        <div className="audio-segment-control flex min-w-0 flex-1 rounded-xl border p-1">
          <SegmentButton active={activeGroup === "output"} onPress={() => model.setActiveGroup("output")}><Icon name="speaker" className="mr-1.5 inline size-3.5" />输出</SegmentButton>
          <SegmentButton active={activeGroup === "input"} onPress={() => model.setActiveGroup("input")}><Icon name="mic" className="mr-1.5 inline size-3.5" />输入</SegmentButton>
        </div>
        <Button isIconOnly variant="ghost" size="sm" aria-label="打开设置" onPress={model.openSettings} className="audio-toolbar-button shrink-0 rounded-full"><Settings2 strokeWidth={1.8} className="size-[17px]" /></Button>
      </div>
      <div className="island-panel-body min-h-0 flex-1 pt-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={activeGroup} initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -5 }} transition={{ duration: 0.16, ease: "easeOut" }} className="h-full">
            <DeviceGroup kind={activeGroup} devices={devices[activeGroup]} loading={loading} currentDevice={currentDevice} onMute={() => toggleMute(activeGroup)} onVolume={setDeviceVolume} onSelect={selectDevice} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="island-footer flex items-center justify-between px-1 pt-2 text-[9px] font-medium text-white/35"><span>{activeGroup === "output" ? "输出控制" : "输入控制"}</span><span><kbd>Esc</kbd> 收起</span></div>
      {error && <div className="mt-2 rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-center text-[10px] text-red-200">{error}</div>}
    </div>
  );
}

function MainWindow({ model }) {
  const output = model.currentDevice("output");
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
        onUpdate={(latest) => model.requestNativeGeometry({ width: latest.width, height: latest.height, radius: Number.parseFloat(String(latest.borderBottomLeftRadius ?? geometry.radius)) || geometry.radius })}
        onAnimationComplete={model.onIslandAnimationComplete}
      >
        <AnimatePresence initial={false} mode="wait">
          {isExpandedTarget ? (
            <motion.div key={model.isSettingsView ? "settings" : "expanded"} className="island-content island-content-expanded" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.18, ease: "easeOut" }}>
              {model.isSettingsView ? <IslandSettingsPanel model={model} /> : <MainPanel model={model} />}
            </motion.div>
          ) : (
            <motion.div key="collapsed" className="island-content island-content-collapsed" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.16, ease: "easeOut" }}>
              <Capsule output={output} input={input} onOutputMute={() => model.toggleMute("output")} onInputMute={() => model.toggleMute("input")} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  );
}

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
  const busy = ["checking", "downloading", "installed"].includes(model.updateStatus);
  return (
    <section className="inline-settings-section mt-3">
      <div className="inline-settings-section-heading">
        <div><strong>应用更新</strong><small>通过 GitHub Releases 获取稳定版本</small></div>
        <span className={`inline-settings-value ${hasUpdate ? "inline-settings-value-highlight" : ""}`}>{statusLabels[model.updateStatus]}</span>
      </div>
      <div className="update-card flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
        <div className="min-w-0">
          <strong className="block truncate text-[11px] font-semibold text-white/82">{hasUpdate ? `Audio Switcher ${model.updateInfo.version}` : "检查应用版本"}</strong>
          <small className="mt-0.5 block truncate text-[9px] font-medium text-white/38">{hasUpdate ? (model.updateInfo.notes || "新的稳定版本已发布") : "更新包会在安装后自动重启应用"}</small>
        </div>
        <Button size="sm" variant="ghost" isDisabled={busy} onPress={hasUpdate ? model.installUpdate : model.checkForUpdates} className="update-action shrink-0 rounded-lg px-3 text-[10px] font-semibold">
          {hasUpdate ? "安装更新" : busy ? statusLabels[model.updateStatus] : "检查更新"}
        </Button>
      </div>
      {model.updateStatus === "downloading" && <div className="update-progress mt-2"><span style={{ width: `${model.updateProgress}%` }} /></div>}
      {model.updateError && <p className="mt-2 text-[9px] font-medium text-red-200/80">{model.updateError}</p>}
    </section>
  );
}

function IslandSettingsPanel({ model }) {
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
          </div>
          <p className="mt-2 text-[9px] font-medium leading-relaxed text-white/30">按 Esc 取消录入，不会修改原快捷键。</p>
        </section>
      </div>

      {error && <div className="mt-2 rounded-lg border border-red-300/20 bg-red-400/10 px-2 py-1.5 text-center text-[9px] text-red-200">{error}</div>}
      <div className="inline-settings-footer flex items-center justify-between px-1 pt-2 text-[9px] font-medium text-white/35"><span>设置自动保存</span><span><kbd>Esc</kbd> 返回面板</span></div>
    </div>
  );
}

function App() {
  const model = useAudioSwitcher();
  return <MainWindow model={model} />;
}

createRoot(document.querySelector("#app")).render(<App />);
