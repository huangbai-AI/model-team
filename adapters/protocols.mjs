/**
 * Model protocol registry. Adapters only translate requests/responses.
 * Transport, timeout, secret storage and usage accounting remain shared.
 * Never log apiKey or raw provider error bodies.
 */
export const protocolAdapters = new Map([
  [
    "openai",
    {
      label: "OpenAI 兼容接口",
      request({ model, messages, maxTokens, apiKey }) {
        return {
          suffix: "/chat/completions",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: { model, messages, max_tokens: maxTokens, stream: false },
        };
      },
      response(data) {
        return {
          text: data.choices?.[0]?.message?.content,
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null,
        };
      },
    },
  ],
  [
    "anthropic",
    {
      label: "Anthropic 原生接口",
      request({ model, messages, maxTokens, apiKey }) {
        return {
          suffix: "/messages",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: {
            model,
            max_tokens: maxTokens,
            system: messages.find((m) => m.role === "system")?.content || "",
            messages: messages.filter((m) => m.role !== "system"),
          },
        };
      },
      response(data) {
        return {
          text: data.content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n"),
          inputTokens: data.usage?.input_tokens ?? null,
          outputTokens: data.usage?.output_tokens ?? null,
        };
      },
    },
  ],
]);
