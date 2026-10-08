import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from '../src/index.js';

/**
 * Round-trip helper: encode then decode must reproduce the input exactly.
 * The encoder does not append the delimiter; decode does not expect one,
 * so we can pass encode's output straight to decode.
 */
function roundTrip(input) {
  const enc = encode(input);
  const dec = decode(enc);
  assert.deepEqual(dec, input);
  return enc;
}

function bytes(...arr) {
  return new Uint8Array(arr);
}

function bytesRange(start, end) {
  const a = [];
  for (let i = start; i < end; i++) a.push(i & 0xff);
  return new Uint8Array(a);
}

// Helper: assert a Uint8Array equals the given byte values.
function assertBytes(actual, expected, msg) {
  assert.deepEqual(Array.from(actual), Array.from(expected), msg);
}

test('round-trips empty input', () => {
  const enc = roundTrip(bytes());
  assertBytes(enc, bytes(0x01));
});

test('round-trips single non-zero byte', () => {
  const enc = roundTrip(bytes(0x5a));
  assertBytes(enc, bytes(0x02, 0x5a));
});

test('round-trips single zero byte', () => {
  const enc = roundTrip(bytes(0x00));
  assertBytes(enc, bytes(0x01, 0x01));
});

test('round-trips all 256 byte values', () => {
  const all = bytesRange(0, 256);
  roundTrip(all);
});

test('round-trips a long all-zero input', () => {
  roundTrip(new Uint8Array(500));
});

test('round-trips a long all-non-zero input spanning multiple 254-blocks', () => {
  // 600 bytes of 0xAA forces at least three 254-run blocks.
  const inp = new Uint8Array(600).fill(0xaa);
  roundTrip(inp);
});

test('encoder output never contains a zero byte', () => {
  const inputs = [
    bytes(),
    bytes(0x00),
    bytes(0x00, 0x00),
    bytes(0x01, 0x00, 0x02, 0x00, 0x03),
    new Uint8Array(254).fill(0x01),
    new Uint8Array(255).fill(0x01),
    new Uint8Array(508).fill(0x01),
  ];
  for (const inp of inputs) {
    const enc = encode(inp);
    for (const b of enc) {
      assert.notEqual(b, 0x00, `zero byte found in encoded output for input length ${inp.length}`);
    }
  }
});

test('254 non-zero bytes encode to exactly 255 bytes (one overhead)', () => {
  const inp = new Uint8Array(254).fill(0x01);
  const enc = encode(inp);
  assert.equal(enc.length, 255);
  assert.equal(enc[0], 0xff);
  // Trailing overhead byte points past end (value 1, meaning zero literals follow).
  assert.equal(enc[254], 0x01);
});

test('255 non-zero bytes encode to 257 bytes (two overhead bytes)', () => {
  const inp = new Uint8Array(255).fill(0x01);
  const enc = encode(inp);
  assert.equal(enc.length, 257);
});

test('round-trips 253 zero bytes', () => {
  const inp = new Uint8Array(253).fill(0x00);
  roundTrip(inp);
});

test('round-trips 254 zero bytes', () => {
  const inp = new Uint8Array(254).fill(0x00);
  roundTrip(inp);
});

test('encode rejects non-Uint8Array input', () => {
  assert.throws(() => encode([1, 2, 3]), TypeError);
  assert.throws(() => encode('abc'), TypeError);
  assert.throws(() => encode(null), TypeError);
});

test('decode rejects empty input', () => {
  assert.throws(() => decode(bytes()), /empty/i);
});

test('decode rejects non-Uint8Array input', () => {
  assert.throws(() => decode([0x01, 0x02]), TypeError);
});

test('decode rejects a frame containing an internal zero byte', () => {
  // 0x02, 0x00, 0x41 — the 0x00 in the middle is illegal inside a frame.
  assert.throws(() => decode(bytes(0x02, 0x00, 0x41)), /zero/i);
});

test('decode rejects a truncated frame', () => {
  // code 0x05 promises 4 literal bytes but we only supply one.
  assert.throws(() => decode(bytes(0x05, 0x41)), /truncat/i);
});
