/**
 * Obsidian's REAL rules for the readable-width column, extracted from the
 * installed app rather than approximated.
 *
 * Source: C:/Program Files/Obsidian/resources/obsidian.asar -> /app.css,
 * 637090 bytes, sha256 f612f1e8f36486fa57f3b8bd45f0c848409d5b168002e757a13c6d286a7b4c41
 * (byte-identical to the full-app.css captured for candidate-48170426, so that
 * earlier extract is confirmed genuine). Every block below is a verbatim line
 * slice, cited by line number; none of it is paraphrased.
 *
 * WHAT THE EARLIER FIXTURE GOT WRONG, and why its refutation of candidate 1 is
 * void: it used this repo's ContinuousPinch.test.ts:24 approximation for the
 * structural rules, which has NO `.cm-scroller` rule at all - so it was missing
 * `scrollbar-gutter: stable`, the one declaration that decides whether a
 * scrollbar appearing shifts an auto-centred sizer. It also omitted
 * `.cm-content`'s `padding: 0` and the `.cm-content > *` margin reset.
 *
 * Note for the record: with `scrollbar-gutter: stable` in force the gutter is
 * reserved permanently, so a scrollbar appearing CANNOT move the column in real
 * Obsidian. That is measured here rather than reasoned about.
 */
const REAL_OBSIDIAN_CSS = `
/* app.css:2240 */
body { --file-line-width: 700px; --font-text: monospace; --line-height-normal: 1.5; --caret-color: #000; }
/* app.css:3546-3559 */
.markdown-source-view.mod-cm6.is-readable-line-width .cm-sizer {
  max-width: var(--file-line-width);
  margin-left: auto;
  margin-right: auto;
}
.markdown-source-view.mod-cm6.is-readable-line-width .cm-content {
  max-width: var(--file-line-width);
}
.markdown-source-view.mod-cm6.is-readable-line-width .cm-line {
  max-width: var(--file-line-width);
}
.markdown-source-view.mod-cm6.is-readable-line-width .cm-line.HyperMD-table-row {
  max-width: 100%;
}
/* app.css:3560-3563 */
.markdown-source-view.mod-cm6 .cm-editor {
  flex: 1 1;
  min-height: 0;
}
/* app.css:3573-3577 */
.markdown-source-view.mod-cm6 .cm-scroller {
  font-family: var(--font-text);
  line-height: var(--line-height-normal);
  scrollbar-gutter: stable;
}
/* app.css:3578-3584 */
.markdown-source-view.mod-cm6 .cm-sizer {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  min-height: 100%;
}
/* app.css:3585-3590 */
.markdown-source-view.mod-cm6 .cm-contentContainer {
  flex: 1 1 auto;
  display: flex;
  align-items: stretch;
  overflow-x: visible;
}
/* app.css:3591-3597 */
.markdown-source-view.mod-cm6 .cm-content {
  flex-basis: unset !important;
  width: 0;
  caret-color: var(--caret-color);
  min-height: unset;
  padding: 0;
}
/* app.css:3601-3604 */
.markdown-source-view.mod-cm6 .cm-content > * {
  margin: 0 !important;
  display: block;
}
`;

export default REAL_OBSIDIAN_CSS;
