# General tasks

## 📈 Ledger: iPhone finance tracker

[`finance-tracker/`](finance-tracker) is a personal finance app built for iPhone (tuned for the 14 Pro's
Dynamic Island and home indicator). It's an installable web app: add it to your Home Screen and it opens
full-screen, works offline, and keeps **all data on your phone**. Nothing is sent to a server.

### What it does

| Tab | Features |
|---|---|
| **Home** | Net worth hero with trend, earned / spent / invested this month (vs. last month), **savings rate** and **investing rate**, 6-month cash-flow chart, spending by category, smart insights, recent activity |
| **Activity** | Every transaction grouped by day, filter (income / expenses / investments), search across all months, tap to edit, duplicate or delete |
| **Invest** | Portfolio value, cost basis and gain/loss %, per-account gains, net-worth-over-time chart, allocation donut, 12-month contribution chart, dividends YTD |
| **Plan** | Monthly **budgets** with pace warnings, savings **goals** with "needed per month", a **compound-growth projection** ("Future you"), your **financial independence number** (4% rule) and ETA, and recurring items |

Other features:
- **Recurring transactions**: salary, rent, subscriptions and auto-invest are added automatically on schedule.
- **Accounts**: bank, index funds/ETFs, stocks, retirement, bonds, crypto, real estate and debts. Logging an *Invest* transaction adds to that account's value and cost basis.
- **Insights**: spending pace and projected month-end total, top category vs. your average, emergency-fund coverage in months, yearly subscription cost, passive-income coverage, budget alerts.
- **Privacy**: the 👁 button blurs every amount, handy in public.
- Light and dark mode, 20 currencies, swipe left/right to change month, tap any chart for exact values or show it as a table.
- **Backups**: export JSON (to Files / iCloud Drive) and restore it, or export CSV for spreadsheets.
- **Sample data** so you can explore before entering your own.

### Put it on your iPhone

The app has to be served over HTTPS once. After that it runs offline.

**Option A: GitHub Pages (free, automatic)**
1. In the repo on GitHub go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Re-run the *Deploy Ledger to GitHub Pages* workflow from the **Actions** tab (it also runs on every push to `main` or this branch). The *Deploy Ledger to GitHub Pages* workflow publishes `finance-tracker/` to
   `https://<your-username>.github.io/<repo-name>/`.
   (GitHub Pages on a *private* repo needs a paid plan. If yours is private, use option B.)

**Option B: Netlify Drop (about 30 seconds, no account setup needed)**
1. Download the `finance-tracker` folder.
2. Drag it onto <https://app.netlify.com/drop>. You get an HTTPS link.

**Then, on the iPhone:**
1. Open the link in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch **Ledger** from your Home Screen.

> 💡 Your data lives in the app's storage on the phone. Use **Settings → Export backup** now and then
> and save the file to iCloud Drive, so you can restore it if you switch phones or delete the app.

### Run locally

```sh
cd finance-tracker
python3 -m http.server 8000
# open http://localhost:8000
```

No build step and no dependencies: plain HTML, CSS and JavaScript.
