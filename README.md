# BetHelp

BetHelp is a sports betting tracker focused on mobile-first bet registration.

You can:
- Upload a screenshot of your bet slip from your phone
- Save bet details (name, stake, decimal odds, date)
- Persist bets in a local database file
- Track status (`pending`, `won`, `lost`)
- View live stats (profit, ROI, average odds, totals)

Stored data lives in `data/bets.json` and uploaded screenshots are stored in `uploads/`.

## Run the app

```bash
npm start
```

Then open `http://localhost:3000`.

## How to use from your phone

1. Open the app in your mobile browser.
2. Use the screenshot file picker (camera upload is supported via `capture="environment"`).
3. Fill in bet details and submit.
4. Update bet status as outcomes settle.
5. Review stats in the dashboard.

## Run tests

```bash
npm test
```
