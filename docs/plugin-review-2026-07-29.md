# Plugin review — 2026.0.43

Everything below was built on 28 July and **has not been run in Premiere yet**.
Nothing is signed: the `.zxp` is not built, waiting on your go.

**Do this first:** run `premiere/ae/build_ocha_mogrts.jsx` in After Effects. It
now builds a 7th element (Vignette), so it writes 28 MOGRTs instead of 24.
Until it runs, the Vignette tile will say "MOGRT not found" — everything else
works without it.

---

## 1. Vignette (new) — needs the AE run

- [ ] Tile appears in the Toolbox, opens a modal with a **Strength** slider (not "Fade"), default 55.
- [ ] Lands on the **top** track — it darkens the picture, so it must sit above the footage.
- [ ] Looks proportional on 9:16, 1:1 and 16:9 — same softness, not a squashed oval on the wide one.
- [ ] Select the clip → the panel's **Amount** and **Size** show up and are editable.
- [ ] Size at 50 = as designed; higher = wider clear centre = subtler.

## 2. Readability gradient — half-width Middle (new) — needs the AE run

- [ ] Pick **Middle** → a boxed **Middle width** row appears under Position (Full width / Left half / Right half). It should be hidden for Bottom, Top and Full screen.
- [ ] **Left half** → a soft cloud over the left side: feathered all round, darkest in the middle, no straight edge down the centre.
- [ ] **Right half** → the mirror of it. *If left and right come out swapped, tell me — that's one sign flip in the builder, not a redesign.*
- [ ] **Full width** still gives the old band across the whole frame.
- [ ] The band and the cloud never appear together (no double-dark patch).
- [ ] Switch position to Bottom after choosing a half, then add — no cloud should survive.
- [ ] Check the cloud on 9:16 and 16:9: it should look proportional, not a squashed oval on the wide one.

## 3. Square → Reel, the doubled subtitles

The real test: **a square sequence that has captions on it.**

- [ ] Make the reel — the subtitles should appear **once**, not twice.
- [ ] The reel is 9:16 with the blurred fill, audio from the front copy only, and the square is untouched.
- [ ] Read the result line. It should be one clean sentence. If it says *"Premiere wouldn't let the script remove the copied caption track"*, tell me — that means it fell back to the old clone path and I need the next fix.
- [ ] Colour is still correct after the reel (this is the sequence that started the washed-out incident).

## 4. Track picker

- [ ] "Track" dropdown under **Add to timeline**, defaulting to **Automatic**.
- [ ] Automatic: lower third / text / location go on **top**; readability gradient goes on the **lowest free** track, i.e. *under* the text.
- [ ] Pick a specific track → the graphic lands exactly there.
- [ ] The list refreshes when you add or remove a video track, and your choice survives the refresh.

## 5. Reset position

This one used to behave like an undo, so test it against the old feel.

- [ ] Add a lower third, drag it well off, press **Reset** → it returns to the **template's designed spot** (left-anchored at the safe margin), not the centre of the frame.
- [ ] Both X and Y reset together, and the sliders show the new values.
- [ ] Try it on an older clip placed with a previous template version — should still reset (falls back to centre for Motion-only clips).

## 6. Fix colour + the warning banner

- [ ] Open an HLG sequence (an iPhone .MOV will do) → an amber banner appears saying it isn't Rec. 709.
- [ ] Banner **stays a banner** — it must not steal focus or pop while you're editing, and it should vanish on a Rec. 709 sequence.
- [ ] **Fix it** opens the modal with the two swatches; the CTA says "Nothing to fix" and is disabled on a sequence that's already correct.
- [ ] Run it → colour corrects, and the result reports no drift. **If it says "other settings also moved", stop and send me that line** — that's the audit catching a lossy write.
- [ ] Cmd+Z undoes it.

## 7. Tidy project

- [ ] Sorts loose media into `01 Footage / 02 Images / 03 Graphics / 04 Audio / 05 Other`.
- [ ] **Sequences do not move.** Bins you made yourself are untouched, and anything already inside a bin stays there.
- [ ] Run it twice — the second run should say there's nothing to tidy, not create duplicate bins.
- [ ] OCHA template items stay where they are.

## 8. Package project

- [ ] Report now says **"N of M relinked"** instead of just a copy count.
- [ ] Deliberately break one link (rename a source file before packaging) → the report should **name** the file and say the package is incomplete.

## 9. Whole-panel sanity

Two of my patches silently failed yesterday and would have made the panel inert —
every listener after the broken one dies. Worth 30 seconds:

- [ ] Every Toolbox tile opens its modal (Reel, Package, Clean, Compress, Gradient, Fix colour, Tidy, Vignette).
- [ ] Tabs switch, the format chip updates when you change sequence, Add to timeline works.
- [ ] Menu opens; version reads **2026.0.43**.

---

## Still open after this round

- **RTL for the plugin.** The web app does right-to-left across all elements; the AE templates still need RTL variants (lower third, text, location, logo) plus a panel toggle. Not started.
- **Caption position** is still not scriptable — the guide templates remain the shipped answer.
- **The `.zxp`** is unbuilt and unsigned until you say so.
