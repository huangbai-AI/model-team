import { execFileSync } from "node:child_process";
import fs from "node:fs";
const files = execFileSync("git", ["ls-files", "-z"])
  .toString()
  .split("\0")
  .filter(Boolean);
const blocked =
  /(^|\/)(\.data|node_modules|work)(\/|$)|(^|\/)(\.env(?:\..*)?|vault\.key|auth\.json|config\.toml)$|\.pem$/;
const patterns = [
  /\bsk-[A-Za-z0-9_.-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\/Users\/a1\//,
];
const bad = [];
for (const file of files) {
  if (blocked.test(file)) {
    bad.push(file);
    continue;
  }
  const b = execFileSync("git", ["show", ":" + file], {
    maxBuffer: 20 * 1024 * 1024,
  });
  if (b.includes(0)) continue;
  const text = b.toString();
  if (patterns.some((p) => p.test(text))) bad.push(file);
}
if (bad.length) {
  console.error("禁止发布的内容（仅显示路径）：\n" + bad.join("\n"));
  process.exit(1);
}
console.log(
  `检查通过：${files.length} 个已暂存/跟踪文件，未发现匹配的凭据或私有目录。此检查不代替人工审阅。`,
);
