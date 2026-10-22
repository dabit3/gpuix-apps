// Minimal ZIP (stored, no compression; PNG entries are already deflated) for the .pcraft project format.
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(b: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function writeZip(files: { name: string; data: Uint8Array }[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0)
    h.writeUInt16LE(20, 4)
    h.writeUInt32LE(crc, 14)
    h.writeUInt32LE(f.data.length, 18)
    h.writeUInt32LE(f.data.length, 22)
    h.writeUInt16LE(name.length, 26)
    parts.push(h, name, Buffer.from(f.data))
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(f.data.length, 20)
    c.writeUInt32LE(f.data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += 30 + name.length + f.data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

export function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('not a zip file')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory')
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extra = buf.readUInt16LE(p + 30)
    const comment = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (method !== 0) throw new Error(`unsupported zip method ${method}`)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    out.set(name, buf.subarray(start, start + size))
    p += 46 + nameLen + extra + comment
  }
  return out
}
