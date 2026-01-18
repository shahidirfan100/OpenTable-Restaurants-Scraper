import { Actor, log } from 'apify';
import { Dataset, PlaywrightCrawler } from 'crawlee';
import { firefox } from 'playwright';

await Actor.init();

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const JSON_RESPONSE_RE = /\/dapi\/fe\/gql/i;
const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp|gif)$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_API_PAGES = 200;

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media']);
const RESOURCE_BLOCKLIST = [
    'google-analytics',
    'googletagmanager',
    'facebook',
    'doubleclick',
    'adsense',
    'hotjar',
];

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

const normalizeImageUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('data:')) return trimmed;

    let normalized = null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) normalized = trimmed;
    else if (trimmed.startsWith('//')) normalized = `https:${trimmed}`;
    else if (/otstatic\.com\//i.test(trimmed)) normalized = `https://${trimmed}`;
    else if (trimmed.startsWith('/')) normalized = `https://www.opentable.com${trimmed}`;
    else normalized = trimmed;

    try {
        const parsed = new URL(normalized);
        if (/resizer\.otstatic\.com$/i.test(parsed.hostname)) {
            const segments = parsed.pathname.split('/').filter(Boolean);
            const photosIndex = segments.indexOf('photos');
            if (photosIndex >= 0) {
                const tail = segments.slice(photosIndex + 1);
                const last = tail[tail.length - 1] || '';
                const existingSize = tail.length >= 2 ? tail[0] : null;
                if (existingSize && IMAGE_EXTENSION_RE.test(last)) return parsed.href;
                const idMatch = last.match(/\d+/);
                if (idMatch) return `https://resizer.otstatic.com/v2/photos/xlarge/${idMatch[0]}.jpg`;
            }
        }
        const lastSegment = parsed.pathname.split('/').pop() || '';
        if (!lastSegment) return parsed.href;
        if (!IMAGE_EXTENSION_RE.test(lastSegment)) parsed.pathname = `${parsed.pathname}.jpg`;
        return parsed.href;
    } catch {
        return normalized;
    }
};

const getCandidateName = (value) => value?.name || value?.restaurantName || value?.title || value?.displayName || value?.listingName || null;

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
        || value?.url
        || value?.href
        || value?.permalink
        || value?.path;
    const normalized = normalizeUrl(rawUrl);
    if (normalized) return normalized;
    const slug = value?.slug || value?.urlSlug || value?.seo?.slug || value?.seo?.urlSlug;
    if (typeof slug === 'string' && /[a-zA-Z]/.test(slug)) return `https://www.opentable.com/r/${slug}`;
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
    || value?.statistics?.reviews?.ratings?.overall?.rating
    || null;

const getRestaurantReviewsCount = (value) => value?.reviewCount
    || value?.reviewsCount
    || value?.numberOfReviews
    || value?.review_count
    || value?.reviews_count
    || value?.reviews?.count
    || value?.reviews?.total
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

const isLikelyRestaurant = (value) => {
    if (!value || typeof value !== 'object') return false;
    const name = getCandidateName(value);
    if (!name) return false;
    return Boolean(getRestaurantUrl(value) || getRestaurantId(value));
};

const unwrapRestaurantNode = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (isLikelyRestaurant(value)) return value;
    const candidates = [value.node, value.restaurant, value.listing, value.item, value.result];
    for (const candidate of candidates) {
        if (isLikelyRestaurant(candidate)) return candidate;
    }
    return null;
};

const normalizeRestaurantArray = (arr) => {
    if (!Array.isArray(arr)) return [];
    const normalized = [];
    for (const item of arr) {
        const unwrapped = unwrapRestaurantNode(item);
        if (unwrapped) normalized.push(unwrapped);
    }
    return normalized;
};

const parseJsonSafe = (value) => {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const extractRestaurantsFromData = (data) => {
    if (!data || typeof data !== 'object') return { restaurants: [], totalCount: 0 };

    const knownArrays = [
        data?.data?.search?.restaurants,
        data?.data?.search?.results,
        data?.data?.search?.searchResults?.restaurants,
        data?.data?.search?.searchResults?.results,
        data?.data?.search?.searchResults?.edges,
        data?.data?.searchResults?.restaurants,
        data?.data?.searchResults?.results,
        data?.data?.searchResults?.edges,
        data?.data?.availability?.restaurants,
        data?.search?.restaurants,
        data?.search?.results,
        data?.search?.searchResults?.restaurants,
        data?.search?.searchResults?.results,
        data?.search?.searchResults?.edges,
        data?.searchResults?.restaurants,
        data?.searchResults?.results,
        data?.searchResults?.edges,
        data?.restaurants,
    ];

    for (const arr of knownArrays) {
        const normalized = normalizeRestaurantArray(arr);
        if (normalized.length) {
            const totalCount = data?.data?.search?.totalRestaurantCount
                || data?.data?.search?.totalResults
                || data?.data?.search?.total
                || data?.data?.search?.pageInfo?.totalResults
                || data?.data?.search?.pageInfo?.totalCount
                || data?.data?.searchResults?.totalResults
                || data?.data?.searchResults?.total
                || data?.search?.totalRestaurantCount
                || data?.search?.totalResults
                || data?.search?.total
                || data?.totalResults
                || 0;
            return { restaurants: normalized, totalCount: Number(totalCount) || 0 };
        }
    }

    return { restaurants: [], totalCount: 0 };
};

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
    const body = postData ? parseJsonSafe(postData) : null;

    const variables = body?.variables || urlVariables || null;
    const operationName = body?.operationName || queryParams.opname || null;
    const extensions = body?.extensions || urlExtensions || null;

    return {
        url: `${parsedUrl.origin}${parsedUrl.pathname}`,
        method,
        queryParams,
        operationName,
        variables,
        extensions,
        body: body || null,
    };
};

const derivePageSize = (variables, fallback) => {
    if (!variables || typeof variables !== 'object') return fallback;
    let found = null;
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            if (found !== null) return;
            if ((typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
                && /limit|pageSize|pagesize|perPage|per_page|size|count/i.test(key)) {
                found = Number(value);
                return;
            }
            if (typeof value === 'object') visit(value);
        }
    };
    visit(variables);
    return found || fallback;
};

const updatePaginationVariables = (variables, page, pageSize) => {
    if (!variables || typeof variables !== 'object') return { variables, updated: false };
    const cloned = JSON.parse(JSON.stringify(variables));
    let updated = false;

    const setNumber = (node, key, numericValue) => {
        if (typeof node[key] === 'number') node[key] = numericValue;
        else if (typeof node[key] === 'string' && /^\d+$/.test(node[key])) node[key] = String(numericValue);
        else node[key] = numericValue;
    };

    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'object' && value !== null) visit(value);

            if (/pageNumber|pageIndex|page/i.test(key) && (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) {
                setNumber(node, key, page);
                updated = true;
            } else if (/offset|start|from|startIndex/i.test(key) && (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) {
                setNumber(node, key, Math.max(0, (page - 1) * pageSize));
                updated = true;
            } else if (/limit|pageSize|pagesize|perPage|per_page|size|count/i.test(key)
                && (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) {
                setNumber(node, key, pageSize);
                updated = true;
            }
        }
    };

    visit(cloned);
    return { variables: cloned, updated };
};

const updatePaginationParams = (params, page, pageSize) => {
    const updatedParams = { ...(params || {}) };
    let updated = false;
    for (const [key, value] of Object.entries(updatedParams)) {
        if (value === null || value === undefined) continue;
        if (!/^\d+$/.test(String(value))) continue;
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
    const resolvedPageSize = derivePageSize(template.variables, pageSize);
    const { variables, updated: varsUpdated } = updatePaginationVariables(template.variables, page, resolvedPageSize);
    const { params, updated: paramsUpdated } = updatePaginationParams(template.queryParams, page, resolvedPageSize);

    if (page > 1 && !varsUpdated && !paramsUpdated) {
        return { error: 'No pagination parameters found', pageSize: resolvedPageSize };
    }

    if (method === 'GET') {
        const url = new URL(template.url);
        for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
        if (variables) url.searchParams.set('variables', JSON.stringify(variables));
        if (template.extensions && !url.searchParams.get('extensions')) url.searchParams.set('extensions', JSON.stringify(template.extensions));
        return { url: url.href, method: 'GET', body: null, pageSize: resolvedPageSize };
    }

    const body = template.body ? { ...template.body } : {};
    body.variables = variables || body.variables;
    if (template.operationName) body.operationName = template.operationName;
    if (template.extensions) body.extensions = template.extensions;

    const query = new URLSearchParams(params || {}).toString();
    const url = query ? `${template.url}?${query}` : template.url;
    return { url, method: 'POST', body: JSON.stringify(body), pageSize: resolvedPageSize };
};

const scoreTemplate = (template, extracted) => {
    if (!template || !extracted) return 0;
    const op = String(template.operationName || template.queryParams?.opname || '').toLowerCase();
    const count = extracted.restaurants?.length || 0;
    const total = extracted.totalCount || 0;
    let score = count * 10;
    if (total && total >= count) score += 200;
    if (/home|module|recommend|homemodulelists/.test(op)) score -= 2000;
    if (/search|availability|results/.test(op)) score += 800;
    if (template.method === 'POST') score += 50;
    const variablesStr = JSON.stringify(template.variables || {});
    if (/term|search|query|metro|city|location/.test(variablesStr)) score += 80;
    if (/date|datetime|covers|party/.test(variablesStr)) score += 40;
    if (/page|offset|start|from/.test(variablesStr)) score += 100;
    return score;
};

const fetchApiPageInBrowser = async ({ page, template, pageNumber, pageSize }) => {
    const requestConfig = buildApiRequest(template, pageNumber, pageSize);
    if (!requestConfig || requestConfig.error) return { error: requestConfig?.error || 'Failed to build API request' };

    const result = await page.evaluate(async ({ url, method, body }) => {
        const headers = {
            accept: 'application/json',
            'accept-language': 'en-US,en;q=0.9',
        };
        if (method === 'POST') headers['content-type'] = 'application/json';
        const resp = await fetch(url, { method, headers, body: body || undefined });
        const text = await resp.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        return { ok: resp.ok, status: resp.status, json };
    }, { url: requestConfig.url, method: requestConfig.method, body: requestConfig.body });

    if (!result.ok) return { error: `API status ${result.status}`, pageSize: requestConfig.pageSize };
    if (!result.json) return { error: 'API returned non-JSON', pageSize: requestConfig.pageSize };
    return { json: result.json, pageSize: requestConfig.pageSize };
};

const normalizeRestaurant = (r) => {
    const base = r || {};
    const cuisines = Array.isArray(base?.cuisines) ? base.cuisines : [];
    const primaryCuisine = cuisines[0]?.name || cuisines[0] || null;
    const bookingSlots = base?.availabilitySlots || base?.timeslots || base?.slots || base?.availability?.slots || [];

    return {
        name: getCandidateName(base),
        cuisine: base?.cuisine?.name || base?.cuisine?.displayName || base?.primaryCuisine || base?.cuisineType || base?.cuisine || primaryCuisine,
        price_range: base?.priceBand || base?.priceRange || base?.price || base?.priceCategory || base?.price_range || null,
        rating: getRestaurantRating(base),
        reviews_count: getRestaurantReviewsCount(base),
        neighborhood: base?.neighborhood || base?.location?.neighborhood || base?.address?.neighborhood || null,
        city: base?.city || base?.location?.city || base?.address?.city || null,
        booking_slots: Array.isArray(bookingSlots) ? bookingSlots : [],
        url: getRestaurantUrl(base),
        image_url: normalizeImageUrl(getRestaurantImage(base)),
        restaurant_id: getRestaurantId(base),
    };
};

try {
    const input = (await Actor.getInput()) || {};
    const {
        start_url,
        date,
        time,
        covers = 2,
        location,
        results_wanted: resultsWantedRaw = 20,
        proxyConfiguration,
    } = input;

    const resultsWanted = Number.isFinite(+resultsWantedRaw) ? Math.max(1, +resultsWantedRaw) : 20;

    const buildSearchUrl = () => {
        if (start_url) return start_url;
        const baseUrl = new URL('https://www.opentable.com/s');
        if (date && time) baseUrl.searchParams.set('dateTime', `${date}T${time}:00`);
        else if (date) baseUrl.searchParams.set('dateTime', `${date}T19:00:00`);
        if (covers) baseUrl.searchParams.set('covers', String(covers));
        if (location) baseUrl.searchParams.set('term', location);
        return baseUrl.href;
    };

    const searchUrl = buildSearchUrl();
    log.info(`Starting scrape from: ${searchUrl}`);
    log.info(`Target results: ${resultsWanted}`);

    const proxyConf = proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
        : undefined;

    let saved = 0;
    const seenIds = new Set();
    const seenUrls = new Set();
    const seenNames = new Set();

    const pushUnique = async (restaurants) => {
        let added = 0;
        for (const r of restaurants) {
            const id = getRestaurantId(r);
            const url = getRestaurantUrl(r);
            const nameKey = normalizeNameKey(getCandidateName(r)) || null;

            if (id !== null && id !== undefined && seenIds.has(String(id))) continue;
            if (!id && url && seenUrls.has(url)) continue;
            if (!id && !url && nameKey && seenNames.has(nameKey)) continue;

            const item = normalizeRestaurant(r);
            await Dataset.pushData(item);
            saved += 1;
            added += 1;

            if (id !== null && id !== undefined) seenIds.add(String(id));
            if (item.url) seenUrls.add(item.url);
            const normalizedItemName = normalizeNameKey(item.name);
            if (normalizedItemName) seenNames.add(normalizedItemName);

            if (saved >= resultsWanted) break;
        }
        return added;
    };

    const crawler = new PlaywrightCrawler({
        launchContext: {
            launcher: firefox,
            launchOptions: { headless: true },
            userAgent: getRandomUserAgent(),
        },
        proxyConfiguration: proxyConf,
        maxConcurrency: 1,
        maxRequestRetries: 2,
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 180,
        preNavigationHooks: [
            async ({ page, request }) => {
                request.userData.apiCandidates = [];
                const responseListener = async (response) => {
                    const url = response.url();
                    if (!JSON_RESPONSE_RE.test(url)) return;
                    const contentType = response.headers()['content-type'] || '';
                    if (!contentType.includes('application/json')) return;
                    try {
                        const data = await response.json();
                        const extracted = extractRestaurantsFromData(data);
                        if (!extracted.restaurants.length) return;
                        if (extracted.restaurants.length < 2) return;

                        const req = response.request();
                        const template = extractGraphqlTemplate(url, req.method(), req.postData());
                        const score = scoreTemplate(template, extracted);
                        if (template && score > 0) {
                            request.userData.apiCandidates.push({ template, extracted, score });
                        }
                    } catch {
                        // ignore JSON errors
                    }
                };

                request.userData.responseListener = responseListener;
                page.on('response', responseListener);

                await page.route('**/*', (route) => {
                    const type = route.request().resourceType();
                    const url = route.request().url();
                    if (BLOCKED_RESOURCE_TYPES.has(type) || RESOURCE_BLOCKLIST.some((token) => url.includes(token))) {
                        return route.abort();
                    }
                    return route.continue();
                });
            },
        ],
        requestHandler: async ({ page, request }) => {
            log.info(`Processing: ${request.url}`);

            const cleanup = () => {
                const listener = request.userData?.responseListener;
                if (listener) page.off('response', listener);
            };

            try {
                await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => { });
                await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => { });

                const candidates = Array.isArray(request.userData?.apiCandidates) ? request.userData.apiCandidates : [];
                candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
                const best = candidates[0] || null;
                if (!best?.template) {
                    log.warning('No suitable search API response detected (expected ~50 results).');
                    return;
                }

                const bestTemplate = best.template;
                const bestFirstPage = best.extracted;
                const opname = bestTemplate.operationName || bestTemplate.queryParams?.opname || bestTemplate.url;
                log.info(`Using API pagination via ${opname}`);

                const firstRestaurants = bestFirstPage?.restaurants || [];
                if (firstRestaurants.length) {
                    await pushUnique(firstRestaurants);
                    log.info(`Saved ${saved}/${resultsWanted} restaurants (API page 1)`);
                }

                let pageSize = derivePageSize(bestTemplate.variables, DEFAULT_PAGE_SIZE);

                // FIX: Adjust pageSize if the server enforces a lower limit than observed/defaults
                // This prevents skipping items when calculating offsets (e.g. asking for 50, getting 20, then skipping to 50)
                if (firstRestaurants.length > 0 && firstRestaurants.length < pageSize) {
                    log.info(`Adjusted page size tracking from ${pageSize} to ${firstRestaurants.length} based on actual API response.`);
                    pageSize = firstRestaurants.length;
                }

                let apiTotal = bestFirstPage?.totalCount || 0;
                let apiPage = 2;
                let noProgress = 0;

                while (saved < resultsWanted && apiPage <= MAX_API_PAGES) {
                    const apiResult = await fetchApiPageInBrowser({ page, template: bestTemplate, pageNumber: apiPage, pageSize });
                    if (apiResult.error) {
                        log.warning(`API pagination failed on page ${apiPage}: ${apiResult.error}`);
                        break;
                    }

                    const extracted = extractRestaurantsFromData(apiResult.json);
                    const restaurants = extracted.restaurants || [];
                    if (!restaurants.length) {
                        log.info(`No restaurants found in API page ${apiPage}. Stopping.`);
                        break;
                    }

                    const added = await pushUnique(restaurants);
                    log.info(`Saved ${saved}/${resultsWanted} restaurants (API page ${apiPage})`);

                    apiTotal = extracted.totalCount || apiTotal;
                    pageSize = apiResult.pageSize || pageSize;

                    if (added === 0) noProgress += 1;
                    else noProgress = 0;

                    if (noProgress >= 2) break;
                    if (apiTotal && saved >= apiTotal) break;
                    if (restaurants.length < pageSize) break;

                    apiPage += 1;
                }
            } finally {
                cleanup();
            }
        },
    });

    await crawler.run([{ url: searchUrl }]);
    log.info(`Finished. Total restaurants saved: ${saved}`);
} finally {
    await Actor.exit();
}
