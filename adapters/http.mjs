import { protocolAdapters } from "./protocols.mjs";
export async function callHttp(m, messages, maxTokens, signal, { apiKey }) {
  const adapter = protocolAdapters.get(m.protocol || "openai");
  if (!adapter) throw Error("未注册的模型协议");
  const { suffix, headers, body } = adapter.request({
    model: m.model,
    messages,
    maxTokens,
    apiKey,
  });
  let res;
  try {
    res = await fetch(m.baseUrl + suffix, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(150000)])
        : AbortSignal.timeout(150000),
      redirect: "error",
    });
  } catch (e) {
    if (signal?.aborted) throw Error("已取消");
    throw Error(
      e.name === "TimeoutError" ? "模型响应超时" : "连接失败，请检查地址与网络",
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw Error(`接口返回 ${res.status}，请检查密钥、余额和模型权限`);
  }
  const data = await res.json();
  const { text, inputTokens, outputTokens } = adapter.response(data);
  if (typeof text !== "string" || !text.trim())
    throw Error("接口没有返回文本，请检查模型和输出上限");
  return {
    text,
    inputTokens,
    outputTokens,
    cost:
      m.inputPrice != null &&
      m.outputPrice != null &&
      inputTokens != null &&
      outputTokens != null
        ? (inputTokens * m.inputPrice + outputTokens * m.outputPrice) / 1e6
        : null,
  };
}
