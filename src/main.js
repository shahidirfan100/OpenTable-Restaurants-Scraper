// OpenTable Restaurants Scraper - PlaywrightCrawler with Firefox
import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';
import { firefox } from 'playwright';

await Actor.init();

// Stealth User Agents - Firefox on various OS
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

try {
    const input = (await Actor.getInput()) || {};
    const {
        start_url,
        date,
        time,
        covers = 2,
        location,
        results_wanted: RESULTS_WANTED_RAW = 20,
        proxyConfiguration,
    } = input;

    const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 20;

    // Build search URL from parameters if no start_url provided
    const buildSearchUrl = () => {
        if (start_url) return start_url;

        const baseUrl = new URL('https://www.opentable.com/s');

        // Build dateTime parameter
        if (date && time) {
            baseUrl.searchParams.set('dateTime', `${date}T${time}:00`);
        } else if (date) {
            baseUrl.searchParams.set('dateTime', `${date}T19:00:00`);
        }

        if (covers) baseUrl.searchParams.set('covers', String(covers));
        if (location) baseUrl.searchParams.set('term', location);

        return baseUrl.href;
    };

    const searchUrl = buildSearchUrl();
    log.info(`Starting scrape from: ${searchUrl}`);
    log.info(`Target results: ${RESULTS_WANTED}`);

    const proxyConf = proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
        : undefined;

    let saved = 0;
    const seenIds = new Set();

    const crawler = new PlaywrightCrawler({
        launchContext: {
            launcher: firefox,
            launchOptions: {
                headless: true,
            },
            userAgent: getRandomUserAgent(),
        },
        proxyConfiguration: proxyConf,
        maxConcurrency: 3,
        maxRequestRetries: 2,
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 120,

        // Block heavy resources for performance
        preNavigationHooks: [
            async ({ page }) => {
                await page.route('**/*', (route) => {
                    const type = route.request().resourceType();
                    const url = route.request().url();

                    // Block images, fonts, media, and common trackers
                    if (['image', 'font', 'media'].includes(type) ||
                        url.includes('google-analytics') ||
                        url.includes('googletagmanager') ||
                        url.includes('facebook') ||
                        url.includes('doubleclick') ||
                        url.includes('adsense') ||
                        url.includes('hotjar')) {
                        return route.abort();
                    }
                    return route.continue();
                });
            },
        ],

        requestHandler: async ({ page, request }) => {
            log.info(`Processing: ${request.url}`);

            // Wait for page to load
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
            await page.waitForTimeout(2000);

            // Try to extract data from __INITIAL_STATE__
            let restaurants = [];
            let totalCount = 0;

            try {
                const stateData = await page.evaluate(() => {
                    const state = window.__INITIAL_STATE__;
                    if (!state) return null;

                    // Try different paths for restaurant data
                    let restaurantData = null;
                    let total = 0;

                    // Path 1: lolzViewAll (collection pages)
                    if (state.lolzViewAll?.searchResults?.restaurants) {
                        restaurantData = state.lolzViewAll.searchResults.restaurants;
                        total = state.lolzViewAll.searchResults.totalRestaurantCount || restaurantData.length;
                    }
                    // Path 2: search results
                    else if (state.search?.results) {
                        restaurantData = state.search.results;
                        total = state.search.totalResults || restaurantData.length;
                    }
                    // Path 3: discovery
                    else if (state.discovery?.restaurants) {
                        restaurantData = state.discovery.restaurants;
                        total = restaurantData.length;
                    }
                    // Path 4: availability
                    else if (state.availability?.restaurants) {
                        restaurantData = state.availability.restaurants;
                        total = restaurantData.length;
                    }

                    return { restaurants: restaurantData, total };
                });

                if (stateData?.restaurants) {
                    restaurants = stateData.restaurants;
                    totalCount = stateData.total;
                    log.info(`Found ${restaurants.length} restaurants in __INITIAL_STATE__ (total: ${totalCount})`);
                }
            } catch (err) {
                log.warning(`Failed to extract __INITIAL_STATE__: ${err.message}`);
            }

            // If we need more restaurants and there are more available, scroll to load
            if (restaurants.length < RESULTS_WANTED && restaurants.length < totalCount) {
                log.info('Scrolling to load more restaurants...');

                let previousCount = restaurants.length;
                let scrollAttempts = 0;
                const maxScrolls = 20;

                while (scrollAttempts < maxScrolls && saved + restaurants.length < RESULTS_WANTED) {
                    await page.evaluate(() => {
                        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                    });
                    await page.waitForTimeout(1500);

                    // Re-extract data after scroll
                    const newData = await page.evaluate(() => {
                        const state = window.__INITIAL_STATE__;
                        if (state?.lolzViewAll?.searchResults?.restaurants) {
                            return state.lolzViewAll.searchResults.restaurants;
                        }
                        if (state?.search?.results) return state.search.results;
                        return null;
                    });

                    if (newData && newData.length > previousCount) {
                        restaurants = newData;
                        previousCount = newData.length;
                        log.info(`Loaded ${restaurants.length} restaurants after scroll`);
                    } else {
                        scrollAttempts++;
                    }

                    if (restaurants.length >= totalCount) break;
                }
            }

            // Process and save restaurants
            const remaining = RESULTS_WANTED - saved;
            const toProcess = restaurants.slice(0, remaining);

            for (const r of toProcess) {
                const id = r.rid || r.restaurantId || r.id;
                if (id && seenIds.has(id)) continue;
                if (id) seenIds.add(id);

                const item = {
                    name: r.name || null,
                    cuisine: r.cuisine?.name || r.primaryCuisine || r.cuisineType || null,
                    price_range: r.priceBand || r.priceRange || null,
                    rating: r.starRating || r.rating || null,
                    reviews_count: r.reviewCount || r.numberOfReviews || null,
                    neighborhood: r.neighborhood || r.location?.neighborhood || null,
                    city: r.city || r.location?.city || null,
                    booking_slots: r.availabilitySlots || r.timeslots || r.slots || [],
                    url: r.profileLink
                        ? `https://www.opentable.com${r.profileLink}`
                        : r.url || (id ? `https://www.opentable.com/r/${id}` : null),
                    image_url: r.primaryPhoto?.uri || r.photo || r.imageUrl || null,
                    restaurant_id: id || null,
                };

                await Dataset.pushData(item);
                saved++;

                if (saved >= RESULTS_WANTED) break;
            }

            log.info(`Saved ${saved}/${RESULTS_WANTED} restaurants`);
        },

        failedRequestHandler: async ({ request }, error) => {
            if (error.message?.includes('403')) {
                log.warning(`Blocked (403): ${request.url}`);
            } else {
                log.error(`Failed: ${request.url}`, { error: error.message });
            }
        },
    });

    await crawler.run([{ url: searchUrl }]);
    log.info(`Finished. Total restaurants saved: ${saved}`);

} finally {
    await Actor.exit();
}
