/**
 * Generates src/theme-colors.css — run from repo root: npm run gen:theme
 * Tông trung tính: 20 palette × (light + dark).
 */
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = existsSync(resolve(__dirname, "..", "package.json"))
  ? resolve(__dirname, "..")
  : resolve(__dirname, "..", "..");
const out = join(ROOT, "src", "theme-colors.css");

function arrow(hex) {
  const s = hex.replace("#", "").toUpperCase();
  return `url("data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='m6 9 6 6 6-6' stroke='%23${s}' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
}

const successSoft = "#ecf4f0";
const successInk = "#3f5c4f";
const dangerSoft = "#f8ecee";
const dangerInk = "#9f2d3d";

/** Mặc định app — đổi chỗ duy nhất để đổi “chốt màu” toàn cục (CSS :not fallback + SPA). */
const DEFAULT_PALETTE_ID = "inkwell";

/** @type {{ id: string; L: Record<string,string>; D: Record<string,string>; shadowL?: string; shadowD?: string }[]} */
const defs = [
  {
    id: "classic",
    L: {
      bg: "#f3f4f6",
      "panel-soft": "#f8f9fa",
      ink: "#18181b",
      muted: "#71717a",
      line: "#e4e4e7",
      "line-strong": "#d4d4d8",
      accent: "#4b5563",
      "accent-soft": "#eceef2",
    },
    D: {
      bg: "#0c0d0f",
      "panel-soft": "#111113",
      ink: "#f4f4f5",
      muted: "#a1a1aa",
      line: "#27272a",
      "line-strong": "#3f3f46",
      accent: "#a1a1aa",
      "accent-soft": "#232429",
    },
  },
  {
    id: "ocean",
    L: {
      bg: "#f3f6f6",
      "panel-soft": "#f7faf9",
      ink: "#18181b",
      muted: "#6b7372",
      line: "#e2e9e8",
      "line-strong": "#d0dcdc",
      accent: "#4a5b59",
      "accent-soft": "#eaf0ef",
    },
    D: {
      bg: "#0c0f0e",
      "panel-soft": "#101413",
      ink: "#f4f7f7",
      muted: "#9da8a7",
      line: "#262f2e",
      "line-strong": "#3a4847",
      accent: "#9eada9",
      "accent-soft": "#212a29",
    },
    shadowL: "rgba(0, 0, 0, 0.055)",
  },
  {
    id: "sunset",
    L: {
      bg: "#f7f6f4",
      "panel-soft": "#fafaf8",
      ink: "#1c1917",
      muted: "#78716c",
      line: "#e9e7e5",
      "line-strong": "#d9d6d3",
      accent: "#57534e",
      "accent-soft": "#f0eee9",
    },
    D: {
      bg: "#0f0e0d",
      "panel-soft": "#131211",
      ink: "#f7f5f3",
      muted: "#b4aba4",
      line: "#332f2d",
      "line-strong": "#4e4845",
      accent: "#b8ada5",
      "accent-soft": "#292522",
    },
    shadowL: "rgba(28, 25, 23, 0.05)",
  },
  {
    id: "violet",
    L: {
      bg: "#f4f3f6",
      "panel-soft": "#faf9fb",
      ink: "#18181b",
      muted: "#716e78",
      line: "#e9e8ec",
      "line-strong": "#dad9e0",
      accent: "#5c5966",
      "accent-soft": "#eef0f4",
    },
    D: {
      bg: "#0d0c10",
      "panel-soft": "#111015",
      ink: "#f2f2f6",
      muted: "#a8a5b5",
      line: "#2c2a34",
      "line-strong": "#43404e",
      accent: "#aea9bc",
      "accent-soft": "#28262f",
    },
    shadowL: "rgba(24, 20, 40, 0.05)",
  },
  {
    id: "graphite",
    L: {
      bg: "#f0f1f3",
      "panel-soft": "#f6f7f8",
      ink: "#18181b",
      muted: "#6b6e75",
      line: "#dfe1e5",
      "line-strong": "#cbced4",
      accent: "#3d4249",
      "accent-soft": "#e8eaee",
    },
    D: {
      bg: "#0a0b0c",
      "panel-soft": "#0e0f11",
      ink: "#f3f4f6",
      muted: "#9ca0a8",
      line: "#25282e",
      "line-strong": "#3a3f47",
      accent: "#9ca0a8",
      "accent-soft": "#1e2228",
    },
  },
  {
    id: "parchment",
    L: {
      bg: "#faf6ed",
      "panel-soft": "#fdfaf3",
      ink: "#1c1917",
      muted: "#756f66",
      line: "#ebe4d8",
      "line-strong": "#dad2c4",
      accent: "#565049",
      "accent-soft": "#f2ebe0",
    },
    D: {
      bg: "#12100d",
      "panel-soft": "#1a1814",
      ink: "#f7f3ea",
      muted: "#a89b8c",
      line: "#3a352e",
      "line-strong": "#534c42",
      accent: "#b5a99a",
      "accent-soft": "#2a2620",
    },
    shadowL: "rgba(40, 35, 25, 0.05)",
  },
  {
    id: "mist",
    L: {
      bg: "#eef2f7",
      "panel-soft": "#f5f7fb",
      ink: "#18181b",
      muted: "#647081",
      line: "#dde3ec",
      "line-strong": "#c8d0dc",
      accent: "#475468",
      "accent-soft": "#e6ecf4",
    },
    D: {
      bg: "#0c0e12",
      "panel-soft": "#10141a",
      ink: "#eef2f8",
      muted: "#8e9aaf",
      line: "#262d3a",
      "line-strong": "#3a4556",
      accent: "#96a4ba",
      "accent-soft": "#1c2430",
    },
  },
  {
    id: "sandstone",
    L: {
      bg: "#f5f3ef",
      "panel-soft": "#faf8f4",
      ink: "#1c1917",
      muted: "#736a62",
      line: "#e6e2dc",
      "line-strong": "#d4cfc6",
      accent: "#524c46",
      "accent-soft": "#edeae3",
    },
    D: {
      bg: "#100e0b",
      "panel-soft": "#181613",
      ink: "#f5f3ef",
      muted: "#a89f96",
      line: "#34302b",
      "line-strong": "#4f4942",
      accent: "#ae9f94",
      "accent-soft": "#292521",
    },
  },
  {
    id: "fog",
    L: {
      bg: "#fafafa",
      "panel-soft": "#fdfdfd",
      ink: "#18181b",
      muted: "#737373",
      line: "#e5e5e5",
      "line-strong": "#d4d4d4",
      accent: "#525252",
      "accent-soft": "#f0f0f0",
    },
    D: {
      bg: "#0a0a0a",
      "panel-soft": "#141414",
      ink: "#fafafa",
      muted: "#a3a3a3",
      line: "#262626",
      "line-strong": "#404040",
      accent: "#a3a3a3",
      "accent-soft": "#1f1f1f",
    },
    shadowL: "rgba(0, 0, 0, 0.04)",
  },
  {
    id: "birch",
    L: {
      bg: "#fafaf9",
      "panel-soft": "#fcfcfc",
      ink: "#171717",
      muted: "#6f6f6f",
      line: "#e7e5e4",
      "line-strong": "#d6d3d1",
      accent: "#44403c",
      "accent-soft": "#f0eeec",
    },
    D: {
      bg: "#0c0b0a",
      "panel-soft": "#131110",
      ink: "#fafaf9",
      muted: "#a8a29e",
      line: "#2e2a28",
      "line-strong": "#48423e",
      accent: "#a8a29e",
      "accent-soft": "#24201e",
    },
  },
  {
    id: "pewter",
    L: {
      bg: "#f0f2f6",
      "panel-soft": "#f6f7fa",
      ink: "#18181b",
      muted: "#656b78",
      line: "#dde0e8",
      "line-strong": "#c8ccd6",
      accent: "#505866",
      "accent-soft": "#e8ebf2",
    },
    D: {
      bg: "#0b0d11",
      "panel-soft": "#101218",
      ink: "#eef1f7",
      muted: "#949bab",
      line: "#262a35",
      "line-strong": "#3c424f",
      accent: "#9aa3b4",
      "accent-soft": "#1e232d",
    },
  },
  {
    id: "oyster",
    L: {
      bg: "#f8f7f9",
      "panel-soft": "#fcfbfd",
      ink: "#18181b",
      muted: "#6f6d75",
      line: "#e8e7ec",
      "line-strong": "#d8d6de",
      accent: "#57545e",
      "accent-soft": "#f0eff4",
    },
    D: {
      bg: "#0d0c0f",
      "panel-soft": "#121116",
      ink: "#f4f3f8",
      muted: "#a29eac",
      line: "#2c2a32",
      "line-strong": "#45424e",
      accent: "#b4afc0",
      "accent-soft": "#24222a",
    },
  },
  {
    id: "shale",
    L: {
      bg: "#eff2f0",
      "panel-soft": "#f6f8f7",
      ink: "#18181b",
      muted: "#5f6864",
      line: "#dbe0dd",
      "line-strong": "#c5ccc8",
      accent: "#464f4b",
      "accent-soft": "#e5ebe8",
    },
    D: {
      bg: "#0b0e0c",
      "panel-soft": "#0f1311",
      ink: "#f0f4f2",
      muted: "#96a39e",
      line: "#252f2b",
      "line-strong": "#3a4742",
      accent: "#9eada7",
      "accent-soft": "#1c2421",
    },
  },
  {
    id: "sage",
    L: {
      bg: "#f1f3ef",
      "panel-soft": "#f7f9f5",
      ink: "#18181b",
      muted: "#656e64",
      line: "#dde2db",
      "line-strong": "#c8d0c7",
      accent: "#4a5349",
      "accent-soft": "#e6ece4",
    },
    D: {
      bg: "#0b0d0b",
      "panel-soft": "#101210",
      ink: "#f1f4f0",
      muted: "#9aa396",
      line: "#262b26",
      "line-strong": "#3b443b",
      accent: "#a3ada1",
      "accent-soft": "#1d221d",
    },
  },
  {
    id: "latte",
    L: {
      bg: "#f9f6f1",
      "panel-soft": "#fcfaf6",
      ink: "#1c1917",
      muted: "#736d64",
      line: "#ebe6de",
      "line-strong": "#dad3c8",
      accent: "#585248",
      "accent-soft": "#f1ece3",
    },
    D: {
      bg: "#100f0c",
      "panel-soft": "#181612",
      ink: "#f8f5ef",
      muted: "#ada294",
      line: "#34302a",
      "line-strong": "#4d4740",
      accent: "#b8ab9c",
      "accent-soft": "#28241e",
    },
  },
  {
    id: "cedar",
    L: {
      bg: "#f4f1ec",
      "panel-soft": "#faf7f1",
      ink: "#1c1917",
      muted: "#6e6860",
      line: "#e6e0d8",
      "line-strong": "#d3ccc2",
      accent: "#524a42",
      "accent-soft": "#ede8e0",
    },
    D: {
      bg: "#0f0d0a",
      "panel-soft": "#16140f",
      ink: "#f5f1ea",
      muted: "#a3988c",
      line: "#332f29",
      "line-strong": "#4c4640",
      accent: "#b0a090",
      "accent-soft": "#26221c",
    },
  },
  {
    id: "cobalt",
    L: {
      bg: "#eef1f8",
      "panel-soft": "#f5f7fd",
      ink: "#18181b",
      muted: "#636b7c",
      line: "#dde2ef",
      "line-strong": "#c8d0e3",
      accent: "#4a5a72",
      "accent-soft": "#e6eaf5",
    },
    D: {
      bg: "#0b0d12",
      "panel-soft": "#10131a",
      ink: "#eef2fb",
      muted: "#949db2",
      line: "#262c3b",
      "line-strong": "#3a4358",
      accent: "#9eadc8",
      "accent-soft": "#1c2330",
    },
  },
  {
    id: "inkwell",
    L: {
      bg: "#ebecef",
      "panel-soft": "#f3f4f6",
      ink: "#111113",
      muted: "#5c5e66",
      line: "#d8d9df",
      "line-strong": "#c2c4cd",
      accent: "#32343b",
      "accent-soft": "#e4e6ec",
    },
    D: {
      bg: "#080809",
      "panel-soft": "#0d0d0f",
      ink: "#f0f0f2",
      muted: "#888b94",
      line: "#222226",
      "line-strong": "#383a42",
      accent: "#9b9ea8",
      "accent-soft": "#1a1b1f",
    },
    shadowL: "rgba(0, 0, 0, 0.07)",
  },
  {
    id: "storm",
    L: {
      bg: "#e8ecf2",
      "panel-soft": "#f0f3f8",
      ink: "#18181b",
      muted: "#5f6672",
      line: "#d5dbe5",
      "line-strong": "#bfc7d4",
      accent: "#434a56",
      "accent-soft": "#e2e7ef",
    },
    D: {
      bg: "#0b0d10",
      "panel-soft": "#101318",
      ink: "#eceff4",
      muted: "#949ca8",
      line: "#262b34",
      "line-strong": "#3c434e",
      accent: "#a0a9b6",
      "accent-soft": "#1c2128",
    },
  },
  {
    id: "noir",
    L: {
      bg: "#e6e7e9",
      "panel-soft": "#efeff2",
      ink: "#0a0a0b",
      muted: "#52545c",
      line: "#d0d2d6",
      "line-strong": "#b8bbc2",
      accent: "#2d2f35",
      "accent-soft": "#dcdee3",
    },
    D: {
      bg: "#050506",
      "panel-soft": "#0a0a0c",
      ink: "#ececed",
      muted: "#8b8d96",
      line: "#1e1f24",
      "line-strong": "#32343c",
      accent: "#9ea1ab",
      "accent-soft": "#15161a",
    },
    shadowL: "rgba(0, 0, 0, 0.08)",
  },
];

function blockLight(p) {
  const sh = p.shadowL ?? "rgba(0, 0, 0, 0.06)";
  const m = p.L.muted;
  return `html[data-theme="light"][data-palette="${p.id}"] {
  --bg: ${p.L.bg};
  --panel: #ffffff;
  --panel-soft: ${p.L["panel-soft"]};
  --ink: ${p.L.ink};
  --muted: ${p.L.muted};
  --line: ${p.L.line};
  --line-strong: ${p.L["line-strong"]};
  --accent: ${p.L.accent};
  --accent-soft: ${p.L["accent-soft"]};
  --success-soft: ${successSoft};
  --success-ink: ${successInk};
  --danger-soft: ${dangerSoft};
  --danger-ink: ${dangerInk};
  --shadow: 0 12px 32px ${sh};
  --select-arrow: ${arrow(m)};
}`;
}

function blockDark(p) {
  const sh = p.shadowD ?? "rgba(0, 0, 0, 0.45)";
  const m = p.D.muted;
  return `html[data-theme="dark"][data-palette="${p.id}"] {
  --bg: ${p.D.bg};
  --panel: #16171a;
  --panel-soft: ${p.D["panel-soft"]};
  --ink: ${p.D.ink};
  --muted: ${p.D.muted};
  --line: ${p.D.line};
  --line-strong: ${p.D["line-strong"]};
  --accent: ${p.D.accent};
  --accent-soft: ${p.D["accent-soft"]};
  --success-soft: #1a2420;
  --success-ink: #8aa899;
  --danger-soft: #2a181c;
  --danger-ink: #d4a3ad;
  --shadow: 0 16px 40px ${sh};
  --select-arrow: ${arrow(m)};
}`;
}

function blockDefaultLight(defaultId = DEFAULT_PALETTE_ID) {
  const p = defs.find((d) => d.id === defaultId);
  if (!p) throw new Error(`Unknown DEFAULT_PALETTE_ID: ${defaultId}`);
  const sh = p.shadowL ?? "rgba(0, 0, 0, 0.06)";
  const m = p.L.muted;
  return `html[data-theme="light"]:where(:not([data-palette]), [data-palette="${defaultId}"]) {
  --bg: ${p.L.bg};
  --panel: #ffffff;
  --panel-soft: ${p.L["panel-soft"]};
  --ink: ${p.L.ink};
  --muted: ${p.L.muted};
  --line: ${p.L.line};
  --line-strong: ${p.L["line-strong"]};
  --accent: ${p.L.accent};
  --accent-soft: ${p.L["accent-soft"]};
  --success-soft: ${successSoft};
  --success-ink: ${successInk};
  --danger-soft: ${dangerSoft};
  --danger-ink: ${dangerInk};
  --shadow: 0 12px 32px ${sh};
  --select-arrow: ${arrow(m)};
}`;
}

function blockDefaultDark(defaultId = DEFAULT_PALETTE_ID) {
  const p = defs.find((d) => d.id === defaultId);
  if (!p) throw new Error(`Unknown DEFAULT_PALETTE_ID: ${defaultId}`);
  const sh = p.shadowD ?? "rgba(0, 0, 0, 0.45)";
  const m = p.D.muted;
  return `html[data-theme="dark"]:where(:not([data-palette]), [data-palette="${defaultId}"]) {
  --bg: ${p.D.bg};
  --panel: #16171a;
  --panel-soft: ${p.D["panel-soft"]};
  --ink: ${p.D.ink};
  --muted: ${p.D.muted};
  --line: ${p.D.line};
  --line-strong: ${p.D["line-strong"]};
  --accent: ${p.D.accent};
  --accent-soft: ${p.D["accent-soft"]};
  --success-soft: #1a2420;
  --success-ink: #8aa899;
  --danger-soft: #2a181c;
  --danger-ink: #d4a3ad;
  --shadow: 0 16px 40px ${sh};
  --select-arrow: ${arrow(m)};
}`;
}

const header = `/*
  20 palette trung tính (tông xám / giấy / slate).
  Chọn: <html data-palette="..."> — khi không gán palette = dùng mặc định (${DEFAULT_PALETTE_ID} trong script).
  File được generate bởi scripts/generate-theme-colors.mjs — chạy lại sau khi sửa script.
*/

`;

const parts = [header, blockDefaultLight(), "", blockDefaultDark(), ""];

for (const p of defs.filter((d) => d.id !== DEFAULT_PALETTE_ID)) {
  parts.push(blockLight(p), "", blockDark(p), "");
}

writeFileSync(out, parts.join("\n") + "\n", "utf8");
console.log("Wrote", out, "palettes:", defs.length);
