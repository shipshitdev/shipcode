#!/usr/bin/env node
import { Command } from 'commander'
import { statusCommand } from './commands/status'
import { runCommand } from './commands/run'
import { startCommand } from './commands/start'

const program = new Command()

program
  .name('shipcode')
  .description('ShipCode — Autonomous AI coding pipeline')
  .version('0.0.1')

program
  .command('status')
  .description('Show active pipelines and recent threads')
  .action(statusCommand)

program
  .command('run <issue>')
  .description('Process a single GitHub issue')
  .action(runCommand)

program
  .command('start')
  .description('Interactive mode — prompt for issue number')
  .action(startCommand)

program.parse()
