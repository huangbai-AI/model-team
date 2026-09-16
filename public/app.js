const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  box: '<path d="m12 3 9 5v8l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8m-5-16 9 5"/>',
  sliders:
    '<path d="M4 6h6m4 0h6M4 12h11m4 0h1M4 18h2m4 0h10"/><circle cx="12" cy="6" r="2"/><circle cx="17" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plug: '<path d="M8 3v4m8-4v4M6 7h12v3a6 6 0 0 1-12 0ZM12 16v5"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15ZM14 20h7"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark:
    '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  code: '<path d="m7 7-5 5 5 5m10-10 5 5-5 5m-4-13-2 16"/>',
  file: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h5"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.box}</svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const titles = {
  dashboard: "配置总览",
  models: "模型配置",
  rules: "分工规则",
  history: "执行记录",
  connect: "连接 Codex",
};
const statusNames = {
  planned: "待执行",
  pending: "待执行",
  running: "调用中",
  done: "调用完成",
  failed: "调用失败",
  cancelled: "已停止",
};
const tiers = { low: "低价模型", standard: "均衡模型", strong: "高能力模型" };
const strategies = { balanced: "均衡", quality: "极致", economy: "轻量" };
let state,
  page = "dashboard",
  activePlan = null,
  running = false,
  historySearch = "",
  historyStatus = "",
  toastTimer,
  pollTimer;
async function api(url, data, method = "POST") {
  const r = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-local-token": state?.token || "",
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(data || {}) }),
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || "请求失败");
  return b;
}
async function refresh() {
  state = await api("/api/state", null, "GET");
  $("#model-count").textContent = state.config.models.length;
}
function toast(text, error = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").className = "toast show" + (error ? " error" : "");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
function heading(eyebrow, title, description, action = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function badge(status) {
  return `<span class="status ${esc(status)}">${statusNames[status] || esc(status)}</span>`;
}
function avatar(m) {
  return `<span class="model-avatar tier-${esc(m.tier)}">${esc(m.name.slice(0, 1))}</span>`;
}
function strategyRadios() {
  return Object.entries(strategies)
    .map(
      ([key, title]) =>
        `<label class="strategy-option ${state.config.rules.strategy === key ? "selected" : ""}"><input type="radio" name="strategy" value="${key}" ${state.config.rules.strategy === key ? "checked" : ""}><span><strong>${title}${key === "balanced" ? " · 推荐" : ""}</strong><small>${{ economy: "优先减少费用与等待，不降低验收标准", balanced: "兼顾效果、费用与返工，日常推荐", quality: "优先追求最佳效果，接受更多时间与成本" }[key]}</small></span></label>`,
    )
    .join("");
}
function historyTable(items) {
  if (!items.length)
    return `<div class="empty-state">${icon("clock")}<p>还没有执行记录</p><small>总指挥调用其他模型后，记录会出现在这里</small></div>`;
  return `<div class="table-wrap"><table><thead><tr><th>任务</th><th>来源 / 时间</th><th>状态</th><th>模型调用费用</th><th></th></tr></thead><tbody>${items
    .map((p) => {
      const usage = p.steps.filter((s) => s.usage),
        cost =
          usage.length && usage.every((s) => s.usage.cost != null)
            ? "$" + usage.reduce((n, s) => n + s.usage.cost, 0).toFixed(5)
            : "未计价";
      return `<tr><td class="task-cell">${esc(p.task.slice(0, 45))}${p.task.length > 45 ? "…" : ""}</td><td>${p.source === "codex" ? "Codex" : "网页"} · ${new Date(p.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>${badge(p.status)}</td><td>${cost}</td><td><button class="button quiet" data-view="${p.id}">查看 →</button></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function health(m) {
  return m.lastTest?.ok === true
    ? "已连通"
    : m.lastTest?.ok === false
      ? "连接异常"
      : "待测试";
}
function dashboard() {
  const c = state.config,
    enabled = c.models.filter((m) => m.enabled);
  return (
    heading(
      "长期协作配置",
      "效果优先，分工恰到好处",
      "先守住验收标准，再减少不必要的调用与返工。",
      `<button class="button secondary" data-page="rules">${icon("sliders")}调整协作偏好</button>`,
    ) +
    `<div class="overview-strip"><div><small>默认偏好</small><b>${strategies[c.rules.strategy]}</b></div><div><small>候选模型</small><b>${enabled.length} 个 <span>按需选择</span></b></div><div><small>自动协作</small><b>${c.rules.enabled ? "已启用" : "已暂停"}</b></div><div><small>Codex 接入</small><b>${state.integration.installed ? "配置已写入" : "尚未接入"}</b></div></div><div class="dashboard-grid"><section><div class="card commander-card"><div class="commander-title"><img src="/logo.png" alt="" class="commander-logo"><div><span class="eyebrow">总指挥</span><h2>${esc(c.commander)}</h2></div><span class="subtle-badge">自主判断</span></div><p>理解任务、选择协作者、整合结果并验证。能可靠完成时，直接自己做。</p><div class="guardrails"><span>不固定步骤</span><span>不重复调用</span><span>不降低验收标准</span></div></div><div class="section-heading team-heading"><h2>什么时候用哪个模型</h2><span class="small muted">选择参考 · 随实际效果调整</span></div><div class="candidate-list">${enabled.map((m) => `<article class="card candidate-row">${avatar(m)}<div><div class="candidate-heading"><h3>${esc(m.name)}</h3><span class="connection ${m.lastTest?.ok === false ? "bad" : ""}">${health(m)}</span></div><p>${esc(m.hint || "由总指挥根据任务选择")}</p></div><button class="button quiet" data-edit="${m.id}" aria-label="编辑 ${esc(m.name)}">编辑</button></article>`).join("") || '<div class="card panel">尚无启用的候选模型。<button class="button primary" data-add>添加模型</button></div>'}</div></section><aside><div class="card panel quality-panel"><span class="eyebrow">选择原则</span><h2>选择适合这段时间的模式</h2>${strategyRadios()}<p class="small muted">点击即保存，后续分工读取新偏好。</p><div class="help-list"><div><b>先判断是否需要委派</b><p>简单任务直接做，独立子任务才考虑协作。</p></div><div><b>再匹配难度与风险</b><p>易验证的小任务可选轻量模型；复杂或关键问题选更有把握的模型。</p></div><div><b>结果必须过关</b><p>不达标就补充信息、换模型或总指挥接手。</p></div></div><details class="policy-details"><summary>查看已保存的完整偏好</summary><p>${esc(c.rules.policy)}</p></details></div><div class="notice mt">${icon("file")}<div><b>调用前，一句话告知</b>任务 → 模型。只传必要上下文，配置长期保存在本机。</div></div><div class="card panel mt"><h2>继续在 Codex 提需求</h2><p class="small muted">${state.integration.installed ? "新会话加载工具后按需协作，无需每次打开网页。" : "完成一次接入后，继续在 Codex 中工作。"}</p><button class="button quiet" data-page="connect">查看接入状态 →</button></div></aside></div>`
  );
}
function planHTML(p) {
  return `<section class="card plan-box"><div class="plan-header"><h2>分工记录</h2>${badge(p.status)}</div>${p.steps.map((s) => `<div class="plan-step"><div class="plan-step-top"><span class="step-number">${s.id}</span><div class="plan-step-info"><b>${esc(s.title)}</b><small>${esc(s.modelName)} · ${esc(s.model)}</small></div>${badge(s.status)}</div>${s.error ? `<div class="step-error">${esc(s.error)}</div>` : ""}${s.result ? `<details><summary class="small muted">查看输出</summary><pre class="result">${esc(s.result)}</pre></details>` : ""}</div>`).join("")}</section>`;
}
function models() {
  return (
    heading(
      "模型连接",
      "组建你的模型团队",
      "自由选择服务商、模型与接口。密钥在本机加密保存，保存后不回显。",
      `<button class="button primary" data-add>${icon("plus")}添加模型</button>`,
    ) +
    (state.config.models.length
      ? `<div class="model-grid">${state.config.models.map((m) => `<article class="card model-card ${m.enabled ? "" : "disabled"}"><div class="model-card-head">${avatar(m)}<div><h3>${esc(m.name)}</h3><p>${tiers[m.tier]} · ${m.enabled ? "已启用" : "已停用"}</p></div></div><div class="model-id">${esc(m.model)}</div><p class="model-hint">${esc(m.hint || "可添加适用任务，供总指挥参考。")}</p><details class="connection-details"><summary>连接信息</summary><p>${esc(m.baseUrl || "使用 Codex 已有登录")}</p></details><div class="model-details"><div><span>协议</span><span>${m.kind === "codex" ? "Codex 已有登录" : m.kind === "codex-provider" ? "独立 Codex 通道" : esc(state.config.protocols.find((p) => p.id === m.protocol)?.label || m.protocol)}</span></div><div><span>密钥</span><span>${m.hasKey ? "已加密保存" : "未设置 / 本地免密"}</span></div><div><span>输入 / 输出（每百万词元）</span><span>${m.inputPrice == null ? "未计价" : "$" + m.inputPrice} / ${m.outputPrice == null ? "未计价" : "$" + m.outputPrice}</span></div></div><div class="model-actions"><button class="button secondary" data-test="${m.id}">测试连接</button><button class="button secondary" data-edit="${m.id}">编辑</button><button class="button quiet danger" data-delete="${m.id}">删除</button></div><div id="test-${m.id}" class="test-result">${m.lastTest ? (m.lastTest.ok ? "最近测试：连接成功" : "最近测试：" + esc(m.lastTest.error)) : "尚未测试"}</div></article>`).join("")}</div>`
      : `<section class="card onboarding"><div><span class="big-icon">${icon("box")}</span><h2>先接入一个模型，就能开始</h2><p>填写你已有的接口地址、模型 ID 和 API key。总指挥根据具体任务选择，不需要绑定角色。</p><button class="button primary" data-add>${icon("plus")}添加第一个模型</button></div></section>`) +
    `<div class="notice mt">${icon("shield")}<div><b>支持哪些接口？</b>支持兼容对话接口、Anthropic 接口，以及使用已有登录或独立服务商的 Codex 通道。</div></div>`
  );
}
function rules() {
  const r = state.config.rules;
  return (
    heading(
      "长期偏好",
      "自由选择模式，保持验收标准",
      "模型如何分工，由当前 GPT 根据具体任务判断。",
    ) +
    `<div class="rules-layout"><form class="card rule-form" id="rules-form"><h2>自主协作</h2><label class="check-line"><input name="enabled" type="checkbox" ${r.enabled ? "checked" : ""}>启用按需委派</label><label>给总指挥的偏好<textarea name="policy" rows="7" maxlength="600">${esc(r.policy)}</textarea></label>${[
      ["maxTokens", "接口输出上限（Codex 通道仅提示）", 128, 16384],
      ["maxParallel", "最多同时调用", 1, 6],
      ["contextChars", "每次上下文字符上限", 1000, 80000],
    ]
      .map(
        ([k, t, min, max]) =>
          `<div class="rule-row"><b>${t}</b><input name="${k}" aria-label="${t}" type="number" min="${min}" max="${max}" value="${r[k]}" required></div>`,
      )
      .join(
        "",
      )}<div class="rule-bottom"><span class="small muted">调用前始终简述任务与模型</span><button class="button primary">保存偏好</button></div></form><aside class="card panel"><h2>默认倾向</h2>${strategyRadios()}<p class="small muted">这些是判断参考，不是固定的分工公式。</p></aside></div>`
  );
}
function historyPage() {
  return (
    heading(
      "任务记录",
      "每一次协作，都有记录",
      "查看分工、模型输出与用量。这里的「调用完成」代表模型已回答，不代表代码已通过测试。",
    ) +
    `<div class="history-toolbar"><input id="history-search" aria-label="搜索任务" placeholder="搜索任务内容…" value="${esc(historySearch)}"><select id="history-status" aria-label="筛选状态"><option value="">全部状态</option>${["planned", "running", "done", "failed", "cancelled"].map((s) => `<option value="${s}" ${historyStatus === s ? "selected" : ""}>${statusNames[s]}</option>`).join("")}</select><button class="button secondary" id="refresh-history">刷新记录</button></div><div class="card history-card" id="history-table">${filteredHistory()}</div><div id="active-plan">${activePlan ? planHTML(activePlan) : ""}</div>`
  );
}
function filteredHistory() {
  return historyTable(
    state.history.filter(
      (p) =>
        (!historySearch || p.task.includes(historySearch)) &&
        (!historyStatus || p.status === historyStatus),
    ),
  );
}
function connect() {
  const i = state.integration;
  return (
    heading(
      "连接你的工作流",
      "继续在 Codex 里工作",
      "分工台管理模型与规则，Codex 负责理解项目、执行修改和验证结果。",
    ) +
    `<div class="connect-layout"><section class="card connect-card"><div class="connect-illustration"><span class="big-icon">${icon("sliders")}</span><span class="muted">${icon("arrow")}</span><span class="big-icon">${icon("code")}</span></div><span class="subtle-badge">${i.installed ? "接入配置已写入 · 等待会话加载" : "尚未接入"}</span><h2>启用长期默认分工</h2><p>接入一次即可。以后在 Codex 提开发需求，它按本机最新配置分工，调用前简短说明「任务 → 模型」。</p><div class="connect-list"><div><span>1</span>在「模型配置」中添加模型和密钥</div><div><span>2</span>在「分工规则」中设置协作偏好</div><div><span>3</span>写入接入配置，重启 Codex 后开启新任务</div></div><button class="button primary" id="install">${icon("plug")}${i.installed ? "更新 Codex 接入配置" : "接入本机 Codex"}</button><p class="small">此操作会备份 Codex 配置，添加分工工具、技能和全局分工规则，不改变现有主模型。密钥不会写入 Codex 配置。</p><div id="install-message" class="small muted"></div><details class="mt"><summary class="small muted">手动配置参考</summary><pre class="code">[mcp_servers.model-team]\ncommand = ${esc(JSON.stringify(i.command))}\nargs = [${i.args.map((a) => esc(JSON.stringify(a))).join(", ")}]</pre></details></section><aside class="card panel"><div class="panel-title"><h2>你会看到这样的分工说明</h2></div><div class="help-list"><div><b>复杂问题 → 按需选择模型</b><p>总指挥也可以自己完成。</p></div><div><b>轻量子任务 → 按需选择</b><p>是否委派，取决于具体任务。</p></div><div><b>应用代码与测试 → Codex</b><p>外部模型提供结果，Codex 修改真实项目并验证。</p></div></div><div class="notice mt"><div><b>首次接入后</b>重启后确认工具已加载，后续开发默认按这些规则分工。无需逐次打开网页。</div></div><p class="small muted mt">网页关闭后配置仍然保留。自动分工依赖 Codex 遵循简短规则。</p></aside></div>`
  );
}
function render() {
  document
    .querySelectorAll("[data-page]")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  $("#crumb").textContent = titles[page];
  $("#main").innerHTML = (
    { dashboard, models, rules, history: historyPage, connect }[page] ||
    dashboard
  )();
}
async function navigate(p) {
  page = titles[p] ? p : "dashboard";
  location.hash = page;
  await refresh();
  render();
  window.scrollTo(0, 0);
}
function openModel(id) {
  const m = state.config.models.find((x) => x.id === id);
  const f = $("#model-form");
  f.elements.protocol.innerHTML = state.config.protocols
    .map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`)
    .join("");
  f.reset();
  for (const key of [
    "id",
    "name",
    "baseUrl",
    "model",
    "protocol",
    "tier",
    "kind",
    "hint",
    "inputPrice",
    "outputPrice",
  ])
    f.elements[key].value =
      m?.[key] ??
      ({ protocol: "openai", tier: "standard", kind: "api" }[key] || "");
  f.elements.enabled.checked = m?.enabled !== false;
  f.elements.apiKey.type = "password";
  $("#toggle-key").textContent = "显示";
  $("#dialog-title").textContent = m ? "编辑模型" : "添加模型";
  $("#form-error").textContent = "";
  setKind();
  $("#model-dialog").showModal();
  f.elements.name.focus();
}
function capture() {}
function updatePlan() {
  const el = $("#active-plan");
  if (el) el.innerHTML = activePlan ? planHTML(activePlan) : "";
}
$("#main").addEventListener("input", (e) => {
  if (e.target.id === "history-search") {
    historySearch = e.target.value;
    $("#history-table").innerHTML = filteredHistory();
  }
});
$("#main").addEventListener("change", async (e) => {
  if (e.target.name === "strategy") {
    try {
      state.config = await api("/api/rules", {
        ...state.config.rules,
        strategy: e.target.value,
      });
      document
        .querySelectorAll(".strategy-option")
        .forEach((el) =>
          el.classList.toggle("selected", el.querySelector("input").checked),
        );
      if (page === "dashboard") render();
      toast("已保存为" + strategies[state.config.rules.strategy] + "模式");
    } catch (err) {
      toast(err.message, true);
    }
  }
  if (e.target.id === "history-status") {
    historyStatus = e.target.value;
    $("#history-table").innerHTML = filteredHistory();
  }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button,a");
  if (!b) return;
  try {
    if (b.dataset.page) {
      capture();
      await navigate(b.dataset.page);
      return;
    }
    if (b.hasAttribute("data-add")) return openModel();
    if (b.dataset.edit) return openModel(b.dataset.edit);
    if (b.dataset.delete) {
      const m = state.config.models.find((x) => x.id === b.dataset.delete);
      if (!confirm(`删除「${m.name}」及其本地密钥？历史记录会保留。`)) return;
      await api("/api/models/" + m.id, {}, "DELETE");
      await refresh();
      render();
      toast("模型已删除");
    }
    if (b.dataset.test) {
      const id = b.dataset.test,
        target = $("#test-" + id);
      b.disabled = true;
      target.textContent = "正在发送简短测试请求…";
      try {
        const r = await api("/api/test", { id });
        if (!r.ok) throw Error(r.error);
        target.textContent = `连接成功 · ${(r.latency / 1000).toFixed(2)} 秒`;
        target.classList.remove("error");
      } catch (err) {
        target.textContent = err.message;
        target.classList.add("error");
      } finally {
        b.disabled = false;
      }
    }
    if (b.dataset.view) {
      if (running && activePlan?.id !== b.dataset.view) {
        toast("请先停止当前调用");
        return;
      }
      activePlan = await api("/api/plans/" + b.dataset.view, null, "GET");
      if (page !== "history") await navigate("history");
      else updatePlan();
      $("#active-plan").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (b.id === "refresh-history") {
      await refresh();
      render();
      toast("记录已刷新");
    }
    if (b.id === "install") {
      b.disabled = true;
      b.textContent = "正在接入…";
      try {
        const r = await api("/api/install", {});
        await refresh();
        render();
        $("#install-message").textContent = r.message;
        toast("接入配置已写入，请重新加载 Codex 会话");
      } finally {
        b.disabled = false;
      }
    }
    if (["close-dialog", "cancel-dialog"].includes(b.id))
      $("#model-dialog").close();
    if (b.id === "toggle-key") {
      const field = $("#model-form").elements.apiKey;
      field.type = field.type === "password" ? "text" : "password";
      b.textContent = field.type === "password" ? "显示" : "隐藏";
    }
    if (b.id === "help") await navigate("connect");
  } catch (err) {
    toast(err.message, true);
  }
});
$("#main").addEventListener("submit", async (e) => {
  if (e.target.id !== "rules-form") return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    state.config = await api("/api/rules", {
      ...state.config.rules,
      enabled: f.has("enabled"),
      policy: f.get("policy"),
      ...Object.fromEntries(
        ["maxTokens", "maxParallel", "contextChars"].map((k) => [
          k,
          Number(f.get(k)),
        ]),
      ),
    });
    toast("长期偏好已保存");
    render();
  } catch (err) {
    toast(err.message, true);
  }
});
function setKind() {
  const f = $("#model-form");
  const native = f.elements.kind.value === "codex";
  f.elements.baseUrl.required = !native;
  f.elements.baseUrl.disabled = native;
  f.elements.apiKey.disabled = native;
  f.elements.protocol.disabled = f.elements.kind.value !== "api";
}
$("#model-form").elements.kind.addEventListener("change", setKind);
$("#model-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.enabled = e.target.elements.enabled.checked;
  const button = e.target.querySelector("[type=submit]");
  button.disabled = true;
  try {
    state.config = await api("/api/models", data);
    e.target.elements.apiKey.value = "";
    $("#model-dialog").close();
    await refresh();
    render();
    toast("模型已保存");
  } catch (err) {
    $("#form-error").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
$("#model-dialog").addEventListener("close", () => {
  $("#model-form").elements.apiKey.value = "";
});
window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (titles[next] && next !== page)
    navigate(next).catch((e) => toast(e.message, true));
});
$("#main").innerHTML = '<div class="loading">正在连接本地工作空间…</div>';
try {
  await refresh();
  page = titles[location.hash.slice(1)] ? location.hash.slice(1) : "dashboard";
  render();
  pollTimer = setInterval(async () => {
    if (running || $("#model-dialog").open) return;
    try {
      const before = JSON.stringify(state.config);
      await refresh();
      if (page === "dashboard" && before !== JSON.stringify(state.config))
        render();
      if (page === "history") {
        if (activePlan) {
          activePlan = await api("/api/plans/" + activePlan.id, null, "GET");
          updatePlan();
        }
        $("#history-table").innerHTML = filteredHistory();
      }
    } catch {}
  }, 5000);
} catch (e) {
  $("#main").innerHTML =
    `<div class="notice">无法连接本地服务。请启动服务后刷新页面。${esc(e.message)}</div>`;
}
