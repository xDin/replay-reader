const fs = require('fs');
const parse = require('./index.js');

const buffer = fs.readFileSync('your2.replay');
const config = { debug: true, parseEvents: true };


parse(buffer, config)
  .then(parsed => {
    console.log('Parsed:', parsed);
  })
  .catch(err => {
    console.error('Error parsing:', err);
  });
