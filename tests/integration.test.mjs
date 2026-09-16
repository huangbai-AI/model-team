import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const base = fs.mkdtempSync(path.join(os.tmpdir(), "model-team-test-"));
process.env.MODEL_TEAM_DATA = path.join(base, "data");
const core = await import("../core.mjs");
let received = [],
  fail = false,
  delay = false;
const mock = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  received.push({ url: req.url, headers: req.headers, body: JSON.parse(raw) });
  if (delay) {
    setTimeout(() => {
      if (!res.destroyed) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ choices: [{ message: { content: "late" } }] }),
        );
      }
    }, 600);
    return;
  }
  res.writeHead(fail ? 401 : 200, { "Content-Type": "application/json" });
  res.end(
    fail
      ? "secret leak must not be returned"
      : JSON.stringify(
          req.url.endsWith("/messages")
            ? {
                content: [{ type: "text", text: "测试建议，未改动文件。" }],
                usage: { input_tokens: 20, output_tokens: 10 },
              }
            : {
                choices: [{ message: { content: "测试建议，未改动文件。" } }],
                usage: { prompt_tokens: 20, completion_tokens: 10 },
              },
        ),
  );
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const endpoint = "http://127.0.0.1:" + mock.address().port + "/v1";
let ids = {};
test("keys encrypted, redacted, preserved on edit; provider validation", () => {
  for (const tier of ["low", "standard", "strong"]) {
    core.saveModel({
      name: "测试" + tier,
      model: "test-" + tier,
      baseUrl: endpoint,
      apiKey: "fake-secret-for-test",
      tier,
      inputPrice: 1,
      outputPrice: 2,
    });
  }
  const c = core.publicConfig();
  for (const m of c.models) ids[m.tier] = m.id;
  assert.equal(c.models.length, 3);
  assert(!JSON.stringify(c).includes("fake-secret"));
  assert(
    !fs
      .readFileSync(
        path.join(process.env.MODEL_TEAM_DATA, "config.json"),
        "utf8",
      )
      .includes("fake-secret"),
  );
  assert.equal(
    fs.statSync(path.join(process.env.MODEL_TEAM_DATA, "vault.key")).mode &
      0o777,
    0o600,
  );
  core.saveModel({ ...c.models[0], name: "轻量", apiKey: "" });
  assert.equal(core.publicConfig().models[0].hasKey, true);
  assert.throws(
    () =>
      core.saveModel({
        name: "x",
        model: "x",
        baseUrl: "http://example.com/v1",
      }),
    /HTTPS/,
  );
});
test("free delegation: any model, no stages, minimal context and idempotency", async () => {
  const args = {
    modelId: ids.low,
    task: "只检查一个边界条件",
    context: "给定片段",
    announced: true,
    requestId: "same-call",
  };
  const before = received.length;
  const r = await core.delegate(args);
  assert.equal(r.status, "done");
  assert.equal(core.getPlan(r.id).steps.length, 1);
  assert.equal(core.getPlan(r.id).steps[0].usage.cost, 0.00004);
  assert(!received.at(-1).body.messages[1].content.includes("前序结果"));
  const twice = await core.delegate(args);
  assert(twice.cached);
  assert.equal(received.length, before + 1);
  await assert.rejects(
    () => core.delegate({ ...args, task: "另一个任务" }),
    /不同委派/,
  );
  const other = await core.delegate({
    modelId: ids.strong,
    task: "任意独立分析",
    announced: true,
  });
  assert.equal(other.status, "done");
});
test("announcement, context, concurrency and global pause enforced", async () => {
  const args = { modelId: ids.low, task: "x", announced: true };
  await assert.rejects(
    () => core.delegate({ ...args, announced: false }),
    /先向用户/,
  );
  await assert.rejects(
    () => core.delegate({ ...args, context: "x".repeat(16001) }),
    /上下文/,
  );
  core.saveRules({ maxParallel: 1 });
  delay = true;
  const pending = core.delegate(args);
  await assert.rejects(() => core.delegate(args), /并行上限/);
  await pending;
  delay = false;
  core.saveRules({ enabled: false });
  await assert.rejects(() => core.delegate(args), /关闭/);
  core.saveRules({ enabled: true, maxParallel: 3 });
});
test("independent tasks run as one parallel batch", async () => {
  delay = true;
  const started = Date.now();
  const result = await core.delegateBatch({
    announced: true,
    tasks: [
      { modelId: ids.low, task: "并行甲", requestId: "parallel-a" },
      { modelId: ids.strong, task: "并行乙", requestId: "parallel-b" },
    ],
  });
  const elapsed = Date.now() - started;
  delay = false;
  assert.equal(result.mode, "parallel");
  assert.equal(result.results.length, 2);
  assert(result.results.every((x) => x.status === "done"));
  assert(elapsed < 1000, `并行调用耗时异常：${elapsed}ms`);
  await assert.rejects(
    () =>
      core.delegateBatch({
        announced: true,
        tasks: [{ modelId: ids.low, task: "不足两个" }],
      }),
    /2 至 6/,
  );
});
test("failure is recorded without leaking response body", async () => {
  fail = true;
  const r = await core.delegate({
    modelId: ids.low,
    task: "x",
    announced: true,
  });
  assert.equal(r.status, "failed");
  assert(!JSON.stringify(r).includes("secret leak"));
  assert.match(r.error, /401/);
  fail = false;
});
test("Anthropic protocol and disabled model guard", async () => {
  const m = core.publicConfig().models.find((x) => x.id === ids.standard);
  core.saveModel({ ...m, protocol: "anthropic" });
  assert((await core.testModel(m.id)).ok);
  assert.equal(received.at(-1).url, "/v1/messages");
  assert.equal(received.at(-1).headers["x-api-key"], "fake-secret-for-test");
  core.saveModel({ ...m, enabled: false });
  await assert.rejects(
    () => core.delegate({ modelId: m.id, task: "x", announced: true }),
    /停用/,
  );
});
test("MCP exposes catalog, single delegation and parallel delegation", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("mcp.mjs")],
    env: { ...process.env },
  });
  const client = new Client({ name: "test", version: "1.0" });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.deepEqual(list.tools.map((t) => t.name).sort(), [
      "model_team_catalog",
      "model_team_delegate",
      "model_team_delegate_batch",
    ]);
    const cat = JSON.parse(
      (await client.callTool({ name: "model_team_catalog", arguments: {} }))
        .content[0].text,
    );
    assert(cat.models.every((m) => !("secret" in m)));
    const bad = await client.callTool({
      name: "model_team_delegate",
      arguments: { modelId: ids.low, task: "x", announced: false },
    });
    assert(bad.isError);
    const good = await client.callTool({
      name: "model_team_delegate",
      arguments: { modelId: ids.low, task: "自由委派", announced: true },
    });
    assert.equal(JSON.parse(good.content[0].text).status, "done");
    const batch = await client.callTool({
      name: "model_team_delegate_batch",
      arguments: {
        announced: true,
        tasks: [
          { modelId: ids.low, task: "甲" },
          { modelId: ids.strong, task: "乙" },
        ],
      },
    });
    assert.equal(JSON.parse(batch.content[0].text).mode, "parallel");
  } finally {
    await client.close();
  }
});
test("custom protocol registry supports configuration and shared transport", async () => {
  const { protocolAdapters } = await import("../adapters/protocols.mjs");
  protocolAdapters.set("custom-test", {
    label: "自定义协议",
    request: ({ model, messages, apiKey }) => ({
      suffix: "/custom",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + apiKey,
      },
      body: { model, messages },
    }),
    response: (data) => ({
      text: data.choices[0].message.content,
      inputTokens: 20,
      outputTokens: 10,
    }),
  });
  const c = core.saveModel({
    name: "自定义",
    kind: "api",
    protocol: "custom-test",
    model: "test",
    baseUrl: endpoint,
    apiKey: "fake-secret-for-test",
  });
  const m = c.models.at(-1);
  assert(c.protocols.some((p) => p.id === "custom-test"));
  assert((await core.testModel(m.id)).ok);
  assert.equal(received.at(-1).url, "/v1/custom");
  assert.equal(
    received.at(-1).headers.authorization,
    "Bearer fake-secret-for-test",
  );
  core.deleteModel(m.id);
  protocolAdapters.delete("custom-test");
});
let server;
test("HTTP: origin and CSRF protection; installation isolated to test Codex home", async () => {
  const port = 14318;
  const codexHome = path.join(base, "codex");
  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, "AGENTS.md"), "保留原有规则。\n");
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    'model = "gpt-6-astra"\n',
  );
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(port),
      MODEL_TEAM_CODEX_HOME: codexHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error("server exit " + code)));
  });
  const baseUrl = "http://127.0.0.1:" + port;
  let r = await fetch(baseUrl + "/api/state");
  const s = await r.json();
  assert(s.token);
  assert(!JSON.stringify(s).includes("fake-secret"));
  r = await fetch(baseUrl + "/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "x" }),
  });
  assert.equal(r.status, 403);
  r = await fetch(baseUrl + "/api/state", {
    headers: { origin: "https://evil.example" },
  });
  assert.equal(r.status, 403);
  if (spawnSync("codex", ["--version"]).status !== 0) return;
  r = await fetch(baseUrl + "/api/install", {
    method: "POST",
    headers: { "x-local-token": s.token, "content-type": "application/json" },
    body: "{}",
  });
  const installed = await r.json();
  assert.equal(r.status, 200, installed.error);
  assert.equal(installed.installed, true);
  assert(
    fs
      .readFileSync(path.join(codexHome, "config.toml"), "utf8")
      .includes('model = "gpt-6-astra"'),
  );
  const again = await fetch(baseUrl + "/api/install", {
    method: "POST",
    headers: { "x-local-token": s.token, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(again.status, 200);
  assert(
    fs
      .readFileSync(path.join(codexHome, "AGENTS.md"), "utf8")
      .includes("保留原有规则"),
  );
  assert(
    fs
      .readFileSync(path.join(codexHome, "AGENTS.md"), "utf8")
      .includes("model_team_delegate"),
  );
  assert(
    !fs
      .readFileSync(path.join(codexHome, "config.toml"), "utf8")
      .includes("fake-secret"),
  );
});
after(() => {
  server?.kill();
  mock.closeAllConnections();
  mock.close();
});
