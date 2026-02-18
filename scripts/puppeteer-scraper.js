#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';

class GoodFirmsScraper {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.error('🚀 Launching browser...');
        this.browser = await puppeteer.launch({
            headless: true, // Set to false for debugging
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
            defaultViewport: {
                width: 1920,
                height: 1080
            }
        });

        this.page = await this.browser.newPage();

        // Set realistic user agent
        await this.page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Set extra headers
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        });

        console.error('✅ Browser initialized successfully');
    }

    async scrapeCompany(url) {
        try {
            console.error(`🔍 Scraping: ${url}`);

            // Navigate to the page
            const response = await this.page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Check if page loaded successfully
            if (!response || !response.ok()) {
                console.error(`❌ Failed to load page: ${response?.status()}`);
                return null;
            }

            // Wait for potential Cloudflare challenge to complete
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Check if we're still on a Cloudflare challenge page
            const isCloudflare = await this.page.evaluate(() => {
                return document.title.includes('Just a moment') ||
                    document.body.innerText.includes('Checking your browser') ||
                    document.body.innerText.includes('Just a moment');
            });

            if (isCloudflare) {
                console.error('⏳ Cloudflare challenge detected, waiting...');
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait longer for challenge

                // Check again
                const stillCloudflare = await this.page.evaluate(() => {
                    return document.title.includes('Just a moment');
                });

                if (stillCloudflare) {
                    console.error('❌ Still stuck on Cloudflare challenge');
                    return null;
                }
            }

            // Click "Show All Location" button if exists to reveal all locations
            try {
                const clicked = await this.page.evaluate(() => {
                    // Method 1: Look for button with aria-label="Show All Location"
                    const ariaBtn = document.querySelector('button[aria-label="Show All Location"], [aria-label*="Show All Location"]');
                    if (ariaBtn) {
                        ariaBtn.click();
                        return true;
                    }

                    // Method 2: Look for .location-btn class
                    const locationBtn = document.querySelector('.location-btn');
                    if (locationBtn) {
                        locationBtn.click();
                        return true;
                    }

                    // Method 3: Find all links/buttons containing "Show All Location" text
                    const elements = document.querySelectorAll('a, button, span');
                    for (const el of elements) {
                        if (el.textContent.trim().toLowerCase().includes('show all location')) {
                            el.click();
                            return true;
                        }
                    }

                    // Method 4: Also try class-based selector
                    const byClass = document.querySelector('.show-more-location, [class*="show-more-location"]');
                    if (byClass) {
                        byClass.click();
                        return true;
                    }
                    return false;
                });

                // Force all locations to be visible FIRST (remove CSS hiding)
                const beforeCount = await this.page.evaluate(() => {
                    // Remove 'single-location' class that might hide some locations
                    const wrapper = document.querySelector('.profile-locations-wrap');
                    if (wrapper) {
                        wrapper.classList.remove('single-location');
                        wrapper.style.maxHeight = 'none';
                        wrapper.style.overflow = 'visible';
                    }

                    // Make all profile-location elements visible
                    const allLocations = document.querySelectorAll('.profile-location');
                    allLocations.forEach(loc => {
                        loc.style.display = 'flex';
                        loc.style.visibility = 'visible';
                        loc.style.opacity = '1';
                        loc.style.height = 'auto';
                    });

                    // Also remove any hidden class
                    document.querySelectorAll('.profile-location.hidden, .profile-location[hidden]').forEach(loc => {
                        loc.classList.remove('hidden');
                        loc.removeAttribute('hidden');
                    });

                    return allLocations.length;
                });
                console.error(`📍 Locations in DOM BEFORE click: ${beforeCount}`);

                if (clicked) {
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait longer for locations to expand
                    console.error('📍 Expanded all locations');

                    // Force visibility again after button click animation
                    const afterCount = await this.page.evaluate(() => {
                        const allLocations = document.querySelectorAll('.profile-location');
                        allLocations.forEach(loc => {
                            loc.style.display = 'flex';
                            loc.style.visibility = 'visible';
                            loc.style.opacity = '1';
                        });
                        return allLocations.length;
                    });
                    console.error(`📍 Locations in DOM AFTER click: ${afterCount}`);
                }

            } catch (e) {
                // Button may not exist for companies with single location
                console.error('📍 No "Show All Location" button found (single location company)');
            }

            // Extract company data
            console.error('📊 Extracting company data...');
            const companyData = await this.extractCompanyData(url);

            console.error(`✅ Successfully scraped: ${url}`);
            return companyData;

        } catch (error) {
            console.error(`❌ Error scraping ${url}:`, error.message);
            return null;
        }
    }

    async extractCompanyData(url) {
        // Extract company slug from URL
        const urlParts = new URL(url);
        const slug = path.basename(urlParts.pathname);

        const data = await this.page.evaluate((pageUrl, pageSlug) => {
            // Helper function to safely get text content
            const getText = (selector) => {
                const element = document.querySelector(selector);
                return element ? element.textContent.trim() : '';
            };

            // Helper function to get all text from multiple elements
            const getAllText = (selector) => {
                const elements = document.querySelectorAll(selector);
                return Array.from(elements).map(el => el.textContent.trim()).filter(text => text);
            };

            // Helper function to extract numbers from text
            const extractNumber = (text) => {
                const match = text.match(/[\d,]+/);
                return match ? parseInt(match[0].replace(/,/g, '')) : 0;
            };

            const allText = document.body ? document.body.innerText : '';

            // ===== COMPANY NAME =====
            const companyName = getText('h1') ||
                getText('.company-name') ||
                pageSlug.replace(/-/g, ' ');

            // ===== COMPANY IMAGE - Extract actual URL from profile-header-logo =====
            let companyImage = '';
            const headerLogoImg = document.querySelector('.profile-header-logo img');
            if (headerLogoImg && headerLogoImg.src) {
                companyImage = headerLogoImg.src;
            }
            // Fallback: try other selectors
            if (!companyImage) {
                const assetImg = document.querySelector('img[src*="assets.goodfirms.co/services"]');
                if (assetImg && assetImg.src) {
                    companyImage = assetImg.src;
                }
            }

            // ===== DESCRIPTION - Improved extraction =====
            let description = '';

            // Method 1: Look for description in company-about or overview sections
            const aboutSection = document.querySelector('.company-about, .about-company, [class*="about"], [class*="overview"]');
            if (aboutSection) {
                const paragraphs = aboutSection.querySelectorAll('p');
                if (paragraphs.length > 0) {
                    description = Array.from(paragraphs)
                        .map(p => p.textContent.trim())
                        .filter(t => t.length > 50)
                        .join(' ');
                }
            }

            // Method 2: Look for meta description or og:description
            if (!description) {
                const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
                if (metaDesc) {
                    description = metaDesc.content || '';
                }
            }

            // Method 3: Find the longest paragraph that looks like a company description
            if (!description) {
                const allParagraphs = document.querySelectorAll('p');
                const candidates = Array.from(allParagraphs)
                    .map(p => p.textContent.trim())
                    .filter(text =>
                        text.length > 100 &&
                        text.length < 2000 &&
                        !text.includes('Write a Review') &&
                        !text.includes('Post a Project') &&
                        !text.includes('@') &&
                        !text.match(/^\d+$/)
                    );
                description = candidates[0] || '';
            }

            // ===== RATING AND REVIEWS =====
            let rating = 0;
            let totalReviews = 0;

            // Look for rating in structured elements
            const ratingEl = document.querySelector('.rating-score, [class*="rating"] .score, [class*="rating-num"]');
            if (ratingEl) {
                rating = parseFloat(ratingEl.textContent.trim()) || 0;
            }

            // Try regex pattern on page text
            if (!rating) {
                const ratingMatch = allText.match(/(\d+\.?\d*)\s*(?:out of 5|\/5|\n\s*\d+\s*Reviews?)/i);
                rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
            }

            const reviewsMatch = allText.match(/(\d+)\s*Reviews?/i);
            totalReviews = reviewsMatch ? parseInt(reviewsMatch[1]) : 0;

            // ===== WEBSITE =====
            let website = '';
            const visitWebsiteBtn = document.querySelector('a[href*="utm_source=Goodfirms"], a.visit-website, a[class*="website"]');
            if (visitWebsiteBtn) {
                website = visitWebsiteBtn.href;
            }
            if (!website) {
                const externalLinks = Array.from(document.querySelectorAll('a[href*="http"]'))
                    .filter(a =>
                        !a.href.includes('goodfirms.co') &&
                        !a.href.includes('linkedin.com') &&
                        !a.href.includes('facebook.com') &&
                        !a.href.includes('twitter.com') &&
                        !a.href.includes('javascript') &&
                        !a.href.includes('mailto') &&
                        !a.href.includes('tel')
                    );
                website = externalLinks[0]?.href || '';
            }

            // ===== BUSINESS DETAILS - Using proper GoodFirms selectors =====
            let foundedYear = null;
            let teamSize = '';
            let hourlyRate = '';

            // Use proper GoodFirms selectors from .profile-overview-details-wrap
            const hourlyRateEl = document.querySelector('.profile-pricing span');
            if (hourlyRateEl) {
                const rateText = hourlyRateEl.textContent.trim();
                hourlyRate = rateText !== 'NA' ? rateText : '';
            }

            const employeesEl = document.querySelector('.profile-employees span');
            if (employeesEl) {
                teamSize = employeesEl.textContent.trim();
            }

            const foundedEl = document.querySelector('.profile-founded span');
            if (foundedEl) {
                const yearText = foundedEl.textContent.trim();
                const yearMatch = yearText.match(/(19|20)\d{2}/);
                if (yearMatch) foundedYear = parseInt(yearMatch[0]);
            }

            // Fallback: Look for info cards/sidebar items if primary selectors fail
            if (!foundedYear || !teamSize) {
                const infoItems = document.querySelectorAll('.info-item, .company-info li, [class*="detail"] li, [class*="info-card"], .profile-info-item');
                infoItems.forEach(item => {
                    const text = item.textContent.trim();

                    // Founded year fallback
                    if (!foundedYear && text.match(/founded|established|since|year/i)) {
                        const yearMatch = text.match(/(19|20)\d{2}/);
                        if (yearMatch) foundedYear = parseInt(yearMatch[0]);
                    }

                    // Team size fallback
                    if (!teamSize && text.match(/employees?|team\s*size|people|staff/i)) {
                        const sizeMatch = text.match(/(\d+[\s\-\+]*[\d,]*)/);
                        if (sizeMatch) teamSize = sizeMatch[0].trim();
                    }

                    // Hourly rate fallback
                    if (!hourlyRate && text.match(/hourly|rate|\$.*\/hr/i)) {
                        const rateMatch = text.match(/[<>]?\s*\$\d+[\s\-]*\$?\d*\s*\/?\s*hr?/i);
                        if (rateMatch) hourlyRate = rateMatch[0].trim();
                    }
                });
            }

            // Final fallback patterns on full text
            if (!foundedYear) {
                const foundedMatch = allText.match(/(?:Founded|Established|Since)\s*:?\s*((?:19|20)\d{2})/i);
                foundedYear = foundedMatch ? parseInt(foundedMatch[1]) : null;
            }

            if (!teamSize) {
                // Look for patterns like "1,000 - 9,999" or "50-249 employees"
                const teamPatterns = [
                    /(\d{1,3}(?:,\d{3})*\s*[-–]\s*\d{1,3}(?:,\d{3})*)\s*(?:employees?)?/i,
                    /(\d+\s*[-–+]\s*\d+)\s*(?:employees?|people|members)/i,
                    /(\d+\+?)\s*(?:employees?|people|team members)/i
                ];
                for (const pattern of teamPatterns) {
                    const match = allText.match(pattern);
                    if (match) {
                        teamSize = match[1].trim();
                        break;
                    }
                }
            }

            if (!hourlyRate) {
                const rateMatch = allText.match(/[<>]?\s*\$\s*\d+[\s\-]*\$?\d*\s*\/?\s*hr/i);
                hourlyRate = rateMatch ? rateMatch[0].trim() : '';
            }

            // ===== LOCATIONS (Multiple) =====
            let locations = [];
            const knownCountries = ['United States', 'USA', 'Canada', 'United Kingdom', 'UK', 'Australia', 'India', 'Germany', 'France', 'Ukraine', 'Philippines', 'Poland', 'Netherlands', 'Spain', 'Italy', 'Ireland', 'Switzerland', 'Belgium', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Austria', 'Singapore', 'Hong Kong', 'Japan', 'South Korea', 'China', 'Brazil', 'Mexico', 'Argentina', 'Chile', 'Colombia', 'South Africa', 'Nigeria', 'Kenya', 'Egypt', 'UAE', 'Saudi Arabia', 'Israel', 'Turkey', 'Russia', 'Czech Republic', 'Romania', 'Hungary', 'Bulgaria', 'Croatia', 'Serbia', 'Greece', 'Portugal', 'New Zealand', 'Vietnam', 'Thailand', 'Malaysia', 'Indonesia', 'Pakistan', 'Bangladesh'];

            const normalizeCountry = (c) => c.replace('USA', 'United States').replace('UK', 'United Kingdom');

            // Method 1: Use proper GoodFirms CSS selectors (from actual page structure)
            // Structure: .profile-location > .country-name, .profile-location-address span[], .entity-telephone
            const locationBlocks = document.querySelectorAll('.profile-location');

            if (locationBlocks.length > 0) {
                locationBlocks.forEach(block => {
                    // Extract country
                    const countryEl = block.querySelector('.country-name');
                    const country = countryEl ? normalizeCountry(countryEl.textContent.trim()) : '';

                    // Extract address parts from spans
                    const addressEl = block.querySelector('.profile-location-address');
                    let address = '';
                    let city = '';
                    let state = '';
                    let zip = '';

                    if (addressEl) {
                        const spans = addressEl.querySelectorAll('span');
                        const parts = Array.from(spans).map(s => s.textContent.trim()).filter(t => t);

                        // GoodFirms format: [Street Address], [City], [State/Region], [ZIP/Postal Code]
                        if (parts.length >= 1) address = parts[0];
                        if (parts.length >= 2) city = parts[1];
                        if (parts.length >= 3) state = parts[2];
                        if (parts.length >= 4) zip = parts[3];

                        // Full address string
                        address = parts.join(', ').replace(/,\s*,/g, ',').trim();
                    }

                    // Extract phone from entity-telephone
                    const phoneEl = block.querySelector('.entity-telephone');
                    const phone = phoneEl ? phoneEl.textContent.trim() : '';

                    if (country || address) {
                        locations.push({
                            country: country,
                            address: address,
                            city: city,
                            state: state,
                            zip: zip,
                            phone: phone
                        });
                    }
                });
            }

            // Method 2: Fallback - try alternative selectors or text parsing
            if (locations.length === 0) {
                // Try finding location blocks with alternative selectors
                const altBlocks = document.querySelectorAll('.company-location, [class*="location-item"], [class*="address-block"]');

                altBlocks.forEach(block => {
                    const text = block.textContent.trim();
                    let country = '';
                    for (const c of knownCountries) {
                        if (text.includes(c)) {
                            country = normalizeCountry(c);
                            break;
                        }
                    }

                    // Extract phone
                    const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
                    const phone = phoneMatch ? phoneMatch[0].trim() : '';

                    let address = text;
                    if (country) address = address.replace(country, '').trim();
                    if (phone) address = address.replace(phone, '').trim();
                    address = address.replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();

                    if (country || address) {
                        locations.push({
                            country: country,
                            address: address,
                            city: '',
                            state: '',
                            zip: '',
                            phone: phone
                        });
                    }
                });
            }

            // Method 3: Final fallback - simple country detection
            if (locations.length === 0) {
                let location = { country: '', address: '', city: '', state: '', zip: '', phone: '' };

                const locationEl = document.querySelector('.location, [class*="address"], [class*="location"]');
                if (locationEl) {
                    location.address = locationEl.textContent.trim();
                }

                for (const country of knownCountries) {
                    if (allText.includes(country)) {
                        location.country = normalizeCountry(country);
                        break;
                    }
                }

                if (location.country || location.address) {
                    locations.push(location);
                }
            }

            // Remove duplicates based on country + address combination
            locations = locations.filter((loc, idx, arr) =>
                arr.findIndex(l => l.country === loc.country && l.address === loc.address) === idx
            );

            // For backward compatibility, also keep single location reference
            const primaryLocation = locations.length > 0 ? locations[0] : { country: '', address: '', city: '', state: '', zip: '', phone: '' };

            // ===== SERVICE FOCUS - Extract from GoodFirms charts =====
            let serviceFocus = { bpo_services: {}, industry_focus: {}, client_focus: {} };

            // Extract BPO Services from chart-legend-item elements
            const chartLegendItems = document.querySelectorAll('.chart-legend-item, [class*="chart-legend"] li');
            chartLegendItems.forEach(item => {
                const text = item.textContent.trim();
                // Match pattern like "Customer Service - 20%" or "Call Center Services - 10%"
                const match = text.match(/^(.+?)\s*[-–]\s*(\d+)\s*%/);
                if (match) {
                    const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
                    const value = parseInt(match[2]);
                    if (key && value) {
                        serviceFocus.bpo_services[key] = value;
                    }
                }
            });

            // Extract Industry Focus from industries-chips elements
            const industryChips = document.querySelectorAll('.industries-chips li, [class*="industry"] li');
            industryChips.forEach(item => {
                const text = item.textContent.trim();
                const match = text.match(/^(.+?)\s*[-–]\s*(\d+)\s*%/);
                if (match) {
                    const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
                    const value = parseInt(match[2]);
                    if (key && value) {
                        serviceFocus.industry_focus[key] = value;
                    }
                }
            });

            // Extract Client Focus (Small/Medium/Large Business)
            const clientFocusItems = document.querySelectorAll('[class*="client-focus"] li, [class*="client"] .chart-legend-item');
            clientFocusItems.forEach(item => {
                const text = item.textContent.trim();
                const match = text.match(/^(.+?)\s*[-–]\s*(\d+)\s*%/);
                if (match) {
                    const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
                    const value = parseInt(match[2]);
                    if (key && value) {
                        serviceFocus.client_focus[key] = value;
                    }
                }
            });

            // Fallback: Parse from any element with percentage pattern
            if (Object.keys(serviceFocus.bpo_services).length === 0) {
                const allPercentElements = document.querySelectorAll('li, span, div');
                allPercentElements.forEach(el => {
                    const text = el.textContent.trim();
                    // Only match if it looks like a service percentage (short text with %)
                    if (text.length < 60 && text.includes('%') && text.includes('-')) {
                        const match = text.match(/^(.+?)\s*[-–]\s*(\d+)\s*%$/);
                        if (match) {
                            const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
                            const value = parseInt(match[2]);
                            if (key && value && key.length > 2) {
                                serviceFocus.bpo_services[key] = value;
                            }
                        }
                    }
                });
            }

            // ===== CONTACT INFO =====
            const emails = Array.from(new Set([
                ...Array.from(document.querySelectorAll('a[href^="mailto:"]'))
                    .map(a => a.href.replace('mailto:', '').split('?')[0]),
                ...(allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
            ])).filter(email => !email.includes('goodfirms'));

            const phones = Array.from(new Set([
                ...Array.from(document.querySelectorAll('a[href^="tel:"]'))
                    .map(a => a.href.replace('tel:', '')),
                ...(allText.match(/(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [])
            ])).slice(0, 5);

            // ===== SOCIAL MEDIA =====
            const socialLinks = {
                linkedin: Array.from(document.querySelectorAll('a[href*="linkedin.com/company"]'))[0]?.href || '',
                twitter: Array.from(document.querySelectorAll('a[href*="twitter.com"], a[href*="x.com"]'))[0]?.href || '',
                facebook: Array.from(document.querySelectorAll('a[href*="facebook.com"]'))
                    .find(a => !a.href.includes('goodfirms'))?.href || ''
            };

            // ===== DETAILED REVIEWS - Using proper GoodFirms selectors =====
            const detailedReviews = [];

            // Review metrics from analytics section
            const metricsSection = document.querySelector('.profile-review-metrics-section-wrap');
            let totalReviewsFromMetrics = totalReviews;
            let recentReviewsCount = 0;

            if (metricsSection) {
                const metrics = metricsSection.querySelectorAll('.review-metrics-accent');
                metrics.forEach((metric, i) => {
                    const value = metric.textContent.trim();
                    const titleEl = metric.closest('dl')?.querySelector('.review-metrics-title');
                    const title = titleEl?.textContent?.trim()?.toLowerCase() || '';

                    if (title.includes('total')) {
                        totalReviewsFromMetrics = parseInt(value) || totalReviews;
                    } else if (title.includes('recent')) {
                        recentReviewsCount = parseInt(value) || 0;
                    }
                });
            }

            // What users like most / least
            const strengthsList = [];
            const weaknessesList = [];

            document.querySelectorAll('.strength-containers li').forEach(li => {
                const text = li.textContent.trim();
                if (text && text.length > 3) strengthsList.push(text);
            });

            document.querySelectorAll('.weakness-containers li').forEach(li => {
                const text = li.textContent.trim();
                if (text && text.length > 3) weaknessesList.push(text);
            });

            // Extract detailed reviews using proper selectors
            const reviewArticles = document.querySelectorAll('.profile-review');

            reviewArticles.forEach((review, index) => {
                if (index >= 10) return; // Max 10 reviews

                // Reviewer name - get from span inside .reviewer-name
                const reviewerNameEl = review.querySelector('.reviewer-name span');
                const reviewerFullEl = review.querySelector('.reviewer-name');
                let author = reviewerNameEl?.textContent?.trim() || 'Anonymous';
                let company = '';

                if (reviewerFullEl) {
                    const fullText = reviewerFullEl.textContent.trim();
                    const atMatch = fullText.match(/at\s+(.+?)(?:\s*$)/);
                    if (atMatch) company = atMatch[1].trim();
                }

                // Posted date
                const dateEl = review.querySelector('.review-date');
                const dateRelative = dateEl?.textContent?.replace('Posted', '').trim() || '';

                // Review title (h3.review-title)
                const titleEl = review.querySelector('.review-title');
                const title = titleEl?.textContent?.trim() || '';

                // Review summary/content
                const summaryEl = review.querySelector('.review-summary');
                const content = summaryEl?.textContent?.trim() || '';

                // Project info
                let projectName = '';
                let serviceProvided = '';
                let projectDescription = '';
                let whatTheyLike = '';
                let whatToImprove = '';
                let projectStatus = '';
                let projectIndustry = '';

                const projectInfos = review.querySelectorAll('.project-info');
                projectInfos.forEach(info => {
                    const question = info.querySelector('h4')?.textContent?.trim()?.toLowerCase() || '';
                    const answer = info.querySelector('p')?.textContent?.trim() || '';

                    if (question.includes('project name')) projectName = answer;
                    else if (question.includes('service was provided')) serviceProvided = answer;
                    else if (question.includes('describe your project')) projectDescription = answer;
                    else if (question.includes('appreciate the most')) whatTheyLike = answer;
                    else if (question.includes('didn\'t like') || question.includes('should do better')) whatToImprove = answer;
                });

                // Project details (status, industry)
                const projectDetails = review.querySelectorAll('.project-services-list li');
                projectDetails.forEach(li => {
                    const tooltip = li.getAttribute('data-content') || '';
                    const value = li.querySelector('span:last-child')?.textContent?.trim() || '';

                    if (tooltip.includes('Status')) projectStatus = value;
                    else if (tooltip.includes('Industry')) projectIndustry = value;
                });

                // Rating from stars (width percentage / 20 = rating out of 5)
                let quality = 5, scheduleTiming = 5, communication = 5, overall = 5;

                const ratingItems = review.querySelectorAll('.review-rating-breakdown-list li');
                ratingItems.forEach(item => {
                    const label = item.querySelector('span:first-child')?.textContent?.trim()?.toLowerCase() || '';
                    const starEl = item.querySelector('.rating-star-container');
                    if (starEl) {
                        const widthStyle = starEl.getAttribute('style') || '';
                        const widthMatch = widthStyle.match(/width:\s*(\d+)%/);
                        const ratingValue = widthMatch ? parseInt(widthMatch[1]) / 20 : 5;

                        if (label.includes('quality')) quality = ratingValue;
                        else if (label.includes('schedule') || label.includes('timing')) scheduleTiming = ratingValue;
                        else if (label.includes('communication')) communication = ratingValue;
                        else if (label.includes('overall')) overall = ratingValue;
                    }
                });

                if (title || content) {
                    detailedReviews.push({
                        title: title.substring(0, 300),
                        content: content.substring(0, 2000),
                        author: author,
                        author_company: company,
                        date_relative: dateRelative,
                        project_name: projectName,
                        service_provided: serviceProvided,
                        project_description: projectDescription,
                        what_they_like: whatTheyLike,
                        what_to_improve: whatToImprove,
                        project_status: projectStatus,
                        project_industry: projectIndustry,
                        rating_breakdown: {
                            quality: quality,
                            schedule_timing: scheduleTiming,
                            communication: communication,
                            overall: overall
                        }
                    });
                }
            });

            // ===== PORTFOLIO / CLIENTS =====
            let clients = [];
            let caseStudies = [];

            // Look for client logos
            const clientSection = document.querySelector('[class*="client"], [class*="portfolio"], [class*="customer"]');
            if (clientSection) {
                const clientImages = clientSection.querySelectorAll('img[alt]');
                clients = Array.from(clientImages)
                    .map(img => img.alt)
                    .filter(alt => alt && alt.length > 2 && alt.length < 100 && !alt.includes('logo') && !alt.includes('icon'));
            }

            // Look for case study/project cards - filter out form fields
            const projectCards = document.querySelectorAll('[class*="case-study"], [class*="portfolio-item"], [class*="project-card"]');
            projectCards.forEach((card, index) => {
                if (index >= 5) return;
                const title = card.querySelector('h3, h4, .title')?.textContent?.trim();
                const image = card.querySelector('img')?.src;
                // Filter out form field labels
                if (title &&
                    title.length > 10 &&
                    !title.includes('What was') &&
                    !title.includes('Describe') &&
                    !title.includes('project name') &&
                    !title.includes('service was provided')) {
                    caseStudies.push({ title, image: image || '', client: '' });
                }
            });

            // ===== VERIFICATION STATUS =====
            const isVerified = !!document.querySelector('[class*="verified"], .verified-badge') ||
                allText.includes('Verified Company') ||
                allText.includes('✓ Verified');
            const isClaimed = allText.includes('Claimed') || !!document.querySelector('[class*="claimed"]');

            return {
                metadata: {
                    source: pageUrl,
                    scraped_at: new Date().toISOString(),
                    company_slug: pageSlug,
                    scraping_mode: "detailed_puppeteer_extraction",
                    note: "Comprehensive data extracted using Puppeteer browser automation"
                },
                company: {
                    basic_info: {
                        name: companyName,
                        slug: pageSlug,
                        description: description.substring(0, 2000),
                        website: website,
                        profile_url: pageUrl,
                        image: companyImage || `https://assets.goodfirms.co/services/medium/${pageSlug}.png`,
                        is_verified: isVerified,
                        is_claimed: isClaimed,
                        linkedin: socialLinks.linkedin
                    },
                    business_details: {
                        founded_year: foundedYear,
                        team_size: teamSize,
                        hourly_rate: hourlyRate,
                        location: primaryLocation,
                        locations: locations
                    },
                    service_focus: serviceFocus,
                    reviews: {
                        overall_rating: rating,
                        total_reviews: totalReviewsFromMetrics || totalReviews,
                        recent_reviews: recentReviewsCount || Math.min(totalReviews, Math.floor(totalReviews * 0.7)),
                        strengths: strengthsList,
                        weaknesses: weaknessesList,
                        detailed_reviews: detailedReviews
                    },
                    contact_info: {
                        phones: phones,
                        social_media: socialLinks
                    }
                }
            };
        }, url, slug);

        return data;
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.error('🔒 Browser closed');
        }
    }

    // Method to scrape multiple companies with rate limiting
    async scrapeMultiple(urls, delay = 5000) {
        const results = [];

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.error(`\n📋 Processing ${i + 1}/${urls.length}: ${url}`);

            const result = await this.scrapeCompany(url);
            if (result) {
                results.push(result);
                console.error(`✅ Success: ${result.company.basic_info.name}`);
            } else {
                console.error(`❌ Failed: ${url}`);
            }

            // Add delay between requests (except for the last one)
            if (i < urls.length - 1) {
                console.error(`⏱️  Waiting ${delay}ms before next request...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return results;
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: node puppeteer-scraper.js <url1> [url2] [url3] ...');
        console.error('Example: node puppeteer-scraper.js "https://www.goodfirms.co/company/hugo"');
        process.exit(1);
    }

    const scraper = new GoodFirmsScraper();

    try {
        await scraper.init();

        const urls = args;
        console.error(`\n🎯 Starting to scrape ${urls.length} URLs...\n`);

        const results = await scraper.scrapeMultiple(urls, 10000); // 10 second delay

        // Save results to file
        const outputPath = path.join(process.cwd(), 'storage', 'app', 'public', `scraped-companies-${Date.now()}.json`);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(results, null, 2));

        console.error(`\n📁 Results saved to: ${outputPath}`);
        console.error(`📊 Summary: ${results.length}/${urls.length} companies scraped successfully`);

        // Also output to stdout for Laravel to parse (single company)
        if (results.length === 1) {
            console.log(JSON.stringify(results[0]));
        } else {
            console.log(JSON.stringify(results));
        }

    } catch (error) {
        console.error('💥 Fatal error:', error);
        process.exit(1);
    } finally {
        await scraper.close();
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default GoodFirmsScraper;
