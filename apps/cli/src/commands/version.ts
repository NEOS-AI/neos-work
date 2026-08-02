import { EXIT, type ExitCode } from '../exit-codes.js';
import { printJson, type CmdContext } from '../util.js';

export const CLI_VERSION = '0.5.29';
export function cmdVersion(ctx: CmdContext): ExitCode {
  if (ctx.json) printJson(ctx, { name: 'neos', version: CLI_VERSION });
  else ctx.out(`neos ${CLI_VERSION}`);
  return EXIT.OK;
}
