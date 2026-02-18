#!/usr/bin/env node

/**
 * Puppeteer Review Scraper - Single Page
 * 
 * This script is spawned as a child process to scrape reviews from a single page.
 * It outputs JSON to stdout which is parsed by the parent process.
 * 
 * Usage: node puppeteer-review-scraper.js <url>
 */

import puppeteer from 'puppeteer';

async function scrapeReviews(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1920,1080'
            ],
            defaultViewport: { width: 1920, height: 1080 }
        });

        const page = await browser.newPage();

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        });

        // Navigate to page
        const response = await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        if (!response || !response.ok()) {
            console.log(JSON.stringify({ error: 'Failed to load', reviews: [], hasNextPage: false }));
            await browser.close();
            return;
        }

        // Wait for page load
        await new Promise(r => setTimeout(r, 5000));

        // Check for Cloudflare
        const isCloudflare = await page.evaluate(() => {
            return document.title.includes('Just a moment') ||
                document.body.innerText.includes('Checking your browser');
        });

        if (isCloudflare) {
            console.error('Cloudflare detected, waiting...');
            await new Promise(r => setTimeout(r, 10000));

            const stillCloudflare = await page.evaluate(() => document.title.includes('Just a moment'));
            if (stillCloudflare) {
                console.log(JSON.stringify({ error: 'Cloudflare blocked', reviews: [], hasNextPage: false }));
                await browser.close();
                return;
            }
        }

        // Scroll to reviews section
        await page.evaluate(() => {
            const reviewSection = document.getElementById('review_analytics') ||
                document.querySelector('.profile-reviews-section');
            if (reviewSection) reviewSection.scrollIntoView();
        });
        await new Promise(r => setTimeout(r, 2000));

        // Click "Show Full Review" buttons
        await page.evaluate(() => {
            document.querySelectorAll('.profile-review-show-more-btn').forEach(btn => btn.click());
        });
        await new Promise(r => setTimeout(r, 1000));

        // Extract reviews
        const result = await page.evaluate(() => {
            const reviews = [];

            document.querySelectorAll('article.profile-review, .profile-review, article[id^="review-"]').forEach(article => {
                try {
                    const review = {
                        id: article.id || null,
                        reviewer_name: article.querySelector('.reviewer-name')?.textContent?.trim() || 'Anonymous',
                        reviewer_image: article.querySelector('.reviewer-image img')?.src || null,
                        date: article.querySelector('.review-date')?.textContent?.trim() || null,
                        title: article.querySelector('.review-title, h3.review-title')?.textContent?.trim() || null,
                        summary: article.querySelector('.review-summary')?.textContent?.trim() || null,
                        rating_breakdown: {},
                        project_details: {},
                        project_qa: []
                    };

                    // Rating breakdown
                    article.querySelectorAll('.review-rating-breakdown-list li').forEach(item => {
                        const label = item.querySelector('span:first-child')?.textContent?.trim()?.toLowerCase();
                        const starContainer = item.querySelector('.rating-star-container');
                        if (label && starContainer) {
                            const widthMatch = starContainer.getAttribute('style')?.match(/width:\s*(\d+)%/);
                            const rating = widthMatch ? parseFloat(widthMatch[1]) / 20 : 0;
                            if (label.includes('quality')) review.rating_breakdown.quality = rating;
                            else if (label.includes('schedule')) review.rating_breakdown.schedule = rating;
                            else if (label.includes('communication')) review.rating_breakdown.communication = rating;
                            else if (label.includes('overall')) review.rating_breakdown.overall = rating;
                        }
                    });

                    // Project details
                    article.querySelectorAll('.project-services-list li').forEach(item => {
                        const text = item.textContent?.trim() || '';
                        const tooltip = item.getAttribute('data-content') || '';
                        if (tooltip.includes('Cost') || item.querySelector('.icon-cost')) review.project_details.cost = text;
                        else if (tooltip.includes('Status') || item.querySelector('.icon-status')) review.project_details.status = text;
                        else if (tooltip.includes('Industry') || item.querySelector('.icon-industry')) review.project_details.industry = text;
                    });

                    // Project Q&A
                    article.querySelectorAll('.project-info').forEach(qa => {
                        const question = qa.querySelector('h4')?.textContent?.trim();
                        const answer = qa.querySelector('p')?.textContent?.trim();
                        if (question && answer) review.project_qa.push({ question, answer });
                    });

                    if (review.id) reviews.push(review);
                } catch (e) { }
            });

            // Check for next page
            const pagination = document.querySelector('.pagination');
            let hasNextPage = false;
            if (pagination) {
                const nextBtn = pagination.querySelector('.next-page');
                hasNextPage = nextBtn && !nextBtn.classList.contains('disable');
            }

            return { reviews, hasNextPage };
        });

        console.log(JSON.stringify(result));
        await browser.close();

    } catch (error) {
        console.error('Error:', error.message);
        console.log(JSON.stringify({ error: error.message, reviews: [], hasNextPage: false }));
        if (browser) await browser.close();
    }
}

// Get URL from command line
const url = process.argv[2];
if (!url) {
    console.log(JSON.stringify({ error: 'No URL provided', reviews: [], hasNextPage: false }));
    process.exit(1);
}

scrapeReviews(url);
