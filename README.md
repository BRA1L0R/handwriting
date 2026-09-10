# Handwriting

Handwrite, highlight, erase and lasso directly on your notes and PDFs. Your notes stay Markdown.

Open a note and write. The note stays a `.md` file.

## removing the plugin

your ink is not stored "in" the markdown. it lives in a folder at your vault root, separate from the editor's text.

disable the plugin and your notes STAY EXACTLY THE SAME - the ink just stops rendering. re-enable and it comes back.

one line is written to the invisible frontmatter of a note when you first write on it - `handwriting-page-id`.

a note you never inked on is never modified.

---

> **ipad**
>
> turn off Scribble or ios will draw its own black ink over your strokes, and its scratch-out gesture may delete ink.
>
> **iPad Settings → Apple Pencil → Scribble → Off**

---

## what it does

Here's a demonstration of some of the features: https://youtu.be/TUeniA9BZcc

### right now you can

* handwrite, highlight, color palette, size sliders
* erase, two modes, size slider
* lasso, compatible with side button; move the selection, delete it, copy/paste it across notes (resize and rotate coming soon)
* insert space tool
* undo/redo ink + text
* draw + pan with the mouse if you want
* pdfs: annotate, export, snip

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
* true infinite canvas
* ink works in embeds
* handwriting to shape snap

### works on

windows · macos · linux · ipad · boox · android

### doesn't really work on

iphone

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

### mouse input

to use the toolbar with a mouse, run `Handwriting: Mouse on / off`.

click a tool to use it with the mouse. click the active tool again to return to the normal cursor.

### eraser modes

the eraser has two modes:

- **stroke** erases the entire stroke
- **reticle** erases only the part beneath the reticle

tap the eraser button to select a mode. stroke is the default.

the eraser button also toggles the eraser on and off. with **Extra commands for hotkeys** enabled, `Toggle eraser on / off` and `Eraser size: next` are available in the command palette.

### colors and favorites

tap the pen button to open its size slider, favorites and 8 pen colors. tap the highlighter button to open its size slider, also with favorites and 5 highlighter colors.

selecting a color applies it to the corresponding nib.

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



### pinch zoom

pinch to zoom works on notes and pdfs. the point where the pinch begins remains beneath your fingers while zooming.

### shape snap

hold the pen still for about a third of a second at the end of a stroke to snap it into a line, triangle, rectangle, circle or ellipse.

with a mouse, pause at the end of a stroke and select **Snap**.

## sync notes

`.handwriting/` is a hidden folder. many sync services do not sync hidden folders by default, including Obsidian Sync, iCloud and Dropbox.

if you use one of these services, enable **Compatibility with Obsidian Sync, iCloud and Dropbox** in Handwriting settings.

**compatibility: sync between devices**

this option switches where Handwriting stores ink- by default, ink is stored in the hidden .handwriting sidecar (which like half of services don't look at hidden folders by default, so won't sync with these services). Hitting this button creates a handwriting sidecar (no period in front), then points itself at it

## how it works

this is a section dedicated to anyone curious about the mechanisms

### writing

when you put pen to screen, then switch to keyboard and back, it should feel seamless. This is because of three layers interacting

first, you are writing on an overlay canvas drawn to match the Obsidian text editor. this overlay is made in codemirror 6 and accepts+records pen inputs. codemirror 6 is a program component that Obsidian uses to handles things like typing, cursor movement, text selection, etc

second layer is made of logic. the input guard lives here. He gets to decide which events belong to Handwriting and which fall through to Obsidian

Obsidian or its live editor, sits underneath - this is the base where all inputs go unless otherwise claimed

to sum up: Obsidian's live editor handles the Markdown. transparent canvas layer above it draws the ink. then logic layer decides whether or not the thing poking it is a pen, a finger, or a palm

### where is ink stored

your ink is one json file per note in /.handwriting/

(your vault)/.handwriting/

sidecar is a digital photography term that refers to a small file besides a main file, that holds information about the main file. this is a useful analogy

in this case, the sidecar stores your ink as coordinates - your note is linked to your ink by a single properties line in the properties field of your note. this link + the coordinates tells Obsidian where all the ink is

what this means practically is that no matter what happens to the ink, the text in your note will be safe, as the note itself is not modified (besides its frontmatter).

### why the ink looks good

a typical pen reports ~200-250 dots/events a second. what other handwriting apps probably do (almost certainly) is draw straight lines between each dot - this is what causes the jaggedness or spikiness on boox or other e-ink devices, also because the pen trembles a bit naturally

what i did is smooth the curve by adding the previous dot into the calculation. this causes bad perceived lag, so i had to replace the last stretch of the curve to the pen tip with a straight line in real time

### how does it stay still

ink coordinates are stored in the sidecar. origin is at the top-left of the text column, absolute y down the document.

any transformation of the viewport, Handwriting calculates where that part of the note is on your screen and redraws the ink. then, Handwriting matches the overlay to the live editor pane.

this sounds pretty straightforward. 

however if you resize Obsidian, resize a window pane, change the font size, pinch the screen, zoom with ctrl+, ctrl-, or ctrl & scroll, use a theme that moves the text column, use a theme that moves the live editor, change the readable line length setting, or simply pan, the coordinates must transform to match

### palm rejection

most palm rejection tech starts with blocking hand input when pen begins input. Handwriting does this too.

On notes, Handwriting's block persists 350 ms after pen lifts in case you brush the screen as you are lifting off.

but this creates a problem: writers who hold their pen close to screen while scrolling with other hand

because of this, pen-input blocked finger swipe gets one chance to prove it is a finger swiping. if it moves far enough, fast enough, and isn't reporting a palm-sized contact, it is allowed to become a pan. this is fairly reliable.

however, palms can slide too, especially while you're erasing. if movement were the only test, lifting the eraser could suddenly let your resting hand drag the page. so movement isn't enough.

therefore the input guard is given a short memory bank -  remembers whether a pen stroke happened at any point while a finger/palm touch was down. in this case, that contact stays blocked until you lift it

a finger scrolling the page and a palm resting on it can look similar to bad logic, so Handwriting counts things like time in ms between hand contact to next pen input, whether contact stops moving after, size of the contact, speed of the contact, angle, etc

this goes for pdfs too.

### undo/redo

if you draw, type, then erase, ctrl+z should undo those things in the order you did them

this meant Obsidian, not just Handwriting, needed to know what an ink action is and in what order

each ink action had to be translated to be able to be recorded in obsidian's undo history. adding a stroke. moving a lasso selection. which strokes moved and by how much. erasing. what was removed and how much of it

teaching these operations to participate in the editor's history alongside text gives seamless undo/redo for text and ink

### saving and recovery

I worked hard trying to guarantee that you wouldn't lose your ink no matter how hard you tried. i still didn't make it impossible so so be careful. :sob:

some things i did included:

before replacing the saved sidecar, Handwriting writes a complete temporary copy. if a save get corrupted or interrupted, recovery is possible

if an ink file is corrupted, damaged, or can't be understood, Handwriting will refuse to overwrite it. this will stop you from loading a broken file and accidentally immediately overwriting all the information

`Delete all ink` command always makes and saves a recovery copy before clearing the page. if that copy can't be saved, the command will refuse to delete ink

every stroke is stored in memory first then saved to your drive with periodic saves when doing any writing. however there is still a short gap between drawing into memory and saving to disk so if you draw a stroke and then shut down your pc immediately, you might lose that stroke!

also added an export to svg or pdf option so you can save your ink to use in other programs

finally: deleting the entire handwriting folder will take all its recovery copies with it so be careful. and back up your vault!!

if you have any questions i will try to answer as best i can

## reporting problems

[open an issue](https://github.com/ellimist-afk/handwriting/issues/new/choose). report what happened. remember to include which device and pen please.

EZMODE reporting:

run `Bug report: record`.

reproduce the bug.

run `Bug report: send`.

press `Upload` and the report comes straight to me 🙂 paste the id it gives you into your issue or the reddit thread so I know where it came from.

for those of you nervous about sending bug reports: specifically what the report sends are pen coordinates and timings- nothing else. 

and i guarantee nothing will leave your device unless you press `Upload` button. still uncomfortable with telemetry? `Copy` and `Save to Vault` buttons are offline ways to do bug reports

## coming soon

* audio alongside ink
* ruler + compass on screen
* laser pointer
* ocr / handwriting to text ( very soon )
* searchable handwriting ( very soon )
* handwriting to math/latex ( very soon )
* text boxes ;)
* canvas mode
* more custom colors

## money

Handwriting is free. i still work on it almost every night. if you want to buy me a coffee:
https://ko-fi.com/ellimistafk

thank you for using my plugin.

## license

CC BY-NC-ND 4.0

disclaimer: ai assistance was used in this project.

## why i built this

back in uni i remember taking biochem notes on a Surface Pro 4 with stars in my eyes. drawing structures and typing labels on the same OneNote page felt like literal magic. ten years later, now for work, I'm still using onenote - and i consider it a prison. 

things change.
 
Obsidian has almost reached feature-parity for me but there's one last integration that keeps me falling back into the hands of Microsoft.

**Handwriting is OneNote's last bastion.**

not to wax poetic but i am beyond ready to break out.

Handwriting is designed for students, educators, engineers, artists, or anyone who needs to handwrite and type in Obsidian.

i designed this app with a decade of OneNote experience driving my tastes, so a few of the quirks and nuances of operation should feel remarkably similar or remarkably bad. sometimes it's a matter of taste
