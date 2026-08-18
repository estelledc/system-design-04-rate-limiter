export function createJsonLogger({ sink = console.log } = {}) {
  if (typeof sink !== 'function') {
    throw new TypeError('sink must be a function');
  }

  function write(level, event, fields = {}) {
    sink(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    }));
  }

  return Object.freeze({
    info(event, fields) {
      write('info', event, fields);
    },
    error(event, fields) {
      write('error', event, fields);
    },
  });
}
