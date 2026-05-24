import { createRequire } from 'node:module';
import { Command } from 'commander';
import { approveCommand } from './commands/approve';
import { logsCommand } from './commands/logs';
import { onboardCommand } from './commands/onboard';
import { planCommand } from './commands/plan';
import { prdCommand } from './commands/prd';
import { retryCommand } from './commands/retry';
import { reviewCommand } from './commands/review';
import { runCommand } from './commands/run';
import { startCommand } from './commands/start';
import { statusCommand } from './commands/status';
import {
  terminalCommand,
  terminalCommentCommand,
  terminalSummaryCommand,
} from './commands/terminal';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export function runCli(): void {
  const program = new Command();

  program.name('shipcode').description('ShipCode — Autonomous AI coding pipeline').version(version);

  program
    .command('onboard')
    .description('Initialize ShipCode in the current project')
    .action(onboardCommand);

  program
    .command('status')
    .description('Show active pipelines and recent threads')
    .action(statusCommand);

  program.command('run <issue>').description('Process a single GitHub issue').action(runCommand);

  program
    .command('start')
    .description('Interactive mode — prompt for issue number')
    .action(startCommand);

  program
    .command('plan <issue>')
    .description('Generate and review a plan (stops at approval)')
    .action(planCommand);

  program
    .command('approve <issue>')
    .description('Approve a plan and start execution')
    .action(approveCommand);

  program
    .command('review <issue>')
    .description('Run plan + adversarial review, output findings')
    .action(reviewCommand);

  program
    .command('retry <issue>')
    .description('Resume pipeline from last checkpoint')
    .action(retryCommand);

  program
    .command('logs <issue>')
    .description('Show terminal events for an issue')
    .action(logsCommand);

  program
    .command('terminal <issue>')
    .description('Open an official Claude/Codex interactive CLI for a GitHub issue')
    .option('--provider <provider>', 'claude|codex', 'claude')
    .option('--model <model>', 'CLI model id')
    .action(terminalCommand);

  program
    .command('terminal-summary <issue>')
    .description('Show the latest interactive terminal summary for an issue')
    .action(terminalSummaryCommand);

  program
    .command('terminal-comment <issue>')
    .description('Preview or post a GitHub comment from the latest terminal summary')
    .option('--post', 'post the generated comment')
    .action(terminalCommentCommand);

  program
    .command('prd <keywords...>')
    .description('Generate or enhance a PRD from keywords')
    .action((keywords: string[]) => prdCommand(keywords.join(' ')));

  program.parse();
}
