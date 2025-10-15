const fs = require('fs');
const path = require('path');
const { loadReplayEliminations } = require('./elims');

const usage = 'usage: node write-elims.js <path/to/file.replay> [output.json]';

const resolveOutputPath = (replayPath, provided) => {
  if (provided) {
    return path.resolve(provided);
  }

  const directory = path.dirname(replayPath);
  const baseName = path.basename(replayPath, path.extname(replayPath));
  return path.join(directory, `${baseName}.elims.json`);
};

const ensureDirectory = (filePath) => {
  const directory = path.dirname(filePath);

  if (!directory || directory === '.' || directory === path.parse(directory).root) {
    return;
  }

  fs.mkdirSync(directory, { recursive: true });
};

async function main() {
  const replayArg = process.argv[2];
  const outputArg = process.argv[3];

  if (!replayArg) {
    console.error(usage);
    process.exit(1);
  }

  const replayPath = path.resolve(replayArg);
  const outputPath = resolveOutputPath(replayPath, outputArg);

  let buffer;
  try {
    buffer = fs.readFileSync(replayPath);
  } catch (err) {
    console.error(`failed to read replay file "${replayPath}":`, err.message);
    process.exit(1);
  }

  let elims;
  try {
    ({ elims } = await loadReplayEliminations(buffer));
  } catch (err) {
    console.error('failed to parse replay:', err.message);
    if (err && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }

  const outputContent = JSON.stringify(elims, null, 2);

  try {
    ensureDirectory(outputPath);
    fs.writeFileSync(outputPath, `${outputContent}\n`);
  } catch (err) {
    console.error(`failed to write eliminations to "${outputPath}":`, err.message);
    process.exit(1);
  }

  console.log(`Wrote ${elims.length} eliminations to ${outputPath}`);
}

main();