import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ROOT,
  DATA,
  publicConfig,
  saveModel,
  deleteModel,
  saveRules,
  getPlan,
  history,
  testModel,
} from "./core.mjs";
const exec = promisify(execFile),
  port = Number(process.env.PORT || 4317),
  token = crypto.randomBytes(32).toString("hex");
const codexHome =
  process.env.MODEL_TEAM_CODEX_HOME ||
  process.env.CODEX_HOME ||
  path.join(os.homedir(), ".codex");
const entry = path.join(ROOT, "mcp.mjs");
const skillDir = path.join(codexHome, "skills", "model-team");
const skill = `---
name: model-team
description: 使用分工台的长期模型配置协作开发。
---
当前 GPT 是总指挥，自行决定是否、何时委派，可自己完成，无固定步骤。需要协作时读取 model_team_catalog，先简述「任务 → 模型」，再调用 model_team_delegate（announced=true）；独立任务可并行。只传必要上下文，自己应用并验证结果；失败后自行决定后续并说明。MODEL_TEAM_WORKER=1 时禁止再次委派。用户要求优先。
`;
const globalRules =
  "\n<!-- model-team:start -->\n开发由当前 GPT 自主判断是否委派，无固定步骤；需要时读取 model_team_catalog，先简述「任务 → 模型」再调用 model_team_delegate。只传必要上下文，自己验证结果。MODEL_TEAM_WORKER=1 时不再委派。用户要求优先。\n<!-- model-team:end -->\n";
function integration() {
  let text = "";
  try {
    text = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  } catch {}
  return {
    installed:
      text.includes("[mcp_servers.model-team]") &&
      fs.existsSync(path.join(skillDir, "SKILL.md")),
    command: process.execPath,
    args: [entry],
    skillInstalled: fs.existsSync(path.join(skillDir, "SKILL.md")),
  };
}
async function install() {
  fs.mkdirSync(codexHome, { recursive: true });
  const p = path.join(codexHome, "config.toml");
  if (fs.existsSync(p))
    fs.copyFileSync(p, p + ".model-team-backup-" + Date.now());
  const env = { ...process.env, CODEX_HOME: codexHome };
  await exec(
    process.env.MODEL_TEAM_CODEX_BIN || "codex",
    [
      "mcp",
      "add",
      "model-team",
      "--env",
      "MODEL_TEAM_DATA=" + DATA,
      "--",
      process.execPath,
      entry,
    ],
    { env, timeout: 20000 },
  );
  let cfg = fs.readFileSync(p, "utf8");
  cfg = cfg.replace(
    /(\[mcp_servers\.model-team\]\n)([\s\S]*?)(?=\n\[|$)/,
    (_, h, b) =>
      h +
      "tool_timeout_sec = 240\n" +
      b.replace(/^tool_timeout_sec\s*=.*\n?/gm, ""),
  );
  fs.writeFileSync(p, cfg);
  fs.mkdirSync(skillDir, { recursive: true });
  const target = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(target))
    fs.copyFileSync(target, target + ".backup-" + Date.now());
  fs.writeFileSync(target, skill);
  const ap = path.join(codexHome, "AGENTS.md");
  const prior = fs.existsSync(ap) ? fs.readFileSync(ap, "utf8") : "";
  if (prior) fs.copyFileSync(ap, ap + ".model-team-backup-" + Date.now());
  fs.writeFileSync(
    ap,
    prior.replace(
      /\n?<!-- model-team:start -->[\s\S]*?<!-- model-team:end -->\n?/g,
      "",
    ) + globalRules,
  );
  return {
    ...integration(),
    message:
      "已写入 Codex 配置和分工技能。请重启 Codex 或开启能加载新工具的新会话；只有工具实际可用后才会开始分工。",
  };
}
function json(res, obj, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(obj));
}
async function body(req) {
  let b = "";
  for await (const chunk of req) {
    b += chunk;
    if (b.length > 150000) throw Error("内容过长");
  }
  return b ? JSON.parse(b) : {};
}
const server = http.createServer(async (req, res) => {
  const host = req.headers.host;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host))
    return json(res, { error: "仅允许本机访问" }, 403);
  if (
    req.headers.origin &&
    !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(
      req.headers.origin,
    )
  )
    return json(res, { error: "不允许跨站访问" }, 403);
  const url = new URL(req.url, "http://" + host);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "GET") {
        if (url.pathname === "/api/state")
          return json(res, {
            config: publicConfig(),
            history: history().map(({ steps, ...p }) => ({
              ...p,
              steps: steps.map(({ result, ...s }) => s),
            })),
            integration: integration(),
            token,
          });
        if (url.pathname.startsWith("/api/plans/"))
          return json(res, getPlan(url.pathname.split("/").at(-1)));
        return json(res, { error: "接口不存在" }, 404);
      }
      if (req.headers["x-local-token"] !== token)
        return json(res, { error: "会话已更新，请刷新网页" }, 403);
      const b = await body(req);
      if (req.method === "POST" && url.pathname === "/api/models")
        return json(res, saveModel(b));
      if (req.method === "DELETE" && url.pathname.startsWith("/api/models/")) {
        deleteModel(url.pathname.split("/").at(-1));
        return json(res, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/rules")
        return json(res, saveRules(b));
      if (req.method === "POST" && url.pathname === "/api/test")
        return json(res, await testModel(b.id));
      if (req.method === "POST" && url.pathname === "/api/install")
        return json(res, await install());
      return json(res, { error: "接口不存在" }, 404);
    }
    if (req.method !== "GET") return json(res, { error: "不支持此操作" }, 405);
    const file = {
      "/": "index.html",
      "/app.js": "app.js",
      "/style.css": "style.css",
      "/logo.png": "logo.png",
    }[url.pathname];
    if (!file) return json(res, { error: "页面不存在" }, 404);
    res.writeHead(200, {
      "Content-Type": file.endsWith(".png")
        ? "image/png"
        : file.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : file.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    res.end(fs.readFileSync(path.join(ROOT, "public", file)));
  } catch (e) {
    const msg = e.message?.includes("Command failed")
      ? "Codex 接入失败，请确认本机已安装 codex 命令。现有配置已备份。"
      : e.message;
    json(res, { error: msg || "操作失败" }, 400);
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`分工台已启动：http://127.0.0.1:${port}`),
);
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? "端口已占用，请访问现有页面或设置 PORT 使用其他端口"
      : e.message,
  );
  process.exit(1);
});
