import type { DarknetServerDetails, NS } from '@ns'

type CrackCondition = (server: DarknetServerDetails) => boolean
interface CrackAlgo {
  conditions: CrackCondition[] | CrackCondition
  // `server` is passed in so a solve() never has to re-fetch what findAlgo()
  // already fetched to pick it in the first place.
  solve: (ns: NS, hostname: string, server: DarknetServerDetails) => Promise<string | null>
}

/** Pulls every digit out of a string, in order — e.g. "4#:<7;/2╬5" -> "4725". */
function extractDigits(str: string): string {
  return str.replace(/\D/g, '')
}

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

/** "CIV" -> 104. No validation of malformed numerals — garbage in, garbage out. */
function romanToDecimal(roman: string): number {
  let total = 0
  for (let i = 0; i < roman.length; i++) {
    const current = ROMAN_VALUES[roman[i]]
    const next = ROMAN_VALUES[roman[i + 1]]
    total += (next && current < next) ? -current : current
  }
  return total
}

/** All distinct permutations of a string's characters — e.g. "123" -> 6 candidates, "112" -> 3 (deduped). */
function permutations(str: string): string[] {
  if (str.length <= 1)
    return [str]
  const seen = new Set<string>()
  for (let i = 0; i < str.length; i++) {
    const rest = str.slice(0, i) + str.slice(i + 1)
    for (const tail of permutations(rest))
      seen.add(str[i] + tail)
  }
  return [...seen]
}

/**
 * Decodes a whitespace-separated run of 8-bit binary octets into ASCII —
 * some heartbleed log lines come back this way. Returns null if the line
 * doesn't look like binary at all, rather than a garbage decode.
 */
function decodeBinaryAscii(line: string): string | null {
  const octets = line.trim().split(/\s+/)
  if (octets.length === 0 || !octets.every(o => /^[01]{8}$/.test(o)))
    return null
  return octets.map(o => String.fromCharCode(Number.parseInt(o, 2))).join('')
}

/**
 * Mastermind-style scoring of a guess against a candidate secret of the same
 * length: how many positions match exactly, and (of the rest) how many
 * characters are present but in the wrong position. Standard duplicate
 * handling — a repeated character in the guess only scores once per
 * matching occurrence left in the candidate.
 */
function scoreGuess(guess: string, candidate: string): { exact: number, partial: number } {
  let exact = 0
  const guessLeft: string[] = []
  const candLeft: string[] = []
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === candidate[i]) {
      exact++
    }
    else {
      guessLeft.push(guess[i])
      candLeft.push(candidate[i])
    }
  }
  let partial = 0
  for (const ch of guessLeft) {
    const idx = candLeft.indexOf(ch)
    if (idx !== -1) {
      partial++
      candLeft.splice(idx, 1)
    }
  }
  return { exact, partial }
}

interface AttemptLogEntry {
  data?: string
  passwordAttempted?: string
}

/**
 * Parses one heartbleed log line as an attempt-feedback record — null for
 * anything else (heartbeat noise, flavor quotes). Shared by every model
 * whose feedback only shows up in the server's own log rather than on
 * authenticate()'s own return value (DeepGreen, NIL, ...).
 */
function parseAttemptLog(line: string): AttemptLogEntry | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as AttemptLogEntry).passwordAttempted === 'string')
      return parsed as AttemptLogEntry
  }
  catch {
    // not a JSON log line — ignore
  }
  return null
}

/** Pulls "exact,partial" feedback out of a parsed log entry, or null if it's not there/not numeric. */
function deepGreenFeedback(entry: AttemptLogEntry): { exact: number, partial: number } | null {
  if (typeof entry.data !== 'string')
    return null
  const [exact, partial] = entry.data.split(',').map(Number)
  return (Number.isNaN(exact) || Number.isNaN(partial)) ? null : { exact, partial }
}

/** Filters a DeepGreen candidate list down using every guess/feedback pair already sitting in a batch of log lines. */
function narrowFromDeepGreenLogs(candidates: string[], logs: string[], passwordLength: number): string[] {
  let narrowed = candidates
  for (const line of logs) {
    const entry = parseAttemptLog(line)
    if (!entry || !entry.passwordAttempted || entry.passwordAttempted.length !== passwordLength)
      continue
    const feedback = deepGreenFeedback(entry)
    if (!feedback)
      continue
    const guess = entry.passwordAttempted
    narrowed = narrowed.filter((c) => {
      const score = scoreGuess(guess, c)
      return score.exact === feedback.exact && score.partial === feedback.partial
    })
  }
  return narrowed
}

// Weak/default passwords worth trying verbatim before giving up — filtered
// per-server by passwordLength/passwordFormat before use.
const COMMON_PASSWORDS = [
  'admin',
  'password',
  '0000',
  '12345',
  // FROM: login.data.txt
  'pass',
  'maggie',
  '159753',
  'aaaaaa',
  'ginger',
  'princess',
  'joshua',
  'cheese',
  'amanda',
  'summer',
  'love',
  'ashley',
  '6969',
  'nicole',
  'chelsea',

  // 'pass',
  // 'letmein',
  // 'default',
  // 'root',
  // 'guest',
  // 'changeme',
  // '0000',
  // '1111',
  // '1234',
  // '12345',
  // '123456',
]

// "It's my dog's name" style hints — confirmed lowercase (Laika4 -> "fido").
const COMMON_DOG_NAMES = [
  // FROM: dog-name-ideas.lit
  'fido',
  'spot',
  'max',
  'rover',
  // 'rex',
  // 'milo',
  // 'zeus',
  // 'toby',
  // 'jack',
  // 'duke',
  // 'bear',
  // 'buddy',
  // 'rocky',
  // 'bella',
  // 'lucy',
  // 'daisy',
  // 'coco',
  // 'luna',
  // 'teddy',
  // 'oscar',
  // 'leo',
]

/**
 * Scans one heartbleed log line for a token that could plausibly be this
 * server's password: right length, and (for numeric servers) all-digit once
 * punctuation/garbage is stripped — the same shape CloudBlare(tm)'s static
 * `data` hint already comes in as.
 */
function candidateFromLine(line: string, server: DarknetServerDetails): string | null {
  if (server.passwordFormat === 'numeric') {
    const digits = extractDigits(line)
    if (digits.length === server.passwordLength)
      return digits
  }
  // alphabetic/alphanumeric/ASCII/unicode logs aren't a known shape yet —
  // nothing reliable to extract until a model using one of those turns up.
  return null
}

const CRACK_ALGOS: CrackAlgo[] = [
  {
    // Bare empty-password case, plus ZeroLogon's hint ("I didn't set a
    // password") saying the same thing explicitly even where passwordLength
    // might not read as 0.
    conditions: [
      serv => serv.passwordLength === 0,
      serv => serv.modelId === 'ZeroLogon',
    ],
    async solve(ns, host) {
      // A genuinely empty password should be deterministic, but
      // getDarknetInstability()'s own authenticationTimeoutChance means
      // even a correct guess can time out under enough backdooring — a few
      // retries is nearly free for a single blank authenticate() call, and
      // logging every failure's real code/message (never surfaced before)
      // means if it's something other than a timeout, that's now visible
      // instead of just falling through to a generic "no algo succeeded".
      for (let round = 0; round < 3; round++) {
        const result = await ns.dnet.authenticate(host, '')
        if (result.success)
          return ''
        console.log(`dnet-probe/auth$ ZeroLogon [${host}] empty-password attempt ${round + 1}/3 failed:`, result, ns.dnet.getDarknetInstability())
      }
      return null
    },
  },
  {
    // DeskMemo_3.1 always just states the password, but the phrasing varies
    // per server ("The key is 461" / "It's set to 777" / "The PIN is 755") —
    // matched on modelId, not a specific hint template, and pulls whatever
    // number shows up anywhere in the hint rather than a fixed position.
    conditions: serv => serv.modelId === 'DeskMemo_3.1',
    async solve(ns, host, server) {
      const match = server.passwordHint.match(/\d+/)
      if (!match)
        return null
      const result = await ns.dnet.authenticate(host, match[0])
      return result.success ? match[0] : null
    },
  },
  {
    // "the password is the base 13 number 266 in base 10", data "13,266"
    // -> parseInt("266", 13) in decimal
    conditions: serv => serv.modelId === 'OctantVoxel',
    async solve(ns, host, server) {
      const [base, value] = server.data.split(',')
      if (!base || !value)
        return null
      const password = Number.parseInt(value, Number(base)).toString()
      const result = await ns.dnet.authenticate(host, password)
      return result.success ? password : null
    },
  },
  {
    // data "4#:<7;/2╬5" -> digits only, "4725"
    conditions: serv => serv.modelId === 'CloudBlare(tm)',
    async solve(ns, host, server) {
      const password = extractDigits(server.data)
      if (password.length !== server.passwordLength)
        return null
      const result = await ns.dnet.authenticate(host, password)
      return result.success ? password : null
    },
  },
  {
    // "The password is the value of the number 'CIV'" -> Roman numeral -> decimal
    conditions: serv => serv.modelId === 'BellaCuore',
    async solve(ns, host, server) {
      const match = server.passwordHint.match(/'([IVXLCDM]+)'/)
      if (!match)
        return null
      const password = romanToDecimal(match[1]).toString()
      const result = await ns.dnet.authenticate(host, password)
      return result.success ? password : null
    },
  },
  {
    // "The password is shuffled 123" -> right digits, wrong order — the
    // digit count seen so far (3) keeps this to 6 permutations, but this
    // grows factorially, so it could get expensive on a longer password.
    conditions: serv => serv.modelId === 'PHP 5.4',
    async solve(ns, host, server) {
      const digits = extractDigits(server.passwordHint)
      if (digits.length !== server.passwordLength)
        return null
      for (const candidate of permutations(digits)) {
        const result = await ns.dnet.authenticate(host, candidate)
        if (result.success)
          return candidate
      }
      return null
    },
  },
  {
    // "The password is a number between 0 and 100" -> brute-force the range,
    // zero-padded to passwordLength (e.g. "00".."99" for length 2).
    conditions: serv => serv.modelId === 'AccountsManager_4.2',
    async solve(ns, host, server) {
      const match = server.passwordHint.match(/between (\d+) and (\d+)/)
      if (!match)
        return null
      const lo = Number(match[1])
      const hi = Number(match[2])
      for (let n = lo; n <= hi; n++) {
        const candidate = n.toString().padStart(server.passwordLength, '0')
        const result = await ns.dnet.authenticate(host, candidate)
        if (result.success)
          return candidate
      }
      return null
    },
  },
  {
    // "It's still the factory settings" / "I never changed the password" /
    // "The default password is set" -> try common weak/default passwords,
    // filtered to this server's actual length + character set. heartbleed
    // has also come back with an ASCII-over-binary log line here — decoded,
    // one read "jump3R is a liar", which reads as steering AWAY from a
    // candidate rather than handing one over, so it's only surfaced via
    // ns.print for a human to judge, not auto-tried as a password yet.
    conditions: serv => serv.modelId === 'FreshInstall_1.0',
    async solve(ns, host, server) {
      const candidates = COMMON_PASSWORDS.filter((p) => {
        if (p.length !== server.passwordLength)
          return false
        if (server.passwordFormat === 'numeric')
          return /^\d+$/.test(p)
        if (server.passwordFormat === 'alphabetic')
          return /^[a-z]+$/i.test(p)
        return true
      })
      for (const candidate of candidates) {
        const result = await ns.dnet.authenticate(host, candidate)
        if (result.success)
          return candidate
      }

      const { logs } = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: 3 })
      for (const line of logs) {
        const decoded = decodeBinaryAscii(line)
        if (decoded)
          ns.print(`${host}: heartbleed decoded "${decoded}" — not auto-tried, inspect manually`)
      }
      return null
    },
  },
  {
    // "It's my dog's name" — confirmed manually: "fido", lowercase, for a
    // length-4 instance. modelId ("Laika4") turned out to be flavor, not a
    // spoiler, same as the other name+version-shaped models. Tries a short
    // wordlist of common dog names, filtered to this server's actual length.
    conditions: serv => serv.modelId === 'Laika4',
    async solve(ns, host, server) {
      const candidates = COMMON_DOG_NAMES.filter(name => name.length === server.passwordLength)
      for (const candidate of candidates) {
        const result = await ns.dnet.authenticate(host, candidate)
        if (result.success)
          return candidate
      }
      return null
    },
  },
  {
    // "The password is divisible by 1" is a troll hint — true of every
    // integer. "Factori-Os" points at factors/divisors instead, and the
    // heartbleed log flags numbers distinctly from the noise (heartbeat
    // checks, an unrelated news headline) via "--N--" delimiters. Those
    // numbers' 2-digit divisors don't converge on one clean answer here
    // (868 -> 14/28/31/62, 12345 -> only 15, no divisor shared by both), so
    // rather than commit to one reading, this tries the divisor candidates
    // first, then falls back to an exhaustive brute force of the whole
    // passwordLength-digit range (capped at 4 digits — 10,000 attempts — to
    // keep a longer password from being pathological). Logs whichever
    // candidate actually worked so the real rule can be confirmed later.
    conditions: serv => serv.modelId === 'Factori-Os',
    async solve(ns, host, server) {
      if (server.passwordFormat !== 'numeric' || server.passwordLength > 4)
        return null

      const { logs } = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: 10 })
      const flagged = logs
        .map(line => line.trim().match(/^--(\d+)--$/)?.[1])
        .filter((n): n is string => !!n)
        .map(Number)

      const divisorsOf = (n: number): number[] => {
        const divs: number[] = []
        const max = 10 ** server.passwordLength
        for (let d = 1; d < max; d++) {
          if (n % d === 0)
            divs.push(d)
        }
        return divs
      }

      const hinted = new Set<number>()
      for (const n of flagged) {
        for (const d of divisorsOf(n))
          hinted.add(d)
      }

      const total = 10 ** server.passwordLength
      const fullRange = Array.from({ length: total }, (_, n) => n)
      const tried = new Set<number>()

      for (const n of [...hinted, ...fullRange]) {
        if (tried.has(n))
          continue
        tried.add(n)
        const candidate = n.toString().padStart(server.passwordLength, '0')
        const result = await ns.dnet.authenticate(host, candidate)
        if (result.success) {
          console.log(`dnet-probe/auth$ Factori-Os [${host}] password was "${candidate}" (heartbleed flagged: ${flagged.join(', ') || 'none'})`)
          return candidate
        }
      }
      return null
    },
  },
  {
    // "Only a true master may pass" is a red herring — authenticate()'s own
    // return is just {success, code, message}, no feedback. The Mastermind
    // "exact,partial" scoring for a guess only shows up afterward in the
    // server's own log (heartbleed), keyed by `passwordAttempted`, mixed in
    // with non-JSON noise lines (heartbeat checks, flavor quotes) that get
    // skipped. Existing guess/feedback history already sitting in the log
    // narrows the candidate space for free before any live guess is spent.
    // Only numeric is handled so far, and the candidate space is capped
    // (10^5) to keep a long password from generating a pathological array.
    conditions: serv => serv.modelId === 'DeepGreen',
    async solve(ns, host, server) {
      if (server.passwordFormat !== 'numeric' || server.passwordLength > 5)
        return null

      const total = 10 ** server.passwordLength
      let candidates = Array.from({ length: total }, (_, n) => n.toString().padStart(server.passwordLength, '0'))

      const seed = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: 10 })
      candidates = narrowFromDeepGreenLogs(candidates, seed.logs, server.passwordLength)

      // Named `round`, not `attempt` — a bare local var literally named
      // `attempt` gets statically billed as ns.codingcontract.attempt
      // (10GB!) by Bitburner's RAM analyzer, which matches identifier TEXT
      // anywhere in the reachable file, not real type/role. See CLAUDE.md's
      // "RAM-cost model" section — this is exactly that gotcha, found live.
      for (let round = 0; round < 15 && candidates.length > 0; round++) {
        const guess = candidates[0]
        const result = await ns.dnet.authenticate(host, guess)
        if (result.success)
          return guess

        const { logs } = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: 5 })
        const entry = logs.map(parseAttemptLog).find(e => e?.passwordAttempted === guess)
        const feedback = entry ? deepGreenFeedback(entry) : null

        if (!feedback) {
          // Couldn't confirm this guess's own feedback (log race, or it got
          // pushed out of the capture window) — drop it and keep going
          // rather than narrowing on nothing or giving up outright.
          candidates = candidates.filter(c => c !== guess)
          continue
        }

        candidates = candidates.filter(c => c !== guess && (() => {
          const score = scoreGuess(guess, c)
          return score.exact === feedback.exact && score.partial === feedback.partial
        })())
      }
      return null
    },
  },
  {
    // "you are one who's'nt authorized" — feedback (like DeepGreen) only
    // shows up via heartbleed after the attempt, but it's a per-position
    // "yes"/"yesn't" mask, not an aggregate exact/partial count: guessing
    // the same digit in every position at once reveals, in one shot, every
    // position where that digit belongs. Since each position has exactly
    // one correct digit among 0-9, at most 10 guesses ("00000".."99999",
    // independent of password length) fully determines the password.
    conditions: serv => serv.modelId === 'NIL',
    async solve(ns, host, server) {
      if (server.passwordFormat !== 'numeric')
        return null

      const length = server.passwordLength
      const found: (string | null)[] = Array.from<string | null>({ length }).fill(null)

      for (let digit = 0; digit < 10 && found.includes(null); digit++) {
        const guess = String(digit).repeat(length)
        const result = await ns.dnet.authenticate(host, guess)
        if (result.success)
          return guess

        const { logs } = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: 5 })
        const entry = logs.map(parseAttemptLog).find(e => e?.passwordAttempted === guess)
        if (!entry || typeof entry.data !== 'string')
          continue

        entry.data.split(',').forEach((mark, i) => {
          if (mark.trim() === 'yes')
            found[i] = String(digit)
        })
      }

      if (found.includes(null))
        return null

      const password = found.join('')
      const result = await ns.dnet.authenticate(host, password)
      return result.success ? password : null
    },
  },
  {
    // Genuine buffer overflow, confirmed manually — the per-position
    // "passwordExpected" reveal (same log-scraping trick as NIL) looked
    // exploitable but didn't actually authenticate; submitting a password
    // of exactly *twice* passwordLength does, regardless of content.
    conditions: serv => serv.modelId === 'Pr0verFl0',
    async solve(ns, host, server) {
      const candidate = 'A'.repeat(server.passwordLength * 2)
      const result = await ns.dnet.authenticate(host, candidate)
      return result.success ? candidate : null
    },
  },
  {
    // Fallback for anything with no static hint/data payoff: send a
    // tentative guess to (maybe) stir up server log activity, then
    // heartbleed for whatever came back. Matches every server, so it's
    // only ever actually reached once every cheaper, model-specific algo
    // above has already failed — findAlgo() preserves array order and
    // tryAuth() stops at the first successful solve().
    conditions: () => true,
    async solve(ns, host, server) {
      if (ns.getPlayer().skills.charisma < server.requiredCharismaSkill)
        return null // heartbleed can't scrape logs above your charisma level

      await ns.dnet.authenticate(host, '')
      const { logs } = await ns.dnet.heartbleed(host, { logsToCapture: 5 })

      for (const line of logs) {
        const candidate = candidateFromLine(line, server)
        if (!candidate)
          continue
        const result = await ns.dnet.authenticate(host, candidate)
        if (result.success)
          return candidate
      }
      return null
    },
  },
]

interface DnetPasswordStore {
  [host: string]: string
}

/**
 * Shared, in-memory, session-scoped password memory — reached via the same
 * eval("window") trick every other cross-script-shared namespace in this
 * project uses (see ui/utils/react-globals.ts), NOT src/cgd/store.ts:
 * that module imports React (getWinGlobals) as a real value-level import,
 * which `// cpy` refuses to inline (see plugin/inline-cpy-imports.ts's
 * header comment — cpy-inlined files may only have type-only imports), and
 * dnet-probe.daemon.ts relies on `// cpy`-inlining this whole file to stay
 * self-contained when scp'd to remote hosts. A plain window global sidesteps
 * that entirely. No save-file footprint (unlike the file-per-host approach
 * this replaced) and no `ns.*` cost at all — resets on game reload, which
 * is fine, a lost entry just means re-solving that host once.
 */
function getPasswordStore(): DnetPasswordStore {
  const win = eval('window') as { __dnetPasswords?: DnetPasswordStore }
  if (!win.__dnetPasswords)
    win.__dnetPasswords = {}
  return win.__dnetPasswords
}

function tryRememberedPassword(host: string): string | null {
  return getPasswordStore()[host] ?? null
}

function rememberPassword(host: string, password: string): void {
  getPasswordStore()[host] = password
}

function findAlgo(server: DarknetServerDetails): CrackAlgo[] {
  return CRACK_ALGOS
    // An algo's `conditions` array is OR'd, not AND'd — e.g. ZeroLogon's
    // entry matches on passwordLength === 0 *or* modelId === 'ZeroLogon',
    // not both at once.
    .filter(algo => Array.prototype.concat(algo.conditions)
      .some(it => it(server)))
}

interface AuthResponse {
  type: 'exists' | 'success' | 'failure'
  server: (DarknetServerDetails & { isOnline: boolean })
  password?: string
  error?: string
}

export async function tryAuth(ns: NS, host: string): Promise<AuthResponse> {
  const server = ns.dnet.getServerDetails(host)

  if (server.hasSession) {
    ns.print(`${host}: Already have session`)
    return {
      type: 'exists',
      server,
    }
  }

  // hasSession only reflects THIS PID — a session doesn't survive a script
  // respawn. A password remembered from whoever solved it last time (any
  // process, any PID, this session) lets a fresh process reconnect via
  // connectToSession instead of re-running the whole crack battery. No
  // save-file cost to worry about here (in-memory only, see
  // getPasswordStore's own comment), so unlike a file-based note this
  // isn't restricted to stationary hosts — a stale entry for a host that's
  // since moved/mutated just fails its connectToSession check below and
  // falls through to a normal re-crack.
  const remembered = tryRememberedPassword(host)
  if (remembered !== null) {
    const result = ns.dnet.connectToSession(host, remembered)
    if (result.success) {
      ns.print(`${host}: Reconnected with a remembered password`)
      return {
        type: 'success',
        server,
        password: remembered,
      }
    }
    // Stale entry — fall through to the normal crack battery below.
  }

  const algos = findAlgo(server)

  if (!algos.length) {
    ns.print(`WARN: No algo found for ${host}\n${JSON.stringify(server)}`)
    return {
      type: 'failure',
      server,
      error: `No algo found for ${host}: ${JSON.stringify(server)}`,
    }
  }

  for (const algo of algos) {
    const auth = await algo.solve(ns, host, server)
    // Not `if (auth)` — solve() returns string | null, and ZeroLogon's
    // correct, successful password IS the empty string, which is falsy.
    // Every other model's password is non-empty, which is why only
    // ZeroLogon was ever silently swallowed here.
    if (auth !== null) {
      ns.print(`${host}: Auth successful`)
      rememberPassword(host, auth)
      return {
        type: 'success',
        server,
        password: auth,
      }
    }
  }

  const bleed = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: 10 })
  return {
    type: 'failure',
    server,
    error: `No algo succeeded. Recent logs: ${bleed.logs.join(' | ') || '(none)'}`,
  }
}
