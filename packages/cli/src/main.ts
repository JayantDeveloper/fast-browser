#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  AnthropicProvider,
  GeminiProvider,
  OpenRouterProvider,
  run,
  type Provider,
  type RunResult,
  type TrajectoryStep,
} from "@fast-browser/core";
import { CdpNodeDriver, launchChrome } from "@fast-browser/adapter-cdp-node";

const HELP = `fast-browser — local browser agent

Usage:
  fast-browser run "<task>" --url <url> [options]
  fast-browser bench --tasks <file> [options]

Options:
  --url <url>            Starting URL (default: about:blank)
  --model <slug>         Provider/model. Examples:
                           gemini:gemini-2.5-flash-lite (default)
                           gemini:gemini-2.5-flash
                           openrouter:openai/gpt-oss-120b:free
  --max-steps <n>        Default 60
  --watch                Show the browser window (headed)
  --quiet                Suppress per-step trace
  --json                 Print final RunResult as JSON

Env:
  GEMINI_API_KEY         For provider=gemini
  OPENROUTER_API_KEY     For provider=openrouter
`;

interface CliOpts {
  command: "run" | "bench";
  task?: string;
  url: string;
  model: string;
  maxSteps: number;
  watch: boolean;
  quiet: boolean;
  json: boolean;
  tasksFile?: string;
}

function parseCli(argv: string[]): CliOpts {
  const parsed = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      model: { type: "string" },
      "max-steps": { type: "string" },
      watch: { type: "boolean" },
      quiet: { type: "boolean" },
      json: { type: "boolean" },
      tasks: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (parsed.values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const positionals = parsed.positionals;
  const command = positionals[0] as CliOpts["command"];
  if (command !== "run" && command !== "bench") {
    process.stderr.write(HELP);
    process.exit(2);
  }
  return {
    command,
    task: positionals[1],
    url: (parsed.values.url as string) ?? "about:blank",
    model: (parsed.values.model as string) ?? "gemini:gemini-2.5-flash-lite",
    maxSteps: Number(parsed.values["max-steps"] ?? 60),
    watch: Boolean(parsed.values.watch),
    quiet: Boolean(parsed.values.quiet),
    json: Boolean(parsed.values.json),
    tasksFile: parsed.values.tasks as string | undefined,
  };
}

function makeProvider(spec: string): Provider {
  const [providerName, ...rest] = spec.split(":");
  const model = rest.join(":");
  if (providerName === "gemini") {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");
    return new GeminiProvider({ apiKey, ...(model ? { model } : {}) });
  }
  if (providerName === "openrouter") {
    const apiKey = process.env["OPENROUTER_API_KEY"];
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
    return new OpenRouterProvider({ apiKey, ...(model ? { model } : {}) });
  }
  if (providerName === "anthropic") {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    return new AnthropicProvider({ apiKey, ...(model ? { model } : {}) });
  }
  throw new Error(`unknown provider: ${providerName} (try gemini:..., openrouter:..., or anthropic:...)`);
}

async function runOne(opts: CliOpts, task: string, url: string): Promise<RunResult> {
  const chrome = await launchChrome({ headless: !opts.watch });
  const driver = new CdpNodeDriver({ port: chrome.port });
  await driver.attach({});
  const actor = makeProvider(opts.model);
  try {
    const result = await run(
      driver,
      {
        actor,
        maxSteps: opts.maxSteps,
        onStep: opts.quiet
          ? () => {}
          : (s: TrajectoryStep) => {
              const tag = s.result.ok ? "✓" : `✗(${s.result.error})`;
              const cost = s.llmUsage.costUsd ? ` $${s.llmUsage.costUsd.toFixed(6)}` : "";
              process.stdout.write(
                `  ${String(s.index).padStart(2)}. ${s.action.type.padEnd(8)} ${tag.padEnd(15)} ${s.llmLatencyMs}ms${cost}  ${s.result.summary.slice(0, 100)}\n`,
              );
            },
      },
      { task, startUrl: url },
    );
    return result;
  } finally {
    await driver.detach().catch(() => {});
    await chrome.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));

  if (opts.command === "run") {
    if (!opts.task) {
      process.stderr.write("error: missing task argument\n\n" + HELP);
      process.exit(2);
    }
    if (!opts.quiet) process.stderr.write(`[fast-browser] task: ${opts.task}\n[fast-browser] url:  ${opts.url}\n[fast-browser] model: ${opts.model}\n\n`);
    const result = await runOne(opts, opts.task, opts.url);
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(
        `\n=== ${result.success ? "DONE" : "FAILED"} (${result.exitReason}) ===\nsteps: ${result.steps}  wall: ${result.wallMs}ms  cost: $${result.costUsdEstimate.toFixed(6)}\nresult: ${result.finalResult}\n`,
      );
    }
    process.exit(result.success ? 0 : 1);
  }

  if (opts.command === "bench") {
    if (!opts.tasksFile) {
      process.stderr.write("error: --tasks required for bench\n");
      process.exit(2);
    }
    const fs = await import("node:fs/promises");
    const taskList = JSON.parse(await fs.readFile(opts.tasksFile, "utf8")) as Array<{
      name: string;
      task: string;
      url: string;
      maxSteps?: number;
    }>;
    const records: Record<string, unknown>[] = [];
    for (const t of taskList) {
      process.stdout.write(`\n========== ${t.name} ==========\n`);
      const r = await runOne({ ...opts, maxSteps: t.maxSteps ?? opts.maxSteps }, t.task, t.url);
      records.push({
        name: t.name,
        success: r.success,
        steps: r.steps,
        wallMs: r.wallMs,
        costUsdEstimate: r.costUsdEstimate,
        exitReason: r.exitReason,
        finalResult: r.finalResult,
      });
    }
    process.stdout.write("\n========== summary ==========\n");
    process.stdout.write(JSON.stringify(records, null, 2) + "\n");
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
