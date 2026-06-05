# Voca Dictionary Clipper

Chrome/Edge extension for adding vocabulary from any web page into the local Voca Dictionary.

## Features

- Right-click selected text and choose `Add "<word>" to Voca Dictionary`.
- Right-click near a word on the page and choose `Add focused word to Voca Dictionary`.
- Select or double-click a word to show an inline `Add to Voca` tooltip on the page.
- Use the toolbar popup to review or edit the detected word before adding.
- Keyboard shortcut: `Alt+Shift+V`.

## Setup

1. Start the Voca local bridge:

   ```bash
   npm run voca:api
   ```

   The macOS VocaMenuBar app also starts this bridge automatically.

2. Open Chrome or Edge extension management:

   ```text
   chrome://extensions
   edge://extensions
   ```

3. Enable developer mode, choose `Load unpacked`, and select this folder:

   ```text
   extension/
   ```

4. Open the extension settings page and enter the same AI settings used by the web app:

   - Local API port: `22053`
   - Base URL
   - API key
   - Model

The extension calls `http://127.0.0.1:22053/create-card`, so generated cards are synced into the same local `cards/` and `cards.json` used by the app.
