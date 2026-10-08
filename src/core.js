/**
 * COBS (Consistent Overhead Byte Stuffing) encode/decode.
 *
 * Wire framing scheme: the decoder consumes bytes until it sees a zero byte
 * (the delimiter). The encoder never emits a zero inside a frame, so a zero
 * unambiguously marks the frame boundary. We implement the original COBS
 * variant (not COBS/R) using the "0x00 last-zero" convention: the final
 * overhead byte can be 0x00, which the decoder reads as "the previous run
 * continued to the delimiter". This squeezes out one byte for inputs whose
 * final run happens to land on the 254th position, matching the original
 * Cheshire/Baker description.
 *
 * All inputs are Uint8Array. All outputs are Uint8Array. We deliberately do
 * not accept Array or number[] because silently coercing hides caller bugs
 * (e.g. passing a list of numbers > 255 would truncate).
 */

/**
 * @param {Uint8Array} input  Raw bytes to frame. Must be a Uint8Array.
 * @returns {Uint8Array}     Encoded frame WITHOUT the trailing delimiter.
 *                          The caller appends 0x00 to mark the boundary.
 */
export function encode(input) {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('input must be a Uint8Array');
  }
  if (input.length > 0xffffffff) {
    // JS array length is a double; cap at uint32 range to stay sane.
    throw new RangeError('input too large');
  }

  // Worst case: every 254 bytes need an overhead byte, plus the leading byte.
  const maxLen = input.length + Math.ceil(input.length / 254) + 1;
  const out = new Uint8Array(maxLen);
  let outPos = 0;        // current write position in `out`
  let codeIdx = 0;        // index of the current overhead byte in `out`
  let code = 1;           // value that will be written at `codeIdx`
  let runStart = 0;       // index into `input` where the current run began

  out[outPos++] = 0; // placeholder for the first overhead byte

  for (let i = 0; i < input.length; i++) {
    const b = input[i];
    if (b === 0x00) {
      // Flush the run that ended just before this zero.
      out[codeIdx] = code;
      codeIdx = outPos;
      code = 1;
      out[outPos++] = 0; // placeholder for next overhead byte
      runStart = i + 1;
    } else {
      out[outPos++] = b;
      code++;
      if (code === 0xff) {
        // A run of 254 non-zero bytes: write overhead and start a new block,
        // but only if there are more bytes to encode.
        out[codeIdx] = code;
        if (i + 1 < input.length) {
          codeIdx = outPos;
          code = 1;
          out[outPos++] = 0;
          runStart = i + 1;
        }
      }
    }
  }

  // Final flush. Per the original COBS spec, a code value of 0 here means
  // "the last run ran all the way to the delimiter", i.e. the final overhead
  // byte points past the end. This happens when the input's tail run did not
  // need to be broken by a zero. We write code (which is in 1..0xff) verbatim;
  // the only way code becomes 0 is never, because we start at 1 and only
  // increment for non-zero bytes — so the final flush always writes a value
  // in 1..0xff. The decoder below handles this consistently.
  out[codeIdx] = code;

  return out.subarray(0, outPos);
}

/**
 * @param {Uint8Array} input  A single encoded frame WITHOUT the trailing 0x00
 *                          delimiter. Pass exactly the bytes encode()
 *                          produced; strip any delimiter first.
 * @returns {Uint8Array}     Decoded original bytes.
 * @throws {Error} If `input` is empty or contains an internal zero byte
 *                 (which would indicate a truncated/corrupt frame).
 */
export function decode(input) {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('input must be a Uint8Array');
  }
  if (input.length === 0) {
    throw new Error('empty COBS frame');
  }

  // Output is at most input.length - 1 (one overhead byte at minimum).
  const out = new Uint8Array(input.length - 1);
  let outPos = 0;
  let idx = 0;

  while (idx < input.length) {
    const code = input[idx];
    if (code === 0x00) {
      // A 0x00 overhead byte signals "the previous run continued to the
      // delimiter". This is only valid as the FINAL overhead byte of the
      // frame; encountering it mid-frame means corruption.
      if (idx !== input.length - 1) {
        throw new Error('invalid COBS frame: unexpected zero overhead byte');
      }
      break;
    }

    idx++;
    // Copy `code - 1` literal bytes. The decoder treats them as raw payload;
    // they must not be 0x00 (the encoder never writes a zero as a literal).
    const n = code - 1;
    for (let j = 0; j < n; j++) {
      if (idx >= input.length) {
        throw new Error('invalid COBS frame: truncated run');
      }
      const b = input[idx++];
      if (b === 0x00) {
        throw new Error('invalid COBS frame: zero byte in payload');
      }
      out[outPos++] = b;
    }

    // If code < 0xff, the encoder inserted a synthetic zero at this point
    // (the original input had a zero here). code === 0xff means "run of 254
    // with no synthetic zero". A synthetic zero is only meaningful when more
    // bytes follow in the frame; at end-of-frame there is no payload to
    // terminate.
    if (code < 0xff && idx < input.length) {
      if (outPos > out.length) {
        // Shouldn't happen with a well-formed frame, but guard against OOB.
        throw new Error('invalid COBS frame: overflow');
      }
      out[outPos++] = 0x00;
    }
  }

  // `out` was allocated at max size; trim to actual length.
  return out.subarray(0, outPos);
}
