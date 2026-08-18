export const systemClock = Object.freeze({
  nowMs() {
    return Date.now();
  },
});

export class ManualClock {
  #nowMs;

  constructor(initialMs = 0) {
    if (!Number.isSafeInteger(initialMs) || initialMs < 0) {
      throw new TypeError('initialMs must be a non-negative safe integer');
    }
    this.#nowMs = initialMs;
  }

  nowMs() {
    return this.#nowMs;
  }

  advanceMs(deltaMs) {
    if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
      throw new TypeError('deltaMs must be a non-negative safe integer');
    }
    this.#nowMs += deltaMs;
    return this.#nowMs;
  }

  setMs(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('value must be a non-negative safe integer');
    }
    this.#nowMs = value;
  }
}
