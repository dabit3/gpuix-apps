import { Glob } from 'bun'

let bad = 0
for await (const file of new Glob('src/**/*.ts').scan('.')) {
  const lines = (await Bun.file(file).text()).split('\n')
  lines.forEach((line, i) => {
    if (/console\.log\(/.test(line)) { console.error(`${file}:${i + 1}  no console.log in src`); bad++ }
    if (/\bany\b/.test(line) && /:\s*any\b/.test(line)) { console.error(`${file}:${i + 1}  no explicit any`); bad++ }
  })
}
if (bad) process.exit(1)
console.log('lint: ok')
