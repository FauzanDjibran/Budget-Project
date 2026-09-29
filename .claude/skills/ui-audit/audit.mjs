// Screenshot pairs of SIBA screens and state how their structure differs.
//
//   node audit.mjs <out-dir> <changed-path> <reference-path> [<changed> <reference> ...]
//
// Signs in with SIBA_ADMIN_EMAIL / SIBA_ADMIN_PASSWORD (the seed's development
// defaults otherwise) against SIBA_URL (http://localhost:3010), saves one PNG
// per screen at 1600×1000, and prints, for each pair, the landmarks the
// convention fixes (CLAUDE.md §8) side by side — so a screen that differs from
// its reference says so in text as well as in the pictures.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [out, ...paths] = process.argv.slice(2);
if (!out || paths.length < 2 || paths.length % 2) {
  console.error("usage: node audit.mjs <out-dir> <changed> <reference> [...]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const base = process.env.SIBA_URL ?? "http://localhost:3010";
const browser = await chromium
  .launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto(`${base}/login`);
await page.fill("input[type=email]", process.env.SIBA_ADMIN_EMAIL ?? "admin@siba.app");
await page.fill("input[type=password]", process.env.SIBA_ADMIN_PASSWORD ?? "siba123");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"));

/** What the convention fixes about a screen, read off the rendered page. */
async function landmarks(path) {
  await page.goto(base + path);
  await page.waitForTimeout(900);
  const file = join(out, path.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") + ".png");
  await page.screenshot({ path: file, fullPage: true });
  const facts = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const text = (e) => e.textContent.replace(/\s+/g, " ").trim();
    const crumb = q(".pad > .ph .crumb > *").filter((e) => text(e) !== "/");
    const amounts = q("table.grid td.num").filter((td) => /Rp|[A-Z]{3}\s/.test(td.textContent));
    return {
      "crumb (link?)": crumb.map((e) => `${text(e)}${e.tagName === "A" ? "↗" : ""}`).join(" / "),
      heading: text(document.querySelector(".pad > .ph h1") ?? document.body).slice(0, 60),
      "docno font": (() => {
        const d = document.querySelector(".pad > .ph .docno");
        return d ? getComputedStyle(d).fontFamily.split(",")[0] : "—";
      })(),
      "ph-sub": Boolean(document.querySelector(".pad > .ph .ph-sub")),
      "header actions": q(".pad > .ph .ph-act > *").map(text).join(" · "),
      "card headings": q(".card-h .ct h3").map(text).join(" · "),
      "table columns": q("table.grid thead th").map(text).filter(Boolean).join(" · "),
      "amount cells not mono": amounts.filter((td) => !td.querySelector(".mny, .drl")).length,
      "row actions (.ract)": q(".ract").length,
      pager: Boolean(document.querySelector(".pager")),
      "toolbar filters": q(".toolbar .tsel").map(text).join(" · "),
      "fnote in card": q(".card .fnote").length,
      "foot-note below card": q(".pad > .foot-note, .foot-note").length,
      riwayat: q(".card-h .ct h3").some((h) => text(h) === "Riwayat"),
    };
  });
  return { file, facts };
}

for (let i = 0; i < paths.length; i += 2) {
  const [a, b] = [await landmarks(paths[i]), await landmarks(paths[i + 1])];
  console.log(`\n=== ${paths[i]}  vs  ${paths[i + 1]}`);
  console.log(`    ${a.file}\n    ${b.file}`);
  for (const key of Object.keys(a.facts)) {
    const same = JSON.stringify(a.facts[key]) === JSON.stringify(b.facts[key]);
    console.log(`${same ? "  " : "≠ "}${key.padEnd(24)} ${JSON.stringify(a.facts[key])}${same ? "" : `  |  ${JSON.stringify(b.facts[key])}`}`);
  }
}
await browser.close();
