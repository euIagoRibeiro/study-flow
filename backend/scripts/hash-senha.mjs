// Gera o AUTH_PASSWORD_HASH (argon2id) de uma senha. A senha é lida sem eco no
// terminal (ou da entrada padrão, num pipe), nunca como argumento: não fica no
// histórico do shell. Recusa menos de 16 caracteres. Uso (em backend/):
//   node scripts/hash-senha.mjs
// A senha de produção é gerada assim no PC do desenvolvedor e só o hash vai
// para o painel da hospedagem; a TEST_PASSWORD do .env de dev é outra
import argon2 from 'argon2'

const MIN_LENGTH = 16

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    process.stderr.write(prompt)
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')
    let text = ''
    const done = (fn) => {
      input.setRawMode(false)
      input.pause()
      input.removeListener('data', onData)
      process.stderr.write('\n')
      fn()
    }
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(text))
        if (ch === '\u0003') return done(() => reject(new Error('cancelado')))
        if (ch === '\u0008' || ch === '\u007f') text = text.slice(0, -1)
        else if (ch >= ' ') text += ch
      }
    }
    input.on('data', onData)
  })
}

async function readPiped() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text.replace(/\r?\n$/, '')
}

try {
  let password
  if (process.stdin.isTTY) {
    password = await readHidden('Senha (não aparece): ')
    if ((await readHidden('De novo: ')) !== password)
      throw new Error('as duas não conferem')
  } else {
    password = await readPiped()
  }
  if ([...password].length < MIN_LENGTH) {
    throw new Error(`a senha precisa de pelo menos ${MIN_LENGTH} caracteres`)
  }
  if (process.env.TEST_PASSWORD && password === process.env.TEST_PASSWORD) {
    throw new Error('essa é a TEST_PASSWORD do .env de dev: use outra')
  }
  console.log(await argon2.hash(password, { type: argon2.argon2id }))
} catch (err) {
  console.error(`Nada gerado: ${err.message}`)
  process.exitCode = 1
}
