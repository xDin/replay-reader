#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadReplayEliminations } = require('./elims');

const usage = 'Usage: node dump-full-parse.js <input.replay> [output.json]';

const [, , inputPath, outputPath] = process.argv;

if (!inputPath) {
  console.error(usage);
  process.exit(1);
}

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
const resolvedOutputPath = outputPath ? path.resolve(process.cwd(), outputPath) : null;

let replayBuffer;
try {
  replayBuffer = fs.readFileSync(resolvedInputPath);
} catch (error) {
  console.error(`Failed to read replay file at "${resolvedInputPath}": ${error.message}`);
  process.exit(1);
}

const replacer = (key, value) => {
  if (value instanceof Buffer) {
    return {
      type: 'Buffer',
      data: value.toString('base64'),
    };
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
};

(async () => {
  try {
    const { result: parsed } = await loadReplayEliminations(replayBuffer, {
      parseOptions: {
        parseEvents: true,
        parsePackets: true,
        parseLevel: 10,
      },
    });

    const json = JSON.stringify(parsed, replacer, 2);

    if (resolvedOutputPath) {
      fs.writeFileSync(resolvedOutputPath, json);
      console.log(`Wrote parsed replay JSON to ${resolvedOutputPath}`);
    } else {
      console.log(json);
    }
  } catch (error) {
    console.error(`Failed to parse replay file: ${error.message}`);
    if (error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  }
})();
