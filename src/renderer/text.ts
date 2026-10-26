// Small text helpers shared by the UI and the exporters.

export function slugify(s: string): string {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "dungeon"
  );
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** HTML that is already safe to insert; produced only by the `html` template below. */
export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

export type HtmlValue =
  SafeHtml | string | number | null | undefined | false | readonly HtmlValue[];

function renderValue(v: HtmlValue): string {
  if (v == null || v === false) return "";
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return escapeHtml(String(v));
}

/** Tagged template: literal parts are trusted, every interpolated value is escaped (unless already SafeHtml). */
export function html(
  strings: TemplateStringsArray,
  ...values: HtmlValue[]
): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += renderValue(v) + (strings[i + 1] ?? "");
  });
  return new SafeHtml(out);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const megabytes = (bytes: number): string =>
  `${(bytes / 1048576).toFixed(1)} MB`;
