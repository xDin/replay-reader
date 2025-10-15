const parse = require('./index.js');
const elimsClass = require('./exports/elims_classnetcache.json');
const elimsPayload = require('./exports/elims_payload.json');

const fallbackEventPath = Array.isArray(elimsPayload.path)
  ? elimsPayload.path[0]
  : undefined;

const ELIMINATION_EVENT =
  elimsPayload.exportName || fallbackEventPath ||
  '/Script/FortniteGame.AthenaPlayerState:OnPlayerEliminationFeedUpdated';
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
    propertyExportEmitter.on(
      ELIMINATION_EVENT,
      ({ data, result, timeSeconds }) => {
        const normalized = normalizeElimination(data, timeSeconds);

        result.events ??= {};
        result.events.elims ??= [];
        result.events.elims.push(normalized);

        if (typeof onElimination === 'function') {
          onElimination(normalized, { data, result, timeSeconds });
        }
      }
    );
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
  ELIMINATION_EVENT,
  DEFAULT_EXPORTS,
  DEFAULT_NOT_READING_GROUPS,
  elimsClass,
  elimsPayload,
  loadReplayEliminations,
  makeEliminationHandler
};
