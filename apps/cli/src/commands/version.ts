import { EXIT, type ExitCode } from '../exit-codes.js';
import { printJson, type CmdContext } from '../util.js';

import { NEOS_VERSION } from '@neos-work/shared';

export const CLI_VERSION = NEOS_VERSION;
export function cmdVersion(ctx: CmdContext): ExitCode {
  if (ctx.json) printJson(ctx, { name: 'neos', version: CLI_VERSION });
  else ctx.out(`neos ${CLI_VERSION}`);
  return EXIT.OK;
}
