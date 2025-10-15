const parse = require('./index.js');
const fs = require('fs');

(async () => {
  const f = process.argv[2];
  if (!f) {
    console.error('usage: node dump-exports-safe.js C\\path\\to\\file.replay');
    process.exit(1);
  }

  const buf = fs.readFileSync(f);

  const handleEventEmitter = ({ parsingEmitter }) => parsingEmitter.on('log', () => {});

  await parse(buf, {
    debug: true,
    parseEvents: false,
    handleEventEmitter,
    notReadingGroups: ['PlayerPawn_Athena.PlayerPawn_Athena_C'],
  });

  console.log('OK → check netfieldexports.txt');
})();
