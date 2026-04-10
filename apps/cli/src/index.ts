const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `ShipCode requires Node.js >= 22.5.0 (you have ${process.version}). node:sqlite is not available in older versions.`,
  );
  process.exit(1);
}

import { Command } from 'commander';
import { statusCommand } from './commands/status';
import { runCommand } from './commands/run';
import { startCommand } from './commands/start';
import { onboardCommand } from './commands/onboard';

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

program.parse();
