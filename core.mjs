import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { callCodex } from "./adapters/codex.mjs";
import { callHttp } from "./adapters/http.mjs";
import { protocolAdapters } from "./adapters/protocols.mjs";
import { fileURLToPath } from "node:url";
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.MODEL_TEAM_DATA || path.join(ROOT, ".data");
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const keyFile = path.join(DATA, "vault.key");
try {
  fs.writeFileSync(keyFile, crypto.randomBytes(32), {
    flag: "wx",
    mode: 0o600,
  });
} catch (e) {
  if (e.code !== "EEXIST") throw e;
}
const vaultKey = fs.readFileSync(keyFile);
const defaults = {
  enabled: true,
  strategy: "balanced",
  maxTokens: 2048,
  maxParallel: 3,
  contextChars: 16000,
  policy:
    "由总指挥按任务难度、上下文和成本自行决定是否委派；简单任务可自己完成。",
};
function write(file, obj) {
  const p = path.join(DATA, file),
    t = p + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(t, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(t, p);
}
function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export function config() {
  const c = read("config.json", { models: [], rules: defaults });
  const { assignments, simpleDirect, ...r } = c.rules || {};
  return {
    ...c,
    version: 2,
    rules: { ...defaults, ...r },
    models: c.models.map((m) => ({
      ...m,
      kind: m.kind || "api",
      hint: m.hint || "",
    })),
  };
}
function seal(s) {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv("aes-256-gcm", vaultKey, iv),
    data = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return {
    iv: iv.toString("base64"),
    data: data.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
  };
}
function unseal(s) {
  if (!s) return "";
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    vaultKey,
    Buffer.from(s.iv, "base64"),
  );
  d.setAuthTag(Buffer.from(s.tag, "base64"));
  return Buffer.concat([
    d.update(Buffer.from(s.data, "base64")),
    d.final(),
  ]).toString("utf8");
}
const clean = (s, n = 200) =>
  String(s ?? "")
    .trim()
    .slice(0, n);
export function commander() {
  try {
    const t = fs.readFileSync(
      path.join(
        process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
        "config.toml",
      ),
      "utf8",
    );
    return t.match(/^model\s*=\s*"([^"]+)"/m)?.[1] || "当前 Codex 主模型";
  } catch {
    return "当前 Codex 主模型";
  }
}
export function publicConfig() {
  const c = config();
  return {
    ...c,
    commander: commander(),
    protocols: [...protocolAdapters].map(([id, a]) => ({ id, label: a.label })),
    models: c.models.map(({ secret, ...m }) => ({ ...m, hasKey: !!secret })),
  };
}
export function saveModel(input) {
  const c = config(),
    old = c.models.find((m) => m.id === input.id),
    kind = ["api", "codex", "codex-provider"].includes(input.kind)
      ? input.kind
      : old?.kind || "api";
  let baseUrl = "";
  if (kind !== "codex") {
    const u = new URL(input.baseUrl);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw Error("请填写有效接口地址");
    if (
      u.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
      throw Error("远程接口必须使用 HTTPS");
    baseUrl = u.toString().replace(/\/$/, "");
  }
  const name = clean(input.name, 80),
    model = clean(input.model, 120);
  if (!name || !model) throw Error("请填写名称和模型 ID");
  const price = (v) => (v === "" || v == null ? null : Number(v));
  const m = {
    id: old?.id || crypto.randomUUID(),
    kind,
    name,
    model,
    baseUrl,
    protocol: input.protocol || old?.protocol || "openai",
    tier: ["low", "standard", "strong"].includes(input.tier)
      ? input.tier
      : "standard",
    hint: clean(input.hint, 240),
    inputPrice: price(input.inputPrice),
    outputPrice: price(input.outputPrice),
    enabled: input.enabled !== false,
    secret: input.apiKey ? seal(clean(input.apiKey, 4096)) : old?.secret,
  };
  if (!protocolAdapters.has(m.protocol)) throw Error("未注册的模型协议");
  for (const v of [m.inputPrice, m.outputPrice])
    if (v !== null && (!Number.isFinite(v) || v < 0))
      throw Error("价格应为非负数字");
  if (
    old &&
    old.model === m.model &&
    old.baseUrl === m.baseUrl &&
    old.kind === m.kind &&
    !input.apiKey
  )
    m.lastTest = old.lastTest;
  c.models = old
    ? c.models.map((x) => (x.id === m.id ? m : x))
    : [...c.models, m];
  write("config.json", c);
  return publicConfig();
}
export function deleteModel(id) {
  const c = config();
  c.models = c.models.filter((m) => m.id !== id);
  write("config.json", c);
}
export function saveRules(r) {
  const c = config();
  const next = { ...c.rules, ...r };
  if (!["economy", "balanced", "quality"].includes(next.strategy))
    throw Error("未知偏好");
  for (const [field, min, max] of [
    ["maxTokens", 128, 16384],
    ["maxParallel", 1, 6],
    ["contextChars", 1000, 80000],
  ]) {
    next[field] = Number(next[field]);
    if (
      !Number.isInteger(next[field]) ||
      next[field] < min ||
      next[field] > max
    )
      throw Error(`${field} 超出允许范围`);
  }
  c.rules = {
    enabled: next.enabled !== false,
    strategy: next.strategy,
    maxTokens: next.maxTokens,
    maxParallel: next.maxParallel,
    contextChars: next.contextChars,
    policy: clean(next.policy, 600),
  };
  write("config.json", c);
  return publicConfig();
}
export const strategyGuidance = {
  balanced:
    "均衡：兼顾效果、实际费用、等待和返工；选择足够可靠的模型，必要时升级。",
  quality:
    "极致：优先最佳效果和可靠性，可接受更高费用与耗时；复杂任务优先更有把握的模型，必要时独立复核，不无意义重复调用。",
  economy:
    "轻量：优先减少费用、等待和上下文；易验证任务考虑轻量模型，复杂或高风险任务及时升级，保持相同验收标准。",
};
export function catalog() {
  const c = config();
  return {
    enabled: c.rules.enabled,
    preference: c.rules.strategy,
    guidance: strategyGuidance[c.rules.strategy],
    policy: c.rules.policy,
    parallel: c.rules.maxParallel,
    contextLimit: c.rules.contextChars,
    models: c.models
      .filter((m) => m.enabled)
      .map((m) => ({
        id: m.id,
        name: m.name,
        model: m.model,
        hint: m.hint,
        ...(m.lastTest?.ok === false ? { connection: m.lastTest.error } : {}),
        ...(m.inputPrice != null
          ? { inputPrice: m.inputPrice, outputPrice: m.outputPrice }
          : {}),
      })),
  };
}
export async function listRemoteModels(id) {
  const m = config().models.find((m) => m.id === id);
  if (!m || m.kind !== "api") throw Error("仅 API 模型可查询");
  const res = await fetch(m.baseUrl + "/models", {
    headers: { Authorization: "Bearer " + unseal(m.secret) },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!res.ok) {
    await res.body?.cancel();
    return { status: res.status, models: [] };
  }
  const data = await res.json();
  return {
    status: 200,
    models: (data.data || data.models || []).map((x) => x.id),
  };
}
export async function callModel(m, messages, maxTokens = 2048, signal) {
  const options = { dataDir: DATA, apiKey: unseal(m.secret) };
  if (m.kind === "codex" || m.kind === "codex-provider")
    return callCodex(
      m,
      [
        ...messages,
        { role: "user", content: `请将输出控制在约 ${maxTokens} 词元内。` },
      ],
      signal,
      options,
    );
  return callHttp(m, messages, maxTokens, signal, options);
}
export async function testModel(id) {
  const m = config().models.find((x) => x.id === id);
  if (!m) throw Error("模型不存在");
  const start = Date.now();
  let result;
  try {
    await callModel(
      m,
      [
        {
          role: "user",
          content: "这是编程助手连接检查：仅回复 OK，不调用工具。",
        },
      ],
      256,
    );
    result = { ok: true, latency: Date.now() - start };
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  const c = config();
  const current = c.models.find((x) => x.id === id);
  if (current) {
    current.lastTest = { ...result, checkedAt: new Date().toISOString() };
    write("config.json", c);
  }
  return result;
}
export function getPlan(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("无效记录");
  const p = read("plan-" + id + ".json", null);
  if (!p) throw Error("记录不存在");
  return p;
}
export function history() {
  return fs
    .readdirSync(DATA)
    .filter((f) => /^plan-[a-f0-9-]+\.json$/.test(f))
    .map((f) => read(f, null))
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);
}
const inflight = new Map();
export async function delegate({
  modelId,
  task,
  context = "",
  reason = "",
  announced,
  requestId,
}) {
  if (announced !== true) throw Error("请先向用户简述任务与模型");
  const c = config();
  if (!c.rules.enabled) throw Error("自动委派已关闭，由总指挥自行完成");
  const m = c.models.find((x) => x.id === modelId && x.enabled);
  if (!m) throw Error("模型不存在或已停用，请重新读取可用模型");
  if (!clean(task, 20000)) throw Error("委派任务不能为空");
  if (context.length > c.rules.contextChars)
    throw Error(
      `上下文超过 ${c.rules.contextChars} 字符，请提供必要片段或摘要`,
    );
  if (requestId) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw Error("无效请求标识");
    const prior = read("request-" + requestId + ".json", null);
    if (prior) {
      const p = getPlan(prior.id);
      if (
        p.task !== task ||
        p.steps[0].modelId !== modelId ||
        prior.contextHash !==
          crypto.createHash("sha256").update(context).digest("hex")
      )
        throw Error("请求标识已用于不同委派");
      return {
        id: p.id,
        status: p.status,
        ...(p.steps[0].result ? { result: p.steps[0].result } : {}),
        ...(p.steps[0].error ? { error: p.steps[0].error } : {}),
        cached: true,
      };
    }
  }
  if (inflight.size >= c.rules.maxParallel)
    throw Error("已达并行上限，请等待当前调用完成");
  const id = crypto.randomUUID(),
    step = {
      id: "1",
      title: clean(task, 20000),
      modelId: m.id,
      modelName: m.name,
      model: m.model,
      reason: clean(reason, 240),
      status: "running",
    },
    plan = {
      id,
      task: step.title,
      source: "codex",
      createdAt: new Date().toISOString(),
      mode: "dynamic",
      status: "running",
      steps: [step],
    };
  write("plan-" + id + ".json", plan);
  if (requestId)
    write("request-" + requestId + ".json", {
      id,
      contextHash: crypto.createHash("sha256").update(context).digest("hex"),
    });
  const controller = new AbortController();
  inflight.set(id, controller);
  try {
    const result = await callModel(
      m,
      [
        {
          role: "system",
          content:
            "你是 GPT 总指挥按需委派的助手。仅完成本次独立任务，简短给出结论、必要代码和待验证项。没有工具权限，不声称已修改文件或运行测试；不要再次分工。",
        },
        {
          role: "user",
          content: `任务：${task}\n${context ? "必要上下文：\n" + context : ""}`,
        },
      ],
      c.rules.maxTokens,
      controller.signal,
    );
    step.status = "done";
    step.result = result.text;
    step.usage = {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost: result.cost,
    };
    plan.status = "done";
  } catch (e) {
    step.status = "failed";
    step.error = e.message;
    plan.status = "failed";
  } finally {
    step.finishedAt = new Date().toISOString();
    inflight.delete(id);
    write("plan-" + id + ".json", plan);
  }
  return {
    id,
    status: plan.status,
    ...(step.result ? { result: step.result } : { error: step.error }),
  };
}
