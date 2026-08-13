import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, cursorPosition, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { register as registerGlobalShortcut, unregister as unregisterGlobalShortcut, unregisterAll as unregisterAllGlobalShortcuts } from "@tauri-apps/plugin-global-shortcut";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import {
  applyThemeVariables,
  clipboardDetailPanelHeight,
  clipboardPanelHeight,
  COLLAPSED_GEOMETRY,
  FALLBACK_DEVICES,
  ISLAND_WIDTH,
  loadSettings,
  normalizeShortcut,
  PANEL_MIN_HEIGHT,
  NATIVE_WINDOW_GEOMETRY,
  panelHeightFor,
  persistSettings,
  shortcutFromEvent,
} from "../lib/app-config";

const currentWindow = getCurrentWindow();

export function useAudioSwitcher() {
  const initialSettings = useMemo(() => loadSettings(), []);
  const [settings, setSettings] = useState(initialSettings);
  const settingsRef = useRef(initialSettings);
  const [devices, setDevices] = useState({ output: [], input: [] });
  const [clipboardItems, setClipboardItems] = useState([]);
  const [clipboardImages, setClipboardImages] = useState({});
  const [clipboardDetailId, setClipboardDetailId] = useState("");
  const [clipboardQuery, setClipboardQuery] = useState("");
  const [clipboardCopyState, setClipboardCopyState] = useState({ id: "", phase: "idle" });
  const [panelMode, setPanelMode] = useState("audio");
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
  const clipboardCopyTimerRef = useRef(0);
  const pendingUpdate = useRef(null);
  const registeredShortcuts = useRef(new Set());
  const shortcutRegistrationQueue = useRef(Promise.resolve());
  const nativeFrameKeyRef = useRef("");
  const nativeScaleRef = useRef(1);
  const islandElementRef = useRef(null);
  const ignoreCursorEventsRef = useRef(null);
  const cursorPollBusyRef = useRef(false);
  const cursorCollapseTimerRef = useRef(0);
  const collapsePanelRef = useRef(null);

  const expanded = islandState === "expanding" || islandState === "expanded";
  const activeDevices = devices[activeGroup] ?? [];
  const filteredClipboardItems = useMemo(() => {
    const query = clipboardQuery.trim().toLowerCase();
    if (!query) return clipboardItems;
    return clipboardItems.filter((item) => {
      const searchableText = item.kind === "image" ? "图片剪贴板" : item.text;
      return searchableText.toLowerCase().includes(query);
    });
  }, [clipboardItems, clipboardQuery]);
  const clipboardDetailItem = useMemo(() => clipboardItems.find((item) => item.id === clipboardDetailId) ?? null, [clipboardDetailId, clipboardItems]);
  const expandedHeight = isSettingsView
    ? 430
    : panelMode === "clipboard"
      ? clipboardDetailItem ? clipboardDetailPanelHeight(clipboardDetailItem) : clipboardPanelHeight(filteredClipboardItems)
      : panelHeightFor(activeDevices, settings.panelHeight);

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
      setDevices(structuredClone(FALLBACK_DEVICES));
      setError("原生音频接口暂不可用，当前显示预览设备");
      console.warn(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadClipboardImages = useCallback(async (items) => {
    const imageItems = items.filter((item) => item?.kind === "image" && item.id);
    if (!imageItems.length) return;
    const entries = await Promise.all(imageItems.map(async (item) => {
      try {
        const image = await invoke("get_clipboard_image", { id: item.id });
        return image?.data_url ? [item.id, image] : null;
      } catch (imageError) {
        console.warn(imageError);
        return null;
      }
    }));
    const nextEntries = Object.fromEntries(entries.filter(Boolean));
    if (Object.keys(nextEntries).length) setClipboardImages((previous) => ({ ...previous, ...nextEntries }));
  }, []);

  const loadClipboardHistory = useCallback(async () => {
    try {
      const result = await invoke("get_clipboard_history");
      const items = Array.isArray(result) ? result : [];
      setClipboardItems(items);
      setClipboardImages((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => items.some((item) => item.id === id))));
      await loadClipboardImages(items);
    } catch (clipboardError) {
      setError("剪贴板历史读取失败");
      console.warn(clipboardError);
    }
  }, [loadClipboardImages]);

  const clearClipboardHistory = useCallback(async () => {
    try {
      await invoke("clear_clipboard_history");
      setClipboardItems([]);
      setClipboardImages({});
      setClipboardDetailId("");
      setClipboardCopyState({ id: "", phase: "idle" });
      setError("");
    } catch (clipboardError) {
      setError("清空剪贴板历史失败");
      console.warn(clipboardError);
    }
  }, []);

  useEffect(() => () => {
    if (clipboardCopyTimerRef.current) window.clearTimeout(clipboardCopyTimerRef.current);
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
    const fallbackFrame = NATIVE_WINDOW_GEOMETRY;
    const safeFrame = {
      width: fallbackFrame.width,
      height: fallbackFrame.height,
    };
    const frameKey = `${safeFrame.width}:${safeFrame.height}:${position}:${displayMode}`;
    let scale = nativeScaleRef.current || 1;

    if (frameKey !== nativeFrameKeyRef.current) {
      // Sizing must not depend on monitor lookup. During packaged startup,
      // currentMonitor can briefly return null; otherwise Tauri leaves the
      // native window at its fallback 16x16 size and the app stays invisible.
      const monitor = await currentMonitor();
      if (!monitor) {
        await currentWindow.setSize(new LogicalSize(safeFrame.width, safeFrame.height));
        return;
      }
      scale = monitor.scaleFactor || 1;
      nativeScaleRef.current = scale;
      const physicalFrameWidth = Math.max(1, Math.round(safeFrame.width * scale));
      const physicalFrameHeight = Math.max(1, Math.round(safeFrame.height * scale));
      const area = displayMode === "attached" ? monitor : monitor.workArea;
      const margin = Math.round(16 * scale);
      const xCenter = Math.round(area.position.x + (area.size.width - physicalFrameWidth) / 2);
      const yCenter = Math.round(area.position.y + (area.size.height - physicalFrameHeight) / 2);
      const x = position === "right" ? area.position.x + area.size.width - physicalFrameWidth - margin : xCenter;
      const y = position === "top" ? area.position.y : position === "bottom" ? area.position.y + area.size.height - physicalFrameHeight - margin : yCenter;

      try {
        // SetWindowPos applies the full frame in one native operation. Calling
        // setSize and setPosition separately exposes an intermediate frame in
        // which the collapsed capsule is drawn at the old left edge.
        await invoke("set_panel_geometry", {
          x: Math.round(x),
          y: Math.round(y),
          width: physicalFrameWidth,
          height: physicalFrameHeight,
        });
      } catch (geometryError) {
        console.warn("atomic window geometry synchronization failed", geometryError);
        await currentWindow.setSize(new LogicalSize(safeFrame.width, safeFrame.height));
        await currentWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
      }
      nativeFrameKeyRef.current = frameKey;
    }

  }, []);

  const requestNativeGeometry = useCallback((geometry, frameOverride) => {
    if (!geometry) return Promise.resolve();
    const frame = frameOverride ?? (islandStateRef.current === "collapsed"
      ? COLLAPSED_GEOMETRY
      : { width: ISLAND_WIDTH, height: Math.max(PANEL_MIN_HEIGHT, Number(expandedHeight) || PANEL_MIN_HEIGHT) });
    const safeGeometry = {
      width: Math.max(1, Number(geometry.width)),
      height: Math.max(1, Number(geometry.height)),
      radius: Math.max(1, Number(geometry.radius ?? 20)),
    };
    return syncNativeFrame(frame, safeGeometry).catch((geometryError) => {
      console.warn("window geometry synchronization failed", geometryError);
    });
  }, [expandedHeight, syncNativeFrame]);

  useEffect(() => {
    let active = true;
    void syncNativeFrame(COLLAPSED_GEOMETRY, COLLAPSED_GEOMETRY)
      .then(() => {
        if (active) return currentWindow.show();
        return undefined;
      })
      .catch((geometryError) => console.warn("initial window preparation failed", geometryError));
    return () => {
      active = false;
    };
  }, [syncNativeFrame]);

  useEffect(() => {
    if (islandState === "collapsing") return;
    const frame = islandState === "collapsed"
      ? COLLAPSED_GEOMETRY
      : { width: ISLAND_WIDTH, height: Math.max(PANEL_MIN_HEIGHT, Number(expandedHeight) || PANEL_MIN_HEIGHT) };
    void requestNativeGeometry(frame, frame);
  }, [expandedHeight, islandState, requestNativeGeometry, settings.displayMode, settings.panelHeight, settings.position]);

  const syncCursorEvents = useCallback(async () => {
    const state = islandStateRef.current;
    if (state === "collapsing" || !islandElementRef.current) return;
    const [cursor, windowPosition] = await Promise.all([cursorPosition(), currentWindow.innerPosition()]);
    const rect = islandElementRef.current.getBoundingClientRect();
    const scale = window.devicePixelRatio || nativeScaleRef.current || 1;
    const left = windowPosition.x + rect.left * scale;
    const top = windowPosition.y + rect.top * scale;
    const right = left + rect.width * scale;
    const bottom = top + rect.height * scale;
    const inside = cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom;

    // WinIsland keeps the fixed native surface interactive while the island
    // is open. If we turn on click-through immediately after the pointer
    // leaves the shell, Windows reports a focus loss and the focus listener
    // collapses the island in the same frame. Delay that transition until the
    // leave timer has actually collapsed the shell.
    if (state === "expanding" || state === "expanded") {
      if (inside && cursorCollapseTimerRef.current) {
        window.clearTimeout(cursorCollapseTimerRef.current);
        cursorCollapseTimerRef.current = 0;
      }
      if (!inside && state === "expanded" && !cursorCollapseTimerRef.current) {
        cursorCollapseTimerRef.current = window.setTimeout(() => {
          cursorCollapseTimerRef.current = 0;
          if (islandStateRef.current === "expanded") collapsePanelRef.current?.();
        }, 400);
      }
      await setIgnoreCursorEvents(false);
      return;
    }

    if (inside) {
      if (cursorCollapseTimerRef.current) {
        window.clearTimeout(cursorCollapseTimerRef.current);
        cursorCollapseTimerRef.current = 0;
      }
      await setIgnoreCursorEvents(false);
      return;
    }

    await setIgnoreCursorEvents(true);
  }, [setIgnoreCursorEvents]);

  useEffect(() => {
    if (islandState === "collapsing") {
      if (cursorCollapseTimerRef.current) {
        window.clearTimeout(cursorCollapseTimerRef.current);
        cursorCollapseTimerRef.current = 0;
      }
      void setIgnoreCursorEvents(true);
    } else {
      void syncCursorEvents();
    }
    return undefined;
  }, [islandState, setIgnoreCursorEvents, syncCursorEvents]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (cursorPollBusyRef.current || islandStateRef.current === "collapsing") return;
      cursorPollBusyRef.current = true;
      void syncCursorEvents().finally(() => {
        cursorPollBusyRef.current = false;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [syncCursorEvents]);

  const expandPanel = useCallback(() => {
    if (islandStateRef.current !== "collapsed") return;
    // The native surface is already fixed at the maximum size. Enter the
    // renderer transition directly; no window resize or reposition belongs
    // in the click path.
    setIslandStateSafe("expanding");
  }, [setIslandStateSafe]);

  const collapsePanel = useCallback(() => {
    setIsSettingsView(false);
    if (islandStateRef.current === "collapsed" || islandStateRef.current === "collapsing") return;
    if (cursorCollapseTimerRef.current) {
      window.clearTimeout(cursorCollapseTimerRef.current);
      cursorCollapseTimerRef.current = 0;
    }
    setCapturingShortcut("");
    void setIgnoreCursorEvents(true);
    setIslandStateSafe("collapsing");
  }, [setIgnoreCursorEvents, setIslandStateSafe]);

  collapsePanelRef.current = collapsePanel;

  const announceClipboardCopy = useCallback((id) => {
    if (clipboardCopyTimerRef.current) window.clearTimeout(clipboardCopyTimerRef.current);
    setClipboardCopyState({ id, phase: "loading" });
    setIsSettingsView(false);
    setClipboardDetailId("");
    collapsePanel();
    clipboardCopyTimerRef.current = window.setTimeout(() => {
      setClipboardCopyState({ id, phase: "success" });
      clipboardCopyTimerRef.current = window.setTimeout(() => setClipboardCopyState({ id: "", phase: "idle" }), 950);
    }, 900);
  }, [collapsePanel]);

  const copyClipboardItem = useCallback(async (item) => {
    announceClipboardCopy(item.id);
    try {
      if (item.kind === "image") await invoke("copy_clipboard_image", { id: item.id });
      else await invoke("copy_clipboard_item", { text: item.text });
      setError("");
    } catch (clipboardError) {
      if (clipboardCopyTimerRef.current) window.clearTimeout(clipboardCopyTimerRef.current);
      setClipboardCopyState({ id: item.id, phase: "error" });
      clipboardCopyTimerRef.current = window.setTimeout(() => setClipboardCopyState({ id: "", phase: "idle" }), 1200);
      setError("复制到剪贴板失败");
      console.warn(clipboardError);
    }
  }, [announceClipboardCopy]);

  const handleIslandClick = useCallback((event) => {
    if (event?.target?.closest?.("button")) return;
    if (islandStateRef.current === "collapsed") void expandPanel();
  }, [expandPanel]);

  const handleIslandMouseEnter = useCallback(() => {
    void setIgnoreCursorEvents(false);
  }, [setIgnoreCursorEvents]);

  const handleIslandMouseLeave = useCallback(() => {
    void syncCursorEvents();
  }, [syncCursorEvents]);

  const onIslandAnimationComplete = useCallback(() => {
    if (islandStateRef.current === "expanding") setIslandStateSafe("expanded");
    if (islandStateRef.current === "collapsing") {
      setIslandStateSafe("collapsed");
      void requestNativeGeometry(COLLAPSED_GEOMETRY, COLLAPSED_GEOMETRY)
        .then(() => syncCursorEvents());
    }
  }, [requestNativeGeometry, setIslandStateSafe, syncCursorEvents]);

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
      void requestNativeGeometry(COLLAPSED_GEOMETRY, COLLAPSED_GEOMETRY);
      await currentWindow.show();
      await currentWindow.setFocus();
      return;
    }
    if (islandStateRef.current === "collapsed") void expandPanel();
    else collapsePanel();
  }, [collapsePanel, expandPanel, requestNativeGeometry, setIslandStateSafe]);

  const showClipboardPanel = useCallback(() => {
    setIsSettingsView(false);
    setPanelMode("clipboard");
    setClipboardDetailId("");
    if (islandStateRef.current === "collapsed") void expandPanel();
  }, [expandPanel]);

  const showClipboardDetail = useCallback((id) => {
    setIsSettingsView(false);
    setPanelMode("clipboard");
    setClipboardDetailId(id);
    if (islandStateRef.current === "collapsed") void expandPanel();
  }, [expandPanel]);

  const initializeShortcuts = useCallback(() => {
    const registerTask = async () => {
      const shortcuts = settingsRef.current.shortcuts;
      const entries = [
        [normalizeShortcut(shortcuts.togglePanel), shortcutHandler(() => {
          void showOrHidePanel();
        })],
        [normalizeShortcut(shortcuts.toggleMic), shortcutHandler(toggleCurrentMic)],
        [normalizeShortcut(shortcuts.toggleClipboard), shortcutHandler(() => {
          void showClipboardPanel();
        })],
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
  }, [shortcutHandler, showClipboardPanel, showOrHidePanel, toggleCurrentMic, unregisterTrackedShortcuts]);

  const updateShortcut = useCallback(async (target, nextShortcut) => {
    const previousSettings = settingsRef.current;
    const targets = Object.keys(previousSettings.shortcuts);
    if (targets.some((candidate) => candidate !== target && nextShortcut === previousSettings.shortcuts[candidate])) {
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
    if (islandStateRef.current === "collapsed") void expandPanel();
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
      if (!silent) setUpdateError("暂时无法检查更新");
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
      // A click-through toggle can briefly emit a blur while the shell is
      // expanding. Only a fully expanded island should react to a real blur.
      if (!focused && islandStateRef.current === "expanded") collapsePanel();
    }).then((cleanup) => { focusCleanup = cleanup; }).catch((focusError) => console.warn("focus listener unavailable", focusError));

    return () => {
      focusCleanup?.();
      void unregisterTrackedShortcuts();
    };
  }, [collapsePanel, loadAutostart, loadDevices, unregisterTrackedShortcuts]);

  useEffect(() => {
    let unlisten;
    void loadClipboardHistory();
    void listen("clipboard-updated", ({ payload }) => {
      if (!payload?.id) return;
      setClipboardItems((previous) => [payload, ...previous.filter((item) => item.id !== payload.id && !(payload.kind === "text" && item.kind === "text" && item.text === payload.text))].slice(0, 50));
      void loadClipboardImages([payload]);
      announceClipboardCopy(payload.id);
    }).then((cleanup) => {
      unlisten = cleanup;
    }).catch((clipboardError) => console.warn("clipboard listener unavailable", clipboardError));
    return () => unlisten?.();
  }, [announceClipboardCopy, loadClipboardImages, loadClipboardHistory]);

  useEffect(() => {
    void initializeShortcuts();
    return () => {
      void unregisterTrackedShortcuts();
    };
  }, [initializeShortcuts, unregisterTrackedShortcuts]);

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
    clipboardItems,
    clipboardImages,
    clipboardDetailId,
    clipboardDetailItem,
    setClipboardDetailId,
    filteredClipboardItems,
    clipboardQuery,
    setClipboardQuery,
    clipboardCopyState,
    panelMode,
    setPanelMode,
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
    loadClipboardHistory,
    copyClipboardItem,
    clearClipboardHistory,
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
    showOrHidePanel,
    showClipboardPanel,
    showClipboardDetail,
    updateStatus,
    updateInfo,
    updateProgress,
    updateError,
    checkForUpdates,
    installUpdate,
  };
}
