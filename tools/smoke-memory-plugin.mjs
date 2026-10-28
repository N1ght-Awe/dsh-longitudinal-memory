/**
 * 冒烟测试：确认插件**能被 Node 完整链接**（所有命名导出都对得上）。
 *
 *   node smoke-memory-plugin.mjs <插件目录>
 *
 * 为什么需要它：插件跑在宿主内核里，`@deepseek-ai/*` 这些包只在内核里能解析，
 * 直接 `node -e "import(...)"` 会 ENOENT。于是「漏了个导出、启动时才炸」这种错
 * 只能等重启那一刻才发现 —— 这个脚本给它们搭最小替身，把链接阶段提前到命令行。
 *
 * 只在临时目录里搭桩，不碰插件目录本身。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = resolve(process.argv[2] ?? ".");
const root = mkdtempSync(join(tmpdir(), "plugin-smoke-"));
const modules = join(root, "node_modules");

function stub(specifier, body) {
  const dir = join(modules, ...specifier.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: specifier, version: "0.0.0", type: "module", main: "index.js" }), "utf8");
  writeFileSync(join(dir, "index.js"), body, "utf8");
}

// 宿主注入的两个包：这里只需要形状对得上，不需要真实现。
stub("@deepseek-ai/dsh-home-paths", "export function resolveDshHome(){return process.env.DSH_HOME ?? \"\";}\n");
stub("@deepseek-ai/dsh-tools", "export function defineTool(definition){if(!definition||typeof definition!==\"object\")throw new Error(\"defineTool 需要一个对象\");if(typeof definition.name!==\"string\")throw new Error(\"工具缺 name\");return definition;}\n");

const target = join(modules, "plugin");
cpSync(source, target, { recursive: true });
const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
const entry = join(target, typeof pkg.main === "string" ? pkg.main : "lib/index.js");

console.log("被测插件：" + source);
try {
  const mod = await import(pathToFileURL(entry).href);
  console.log("✅ 链接成功 —— 导出：" + Object.keys(mod).join(", "));
  if (typeof mod.name !== "string") throw new Error("插件没有导出 name");
  console.log("   name = " + mod.name);
} catch (error) {
  console.error("❌ 链接失败：" + String(error && error.message ? error.message : error));
  console.error("   这样的插件装上去了，启动时会静默消失（工具全没了）。");
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
