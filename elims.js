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

const flattenNetFieldExports = (entries) => {
  const queue = Array.isArray(entries) ? [...entries] : [];
  const flattened = [];

  while (queue.length > 0) {
    const entry = queue.shift();

    if (!entry) {
      continue;
    }

    if (Array.isArray(entry)) {
      queue.unshift(...entry);
      continue;
    }

    flattened.push(entry);
  }

  return flattened;
};

const getExportIdentifier = (fieldExport) =>
  fieldExport?.customExportName
    || fieldExport?.exportName
    || fieldExport?.type;

const filterValidNetFieldExports = (entries, { debug = false } = {}) => {
  const flattened = flattenNetFieldExports(entries);
  const deduped = [];
  const indexById = new Map();

  flattened.forEach((fieldExport) => {
    if (!fieldExport || typeof fieldExport !== 'object') {
      if (debug) {
        console.warn('Skipping netFieldExport without an object payload');
      }
      return;
    }

    if (!Array.isArray(fieldExport.path) || fieldExport.path.length === 0) {
      if (debug) {
        const identifier = getExportIdentifier(fieldExport) ?? 'unknown';
        console.warn(`Skipping netFieldExport without a valid path: ${identifier}`);
      }
      return;
    }

    const identifier = getExportIdentifier(fieldExport);
    const pathKey = Array.isArray(fieldExport.path) && fieldExport.path.length > 0
      ? fieldExport.path.join('::')
      : undefined;

    const mapKey = identifier !== undefined
      ? `${identifier}::${pathKey ?? ''}`
      : Symbol('netFieldExport');

    if (indexById.has(mapKey)) {
      const existingIndex = indexById.get(mapKey);
      deduped[existingIndex] = fieldExport;
      return;
    }

    indexById.set(mapKey, deduped.length);
    deduped.push(fieldExport);
  });

  return deduped;
};

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
    data.EliminationDistance,
    data.DistanceMetersSquared
  ].map(sanitizeNumber).find((value) => value !== undefined);

  if (directDistance !== undefined) {
    return directDistance;
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

const mergeElimination = (target, source) => {
  if (!target || typeof target !== 'object' || !source || typeof source !== 'object') {
    return target;
  }

  Object.keys(source).forEach((key) => {
    const incomingValue = source[key];

    if (incomingValue !== undefined) {
      target[key] = incomingValue;
    }
  });

  return target;
};

const makeEliminationHandler = ({ onElimination } = {}) =>
  ({ propertyExportEmitter, parsingEmitter }) => {
    const eliminationsByKey = new Map();
    parsingEmitter.on('log', noop);
    ELIMINATION_EVENTS.forEach((eventName) => {
      propertyExportEmitter.on(
        eventName,
        ({ data, result, timeSeconds }) => {
          const normalized = normalizeElimination(data, timeSeconds);
          const key = createEliminationKey(normalized);

          result.eliminations ??= {};
          result.eliminations.elims ??= [];

          let eliminationRecord = normalized;
          let isNewRecord = true;

          if (key) {
            const existing = eliminationsByKey.get(key);

            if (existing) {
              eliminationRecord = mergeElimination(existing, normalized);
              isNewRecord = false;
            } else {
              eliminationsByKey.set(key, normalized);
            }
          }

          if (isNewRecord) {
            result.eliminations.elims.push(eliminationRecord);
          } else if (!result.eliminations.elims.includes(eliminationRecord)) {
            result.eliminations.elims.push(eliminationRecord);
          }

          if (typeof onElimination === 'function') {
            onElimination(eliminationRecord, { data, result, timeSeconds });
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

const normalizeRawEvent = (event) => {
  if (!event || typeof event !== 'object') {
    return {};
  }

  const { eliminator, eliminated, gunType, knocked, timeSeconds } = event;

  const normalizedTime = typeof timeSeconds === 'number'
    ? Math.round(timeSeconds * 1000) / 1000
    : undefined;

  return {
    killer: eliminator,
    victim: eliminated,
    weapon: gunType,
    knocked: knocked !== undefined ? !!knocked : undefined,
    t: normalizedTime
  };
};

const combineEliminationData = (propertyElims, rawChunkEvents) => {
  const propertyList = Array.isArray(propertyElims) ? propertyElims.slice() : [];
  const rawEvents = Array.isArray(rawChunkEvents) ? rawChunkEvents : [];

  const propertyByExactKey = new Map();
  const propertyByLooseKey = new Map();

  propertyList.forEach((elim, index) => {
    if (!elim || typeof elim !== 'object') {
      return;
    }

    const exactKey = createEliminationKey(elim);
    if (exactKey) {
      propertyByExactKey.set(exactKey, index);
    }

    const looseKey = createEliminationKey({ ...elim, t: undefined });
    if (looseKey) {
      if (!propertyByLooseKey.has(looseKey)) {
        propertyByLooseKey.set(looseKey, []);
      }

      propertyByLooseKey.get(looseKey).push(index);
    }
  });

  const usedProperties = new Set();
  const combined = [];

  rawEvents
    .filter((event) => event && event.group === 'playerElim')
    .forEach((event) => {
      const normalized = normalizeRawEvent(event);
      let propertyIndex;

      const exactKey = createEliminationKey(normalized);
      if (exactKey && propertyByExactKey.has(exactKey)) {
        propertyIndex = propertyByExactKey.get(exactKey);
      } else {
        const looseKey = createEliminationKey({ ...normalized, t: undefined });
        const candidates = looseKey ? propertyByLooseKey.get(looseKey) : undefined;

        if (candidates && candidates.length) {
          propertyIndex = candidates.find((candidate) => !usedProperties.has(candidate));
        }
      }

      if (propertyIndex !== undefined && propertyIndex !== null && !usedProperties.has(propertyIndex)) {
        const propertyElim = propertyList[propertyIndex] || {};
        usedProperties.add(propertyIndex);

        combined.push({
          ...event,
          killer: event.eliminator ?? propertyElim.killer,
          victim: event.eliminated ?? propertyElim.victim,
          weapon: event.gunType ?? propertyElim.weapon,
          knocked: event.knocked ?? propertyElim.knocked,
          distance: propertyElim.distance,
          timeSeconds: event.timeSeconds ?? propertyElim.t,
          t: propertyElim.t ?? event.timeSeconds,
        });
      } else {
        combined.push({
          ...event,
          killer: event.eliminator,
          victim: event.eliminated,
          weapon: event.gunType,
          knocked: event.knocked,
          distance: undefined,
          timeSeconds: event.timeSeconds,
          t: event.timeSeconds,
        });
      }
    });

  propertyList.forEach((propertyElim, index) => {
    if (usedProperties.has(index)) {
      return;
    }

    if (!propertyElim || typeof propertyElim !== 'object') {
      return;
    }

    combined.push({
      killer: propertyElim.killer,
      victim: propertyElim.victim,
      weapon: propertyElim.weapon,
      knocked: propertyElim.knocked,
      distance: propertyElim.distance,
      t: propertyElim.t,
    });
  });

  return combined;
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
    result.eliminations ??= {};
    result.eliminations.combinedElims = combinedElims;
  }

  return {
    result,
    elims: combinedElims
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
