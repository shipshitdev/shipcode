const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `ShipCode requires Node.js >= 22.5.0 (you have ${process.version}). node:sqlite is not available in older versions.`,
  );
  process.exit(1);
}

const { runCli } = await import('./program');
runCli();

export {};
