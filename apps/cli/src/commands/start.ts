import { runCommand } from './run';
import { createInterface } from 'node:readline';

export async function startCommand() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('Enter GitHub issue number: ', resolve);
  });
  rl.close();

  if (answer.trim()) {
    await runCommand(answer.trim());
  } else {
    console.log('No issue number provided.');
  }
}
