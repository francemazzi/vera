import { basename } from "node:path";
import process from "node:process";

const packageManagerExecutable = basename(process.env.npm_execpath ?? "").toLowerCase();
const pnpmExecutables = new Set(["pnpm", "pnpm.cjs", "pnpm.js", "pnpm.cmd"]);

if (!pnpmExecutables.has(packageManagerExecutable)) {
  throw new Error(
    "I package VERA devono essere preparati e pubblicati con pnpm: npm non applica le riscritture publishConfig richieste.",
  );
}
