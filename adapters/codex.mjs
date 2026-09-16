import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export async function callCodex(m, messages, signal, { dataDir, apiKey }) {
  const dir = fs.mkdtempSync(path.join(dataDir, "worker-"));
  fs.chmodSync(dir, 0o700);
  const output = path.join(dir, "result.txt");
  const args = [
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--json",
    "-C",
    dir,
    "-m",
    m.model,
    "-c",
    'approval_policy="never"',
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    'model_reasoning_effort="low"',
    "-c",
    'developer_instructions="你是总指挥委派的单次助手。只处理给定上下文，输出简洁结论或必要代码。不要调用工具、读取文件或再次分工。不要声称修改文件或执行测试。"',
    "-o",
    output,
  ];
  const env = { ...process.env, MODEL_TEAM_WORKER: "1" };
  if (m.kind === "codex-provider") {
    const home = path.join(dir, "home");
    fs.mkdirSync(home, { mode: 0o700 });
    env.CODEX_HOME = home;
    env.MODEL_TEAM_VENDOR_KEY = apiKey;
    args.push(
      "-c",
      'model_provider="team_provider"',
      "-c",
      'model_providers.team_provider.name="team_provider"',
      "-c",
      `model_providers.team_provider.base_url=${JSON.stringify(m.baseUrl)}`,
      "-c",
      'model_providers.team_provider.env_key="MODEL_TEAM_VENDOR_KEY"',
      "-c",
      'model_providers.team_provider.wire_api="responses"',
      "-c",
      "model_providers.team_provider.request_max_retries=0",
      "-c",
      "model_providers.team_provider.stream_max_retries=0",
    );
  }
  args.push("-");
  let usage = null,
    errorCode = null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.MODEL_TEAM_CODEX_BIN || "codex", args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let pending = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Error("Codex 子模型调用超时"));
      }, 180000);
      const abort = () => {
        child.kill("SIGTERM");
        reject(Error("已取消"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      child.stdin.on("error", () => {});
      child.stdout.on("data", (chunk) => {
        pending += chunk.toString();
        const lines = pending.split("\n");
        pending = lines.pop().slice(-50000);
        for (const line of lines) {
          try {
            const e = JSON.parse(line);
            if (e.type === "turn.completed") usage = e.usage;
            if (e.type === "error" || e.type === "turn.failed") {
              const text = JSON.stringify(e);
              errorCode =
                text.match(/\b(401|403|404|429|500|503)\b/)?.[1] ||
                "worker_error";
            }
          } catch {}
        }
      });
      child.stderr.on("data", () => {});
      child.once("error", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(Error("无法启动本机 Codex"));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (code === 0) resolve();
        else
          reject(
            Error(
              `Codex 子模型调用失败${errorCode ? "（" + errorCode + "）" : ""}，请检查登录、额度或模型权限`,
            ),
          );
      });
      child.stdin.end(messages.map((x) => x.content).join("\n\n"));
    });
    const text = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
    if (!text.trim()) throw Error("Codex 子模型未返回结果");
    return {
      text,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      cost: null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
