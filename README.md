# Anchor Protocol

Static site for the anti-PvP vote + treasury dashboard.

## Change the treasury wallet

Put the address in `config.json`:

```json
"treasuryWallet": "YOUR_SOLANA_ADDRESS_HERE"
```

Or paste it in admin after login. The dashboard reads that wallet from Solana mainnet and calculates:

- 50% winner buy
- 20% buyback + lock of the main coin
- 30% reserves
- Round locked until the wallet holds 15 SOL
- Vote window: 5 minutes

USD is not shown. Winner buy budget is always 50% of the live SOL balance.

## Admin

Password: `dropanchor`  
Change `ADMIN_PASSWORD` in `app.js` before sharing.

## Run

```bash
python3 -m http.server 8080
```
