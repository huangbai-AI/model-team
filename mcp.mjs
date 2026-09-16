import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { catalog, delegate } from "./core.mjs";
const server = new McpServer(
  { name: "model-team", version: "2.0.0" },
  {
    instructions:
      "当前 GPT 是总指挥，自行决定是否、何时、向谁委派，无固定流程。委派前一句「任务 → 模型」，仅传必要上下文。",
  },
);
const wrap = (fn) => async (a) => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(a)) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.message }] };
  }
};
server.registerTool(
  "model_team_catalog",
  {
    description: "按需读取可用模型和偏好；总指挥决定自己完成或自由委派。",
    inputSchema: {},
  },
  wrap(catalog),
);
server.registerTool(
  "model_team_delegate",
  {
    description:
      "向选定模型委派任意子任务。无步骤/顺序限制，可并行。会产生费用；返回结果由总指挥验证。",
    inputSchema: {
      modelId: z.string(),
      task: z.string().min(1).max(20000),
      context: z.string().max(80000).default(""),
      reason: z.string().max(240).default(""),
      announced: z.literal(true),
      requestId: z
        .string()
        .max(100)
        .optional()
        .describe("同一委派重试使用相同标识，避免重复付费"),
    },
  },
  wrap(delegate),
);
await server.connect(new StdioServerTransport());
