const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `ShipCode requires Node.js >= 22.5.0 (you have ${process.version}). node:sqlite is not available in older versions.`,
  );
  process.exit(1);
}

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

const program = new Command();

program.name('shipcode').description('ShipCode — Autonomous AI coding pipeline').version('0.0.1');

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
  .description('Generate and review a plan (stops at awaiting_approval)')
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
  .command('prd <keywords...>')
  .description('Generate or enhance a PRD from keywords')
  .action((keywords: string[]) => prdCommand(keywords.join(' ')));

program.parse();
