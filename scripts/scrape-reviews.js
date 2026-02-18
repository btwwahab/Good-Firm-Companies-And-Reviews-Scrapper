#!/usr/bin/env node

/**
 * Review Scraper for GoodFirms Companies
 * Uses child process approach to bypass Cloudflare (like scrape-all-goodfirms.js)
 * 
 * Usage:
 *   node scripts/scrape-reviews.js           # Scrape all
 *   node scripts/scrape-reviews.js --resume  # Resume from checkpoint
 *   node scripts/scrape-reviews.js --limit=10
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = 'storage/app/goodfirms-bpo-all-companies (1).json';
const OUTPUT_FILE = 'storage/app/goodfirms-bpo-all-companies (1).json';
const CHECKPOINT_FILE = 'storage/app/review-scrape-checkpoint.json';
const REVIEW_SCRAPER_SCRIPT = path.join(__dirname, 'puppeteer-review-scraper.js');

const SAVE_EVERY = 10;
const DELAY_BETWEEN_SCRAPES = 5000;

function formatTime(ms) {
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms + Math.random() * 1000));
}

async function loadCheckpoint() {
    try {
        const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return { processedUrls: [], reviewsByUrl: {} };
    }
}

async function saveCheckpoint(checkpoint) {
    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

/**
 * Scrape reviews from a single page URL using a fresh browser process
 */
function scrapeReviewsFromUrl(url) {
    return new Promise((resolve) => {
        const child = spawn('node', [REVIEW_SCRAPER_SCRIPT, url], {
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
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const line = lines[i].trim();
                        if (line.startsWith('{') && line.endsWith('}')) {
                            const data = JSON.parse(line);
                            if (data.reviews && Array.isArray(data.reviews)) {
                                resolve(data);
                                return;
                            }
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

async function main() {
    const args = process.argv.slice(2);
    const limitArg = args.find(a => a.startsWith('--limit='));
    const parallelArg = args.find(a => a.startsWith('--parallel='));
    const resumeArg = args.includes('--resume');
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
    const parallel = parallelArg ? parseInt(parallelArg.split('=')[1]) : 1;

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║   GoodFirms Review Scraper (Child Process)              ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log(`📂 Loading companies from ${INPUT_FILE}...`);
    const allCompanies = JSON.parse(await fs.readFile(INPUT_FILE, 'utf-8'));

    let checkpoint = { processedUrls: [], reviewsByUrl: {} };
    if (resumeArg) {
        checkpoint = await loadCheckpoint();
        console.log(`🔄 Resume mode: ${checkpoint.processedUrls.length} already processed`);
    }

    let companies = allCompanies.map((c, idx) => ({ ...c, originalIndex: idx }));
    if (resumeArg) {
        companies = companies.filter(c => {
            const url = c.company?.basic_info?.profile_url;
            return url && !checkpoint.processedUrls.includes(url);
        });
    }
    if (limit) {
        companies = companies.slice(0, limit);
        console.log(`📊 Limited to ${limit} companies`);
    }

    console.log(`✅ Total: ${allCompanies.length} | To process: ${companies.length} | Parallel: ${parallel}\n`);

    if (companies.length === 0) {
        console.log('✅ Nothing to process!');
        return;
    }

    const startTime = Date.now();
    let successCount = 0, failCount = 0, totalReviews = 0;

    console.log('='.repeat(60));
    console.log('🔍 SCRAPING REVIEWS');
    console.log('='.repeat(60) + '\n');

    // Scrape a single company (all its pages)
    async function scrapeCompanyReviews(company, companyIndex) {
        const profileUrl = company.company?.basic_info?.profile_url;
        const name = company.company?.basic_info?.name || 'Unknown';
        const originalIndex = company.originalIndex;
        const expectedReviews = company.company?.reviews?.total_reviews || 0;

        console.log(`[${companyIndex + 1}/${companies.length}] 📋 ${name} (${expectedReviews} reviews)`);

        if (!profileUrl) {
            console.log(`  ❌ No profile URL`);
            return { success: false, reviews: 0 };
        }

        // Collect all reviews across all pages
        let allPageReviews = [];
        let pageNum = 1;
        let hasMorePages = true;

        while (hasMorePages) {
            const pageUrl = pageNum === 1 ? profileUrl : `${profileUrl}?page=${pageNum}`;

            const result = await scrapeReviewsFromUrl(pageUrl);

            if (result && result.reviews && result.reviews.length > 0) {
                const existingIds = new Set(allPageReviews.map(r => r.id));
                const newReviews = result.reviews.filter(r => !existingIds.has(r.id));
                allPageReviews = allPageReviews.concat(newReviews);

                console.log(`  📄 Page ${pageNum}: ${newReviews.length} reviews`);

                hasMorePages = result.hasNextPage && pageNum < 20;
                pageNum++;
            } else {
                hasMorePages = false;
            }

            if (hasMorePages) {
                await delay(3000);
            }
        }

        // Update company data
        allCompanies[originalIndex].company.reviews = {
            ...allCompanies[originalIndex].company.reviews,
            detailed_reviews: allPageReviews
        };
        checkpoint.processedUrls.push(profileUrl);
        checkpoint.reviewsByUrl[profileUrl] = allPageReviews.length;

        console.log(`  ✅ Total: ${allPageReviews.length} reviews scraped`);
        return { success: true, reviews: allPageReviews.length };
    }

    // Process companies in parallel batches
    let completedCount = 0;

    for (let i = 0; i < companies.length; i += parallel) {
        const batch = companies.slice(i, i + parallel);
        const batchPromises = batch.map((company, batchIdx) =>
            scrapeCompanyReviews(company, i + batchIdx)
        );

        const results = await Promise.all(batchPromises);

        results.forEach(r => {
            if (r.success) {
                successCount++;
                totalReviews += r.reviews;
            } else {
                failCount++;
            }
        });

        completedCount += batch.length;

        // Save after each batch
        await fs.writeFile(OUTPUT_FILE, JSON.stringify(allCompanies, null, 2));
        await saveCheckpoint(checkpoint);

        const elapsed = formatTime(Date.now() - startTime);
        const eta = formatTime((Date.now() - startTime) / completedCount * (companies.length - completedCount));
        console.log(`\n  💾 Saved: ${completedCount}/${companies.length} | ${totalReviews} reviews | ${elapsed} | ETA: ${eta}\n`);

        if (i + parallel < companies.length) {
            await delay(DELAY_BETWEEN_SCRAPES);
        }
    }

    const totalTime = formatTime(Date.now() - startTime);
    console.log('\n' + '='.repeat(60));
    console.log('✅ COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Success: ${successCount} | Failed: ${failCount}`);
    console.log(`📝 Total reviews scraped: ${totalReviews}`);
    console.log(`⏱️  Time: ${totalTime}`);
    console.log(`📁 Output: ${OUTPUT_FILE}`);
}

main().catch(console.error);
