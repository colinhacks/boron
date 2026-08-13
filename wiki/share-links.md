# Share links: the wire format, and why the first attempt was pulled

Share links — the whole workspace encoded into the URL, so a link reopens the exact picture — were built, verified and briefly live. They were then pulled back off `main`. The work is on the `share-links-wire-format` branch; this is the reasoning, so the next attempt starts from it rather than rediscovering it.

## What was built

`?s=<flag><base64url>` carrying a deflated JSON payload of the whole `Workspace` — document, theme id, backdrop id and every frame setting — with a `u`/`z` flag for uncompressed versus raw-DEFLATE. Verified end to end: two isolated browser contexts rendering the same link produced byte-identical PNGs.

## Why it was pulled

**The payload was the internal representation, verbatim.**

```ts
interface SharePayload {
  v: 1;
  doc?: TerminalDocument;   // = LineElement[] — the Slate document
  frame?: FrameSettings;    // = the sidebar's own settings object
  theme?: string;
  bg?: string;
}
```

A URL is a public, permanent interface. Every link anyone has ever sent is a compatibility constraint, and it does not expire, cannot be migrated, and is held by people who will never read a changelog. Putting `TerminalDocument` and `FrameSettings` in one means **the Slate schema and the sidebar's settings object become a published API** — with no seam at which to translate if either ever moves.

The `v: 1` field looks like protection and is not: `decodeWorkspace` returns `null` for anything else, and there is no translation layer, so a `v: 2` would simply break every existing link. A version number only helps if something can migrate across it, and nothing could.

Two concrete pressures, both real and both already happening:

- **`FrameSettings` has no external anchor.** `minColumns` presupposed minimum-width-in-columns as the sizing strategy — and it has since stopped being one: the block is a fixed column count that long lines wrap to, and the field is now `columns`. `shadowStrength: 0-100` encodes one particular scaling of offset, blur and opacity together; `showChrome: boolean` presupposes exactly one window style. Every one of those is a design decision that could reasonably change, and each is frozen the moment a link exists.
- **Backdrop ids already changed meaning.** [backdrop.ts](../src/export/backdrop.ts) made backdrops adapt to the theme, so `bg: "ember"` renders differently than it did the same afternoon. The id survived; the picture did not. That is the whole failure mode in miniature, and it landed within hours of the links going live.

## What is genuinely stable, and what is not

Worth separating, because it decides what a future format should carry.

**Stable, because it is pinned to something outside this repo.** The *content model* — lines of styled runs, seven modifiers that are each exactly one SGR code, colors as one of sixteen names / a 256 index / truecolor. That is ECMA-48, not a Boron decision, and it cannot drift without terminals drifting. `MODIFIER_KEYS` and `Color` say so in the type system.

**Not stable, because it is ours.** The *encoding* of that model. `{ type: "line", children: [...] }` is Slate ceremony — the discriminant carries no information, since every element is a line. Marks-spread-onto-the-leaf is a Slate convention. A different editor would spell the same document differently.

So the risk is encoding risk rather than model risk, which is also why it is tractable: a wire format that describes the stable model, with a mapping to whatever the editor happens to use, does not need to change often.

## The seam now exists — [src/wire.ts](../src/wire.ts)

Option 1 below is built. `WireWorkspaceV1` is made of strings, numbers and booleans and references no editor type; `toWire`/`fromWire` are the only place the two vocabularies meet. Content travels as **ANSI**, because that is the one part of this Boron did not invent — ECMA-48 cannot drift without terminals drifting, and the invariant that every document is expressible in it is now enforced rather than hoped for.

The wire names are deliberately not the internal ones: `padding` not `framePadding`, `titleBar` not `showChrome`, `shadow` not `shadowStrength`, and `columns` — a width in columns is a terminal idea, while whatever the app does with it is ours to change. That last one has already earned its keep: the internal field was `minColumns`, a floor under a block that never wrapped, and when the block became a real fixed width the wire field did not have to move. A test asserts none of the internal names leak into a payload.

Two lossiness bugs that ANSI-as-a-format would otherwise have had, both fixed and both pinned by a test: `parseAnsi` gained a `trimTrailing` option, because trailing spaces take up cells and dropping them moves where a long line wraps; and the content is serialized from raw marks rather than through the `$`-prompt heuristic, which would otherwise freeze one reading of the document.

The base64/URL layer on top is built too, in [src/share.ts](../src/share.ts): `buildShareUrl` behind "Copy link" in the export button, and `consumeSharedWorkspace` on load. So links ship, and this page is the account of why the *first* attempt did not.

## Options that were considered

1. **An explicit frozen wire schema.** `WireDocument`/`WireFrame` types that deliberately never reference `TerminalDocument` or `FrameSettings`, plus `toWire`/`fromWire`. The internal model then moves freely behind the seam. **Chosen.**
2. **ANSI as the content format.** The project's own thesis is that every document is expressible as escape codes, and that is now enforced rather than hoped for. ANSI is externally standardized and human-inspectable, so it is the natural candidate — but note it is *not* quite lossless: `parseAnsi` trims trailing plain spaces and expands tabs, and trailing spaces take up cells, so a round trip can move where a long line wraps. Would need either a raw-marks serializer (today's `toAnsi` bakes the prompt heuristic into explicit marks) or acceptance of that edge.
3. **Ship as-is and keep every old decoder forever.** Cheapest today. The catch is that an old decoder still has to produce a *current* workspace, so the translation layer of option 1 gets written anyway — just later, against a model that has moved, with links already in the wild.

## Whatever ships, back compatibility has to be mechanical

"Be careful forever" is not a mechanism. The thing that actually enforces it is a **frozen corpus**: hand-written literal payload strings checked into the repo alongside their expected decoded workspace, so any change that breaks an old link fails the suite rather than a review.

This repo already has exactly that discipline for a different reason — [clipboard-fixtures.ts](../src/core/clipboard-fixtures.ts) holds real clipboard bytes captured off a real pasteboard, precisely because invented markup only tests your imagination. Share payloads get the same treatment: the `CORPUS` in [wire.test.ts](../src/wire.test.ts) is hand-written literal payloads with their expected decode, never regenerated. Adding an entry is always fine; editing one means you have broken a link. Verified it bites — shifting the SGR 30-37 mapping, dropping the named form for 256-indices 0-15, and moving a frame clamp each make it fail.

## Open questions

- Slate versus ProseMirror: researched, written up in the handoff. Short version — ProseMirror is the more rigorous foundation (declarative schema, closed mark set, 1.x since 2017) and Slate is still 0.x by its author's own description, but migrating would *not* have prevented this problem, because PM's JSON is just as internal. The seam is what prevents it, and it is editor-independent by construction, so the choice stays reversible.
- Whether the frame settings belong in a link at all, or whether a link should carry only content and let the reader's own frame apply.
