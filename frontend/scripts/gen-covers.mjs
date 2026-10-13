// 生成 10 张抽象油画风格 SVG 封面 → public/covers/ (用法: node scripts/gen-covers.mjs)
// 手法: 大色块椭圆/笔触路径 + feTurbulence 位移(笔触毛边) + 细颗粒(画布肌理)
import fs from 'node:fs'
import path from 'node:path'

const OUT = decodeURIComponent(new URL('../public/covers', import.meta.url).pathname)
fs.mkdirSync(OUT, { recursive: true })

// 固定种子伪随机, 保证可重复生成
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PRESETS = [
  { file: 'preset-01', name: '熔金', base: '#5c1d07', colors: ['#d2521e', '#f59e0b', '#fbbf24', '#92400e', '#7c2d12'], seed: 11, freq: 0.010 },
  { file: 'preset-02', name: '深海', base: '#081c33', colors: ['#1e5f8a', '#2ea3a6', '#7fd1c9', '#123a5f', '#0d4f6e'], seed: 22, freq: 0.012 },
  { file: 'preset-03', name: '黛山', base: '#1a2e28', colors: ['#2e7d4f', '#5e9b7a', '#a3c9a8', '#1f5138', '#38695b'], seed: 33, freq: 0.009 },
  { file: 'preset-04', name: '紫夜', base: '#241238', colors: ['#7c4dab', '#a06cd5', '#c39be0', '#4c1d6e', '#5e2b8a'], seed: 44, freq: 0.011 },
  { file: 'preset-05', name: '绯红', base: '#43101e', colors: ['#a03a62', '#c2362b', '#e06a5a', '#6b1e3f', '#8a2b4a'], seed: 55, freq: 0.013 },
  { file: 'preset-06', name: '苔原', base: '#3a3a28', colors: ['#8a8f5c', '#b5b878', '#d9d3a8', '#5c6140', '#6e7350'], seed: 66, freq: 0.010 },
  { file: 'preset-07', name: '星夜', base: '#0d1b3e', colors: ['#274690', '#4a7bc4', '#f5d547', '#12275e', '#3b5fa0'], seed: 77, freq: 0.016 },
  { file: 'preset-08', name: '珊瑚', base: '#6e3040', colors: ['#e8836f', '#f2b8a0', '#c95d63', '#96455a', '#b06a6e'], seed: 88, freq: 0.011 },
  { file: 'preset-09', name: '墨玉', base: '#14201e', colors: ['#2b4a45', '#3f6b60', '#77a396', '#1c332f', '#54807a'], seed: 99, freq: 0.008 },
  { file: 'preset-10', name: '雾灰', base: '#4a4644', colors: ['#8a817c', '#b3a89f', '#d6ccc2', '#5f5854', '#726a64'], seed: 110, freq: 0.009 }
]

const W = 640, H = 360

function genShapes(p) {
  const rnd = mulberry32(p.seed * 7919)
  const shapes = []
  // 6-8 个大色块椭圆(叠加 → 油彩堆叠感)
  const n = 6 + Math.floor(rnd() * 3)
  for (let i = 0; i < n; i++) {
    const cx = Math.round(rnd() * W)
    const cy = Math.round(rnd() * H)
    const rx = Math.round(90 + rnd() * 200)
    const ry = Math.round(50 + rnd() * 120)
    const rot = Math.round(rnd() * 180 - 90)
    const color = p.colors[i % p.colors.length]
    const op = (0.6 + rnd() * 0.35).toFixed(2)
    shapes.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" opacity="${op}" transform="rotate(${rot} ${cx} ${cy})"/>`)
  }
  // 2-3 条长笔触(细长弧线)
  const strokes = 2 + Math.floor(rnd() * 2)
  for (let i = 0; i < strokes; i++) {
    const y = Math.round(40 + rnd() * (H - 80))
    const dy1 = Math.round(rnd() * 120 - 60)
    const dy2 = Math.round(rnd() * 120 - 60)
    const color = p.colors[Math.floor(rnd() * p.colors.length)]
    const sw = Math.round(10 + rnd() * 26)
    const op = (0.45 + rnd() * 0.35).toFixed(2)
    shapes.push(`<path d="M -40 ${y} C 180 ${y + dy1}, 440 ${y + dy2}, ${W + 40} ${y + Math.round(rnd() * 80 - 40)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" opacity="${op}"/>`)
  }
  return shapes.join('\n    ')
}

for (const p of PRESETS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <filter id="paint" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="${p.freq} ${(p.freq * 1.6).toFixed(4)}" numOctaves="3" seed="${p.seed}" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="70"/>
    </filter>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${p.seed + 1}"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.045 0"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${p.base}"/>
  <g filter="url(#paint)">
    ${genShapes(p)}
  </g>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
</svg>
`
  fs.writeFileSync(path.join(OUT, `${p.file}.svg`), svg)
  console.log(`${p.file}.svg (${p.name}) ${svg.length} bytes`)
}
