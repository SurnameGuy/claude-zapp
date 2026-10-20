// Converte gravação WebM/Opus (MediaRecorder) em OGG/Opus (formato das mensagens de voz), sem ffmpeg.
const ID = { SEGMENT: 0x18538067, CLUSTER: 0x1f43b675, BLOCKGROUP: 0xa0, SIMPLEBLOCK: 0xa3, BLOCK: 0xa1 }
const MASTER = new Set([ID.SEGMENT, ID.CLUSTER, ID.BLOCKGROUP])

function vint(buf, pos, keepMarker) {
  const first = buf[pos]
  let len = 1, mask = 0x80
  while (len <= 8 && !(first & mask)) { mask >>= 1; len++ }
  if (len > 8 || pos + len > buf.length) return null
  let v = keepMarker ? first : first & (mask - 1), allOnes = (first & (mask - 1)) === mask - 1
  for (let i = 1; i < len; i++) { v = v * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) allOnes = false }
  return { v, len, unknown: !keepMarker && allOnes }
}

export function isWebm(buf) { return buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3 }

function webmPackets(buf) {
  const packets = []
  const walk = (start, end) => {
    let pos = start
    while (pos < end) {
      const id = vint(buf, pos, true); if (!id) return
      const sz = vint(buf, pos + id.len, false); if (!sz) return
      const data = pos + id.len + sz.len
      const stop = sz.unknown ? end : Math.min(end, data + sz.v)
      if (MASTER.has(id.v)) walk(data, stop)
      else if (id.v === ID.SIMPLEBLOCK || id.v === ID.BLOCK) {
        const tr = vint(buf, data, false)
        const off = data + tr.len + 3 // timecode(2) + flags(1)
        if (off < stop) packets.push(buf.subarray(off, stop))
      }
      pos = stop
    }
  }
  walk(0, buf.length)
  return packets
}

const SILK = [480, 960, 1920, 2880], HYB = [480, 960], CELT = [120, 240, 480, 960]
function samples(p) {
  const toc = p[0], cfg = toc >> 3
  const size = cfg < 12 ? SILK[cfg & 3] : cfg < 16 ? HYB[cfg & 1] : CELT[cfg & 3]
  const c = toc & 3
  return size * (c === 0 ? 1 : c === 3 ? p[1] & 0x3f : 2)
}

let CRC = null
function crc32(b) {
  if (!CRC) { CRC = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; CRC[i] = r >>> 0 } }
  let c = 0
  for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]) & 0xff]) >>> 0
  return c
}

function page(packets, { type, granule, serial, seq }) {
  const segs = []
  for (const p of packets) { let n = p.length; while (n >= 255) { segs.push(255); n -= 255 } segs.push(n) }
  const head = Buffer.alloc(27 + segs.length)
  head.write('OggS', 0); head[4] = 0; head[5] = type
  head.writeBigUInt64LE(BigInt(granule), 6); head.writeUInt32LE(serial, 14); head.writeUInt32LE(seq, 18)
  head[26] = segs.length; segs.forEach((s, i) => (head[27 + i] = s))
  const out = Buffer.concat([head, ...packets])
  out.writeUInt32LE(crc32(out), 22)
  return out
}

export function webmToOgg(webm) {
  const packets = webmPackets(webm).filter((p) => p.length > 0)
  if (!packets.length) throw new Error('Áudio inválido')
  const channels = packets[0][0] & 4 ? 2 : 1, serial = (Math.random() * 0xffffffff) >>> 0
  const OpusHead = Buffer.alloc(19)
  OpusHead.write('OpusHead', 0); OpusHead[8] = 1; OpusHead[9] = channels
  OpusHead.writeUInt16LE(312, 10); OpusHead.writeUInt32LE(48000, 12); OpusHead.writeUInt16LE(0, 16); OpusHead[18] = 0
  const vendor = Buffer.from('zapp'), tags = Buffer.alloc(8 + 4 + vendor.length + 4)
  tags.write('OpusTags', 0); tags.writeUInt32LE(vendor.length, 8); vendor.copy(tags, 12); tags.writeUInt32LE(0, 12 + vendor.length)
  const pages = [page([OpusHead], { type: 2, granule: 0, serial, seq: 0 }), page([tags], { type: 0, granule: 0, serial, seq: 1 })]
  let seq = 2, total = 0
  for (let i = 0; i < packets.length; i += 50) {
    const chunk = packets.slice(i, i + 50)
    total += chunk.reduce((a, p) => a + samples(p), 0)
    pages.push(page(chunk, { type: i + 50 >= packets.length ? 4 : 0, granule: total, serial, seq: seq++ }))
  }
  return Buffer.concat(pages)
}
