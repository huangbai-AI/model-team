import { spawn } from "node:child_process";
import fs from "node:fs";
import { ROOT, DATA } from "./core.mjs";
const url = "http://127.0.0.1:" + (process.env.PORT || 4317);
async function ready() {
  try {
    const r = await fetch(url + "/api/state", {
      signal: AbortSignal.timeout(600),
    });
    const d = await r.json();
    return !!d.config?.rules && !!d.integration;
  } catch {
    return false;
  }
}
if (!(await ready())) {
  const log = fs.openSync(DATA + "/server.log", "a", 0o600);
  const child = spawn(process.execPath, [ROOT + "/server.mjs"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  fs.closeSync(log);
  let ok = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await ready()) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    console.error(
      "启动失败，请查看 .data/server.log 或检查 4317 端口是否被占用。",
    );
    process.exit(1);
  }
}
console.log("合流已启动：" + url);
const opener =
  process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "explorer.exe"
      : "xdg-open";
const open = spawn(opener, [url], { stdio: "ignore" });
open.on("error", () => console.log("请手动打开上方地址。"));
open.unref();
