// Encode/decode game state in the URL hash.
// Format: #s=<seed>&m=<base64url-moves>&p=<cursor-position>
// Moves are packed 4 per byte (2 bits each: U=0 R=1 D=2 L=3).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
// Hard cap on decoded move count to bound allocations from untrusted URLs.
// 50k moves is well beyond any realistic 2048 game.
const MAX_MOVES = 50000;

export function encodeMoves(moves) {
  if (moves.length === 0) return "";
  const bytes = new Uint8Array(Math.ceil(moves.length / 4));
  for (let i = 0; i < moves.length; i++) {
    const b = i >> 2;
    const shift = (i & 3) * 2;
    bytes[b] |= (moves[i] & 3) << shift;
  }
  // Append move count as a base-36 suffix after a "." so the decoder knows
  // how many moves to extract (the last byte may carry padding bits).
  return toB64(bytes) + "." + moves.length.toString(36);
}

export function decodeMoves(str) {
  if (!str) return [];
  const dot = str.indexOf(".");
  if (dot < 0) return [];
  const b64 = str.slice(0, dot);
  const lenStr = str.slice(dot + 1);
  const length = parseInt(lenStr, 36);
  if (!Number.isFinite(length) || length < 0 || length > MAX_MOVES) return [];
  const bytes = fromB64(b64);
  // Verify the encoded bytes can contain `length` moves
  if (bytes.length < Math.ceil(length / 4)) return [];
  const moves = Array.from({ length });
  for (let i = 0; i < length; i++) {
    const b = i >> 2;
    const shift = (i & 3) * 2;
    moves[i] = (bytes[b] >> shift) & 3;
  }
  return moves;
}

function toB64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

const B64_LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) B64_LOOKUP[ALPHABET.charCodeAt(i)] = i;

function b64CharValue(str, i) {
  if (i >= str.length) return 0;
  const code = str.charCodeAt(i);
  if (code > 127) return -1;
  return B64_LOOKUP[code];
}

function fromB64(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = b64CharValue(str, i);
    const c1 = b64CharValue(str, i + 1);
    const c2 = b64CharValue(str, i + 2);
    const c3 = b64CharValue(str, i + 3);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return new Uint8Array(0);
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    bytes.push((n >> 16) & 0xff);
    if (i + 2 < str.length) bytes.push((n >> 8) & 0xff);
    if (i + 3 < str.length) bytes.push(n & 0xff);
  }
  return new Uint8Array(bytes);
}

export function encodeState({ seed, moves, cursor }) {
  const parts = [`s=${seed >>> 0}`];
  if (moves.length > 0) parts.push(`m=${encodeMoves(moves)}`);
  if (cursor !== undefined && cursor !== moves.length) parts.push(`p=${cursor}`);
  return "#" + parts.join("&");
}

export function decodeState(hash) {
  if (!hash || hash === "#") return null;
  const s = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(s);
  const seedRaw = params.get("s");
  if (seedRaw === null) return null;
  const seed = parseInt(seedRaw, 10);
  if (!Number.isFinite(seed)) return null;
  const moves = decodeMoves(params.get("m") ?? "");
  const cursorRaw = params.get("p");
  let cursor;
  if (cursorRaw === null) {
    cursor = moves.length;
  } else {
    const parsed = parseInt(cursorRaw, 10);
    cursor = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, moves.length)) : moves.length;
  }
  return { seed: seed >>> 0, moves, cursor };
}
