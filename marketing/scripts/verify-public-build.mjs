import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
const expected = process.env.NEXT_PUBLIC_EXPLORER_URL?.trim();
if (!expected) throw new Error("Set NEXT_PUBLIC_EXPLORER_URL to the public Explorer URL before verification");
const url = new URL(expected);
if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  throw new Error("NEXT_PUBLIC_EXPLORER_URL must be a public HTTPS URL");
}
if (!html.includes(`href="${url.toString().replace(/\/$/, "")}"`)) {
  throw new Error("The exported marketing page does not link to the expected Explorer URL");
}
if (/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(html)) {
  throw new Error("The exported marketing page still contains a loopback URL");
}
