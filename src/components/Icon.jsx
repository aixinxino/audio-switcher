import React from "react";

export function Icon({ name, className = "size-5" }) {
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
    clipboard: <><rect x="6" y="5" width="13" height="16" rx="2" /><path d="M9 5V3h6v2M9 10h7M9 14h7M9 18h4" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.speaker}</svg>;
}
