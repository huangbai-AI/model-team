# 扩展指南

## 添加兼容模型：无需改代码

网页「添加模型」中填写名称、准确模型 ID、基础地址、密钥和适用场景。名称和场景只是总指挥的参考；不绑定固定角色。地址通常不包含 `/chat/completions`、`/messages` 等具体接口后缀。

Codex 已有登录通道不需要填写密钥。独立 Codex 服务商通道当前要求 Responses 兼容地址；不会替换主助手的服务商设置。

## 新增文本接口协议

在 `adapters/protocols.mjs` 中向 `protocolAdapters` 注册一个条目：

```js
protocolAdapters.set('custom', {
  label: '我的协议',
  request({model, messages, maxTokens, apiKey}) {
    return {
      suffix: '/generate',
      headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
      body: {model, messages, max_output_tokens: maxTokens},
    };
  },
  response(data) {
    return {
      text: data.text,
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
    };
  },
});
```

这里的地址、字段只是接口形状示例，请按实际服务商文档填写。重启网页服务和 Codex 工具进程后，新协议会自动出现在表单中。无需增加分工步骤，也无需修改密钥保存逻辑。

请求与响应转换保持纯数据处理。不要记录密钥、授权头或原始错误正文。共享 HTTP 层负责超时、不跟随重定向、错误脱敏和用量计算。新协议应添加本地模拟测试。

涉及流式输出、图片或不同进程工具的通道需要另写调用模块；当前扩展契约只支持最终文本结果，不能假定添加一个协议就获得所有工具能力。

## 扩展选择偏好

`core.mjs` 的 `strategyGuidance` 保存三种偏好的简短解释，`public/app.js` 的 `strategies` 和 `strategyRadios` 控制展示。保持兼容的内部名称 `balanced` / `quality` / `economy`。若新增模式，同时更新保存验证、网页和测试。

不要用固定关键词替代主模型判断，也不要在公共规则中写入个人配置、历史会话或密钥。

## 本地验证

`npm test` 验证协议、加密与脱敏、自由委派、重复请求处理、上下文与并行限制、MCP 和本机网页保护。新增协议后至少验证请求转换、结果提取、错误脱敏。`npm run check:secrets` 检查将被 Git 跟踪的内容，仅报告路径，不输出疑似密钥。
