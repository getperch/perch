/* eslint-disable @typescript-eslint/no-require-imports */
// Generic local Playwright runner. Bundled into the desktop app as a self-contained binary
// (apps/desktop/src-tauri, https://v2.tauri.app/learn/sidecar-nodejs/). Reads one JSON task on
// argv[2] and emits newline-delimited JSON events on stdout:
//   {"t":"step","kind":"...","detail":"..."}
//   {"t":"need_human","detail":"..."}          // replay pauses; continues when the step's wait clears
//   {"t":"extract","key":"...","value":"..."}
//   {"t":"browsers","system":[...],"bundled":bool}   // probe
//   {"t":"recording","steps":[...]}            // record
//   {"t":"result", ...}                        // replay: { extracted: {...} }
//   {"t":"error","detail":"..."} / {"t":"done"}
//
// Nothing app-specific lives here — connector setup and routines are just ProcedureStep lists
// (see @perch/core) passed in as a `replay` task.

// `@yao-pkg/pkg`'s Node base is compiled without the inspector module, but playwright-core does an
// unconditional top-level `require("inspector")` (used only for optional JS-debugger detection).
// Stub it before playwright-core loads. Must be a `require` (not `import`, which esbuild hoists).
{
  const Mod = require("node:module") as typeof import("node:module");
  const load = (Mod as unknown as { _load: (...a: unknown[]) => unknown })._load;
  const stub = {
    Session: class {
      connect() {}
      disconnect() {}
      post() {}
      on() {}
      once() {}
      removeListener() {}
    },
    open() {},
    close() {},
    url() {},
    waitForDebugger() {},
    console: globalThis.console,
  };
  (Mod as unknown as { _load: unknown })._load = function (this: unknown, request: string, ...rest: unknown[]) {
    if (request === "inspector" || request === "node:inspector" || request === "node:inspector/promises") return stub;
    return load.call(this, request, ...rest);
  };
}

const { chromium } = require("playwright-core") as typeof import("playwright-core");
type BrowserContext = import("playwright-core").BrowserContext;
type Page = import("playwright-core").Page;
type Locator = import("playwright-core").Locator;

import type { ProcedureStep } from "@perch/core";

function emit(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
const step = (kind: string, detail: string) => emit({ t: "step", kind, detail });

// ── stdin control channel ────────────────────────────────────────────────────
// The Rust side writes `resume` / `stop` lines (procedure_resume / procedure_record_stop).
let stopped = false;
const resumeWaiters: (() => void)[] = [];
process.stdin.setEncoding("utf8");
let _stdinBuf = "";
process.stdin.on("data", (d: string) => {
  _stdinBuf += d;
  let nl: number;
  while ((nl = _stdinBuf.indexOf("\n")) >= 0) {
    const line = _stdinBuf.slice(0, nl).trim();
    _stdinBuf = _stdinBuf.slice(nl + 1);
    if (line === "stop") stopped = true;
    if (line === "resume" || line === "stop") resumeWaiters.splice(0).forEach((f) => f());
  }
});

/** Pause the routine and ask the operator to act. Resolves when they click Continue in Perch
 * (a `resume` line), or, if `until` is given, when that condition first holds. */
async function needHuman(detail: string, until?: () => Promise<boolean>): Promise<void> {
  emit({ t: "need_human", detail });
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    resumeWaiters.push(finish);
    if (until) {
      const poll = async () => {
        while (!done) {
          try {
            if (await until()) return finish();
          } catch {
            /* keep polling */
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      };
      void poll();
    }
  });
  step("note", "resumed");
}

// Channels Playwright can drive with nothing downloaded, best first. `PERCH_BROWSER_CHANNEL` (set
// by the Rust side from the last successful probe) is tried ahead of the list.
const CHANNELS = ["chrome", "msedge", "chrome-beta", "msedge-beta", "chromium"];

async function detectBrowsers(): Promise<{ system: string[]; bundled: boolean }> {
  const system: string[] = [];
  for (const channel of CHANNELS) {
    try {
      const b = await chromium.launch({ channel, headless: true });
      await b.close();
      system.push(channel);
    } catch {
      /* not installed */
    }
  }
  let bundled = false;
  try {
    bundled = require("node:fs").existsSync(chromium.executablePath());
  } catch {
    /* no bundled chromium */
  }
  return { system, bundled };
}

// Launch as a *persistent context* (a real, reused profile dir) with the automation tells removed:
//  - `ignoreDefaultArgs: ["--enable-automation"]` drops Chrome's automation banner + the flag
//    Google keys off.
//  - `--disable-blink-features=AutomationControlled` makes `navigator.webdriver` return false.
//  - a persisted profile means the user signs into Google once; after that there's a real session
//    with cookies/history, which is what gets past "this browser may not be secure".
const LAUNCH_ARGS = ["--start-maximized", "--disable-blink-features=AutomationControlled"];
const IGNORE_ARGS = ["--enable-automation"];
// Extra belt-and-suspenders: nuke the residual `navigator.webdriver` getter in every page.
const HIDE_WEBDRIVER = "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});";

async function launchContext(): Promise<{ ctx: BrowserContext; page: Page }> {
  const userDataDir = process.env.PERCH_PROFILE_DIR || require("node:path").join(require("node:os").tmpdir(), "perch-browser-profile");
  const preferred = process.env.PERCH_BROWSER_CHANNEL;
  const order = preferred ? [preferred, ...CHANNELS.filter((c) => c !== preferred)] : CHANNELS;
  const opts = { headless: false, viewport: null, args: LAUNCH_ARGS, ignoreDefaultArgs: IGNORE_ARGS } as const;

  const tryOpen = async (channel?: string) => {
    const ctx = await chromium.launchPersistentContext(userDataDir, channel ? { ...opts, channel } : opts);
    await ctx.addInitScript(HIDE_WEBDRIVER);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    step("note", `launched ${channel ?? "bundled Chromium"}`);
    return { ctx, page };
  };

  for (const channel of order) {
    try {
      return await tryOpen(channel);
    } catch {
      /* try next */
    }
  }
  try {
    return await tryOpen();
  } catch {
    throw new Error("No usable browser found — install Google Chrome or Microsoft Edge.");
  }
}

async function firstMatch(page: Page, selectors: string[], timeoutMs = 8000): Promise<Locator | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0) return loc;
      } catch {
        /* bad selector — skip */
      }
    }
    if (Date.now() > deadline) return undefined;
    await page.waitForTimeout(250);
  }
}


async function replay(page: Page, task: { startUrl?: string; steps: ProcedureStep[]; secrets?: Record<string, string> }): Promise<void> {
  const secrets = task.secrets ?? {};
  const extracted: Record<string, string> = {};
  if (task.startUrl) {
    await page.goto(task.startUrl, { waitUntil: "domcontentloaded" });
    step("navigate", task.startUrl);
  }

  // An element step whose selectors miss doesn't abort the routine — it asks the operator to do
  // that step in the real browser and click Continue, then moves on. Console UI drifts constantly
  // and half these flows need a human touch anyway; a hard failure mid-sign-in is the worst option.
  const findOrAsk = async (s: ProcedureStep, label: string, timeoutMs = 10000): Promise<Locator | undefined> => {
    const el = await firstMatch(page, s.selectors, timeoutMs);
    if (el) return el;
    if (s.optional) {
      step("note", `skipped "${label}" (not found)`);
      return undefined;
    }
    await needHuman(`I couldn't find "${label}" on the page — please do this step in the browser, then click Continue.`);
    return undefined;
  };

  for (const s of task.steps) {
    if (stopped) break;
    const label = s.label || `${s.kind} ${s.id}`;
    switch (s.kind) {
      case "goto": {
        if (!s.url) throw new Error(`step ${s.id}: goto has no url`);
        await page.goto(s.url, { waitUntil: "domcontentloaded" }).catch(() => {});
        step("navigate", s.url);
        break;
      }
      case "waitFor": {
        await findOrAsk(s, label, 20000);
        step("wait", label);
        break;
      }
      case "click": {
        const el = await findOrAsk(s, label);
        if (el) {
          await el.click().catch(async () => {
            await needHuman(`I couldn't click "${label}" — please click it in the browser, then Continue.`);
          });
          await page.waitForTimeout(500);
          step("click", label);
        }
        break;
      }
      case "fill": {
        const el = await findOrAsk(s, label);
        if (el) {
          const value = s.valueRef ? (secrets[s.valueRef.slice("secret:".length)] ?? "") : (s.value ?? "");
          await el.fill(value);
          step("type", `${label} = ${s.valueRef ? "•••" : value.slice(0, 40)}`);
        }
        break;
      }
      case "select": {
        const el = await findOrAsk(s, label);
        if (el) {
          await el.selectOption(s.value ?? "");
          step("select", label);
        }
        break;
      }
      case "extract": {
        let text = "";
        if (s.pattern) {
          const body = await page.locator("body").innerText().catch(() => "");
          const m = body.match(new RegExp(s.pattern));
          text = (m?.[1] ?? m?.[0] ?? "").trim();
        } else {
          const el = await firstMatch(page, s.selectors);
          text = el ? (await el.innerText()).trim() : "";
        }
        if (!text && !s.optional) {
          await needHuman(`I couldn't read "${s.extractKey || label}" from the page — copy it from the browser, then Continue (or fill it in manually afterwards).`);
        }
        if (text) {
          const key = s.extractKey || s.id;
          extracted[key] = text.slice(0, 4000);
          emit({ t: "extract", key, value: extracted[key] });
        }
        break;
      }
      case "assert": {
        const el = await firstMatch(page, s.selectors);
        const text = el ? await el.innerText() : "";
        if (s.value && !text.includes(s.value)) {
          await needHuman(`Expected "${s.value}" on the page but didn't see it — sort it out in the browser, then Continue.`);
        } else {
          step("note", `assert ok — ${label}`);
        }
        break;
      }
      case "humanCheckpoint": {
        // Always waits for an explicit Continue from the Perch UI — a URL/selector guess races the
        // redirects during a multi-page Google sign-in. The condition, if any, is just a shortcut.
        await needHuman(
          s.label || "Do the next step in the browser, then click Continue.",
          s.selectors.length ? async () => Boolean(await firstMatch(page, s.selectors, 1000)) : undefined,
        );
        break;
      }
      default:
        throw new Error(`step ${s.id}: unknown kind "${(s as { kind: string }).kind}"`);
    }
  }

  emit({ t: "result", extracted });
}

// Compact browser-side recorder: capture-phase click/change + SPA/full navigations, each with a
// ranked selector list. Self-contained (serialised into the page).
function recorderMain(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__perchRec) return;
  w.__perchRec = true;
  const send = (a: Record<string, unknown>) => {
    const fn = w.__perchCapture as ((s: string) => void) | undefined;
    if (fn) try { fn(JSON.stringify({ ...a, pageUrl: location.href })); } catch { /* not ready */ }
  };
  const sels = (el: Element): string[] => {
    const out: string[] = [];
    const t = el as HTMLElement;
    const tid = t.getAttribute("data-testid") || t.getAttribute("data-test-id");
    if (tid) out.push(`[data-testid="${tid}"]`);
    if (t.id && !/^[0-9]/.test(t.id)) out.push(`#${CSS.escape(t.id)}`);
    const al = t.getAttribute("aria-label");
    if (al) out.push(`[aria-label="${al}"]`);
    const nm = t.getAttribute("name");
    if (nm) out.push(`${t.tagName.toLowerCase()}[name="${nm}"]`);
    const txt = (t.innerText || "").trim().slice(0, 40);
    if (txt && txt.length < 40) out.push(`${t.tagName.toLowerCase()}:has-text(${JSON.stringify(txt)})`);
    return out;
  };
  const label = (el: Element) =>
    ((el as HTMLElement).getAttribute("aria-label") || (el as HTMLInputElement).placeholder || (el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 80);
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target as Element | null;
      if (!el || !el.tagName) return;
      send({ kind: "click", selectors: sels(el), label: label(el) });
    },
    true,
  );
  document.addEventListener(
    "change",
    (e) => {
      const el = e.target as HTMLInputElement | null;
      if (!el) return;
      const secret = el.type === "password";
      send({ kind: "fill", selectors: sels(el), label: label(el), isSecret: secret, value: secret ? undefined : el.value });
    },
    true,
  );
}

async function record(page: Page, task: { startUrl: string }): Promise<void> {
  const steps: ProcedureStep[] = [];
  let n = 0;
  await page.exposeBinding("__perchCapture", (_src, json: string) => {
    try {
      const a = JSON.parse(json) as { kind: string; selectors: string[]; label?: string; value?: string; isSecret?: boolean };
      const s: ProcedureStep = {
        id: `s${++n}`,
        kind: a.kind === "fill" ? "fill" : "click",
        selectors: a.selectors ?? [],
        label: a.label,
        ...(a.kind === "fill" && !a.isSecret && a.value ? { value: a.value } : {}),
      };
      steps.push(s);
      emit({ t: "step", kind: s.kind, detail: s.label || s.selectors[0] || s.kind });
    } catch {
      /* ignore */
    }
  });
  await page.addInitScript(recorderMain);
  await page.goto(task.startUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(recorderMain).catch(() => {});
  step("navigate", task.startUrl);
  emit({ t: "need_human", detail: "Do the workflow in the browser window, then press Stop (or just close the window)." });

  // End on: window/context closed, or a `stop` line on stdin (see the module-level stdin handler).
  await new Promise<void>((resolve) => {
    if (stopped) return resolve();
    const done = () => resolve();
    page.on("close", done);
    page.context().on("close", done);
    resumeWaiters.push(done); // `stop` also wakes resumeWaiters
  });

  emit({ t: "recording", steps, startUrl: task.startUrl });
}

(async () => {
  let task: Record<string, unknown>;
  try {
    task = JSON.parse(process.argv[2] || "{}");
  } catch {
    emit({ t: "error", detail: "invalid task payload" });
    process.exit(2);
  }

  if (task.task === "probe") {
    try {
      emit({ t: "browsers", ...(await detectBrowsers()) });
      emit({ t: "done" });
      process.exit(0);
    } catch (err) {
      emit({ t: "error", detail: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  }

  let ctx: BrowserContext | undefined;
  try {
    const opened = await launchContext();
    ctx = opened.ctx;

    if (task.task === "replay") {
      await replay(opened.page, task as never);
    } else if (task.task === "record") {
      await record(opened.page, task as never);
    } else {
      throw new Error(`unknown task "${String(task.task)}"`);
    }

    emit({ t: "done" });
    await ctx.close().catch(() => {});
    process.exit(0);
  } catch (err) {
    emit({ t: "error", detail: err instanceof Error ? err.message : String(err) });
    await ctx?.close().catch(() => {});
    process.exit(1);
  }
})();
