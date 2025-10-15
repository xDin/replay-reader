const fs = require('fs');
const path = require('path');
const handleEventEmitter = require('./export/handleEventEmitter');
const {
  loadReplayEliminations,
  ELIMINATION_EVENT
} = require('./elims');

const usage = 'usage: node debug-elims.js <path/to/file.replay> [--max-samples=N] [--include-payloads] [--debug-netfields]';
const FLAG_PREFIX = '--';

const parseArgs = (argv) => {
  const args = argv.slice(2);
  let replayPath;
  const options = {
    maxSamples: 25,
    includePayloads: false,
    debugNetfields: false
  };

  args.forEach((arg) => {
    if (!arg.startsWith(FLAG_PREFIX) && !replayPath) {
      replayPath = arg;
      return;
    }

    if (arg.startsWith('--max-samples=')) {
      const value = Number.parseInt(arg.split('=')[1], 10);
      if (!Number.isNaN(value) && value > 0) {
        options.maxSamples = value;
      }
      return;
    }

    if (arg === '--include-payloads') {
      options.includePayloads = true;
      return;
    }

    if (arg === '--debug-netfields') {
      options.debugNetfields = true;
      return;
    }
  });

  return { replayPath, options };
};

const safeClone = (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return '[unserializable payload]';
    }
  }

  return value;
};

const wrapEmitter = (emitter, {
  emitterName,
  trackedEventPattern,
  maxSamples,
  includePayloads,
  samples,
  counts
}) => {
  if (!emitter || typeof emitter.emit !== 'function') {
    return;
  }

  const originalEmit = emitter.emit.bind(emitter);

  emitter.emit = (eventName, payload, ...rest) => {
    if (trackedEventPattern.test(String(eventName))) {
      const count = (counts.get(eventName) ?? 0) + 1;
      counts.set(eventName, count);

      if (samples.length < maxSamples) {
        const sample = {
          emitter: emitterName,
          event: eventName,
          count,
        };

        if (includePayloads) {
          sample.payload = safeClone(payload?.data ?? payload);
        }

        samples.push(sample);
      }
    }

    return originalEmit(eventName, payload, ...rest);
  };
};

async function main() {
  const { replayPath, options } = parseArgs(process.argv);

  if (!replayPath) {
    console.error(usage);
    process.exit(1);
  }

  const absoluteReplayPath = path.resolve(replayPath);

  let buffer;
  try {
    buffer = fs.readFileSync(absoluteReplayPath);
  } catch (err) {
    console.error(`failed to read replay file "${absoluteReplayPath}":`, err.message);
    process.exit(1);
  }

  const eliminationSamples = [];
  const eventSamples = [];
  const eventCounts = new Map();

  const trackedEventPattern = /elim/i;

  const captureElimination = (elim) => {
    if (eliminationSamples.length >= options.maxSamples) {
      return;
    }

    eliminationSamples.push(safeClone(elim));
  };

  const loggingHandleEventEmitter = (emitters) => {
    wrapEmitter(emitters.propertyExportEmitter, {
      emitterName: 'propertyExportEmitter',
      trackedEventPattern,
      maxSamples: options.maxSamples,
      includePayloads: options.includePayloads,
      samples: eventSamples,
      counts: eventCounts
    });

    wrapEmitter(emitters.netDeltaReadEmitter, {
      emitterName: 'netDeltaReadEmitter',
      trackedEventPattern,
      maxSamples: options.maxSamples,
      includePayloads: options.includePayloads,
      samples: eventSamples,
      counts: eventCounts
    });

    handleEventEmitter(emitters);
  };

  let result;
  try {
    ({ result } = await loadReplayEliminations(buffer, {
      onElimination: captureElimination,
      parseOptions: {
        debug: options.debugNetfields,
        handleEventEmitter: loggingHandleEventEmitter
      }
    }));
  } catch (err) {
    console.error('failed to parse replay:', err.message);
    if (err && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }

  const elimCount = result?.events?.elims?.length ?? 0;
  const observedEventNames = Array.from(eventCounts.keys()).sort();

  console.log(`\nParsed replay: ${absoluteReplayPath}`);
  console.log(`Observed ${elimCount} eliminations reported by the parser.`);

  if (!elimCount) {
    console.log('\nNo eliminations were collected. Use the event samples below to check which elimination related events fired.');
  }

  if (eventSamples.length) {
    console.log(`\nCaptured ${eventSamples.length} elimination-adjacent event sample(s):`);
    eventSamples.forEach((sample, index) => {
      console.log(`  [${index + 1}/${eventSamples.length}] ${sample.emitter} -> ${sample.event} (count=${sample.count})`);
      if (sample.payload !== undefined) {
        console.log(`    payload: ${JSON.stringify(sample.payload, null, 2)}`);
      }
    });
  } else {
    console.log('\nNo events with "elim" in the name were observed on the tracked emitters.');
  }

  if (eliminationSamples.length) {
    console.log(`\nFirst ${eliminationSamples.length} normalized elimination(s):`);
    eliminationSamples.forEach((elim, index) => {
      console.log(`  [${index + 1}/${eliminationSamples.length}] ${JSON.stringify(elim)}`);
    });
  }

  if (observedEventNames.length) {
    console.log('\nEvent counts by name:');
    observedEventNames.forEach((eventName) => {
      console.log(`  ${eventName}: ${eventCounts.get(eventName)}`);
    });
  }

  console.log(`\nElimination handler listens to: ${ELIMINATION_EVENT}`);

  if (options.debugNetfields) {
    console.log('\nNet field export debug files were written next to the replay-reader executable.');
    console.log('Inspect netfieldexports.txt and netGuidToPathName.txt to verify the elimination exports are present.');
  }
}

main();