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
const ENABLE_DOM_DETAILS = false;
const ENABLE_DOM_FALLBACK = false;

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
    let normalized = null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) normalized = trimmed;
    else if (trimmed.startsWith('//')) normalized = `https:${trimmed}`;
    else if (trimmed.startsWith('/')) normalized = `https://www.opentable.com${trimmed}`;
    else if (trimmed.includes('opentable.com/')) normalized = `https://${trimmed.replace(/^https?:\/\//, '')}`;
    if (!normalized) return null;
    try {
        const parsed = new URL(normalized);
        parsed.hash = '';
        return parsed.href;
    } catch {
        return normalized.split('#')[0];
    }
};

const extractSlugFromUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    const match = value.match(/\/r\/([^/?#]+)/i);
    return match?.[1] || null;
};

const getRestaurantId = (value) => value?.rid
    || value?.restaurantId
    || value?.restaurant_id
    || value?.id
    || value?.restaurantID
    || value?.legacyId
    || value?.legacyRestaurantId
    || value?.restaurantLegacyId
    || value?.legacy_rid
    || value?.restaurantRid
    || null;
const getRestaurantSlug = (value) => {
    const slug = value?.slug || value?.urlSlug || value?.seo?.slug || value?.seo?.urlSlug;
    if (typeof slug === 'string' && slug.trim()) return slug.trim();
    const urlCandidate = value?.profileLink || value?.canonicalUrl || value?.url || value?.href || value?.permalink || value?.path;
    return extractSlugFromUrl(String(urlCandidate || ''));
};

const getRestaurantUrl = (value) => {
    const rawUrl = value?.profileLink
        || value?.profileUrl
        || value?.profileURL
        || value?.links?.profile?.href
        || value?.links?.restaurant?.href
        || value?.urls?.profile
        || value?.urls?.restaurant
        || value?.restaurantUrl
        || value?.restaurant_url
        || value?.canonicalUrl
        || value?.canonicalURL
        || value?.canonicalPath
        || value?.seo?.canonicalUrl
        || value?.seo?.canonicalURL
        || value?.seo?.canonicalPath
        || value?.seo?.url
        || value?.seo?.path
        || value?.urls?.profileLink?.link
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
    || value?.reviewSummary?.rating
    || value?.reviewSummary?.averageRating
    || value?.ratingSummary?.rating
    || value?.statistics?.reviews?.ratings?.overall?.rating
    || null;

const getRestaurantReviewsCount = (value) => value?.reviewCount
    || value?.reviewsCount
    || value?.numberOfReviews
    || value?.review_count
    || value?.reviews_count
    || value?.reviews?.count
    || value?.reviews?.total
    || value?.reviews?.reviewCount
    || value?.reviewSummary?.count
    || value?.reviewSummary?.reviewCount
    || value?.ratingSummary?.count
    || value?.statistics?.reviews?.allTimeTextReviewCount
    || null;

const getRestaurantImage = (value) => value?.primaryPhoto?.uri
    || value?.primaryPhoto?.url
    || value?.photo?.uri
    || value?.photo?.url
    || value?.primaryPhotoUrl
    || value?.heroImageUrl
    || value?.thumbnailUrl
    || value?.cardPhoto?.url
    || value?.cardPhoto?.uri
    || value?.image?.url
    || value?.image?.src
    || (typeof value?.photo === 'string' ? value.photo : null)
    || (typeof value?.image === 'string' ? value.image : null)
    || value?.imageUrl
    || value?.image_url
    || value?.photos?.profileV3?.url
    || value?.photos?.[0]?.url
    || value?.images?.[0]?.url
    || null;

const parseJsonSafe = (value) => {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const isGraphqlUrl = (url) => /\/dapi\/fe\/gql|graphql/i.test(url);

const extractGraphqlTemplate = (url, method, postData) => {
    if (!url) return null;
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return null;
    }
    const queryParams = Object.fromEntries(parsedUrl.searchParams.entries());
    const urlVariables = parseJsonSafe(parsedUrl.searchParams.get('variables'));
    const urlExtensions = parseJsonSafe(parsedUrl.searchParams.get('extensions'));
    let body = null;
    let variables = urlVariables || null;
    let operationName = queryParams.opname || null;

    if (postData) {
        const parsedBody = parseJsonSafe(postData);
        if (parsedBody && typeof parsedBody === 'object') {
            body = parsedBody;
            variables = parsedBody.variables || variables;
            operationName = parsedBody.operationName || operationName;
        }
    }

    return {
        url: `${parsedUrl.origin}${parsedUrl.pathname}`,
        method,
        queryParams,
        variables,
        extensions: urlExtensions || body?.extensions || null,
        operationName,
        body,
    };
};

const derivePageSize = (variables, fallback) => {
    if (!variables || typeof variables !== 'object') return fallback;
    let found = null;
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'number' && /limit|pageSize|pagesize|perPage|per_page|size|count/i.test(key)) {
                found = value;
                return;
            }
            if (typeof value === 'object') visit(value);
            if (found !== null) return;
        }
    };
    visit(variables);
    return found || fallback;
};

const updatePaginationVariables = (variables, page, pageSize) => {
    if (!variables || typeof variables !== 'object') return { variables, updated: false };
    const cloned = JSON.parse(JSON.stringify(variables));
    let updated = false;
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'number') {
                if (/pageNumber|pageIndex|page/i.test(key)) {
                    node[key] = page;
                    updated = true;
                } else if (/offset|start|from|startIndex/i.test(key)) {
                    node[key] = Math.max(0, (page - 1) * pageSize);
                    updated = true;
                } else if (/limit|pageSize|pagesize|perPage|per_page|size|count/i.test(key)) {
                    node[key] = pageSize;
                    updated = true;
                }
            } else if (typeof value === 'object') {
                visit(value);
            }
        }
    };
    visit(cloned);
    return { variables: cloned, updated };
};

const updatePaginationParams = (params, page, pageSize) => {
    const updatedParams = { ...params };
    let updated = false;
    for (const [key, value] of Object.entries(updatedParams)) {
        if (!value) continue;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) continue;
        if (/pageNumber|pageIndex|page/i.test(key)) {
            updatedParams[key] = String(page);
            updated = true;
        } else if (/offset|start|from|startIndex/i.test(key)) {
            updatedParams[key] = String(Math.max(0, (page - 1) * pageSize));
            updated = true;
        } else if (/limit|pageSize|pagesize|perPage|per_page|size|count/i.test(key)) {
            updatedParams[key] = String(pageSize);
            updated = true;
        }
    }
    return { params: updatedParams, updated };
};

const buildApiRequest = (template, page, pageSize) => {
    if (!template) return null;
    const method = template.method || 'GET';
    const pageSizeResolved = derivePageSize(template.variables, pageSize);
    const { variables, updated: varsUpdated } = updatePaginationVariables(template.variables, page, pageSizeResolved);
    const { params, updated: paramsUpdated } = updatePaginationParams(template.queryParams, page, pageSizeResolved);

    if (method === 'GET') {
        const url = new URL(template.url);
        for (const [key, value] of Object.entries(params || {})) {
            url.searchParams.set(key, value);
        }
        if (variables) url.searchParams.set('variables', JSON.stringify(variables));
        if (template.extensions && !url.searchParams.get('extensions')) {
            url.searchParams.set('extensions', JSON.stringify(template.extensions));
        }
        return { url: url.href, method: 'GET', body: null, pageSize: pageSizeResolved, updated: varsUpdated || paramsUpdated };
    }

    const body = template.body ? { ...template.body } : {};
    body.variables = variables || body.variables;
    if (template.operationName) body.operationName = template.operationName;
    if (template.extensions) body.extensions = template.extensions;
    const query = new URLSearchParams(params || {}).toString();
    const url = query ? `${template.url}?${query}` : template.url;
    return { url, method: 'POST', body: JSON.stringify(body), pageSize: pageSizeResolved, updated: varsUpdated || paramsUpdated };
};

const fetchApiPage = async (template, page, pageSize, userAgent) => {
    const requestConfig = buildApiRequest(template, page, pageSize);
    if (!requestConfig) return null;
    if (page > 1 && !requestConfig.updated) {
        return { error: 'No pagination parameters found', pageSize: requestConfig.pageSize };
    }
    const headers = {
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': userAgent || getRandomUserAgent(),
    };
    if (requestConfig.method === 'POST') {
        headers['content-type'] = 'application/json';
    }
    const response = await fetch(requestConfig.url, {
        method: requestConfig.method,
        headers,
        body: requestConfig.body,
    });
    if (!response.ok) {
        return { error: `API status ${response.status}`, pageSize: requestConfig.pageSize };
    }
    const json = await response.json();
    return { json, pageSize: requestConfig.pageSize };
};

const scoreApiTemplate = (template, restaurantsCount, detailsCount = 0) => {
    if (!template) return 0;
    const opname = String(template.operationName || template.queryParams?.opname || '');
    let score = (restaurantsCount || 0) * 2 + (detailsCount || 0);
    if (/search|availability|results/i.test(opname)) score += 60;
    if (/home|module|recommend/i.test(opname)) score -= 10;
    if (template.method === 'POST') score += 5;
    const variablesString = JSON.stringify(template.variables || {});
    if (/term|search|query|metro|city|location/i.test(variablesString)) score += 10;
    if (/date|datetime|covers|party/i.test(variablesString)) score += 5;
    return score;
};
const hasRestaurantMeta = (value) => Boolean(
    value?.priceBand || value?.priceRange || value?.priceCategory || value?.price_range
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
    if (value.priceBand || value.priceRange || value.price || value.priceCategory || value.price_range) score += 1;
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
        data?.data?.search?.searchResults?.results,
        data?.data?.searchResults?.restaurants,
        data?.data?.searchResults?.results,
        data?.data?.search?.searchResults?.listings,
        data?.data?.availability?.restaurants,
        data?.multiSearch?.restaurants,
        data?.search?.restaurants,
        data?.search?.results,
        data?.search?.searchResults?.restaurants,
        data?.search?.searchResults?.results,
        data?.searchResults?.restaurants,
        data?.searchResults?.results,
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

const scoreCandidateSource = (candidate) => {
    if (!candidate) return 0;
    const source = String(candidate.source || '');
    let bonus = 0;
    if (/gql|graphql|search|availability|results/i.test(source)) bonus += 5;
    if (/dom_cards/i.test(source)) bonus -= 5;
    return bonus;
};

const pickBestCandidate = (candidates) => {
    const usable = candidates.filter((candidate) => candidate?.restaurants?.length);
    if (!usable.length) return { restaurants: [], totalCount: 0, source: null };
    usable.sort((a, b) => (scoreRestaurantList(b.restaurants) + scoreCandidateSource(b))
        - (scoreRestaurantList(a.restaurants) + scoreCandidateSource(a))
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
            || base?.price_range
            || extra?.priceBand || extra?.priceRange || extra?.price || extra?.priceCategory || extra?.price_range
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
        useDomFallback = false,
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
                request.userData.apiTemplate = request.userData.apiTemplate || null;
                request.userData.apiTemplateScore = request.userData.apiTemplateScore || 0;
                request.userData.userAgent = request.userData.userAgent || getRandomUserAgent();
                const responseListener = async (response) => {
                    const contentType = response.headers()['content-type'] || '';
                    if (!contentType.includes('application/json')) return;
                    const url = response.url();
                    try {
                        if (!/gql|graphql|search|results|availability|restaurants/i.test(url)) return;
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
                        if (isGraphqlUrl(url)) {
                            const req = response.request();
                            const template = extractGraphqlTemplate(url, req.method(), req.postData());
                            const templateScore = scoreApiTemplate(template, extracted.restaurants.length, extracted.details?.length || 0);
                            if (template && templateScore > request.userData.apiTemplateScore) {
                                request.userData.apiTemplate = template;
                                request.userData.apiTemplateScore = templateScore;
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

                const enableDomDetails = ENABLE_DOM_DETAILS || ENABLE_DOM_FALLBACK || useDomFallback;
                const extractFromPage = async (pageNumber) => {
                    return page.evaluate(({ useDomDetails, pageNumber }) => {
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
                            let normalized = null;
                            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) normalized = trimmed;
                            else if (trimmed.startsWith('//')) normalized = `https:${trimmed}`;
                            else if (trimmed.startsWith('/')) normalized = `https://www.opentable.com${trimmed}`;
                            else if (trimmed.includes('opentable.com/')) normalized = `https://${trimmed.replace(/^https?:\/\//, '')}`;
                            if (!normalized) return null;
                            try {
                                const parsed = new URL(normalized);
                                parsed.hash = '';
                                return parsed.href;
                            } catch {
                                return normalized.split('#')[0];
                            }
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
                            || value?.reviewSummary?.rating
                            || value?.reviewSummary?.averageRating
                            || value?.ratingSummary?.rating
                            || null;
                        const getRestaurantReviewsCount = (value) => value?.reviewCount
                            || value?.reviewsCount
                            || value?.numberOfReviews
                            || value?.review_count
                            || value?.reviews_count
                            || value?.reviews?.count
                            || value?.reviews?.total
                            || value?.reviews?.reviewCount
                            || value?.reviewSummary?.count
                            || value?.reviewSummary?.reviewCount
                            || value?.ratingSummary?.count
                            || null;
                        const getRestaurantImage = (value) => value?.primaryPhoto?.uri
                            || value?.primaryPhoto?.url
                            || value?.photo?.uri
                            || value?.photo?.url
                            || value?.primaryPhotoUrl
                            || value?.heroImageUrl
                            || value?.thumbnailUrl
                            || value?.cardPhoto?.url
                            || value?.cardPhoto?.uri
                            || value?.image?.url
                            || value?.image?.src
                            || (typeof value?.photo === 'string' ? value.photo : null)
                            || (typeof value?.image === 'string' ? value.image : null)
                            || value?.imageUrl
                            || value?.image_url
                            || value?.photos?.[0]?.url
                            || value?.images?.[0]?.url
                            || null;
                        const hasRestaurantMeta = (value) => Boolean(
                            value?.priceBand || value?.priceRange || value?.priceCategory || value?.price_range
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
                            if (value.priceBand || value.priceRange || value.price || value.priceCategory || value.price_range) score += 1;
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
                            const getBestImage = (img, container) => {
                                const attrUrl = container?.getAttribute('data-image-url') || container?.getAttribute('data-image') || '';
                                if (attrUrl) {
                                    const normalizedAttr = normalizeUrl(attrUrl);
                                    if (normalizedAttr) return normalizedAttr;
                                }
                                if (img) {
                                    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
                                    if (srcset) {
                                        const parts = srcset.split(',').map((part) => part.trim()).filter(Boolean);
                                        const last = parts[parts.length - 1] || '';
                                        const url = last.split(' ')[0];
                                        return normalizeUrl(url) || url || null;
                                    }
                                    const direct = img.getAttribute('src') || img.getAttribute('data-src') || '';
                                    const normalized = normalizeUrl(direct);
                                    if (normalized) return normalized;
                                }
                                const dataImgEl = container?.querySelector('[data-src], [data-srcset], [data-image], [data-background], [data-bg]');
                                if (dataImgEl) {
                                    const dataUrl = dataImgEl.getAttribute('data-src')
                                        || dataImgEl.getAttribute('data-image')
                                        || dataImgEl.getAttribute('data-background')
                                        || dataImgEl.getAttribute('data-bg')
                                        || '';
                                    const normalizedData = normalizeUrl(dataUrl);
                                    if (normalizedData) return normalizedData;
                                    const dataSrcset = dataImgEl.getAttribute('data-srcset') || '';
                                    if (dataSrcset) {
                                        const parts = dataSrcset.split(',').map((part) => part.trim()).filter(Boolean);
                                        const last = parts[parts.length - 1] || '';
                                        const url = last.split(' ')[0];
                                        return normalizeUrl(url) || url || null;
                                    }
                                }
                                const bgEl = container?.querySelector('[style*="background-image"]');
                                const bgValue = bgEl?.style?.backgroundImage || bgEl?.getAttribute('style') || '';
                                const bgMatch = String(bgValue).match(/url\(["']?([^"')]+)["']?\)/i);
                                if (bgMatch?.[1]) {
                                    return normalizeUrl(bgMatch[1]) || bgMatch[1];
                                }
                                return null;
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

                            const findCardContainer = (anchor) => {
                                let el = anchor;
                                for (let i = 0; i < 6 && el; i++) {
                                    if (el.matches?.('[data-test*="restaurant"], [data-testid*="restaurant"], article, li')) return el;
                                    const hasName = el.querySelector?.('h1, h2, h3, [data-test*="name"], [data-testid*="name"]');
                                    const hasLink = el.querySelector?.('a[href*="/r/"], a[href^="/r/"]');
                                    if (el.tagName === 'DIV' && hasName && hasLink) return el;
                                    el = el.parentElement;
                                }
                                return anchor;
                            };

                            const anchors = Array.from(document.querySelectorAll('main a[href*="/r/"], a[href^="/r/"]'));
                            const containers = new Set();
                            for (const a of anchors) {
                                const container = findCardContainer(a);
                                containers.add(container);
                            }

                            const extractMetaFromLines = (lines, name) => {
                                let cuisine = null;
                                let neighborhood = null;
                                let city = null;
                                let price_range = null;

                                const isNoise = (line) => {
                                    const lower = line.toLowerCase();
                                    if (name && lower === name.toLowerCase()) return true;
                                    if (/\d\.\d/.test(line) && /review|star|rating/i.test(lower)) return true;
                                    if (/reviews?/i.test(lower) && /\d/.test(line)) return true;
                                    if (/reserve|book|table|available|times?|pm|am|seats?/i.test(lower)) return true;
                                    if (/open table|opentable/i.test(lower)) return true;
                                    return false;
                                };

                                const filtered = lines.filter((line) => line && !isNoise(line));
                                const parseMetaFromLine = (line) => {
                                    const labelMatch = line.match(/^(cuisine|neighborhood|location|city|price)\s*[:\-]\s*(.+)$/i);
                                    if (labelMatch) {
                                        const label = labelMatch[1].toLowerCase();
                                        const value = labelMatch[2].trim();
                                        if (label === 'cuisine' && !cuisine) cuisine = value;
                                        if ((label === 'neighborhood' || label === 'location') && !neighborhood) neighborhood = value;
                                        if (label === 'city' && !city) city = value;
                                        if (label === 'price' && !price_range) {
                                            const priceMatch = value.match(/\${1,4}/);
                                            price_range = priceMatch ? priceMatch[0] : value;
                                        }
                                        return;
                                    }

                                    const parts = line.split(/[•·]/).map((p) => p.trim()).filter(Boolean);
                                    const priceMatch = line.match(/\${1,4}/);
                                    const price = priceMatch ? priceMatch[0] : null;
                                    if (price && !price_range) price_range = price;
                                    if (parts.length >= 2) {
                                        const priceIndex = parts.findIndex((p) => /\$/.test(p));
                                        const others = parts.filter((_, idx) => idx !== priceIndex);
                                        if (others.length === 1) {
                                            if (!cuisine) cuisine = others[0];
                                        } else if (others.length >= 2) {
                                            if (!neighborhood) neighborhood = others[0];
                                            if (!cuisine) cuisine = others[others.length - 1];
                                        }
                                    } else if (price) {
                                        const leftover = line.replace(price, '').replace(/[•·]/g, '').trim();
                                        if (leftover && !cuisine) cuisine = leftover;
                                    }
                                };

                                for (const line of filtered) {
                                    if (/\$/.test(line) || /[•·]/.test(line)) {
                                        parseMetaFromLine(line);
                                    }
                                }

                                for (const line of filtered) {
                                    if (/cuisine\s*[:\-]/i.test(line) || /neighborhood\s*[:\-]/i.test(line) || /location\s*[:\-]/i.test(line) || /city\s*[:\-]/i.test(line) || /price\s*[:\-]/i.test(line)) {
                                        parseMetaFromLine(line);
                                        continue;
                                    }
                                    if (/\$/.test(line)) continue;
                                    if (!neighborhood) {
                                        if (line.includes(',')) {
                                            const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
                                            neighborhood = parts[0] || neighborhood;
                                            city = parts.slice(1).join(', ') || city;
                                        } else if (line.length <= 60) {
                                            neighborhood = line;
                                        }
                                    } else if (!city && line.includes(',')) {
                                        const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
                                        city = parts.slice(1).join(', ') || city;
                                    }
                                }

                                return { cuisine, neighborhood, city, price_range };
                            };

                            for (const container of containers) {
                                if (!container) continue;
                                const ridAttr = container.getAttribute('data-rid')
                                    || container.getAttribute('data-restaurant-id')
                                    || container.getAttribute('data-restaurantid')
                                    || container.getAttribute('data-id');
                                let rid = ridAttr && String(ridAttr).match(/\d+/)?.[0] ? Number(String(ridAttr).match(/\d+/)[0]) : null;

                                const nameEl = container.querySelector('h1, h2, h3, [data-test*="name"], [data-testid*="name"]');
                                const name = (nameEl?.textContent || '').replace(/\s+/g, ' ').trim();
                                if (!name || name.length > 140) continue;
                                const nameKey = normalizeNameKey(name);

                                const anchorEls = Array.from(container.querySelectorAll('a[href*="/r/"], a[href^="/r/"]'));
                                let bestUrl = null;
                                let bestScore = -1;
                                for (const anchor of anchorEls) {
                                    const href = anchor.getAttribute('href') || '';
                                    if (!href) continue;
                                    if (/reviews?/i.test(href) && href.includes('#')) continue;
                                    const candidateUrl = normalizeUrl(href);
                                    if (!candidateUrl) continue;
                                    const slug = extractSlugFromUrl(candidateUrl);
                                    if (!slug) continue;
                                    let score = 0;
                                    const anchorText = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
                                    if (anchorText && anchorText.toLowerCase().includes(name.toLowerCase())) score += 3;
                                    const testId = `${anchor.getAttribute('data-test') || ''} ${anchor.getAttribute('data-testid') || ''}`;
                                    if (/name/i.test(testId)) score += 2;
                                    if (nameEl && anchor.contains(nameEl)) score += 2;
                                    score += 1;
                                    if (score > bestScore) {
                                        bestScore = score;
                                        bestUrl = candidateUrl;
                                    }
                                }

                                const url = bestUrl || null;
                                if (!url) continue;
                                const slug = extractSlugFromUrl(url);
                                if (!slug) continue;

                                if (!rid) {
                                    try {
                                        const parsed = new URL(url);
                                        const fromQuery = parsed.searchParams.get('rid') || parsed.searchParams.get('restaurantId');
                                        rid = fromQuery && String(fromQuery).match(/\d+/)?.[0] ? Number(String(fromQuery).match(/\d+/)[0]) : null;
                                    } catch {
                                        rid = null;
                                    }
                                }

                                const dedupeKey = `${slug}|${nameKey}`;
                                if (seen.has(dedupeKey)) continue;
                                seen.add(dedupeKey);

                                const img = container.querySelector('img');
                                const image_url = getBestImage(img, container);

                                const reviewAnchor = anchorEls.find((anchor) => /reviews?/i.test(anchor.getAttribute('href') || ''));
                                const reviewText = reviewAnchor?.textContent || '';

                                const ariaText = (container.getAttribute('aria-label') || '')
                                    + ' ' + (container.querySelector('[aria-label*="rating"], [aria-label*="stars"]')?.getAttribute('aria-label') || '');
                                const text = `${container.textContent || ''} ${ariaText} ${reviewText}`;
                                const { rating, reviews_count } = parseRatingAndReviews(text);

                                const metaSelectors = [
                                    '[data-test*="cuisine"]',
                                    '[data-testid*="cuisine"]',
                                    '[data-test*="neighborhood"]',
                                    '[data-testid*="neighborhood"]',
                                    '[data-test*="location"]',
                                    '[data-testid*="location"]',
                                    '[data-test*="price"]',
                                    '[data-testid*="price"]',
                                    '[data-test*="metadata"]',
                                    '[data-testid*="metadata"]',
                                ];
                                const metaLines = new Set();
                                for (const selector of metaSelectors) {
                                    container.querySelectorAll(selector).forEach((el) => {
                                        const textLine = (el.textContent || '').replace(/\s+/g, ' ').trim();
                                        if (textLine) metaLines.add(textLine);
                                    });
                                }
                                const containerLines = (container.innerText || '')
                                    .split('\n')
                                    .map((line) => line.replace(/\s+/g, ' ').trim())
                                    .filter(Boolean);
                                const allLines = [...metaLines, ...containerLines];
                                const meta = extractMetaFromLines(allLines, name);

                                const cityAttr = container.getAttribute('data-city') || container.getAttribute('data-location-city');
                                const neighborhoodAttr = container.getAttribute('data-neighborhood') || container.getAttribute('data-location-neighborhood');
                                const priceAttr = container.getAttribute('data-price') || container.getAttribute('data-price-range');
                                const cuisineAttr = container.getAttribute('data-cuisine') || container.getAttribute('data-primary-cuisine');
                                let derivedCity = null;
                                const nameParts = name.split(/\s[-–—]\s/).map((part) => part.trim()).filter(Boolean);
                                if (nameParts.length >= 2) {
                                    const tail = nameParts[nameParts.length - 1];
                                    if (tail.length <= 40) derivedCity = tail;
                                }

                                results.push({
                                    rid,
                                    name,
                                    url,
                                    image_url,
                                    rating,
                                    reviews_count,
                                    slug,
                                    city: cityAttr || meta.city || derivedCity || null,
                                    neighborhood: neighborhoodAttr || meta.neighborhood || null,
                                    cuisine: cuisineAttr || meta.cuisine || null,
                                    price_range: priceAttr || meta.price_range || null,
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
                            if (state?.search?.searchResults?.results) {
                                const searchResults = state.search.searchResults;
                                addCandidate(candidates, searchResults.results, searchResults.totalRestaurantCount || searchResults.totalResults, `${prefix}.search.searchResults.results`);
                            }
                            if (state?.searchResults?.restaurants) {
                                const searchResults = state.searchResults;
                                addCandidate(candidates, searchResults.restaurants, searchResults.totalRestaurantCount || searchResults.totalResults, `${prefix}.searchResults`);
                            }
                            if (state?.searchResults?.results) {
                                const searchResults = state.searchResults;
                                addCandidate(candidates, searchResults.results, searchResults.totalRestaurantCount || searchResults.totalResults, `${prefix}.searchResults.results`);
                            }
                            if (state?.availability?.restaurants) addCandidate(candidates, state.availability.restaurants, state.availability.totalResults, `${prefix}.availability.restaurants`);
                            if (state?.discovery?.restaurants) addCandidate(candidates, state.discovery.restaurants, state.discovery.totalResults, `${prefix}.discovery.restaurants`);
                            return candidates.sort((a, b) => b.restaurants.length - a.restaurants.length)[0] || null;
                        };

                        const extractFromApolloCache = (cache) => {
                            if (!cache || typeof cache !== 'object') return null;
                            const root = cache.ROOT_QUERY || cache['ROOT_QUERY'];
                            if (!root || typeof root !== 'object') return null;
                            const lists = [];
                            const collectRestaurants = (value) => {
                                if (!value || typeof value !== 'object') return;
                                if (Array.isArray(value)) {
                                    const mapped = value.map((item) => {
                                        if (!item) return null;
                                        if (item.__ref && cache[item.__ref]) return cache[item.__ref];
                                        if (typeof item === 'string' && cache[item]) return cache[item];
                                        return item;
                                    }).filter(Boolean);
                                    const filtered = mapped.filter(isLikelyRestaurant);
                                    if (filtered.length) lists.push(filtered);
                                    return;
                                }
                                for (const child of Object.values(value)) {
                                    if (child && typeof child === 'object') collectRestaurants(child);
                                }
                            };
                            for (const value of Object.values(root)) {
                                collectRestaurants(value);
                            }
                            if (!lists.length) return null;
                            lists.sort((a, b) => b.length - a.length);
                            return lists[0];
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
                        // Ignore initial state on subsequent pages as it's likely stale (SPA pagination)
                        const viewInitialState = pageNumber === 1;
                        const initialState = viewInitialState ? (window.__INITIAL_STATE__ || window.__PRELOADED_STATE__) : null;
                        if (initialState) {
                            const known = extractFromKnownPaths(initialState, 'initial_state');
                            if (known) candidates.push(known);
                        }

                        let nextData = viewInitialState ? (window.__NEXT_DATA__ || null) : null;
                        if (!nextData && viewInitialState) {
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
                            const apolloList = extractFromApolloCache(apolloState);
                            if (apolloList?.length) {
                                addCandidate(candidates, apolloList, apolloList.length, 'apollo_cache');
                            }
                        }

                        const scanTargets = [initialState, nextData, nextState, apolloState].filter(Boolean);
                        const details = [];
                        for (const target of scanTargets) {
                            details.push(...collectDetailItems(target));
                        }
                        const domDetails = useDomDetails ? extractRestaurantCardsFromDom() : [];
                        if (useDomDetails) {
                            addCandidate(candidates, domDetails, domDetails.length, 'dom_cards');
                        }
                        if (candidates.length === 0) {
                            for (const target of scanTargets) {
                                const scanned = findBestRestaurantArray(target);
                                addCandidate(candidates, scanned, scanned.length, 'scan');
                            }
                        }

                        candidates.sort((a, b) => scoreRestaurantList(b.restaurants) - scoreRestaurantList(a.restaurants)
                            || b.restaurants.length - a.restaurants.length
                            || (b.totalCount || 0) - (a.totalCount || 0));
                        const best = candidates[0] || { restaurants: [], totalCount: 0, source: null };
                        const bodyText = document.body?.innerText || '';
                        const blocked = /pardon our interruption|access denied|unusual traffic|are you a robot|captcha/i.test(bodyText)
                            || /access denied|robot|captcha/i.test(document.title || '');

                        return { ...best, blocked, details, domDetails };
                    }, { useDomDetails: enableDomDetails, pageNumber });
                };
                let jsonCandidateOffset = 0;
                let warnedBlocked = false;
                let noProgressPages = 0;
                let pageNumber = 1;
                const maxPages = Math.max(3, Math.ceil(RESULTS_WANTED / 50) + 5);

                const collectSnapshot = async () => {
                    const pageData = await extractFromPage(pageNumber);
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
                    if (Array.isArray(bestCandidate.restaurants)) detailItems.push(...bestCandidate.restaurants);
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

                const pushRestaurants = async (restaurants, detailIndex) => {
                    const savedBefore = saved;
                    for (const r of restaurants) {
                        const id = getRestaurantId(r);
                        const url = getRestaurantUrl(r);
                        const nameKey = normalizeNameKey(getCandidateName(r)) || null;
                        if (id !== null && id !== undefined && seenIds.has(String(id))) continue;
                        if (!id && url && seenUrls.has(url)) continue;
                        if (!id && !url && nameKey && seenNames.has(nameKey)) continue;

                        const item = normalizeRestaurant(r, findRestaurantDetail(r, detailIndex));
                        await Dataset.pushData(item);
                        saved++;

                        if (id !== null && id !== undefined) seenIds.add(String(id));
                        if (item.url) seenUrls.add(item.url);
                        const normalizedItemName = normalizeNameKey(item.name);
                        if (normalizedItemName) seenNames.add(normalizedItemName);

                        if (saved >= RESULTS_WANTED) break;
                    }
                    return saved - savedBefore;
                };

                let useApiPagination = false;
                let apiTemplate = null;
                let allowScroll = true;

                while (saved < RESULTS_WANTED && pageNumber <= maxPages) {
                    if (request.userData.apiTemplate && !useApiPagination) {
                        apiTemplate = request.userData.apiTemplate;
                        useApiPagination = true;
                        allowScroll = false;
                        const opname = apiTemplate.operationName || apiTemplate.queryParams?.opname || apiTemplate.url;
                        log.info(`Using API pagination via ${opname}`);
                    }
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

                    const shouldScroll = allowScroll && restaurants.length < RESULTS_WANTED;
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

                    const added = await pushRestaurants(restaurants, detailIndex);
                    const savedBefore = saved - added;

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

                    if (useApiPagination && pageNumber === 1 && apiTemplate) {
                        let apiPage = 2;
                        let pageSize = derivePageSize(apiTemplate.variables, restaurants.length || 50);
                        let apiTotal = totalCount;
                        while (saved < RESULTS_WANTED && apiPage <= maxPages) {
                            const apiResult = await fetchApiPage(apiTemplate, apiPage, pageSize, request.userData.userAgent);
                            if (!apiResult || apiResult.error) {
                                log.warning(`API pagination failed on page ${apiPage}: ${apiResult?.error || 'unknown error'}`);
                                break;
                            }
                            const extracted = extractRestaurantsFromData(apiResult.json);
                            const apiRestaurants = extracted.restaurants || [];
                            if (!apiRestaurants.length) {
                                log.info(`No restaurants found in API page ${apiPage}. Stopping API pagination.`);
                                break;
                            }

                            const apiDetails = [];
                            if (Array.isArray(extracted.details)) apiDetails.push(...extracted.details);
                            apiDetails.push(...apiRestaurants);
                            const apiDetailIndex = buildRestaurantIndex(apiDetails);

                            const addedApi = await pushRestaurants(apiRestaurants, apiDetailIndex);
                            log.info(`Saved ${saved}/${RESULTS_WANTED} restaurants (API page ${apiPage})`);

                            apiTotal = extracted.totalCount || apiTotal;
                            pageSize = apiResult.pageSize || pageSize;

                            if (addedApi === 0) break;
                            if (apiTotal && saved >= apiTotal) break;
                            if (apiRestaurants.length < pageSize) break;
                            apiPage += 1;
                        }
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
