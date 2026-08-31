# Bitburner Augmentation Progression Route

A step-by-step roadmap to take you from a fresh game all the way to unlocking the best end-game corporate Augmentations. This route optimizes hacking multipliers and reputation speeds to bypass long grinds.

> Augmentation names/effects/costs and faction join conditions below are pulled from the game's
> own source (`bitburner-official/bitburner-src`, stable tag `v3.0.1`) — specifically
> `Augmentation/Augmentations.ts` and `Faction/FactionInfo.tsx`. Join-condition numbers assume
> BitNode 1 (a fresh, non-repeat game); some requirements scale with BitNode multipliers on a
> replay. Money and augmentation costs are shown abbreviated (`k`/`m`/`b`) as `faction rep / money`.

---

## 🗓️ Phase 1: The Foundation (Early Game)

**Goal:** Setup basic multipliers, unlock automatic network pathfinding, and boost hacking stats.

### Step 1: Sector-12 (City Faction)

- **Conditions to Join:** Be located in **Sector-12** and have **$15m**.
- **What to buy:**
  - `CashRoot Starter Kit` — 12.5k rep / $125m. Grants $1m starting money and the
    `BruteSSH.exe` program on install (not RAM, despite the name).
  - `Neuralstimulator` — 50k rep / $3b. +2% hacking speed, +10% hacking chance, +12% hacking exp.
- **When to Install/Reset:** Install as soon as you can afford both. This is your first soft reset.

### Step 2: CyberSec

- **Conditions to Join:** Backdoor the `CSEC` server. There's no separate hacking-level gate in
  the join check itself, but CSEC's own root/backdoor requirement (1 open port, hacking skill
  randomized 51–60 per save) is the practical floor — "~Hacking 50+" is a good rule of thumb.
- **What to buy:**
  - `BitWire` — 3.75k rep / $10m. +5% hacking level.
  - `Cranial Signal Processors - Gen I` — 10k rep / $70m. +1% hacking speed, +5% hacking level.
  - `Cranial Signal Processors - Gen II` (needs Gen I) — 18.75k rep / $125m. +2% hacking speed,
    +5% hacking chance, +7% hacking level.
  - `Synaptic Enhancement Implant` — 2k rep / $7.5m. +3% hacking speed (cheapest of the bunch,
    grab it if rep/cash is tight).
  - `Neurotrainer I` — 1k rep / $4m. +10% to every exp gain, hacking included.
- **When to Install/Reset:** Buy these immediately after your first reset, grind CyberSec rep, buy them, and reset again.

---

## 📈 Phase 2: The Reputation & Charisma Boom (Mid Game)

**Goal:** Drastically increase your reputation gain rate so corporate grinding doesn't take days.

### Step 3: Tian Di Hui

- **Conditions to Join:** Have $1m and 50 Hacking level, located in **Chongqing**, **New Tokyo**,
  or **Ishima**.
- **What to buy:**
  - `Social Negotiation Assistant (S.N.A)` — 6.25k rep / $30m. +15% company & faction rep,
    +15% charisma exp, +10% work money.
  - `Nuoptimal Nootropic Injector Implant` — 5k rep / $20m. +20% company rep, +3% charisma.
  - `Speech Enhancement` — 2.5k rep / $12.5m. +10% company rep, +10% charisma.
  - `Speech Processor Implant` — 7.5k rep / $50m. +20% charisma.
  - `Neuroreceptor Manager` (optional QoL, Tian Di Hui only) — 75k rep / $550m. Removes the
    "unfocused" penalty for working a job/faction while not actively focused on it — no stat
    boost, but very convenient once you're multitasking apps/scripts.

### Step 4: Bachman & Associates (First Corp Target)

- **Conditions to Join:** Employed at Bachman & Associates (HQ'd in Aevum) and **400k reputation**
  with the company. "225 Hacking/Charisma" isn't a hard invite gate — it's about climbing
  Bachman's job ladder fast enough to get hired and promoted, which scales per position rather
  than being one fixed number, so treat it as a rough target, not a gate. Infiltration doesn't
  help here — its reputation reward can only be traded to a faction you're *already a member of*,
  so it can't substitute for the initial employment+reputation invite to a corp faction you
  haven't joined yet.
  - *Shortcut:* if you can root+backdoor Bachman's own server (`b-and-a`, hacking skill
    randomized ~900–1150, 5 ports — very late-game), the reputation requirement drops 25% to
    300k. Not realistic this early, but useful to know for a later pass.
- **What to buy:**
  - `SmartJaw` — 375k rep / $2.75b. +50% charisma & charisma exp, +25% company & faction rep.
  - `ADR-V2 Pheromone Gene` — 62.5k rep / $550m. +20% company & faction rep, +10% charisma.
  - `Enhanced Social Interaction Implant` — 375k rep / $1.375b. +60% charisma, +60% charisma exp.
  - `FocusWire` — 75k rep / $900m. +5% to every exp gain, +10% company rep, +20% work money.
- **When to Install/Reset:** **Crucial Step.** Grind Bachman until you have these. Once installed, your Charisma and future Faction reputation speeds are permanently supercharged.

---

## 🚀 Phase 3: The Hacking Power Push (Late-Mid Game)

**Goal:** Scale your Hacking Level toward the very high requirements the endgame servers demand —
Fulcrum's own server needs hacking randomized **~1,100–1,600** per save (see Step 8), and the
final `w0r1d_d43m0n` server needs a flat **3,000**.

### Step 5: NiteSec

- **Conditions to Join:** Backdoor the `avmnite-02h` server — hacking randomized **202–220** per
  save, 2 ports.
- **What to buy:**
  - `CRTX42-AA Gene Modification` (NiteSec only) — 45k rep / $225m. +8% hacking level, +15%
    hacking exp.
  - `Neural-Retention Enhancement` (NiteSec only) — 20k rep / $250m. +25% hacking exp.
  - `Neurotrainer II` — 10k rep / $45m. +15% to every exp gain, hacking included.
  - `Artificial Synaptic Potentiation` — 6.25k rep / $80m. +2% hacking speed, +5% hacking chance,
    +5% hacking exp. (Also sold by The Black Hand, below.)
  - `Cranial Signal Processors - Gen III` (needs Gen I+II) — 50k rep / $550m. +2% hacking speed,
    +15% hacking money, +9% hacking level. (Also sold by The Black Hand.)
  - `DataJack` — 112.5k rep / $450m. +25% hacking money. (Also sold by The Black Hand.)
  - `Embedded Netburner Module` — 15k rep / $250m. +8% hacking level. Cheap now, and a
    **prerequisite** for the big Fulcrum/ECorp modules in Phase 4 — worth grabbing early. (Also
    sold by The Black Hand.)
- **When to Install/Reset:** Grab the NiteSec-exclusive augs plus whatever shared ones you can
  afford, then move on to The Black Hand rather than resetting here — the two factions' hacking
  augs are meant to be stacked together before your next install.

### Step 6: The Black Hand

- **Conditions to Join:** Backdoor the `I.I.I.I` server — hacking randomized **340–365** per
  save, 3 ports.
- **What to buy:**
  - `The Black Hand` (Black Hand only) — 100k rep / $550m. +10% hacking level, +2% hacking
    speed, +10% hacking money, +15% strength/dexterity.
  - `Cranial Signal Processors - Gen IV` (needs Gen I+II+III) — 125k rep / $1.1b. +2% hacking
    speed, +20% hacking money, +25% hacking grow.
  - `Enhanced Myelin Sheathing` — 100k rep / $1.375b. +3% hacking speed, +10% hacking exp, +8%
    hacking level. (Also sold by Fulcrum Secret Technologies later, but available here much
    earlier and cheaper.)
  - Anything you skipped from NiteSec's shared list above (`Artificial Synaptic Potentiation`,
    `Cranial Signal Processors - Gen III`, `DataJack`, `Embedded Netburner Module`) is sold here too.
- **When to Install/Reset:** Accumulate these massive hacking stat augmentations together with
  NiteSec's. Install them to jump your Hacking level straight into the high hundreds.

### Step 7: Volhaven & OmniTek Incorporated (Optional Boost)

- **Conditions to Join:** Employed at OmniTek Incorporated (HQ'd in Volhaven) and **400k
  reputation** with the company — same `CorpFactionRepRequirement` constant as every other corp
  faction. No separate hacking-level gate in the invite check itself; same caveat on "225
  Hacking" as Bachman above.
- **What to buy:**
  - `OmniTek InfoLoad` (OmniTek only) — 625k rep / $2.875b. +20% hacking level, +25% hacking exp.
- **When to Install/Reset:** Only grab this if your Hacking level is slowing down before hitting the Fulcrum requirements.

---

## 👑 Phase 4: The End Game Targets

**Goal:** Break the economy and unlock the final server backdoor.

### Step 8: Fulcrum Secret Technologies (Second Corp Target)

- **Conditions to Join (all required together, not either/or):**
  1. Employed at Fulcrum Technologies (Aevum) with **400k reputation** with the company (drops
     to 300k if you've separately backdoored the `fulcrumassets` server — a 25% discount).
  2. Backdoor the `fulcrumassets` server itself — hacking randomized **~1,100–1,600** per save,
     5 ports. This isn't an alternative to condition 1 — you need both at once.
- **What to buy:**
  - `PC Direct-Neural Interface NeuroNet Injector` (needs PC DNI, Fulcrum only) — 1.5M rep / $7.5b.
    **+100% company rep** (doubles it), +10% hacking level, +5% hacking speed. The single best
    rep-gain augment in the game if you're still grinding a corp faction.
  - `PC DNI Optimization Submodule` (needs PC DNI) — 500k rep / $4.5b. +75% company rep, +10%
    hacking level.
  - `Embedded Netburner Module Analyze Engine` (needs ENM) — 625k rep / $6b. +10% hacking speed.

### Step 9: Daedalus (The Red Pill)

- **Conditions to Join:** All of the following together:
  1. **30 augmentations already installed** (BitNode 1's `DaedalusAugsRequirement`; scales with
     BitNode multipliers on a replay).
  2. **$100b** cash on hand.
  3. Either **2,500 Hacking**, or **1,500 in every combat stat** (str/def/dex/agi) — the combat
     route exists but isn't relevant to this hacking-focused route.
- **What to buy:**
  - `The Red Pill` — **2.5M rep / $0**. Absolutely essential. Allows you to backdoor the final
    `w0r1d_d43m0n` server to beat the BitNode. The rep cost is one of the steepest in the game,
    even though it's free in money.
- **When to Install/Reset:** Do **not** reset immediately after buying this unless you have other augmentations you want to lock in. It stays active until you choose to use it.

### Step 10: ECorp (Final Target)

- **Conditions to Join:** Employed at ECorp (Aevum) and **400k reputation** with the company
  (drops to 300k with an `AevumECorp` server backdoor, same 25% discount as Step 8).
- **What to buy:**
  - `ECorp HVMind Implant` (ECorp only) — 1.5M rep / $5.5b. Triples (×3) your hack `grow()`
    power — effectively +200% grow.
  - `Social Dynamics Processor` (MegaCorp/ECorp/OmniTek) — 225k rep / $1.2b. +10% charisma, +30%
    company rep — useful if you're still grinding ECorp rep for HVMind itself.
- **When to Install/Reset:** This is your victory lap augmentation. Buy it, install it, and use its grow power to generate trillions of dollars while you prepare to hack the final server.

---

## 💡 Summary Order of Operations

1. **Sector-12** (Early Cash + BruteSSH.exe) ➔ **Reset 1**
2. **CyberSec** (Early Hack Multipliers) ➔ **Reset 2**
3. **Tian Di Hui** + **Bachman & Associates** (Reputation & Charisma Multipliers) ➔ **Reset 3**
4. **NiteSec** + **The Black Hand** + **OmniTek** (Massive Hacking Level Push) ➔ **Reset 4**
5. **Fulcrum** (rep multipliers) + **Daedalus** (Get "The Red Pill", needs 30 augs/$100b/2500
   hacking already banked) + **ECorp** (Get "HVMind Implant") ➔ **Final Run to Victory**
