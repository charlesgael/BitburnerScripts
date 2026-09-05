# BitNode & Source-File Priority Route

A companion to [`bitburner_progression_route.md`](./bitburner_progression_route.md) — that file is your augmentation
grind *inside* BitNode 1. This one is about what happens *after* you destroy BN1 for the first time: which of the 15
BitNodes to chase next, in what order, and why, so a wrong turn doesn't cost 10x the time it should.

> Source-File descriptions, exact per-level bonus numbers, and BitNode difficulty multipliers below are pulled from
> the game's own source (`bitburner-official/bitburner-src`, stable tag `v3.0.1`) — `BitNode/BitNode.tsx` (both the
> `sfDescription` text and the `getBitNodeMultipliers` switch) and `BitNode/BitNodeMultipliers.ts` (the default = 1
> baseline every multiplier is measured against). Order-of-priority reasoning is pulled from the two official
> recommendation guides shipped in-game (`Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md` and
> `..._comprehensive_guide.md`, dev branch — these are living docs, not versioned to a tag), cross-checked against
> the Steam community discussion ["Most useful bitnodes/source files?"](https://steamcommunity.com/app/1812820/discussions/0/3194742149943289949/).
> As of this writing the game has **15 BitNodes** (not 24 — an older, outdated number that still circulates in some
> community threads).

---

## The two rules nearly everyone agrees on

1. **Always do BitNode 1 first, and clear it more than once.** There is no dissent on this anywhere in the sources
   above. It has zero difficulty modifiers, so it's the easiest place to build and debug your scripts, and its
   Source-File is flatly the strongest per-level bonus in the game (see the table below) with no situational
   caveats attached.
2. **"Do them in numeric order" is called out by name as *the* classic beginner mistake** — the comprehensive guide's
   exact words: *"Doing BitNodes in chronological order (BN1->BN2->BN3->BN4->BN5->etc.) is a classic mistake. Don't
   do that."* Numeric order roughly tracks when each BitNode was *added to the game*, not how hard or useful it is.
   BN8, BN9, BN11, and BN13 in particular are much harder than their low numbers suggest.

Past that, the devs are explicit that **there is no single perfect order** — it depends on which mechanics you enjoy
and how much time you have. What follows is one concrete, opinionated route built from their tier guidance plus your
own codebase's existing synergies (noted inline), not a claim that it's the only correct path.

---

## How the pieces actually fit together

- **A BitNode is one full playthrough** with its own fixed set of difficulty multipliers (visible in the BitVerse
  before you enter one, or in-game on the Stats page once you own Source-File 5). Multipliers below 1 make that
  aspect of the game *harder* than baseline BN1 (default = 1 for everything); above 1 makes it easier.
- **Destroying a BitNode grants (or upgrades) exactly one Source-File**, capped at **level 3** for every BitNode
  except BN12, which has no cap. You do not need to re-buy anything — reaching a higher level just means clearing
  that same BitNode again.
- **Source-File effects are permanent and apply everywhere**, including inside BitNode 1 and future BitNodes,
  regardless of which BitNode granted them (BN4's Singularity RAM discount is the one exception with its own special
  rule — see BN4 below).
- Owning a Source-File does **not** carry over any in-BitNode progress (money, augs, stats) — only the permanent
  bonus. Every new BitNode entry (or augmentation install) still starts most things from scratch.

---

## Priority tiers

| Tier | BitNodes | Why |
|------|----------|-----|
| **S — do this first, repeatedly** | **BN1** | No modifiers at all; strongest per-level Source-File in the game. Non-negotiable first pick. |
| **A — do early, high value for the cost** | **BN5**, **BN10**, **BN2** | Moderate-to-harsh multipliers but the payoff (permanent Intelligence + `Formulas.exe`, Sleeves + Grafting, Gang) pays for itself in every later run. |
| **B — do once you're geared up, situational but strong** | **BN4**, **BN6/BN7**, **BN9** | Genuinely powerful (automation, an alternate win-con, hash economy) but harsh enough, or with a sharp enough gotcha, that going in too early costs more time than it saves. |
| **C — worth doing, no rush** | **BN14**, **BN15**, **BN13**, **BN3** | Real payoffs, but none of them gate progress elsewhere and two of them (14, 15) are playable *before* you ever unlock their BitNode, so there's no urgency. |
| **Endgame / niche — leave for later** | **BN12**, **BN8** | BN12 is an unbounded difficulty ladder you can start trivially (first clear ≈ a free BN1 clone) but shouldn't seriously grind until every other mechanic is unlocked. BN8 is a hard, income-locked detour with a real prerequisite (stock scripting). |
| **F — last, for completion only** | **BN11** | The official guide's own words: "hard, but its rewards are mediocre." Nobody recommends this before the rest. |

---

## The route

Each step assumes you've already run the augmentation grind in `bitburner_progression_route.md` at least through the
BN1 phases relevant to your current stats. "Repo synergy" notes point at infrastructure already in this project that
either needs or benefits from that Source-File.

### 1. BitNode 1 — Source Genesis (repeat to at least SF1.2, ideally SF1.3)

No difficulty modifiers. Source-File 1 raises **all of the player's multipliers** and grants 32GB starting home RAM
on every future BitNode entry:

| Level | Bonus to all multipliers |
|-------|---------------------------|
| 1 | +16% |
| 2 | +24% |
| 3 | +28% |

The comprehensive guide's own framing: going from SF1.1 to SF1.2 alone is roughly equivalent to 8 levels of NeuroFlux
Governor. Repeat this BitNode until you have SF1.2 at minimum — most players just finish it in one more go and take
SF1.3 while they're at it, since nothing else in the game so directly boosts every future run.

### 2. BitNode 5 — Artificial Intelligence

**Multipliers to expect:** hacking money crushed hard (`ScriptHackMoney` 0.15x, `HacknetNodeMoney` 0.2x), starting
security doubled, augmentation costs 2x — moderate, not brutal, and nothing here blocks basic hacking income.

**Source-File 5 grants**, permanently, on top of a scaling hacking-multiplier bonus:
- **Intelligence** — a stat that, uniquely, never resets between BitNodes or installs.
- **Permanent `Formulas.exe`**, even without buying it, in every BitNode from now on.
- `getBitNodeMultipliers()` and BitNode multiplier visibility on the Stats page (this is what lets you actually
  *see* the numbers this whole document is built from, in-game, going forward).

| Level | Hacking-multiplier bonus |
|-------|---------------------------|
| 1 | +8% |
| 2 | +12% |
| 3 | +14% |

Do this early specifically because `Formulas.exe` makes every subsequent BitNode's scripting easier — optimal hack
batch timing, growth/weaken thresholds, all of it — and Intelligence quietly accumulates in the background of every
run after this regardless of what else you're doing.

### 3. BitNode 10 — Digital Carbon (Sleeves + Grafting)

**Multipliers to expect:** broadly harsh — every level-scaling stat (hacking, combat, charisma) cut to 0.35–0.4x,
augmentation money cost 5x. This is one of the harder early-tier picks on paper, but the mechanic itself doesn't
depend on those multipliers being friendly.

**Source-File 10** unlocks the Sleeve and Grafting APIs everywhere, and **each level grants one additional Sleeve**
(you can buy up to 5 more from The Covenant, only inside this BitNode — the last one costs 100 quadrillion dollars,
so budget for a real endgame income source before chasing all of them).

Sleeves matter beyond BN10 itself: they can independently farm karma (needed for Gang outside BN2), independently
generate Bladeburner contracts/operations (BN6/7), and independently study/train/work. **If you plan to use Gang or
Bladeburner heavily in BitNodes other than 2/6/7, getting at least SF10.1 before grinding those mechanics elsewhere
saves a lot of otherwise-serial time** — this is the one real sequencing dependency among the "flexible" BitNodes,
and it's easy to miss since none of the guides state it as a hard rule.

Grafting is also the standing answer to "how do I install augmentations without losing my current run's momentum" —
directly relevant to BN8 below.

### 4. BitNode 2 — Rise of the Underworld (Gang)

**Multipliers to expect:** server hacking money gutted (`ServerMaxMoney` 0.08x) but crime money **tripled** — the
BitNode is explicitly tuned to push you toward Gang instead of hacking for income, so this isn't a real obstacle.

**Source-File 2** unlocks Gang everywhere else once karma drops to −54,000 (a fixed constant in every BitNode), and
raises crime success rate, crime money, and charisma:

| Level | Bonus |
|-------|-------|
| 1 | +24% |
| 2 | +36% |
| 3 | +42% |

The single biggest practical payoff: **inside BitNode 2 specifically, your gang can offer you The Red Pill**,
letting you skip the Daedalus 30-augmentation / $100b / 2500-hacking gate from your existing route file entirely.
Farming karma from scratch is slow — this is why step 3 (Sleeves) is worth having first if you're not doing this as
your very first post-BN1 pick.

### 5. BitNode 4 — The Singularity (do this in full, or not at all, for now)

**Repo synergy:** this project's `src/daemons/train.daemon.ts` (the Trainer app) is already gated on SF4/BitNode-4
Singularity access — see `CLAUDE.md`'s "The `cgd` tiered daemon" section. That automation is sitting built and
waiting for this Source-File specifically.

**The gotcha that makes this an all-or-nothing pick:** using Singularity functions *outside* BitNode 4 costs 16x
their listed RAM without SF4.2, and still 4x without SF4.3. Practically, that means don't bother touching
`ns.singularity` anywhere else until you've cleared BN4 all the way to SF4.3 — three clears in a row, in one push.

| Level | Singularity RAM multiplier outside BN4 |
|-------|------------------------------------------|
| 1 | 16x |
| 2 | 4x |
| 3 | 1x (full price, same as native) |

**Multipliers to expect while inside it:** all experience gain roughly halved, hacking exp cut to 0.4x, work/crime
money cut hard — and this is meaningfully worse with only SF1 banked, so doing BN4 as your very first or second
BitNode (before SF1.2+ softens it) is explicitly called out as harsher than it needs to be. If manual play doesn't
bother you, the guide is blunt that Source-File 4 "is not really important" — skip it and reclaim that time.

### 6. BitNode 6 and/or BitNode 7 — Bladeburner

**Multipliers to expect:** hacking-heavy stats crushed (`HackingLevelMultiplier` 0.35x, hack exp 0.25x) in both —
this is the point, Bladeburner is a deliberately non-hacking win condition.

Do **BN6** first — no Bladeburner-specific penalty modifiers, and its Source-File buffs combat stat level/exp gain:

| Level | Combat stat bonus |
|-------|--------------------|
| 1 | +8% |
| 2 | +12% |
| 3 | +14% |

**BN7** is the harder sibling (it does apply Bladeburner penalty modifiers, plus 2x BladeburnerSkillCost and 2x
FourSigma data cost) but its Source-File buffs Bladeburner multipliers directly, and level 3 grants the "Blade's
Simulacrum" augmentation free the moment you join Bladeburner in any future run — it removes the restriction that
normally stops you doing Bladeburner actions and everything else (working, crime, factions) at the same time.

The reason either matters beyond its own BitNode: Bladeburner is rarely nerfed hard in *other* BitNodes, which makes
it the standing fallback way to grind through the genuinely brutal ones (BN9, BN13) without relying on hacking or
crime income at all. Sleeves (step 3) speed contract/operation generation up substantially if you have them already.

### 7. BitNode 9 — Hacktocracy (Hacknet Servers)

**Multipliers to expect — this is the first BitNode on this list that's genuinely harsh across the board:**
`ServerMaxMoney` 0.01x, home RAM cost 5x, hack exp gain 0.05x, private/cloud servers disabled outright. Don't attempt
this until you've banked several of the earlier Source-Files above — the guide's own advice is to prepare carefully.

**Source-File 9** grants, cumulatively:

| Level | Effect |
|-------|--------|
| 1 | Permanently unlocks Hacknet **Server** (not Node) in other BitNodes |
| 2 | Start with 128GB home RAM on every new BitNode entry |
| 3 | Start with a highly-upgraded Hacknet Server on every new BitNode entry (new-BitNode-entry only, not on aug install) |

plus a straight production/cost multiplier on Hacknet itself (+12% / +18% / +21% per level). SF9.2's free 128GB is a
direct, permanent upgrade to the exact RAM-headroom convention `src/start.ts` already computes off `home`'s max RAM
— worth noting for future runs even though it's not something to chase for that reason alone.

### 8. BitNode 14 — IPvGO Subnet Takeover

**Repo synergy:** you already have a real Go-playing engine at `src/lib/go/` (`heuristic-engine.ts`,
`experimental-engine.ts`) — IPvGO itself is **not locked behind this BitNode**, it's playable from BitNode 1 via
`ns.go`. This is a case where using your existing tooling now, before ever entering BN14, directly derisks the
BitNode later.

**Multipliers to expect:** fairly harsh in general (hack exp gain, rep gain both notably cut) but `GoPower` is 4x —
the BitNode is tuned to make IPvGO itself easy relative to everything else.

**Source-File 14** grants:

| Level | Effect |
|-------|--------|
| 1 | +100% stat multipliers from Node Power |
| 2 | Permanently unlocks `ns.go.cheat` |
| 3 | +25% additive success rate for `ns.go.cheat` |

plus raised caps on favor gained per faction from win streaks (200k/300k/400k rep-equivalent by level) and on rep
converted to favor per two-game win streak (1000/1500/2000). The favor-cap increase is the standout: it meaningfully
shortens the 150-favor grind for IPvGO-affiliated factions in every future run.

### 9. BitNode 15 — The Secrets of the Dark Net

**Repo synergy:** this is the biggest one in the whole route. `darknet.app.ts` and the entire `lib/dnet/` subsystem
(colonization store, `dnet-probe.daemon.ts` self-replication, the TOR filesystem explorer app) already exist and run
against the base darknet mechanic — which, like IPvGO, is **not locked behind BN15**. It's available as soon as
you've bought `DarkscapeNavigator.exe`. Per the official guide's own advice, experimenting with the "basic version"
before tackling BN15 itself is exactly the right move, and you already have working infrastructure to do it with.

**Source-File 15** grants:

| Level | Effect |
|-------|--------|
| 1 | Permanent TOR router + `DarkscapeNavigator.exe`, full dark web, in every BitNode |
| 2 | Charisma boosts job salary/rep gain; +20% authentication speed |
| 3 | Charisma boosts faction work rep gain; +50% xp/money from `.cache` files |

and — notably — **SF15.1 alone unlocks getting The Red Pill via the darknet's deepest lab in every BitNode except
BN8**, which can be faster than the Daedalus 30-aug/$100b/2500-hacking route in `bitburner_progression_route.md` once
you own it. `DaedalusAugsRequirement` is also lowered to 20 inside BN15 itself (vs. the default 30), making Daedalus
easier to reach as a fallback while you're there.

### 10. BitNode 3 — Corporatocracy (optional, high ceiling, high cost)

No particular BitNode needs to come before this one. **Multipliers to expect:** hacking money and growth rate both
gutted (`ServerGrowthRate` 0.2x, `ScriptHackMoney` 0.2x), augmentation costs 3x — but none of that matters if your
corporation script is good, since Corporation income doesn't route through hacking at all.

**Source-File 3** unlocks Corporations in other BitNodes (some BitNodes disable the mechanic regardless) and, at
level 3, permanently unlocks the full API. It also buffs charisma/salary multipliers modestly (+8%/+12%/+14%).
Outside BN3, using Corporation requires $150b in starting capital, so it's not a standalone money-printer on its
own — you still need another income source to get it off the ground the first time.

The honest framing from the comprehensive guide: this mechanic is either loved or hated. A good corp script can
speedrun most other BitNodes; a bad one (or none) makes this the worst use of your time in the game. This project
has no existing Corporation automation, so treat this as a from-scratch investment, not a synergy pick.

### 11. BitNode 13 — They're Lunatics (Stanek's Gift)

**Multipliers to expect — the harshest on this list short of BN9:** `HackingLevelMultiplier` 0.25x, hack exp 0.1x,
most other level-scaling stats at 0.7x. Prepare thoroughly (per the official guide) before entering.

Stanek's Gift itself is a placeable-fragment grid that can buff hacking, hacknet, work/crime income, or combat,
depending on which fragments you place — genuinely versatile, but it also applies a flat 10% penalty to many
multipliers until you buy the Church of the Machine God's two penalty-removal augmentations. **Source-File 13**
unlocks the Church faction (and the Gift itself) in other BitNodes, and each level increases the Gift's grid size.

### 12. BitNode 12 — The Recursion (start it, don't grind it yet)

Unique among all 15: multipliers and rewards both **scale with the Source-File's own level**, which has no cap.
Your **first** clear is effectively a free BN1 clone (harshness starts at level 0) and grants SF12.1, which starts
every future BitNode with that many free NeuroFlux Governor levels already installed. Clear it once whenever
convenient — there's no reason not to. Serious repeated grinding of this BitNode, though, is explicitly an
"unlock everything else first" endgame project: the difficulty compounds by roughly 2% per level with no ceiling,
and staying ahead of it requires every other mechanic in your toolkit.

### 13. BitNode 8 — Ghost of Wall Street (income-locked to the stock market)

**Repo synergy:** this project already has `src/lib/stock-stats/` scaffolding, paused specifically for lack of
in-game TIX API money to test against (see your `stock-stats feature paused` memory). BN8
starts you with $250m and a free WSE + TIX API membership, which is exactly the unblock that work is waiting on —
worth revisiting this BitNode specifically once that scaffolding needs a real environment to run in.

**Multipliers to expect:** every non-stock income source is set to **zero** — company work, crime, Hacknet, manual
hacking money, coding contracts, infiltration, Corporation, Gang, Bladeburner rank, even Darknet money. This isn't
"harsh," it's a hard gate: the stock market (short-selling and limit/stop orders, both unlocked by this BitNode) is
the *only* way to make money here, and hacking/growing a server still moves that server's linked stock price even
though it pays nothing directly. A working pre-4S stock script is a hard prerequisite, not optional prep.

Do **at least BN10.1 (Grafting) first** — the official guide's specific advice — since losing accumulated stock
capital on every reset would otherwise set you back badly each time you want to install an augmentation.

### 14. BitNode 11 — The Big Crash (last, for completion only)

No new mechanic. Source-File 11 makes company favor boost salary as well as reputation, adds a salary/rep multiplier
(+32%/+48%/+56%), and cheapens each successive augmentation purchase slightly (−4%/−6%/−7% price growth). Its own
guide calls this BitNode "hard, but its rewards are mediocre" — nothing here is worth prioritizing ahead of anything
above. Do it last, if at all.

---

## Mistakes worth avoiding (from the official guide + community thread)

- **Going in numeric order.** Called out by name as the single most common beginner mistake — BitNode number tracks
  release order, not difficulty or usefulness.
- **Starting your very first post-BN1 run with BN10.** It's one of the strongest picks on this list, but multiple
  experienced players explicitly warn against opening with it — get basic scripts and income sources established in
  something gentler first.
- **Using `ns.singularity` outside BN4 before SF4.3.** You'll pay 4x–16x RAM for every call. Either finish BN4
  fully in one push, or don't touch Singularity functions elsewhere at all.
- **Farming Gang karma from scratch with no Sleeves.** Not wrong, just slow — get SF10.1 first if Gang outside BN2
  is on your near-term list.
- **Enabling Gang territory clashes too early (or too late).** Too early can lose all your territory outright; too
  late wastes time. There's no fixed number here — watch the in-game hints.
- **Resetting inside BN8 without Grafting.** Every reset without it forfeits accumulated stock capital, which is the
  only income source that BitNode allows in the first place.
- **Treating BN13's or BN14's or BN15's home mechanics as locked behind their BitNode.** Stanek's Gift needs BN13 to
  use elsewhere, but IPvGO (BN14) and the Darknet (BN15) are both playable from BitNode 1 onward — practice with
  the real thing before the BitNode raises the stakes, not after.

---

## Quick-reference: every Source-File's per-level numbers

| SF | BitNode | Unlocks | Level 1 | Level 2 | Level 3 |
|----|---------|---------|---------|---------|---------|
| 1 | Source Genesis | +32GB starting home RAM everywhere | +16% all multipliers | +24% | +28% |
| 2 | Rise of the Underworld | Gang elsewhere (karma ≤ −54,000) | +24% crime succ./money/charisma | +36% | +42% |
| 3 | Corporatocracy | Corporation elsewhere (full API at 3) | +8% charisma/salary | +12% | +14% |
| 4 | The Singularity | Singularity API elsewhere | 16x RAM cost | 4x RAM cost | 1x (native) RAM cost |
| 5 | Artificial Intelligence | Permanent Intelligence + `Formulas.exe` + BN-mult visibility | +8% hacking mults | +12% | +14% |
| 6 | Bladeburners | Bladeburner elsewhere | +8% combat stats | +12% | +14% |
| 7 | Bladeburners 2079 | Bladeburner elsewhere (harder BN) | +8% Bladeburner mults | +12% | +14% + free Blade's Simulacrum |
| 8 | Ghost of Wall St. | WSE/TIX permanently; short/limit orders elsewhere | +12% hacking growth | +18% | +21% |
| 9 | Hacktocracy | Hacknet Server elsewhere | +12% hacknet | +18% + free 128GB home RAM on new BN | +21% + free upgraded Hacknet Server on new BN |
| 10 | Digital Carbon | Sleeve + Grafting API elsewhere | +1 Sleeve | +1 Sleeve | +1 Sleeve |
| 11 | The Big Crash | Favor boosts salary too | +32% salary/rep | +48% | +56% |
| 12 | The Recursion | Free NFG levels = SF level (no cap) | — scales forever, see BN12 section — | | |
| 13 | They're Lunatics | Church of the Machine God elsewhere | Grid size ↑ | Grid size ↑ | Grid size ↑ |
| 14 | IPvGO Subnet Takeover | — | +100% Node Power stat mults | + `ns.go.cheat` unlocked | +25% cheat success |
| 15 | Secrets of the Dark Net | TOR/Darknet permanently everywhere | Full dark web everywhere | Charisma→salary/rep, +20% auth speed | Charisma→faction rep, +50% `.cache` rewards |

---

## Sources

- [`bitnode_recommendation_short_guide.md`](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md) — official in-game guide, dev branch
- [`bitnode_recommendation_comprehensive_guide.md`](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md) — official in-game guide, dev branch
- [`BitNode/BitNode.tsx`](https://github.com/bitburner-official/bitburner-src/blob/v3.0.1/src/BitNode/BitNode.tsx) — `v3.0.1` tag, Source-File text and exact difficulty multipliers
- [`BitNode/BitNodeMultipliers.ts`](https://github.com/bitburner-official/bitburner-src/blob/v3.0.1/src/BitNode/BitNodeMultipliers.ts) — `v3.0.1` tag, default (=1) baseline for every multiplier
- [Steam: "Most useful bitnodes/source files?"](https://steamcommunity.com/app/1812820/discussions/0/3194742149943289949/) — community consensus check, independently agrees with the official guide
