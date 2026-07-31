/**
 * neos CLI router (Task 11).
 */

import { NeosApiClient } from './client.js';
import { resolveConfig } from './config.js';
import { cmdDaemon, type DaemonCmdDeps } from './commands/daemon.js';
import { cmdDeploy } from './commands/deploy.js';
import { cmdDesignSystems } from './commands/design-systems.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdFiles } from './commands/files.js';
import { cmdMcp } from './commands/mcp.js';
import { cmdMedia } from './commands/media.js';
import { cmdMemory } from './commands/memory.js';
import { cmdPlugin } from './commands/plugin.js';
import { cmdProject } from './commands/project.js';
import { cmdRun } from './commands/run.js';
import { cmdSkills } from './commands/skills.js';
import { cmdStatus } from './commands/status.js';
import { CLI_VERSION, cmdVersion } from './commands/version.js';
import { buildAgentEnv, formatAgentEnvExports } from './env-inject.js';
import { EXIT, type ExitCode } from './exit-codes.js';
import { hasFlag, type CmdContext } from './util.js';

const HELP = `neos ${CLI_VERSION} — NEOS Work headless CLI

Usage:
  neos [--json] <command> [args]

Commands:
  version                 Print CLI version
  status                  Daemon health + auth
  doctor                  Connectivity checks
  daemon status|start|stop
  project list|create|get
  files ls|read|write     Project files (NEOS_PROJECT_ID)
  run create|status|cancel
  skills list|scan
  design-systems list
  memory list|add
  mcp list
  media list|config|generate
  plugin list|atoms
  deploy list
  env                     Print agent env exports

Environment:
  NEOS_SERVER_URL / NEOS_URL   Daemon base URL (default http://127.0.0.1:3000)
  NEOS_AUTH_TOKEN / NEOS_TOKEN Bearer token (daemon stdout NEOS_AUTH_TOKEN=…)
  NEOS_PORT                    Port when URL unset
  NEOS_PROJECT_ID              Default design project
  NEOS_PROJECT_DIR             Optional project directory hint
  NEOS_CLI_TIMEOUT_MS          Request timeout (default 30000)

Exit codes:
  0 ok · 2 usage · 10 daemon down · 11 unauthorized · 12 not found
  13 capability denied · 14 validation · 15 network · 1 internal
`;

export async function runCli(
  argv: string[],
  opts?: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    stdout?: (s: string) => void;
    stderr?: (s: string) => void;
    daemon?: DaemonCmdDeps;
  },
): Promise<ExitCode> {
  const out = opts?.stdout ?? ((s: string) => {
    process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
  });
  const err = opts?.stderr ?? ((s: string) => {
    process.stderr.write(s.endsWith('\n') ? s : `${s}\n`);
  });

  const args = [...argv];
  const json = hasFlag(args, '--json');
  const cleaned = args.filter((a) => a !== '--json');

  if (cleaned.length === 0 || cleaned[0] === 'help' || cleaned[0] === '-h' || cleaned[0] === '--help') {
    out(HELP);
    return cleaned.length === 0 ? EXIT.USAGE : EXIT.OK;
  }

  const cmd = cleaned[0]!;
  const rest = cleaned.slice(1);
  const cfg = resolveConfig(opts?.env ?? process.env);
  const client = new NeosApiClient(cfg, opts?.fetchImpl ?? fetch);
  const ctx: CmdContext = { argv: cleaned, json, out, err };

  switch (cmd) {
    case 'version':
    case '-V':
    case '--version':
      return cmdVersion(ctx);
    case 'status':
      return cmdStatus(ctx, client, cfg);
    case 'doctor':
      return cmdDoctor(ctx, client, cfg);
    case 'daemon':
      return cmdDaemon(ctx, client, cfg, rest, opts?.daemon);
    case 'project':
    case 'projects':
      return cmdProject(ctx, client, cfg, rest);
    case 'files':
    case 'file':
      return cmdFiles(ctx, client, cfg, rest);
    case 'run':
    case 'runs':
      return cmdRun(ctx, client, cfg, rest);
    case 'skills':
    case 'skill':
      return cmdSkills(ctx, client, rest);
    case 'design-systems':
    case 'design-system':
    case 'ds':
      return cmdDesignSystems(ctx, client, rest);
    case 'memory':
    case 'memories':
      return cmdMemory(ctx, client, rest);
    case 'mcp':
      return cmdMcp(ctx, client, rest);
    case 'media':
      return cmdMedia(ctx, client, rest);
    case 'plugin':
    case 'plugins':
      return cmdPlugin(ctx, client, rest);
    case 'deploy':
    case 'deployments':
      return cmdDeploy(ctx, client, cfg, rest);
    case 'env': {
      const env = buildAgentEnv(cfg, { binPath: process.argv[1] });
      if (json) out(JSON.stringify(env, null, 2));
      else out(formatAgentEnvExports(env));
      return EXIT.OK;
    }
    default:
      err(`Unknown command: ${cmd}`);
      err('Run `neos help` for usage.');
      return EXIT.USAGE;
  }
}
