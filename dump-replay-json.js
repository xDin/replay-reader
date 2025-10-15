#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadReplayEliminations } = require('./elims');

const [, , inputPath, outputPath = 'replay.json'] = process.argv;

if (!inputPath) {
  console.error('Usage: node dump-replay-json.js <input.replay> [output.json]');
  process.exit(1);
}

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);

(async () => {
  try {
    const replayBuffer = fs.readFileSync(resolvedInputPath);
    const { result, elims } = await loadReplayEliminations(replayBuffer, {
      parseOptions: {
        parseEvents: true,
        parseLevel: 10,
      },
    });

    fs.writeFileSync(resolvedOutputPath, JSON.stringify(result, null, 2));
    console.log(`Successfully wrote replay data to ${resolvedOutputPath}`);

    if (elims.length > 0) {
      console.log('Found eliminations with distances:');
      elims.forEach((elim, index) => {
        const {
          killer,
          victim,
          weapon,
          knocked,
          distance,
          t,
        } = elim;
        console.log(
          `  #${index + 1}: killer=${killer}, victim=${victim}, weapon=${weapon}, ` +
          `knocked=${knocked}, distance=${distance ?? 'n/a'}, time=${t}`
        );
      });
    } else {
      console.log('No eliminations were found in this replay.');
    }
  } catch (error) {
    console.error(`Failed to dump replay data: ${error.message}`);
    process.exitCode = 1;
  }
})();