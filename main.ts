// Tiny stack VM for make.fun's tiny-stack-vm-01 bounty. One run answers every
// instance: /input/<id>/program.bin + input.bin -> /output/<id>/stdout.bin + exit.txt.
// Implements the tiny stack ISA v1 (32-bit wrapping ints, 256-value stack, 64 calls,
// 256 words of memory, byte I/O, ten traps, step/output limits).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Scratch for PRINT's decimal conversion (max 11 chars: -2147483648).
const digits = new Uint8Array(12);
// Opcode metadata, strings indexed by opcode byte: V valid, P pops, U pushes.
const V = '111111110000000011111111111111101110000000000000111110000000000011000000000000001111';
const P = '000112230000000022222221222122202220000000000000011000000000000012000000000000001101';
const U = '011022330000000011111111111111101110000000000000000000000000000010000000000000000010';

function run(prog: Uint8Array, input: Uint8Array) {
  const data = new Int32Array(256);
  let sp = 0;
  const calls = new Int32Array(64);
  let cp = 0;
  const mem = new Int32Array(256);
  const out = new Uint8Array(65536);
  let olen = 0;
  let ipos = 0;
  let pc = 0;
  let steps = 0;
  const n = prog.length;
  const finish = (code: number) => ({ bytes: out.subarray(0, olen), code });
  for (;;) {
    if (steps === 1000000) return finish(10);
    if (pc < 0 || pc >= n) return finish(9);
    const op = prog[pc];
    if (op > 83 || V[op] === '0') return finish(5); // unknown opcode (0x1f names none)
    const imm = op === 1 ? 1 : op === 2 ? 4 : op >= 48 && op <= 51 ? 2 : 0;
    if (pc + imm >= n) return finish(9);
    steps++;
    const next = pc + 1 + imm;
    const pops = +P[op];
    const push = +U[op];
    if (sp < pops) return finish(2);
    if (sp - pops + push > 256) return finish(3);
    pc = next;
    switch (op) {
      case 0x00:
        return finish(0);
      case 0x01:
        data[sp++] = (prog[next - 1] << 24) >> 24;
        break;
      case 0x02:
        data[sp++] =
          prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        data[sp] = data[sp - 1];
        sp++;
        break;
      case 0x05: {
        const t = data[sp - 1];
        data[sp - 1] = data[sp - 2];
        data[sp - 2] = t;
        break;
      }
      case 0x06:
        data[sp] = data[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = data[sp - 3];
        data[sp - 3] = data[sp - 2];
        data[sp - 2] = data[sp - 1];
        data[sp - 1] = a;
        break;
      }
      case 0x17:
        data[sp - 1] = -data[sp - 1] | 0;
        break;
      case 0x1b:
        data[sp - 1] = ~data[sp - 1];
        break;
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16:
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x20:
      case 0x21:
      case 0x22: {
        const b = data[sp - 1];
        const a = data[sp - 2];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return finish(4);
          r = (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return finish(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return finish(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return finish(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        data[sp++] = r;
        break;
      }
      case 0x30:
      case 0x31:
      case 0x32: {
        const off = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        if (op === 0x30) {
          pc = next + off;
        } else {
          const v = data[--sp];
          if ((op === 0x31) === (v === 0)) pc = next + off;
        }
        break;
      }
      case 0x33: {
        if (cp === 64) return finish(7);
        calls[cp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      }
      case 0x34:
        if (cp === 0) return finish(8);
        pc = calls[--cp];
        break;
      case 0x40: {
        const addr = data[sp - 1];
        if (addr < 0 || addr > 255) return finish(6);
        data[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = data[sp - 1];
        if (addr < 0 || addr > 255) return finish(6);
        sp -= 2;
        mem[addr] = data[sp];
        break;
      }
      case 0x50: {
        // Decimal, by hand into the shared scratch: no allocation per PRINT, and
        // -(-2147483648) stays exact as a double (2147483648) for the digit loop.
        const v = data[sp - 1];
        const neg = v < 0;
        let u = neg ? -v : v;
        let k = 12;
        if (u === 0) digits[--k] = 48;
        else while (u > 0) {
          digits[--k] = 48 + (u % 10);
          u = (u / 10) | 0;
        }
        if (neg) digits[--k] = 45;
        const len = 12 - k;
        if (olen + len > 65536) return finish(11);
        sp--;
        out.set(digits.subarray(k), olen);
        olen += len;
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return finish(11);
        out[olen++] = data[--sp] & 255;
        break;
      case 0x52:
        data[sp++] = ipos < input.length ? input[ipos++] : -1;
        break;
      case 0x53:
        return finish(data[--sp] & 255);
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const prog = readFileSync(join(IN_DIR, id, 'program.bin'));
  const input = readFileSync(join(IN_DIR, id, 'input.bin'));
  const { bytes, code } = run(prog, input);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), bytes);
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), String(code) + '\n');
}
