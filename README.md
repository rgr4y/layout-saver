# Layout Saver VS Code Extension

Layout Saver is a simple VS Code extension that lets you save and restore your editor layout—including tab groups, file positions, pinned tabs, and side bar visibility. Ideal for preserving your development workspace or quickly switching between tasks.

## Features

* Save multiple named editor layouts (visible tabs, positions, and layout).
* Restore saved layouts with a single command.
* See existing layout names when saving for easy reference.
* Optionally hide the side bar after restoring.
* Skips untitled or dirty tabs for safe restoring.
* Preserves existing terminals and other non-editor tabs.

---

## Commands

| Command       | Title       | Description                      |
| ------------- | ----------- | -------------------------------- |
| `layout.save` | Save Layout | Prompts for a name and saves the current editor layout. |
| `layout.load` | Load Layout | Shows a list of saved layouts to restore.   |

You can trigger these via the Command Palette (Ctrl+Shift+P) or bind custom keys.

Default keybinding:

* **Load Layout**: `Ctrl+Alt+L` (Windows/Linux), `Cmd+Alt+L` (macOS)

---

## Usage

### Saving a Layout

1. Arrange your editor tabs in the desired layout
2. Run the "Save Layout" command
3. Enter a name for your layout (you'll see existing layout names for reference)
4. The layout is saved to your workspace settings

### Loading a Layout

1. Run the "Load Layout" command
2. Select a layout from the list
3. Your editor tabs will be rearranged to match the saved layout
4. Existing terminals and other tabs remain untouched

---

## Configuration Options

You can customize behavior through your settings (`settings.json`):

```json
{
  "layoutSaver.layouts": {},
  "layoutSaver.hideSideBarAfterOpen": true
}
```

### Property Reference

* `layoutSaver.layouts`: Internal storage for named layouts (object with layout names as keys).
* `layoutSaver.hideSideBarAfterOpen`: Hides the sidebar after layout is restored.

---

## Development

### Scripts

```bash
pnpm run esbuild        # One-time build using esbuild
pnpm run watch          # Watch for changes and rebuild
```

### Debugging

After running `pnpm run watch`, you can test the extension by either:

* Pressing **F5** to launch a new Extension Host window, or
* Clicking the **Run and Debug** icon from the Activity Bar and hitting the **Play** button.

This opens a new VS Code window where the extension is loaded for testing.

---

## Known Limitations

* Terminal tabs are not included in saved layouts (VS Code API limitation). Existing terminals are preserved when restoring layouts.
* Webviews cannot be restored (VS Code API limitation).
* Untitled tabs and dirty (unsaved) tabs are skipped when saving.

---

## License

GNU General Public License (GPL)

---

## Notice

This project builds upon [ctf0/vscode-save-editor-layout](https://github.com/ctf0/vscode-save-editor-layout) with custom modifications. Licensed under the GNU GPL.