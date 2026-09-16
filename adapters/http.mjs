import { protocolAdapters } from "./protocols.mjs";
export async function callHttp(m, messages, maxTokens, signal, { apiKey }) {
  const adapter = protocolAdapters.get(m.protocol || "openai");
  if (!adapter) throw Error("未注册的模型协议");
  const request = async (tokenLimit) => {
    const { suffix, headers, body } = adapter.request({
      model: m.model,
      messages,
      maxTokens: tokenLimit,
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
        e.name === "TimeoutError"
          ? "模型响应超时"
          : "连接失败，请检查地址与网络",
      );
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw Error(`接口返回 ${res.status}，请检查密钥、余额和模型权限`);
    }
    return adapter.response(await res.json());
  };
  let result = await request(maxTokens);
  let extraInput = 0;
  let extraOutput = 0;
  if (
    (typeof result.text !== "string" || !result.text.trim()) &&
    result.finishReason === "length" &&
    result.reasoningTokens > 0
  ) {
    extraInput = result.inputTokens || 0;
    extraOutput = result.outputTokens || 0;
    result = await request(Math.min(Math.max(maxTokens * 4, 8192), 32768));
  }
  const { text } = result;
  const inputTokens =
    result.inputTokens == null ? null : result.inputTokens + extraInput;
  const outputTokens =
    result.outputTokens == null ? null : result.outputTokens + extraOutput;
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
