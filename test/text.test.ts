// Text helpers: slugs, HTML escaping, the html template and base64.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SafeHtml,
  bytesToBase64,
  escapeHtml,
  html,
  megabytes,
  slugify,
} from "../src/renderer/text.ts";

test("html template escapes values but keeps nested SafeHtml", () => {
  const inner = html`<b>${"x&y"}</b>`;
  assert.equal(
    html`<p>${"<i>"}${inner}${[1, " & ", 2]}</p>`.value,
    "<p>&lt;i&gt;<b>x&amp;y</b>1 &amp; 2</p>",
  );
});

test("slugify makes safe file names, and never an empty one", () => {
  assert.equal(slugify("Sunken Crypt #4821!"), "sunken-crypt-4821");
  assert.equal(slugify("--Château--"), "ch-teau");
  assert.equal(slugify("!!!"), "dungeon");
});

test("escapeHtml escapes every special character", () => {
  assert.equal(
    escapeHtml(`<a href="x">Tom & Jerry's</a>`),
    "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
  );
});

test("the html template skips empty values and renders SafeHtml as itself", () => {
  assert.equal(html`<p>${null}${undefined}${false}${0}</p>`.value, "<p>0</p>");
  const safe = html`<b>x</b>`;
  assert.equal(String(safe), "<b>x</b>");
  assert.ok(safe instanceof SafeHtml);
});

test("bytesToBase64 matches Node, including for large inputs", () => {
  const big = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) % 256);
  assert.equal(bytesToBase64(big), Buffer.from(big).toString("base64"));
  assert.equal(bytesToBase64(new Uint8Array()), "");
});

test("megabytes shows one decimal place", () => {
  assert.equal(megabytes(1048576 * 2.25), "2.3 MB");
});
