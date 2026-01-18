# OpenTable Restaurants Scraper

Extract restaurant data from OpenTable search results and collection pages. Get restaurant names, cuisine types, ratings, reviews, pricing, neighborhoods, and available booking times.

---

## Features

- **Comprehensive Data Extraction** - Collect restaurant name, cuisine, price range, rating, reviews count, neighborhood, booking slots, and images
- **Flexible Search Options** - Use a direct URL or search by date, time, party size, and location
- **Fast Performance** - Optimized to extract data efficiently
- **Structured Output** - Clean JSON data ready for analysis or integration

---

## Use Cases

- **Restaurant Research** - Compare restaurants in a specific area
- **Market Analysis** - Analyze dining trends, pricing, and popularity
- **Reservation Planning** - Find available booking times across multiple restaurants
- **Competitive Intelligence** - Monitor restaurant ratings and reviews
- **Location Analytics** - Study restaurant distribution by neighborhood

---

## Input Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `start_url` | string | OpenTable search or collection URL | - |
| `date` | string | Reservation date (YYYY-MM-DD format) | - |
| `time` | string | Reservation time (HH:MM format, e.g., 19:00) | - |
| `covers` | integer | Party size (1-20) | 2 |
| `location` | string | City or neighborhood to search | - |
| `results_wanted` | integer | Maximum restaurants to collect | 20 |
| `proxyConfiguration` | object | Proxy settings | Residential |

> You can either provide a `start_url` directly OR use the search parameters (date, time, covers, location) to build a search.

---

## Output Data

Each restaurant includes:

| Field | Description |
|-------|-------------|
| `name` | Restaurant name |
| `cuisine` | Primary cuisine type |
| `price_range` | Price indicator (e.g., $$, $$$, $$$$) |
| `rating` | Star rating (1-5) |
| `reviews_count` | Total number of reviews |
| `neighborhood` | Restaurant neighborhood/area |
| `city` | City location |
| `booking_slots` | Available reservation times |
| `url` | OpenTable restaurant page URL |
| `image_url` | Restaurant photo URL |
| `restaurant_id` | OpenTable restaurant ID |

---

## Usage Examples

### Search by URL

```json
{
  "start_url": "https://www.opentable.com/s?dateTime=2026-01-20T19:00:00&covers=2&metroId=4",
  "results_wanted": 50
}
```

### Search by Parameters

```json
{
  "date": "2026-01-20",
  "time": "19:00",
  "covers": 4,
  "location": "Los Angeles",
  "results_wanted": 30
}
```

---

## Sample Output

```json
{
  "name": "Fogo de Chão - Los Angeles",
  "cuisine": "Brazilian",
  "price_range": "$$$$",
  "rating": 4.7,
  "reviews_count": 2177,
  "neighborhood": "Downtown",
  "city": "Los Angeles",
  "booking_slots": ["6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM"],
  "url": "https://www.opentable.com/r/fogo-de-chao-los-angeles",
  "image_url": "https://resizer.otstatic.com/v2/photos/xlarge/1/12345678.jpg",
  "restaurant_id": "12345"
}
```

---

## Tips

1. **Use Direct URLs** - For collection pages (like "Best Italian Restaurants"), copy the full URL from your browser
2. **Adjust Party Size** - Different party sizes may show different availability
3. **Check Date/Time** - Ensure the date is in the future for booking availability
4. **Start Small** - Test with `results_wanted: 10` before larger scrapes

---

## Integrations

Export your data to:
- **Google Sheets** - For easy sharing and analysis
- **Excel** - Download as CSV or XLSX
- **Webhooks** - Send data to your systems in real-time
- **APIs** - Access results programmatically

Connect with other Apify actors for data enrichment and automation workflows.

---

## Legal Notice

This scraper collects publicly available information from OpenTable. Users are responsible for ensuring their use complies with OpenTable's Terms of Service and applicable data protection regulations. Use the data responsibly and respect rate limits.