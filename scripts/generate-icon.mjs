/**
 * 生成 CCHub 的源图标 assets/icon-source.png（1024×1024）。
 *
 * 刻意不引入 canvas / sharp 这类需要编译原生模块的依赖：图标是纯几何图形
 * （圆角底 + 两个 C 环），直接按像素算 SDF 再手写 PNG 就够了，任何装了 Node
 * 的机器都能跑。
 *
 *   node scripts/generate-icon.mjs
 *   pnpm tauri icon assets/icon-source.png
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SIZE = 1024;
const OUT = resolve(import.meta.dirname, "../assets/icon-source.png");

// —— 几何参数：整体留 8% 边距，两个 C 环水平并排 ——
// 两圆心距（0.32·SIZE）必须大于 2·半径 + 环宽，否则两个 C 会粘成连体字。
const PAD = SIZE * 0.08;
const CORNER = SIZE * 0.225;
const RING_RADIUS = SIZE * 0.125;
const RING_WIDTH = SIZE * 0.058;
const CENTERS = [
  { x: SIZE * 0.34, y: SIZE * 0.5 },
  { x: SIZE * 0.66, y: SIZE * 0.5 },
];

/** 圆角矩形的有符号距离场，负值代表在形状内部。 */
function roundedRectSdf(x, y, left, top, right, bottom, radius) {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const hw = (right - left) / 2 - radius;
  const hh = (bottom - top) / 2 - radius;

  const dx = Math.abs(x - cx) - hw;
  const dy = Math.abs(y - cy) - hh;

  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return Math.min(Math.max(dx, dy), 0) + outside - radius;
}

/** 字母 C：一段带开口的圆环。开口朝右，用极角把右侧切掉。 */
function letterCSdf(x, y, center) {
  const dx = x - center.x;
  const dy = y - center.y;
  const dist = Math.hypot(dx, dy);

  // 圆环本体
  const ring = Math.abs(dist - RING_RADIUS) - RING_WIDTH / 2;

  // 开口：右侧 ±38° 的扇形不画，并给两端补上圆头
  const angle = Math.atan2(dy, dx);
  const openHalfAngle = 0.66; // ≈38°
  if (Math.abs(angle) < openHalfAngle) {
    // 落在开口扇形里，距离取到两个端点的最近距离，形成圆润的收口
    const capDist = Math.min(
      Math.hypot(
        x - (center.x + RING_RADIUS * Math.cos(openHalfAngle)),
        y - (center.y + RING_RADIUS * Math.sin(openHalfAngle)),
      ),
      Math.hypot(
        x - (center.x + RING_RADIUS * Math.cos(-openHalfAngle)),
        y - (center.y + RING_RADIUS * Math.sin(-openHalfAngle)),
      ),
    );
    return capDist - RING_WIDTH / 2;
  }

  return ring;
}

/** SDF → 覆盖率，1px 宽的过渡带即可得到干净的抗锯齿边缘。 */
function coverage(sdf) {
  return Math.min(Math.max(0.5 - sdf, 0), 1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 单色：近黑底 + 白字，跟随 shadcn 的中性配色，不做渐变也不带品牌色
const BACKDROP = [24, 24, 27]; // zinc-900
const GLYPH = [255, 255, 255];

function buildPixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;

      const bg = coverage(
        roundedRectSdf(x, y, PAD, PAD, SIZE - PAD, SIZE - PAD, CORNER),
      );

      if (bg <= 0) continue; // 圆角外保持全透明

      // 两个 C 取并集，落在字形上的像素刷白
      const glyph = Math.max(
        ...CENTERS.map((c) => coverage(letterCSdf(x, y, c))),
      );

      pixels[i] = Math.round(lerp(BACKDROP[0], GLYPH[0], glyph));
      pixels[i + 1] = Math.round(lerp(BACKDROP[1], GLYPH[1], glyph));
      pixels[i + 2] = Math.round(lerp(BACKDROP[2], GLYPH[2], glyph));
      pixels[i + 3] = Math.round(bg * 255);
    }
  }

  return pixels;
}

// ------------------------------------------------------------------ PNG 编码

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xff_ff_ff_ff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型：RGBA
  ihdr[10] = 0; // 压缩方式：deflate
  ihdr[11] = 0; // 滤波方式
  ihdr[12] = 0; // 非隔行

  // 每行前置一个 filter type 字节（0 = None）
  const stride = SIZE * 4;
  const raw = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, encodePng(buildPixels()));
console.log(`已生成 ${OUT} (${SIZE}×${SIZE})`);
