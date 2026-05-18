# Good Firm Companies & Reviews Scrapper

A Laravel (PHP 8.2+) application for scraping **company listings and reviews** (e.g., “good firms” directories) and exporting the collected data for analysis.

This repository is a Laravel 12 project with a small Node.js toolchain used for browser automation / scraping (Puppeteer) and data export (XLSX). It includes a ready-to-run setup script via Composer.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [How It Works (End-to-End)](#how-it-works-end-to-end)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Running Locally](#running-locally)
- [Configuration](#configuration)
- [Database](#database)
- [Exporting Data](#exporting-data)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [License](#license)

---

## Project Overview

This app is designed to:
1. **Scrape company information** from a target directory/site.
2. **Scrape reviews** associated with those companies (where available).
3. **Store results** in a local database for further processing.
4. **Export** the final dataset (commonly to Excel/CSV-like formats).

> The repository is structured like a standard Laravel application (routes, app, database, resources, etc.), with additional Node dependencies for headless scraping and exports.

---

## Tech Stack

### Backend
- **Laravel Framework 12**
- **PHP ^8.2**
- **Guzzle** (HTTP requests)
- **Symfony DomCrawler + CssSelector** (HTML parsing)
- **Spatie Browsershot** (headless browser scraping via Chromium)

### Frontend / Tooling
- **Vite** (asset bundling)
- **TailwindCSS**
- **Node.js dependencies**:
  - **Puppeteer** (headless Chrome automation)
  - **xlsx** (Excel export)
  - **undici** (HTTP client)

---

## Features

- Scrape company directory pages (name, profile URL, metadata, etc.)
- Scrape company reviews (rating, review text, reviewer details, timestamps if available)
- Store scraped data in a database (default: SQLite)
- Export scraped datasets (e.g., `.xlsx`)
- Local development workflow with:
  - Laravel server
  - queue worker
  - Vite dev server

---

## How It Works (End-to-End)

A typical scraping run looks like:

1. **Configure environment** (`.env`) and database (SQLite by default).
2. **Start the app** locally (Laravel server + queue worker if needed).
3. **Run scraping logic** (commonly via an Artisan command, a route/controller, or a script).
4. The scraper collects:
   - Company list pages → company profile URLs
   - Company profile pages → company details
   - Reviews pages → review items
5. Data is persisted in the database.
6. **Export** the results for use in Excel / analytics tools.

> Where exactly the scraper is triggered depends on the project’s implementation (Artisan command vs web route). This repo contains Laravel `routes/web.php` and `routes/console.php` for entry points.

---

## Prerequisites

Make sure you have:

- **PHP 8.2+**
- **Composer**
- **Node.js + npm**
- A working local environment for Laravel (recommended):
  - macOS/Linux: native PHP
  - Windows: WSL recommended

Optional:
- A Chromium-compatible environment (required for Browsershot/Puppeteer)
- SQLite installed (often included by default)

---

## Installation & Setup

Clone and install dependencies:

```bash
git clone https://github.com/btwwahab/Good-Firm-Companies-And-Reviews-Scrapper.git
cd Good-Firm-Companies-And-Reviews-Scrapper
```

### One-command setup (recommended)

This project defines a Composer script that performs the full setup:

```bash
composer run setup
```

That script will:
- install PHP dependencies
- create `.env` from `.env.example` if missing
- generate app key
- run migrations
- install Node dependencies
- build frontend assets

---

## Running Locally

### Option A: Run everything together (recommended)

```bash
composer run dev
```

This launches (via `concurrently`) multiple processes, typically including:
- Laravel dev server
- Queue listener
- Frontend dev server (Vite)

### Option B: Run services manually

In separate terminals:

```bash
php artisan serve
```

```bash
php artisan queue:listen --tries=1
```

```bash
npm run dev
```

---

## Configuration

Copy `.env.example` to `.env` (if you didn’t run `composer run setup`):

```bash
cp .env.example .env
php artisan key:generate
```

Key defaults from `.env.example`:
- `APP_ENV=local`
- `APP_DEBUG=true`
- `APP_URL=http://localhost`
- `DB_CONNECTION=sqlite`

If you use SQLite, ensure the SQLite database file exists. Common Laravel setup uses:

```bash
touch database/database.sqlite
php artisan migrate
```

> If your scraping depends on queue jobs, ensure `QUEUE_CONNECTION=database` migrations are applied and the queue worker is running.

---

## Database

Default environment uses **SQLite**:

- Set in `.env`:
  - `DB_CONNECTION=sqlite`

Run migrations:

```bash
php artisan migrate
```

If you switch to MySQL/Postgres, update `.env` accordingly and re-run migrations.

---

## Exporting Data

This project includes the `xlsx` dependency (Node), suggesting that exports may be generated as Excel files.

Common patterns you can implement/use:
- Export from Laravel (PHP) by querying DB and generating a file
- Export using a Node script (in `scripts/`) that reads data and writes `.xlsx`

If there is a dedicated script, it will typically live under:

- `scripts/` (repository includes this folder)

Run scripts via node, for example:

```bash
node scripts/export.js
```

(Adjust the script name to whatever exists in `scripts/`.)

---

## Troubleshooting

### 1) App key missing
If you see errors about `APP_KEY`, run:

```bash
php artisan key:generate
```

### 2) SQLite errors
Make sure the SQLite file exists and is writable:

```bash
mkdir -p database
touch database/database.sqlite
php artisan migrate
```

### 3) Puppeteer / Browsershot issues
Headless browser tooling may require OS packages (common on Linux servers). If Chromium fails to launch:
- confirm Node version is compatible
- confirm required libraries are installed (Linux)
- try running in non-headless mode during debugging (if supported by your script)

### 4) Queue not processing
If jobs are queued but not executed:
- run migrations for queue tables (if used)
- ensure worker is running:
  ```bash
  php artisan queue:listen
  ```

---

## Security Notes

- Do **not** commit `.env` (secrets) to Git.
- Scraping websites may be subject to terms of service, robots.txt, and legal/compliance constraints. Make sure you have permission to scrape the target site(s) and respect rate limits.

---

## License

No license file is currently specified in the repository metadata. If you intend this project to be open-source, consider adding a `LICENSE` file (e.g., MIT).
