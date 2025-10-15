const parse = require('./index.js');
const elimsClass = require('./exports/elims_classnetcache.json');
const elimsPayload = require('./exports/elims_payload.json');
const elimsPlayerStateClass = require('./exports/elims_playerstate_classnetcache.json');
const elimsPlayerStatePayload = require('./exports/elims_playerstate_payload.json');

const ELIMINATION_EVENTS = [
  'FortniteGame.AthenaPlayerState:OnPlayerEliminationFeedUpdated',
  'FortniteGame.FortPlayerStateAthena:OnPlayerElimination'
];
const DEFAULT_NOT_READING_GROUPS = ['PlayerPawn_Athena.PlayerPawn_Athena_C'];
const DEFAULT_EXPORTS = [
  elimsClass,
  elimsPayload,
  elimsPlayerStateClass,
  elimsPlayerStatePayload
];
const noop = () => {};

const CM_TO_METERS = 0.01;

const sanitizeNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (value && typeof value === 'object') {
    const possible = Object.values(value).find((candidate) => typeof candidate === 'number');
    if (typeof possible === 'number' && Number.isFinite(possible)) {
      return possible;
    }
  }

  return undefined;
};

const deriveDistanceFromLocations = (eliminatorLocation, eliminatedLocation) => {
  if (!eliminatorLocation || !eliminatedLocation) {
    return undefined;
  }

  const keys = ['x', 'y', 'z'];
  const values = keys.map((key) => {
    const eliminatorCoord = sanitizeNumber(eliminatorLocation[key]);
    const eliminatedCoord = sanitizeNumber(eliminatedLocation[key]);

    if (eliminatorCoord === undefined || eliminatedCoord === undefined) {
      return undefined;
    }

    return eliminatorCoord - eliminatedCoord;
  });

  if (values.some((value) => value === undefined)) {
    return undefined;
  }

  const squared = values.reduce((total, delta) => total + delta * delta, 0);
  const meters = Math.sqrt(squared) * CM_TO_METERS;

  return Number.isFinite(meters) ? meters : undefined;
};

const extractDistance = (data) => {
  const directDistance = [
    data.Distance,
    data.DistanceMeters,
    data.EliminationDistance
  ].map(sanitizeNumber).find((value) => value !== undefined);

  if (directDistance !== undefined) {
    return directDistance;
  }

  const squaredMeters = sanitizeNumber(data.DistanceMetersSquared);
  if (squaredMeters !== undefined) {
    const meters = Math.sqrt(squaredMeters);
    if (Number.isFinite(meters)) {
      return meters;
    }
  }

  const vectorDistance = deriveDistanceFromLocations(
    data.EliminatorLocation ?? data.FinisherLocation,
    data.EliminatedLocation ?? data.VictimLocation
  );

  if (vectorDistance !== undefined) {
    return vectorDistance;
  }

  return undefined;
};

const normalizeElimination = (data, timeSeconds) => ({
  killer: data.EliminatorId,
  victim: data.EliminatedId,
  weapon: data.GunType,
  knocked: !!data.bKnocked,
  distance: extractDistance(data),
  t: data.TimeSeconds ?? timeSeconds
});

const createEliminationKey = (elim) => {
  try {
    return JSON.stringify({
      killer: elim.killer,
      victim: elim.victim,
      weapon: elim.weapon,
      knocked: elim.knocked,
      t: elim.t
    });
  } catch (err) {
    return undefined;
  }
};

const makeEliminationHandler = ({ onElimination } = {}) =>
  ({ propertyExportEmitter, parsingEmitter }) => {
    const seen = new Set();
    parsingEmitter.on('log', noop);
    ELIMINATION_EVENTS.forEach((eventName) => {
      propertyExportEmitter.on(
        eventName,
        ({ data, result, timeSeconds }) => {
          const normalized = normalizeElimination(data, timeSeconds);
          const key = createEliminationKey(normalized);

          if (key && seen.has(key)) {
            return;
          }

          if (key) {
            seen.add(key);
          }

          result.eliminations ??= {};
          result.eliminations.elims ??= [];
          result.eliminations.elims.push(normalized);

          if (typeof onElimination === 'function') {
            onElimination(normalized, { data, result, timeSeconds });
          }
        }
      );
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
    elims: result?.eliminations?.elims ?? []
  };
};

module.exports = {
  ELIMINATION_EVENTS,
  DEFAULT_EXPORTS,
  DEFAULT_NOT_READING_GROUPS,
  elimsClass,
  elimsPayload,
  elimsPlayerStateClass,
  elimsPlayerStatePayload,
  loadReplayEliminations,
  makeEliminationHandler
};
