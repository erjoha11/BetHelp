# BetHelp

BetHelp is a sports betting tracker focused on mobile-first bet registration.

You can:
- Upload a screenshot of your bet slip from your phone
- Auto-extract bet details (name, stake, decimal odds) from the screenshot
- Detect bookmaker/site when possible
- Split one screenshot into multiple bets when multiple bet blocks are present
- Track game legs (teams) for single and multi-game bets
- Persist bets in a local database file
- Track status (`pending`, `won`, `lost`)
- Delete misuploads from the Bet History table
- View live stats (profit, ROI, average odds, totals)

Currency display is in `Kr`.

Stored data lives in `data/bets.json` and uploaded screenshots are stored in `uploads/`.

## Run the app

```bash
npm start
```

Then open `http://localhost:3000`.

## How to use from your phone

1. Open the app in your mobile browser.
2. Use the screenshot file picker.
3. Upload the screenshot (no typing required).
4. Update bet status as outcomes settle.
5. Review stats in the dashboard.

## Run tests

```bash
npm test
```
