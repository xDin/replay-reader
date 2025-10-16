const fs = require('fs');
const path = require('path');
const { loadReplayEliminations } = require('./elims');

const usage = 'usage: node dump-newreplay.js C\\\\path\\\\to\\\\file.replay';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(usage);
    process.exit(1);
  }

  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    console.error(`failed to read replay file "${filePath}":`, err.message);
    process.exit(1);
  }

  try {
    const { elims } = await loadReplayEliminations(buffer);
    const outputPath = path.resolve(process.cwd(), 'newreplay.json');
    fs.writeFileSync(outputPath, JSON.stringify(elims, null, 2));
    console.log(`wrote ${elims.length} eliminations to ${outputPath}`);
  } catch (err) {
    console.error('failed to parse replay:', err.message);
    if (err && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();

