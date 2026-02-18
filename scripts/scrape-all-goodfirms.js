#!/usr/bin/env node

/**
 * GoodFirms BPO Scraper - Uses existing URLs from JSON file
 * 
 * Reads company URLs from storage/app/private/public/goodfirms_bpo.json
 * and scrapes each company detail page.
 * 
 * Usage: 
 *   node scripts/scrape-all-goodfirms.js                    # Scrape all companies
 *   node scripts/scrape-all-goodfirms.js --limit=100        # Limit to first 100
 *   node scripts/scrape-all-goodfirms.js --resume           # Resume from checkpoint
 *   node scripts/scrape-all-goodfirms.js --parallel=3       # Run 3 parallel scrapers
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
    urlsFile: 'storage/app/private/public/goodfirms_bpo.json',
    outputFile: 'storage/app/goodfirms-bpo-all-companies.json',
    checkpointFile: 'storage/app/goodfirms-scrape-checkpoint.json',
    scraperScript: path.join(__dirname, 'puppeteer-scraper.js'),
    delayBetweenCompanies: 3000,
    maxRetries: 2,
};

class GoodFirmsScraper {
    constructor(options = {}) {
        this.limit = options.limit || null;
        this.resume = options.resume || false;
        this.parallel = options.parallel || 1;
        this.companies = [];
        this.scrapedUrls = new Set();
        this.startTime = Date.now();
        this.successCount = 0;
        this.failCount = 0;
    }

    async loadUrls() {
        console.log(`📂 Loading URLs from ${CONFIG.urlsFile}...`);
        const data = JSON.parse(await fs.readFile(CONFIG.urlsFile, 'utf-8'));

        // Extract profile URLs and clean them (remove #review_analytics)
        let urls = data.companies.map(c => {
            let url = c.profile;
            if (url.includes('#')) url = url.split('#')[0];
            return url;
        });

        console.log(`  ✅ Loaded ${urls.length} company URLs`);
        return urls;
    }

    async loadCheckpoint() {
        try {
            const checkpointData = await fs.readFile(CONFIG.checkpointFile, 'utf-8');
            const checkpoint = JSON.parse(checkpointData);
            this.scrapedUrls = new Set(checkpoint.scrapedUrls || []);

            const existingData = await fs.readFile(CONFIG.outputFile, 'utf-8');
            this.companies = JSON.parse(existingData);
            this.successCount = this.companies.length;

            console.log(`📂 Resuming: ${this.companies.length} companies already scraped`);
        } catch (error) {
            console.log('📂 Starting fresh');
        }
    }

    async saveCheckpoint() {
        const checkpoint = {
            scrapedUrls: Array.from(this.scrapedUrls),
            lastUpdated: new Date().toISOString(),
            totalScraped: this.companies.length
        };
        await fs.writeFile(CONFIG.checkpointFile, JSON.stringify(checkpoint, null, 2));
    }

    async saveResults() {
        await fs.mkdir(path.dirname(CONFIG.outputFile), { recursive: true });
        await fs.writeFile(CONFIG.outputFile, JSON.stringify(this.companies, null, 2));
        await this.saveCheckpoint();
    }

    delay(ms) {
        return new Promise(r => setTimeout(r, ms + Math.random() * 1000));
    }

    async scrapeCompany(url) {
        return new Promise((resolve) => {
            const child = spawn('node', [CONFIG.scraperScript, url], {
                cwd: process.cwd(),
                timeout: 120000,
            });

            let stdout = '';
            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', () => { }); // Ignore stderr

            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        const lines = stdout.trim().split('\n');
                        let jsonLine = null;

                        for (let i = lines.length - 1; i >= 0; i--) {
                            const line = lines[i].trim();
                            if (line.startsWith('{') && line.endsWith('}')) {
                                jsonLine = line;
                                break;
                            }
                        }

                        if (jsonLine) {
                            const data = JSON.parse(jsonLine);
                            if (!data.company?.basic_info?.name?.includes('Just a moment')) {
                                resolve(data);
                                return;
                            }
                        }
                    } catch (e) { }
                }
                resolve(null);
            });

            child.on('error', () => resolve(null));
            setTimeout(() => { child.kill(); resolve(null); }, 120000);
        });
    }

    formatTime(ms) {
        const mins = Math.floor(ms / 60000);
        const hours = Math.floor(mins / 60);
        if (hours > 0) return `${hours}h ${mins % 60}m`;
        return `${mins}m`;
    }

    async run() {
        if (this.resume) await this.loadCheckpoint();

        // Load URLs from existing file
        let allUrls = await this.loadUrls();

        // Apply limit if specified
        if (this.limit) {
            allUrls = allUrls.slice(0, this.limit);
            console.log(`📊 Limited to first ${this.limit} companies`);
        }

        // Filter out already scraped
        const urlsToScrape = allUrls.filter(url => !this.scrapedUrls.has(url));

        console.log(`\n📊 Total: ${allUrls.length} | To scrape: ${urlsToScrape.length} | Already done: ${allUrls.length - urlsToScrape.length}`);
        console.log(`📁 Output: ${CONFIG.outputFile}`);
        console.log(`⚡ Parallel workers: ${this.parallel}\n`);

        console.log('='.repeat(60));
        console.log('🔍 SCRAPING COMPANIES');
        console.log('='.repeat(60) + '\n');

        // Process in batches for parallel execution
        for (let i = 0; i < urlsToScrape.length; i += this.parallel) {
            const batch = urlsToScrape.slice(i, i + this.parallel);
            const elapsed = this.formatTime(Date.now() - this.startTime);
            const remaining = urlsToScrape.length - i;
            const eta = this.successCount > 0
                ? this.formatTime((Date.now() - this.startTime) / this.successCount * remaining)
                : '...';

            console.log(`[${i + 1}-${Math.min(i + this.parallel, urlsToScrape.length)}/${urlsToScrape.length}] ${elapsed} elapsed | ETA: ${eta}`);

            // Scrape batch in parallel
            const results = await Promise.all(batch.map(async (url) => {
                const slug = path.basename(url);

                for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
                    const data = await this.scrapeCompany(url);
                    if (data?.company) {
                        this.scrapedUrls.add(url);
                        return { success: true, data, slug };
                    }
                    if (attempt < CONFIG.maxRetries) await this.delay(2000);
                }
                return { success: false, slug };
            }));

            // Process results
            for (const result of results) {
                if (result.success) {
                    this.companies.push(result.data);
                    this.successCount++;
                    console.log(`  ✅ ${result.data.company.basic_info?.name || result.slug}`);
                } else {
                    this.failCount++;
                    console.log(`  ❌ ${result.slug}`);
                }
            }

            // Save every 10 companies
            if (this.companies.length % 10 < this.parallel) {
                await this.saveResults();
                console.log(`  💾 Saved: ${this.companies.length} companies\n`);
            }

            await this.delay(CONFIG.delayBetweenCompanies);
        }

        await this.saveResults();

        const totalTime = this.formatTime(Date.now() - this.startTime);
        console.log('\n' + '='.repeat(60));
        console.log('✅ COMPLETE');
        console.log('='.repeat(60));
        console.log(`📊 Success: ${this.successCount} | Failed: ${this.failCount}`);
        console.log(`⏱️  Time: ${totalTime}`);
        console.log(`📁 Output: ${CONFIG.outputFile}`);
    }
}

// CLI
const args = process.argv.slice(2);
const options = { limit: null, resume: false, parallel: 1 };

args.forEach(arg => {
    if (arg.startsWith('--limit=')) options.limit = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--parallel=')) options.parallel = parseInt(arg.split('=')[1]);
    else if (arg === '--resume') options.resume = true;
});

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║   GoodFirms BPO Scraper - Fast Mode                      ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

new GoodFirmsScraper(options).run().catch(console.error);
