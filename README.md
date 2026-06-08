# Manual Subtitle Editor

A small browser-based subtitle editor for creating, revising, importing, and exporting subtitle files against local audio or video media.

## Open the App

Open `index.html` in a browser. The app is plain HTML, CSS, and JavaScript, so it does not require a build step or local server.

## Main Workflow

1. Load an audio or video file.
2. Use the waveform to choose subtitle start and end times.
3. Type subtitle text in the editor.
4. Press Enter to save the row.
5. Import existing `.srt` or `.vtt` files when needed.
6. Export finished subtitles as SRT or VTT.

## Editing Controls

- Left-click the waveform to set the start time.
- Right-click the waveform to set the end time.
- Drag waveform markers to adjust timing.
- Use the overview bar to move through longer media.
- Use zoom controls or trackpad gestures to inspect timing more closely.
- Select a saved row to revise it.
- Use Insert Before and Insert After to add rows around the selected subtitle.
- Enable Wrap table text to inspect multi-line subtitle content.

## Local Drafts

The editor autosaves the current draft in the browser with IndexedDB. Draft restore keeps subtitle rows, text, selection, and waveform view state, but media files must be selected again because browsers do not persist access to local files automatically.

## Keyboard Shortcuts

- Space: play or pause when not typing.
- Command/Ctrl + P: replay the selected subtitle segment.
- Command/Ctrl + Left or Right: move the waveform window.
- Command/Ctrl + Plus or Minus: zoom the waveform.
- Command/Ctrl + Z: undo.
- Command/Ctrl + Shift + Z: redo.
- Command/Ctrl + S: save the local draft immediately.
- Command/Ctrl + Delete or Backspace: delete the selected subtitle row.

## Files

- `index.html`: App markup and accessible controls.
- `styles.css`: Layout, responsive behavior, waveform/table states, and modal styling.
- `app.js`: Media loading, waveform rendering, subtitle parsing/export, row editing, draft persistence, and event handling.
