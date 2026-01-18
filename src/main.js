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
const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const getCandidateName = (value) => value?.name || value?.restaurantName || value?.title || value?.displayName || value?.listingName || null;
const normalizeNameKey = (name) => {
    if (typeof name !== 'string') return null;
    return name
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
};
const normalizeUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    if (trimmed.startsWith('/')) return `https://www.opentable.com${trimmed}`;
    if (trimmed.includes('opentable.com/')) return `https://${trimmed.replace(/^https?:\/\//, '')}`;
    return null;
};

const extractSlugFromUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    const match = value.match(/\/r\/([^/?#]+)/i);
    return match?.[1] || null;
};

const getRestaurantId = (value) => value?.rid || value?.restaurantId || value?.restaurant_id || value?.id || value?.restaurantID || null;
const getRestaurantSlug = (value) => {
    const slug = value?.slug || value?.urlSlug || value?.seo?.slug || value?.seo?.urlSlug;
    if (typeof slug === 'string' && slug.trim()) return slug.trim();
    const urlCandidate = value?.profileLink || value?.canonicalUrl || value?.url || value?.href || value?.permalink || value?.path;
    return extractSlugFromUrl(String(urlCandidate || ''));
};

const getRestaurantUrl = (value) => {
    const rawUrl = value?.profileLink
        || value?.links?.profile?.href
        || value?.links?.restaurant?.href
        || value?.urls?.profile
        || value?.urls?.restaurant
        || value?.restaurantUrl
        || value?.restaurant_url
        || value?.canonicalUrl
        || value?.canonicalURL
        || value?.seo?.canonicalUrl
        || value?.seo?.canonicalURL
        || value?.url
        || value?.href
        || value?.permalink
        || value?.path;
    const normalized = normalizeUrl(rawUrl);
    if (normalized) return normalized;

    const slug = value?.slug || value?.urlSlug || value?.seo?.slug || value?.seo?.urlSlug;
    if (typeof slug === 'string' && /[a-zA-Z]/.test(slug)) {
        return `https://www.opentable.com/r/${slug}`;
    }
    return null;
};

const getRestaurantRating = (value) => value?.starRating
    || value?.rating
    || value?.reviewScore
    || value?.reviewRating
    || value?.reviews?.rating
    || value?.reviews?.score
    || value?.reviews?.averageRating
    || null;

const getRestaurantReviewsCount = (value) => value?.reviewCount
    || value?.reviewsCount
    || value?.numberOfReviews
    || value?.review_count
    || value?.reviews?.count
    || value?.reviews?.total
    || value?.reviews?.reviewCount
    || null;

const getRestaurantImage = (value) => value?.primaryPhoto?.uri
    || value?.primaryPhoto?.url
    || value?.photo?.uri
    || value?.photo?.url
    || value?.image?.url
    || value?.image?.src
    || value?.imageUrl
    || value?.image_url
    || value?.photos?.[0]?.url
    || value?.images?.[0]?.url
    || null;

const hasRestaurantMeta = (value) => Boolean(
    value?.priceBand || value?.priceRange || value?.priceCategory
    || getRestaurantRating(value) || getRestaurantReviewsCount(value)
    || value?.cuisine || value?.primaryCuisine || value?.cuisines,
);
const isLikelyRestaurant = (value) => Boolean(getCandidateName(value) && (getRestaurantUrl(value) || hasRestaurantMeta(value)));
const scoreRestaurantList = (restaurants) => {
    const total = restaurants.length || 0;
    if (!total) return 0;
    let nameCount = 0;
    let urlCount = 0;
    let ratingCount = 0;
    let reviewsCount = 0;
    let imageCount = 0;
    for (const item of restaurants) {
        if (getCandidateName(item)) nameCount += 1;
        if (getRestaurantUrl(item)) urlCount += 1;
        if (getRestaurantRating(item)) ratingCount += 1;
        if (getRestaurantReviewsCount(item)) reviewsCount += 1;
        if (getRestaurantImage(item)) imageCount += 1;
    }
    const completeness = (
        (urlCount * 4)
        + (ratingCount * 2)
        + (reviewsCount * 2)
        + imageCount
        + nameCount
    ) / total;
    const lengthBonus = Math.min(total, 50) / 50;
    return (completeness * 10) + lengthBonus;
};

const collectDetailItemsFromData = (root, maxDepth = 6, maxItems = 600) => {
    if (!root || typeof root !== 'object') return [];
    const seen = new WeakSet();
    const items = [];

    const visit = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > maxDepth || items.length >= maxItems) return;
        if (seen.has(node)) return;
        seen.add(node);

        if (Array.isArray(node)) {
            for (const item of node) visit(item, depth + 1);
            return;
        }

        if (isLikelyRestaurant(node) && (getRestaurantUrl(node) || getRestaurantRating(node) || getRestaurantReviewsCount(node) || getRestaurantImage(node))) {
            items.push(node);
        }

        for (const value of Object.values(node)) {
            visit(value, depth + 1);
        }
    };

    visit(root, 0);
    return items;
};

const scoreRestaurantCandidate = (value) => {
    if (!isPlainObject(value) || !isLikelyRestaurant(value)) return 0;
    let score = 0;
    if (getCandidateName(value)) score += 3;
    if (value.rid || value.restaurantId || value.id || value.restaurant_id) score += 2;
    if (value.profileLink || value.canonicalUrl || value.url || value.slug) score += 2;
    if (value.priceBand || value.priceRange || value.price || value.priceCategory) score += 1;
    if (value.starRating || value.rating || value.reviewScore || value.reviewRating) score += 1;
    if (value.cuisine || value.primaryCuisine || value.cuisines) score += 1;
    return score;
};

// Fallback heuristic for unknown JSON shapes.
const findBestRestaurantArray = (root, maxDepth = 6) => {
    const seen = new WeakSet();
    let best = { items: [], matches: 0, score: 0 };

    const visit = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > maxDepth) return;
        if (seen.has(node)) return;
        seen.add(node);

        if (Array.isArray(node)) {
            const matching = node.filter(isLikelyRestaurant);
            if (matching.length > 0) {
                let score = 0;
                for (const item of matching) {
                    score += scoreRestaurantCandidate(item);
                }
                if (matching.length > best.matches || (matching.length === best.matches && score > best.score)) {
                    best = { items: matching, matches: matching.length, score };
                }
            }
            for (const item of node) visit(item, depth + 1);
            return;
        }

        for (const value of Object.values(node)) {
            visit(value, depth + 1);
        }
    };

    visit(root, 0);
    return best.items;
};

const extractRestaurantsFromData = (data) => {
    if (!data || typeof data !== 'object') return { restaurants: [], totalCount: 0, details: [] };

    const knownPaths = [
        data?.data?.search?.restaurants,
        data?.data?.search?.results,
        data?.data?.search?.searchResults?.restaurants,
        data?.data?.availability?.restaurants,
        data?.search?.restaurants,
        data?.search?.results,
        data?.restaurants,
    ];

    for (const arr of knownPaths) {
        if (Array.isArray(arr) && arr.length) {
            const filtered = arr.filter(isLikelyRestaurant);
            if (!filtered.length) continue;
            const totalCount = data?.data?.search?.totalRestaurantCount
                || data?.data?.search?.totalResults
                || data?.data?.search?.total
                || data?.search?.totalRestaurantCount
                || data?.search?.totalResults
                || data?.totalResults
                || 0;
            return { restaurants: filtered, totalCount, details: collectDetailItemsFromData(data) };
        }
    }

    return { restaurants: findBestRestaurantArray(data), totalCount: 0, details: collectDetailItemsFromData(data) };
};

const pickBestCandidate = (candidates) => {
    const usable = candidates.filter((candidate) => candidate?.restaurants?.length);
    if (!usable.length) return { restaurants: [], totalCount: 0, source: null };
    usable.sort((a, b) => scoreRestaurantList(b.restaurants) - scoreRestaurantList(a.restaurants)
        || b.restaurants.length - a.restaurants.length
        || (b.totalCount || 0) - (a.totalCount || 0));
    return usable[0];
};

const normalizeRestaurant = (r, detail) => {
    const base = r || {};
    const extra = detail || {};
    const cuisines = Array.isArray(base?.cuisines) ? base.cuisines : (Array.isArray(extra?.cuisines) ? extra.cuisines : []);
    const primaryCuisine = cuisines[0]?.name || cuisines[0] || null;
    const bookingSlots = base?.availabilitySlots || base?.timeslots || base?.slots || base?.availability?.slots
        || extra?.availabilitySlots || extra?.timeslots || extra?.slots || extra?.availability?.slots
        || [];

    return {
        name: getCandidateName(base) || getCandidateName(extra),
        cuisine: base?.cuisine?.name
            || base?.cuisine?.displayName
            || base?.primaryCuisine
            || base?.cuisineType
            || base?.cuisine
            || extra?.cuisine?.name
            || extra?.cuisine?.displayName
            || extra?.primaryCuisine
            || extra?.cuisineType
            || extra?.cuisine
            || primaryCuisine,
        price_range: base?.priceBand || base?.priceRange || base?.price || base?.priceCategory
            || extra?.priceBand || extra?.priceRange || extra?.price || extra?.priceCategory
            || null,
        rating: getRestaurantRating(base) || getRestaurantRating(extra),
        reviews_count: getRestaurantReviewsCount(base) || getRestaurantReviewsCount(extra),
        neighborhood: base?.neighborhood || base?.location?.neighborhood || base?.address?.neighborhood
            || extra?.neighborhood || extra?.location?.neighborhood || extra?.address?.neighborhood
            || null,
        city: base?.city || base?.location?.city || base?.address?.city
            || extra?.city || extra?.location?.city || extra?.address?.city
            || null,
        booking_slots: Array.isArray(bookingSlots) ? bookingSlots : [],
        url: getRestaurantUrl(base) || getRestaurantUrl(extra),
        image_url: getRestaurantImage(base) || getRestaurantImage(extra),
        restaurant_id: getRestaurantId(base) || getRestaurantId(extra),
    };
};

const buildRestaurantIndex = (items, maxPerKey = 8) => {
    const byId = new Map();
    const bySlug = new Map();
    const byName = new Map();
    const byNameNormalized = new Map();

    const add = (map, key, item) => {
        if (!key) return;
        const normalizedKey = String(key).toLowerCase();
        const list = map.get(normalizedKey) || [];
        if (list.includes(item)) return;
        list.push(item);
        if (list.length > maxPerKey) list.shift();
        map.set(normalizedKey, list);
    };

    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const id = getRestaurantId(item);
        if (id !== null && id !== undefined) add(byId, String(id), item);
        const slug = getRestaurantSlug(item);
        if (slug) add(bySlug, slug, item);
        const name = getCandidateName(item);
        if (name) add(byName, name, item);
        const normalizedName = normalizeNameKey(name);
        if (normalizedName) add(byNameNormalized, normalizedName, item);
    }

    return { byId, bySlug, byName, byNameNormalized };
};

const findRestaurantDetail = (restaurant, index) => {
    if (!restaurant || !index) return null;

    const hasValue = (value) => value !== null && value !== undefined && value !== '';
    const complementScore = (base, candidate) => {
        if (!candidate || typeof candidate !== 'object') return 0;
        let score = 0;

        if (!hasValue(getRestaurantUrl(base)) && hasValue(getRestaurantUrl(candidate))) score += 6;
        if (!hasValue(getRestaurantImage(base)) && hasValue(getRestaurantImage(candidate))) score += 3;
        if (!hasValue(getRestaurantRating(base)) && hasValue(getRestaurantRating(candidate))) score += 2;
        if (!hasValue(getRestaurantReviewsCount(base)) && hasValue(getRestaurantReviewsCount(candidate))) score += 2;

        if (!hasValue(base?.city) && !hasValue(base?.location?.city) && hasValue(candidate?.city || candidate?.location?.city)) score += 1;
        if (!hasValue(base?.neighborhood) && !hasValue(base?.location?.neighborhood) && hasValue(candidate?.neighborhood || candidate?.location?.neighborhood)) score += 1;
        if (!hasValue(base?.priceBand) && !hasValue(base?.priceRange) && !hasValue(base?.priceCategory) && hasValue(candidate?.priceBand || candidate?.priceRange || candidate?.priceCategory)) score += 1;
        if (!hasValue(base?.cuisine) && !hasValue(base?.primaryCuisine) && !hasValue(base?.cuisineType) && hasValue(candidate?.cuisine || candidate?.primaryCuisine || candidate?.cuisineType)) score += 1;

        return score;
    };

    const candidates = [];
    const addAll = (list) => {
        if (!Array.isArray(list)) return;
        for (const item of list) candidates.push(item);
    };

    const id = getRestaurantId(restaurant);
    if (id !== null && id !== undefined) addAll(index.byId.get(String(id)));
    const slug = getRestaurantSlug(restaurant);
    if (slug) addAll(index.bySlug.get(slug.toLowerCase()));
    const name = getCandidateName(restaurant);
    if (name) addAll(index.byName.get(name.toLowerCase()));
    const normalizedName = normalizeNameKey(name);
    if (normalizedName) addAll(index.byNameNormalized.get(normalizedName.toLowerCase()));

    if (!candidates.length && normalizedName) {
        for (const [key, list] of index.byNameNormalized.entries()) {
            if (!key || !list?.length) continue;
            if (key.includes(normalizedName) || normalizedName.includes(key)) addAll(list);
        }
    }

    let best = null;
    let bestScore = 0;
    for (const candidate of candidates) {
        const score = complementScore(restaurant, candidate);
        if (score > bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
};

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
    const seenUrls = new Set();
    const seenNames = new Set();

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
            async ({ page, request }) => {
                request.userData.jsonCandidates = [];
                request.userData.jsonDetailItems = [];
                const responseListener = async (response) => {
                    const contentType = response.headers()['content-type'] || '';
                    if (!contentType.includes('application/json')) return;
                    const url = response.url();
                    if (!/gql|graphql|search|results|availability|restaurants/i.test(url)) return;
                    try {
                        const data = await response.json();
                        const extracted = extractRestaurantsFromData(data);
                        if (extracted.restaurants.length) {
                            request.userData.jsonCandidates.push({ ...extracted, source: url });
                        }
                        if (extracted.details?.length) {
                            request.userData.jsonDetailItems.push(...extracted.details);
                            if (request.userData.jsonDetailItems.length > 1500) {
                                request.userData.jsonDetailItems = request.userData.jsonDetailItems.slice(-1500);
                            }
                        }
                    } catch {
                        // ignore json parse errors
                    }
                };
                request.userData.responseListener = responseListener;
                page.on('response', responseListener);

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
            const cleanupResponseListener = () => {
                const listener = request.userData?.responseListener;
                if (listener) page.off('response', listener);
            };

            log.info(`Processing: ${request.url}`);

            try {
                const waitForResultsReady = async () => {
                    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
                    await page.waitForFunction(() => window.__INITIAL_STATE__ || window.__NEXT_DATA__ || window.__APOLLO_STATE__, { timeout: 15000 }).catch(() => { });
                    await page.waitForTimeout(2000);
                };

                const extractFromPage = async () => {
                    return page.evaluate(() => {
                        const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
                        const getCandidateName = (value) => value?.name || value?.restaurantName || value?.title || value?.displayName || value?.listingName || null;
                        const normalizeNameKey = (name) => {
                            if (typeof name !== 'string') return null;
                            return name
                                .toLowerCase()
                                .replace(/&/g, ' and ')
                                .replace(/[^a-z0-9]+/g, ' ')
                                .trim();
                        };
                        const normalizeUrl = (value) => {
                            if (!value || typeof value !== 'string') return null;
                            const trimmed = value.trim();
                            if (!trimmed) return null;
                            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
                            if (trimmed.startsWith('//')) return `https:${trimmed}`;
                            if (trimmed.startsWith('/')) return `https://www.opentable.com${trimmed}`;
                            if (trimmed.includes('opentable.com/')) return `https://${trimmed.replace(/^https?:\/\//, '')}`;
                            return null;
                        };
                        const extractSlugFromUrl = (value) => {
                            if (!value || typeof value !== 'string') return null;
                            const match = value.match(/\/r\/([^/?#]+)/i);
                            return match?.[1] || null;
                        };
                        const getRestaurantId = (value) => value?.rid || value?.restaurantId || value?.restaurant_id || value?.id || value?.restaurantID || null;
                        const getRestaurantUrl = (value) => {
                            const rawUrl = value?.profileLink
                                || value?.links?.profile?.href
                                || value?.links?.restaurant?.href
                                || value?.urls?.profile
                                || value?.urls?.restaurant
                                || value?.restaurantUrl
                                || value?.restaurant_url
                                || value?.canonicalUrl
                                || value?.canonicalURL
                                || value?.seo?.canonicalUrl
                                || value?.seo?.canonicalURL
                                || value?.url
                                || value?.href
                                || value?.permalink
                                || value?.path;
                            const normalized = normalizeUrl(rawUrl);
                            if (normalized) return normalized;
                            const slug = value?.slug || value?.urlSlug || value?.seo?.slug || value?.seo?.urlSlug;
                            if (typeof slug === 'string' && /[a-zA-Z]/.test(slug)) {
                                return `https://www.opentable.com/r/${slug}`;
                            }
                            const slugFromUrl = extractSlugFromUrl(String(rawUrl || ''));
                            if (slugFromUrl) return `https://www.opentable.com/r/${slugFromUrl}`;
                            return null;
                        };
                        const getRestaurantRating = (value) => value?.starRating
                            || value?.rating
                            || value?.reviewScore
                            || value?.reviewRating
                            || value?.reviews?.rating
                            || value?.reviews?.score
                            || value?.reviews?.averageRating
                            || null;
                        const getRestaurantReviewsCount = (value) => value?.reviewCount
                            || value?.reviewsCount
                            || value?.numberOfReviews
                            || value?.review_count
                            || value?.reviews?.count
                            || value?.reviews?.total
                            || value?.reviews?.reviewCount
                            || null;
                        const getRestaurantImage = (value) => value?.primaryPhoto?.uri
                            || value?.primaryPhoto?.url
                            || value?.photo?.uri
                            || value?.photo?.url
                            || value?.image?.url
                            || value?.image?.src
                            || value?.imageUrl
                            || value?.image_url
                            || value?.photos?.[0]?.url
                            || value?.images?.[0]?.url
                            || null;
                        const hasRestaurantMeta = (value) => Boolean(
                            value?.priceBand || value?.priceRange || value?.priceCategory
                            || getRestaurantRating(value) || getRestaurantReviewsCount(value)
                            || value?.cuisine || value?.primaryCuisine || value?.cuisines,
                        );
                        const isLikelyRestaurant = (value) => Boolean(getCandidateName(value) && (getRestaurantUrl(value) || hasRestaurantMeta(value)));
                        const scoreCandidate = (value) => {
                            if (!isPlainObject(value) || !isLikelyRestaurant(value)) return 0;
                            let score = 0;
                            if (getCandidateName(value)) score += 3;
                            if (value.rid || value.restaurantId || value.id || value.restaurant_id) score += 2;
                            if (value.profileLink || value.canonicalUrl || value.url || value.slug) score += 2;
                            if (value.priceBand || value.priceRange || value.price || value.priceCategory) score += 1;
                            if (value.starRating || value.rating || value.reviewScore || value.reviewRating) score += 1;
                            if (value.cuisine || value.primaryCuisine || value.cuisines) score += 1;
                            return score;
                        };
                        const scoreRestaurantList = (restaurants) => {
                            const total = restaurants.length || 0;
                            if (!total) return 0;
                            let nameCount = 0;
                            let urlCount = 0;
                            let ratingCount = 0;
                            let reviewsCount = 0;
                            let imageCount = 0;
                            for (const item of restaurants) {
                                if (getCandidateName(item)) nameCount += 1;
                                if (getRestaurantUrl(item)) urlCount += 1;
                                if (getRestaurantRating(item)) ratingCount += 1;
                                if (getRestaurantReviewsCount(item)) reviewsCount += 1;
                                if (getRestaurantImage(item)) imageCount += 1;
                            }
                            const completeness = (
                                (urlCount * 4)
                                + (ratingCount * 2)
                                + (reviewsCount * 2)
                                + imageCount
                                + nameCount
                            ) / total;
                            const lengthBonus = Math.min(total, 50) / 50;
                            return (completeness * 10) + lengthBonus;
                        };
                        const collectDetailItems = (root, maxDepth = 6, maxItems = 600) => {
                            if (!root || typeof root !== 'object') return [];
                            const seen = new WeakSet();
                            const items = [];
                            const visit = (node, depth) => {
                                if (!node || typeof node !== 'object' || depth > maxDepth || items.length >= maxItems) return;
                                if (seen.has(node)) return;
                                seen.add(node);
                                if (Array.isArray(node)) {
                                    for (const item of node) visit(item, depth + 1);
                                    return;
                                }
                                if (isLikelyRestaurant(node) && (getRestaurantUrl(node) || getRestaurantRating(node) || getRestaurantReviewsCount(node) || getRestaurantImage(node))) {
                                    items.push(node);
                                }
                                for (const value of Object.values(node)) {
                                    visit(value, depth + 1);
                                }
                            };
                            visit(root, 0);
                            return items;
                        };
                        const extractRestaurantCardsFromDom = () => {
                            const results = [];
                            const seen = new Set();
                            const getBestImage = (img) => {
                                if (!img) return null;
                                const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
                                if (srcset) {
                                    const parts = srcset.split(',').map((part) => part.trim()).filter(Boolean);
                                    const last = parts[parts.length - 1] || '';
                                    const url = last.split(' ')[0];
                                    return normalizeUrl(url) || url || null;
                                }
                                return normalizeUrl(img.getAttribute('src') || img.getAttribute('data-src') || '') || null;
                            };
                            const parseNumber = (text) => {
                                if (!text) return null;
                                const digits = String(text).replace(/[^\d]/g, '');
                                if (!digits) return null;
                                return Number(digits);
                            };
                            const parseRatingAndReviews = (text) => {
                                const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
                                if (!cleaned) return { rating: null, reviews_count: null };
                                const matchParen = cleaned.match(/(\d\.\d)\s*\(\s*([\d,]+)\s*\)/);
                                if (matchParen) {
                                    return { rating: Number(matchParen[1]), reviews_count: parseNumber(matchParen[2]) };
                                }
                                const ratingMatch = cleaned.match(/(\d\.\d)/);
                                const reviewsMatch = cleaned.match(/([\d,]+)\s+reviews?/i);
                                return {
                                    rating: ratingMatch ? Number(ratingMatch[1]) : null,
                                    reviews_count: reviewsMatch ? parseNumber(reviewsMatch[1]) : null,
                                };
                            };

                            const anchors = Array.from(document.querySelectorAll('main a[href*="/r/"], a[href^="/r/"]'));
                            for (const a of anchors) {
                                const href = a.getAttribute('href') || '';
                                const url = normalizeUrl(href) || null;
                                if (!url) continue;
                                const slug = extractSlugFromUrl(url);
                                if (!slug) continue;

                                const container = a.closest('[data-test*="restaurant"], [data-testid*="restaurant"], article, li, div') || a;
                                const ridAttr = container.getAttribute('data-rid')
                                    || container.getAttribute('data-restaurant-id')
                                    || container.getAttribute('data-restaurantid')
                                    || container.getAttribute('data-id');
                                let rid = ridAttr && String(ridAttr).match(/\d+/)?.[0] ? Number(String(ridAttr).match(/\d+/)[0]) : null;
                                if (!rid) {
                                    try {
                                        const parsed = new URL(url);
                                        const fromQuery = parsed.searchParams.get('rid') || parsed.searchParams.get('restaurantId');
                                        rid = fromQuery && String(fromQuery).match(/\d+/)?.[0] ? Number(String(fromQuery).match(/\d+/)[0]) : null;
                                    } catch {
                                        rid = null;
                                    }
                                }

                                const nameEl = container.querySelector('h1, h2, h3, [data-test*="name"], [data-testid*="name"]') || a;
                                const name = (nameEl?.textContent || '').replace(/\s+/g, ' ').trim();
                                if (!name || name.length > 140) continue;
                                const nameKey = normalizeNameKey(name);
                                const dedupeKey = `${slug}|${nameKey}`;
                                if (seen.has(dedupeKey)) continue;
                                seen.add(dedupeKey);

                                const img = container.querySelector('img');
                                const image_url = getBestImage(img);

                                const ariaText = (container.getAttribute('aria-label') || '')
                                    + ' ' + (container.querySelector('[aria-label*="rating"], [aria-label*="stars"]')?.getAttribute('aria-label') || '');
                                const text = `${container.textContent || ''} ${ariaText}`;
                                const { rating, reviews_count } = parseRatingAndReviews(text);

                                results.push({
                                    rid,
                                    name,
                                    url,
                                    image_url,
                                    rating,
                                    reviews_count,
                                    slug,
                                });
                            }
                            return results;
                        };

                        const addCandidate = (candidates, restaurants, totalCount, source) => {
                            if (Array.isArray(restaurants) && restaurants.length) {
                                const filtered = restaurants.filter(isLikelyRestaurant);
                                if (filtered.length) {
                                    candidates.push({ restaurants: filtered, totalCount: totalCount || restaurants.length, source });
                                }
                            }
                        };

                        const extractFromKnownPaths = (state, prefix) => {
                            if (!state || typeof state !== 'object') return null;
                            const candidates = [];
                            const sr = state?.lolzViewAll?.searchResults;
                            if (sr?.restaurants) addCandidate(candidates, sr.restaurants, sr.totalRestaurantCount, `${prefix}.lolzViewAll.searchResults`);
                            if (state?.search?.results) addCandidate(candidates, state.search.results, state.search.totalResults, `${prefix}.search.results`);
                            if (state?.search?.searchResults?.restaurants) {
                                const searchResults = state.search.searchResults;
                                addCandidate(candidates, searchResults.restaurants, searchResults.totalRestaurantCount || searchResults.totalResults, `${prefix}.search.searchResults`);
                            }
                            if (state?.searchResults?.restaurants) {
                                const searchResults = state.searchResults;
                                addCandidate(candidates, searchResults.restaurants, searchResults.totalRestaurantCount || searchResults.totalResults, `${prefix}.searchResults`);
                            }
                            if (state?.availability?.restaurants) addCandidate(candidates, state.availability.restaurants, state.availability.totalResults, `${prefix}.availability.restaurants`);
                            if (state?.discovery?.restaurants) addCandidate(candidates, state.discovery.restaurants, state.discovery.totalResults, `${prefix}.discovery.restaurants`);
                            return candidates.sort((a, b) => b.restaurants.length - a.restaurants.length)[0] || null;
                        };

                        const findBestRestaurantArray = (root, maxDepth = 6) => {
                            const seen = new WeakSet();
                            let best = { items: [], matches: 0, score: 0 };

                            const visit = (node, depth) => {
                                if (!node || typeof node !== 'object' || depth > maxDepth) return;
                                if (seen.has(node)) return;
                                seen.add(node);

                                if (Array.isArray(node)) {
                                    const matching = node.filter(isLikelyRestaurant);
                                    if (matching.length > 0) {
                                        let score = 0;
                                        for (const item of matching) {
                                            score += scoreCandidate(item);
                                        }
                                        if (matching.length > best.matches || (matching.length === best.matches && score > best.score)) {
                                            best = { items: matching, matches: matching.length, score };
                                        }
                                    }
                                    for (const item of node) visit(item, depth + 1);
                                    return;
                                }

                                for (const value of Object.values(node)) {
                                    visit(value, depth + 1);
                                }
                            };

                            visit(root, 0);
                            return best.items;
                        };

                        const candidates = [];
                        const initialState = window.__INITIAL_STATE__ || window.__PRELOADED_STATE__;
                        if (initialState) {
                            const known = extractFromKnownPaths(initialState, 'initial_state');
                            if (known) candidates.push(known);
                        }

                        let nextData = window.__NEXT_DATA__ || null;
                        if (!nextData) {
                            const nextDataEl = document.getElementById('__NEXT_DATA__');
                            if (nextDataEl?.textContent) {
                                try {
                                    nextData = JSON.parse(nextDataEl.textContent);
                                } catch {
                                    nextData = null;
                                }
                            }
                        }

                        const nextState = nextData?.props?.pageProps?.initialState
                            || nextData?.props?.pageProps?.state
                            || nextData?.props?.pageProps
                            || nextData?.props?.initialState
                            || null;

                        if (nextState) {
                            const known = extractFromKnownPaths(nextState, 'next_data');
                            if (known) candidates.push(known);
                        }

                        const apolloState = window.__APOLLO_STATE__
                            || nextData?.props?.pageProps?.apolloState
                            || nextData?.props?.pageProps?.initialApolloState
                            || nextData?.props?.pageProps?.__APOLLO_STATE__
                            || null;

                        if (apolloState && typeof apolloState === 'object') {
                            const apolloRestaurants = [];
                            for (const [key, value] of Object.entries(apolloState)) {
                                const typename = value?.__typename || '';
                                if ((key && key.startsWith('Restaurant:')) || /restaurant/i.test(typename)) {
                                    if (isLikelyRestaurant(value)) apolloRestaurants.push(value);
                                }
                            }
                            addCandidate(candidates, apolloRestaurants, apolloRestaurants.length, 'apollo_state');
                        }

                        const scanTargets = [initialState, nextData, nextState, apolloState].filter(Boolean);
                        const details = [];
                        for (const target of scanTargets) {
                            details.push(...collectDetailItems(target));
                        }
                        const domDetails = extractRestaurantCardsFromDom();
                        addCandidate(candidates, domDetails, domDetails.length, 'dom_cards');
                        for (const target of scanTargets) {
                            const scanned = findBestRestaurantArray(target);
                            addCandidate(candidates, scanned, scanned.length, 'scan');
                        }

                        candidates.sort((a, b) => scoreRestaurantList(b.restaurants) - scoreRestaurantList(a.restaurants)
                            || b.restaurants.length - a.restaurants.length
                            || (b.totalCount || 0) - (a.totalCount || 0));
                        const best = candidates[0] || { restaurants: [], totalCount: 0, source: null };
                        const bodyText = document.body?.innerText || '';
                        const blocked = /pardon our interruption|access denied|unusual traffic|are you a robot|captcha/i.test(bodyText)
                            || /access denied|robot|captcha/i.test(document.title || '');

                        return { ...best, blocked, details, domDetails };
                    });
                };
                let jsonCandidateOffset = 0;
                let warnedBlocked = false;
                let noProgressPages = 0;
                let pageNumber = 1;
                const maxPages = Math.max(3, Math.ceil(RESULTS_WANTED / 50) + 5);

                const collectSnapshot = async () => {
                    const pageData = await extractFromPage();
                    if (pageData.blocked && !warnedBlocked) {
                        warnedBlocked = true;
                        log.warning('Possible anti-bot interstitial detected on the page.');
                    }

                    const allCandidates = request.userData?.jsonCandidates || [];
                    const newCandidates = allCandidates.slice(jsonCandidateOffset);
                    jsonCandidateOffset = allCandidates.length;

                    const responseData = pickBestCandidate(newCandidates);
                    const bestCandidate = pickBestCandidate([pageData, responseData]);

                    const detailItems = [];
                    if (Array.isArray(pageData.details)) detailItems.push(...pageData.details);
                    if (Array.isArray(pageData.domDetails)) detailItems.push(...pageData.domDetails);
                    if (Array.isArray(request.userData?.jsonDetailItems)) detailItems.push(...request.userData.jsonDetailItems);
                    for (const candidate of newCandidates) {
                        if (Array.isArray(candidate.details)) detailItems.push(...candidate.details);
                    }
                    const detailIndex = buildRestaurantIndex(detailItems);

                    return { bestCandidate, detailIndex };
                };

                const goToNextPage = async () => {
                    const currentUrl = page.url();
                    const gotoUrl = async (href) => {
                        if (!href) return false;
                        const nextUrl = new URL(href, currentUrl).href;
                        if (nextUrl === currentUrl) return false;
                        await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
                        await page.waitForTimeout(1500);
                        return true;
                    };

                    const clickLocator = async (locator) => {
                        if (!await locator.count()) return false;
                        const target = locator.first();
                        const ariaDisabled = await target.getAttribute('aria-disabled');
                        const disabled = await target.getAttribute('disabled');
                        if (ariaDisabled === 'true' || disabled !== null) return false;
                        const isVisible = await target.isVisible().catch(() => false);
                        if (!isVisible) return false;
                        await Promise.all([
                            target.click({ timeout: 5000 }).catch(() => { }),
                            page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => { }),
                        ]);
                        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
                        await page.waitForTimeout(1500);
                        return true;
                    };

                    const headNext = page.locator('link[rel="next"]');
                    if (await headNext.count()) {
                        const href = await headNext.first().getAttribute('href');
                        if (await gotoUrl(href)) return true;
                    }

                    const linkSelectors = [
                        'a[rel="next"]',
                        'a[aria-label*="Next"]',
                        'a[aria-label*="next"]',
                        'a[data-test*="pagination-next"]',
                        'a[data-testid*="pagination-next"]',
                        'a[aria-label*="More"]',
                    ];
                    for (const selector of linkSelectors) {
                        const locator = page.locator(selector);
                        if (!await locator.count()) continue;
                        const href = await locator.first().getAttribute('href');
                        if (href && await gotoUrl(href)) return true;
                        if (await clickLocator(locator)) return true;
                    }

                    const buttonSelectors = [
                        'button[aria-label*="Next"]',
                        'button[aria-label*="next"]',
                        'button[data-test*="pagination-next"]',
                        'button[data-testid*="pagination-next"]',
                        'button[aria-label*="More"]',
                    ];
                    for (const selector of buttonSelectors) {
                        const locator = page.locator(selector);
                        if (await clickLocator(locator)) return true;
                    }

                    return false;
                };

                while (saved < RESULTS_WANTED && pageNumber <= maxPages) {
                    await waitForResultsReady();
                    let snapshot = await collectSnapshot();
                    let restaurants = snapshot.bestCandidate.restaurants || [];
                    let totalCount = snapshot.bestCandidate.totalCount || 0;
                    let detailIndex = snapshot.detailIndex;

                    if (restaurants.length) {
                        log.info(`Found ${restaurants.length} restaurants via ${snapshot.bestCandidate.source || 'page_state'} (page ${pageNumber}, total: ${totalCount || 'unknown'})`);
                    } else {
                        log.warning(`No restaurants found on page ${pageNumber}.`);
                    }

                    const shouldScroll = restaurants.length < RESULTS_WANTED && (totalCount === 0 || restaurants.length < totalCount);
                    if (shouldScroll) {
                        log.info('Scrolling to load more restaurants...');

                        let previousCount = restaurants.length;
                        let scrollAttempts = 0;
                        const maxScrolls = 20;

                        while (scrollAttempts < maxScrolls && saved + restaurants.length < RESULTS_WANTED) {
                            await page.evaluate(() => {
                                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                            });
                            await page.waitForTimeout(1500);

                            const updatedSnapshot = await collectSnapshot();
                            const updatedRestaurants = updatedSnapshot.bestCandidate.restaurants || [];

                            if (updatedRestaurants.length > previousCount) {
                                restaurants = updatedRestaurants;
                                totalCount = updatedSnapshot.bestCandidate.totalCount || totalCount;
                                detailIndex = updatedSnapshot.detailIndex;
                                previousCount = updatedRestaurants.length;
                                log.info(`Loaded ${restaurants.length} restaurants after scroll`);
                            } else {
                                scrollAttempts += 1;
                            }
                        }
                    }

                    const savedBefore = saved;
                    for (const r of restaurants) {
                        const id = getRestaurantId(r);
                        const url = getRestaurantUrl(r);
                        const nameKey = getCandidateName(r)?.toLowerCase() || null;
                        if (id !== null && id !== undefined && seenIds.has(String(id))) continue;
                        if (!id && url && seenUrls.has(url)) continue;
                        if (!id && !url && nameKey && seenNames.has(nameKey)) continue;

                        const item = normalizeRestaurant(r, findRestaurantDetail(r, detailIndex));
                        await Dataset.pushData(item);
                        saved++;

                        if (id !== null && id !== undefined) seenIds.add(String(id));
                        if (item.url) seenUrls.add(item.url);
                        if (item.name) seenNames.add(item.name.toLowerCase());

                        if (saved >= RESULTS_WANTED) break;
                    }

                    if (saved === savedBefore) {
                        noProgressPages += 1;
                    } else {
                        noProgressPages = 0;
                    }

                    log.info(`Saved ${saved}/${RESULTS_WANTED} restaurants`);
                    if (saved >= RESULTS_WANTED) break;
                    if (totalCount > restaurants.length && saved >= totalCount) break;
                    if (noProgressPages >= 2) {
                        log.warning('Pagination stalled with no new restaurants. Stopping.');
                        break;
                    }

                    const moved = await goToNextPage();
                    if (!moved) {
                        log.info('No next page detected. Stopping pagination.');
                        break;
                    }
                    pageNumber += 1;
                }
            } finally {
                cleanupResponseListener();
            }
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
