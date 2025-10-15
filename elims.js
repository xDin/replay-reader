const parse = require('./index.js');
const elimsClass = require('./exports/elims_classnetcache.json');
const elimsPayload = require('./exports/elims_payload.json');

const ELIMINATION_EVENT = 'FortniteGame.AthenaPlayerState:OnPlayerEliminationFeedUpdated';
const DEFAULT_NOT_READING_GROUPS = ['PlayerPawn_Athena.PlayerPawn_Athena_C'];

const flattenNetFieldExports = (entries) => {
  const stack = Array.isArray(entries) ? [...entries] : [entries];
  const flattened = [];

  while (stack.length) {
    const entry = stack.shift();

    if (entry === undefined || entry === null) {
      continue;
    }

    if (Array.isArray(entry)) {
      stack.unshift(...entry);
      continue;
    }

    flattened.push(entry);
  }

  return flattened;
};

const describeNetFieldExport = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return String(entry);
  }

  if (entry.customExportName) {
    return entry.customExportName;
  }

  if (entry.exportName) {
    return entry.exportName;
  }

  if (Array.isArray(entry.path)) {
    return entry.path.join(',');
  }

  return JSON.stringify(entry);
};

const filterValidNetFieldExports = (entries, { debug } = {}) => {
  const valid = [];
  const invalid = [];

  flattenNetFieldExports(entries).forEach((entry) => {
    if (entry && Array.isArray(entry.path) && entry.path.length > 0) {
      valid.push(entry);
    } else if (entry !== undefined && entry !== null) {
      invalid.push(entry);
    }
  });

  if (invalid.length && debug) {
    const labels = invalid.map(describeNetFieldExport).join(', ');
    console.warn(`Ignoring ${invalid.length} netFieldExport definition(s) without a valid path: ${labels}`);
  }

  return valid;
};

const DEFAULT_EXPORTS = filterValidNetFieldExports([elimsClass, elimsPayload]);
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

const normalizeDistanceValue = (value) => {
  const numeric = sanitizeNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  const absolute = Math.abs(numeric);
  const converted = absolute > 1000 ? absolute * CM_TO_METERS : absolute;

  return Number.isFinite(converted) ? converted : undefined;
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
  ].map(normalizeDistanceValue).find((value) => value !== undefined);

  if (directDistance !== undefined) {
    return directDistance;
  }

  const squaredDistance = sanitizeNumber(data.DistanceMetersSquared);

  if (squaredDistance !== undefined) {
    const sqrt = Math.sqrt(Math.abs(squaredDistance));

    if (Number.isFinite(sqrt)) {
      return sqrt;
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

const normalizePropertyElimination = (data, timeSeconds) => ({
  killer: data.EliminatorId,
  victim: data.EliminatedId,
  weapon: data.GunType,
  knocked: !!data.bKnocked,
  distance: extractDistance(data),
  eliminatorLocation: data.EliminatorLocation ?? data.FinisherLocation,
  eliminatedLocation: data.EliminatedLocation ?? data.VictimLocation,
  t: sanitizeNumber(data.TimeSeconds ?? timeSeconds)
});

const toComparableKeyPart = (value) => {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (err) {
      if (typeof value.toString === 'function') {
        return value.toString();
      }

      return '[object]';
    }
  }

  return String(value);
};

const buildParticipantsKey = (elim) => (
  `${toComparableKeyPart(elim.killer)}|${toComparableKeyPart(elim.victim)}`
);

const buildTimeKey = (time) => {
  const numeric = sanitizeNumber(time);

  if (!Number.isFinite(numeric)) {
    return 'na';
  }

  return (Math.round(numeric * 1000) / 1000).toFixed(3);
};

const chooseWeaponValue = (current, incoming) => {
  if (incoming === undefined || incoming === null) {
    return current;
  }

  if (current === undefined || current === null) {
    return incoming;
  }

  if (typeof incoming === 'string' && typeof current !== 'string') {
    return incoming;
  }

  return current;
};

const mergeEliminationRecord = (target, source) => {
  if (target.killer === undefined && source.killer !== undefined) {
    target.killer = source.killer;
  }

  if (target.victim === undefined && source.victim !== undefined) {
    target.victim = source.victim;
  }

  target.weapon = chooseWeaponValue(target.weapon, source.weapon);

  if (target.distance === undefined && source.distance !== undefined) {
    target.distance = source.distance;
  }

  if (!target.eliminatorLocation && source.eliminatorLocation) {
    target.eliminatorLocation = source.eliminatorLocation;
  }

  if (!target.eliminatedLocation && source.eliminatedLocation) {
    target.eliminatedLocation = source.eliminatedLocation;
  }

  if (source.knocked !== undefined) {
    if (target.knocked === undefined) {
      target.knocked = !!source.knocked;
    } else {
      target.knocked = target.knocked || !!source.knocked;
    }
  }

  const sourceTime = sanitizeNumber(source.t);
  const targetTime = sanitizeNumber(target.t);

  if (!Number.isFinite(targetTime) && Number.isFinite(sourceTime)) {
    target.t = sourceTime;
  }
};

const normalizeChunkElimination = (event) => {
  if (!event || event.group !== 'playerElim') {
    return undefined;
  }

  return {
    killer: event.eliminator,
    victim: event.eliminated,
    weapon: event.gunType,
    knocked: event.knocked,
    distance: normalizeDistanceValue(
      event.distance ?? event.Distance ?? event.distanceMeters ?? event.EliminationDistance
    ),
    eliminatorLocation: event.eliminatorLocation ?? event.finisherLocation,
    eliminatedLocation: event.eliminatedLocation ?? event.victimLocation,
    t: sanitizeNumber(event.timeSeconds)
  };
};

const combineEliminationData = (propertyElims = [], rawChunkEvents = []) => {
  const participantStore = new Map();

  const register = (elim) => {
    if (!elim) {
      return;
    }

    const participantKey = buildParticipantsKey(elim);
    const timeKey = buildTimeKey(elim.t);

    if (!participantStore.has(participantKey)) {
      participantStore.set(participantKey, new Map());
    }

    const timeMap = participantStore.get(participantKey);
    let record = timeMap.get(timeKey);

    if (!record && timeKey !== 'na') {
      record = timeMap.get('na');

      if (record) {
        timeMap.delete('na');
        timeMap.set(timeKey, record);
      }
    }

    if (!record) {
      timeMap.set(timeKey, { ...elim });
      return;
    }

    mergeEliminationRecord(record, elim);
  };

  propertyElims.forEach((elim) => register(elim));

  rawChunkEvents
    .map(normalizeChunkElimination)
    .filter((elim) => elim && (elim.killer !== undefined || elim.victim !== undefined))
    .forEach((elim) => register(elim));

  const merged = [];

  participantStore.forEach((timeMap) => {
    timeMap.forEach((record) => {
      const normalizedDistance = normalizeDistanceValue(record.distance);
      const derivedDistance = deriveDistanceFromLocations(
        record.eliminatorLocation,
        record.eliminatedLocation
      );
      const distance = normalizedDistance ?? derivedDistance;

      const time = sanitizeNumber(record.t);
      const finalTime = Number.isFinite(time) ? time : undefined;

      merged.push({
        killer: record.killer,
        victim: record.victim,
        weapon: record.weapon,
        knocked: !!record.knocked,
        distance,
        t: finalTime
      });
    });
  });

  merged.sort((a, b) => {
    if (a.t === undefined && b.t === undefined) {
      return 0;
    }

    if (a.t === undefined) {
      return 1;
    }

    if (b.t === undefined) {
      return -1;
    }

    return a.t - b.t;
  });

  return merged;
};

const makeEliminationHandler = ({ onElimination } = {}) =>
  ({ propertyExportEmitter, parsingEmitter }) => {
    parsingEmitter.on('log', noop);
    propertyExportEmitter.on(
      ELIMINATION_EVENT,
      ({ data, result, timeSeconds }) => {
        const normalized = normalizePropertyElimination(data, timeSeconds);

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

  const additionalExports = Array.isArray(customNetFieldExports)
    ? customNetFieldExports
    : customNetFieldExports
      ? [customNetFieldExports]
      : [];

  const mergedExports = filterValidNetFieldExports(
    [...DEFAULT_EXPORTS, ...additionalExports],
    { debug: debug ?? false }
  );

  const result = await parse(buffer, {
    debug: debug ?? false,
    parseEvents: parseEvents ?? true,
    ...rest,
    customNetFieldExports: mergedExports,
    handleEventEmitter: composeHandlers(eliminationHandler, handleEventEmitter),
    notReadingGroups: notReadingGroups ?? DEFAULT_NOT_READING_GROUPS
  });

  const propertyElims = Array.isArray(result?.events?.elims)
    ? result.events.elims
    : [];
  const rawChunkEvents = Array.isArray(result?.rawEvents)
    ? result.rawEvents
    : [];
  const combinedElims = combineEliminationData(propertyElims, rawChunkEvents);

  if (result) {
    result.events ??= {};
    result.events.elims = combinedElims;
  }

  return {
    result,
    elims: combinedElims
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
