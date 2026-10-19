---
name: "Scholar"
description: "An evidence-first academic workspace organized as a ruled finding aid."
colors:
  archive-ink: "#142126"
  archive-ink-raised: "#1b2c30"
  folio-rule: "#324347"
  folio-text: "#a5b8b5"
  folio-meta: "#8fa9a6"
  paper: "#f8f9f5"
  shelf: "#e7ebe7"
  index-paper: "#eef1ed"
  paper-strong: "#dfe6e2"
  evidence-paper: "#f3f3ee"
  control-paper: "#ffffff"
  graphite: "#172326"
  folio-muted: "#60716f"
  folio-muted-strong: "#455957"
  rule: "#c8d1cd"
  rule-strong: "#9dafaa"
  petrol: "#315d68"
  petrol-deep: "#264a53"
  petrol-ink: "#234f49"
  petrol-wash: "#dce8e3"
  oxidised-red: "#a84732"
  red-wash: "#f1ded8"
  citation-ink: "#873324"
  amber: "#9b681c"
  amber-wash: "#f3e8d6"
  danger: "#aa3426"
  success: "#356d5b"
typography:
  display:
    fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif'
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif'
    fontSize: "25px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: 'Georgia, "Times New Roman", "Songti SC", serif'
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: '"Segoe UI", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
  label:
    fontFamily: '"Segoe UI", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif'
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.05em"
  mono:
    fontFamily: '"Cascadia Code", ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
rounded:
  square: "0px"
  record: "1px"
  control: "2px"
  scrollbar: "8px"
spacing:
  hairline: "1px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  xxl: "24px"
  xxxl: "34px"
components:
  button-primary:
    backgroundColor: "{colors.petrol}"
    textColor: "{colors.control-paper}"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.petrol-deep}"
    textColor: "{colors.control-paper}"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.record}"
    padding: "0 13px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.petrol-wash}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.record}"
    padding: "0 13px"
    height: "36px"
  icon-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.record}"
    size: "34px"
  tag-status:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.folio-muted-strong}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "27px"
  input-search:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.record}"
    padding: "0 10px"
    height: "38px"
    width: "100%"
  nav-folio-active:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.record}"
    padding: "0 9px"
    height: "43px"
  model-mode-active:
    backgroundColor: "{colors.petrol}"
    textColor: "{colors.control-paper}"
    rounded: "{rounded.square}"
    padding: "0 8px"
    height: "27px"
  evidence-entry:
    backgroundColor: "{colors.evidence-paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.square}"
    padding: "13px 12px 11px 29px"
    width: "100%"
  table-register-header:
    backgroundColor: "{colors.index-paper}"
    textColor: "{colors.folio-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "12px 14px"
---

# Design System: Scholar

## Overview

**Creative North Star: "The Finding Aid"**

Scholar is an Operate surface organized as a working special-collections finding aid. The visual world is built from archival order rather than paper decoration: cool paper planes, a dark folio index, hairline rules, accession tables, numbered entries, and one oxidised-red evidence key. The interface should make the evidence trail feel inspectable before it makes the archive metaphor visible.

The system alternates between two registers. The dark navigation register frames the product and makes every workspace folio visible at once. The paper register carries the task itself with dense, quiet metadata, serif emphasis, and ruled lists. A pale green shelf tone separates the app ground from white control surfaces, while petrol handles actions and selection. Oxidised red is reserved for provenance, focus, and the active folio numeral.

The archive reference stops at structure. There are no textures, torn edges, faux page shadows, ornamental stamps, or period furniture. The world contributes type, palette, density, and one signature move: numbered evidence linked between answer, register, and keyboard focus.

**Key Characteristics:**

- Dark archival navigation beside a cool paper work surface.
- One-pixel rules, square corners, and ruled register rows instead of card stacks.
- Numbered folio navigation and numbered evidence entries.
- Georgia for editorial emphasis; Segoe UI for controls and operational metadata.
- Petrol for actions and selection; oxidised red only for the evidence trail and focus.
- Flat surfaces, restrained loading motion, and no hover-only actions.

## Colors

The palette is a cool paper archive with one petrol action family and a single oxidised-red provenance signal. Frontmatter token names are normative.

### Primary

- **Oxidised Red:** The evidence key. Use it for the evidence rail line, citation numbers, active folio numerals, selection marks, and focus outlines. It is not a generic primary button color.
- **Red Wash:** The quiet citation field. Use it behind citation markers, page badges, and selected text, with Citation Ink for small text.

### Secondary

- **Petrol:** The action and selection color. Use it for primary buttons, selected model modes, active controls, healthy service icons, and graph reference nodes.
- **Deep Petrol:** The pressed and hover state for petrol controls.
- **Petrol Ink:** The accessible text color on petrol washes and notices.
- **Petrol Wash:** The selected-row, success-notice, and active-control ground.

### Tertiary

- **Citation Amber:** The graph citation and insufficient-evidence signal. Use it for the citation graph's diamond nodes and insufficient verdicts.
- **Amber Wash:** The corresponding quiet status field.

### Neutral

- **Archive Ink:** The dark navigation and authentication cover.
- **Archive Ink Raised:** Hover and raised control ground inside the dark folio rail.
- **Folio Rule:** Dividers and borders inside dark navigation.
- **Folio Text:** Primary navigation labels on Archive Ink.
- **Folio Meta:** Secondary account and language labels on Archive Ink.
- **Paper:** Main headers, record surfaces, and the central conversation plane.
- **Shelf:** The application ground and active folio ground.
- **Index Paper:** Secondary headers, table heads, and quiet control fields.
- **Paper Strong:** Progress tracks and structural fills.
- **Evidence Paper:** The evidence register and graph inspector ground.
- **Control Paper:** Inputs and type-on-white controls only.
- **Graphite:** Primary text and ink-heavy iconography.
- **Folio Muted:** Secondary body metadata.
- **Folio Muted Strong:** Labels and metadata requiring stronger contrast.
- **Rule:** Standard one-pixel separators.
- **Rule Strong:** Register boundaries, input strokes, and table edges.
- **Danger:** Errors and destructive actions, always paired with text or an icon.
- **Success:** Reserved semantic success color; in the current shipped system healthy service state primarily uses Petrol.

**The Evidence Red Rule.** Oxidised Red belongs to provenance and focus. Do not use it for ordinary primary actions, broad backgrounds, or decorative emphasis.

**The Two-Register Rule.** Dark navigation and paper work surfaces are distinct registers. Do not turn operational panels into dark inset cards; keep the paper register continuous.

**The Control White Rule.** Control Paper is for text fields and white control interiors. It is not the default page background.

## Typography

**Display Font:** Georgia with Times New Roman and Songti SC fallbacks  
**Body Font:** Segoe UI with Microsoft YaHei and system sans fallbacks  
**Label/Mono Font:** Segoe UI for labels; Cascadia Code for technical values

**Character:** The serif face gives answers, headings, evidence snippets, and metric numerals the authority of a reference edition. The sans face keeps navigation, forms, actions, tables, and technical metadata compact and operational. Both stacks include CJK-capable families so Chinese and English share the same hierarchy.

### Hierarchy

- **Display** (700, 27px/1, -0.025em): Workspace title only. At 720px and below it becomes 23px.
- **Headline** (700, 25px/1.1, -0.02em): Page headers across Documents, Citation Graph, Evidence Audit, Administration, System Status, and Authentication.
- **Title** (700, 13-19px/1.35): Rail titles, section titles, brand wordmark, empty-state prompts, and metric numbers. Use Georgia for editorial titles and Segoe UI when the label is a control.
- **Body** (400, 14px/1.45): Global UI baseline. Assistant prose uses Georgia at 15px/1.72; user messages use Segoe UI at 13px/1.6.
- **Label** (700-800, 9-11px/1.3, 0.04-0.12em): Uppercase roles, table heads, metadata, and compact controls. Nine pixels is the floor.
- **Mono** (400, 10-11px/1.45): Service values, identifiers, invite codes, and technical fields.

**The Two-Measure Rule.** Georgia carries reading and editorial hierarchy; Segoe UI carries operation and metadata. Do not set navigation, form labels, buttons, or dense table controls in serif type.

**The Metadata Floor Rule.** Operational text never drops below 9px. When space is insufficient, remove low-priority metadata or allow horizontal scrolling rather than compressing labels below the floor.

## Layout

The app shell is a 236px dark folio rail plus a fluid main surface. A 214px rail applies at 1040px and below. At 860px and below the shell becomes one column and the folio rail turns into a horizontally scrollable navigation strip. Page headers are 76px high; the workspace header is 82px. Responsive behavior changes structure and information priority, never type scale alone.

The workspace uses a three-column research desk: 258px collection index, a fluid cited conversation, and a 336px evidence register. The primary breakpoints preserve reading order rather than squeezing the columns:

- Above 1220px: `258px / fluid / 336px`.
- 1220px and below: `232px / fluid / 300px`.
- 1180px and below: hide the second-last header tag before hiding a primary control.
- 1040px and below: use `220px / fluid`; move the evidence register below both columns as a full-width 260px band with two evidence columns.
- 720px and below: stack everything as collection index, conversation, then evidence. The document rail becomes a 205px-card horizontal strip capped at 228px high; the conversation keeps at least 520px; evidence becomes one column capped at 340px.
- 860px and below: data surfaces use 16px side padding, tables scroll horizontally with a 720px minimum width, status panels become one column, and authentication removes the archival cover.
- 900px and below: the Citation Graph moves its 310px inspector below the graph and keeps the canvas at least 58vh high.

Data surfaces use a content width of `min(1480px, 100%)`, 24px desktop padding, and 14-38px vertical rhythm. The Evidence Audit workspace uses a 240px history rail plus the report pane. The Citation Graph service uses a fluid graph canvas plus a 310px inspector. Authentication uses a `1.18fr / 0.82fr` cover-to-form split with `clamp(34px, 6vw, 88px)` horizontal form padding.

**The Ordered-Stack Rule.** Mobile composition keeps task order: choose context, perform the central task, inspect evidence or results. Do not preserve a three-column layout below 1040px by shrinking controls or type.

### Motion Restraint

Motion is operational feedback only. Navigation and color transitions use 180ms ease; controls use 160ms ease; progress bars use 350ms ease; loading spinners use 800ms linear; skeletons use a 1300ms shimmer. Smooth scrolling is used to reveal messages and focus an evidence entry. There are no entrance sequences, parallax effects, bouncing controls, or decorative loops.

Any revision that adds motion must also add a `prefers-reduced-motion: reduce` path that removes nonessential transitions and animation, disables smooth scrolling, and keeps loading state legible through text or a static indicator.

## Elevation & Depth

The system is flat by default. Depth comes from tonal planes, one-pixel rules, column boundaries, and the dark-to-light register shift. Tables, dockets, evidence entries, page headers, and navigation never float as cards.

### Shadow Vocabulary

- **Composer Lift** (`0 8px 22px rgba(20, 33, 38, 0.075)`): The sole working-surface shadow, used under the chat composer to separate the input from the answer plane.
- **Reserved Surface Shadow** (`0 18px 46px rgba(20, 33, 38, 0.09)`): Available for exceptional overlays only; not used on standard registers.
- **Service Halo** (`0 0 0 3px rgba(121, 163, 146, 0.16)`): A three-pixel halo around the small local-stack status dot.

**The Rule-Before-Shadow Rule.** First separate with a rule or tonal change. If a shadow is still necessary, use the Composer Lift only; do not give every panel its own elevation.

## Shapes

The form language is square and documentary. Records use 0px or 1px corners; controls use 2px; only scrollbar thumbs use the 8px radius token. Horizontal and vertical rules do most of the structural work. Inputs use full rectangular strokes, selected rows use a filled plane, and evidence numbers use a 23px circular key only because it represents a linked citation marker.

The evidence rail is a vertical oxidised-red line with numbered circular keys. Citation markers are compact ruled counters with no pill radius. The Citation Graph extends the same shape language semantically: seed papers are squares, references are circles, and citations are diamonds.

**The Ruled-Corner Rule.** Prefer a 0-1px corner and a one-pixel rule over a rounded container. Do not use pill-shaped controls or soft card radii to signal affordance.

## Components

### Numbered Folio Navigation

The dark sidebar is a complete product index, not a collapsed tool menu. Each item uses a two-digit counter generated in document order, a 17px Lucide icon, and a direct label. Default items are Folio Text with a Folio Rule top border. Hover raises the background and text. The active item reverses to Shelf ground, Graphite text, Petrol icon, and Oxidised Red counter. On mobile the same items form a horizontally scrollable strip; active state and numbering remain visible.

### Page Headers and Folio Marks

Headers combine a Georgia title, compact sans subtitle, and a short Oxidised Red rule after the workspace title. Metadata tags are 27px high, 2px cornered, and direct-labeled. At narrow widths, remove low-priority tags before controls. The workspace header stacks at 720px, hides its subtitle, and keeps model routing horizontally scrollable.

### Evidence Key Rail

The evidence register uses Evidence Paper, a vertical Oxidised Red line, and one numbered key per entry. Each entry has a top and bottom Rule Strong boundary, a file name with icon, a page badge, a clamped Georgia snippet, and a metadata footer. Opening a citation marker scrolls the matching entry into view and gives it focus. The marker and register entry must always carry the same number. Do not add an evidence entry without a number.

### Buttons

- **Shape:** 0-2px corners, 36px default height, compact 11px bold labels, optional 12-14px icon.
- **Primary:** Petrol ground, Control Paper text, 2px corner, 0 13px horizontal padding. Hover and pressed use Deep Petrol.
- **Secondary:** Paper ground, Rule Strong stroke, Graphite text. Hover moves to Petrol Wash and a Petrol stroke.
- **Icon Button:** 34px square, Paper ground, 1px rule. Hover uses Petrol Wash.
- **Disabled:** Preserve the label and icon; use opacity 0.42-0.55 and the correct disabled cursor. Loading swaps the icon for a spinner without changing width.

### Inputs and Composer

Search fields, select menus, and authentication fields use Control Paper, a Rule Strong one-pixel stroke, and 1-2px corners. Focus moves the border to Petrol and adds a two-pixel Petrol inset underline; global keyboard focus adds a two-pixel Oxidised Red outline with two-pixel offset. The chat composer is a full-width ruled field with 7px internal padding and Composer Lift. Its send control is a 40px Petrol square aligned to the bottom.

### Register Tables and Dockets

Document, administration, audit, hierarchy, and service data use ruled registers. Header cells use Index Paper, Folio Muted, 9-10px uppercase labels, and 0.05em tracking. Rows use one-pixel separators, 11-14px outer padding, and no zebra fill or card wrapper. Bounded tools use a single Rule Strong outline. On narrow screens, tables retain their columns through horizontal scrolling; do not collapse operational columns into ambiguous unlabeled stacks.

### Status, Tags, and Verdicts

Tags are compact bordered labels with direct text. Accent tags use Petrol Wash, Petrol Ink, and a Rule Strong or Petrol-adjacent border. Success, warning, error, contradicted, and insufficient states always combine color with an icon, verdict word, percent, or other text. A colored dot or color change alone is not a state.

### Segmented Model Controls

Auto, Fast, and Deep routing is a joined three-part control. The container uses Index Paper and Rule Strong. Active mode uses Petrol ground and Control Paper text; inactive modes use Folio Muted. Adjacent segments are separated by one-pixel rules, never gaps or pills.

### Citation Graph

The Citation Graph service uses the same palette and type hierarchy in its embedded frame. The graph plane is a quiet paper field; the 310px inspector is Evidence Paper. Metrics use Georgia numerals between top and bottom rules. Selection remains available through the canvas and visible legend. Seed, reference, and citation roles also differ by square, circle, and diamond shape. Loading, disabled, empty, and error states remain text-bearing.

### Authentication Cover

Authentication keeps the dark register on the left and a ruled access form on the right. The cover uses a large Georgia statement and a single Oxidised Red vertical rule; the form uses Control Paper fields, uppercase labels, a full-width Petrol submit control, and a one-pixel header rule. At 860px, the cover disappears and the form becomes the full surface.

### Interactive and System States

- **Hover:** change background, border, or text while preserving layout dimensions.
- **Focus:** a visible two-pixel Oxidised Red outline; inset outlines are used inside the evidence register and graph canvas.
- **Selected:** fill the row or segment with Petrol Wash or Petrol; retain text, icon, numeral, or checkmark.
- **Loading:** use a spinner for a discrete operation and a ruled progress track for indexing progress.
- **Empty:** use plain language within the current register, without illustration or decorative card.
- **Error:** use the red error treatment with text, not color alone.
- **Success and notice:** use Petrol Wash with Petrol Ink and explicit text.
- **Skeleton:** only for content whose geometry is already known; shimmer remains a restrained loading signal rather than an entrance animation.

### Accessibility Contract

- Keyboard focus is always visible through the two-pixel Oxidised Red outline. Evidence cards use an inset focus outline; the graph canvas uses a two-pixel seed-red inset outline.
- Core task state is never conveyed by hue alone. Add text, icon, shape, number, or a checkmark.
- Preserve native buttons, links, labels, selects, and checkboxes. Icons that act alone require an accessible name and title.
- Measured contrast: Graphite on Paper is 15.22:1, Folio Muted on Paper is 4.86:1, Folio Meta on Archive Ink is 6.58:1, and Control Paper on Petrol is 7.25:1. Use Folio Muted Strong, not Folio Muted, on tinted grounds where contrast is marginal.
- Keep the 9px metadata floor and direct labels. Do not rely on hover for disclosure, action, or evidence inspection.
- Preserve Chinese and English without clipping: use the documented CJK font fallbacks, allow wrapping where hierarchy permits, use ellipsis only for file names and secondary metadata, and keep primary actions outside truncation.
- On mobile, the numbered navigation and evidence register remain reachable by touch and keyboard. No critical action may be hidden behind hover.

## Do's and Don'ts

### Do:

- **Do** use one-pixel rules, tonal planes, and column boundaries to establish hierarchy.
- **Do** keep citation markers and evidence entries paired by stable numbers.
- **Do** reserve Oxidised Red for evidence, active folio numerals, selection marks, and focus.
- **Do** use Petrol for primary action, healthy state, and selected controls.
- **Do** keep navigation and controls in compact sans type while letting Georgia carry editorial content and metric numerals.
- **Do** preserve the collection, conversation, evidence order when columns stack.
- **Do** provide explicit labels, icons, and text alongside status colors.
- **Do** use direct labels and standard web controls before archival ornament.

### Don't:

- **Don't** add paper textures, torn edges, faux stamps, decorative shadows, or ornamental archive clutter.
- **Don't** turn ruled registers into floating cards or wrap every section in a rounded container.
- **Don't** use pills, large radii, gradients, or blur effects as generic UI polish.
- **Don't** use Oxidised Red as the main call-to-action color.
- **Don't** use color alone for selection, evidence confidence, service health, errors, or disabled state.
- **Don't** put critical actions behind hover or hide them on mobile.
- **Don't** add motion beyond state feedback and loading without a reduced-motion path.
- **Don't** compress three-column composition below 1040px or reduce operational text below the 9px metadata floor.
