const parse = require('./index.js');
const elimsClass = require('./exports/elims_classnetcache.json');
const elimsPayload = require('./exports/elims_payload.json');

const normalizePath = (path) => {
  if (typeof path !== 'string') {
    return [];
  }

  const trimmed = path.split('/').pop();
  return trimmed ? [path, trimmed] : [path];
};

const collectEliminationEventNames = () => {
  const names = new Set();

  if (typeof elimsPayload.customExportName === 'string') {
    names.add(elimsPayload.customExportName);
  }

  if (typeof elimsPayload.exportName === 'string') {
    names.add(elimsPayload.exportName);
  }

  const paths = Array.isArray(elimsPayload.path)
    ? elimsPayload.path.flatMap(normalizePath)
    : normalizePath(elimsPayload.path);

  paths.forEach((name) => {
    if (typeof name === 'string' && name.length > 0) {
      names.add(name);
    }
  });

  names.add('FortniteGame.AthenaPlayerState:OnPlayerEliminationFeedUpdated');

  return [...names];
};

const ELIMINATION_EVENTS = collectEliminationEventNames();
const DEFAULT_NOT_READING_GROUPS = ['PlayerPawn_Athena.PlayerPawn_Athena_C'];
const DEFAULT_EXPORTS = [elimsClass, elimsPayload];
const noop = () => {};

const normalizeElimination = (data, timeSeconds) => ({
  killer: data.EliminatorId,
  victim: data.EliminatedId,
  weapon: data.GunType,
  knocked: !!data.bKnocked,
  distance: data.Distance,
  t: data.TimeSeconds ?? timeSeconds
});

const makeEliminationHandler = ({ onElimination } = {}) =>
  ({ propertyExportEmitter, parsingEmitter }) => {
    parsingEmitter.on('log', noop);
    const listener = ({ data, result, timeSeconds }) => {
      const normalized = normalizeElimination(data, timeSeconds);

      result.events ??= {};
      result.events.elims ??= [];
      result.events.elims.push(normalized);

      if (typeof onElimination === 'function') {
        onElimination(normalized, { data, result, timeSeconds });
      }
    };

    ELIMINATION_EVENTS.forEach((eventName) => {
      propertyExportEmitter.on(eventName, listener);
    });
  };

const composeHandlers = (primary, secondary) => {
  if (typeof secondary !== 'function') {
    return primary;
  }

  return (args) => {
    primary(args);
    secondary(args);
  };
};

const loadReplayEliminations = async (buffer, { onElimination, parseOptions = {} } = {}) => {
  const eliminationHandler = makeEliminationHandler({ onElimination });
  const {
    customNetFieldExports,
    handleEventEmitter,
    notReadingGroups,
    parseEvents,
    debug,
    ...rest
  } = parseOptions;

  const mergedExports = Array.isArray(customNetFieldExports)
    ? [...DEFAULT_EXPORTS, ...customNetFieldExports]
    : [...DEFAULT_EXPORTS];

  const result = await parse(buffer, {
    debug: debug ?? false,
    parseEvents: parseEvents ?? true,
    ...rest,
    customNetFieldExports: mergedExports,
    handleEventEmitter: composeHandlers(eliminationHandler, handleEventEmitter),
    notReadingGroups: notReadingGroups ?? DEFAULT_NOT_READING_GROUPS
  });

  return {
    result,
    elims: result?.events?.elims ?? []
  };
};

module.exports = {
  ELIMINATION_EVENTS,
  DEFAULT_EXPORTS,
  DEFAULT_NOT_READING_GROUPS,
  elimsClass,
  elimsPayload,
  loadReplayEliminations,
  makeEliminationHandler
};
