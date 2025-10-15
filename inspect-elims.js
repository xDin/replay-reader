const fs = require('fs');
const repl = require('repl');
const { loadReplayEliminations } = require('./elims');

const usage = 'usage: node inspect-elims.js C:\\path\\to\\file.replay';

const formatNetId = (value) => {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return '[object NetId]';
    }
  }

  return String(value);
};

const formatDistance = (value) => {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  if (Math.abs(numeric) >= 100) {
    return numeric.toFixed(1);
  }

  if (Math.abs(numeric) >= 10) {
    return numeric.toFixed(2);
  }

  return numeric.toFixed(3);
};

const formatElimination = (elim, index, total) => {
  const distance = formatDistance(elim.distance);
  const label = typeof index === 'number' && typeof total === 'number'
    ? `${index}/${total}`
    : undefined;
  const prefix = label ? `${label}: ` : '';

  return (
    `${prefix}distance=${distance}m, killer=${formatNetId(elim.killer)}, ` +
    `victim=${formatNetId(elim.victim)}, weapon=${elim.weapon}, ` +
    `knocked=${elim.knocked}, t=${elim.t}`
  );
};

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

  let elims;
  let result;
  try {
    ({ elims, result } = await loadReplayEliminations(buffer));
  } catch (err) {
    console.error('failed to parse replay:', err.message);
    if (err && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }

  const total = elims.length;
  const lastElims = elims.slice(-10);

  if (!total) {
    console.log('No eliminations were parsed from the replay.');
  } else {
    console.log(`Total eliminations parsed: ${total}`);

    if (lastElims.length) {
      console.log('Last 10 eliminations (oldest to newest within that window):');
      lastElims.forEach((elim, index) => {
        const absoluteIndex = total - lastElims.length + index + 1;
        console.log(`  ${formatElimination(elim, absoluteIndex, total)}`);
      });
    }
  }

  console.log('\nInteractive REPL ready. Inspect `elims`, `lastElims`, or the full `result` object.');
  console.log('Example commands: elims[0], lastElims.at(-1), printElimination(elims.at(-1))');
  const server = repl.start({ prompt: 'elims> ' });
  server.context.elims = elims;
  server.context.lastElims = lastElims;
  server.context.result = result;
  server.context.formatElimination = formatElimination;
  server.context.printElimination = (elim) => {
    console.log(formatElimination(elim));
    return elim;
  };
  server.on('exit', () => process.exit(0));
}

main();
