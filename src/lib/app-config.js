import packageInfo from "../../package.json";

export const SETTINGS_KEY = "audio-switcher-settings";
export const SETTINGS_VERSION = 4;
export const APP_VERSION = packageInfo.version;

export const COLLAPSED_GEOMETRY = { width: 104, height: 42, radius: 21 };
export const ISLAND_WIDTH = 360;
export const ISLAND_SPRING = { type: "spring", stiffness: 380, damping: 36, mass: 0.8 };
export const PANEL_MIN_HEIGHT = 320;
export const PANEL_MAX_HEIGHT = 620;
export const DEFAULT_PANEL_MAX_HEIGHT = 480;
export const NATIVE_WINDOW_GEOMETRY = { width: ISLAND_WIDTH, height: PANEL_MAX_HEIGHT };

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  displayMode: "pill",
  position: "top",
  panelHeight: DEFAULT_PANEL_MAX_HEIGHT,
  shortcuts: {
    togglePanel: "Control+Shift+Space",
    toggleMic: "Control+Shift+M",
    toggleClipboard: "Control+Shift+V",
  },
};

export const FALLBACK_DEVICES = {
  output: [
    { id: "fallback-headset", name: "耳机", kind: "output", is_default: true, muted: false, volume: 0.72 },
    { id: "fallback-speakers", name: "桌面音箱", kind: "output", is_default: false, muted: true, volume: 0.55 },
  ],
  input: [
    { id: "fallback-mic", name: "桌面麦克风", kind: "input", is_default: true, muted: false, volume: 0.84 },
    { id: "fallback-headset-mic", name: "耳机麦克风", kind: "input", is_default: false, muted: true, volume: 0.66 },
  ],
};

export function normalizeShortcut(shortcut = "") {
  return String(shortcut)
    .replaceAll("CommandOrControl", "Control")
    .replaceAll("Ctrl", "Control");
}

export function formatShortcut(shortcut = "") {
  return shortcut
    .replaceAll("CommandOrControl", "Ctrl")
    .replaceAll("Control", "Ctrl")
    .replaceAll("ArrowUp", "↑")
    .replaceAll("ArrowDown", "↓")
    .replaceAll("ArrowLeft", "←")
    .replaceAll("ArrowRight", "→");
}

export function shortcutFromEvent(event) {
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

export function loadSettings() {
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
        toggleClipboard: normalizeShortcut(savedShortcuts.toggleClipboard ?? DEFAULT_SETTINGS.shortcuts.toggleClipboard),
      },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function persistSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function applyThemeVariables() {
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

export function panelHeightFor(devices, maxHeight) {
  const listHeight = Math.max(54, Math.min(330, devices.length * 54 + Math.max(0, devices.length - 1) * 8));
  return Math.min(maxHeight, Math.max(252, 152 + listHeight));
}

export function clipboardPanelHeight(items) {
  return Math.min(560, Math.max(300, 172 + Math.min(items.length, 6) * 58));
}

export function clipboardDetailPanelHeight(item) {
  return item?.kind === "image" ? 420 : 400;
}
