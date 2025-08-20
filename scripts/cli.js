#!/usr/bin/env node
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// équivalent __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsNode = resolve(__dirname, "../node_modules/.bin/ts-node");
const main = resolve(__dirname, "main.ts");

const args = process.argv.slice(2);

const child = spawn(tsNode, [main, ...args], { stdio: "inherit", shell: true });

child.on("exit", code => {
  process.exit(code);
});