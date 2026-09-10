# Handwriting

Handwrite, highlight, erase and lasso directly on your notes and PDFs. Your notes stay Markdown.

Open a note and write. The note stays a `.md` file.

## removing the plugin

your ink is not stored "in" the markdown. it lives in a folder at your vault root, separate from the editor's text.

disable the plugin and your notes STAY EXACTLY THE SAME - the ink just stops rendering. re-enable and it comes back.

one line is written to the invisible frontmatter of a note when you first write on it - `handwriting-page-id`.

a note you never inked on is never modified.

> **ipad**
>
> turn off Scribble or ios will draw its own black ink over your strokes, and its scratch-out gesture may delete ink.
>
> **iPad Settings → Apple Pencil → Scribble → Off**
>
> ios may discard a canvas’s pixels while Obsidian is in the background or memory is limited. this is more likely on long notes containing images or a pdf. the stroke data remains saved and the ink is repainted when you return to Obsidian.

## what it does

Here's a demonstration of some of the features: https://youtu.be/TUeniA9BZcc

### right now you can

* handwrite, highlight, color palette, size sliders
* erase, two modes, size slider
* lasso, compatible with side button; move the selection, delete it, copy/paste it across notes (resize and rotate coming soon)
* insert space tool
* undo/redo ink + text
* draw + pan with the mouse if you want
* write on pdfs
* flatten ink for pdf export
* snip pdfs

### features

* data yours forever
   * your ink is all stored here: your vault's `.handwriting/` folder
   * [what that folder looks like](https://imgur.com/a/60GBWnn)
* pressure sensitivity
* palm rejection
* pen toolbar with auto-hide
* pinch to zoom
* ink prediction + smoothing
* lined, grid, and dotted paper background
* export ink as svg or pdf
* infinite canvas
* ink embeds
* handwriting to shape

### works on

windows · macos · linux · ipad · boox · android

## installing

### method 1 - the community plugin directory

it's in the community plugin directory:

1) Settings
2) Community plugins
3) Browse
4) search Handwriting
5) Install and enable

### method 2 - direct link

can also just get it here:

https://community.obsidian.md/plugins/handwriting

### method 3 - BRAT, for beta builds

if you want beta builds before they're released, use BRAT:

open your Obsidian vault > Settings > community plugins in left side bar

turn ON community plugins > browse

search for BRAT > hit install and enable > click Settings >

Scroll down till you see this and hit the plus in upper right hand

<img width="464" height="167" alt="the BRAT settings panel, with the add-plugin button in the upper right" src="https://github.com/user-attachments/assets/049f790d-7e7f-452b-94ae-36d50f06b6ae" />

paste this in : ellimist-afk/handwriting > hit add plugin

### required

Obsidian 1.12.3 or newer. please send reports.

## using it

### the toolbar

tap a tool in the toolbar to use it: pen, highlighter, eraser, lasso, insert space or pan. pan lets you drag the page with the pen tip. on a narrow pane, some buttons may move behind **More**.

tap the pen, highlighter or eraser again while it is selected to open its controls. press `Esc` or tap outside the popover to close it.

the keyboard button disables pen input so a tap can place the caret and open the on-screen keyboard. `Pen on / off` does the same from the command palette.

this also applies to pdfs. with the pen disabled, taps pass through to the pdf viewer.

#### mouse input

to use the toolbar with a mouse, run `Handwriting: Mouse on / off`.

click a tool to use it with the mouse. click the active tool again to return to the normal cursor.

### eraser modes

the eraser has two modes:

- **stroke** erases the entire stroke
- **reticle** erases only the part beneath the reticle

tap the eraser button to select a mode. stroke is the default.

the eraser button also toggles the eraser on and off. with **Extra commands for hotkeys** enabled, `Toggle eraser on / off` and `Eraser size: next` are available in the command palette.

### colors and quick pens

there is no separate palette button.

tap the pen button to open its size slider, quick pens and 8 pen colors. tap the highlighter button to open the same controls with its 5 highlighter colors.

selecting a color applies it to the corresponding nib and returns to inking from eraser, lasso, insert space or pan. pen colors do not switch to the highlighter, and highlighter colors do not switch to the pen.

### extra commands for hotkeys

enable **Extra commands for hotkeys** in settings to add these commands to the command palette:

- `Ink color: next`
- `Pen color: next`
- `Highlighter color: next`
- `Ink size: next`
- toggles for eraser, lasso, insert space and pan
- `Pen preset 1` through `4`
- `Highlighter preset 1` through `4`
- a save command for each preset slot

each command can be assigned its own hotkey.

the commands are hidden by default because their number makes other Handwriting commands harder to find. disabling the setting removes them from the palette but preserves their hotkey assignments.

### palm rejection

on pdfs, a touch contact too large to be a fingertip is discarded. the heel of a hand produces a larger contact area, which allows it to be distinguished from normal touch input.

notes use a separate, timing-based method.

### pinch zoom

pinch to zoom works on notes and pdfs. the point where the pinch begins remains beneath your fingers while zooming.

### shape snap

hold the pen still for about a third of a second at the end of a stroke to snap it into a line, triangle, rectangle, circle or ellipse.

with a mouse, pause at the end of a stroke and select **Snap**.

### obsidian sync notes

`.handwriting/` is a hidden folder. many sync services do not sync hidden folders by default, including Obsidian Sync, iCloud and Dropbox.

if you use one of these services, enable **Compatibility with Obsidian Sync, iCloud and Dropbox** in Handwriting settings.

## how it works

this is a section dedicated to anyone curious about the mechanisms

### writing

when you put pen to screen, you are writing on an overlay drawn over the Obsidian text editor - this overlay is drawn in codemirror 6

the overlay claims pen input only, by default - touch, typing, selection and caret placement fall through to Obsidian untouched, and so does mouse unless mouse ink is turned on

in terms of risk, the only thing ever written directly by Handwriting is one line - `handwriting-page-id`, added to the invisible frontmatter of your note on the first detected stroke.

### why the ink looks good

a typical pen reports ~200-250 dots/events a second. what other handwriting apps probably do (almost certainly) is draw straight lines between each dot - this is what causes the jaggedness or spikiness on boox or other e-ink devices, also because the pen trembles a bit naturally

what i did is smooth the curve by adding the previous dot into the calculation. this causes bad perceived lag, so i had to replace the last stretch of the curve to the pen tip with a straight line in real time

### where is ink stored

your ink is one json file per note in /.handwriting/

(your vault)/.handwriting/

sidecar is a digital photography term that refers to a small file besides a main file, that holds information about the main file. this is a useful analogy

in this case, the sidecar stores your ink as coordinates - your note is linked to your ink by a single properties line in the properties field of your note. this link + the coordinates tells Obsidian where all the ink is

what this means practically is that no matter what happens to the ink, the text in your note will be safe, as the note itself is not modified (besides its frontmatter).

### where does ink go when deleted

you can use undo (ctrl+z) to get ink back if you accidentally erase/delete it

undo/redo history is bulletproof - should undo/redo actions, erase, strokes, text, in the exact order you did them (this took quite a bit of effort actually).

`Delete all ink` copies the note's ink to `.handwriting/trash/` before it wipes anything, every time. so even the big red button is recoverable.

in one case your ink will be permanently gone - if you delete the `.handwriting` folder itself.

if that was an accident (fat-fingered it, cat walked across the keyboard) check your OS recycle bin or trash first.

that being said, it's just good rule of thumb to always back up your vault!!

you can export your ink as svg or pdf first if you want to load it into other programs.

### how is the ink stored

ink is stored in note-surface JSON coordinates. origin at the top-left of the text column, y absolute down the document. markdown reflows wherever it wants. your ink stays where you put it. editing text will never move ink except in the case of the insert space tool, by design

### how is the ink placed

ink flows or drawing happens on raw pointer events. the line behind the nib is smoothed with math; the last stub to the pen tip is raw so the ink will always reach the tip of the pen

if you have any more questions i'd be glad to answer in the comments

## reporting problems

[open an issue](https://github.com/ellimist-afk/handwriting/issues/new/choose). report what happened. remember to include which device and pen please.

EZMODE reporting:

run `Bug report: record`.

reproduce the bug.

run `Bug report: send`.

press Upload and the report comes straight to me 🙂 paste the id it gives you into your issue or the reddit thread.

for those of you nervous about bug reports: specifically what the report records are pen coordinates, timing, and what kind of device+pen the report is coming from- nothing else. furthermore, nothing leaves your device unless you press Upload. Copy and Save to Vault are offline ways to do bug reports

## coming soon

* audio alongside ink
* ruler + compass on screen
* laser pointer
* ocr / handwriting to text
* searchable handwriting
* handwriting to math/latex
* text boxes
* canvas mode
* custom toolbar with favorites
* more custom colors

there's still a long way to go before obsidian has real parity with onenote. i'm not going anywhere.

## money

Handwriting is free. i'm still working on it almost every night. if you want to buy me a coffee:
https://ko-fi.com/ellimistafk

thank you for using my plugin.

## license

CC BY-NC-ND 4.0

disclaimer: ai assistance was used in this project.

## why i built this

back in uni i remember taking biochem notes on my new surface pro 4 with stars in my eyes. drawing structures and typing labels on the same OneNote page felt like literal magic. i can still remember how good it felt, how proud i was showing my notes to friends and professors

ten years later, now for work, I'm still using onenote - and i consider it a prison. things change.

Obsidian has almost reached feature-parity but there's one last integration that keeps me coming back into the hands of Microsoft.

**Handwriting is OneNote's last bastion.**

not to wax poetic but i am beyond ready to break out.

Handwriting is designed for students, educators, engineers, artists, or anyone who needs to handwrite and type in Obsidian.

i designed this app with a decade of OneNote experience driving my tastes, so a few of the quirks and nuances of operation should feel remarkably similar or remarkably bad. sometimes it's a matter of taste
