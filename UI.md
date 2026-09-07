# Settlement Recovery UI system

This file is mandatory for every website, dashboard, or visual-interface change in this repository. Read it completely before implementation.

## Product and audience

Settlement Recovery is an audit surface for hackathon judges, agent builders, and payment engineers. It must make one claim provable at a glance: a paid Lucid task cannot release funds to the worker until a deterministic terminal verdict authorizes KeeperHub, and failure returns the same USDC to the verified x402 payer.

The interface is a calm piece of infrastructure, not a speculative crypto dashboard. Trust comes from explicit custody, identifiers, boundaries, and receipt status—not decoration or security theatre.

## Visual direction

- Use an editorial split between mineral paper and deep estuary ink.
- Archivo Variable carries headings and prose; IBM Plex Mono carries IDs, amounts, state, and receipt evidence.
- Paper and ink are structural. Aqua means verified flow, amber means pending authorization, and coral is reserved for failed, blocked, or refund-triggering evidence.
- Prefer decisive rules, square or lightly eased corners, restrained shadows, and generous whitespace. Do not put a card around every section or nest cards.
- The settlement route is the product image. Lines, nodes, branch labels, and packets must explain what happens.
- Use Lucide for interface icons. Use text labels for Lucid and KeeperHub unless an official mark is sourced; never fabricate company logos.
- Motion must explain a state transition. Respect `prefers-reduced-motion` and keep state understandable without animation.

## Interaction and accessibility

- All controls need visible focus and at least a 44px target.
- Pair color with text, icons, and position.
- Announce demo-path changes through a polite live region.
- Keep labels persistent, use tabular figures, and label fixtures or simulations so they cannot be mistaken for live settlement.
- Compose narrow-phone and tablet layouts intentionally; do not merely shrink the desktop route.

## Required resource review

Use all of these as review lenses, not as permission to mix visual systems:

1. [UI Skills](https://ui-skills.com/) — touch targets, tabular data, balanced text, and anti-generic checks.
2. [Design System Checklist](https://www.designsystemchecklist.com/) — tokens, component states, accessibility, and documentation coverage.
3. [Vibe Prompts](https://vibeprompts.dev/) — reject generic hero, bento, glow, and repetitive-card tropes.
4. [Rauno's interfaces](https://interfaces.rauno.me/) — native semantics, focus, stable typography, and restrained feedback.
5. [COSS UI](https://coss.com/ui/) — accessible Base UI component anatomy.
6. [ReUI](https://reui.io/components) — application-state and data-density references.
7. [Component Gallery](https://component.gallery/) — compare established table, tab, alert, and disclosure anatomy.
8. [Design Systems One](https://designsystems.one/) — disciplined token naming and governance.
9. [Utopia](https://utopia.fyi/) — fluid type and space scales via bounded `clamp()` values.
10. [Open Props](https://open-props.style/) — consistent duration, easing, spacing, and reduced-motion primitives.
11. [Kinetics](https://kinetics.colorion.co/) — motion hierarchy; use one restrained state transition.
12. [Animated Buttons](https://animatedbuttons.colorion.co/) — dependency-free press feedback that respects reduced motion.
13. [Motion Primitives](https://motion-primitives.com/) — spatial continuity reference; do not add a dependency unless coordinated motion needs it.
14. [Icon Creator](https://iconcreator.dev/) — optical consistency across icon size and stroke.
15. [Ibelick backgrounds](https://bg.ibelick.com/) — background restraint; texture may reinforce the ledger surface but never lower contrast.

## Release questions

- Can a judge identify who holds funds before verification?
- Can they distinguish payment tx, Lucid task ID, KeeperHub execution ID, and settlement tx?
- Is the refund recipient visibly bound to the verified x402 payer?
- Is simulation unmistakably different from broadcast and verified receipt?
- Are fixture, testnet, and live evidence labeled correctly?
- Does mobile preserve the money-path narrative?
