# Expense Tracker - Product Specification

## Overview

A personal expense tracking application that uses AI (Claude) to automatically classify bank statement transactions. Users upload PDF bank statements, the AI extracts and categorizes transactions, and users can visualize spending patterns through interactive charts.

## Problem Statement

Manual expense tracking is tedious and error-prone. Users often:
- Struggle to categorize transactions consistently
- Spend significant time entering data from bank statements
- Lack visibility into spending patterns across multiple accounts
- Have ambiguous transactions (e.g., Target could be groceries, clothing, or home goods)

## Solution

An AI-powered expense tracker that:
1. Automatically extracts transactions from PDF bank statements
2. Intelligently classifies each transaction into predefined categories
3. **Learns from user corrections** to improve future classifications
4. Allows manual corrections and edits
5. Provides visual insights into spending patterns

---

## User Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User drops PDF bank statement(s) into the upload zone   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Client extracts text from PDF (pdf.js)                  │
│     - Sends extracted text to server API                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Server calls Claude API with:                           │
│     - PDF text                                              │
│     - Category taxonomy                                     │
│     - User's learned merchant preferences                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Claude extracts and classifies transactions             │
│     - Uses merchant preferences for ambiguous cases         │
│     - Returns structured JSON                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Transactions saved to server and displayed in table     │
│     - User can modify category, subcategory, notes          │
│     - Edits update merchant preferences (learning!)         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  6. Charts update to reflect current data                   │
│     - Monthly expenses (stacked bar chart)                  │
│     - Category breakdown (horizontal bar chart)             │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Framework** | Next.js 15 (App Router) | Server-side API routes for secure API key handling |
| **AI** | Claude API via Anthropic SDK | Flexible parsing of various bank statement formats |
| **PDF Parsing** | pdf.js (client-side) | Extract text before sending to server |
| **Charts** | Chart.js + react-chartjs-2 | Mature library with React integration |
| **Storage** | Server-side JSON files | Persistent, no size limits, easy backup |
| **Styling** | Tailwind CSS | Rapid UI development |

### Data Storage

All data stored server-side in `data/` directory:

```
data/
├── taxonomy.json        # Category definitions (user-editable)
├── transactions.csv     # All imported transactions (CSV for easy Excel access)
└── preferences.json     # Learned merchant → category mappings
```

**Why server-side storage over localStorage?**
- Persistence across browsers and devices
- No 5MB size limit
- Easy backup (just copy files)
- **CSV for transactions** - directly editable in Excel/Google Sheets
- Server-side validation

### API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/classify` | POST | Send PDF text, get classified transactions |
| `/api/transactions` | GET | Fetch all transactions (with optional date filter) |
| `/api/transactions` | POST | Save new transactions |
| `/api/transactions/[id]` | PUT | Update transaction (triggers preference learning) |
| `/api/transactions/[id]` | DELETE | Delete transaction |
| `/api/preferences` | GET | Get merchant preference mappings |
| `/api/export` | GET | Export as CSV or JSON |

### Environment Variables

```bash
# .env.local (gitignored)
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Category Taxonomy

### Design Principles

Based on best practices from [LunchMoney](https://lunchmoney.app/blog/how-to-choose-the-right-budget-categories), [Quicken](https://info.quicken.com/sim/using-categories), and [FasterCapital](https://fastercapital.com/content/Expense-tracking-categories--How-to-define-and-use-expense-tracking-categories-and-subcategories.html):

1. **10-17 main categories** - avoid over-categorization
2. **3-7 subcategories each** - enough granularity without complexity
3. **Include "Other/Uncategorized"** - catch-all for edge cases
4. **User-editable** - stored in `data/taxonomy.json`

### Category Structure

Stored in `data/taxonomy.json` with this schema:

```json
{
  "version": "1.0",
  "categories": [
    {
      "id": "housing",
      "name": "Housing",
      "description": "Rent, mortgage, and home-related expenses for your primary residence",
      "color": "#4F46E5",
      "subcategories": [
        {
          "id": "rent",
          "name": "Rent",
          "description": "Monthly rent payments to landlord",
          "examples": ["AVALON APARTMENTS", "EQUITY RESIDENTIAL", "GREYSTAR"]
        },
        {
          "id": "mortgage",
          "name": "Mortgage",
          "description": "Home loan principal and interest",
          "examples": ["WELLS FARGO MORTGAGE", "QUICKEN LOANS", "CHASE HOME LENDING"]
        }
      ]
    },
    {
      "id": "food",
      "name": "Food",
      "description": "All food and beverage purchases, whether groceries or dining out",
      "color": "#22C55E",
      "subcategories": [
        {
          "id": "grocery",
          "name": "Grocery",
          "description": "Supermarkets and food stores",
          "examples": ["COSTCO", "SAFEWAY", "WHOLE FOODS", "TRADER JOES", "KROGER"]
        },
        {
          "id": "restaurant",
          "name": "Restaurant",
          "description": "Dine-in and takeout meals",
          "examples": ["CHIPOTLE", "OLIVE GARDEN", "MCDONALDS", "CHICK-FIL-A"]
        },
        {
          "id": "coffee",
          "name": "Coffee",
          "description": "Coffee shops and cafes",
          "examples": ["STARBUCKS", "PEETS COFFEE", "DUNKIN", "BLUE BOTTLE"]
        }
      ]
    }
  ]
}
```

The `description` and `examples` fields help the LLM accurately classify transactions by:
1. Understanding what each category/subcategory is for
2. Matching merchant names against known examples
3. Making informed decisions for similar-sounding merchants

### Default Categories (17)

#### 1. Housing
**Description:** Rent, mortgage, and home-related expenses for your primary residence.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Rent | Monthly rent payments to landlord | AVALON APARTMENTS, EQUITY RESIDENTIAL, GREYSTAR |
| Mortgage | Home loan principal and interest | WELLS FARGO MORTGAGE, QUICKEN LOANS, CHASE HOME LENDING |
| Property Tax | Annual/semi-annual property taxes | COUNTY TAX COLLECTOR, PROPERTY TAX PAYMENT |
| HOA | Homeowners association fees | HOA DUES, COMMUNITY MANAGEMENT |
| Home Insurance | Homeowners or renters insurance | STATE FARM, ALLSTATE, LEMONADE |
| Maintenance | Repairs, improvements, cleaning | HOME DEPOT, LOWES, SERVPRO, handyman services |

#### 2. Utilities
**Description:** Essential recurring services for your home.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Electric | Electricity bills | PG&E, EDISON, DUKE ENERGY, CON EDISON |
| Gas | Natural gas for heating/cooking | SOCAL GAS, NATIONAL GRID |
| Water | Water and sewer services | CITY WATER, EBMUD, WATER UTILITY |
| Internet | Home internet service | COMCAST, XFINITY, AT&T, VERIZON FIOS, SPECTRUM |
| Phone | Mobile and landline phone | T-MOBILE, VERIZON WIRELESS, AT&T WIRELESS |
| Trash | Garbage and recycling | WASTE MANAGEMENT, REPUBLIC SERVICES |

#### 3. Food
**Description:** All food and beverage purchases, whether groceries or dining out.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Grocery | Supermarkets and food stores | COSTCO, SAFEWAY, WHOLE FOODS, TRADER JOES, KROGER, WALMART GROCERY |
| Restaurant | Dine-in and takeout meals | CHIPOTLE, OLIVE GARDEN, local restaurants, MCDONALDS, CHICK-FIL-A |
| Coffee | Coffee shops and cafes | STARBUCKS, PEETS COFFEE, DUNKIN, BLUE BOTTLE |
| Delivery | Food delivery services | DOORDASH, UBEREATS, GRUBHUB, POSTMATES, INSTACART |
| Alcohol | Bars, liquor stores, breweries | TOTAL WINE, BEVMO, bars, DRIZLY |

#### 4. Transportation
**Description:** All costs related to getting around - car ownership, fuel, and transit.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Gas | Fuel for vehicles | SHELL, CHEVRON, EXXON, COSTCO GAS, BP, ARCO |
| Public Transit | Buses, trains, subway | BART, MTA, CALTRAIN, METRO, CLIPPER |
| Rideshare | Taxi and rideshare services | UBER, LYFT, taxi services |
| Parking | Parking fees and meters | SPOTHERO, PARKWHIZ, parking garages, meters |
| Car Insurance | Auto insurance premiums | GEICO, PROGRESSIVE, STATE FARM AUTO |
| Car Payment | Auto loan or lease payments | TOYOTA FINANCIAL, HONDA FINANCIAL, CAR LOAN |
| Maintenance | Repairs, oil changes, tires | JIFFY LUBE, FIRESTONE, DISCOUNT TIRE, mechanics |

#### 5. Healthcare
**Description:** Medical expenses and health-related costs.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Doctor | Doctor visits, urgent care, hospital | KAISER, ONE MEDICAL, SUTTER HEALTH, medical offices |
| Dental | Dentist and orthodontist | DENTAL OFFICE, ASPEN DENTAL, orthodontist |
| Vision | Eye exams, glasses, contacts | LENSCRAFTERS, WARBY PARKER, optometrist |
| Pharmacy | Prescriptions and OTC medicine | CVS, WALGREENS, RITE AID, pharmacy |
| Health Insurance | Health insurance premiums | BLUE CROSS, AETNA, UNITED HEALTHCARE, KAISER PREMIUM |

#### 6. Shopping
**Description:** Retail purchases for clothing, electronics, and household items.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Clothing | Apparel and accessories | NORDSTROM, MACYS, ZARA, H&M, GAP, NIKE |
| Electronics | Gadgets, computers, phones | APPLE STORE, BEST BUY, B&H PHOTO |
| Home Goods | Furniture, decor, kitchenware | IKEA, CRATE & BARREL, BED BATH BEYOND, WILLIAMS SONOMA |
| Amazon | Amazon purchases (when category unknown) | AMAZON.COM, AMZN, AMAZON MARKETPLACE |
| General | Other retail purchases | TARGET, WALMART, COSTCO (non-food), department stores |

#### 7. Entertainment
**Description:** Leisure activities, media subscriptions, and fun.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Streaming | Video/music streaming services | NETFLIX, SPOTIFY, HULU, DISNEY+, HBO MAX, YOUTUBE PREMIUM |
| Movies | Movie theaters and rentals | AMC, REGAL, FANDANGO, movie rentals |
| Games | Video games and gaming | STEAM, PLAYSTATION, XBOX, NINTENDO, game stores |
| Concerts | Live music and events | TICKETMASTER, LIVE NATION, STUBHUB, concert venues |
| Sports | Sporting events and activities | sports tickets, golf courses, ski resorts |
| Hobbies | Hobby supplies and activities | craft stores, hobby shops, MICHAELS, JOANN |

#### 8. Travel
**Description:** Vacation and trip-related expenses (not daily commute).

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Flights | Airfare and airline fees | UNITED AIRLINES, DELTA, AMERICAN AIRLINES, SOUTHWEST, JETBLUE |
| Hotels | Lodging and accommodations | MARRIOTT, HILTON, AIRBNB, VRBO, HYATT, hotels |
| Car Rental | Rental cars for trips | HERTZ, ENTERPRISE, NATIONAL, AVIS, TURO |
| Activities | Tours, attractions, experiences | museums, tours, VIATOR, theme parks, excursions |

#### 9. Kids
**Description:** Child-related expenses including education and activities.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Childcare | Daycare, babysitting, nanny | daycare centers, CARE.COM, nanny payments |
| School/Tuition | School fees, tuition payments | school payments, tuition, KUMON, tutoring |
| Activities | Sports, lessons, camps | youth sports, dance class, music lessons, summer camp |
| Supplies | School supplies, backpacks | school supply purchases, STAPLES for school |
| Toys | Toys and games for children | TOYS R US, LEGO, toy stores, AMAZON toys |

#### 10. Pets
**Description:** Pet ownership costs including food, health, and supplies.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Pet Food | Food and treats for pets | PETCO, PETSMART, CHEWY, pet food stores |
| Vet | Veterinary care and medicine | veterinary clinics, BANFIELD, VCA, pet hospitals |
| Grooming | Pet grooming services | pet groomers, PETCO GROOMING, mobile groomers |
| Supplies | Pet supplies and accessories | pet stores, PETCO, PETSMART, pet supplies |

#### 11. Personal Care
**Description:** Self-care, grooming, and fitness expenses.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Haircut | Hair salons and barber shops | SUPERCUTS, salons, barber shops, GREAT CLIPS |
| Gym | Fitness memberships and classes | EQUINOX, 24 HOUR FITNESS, PLANET FITNESS, ORANGETHEORY, PELOTON |
| Spa | Spa treatments and massage | spas, massage, MASSAGE ENVY, nail salons |
| Personal Items | Toiletries and personal products | SEPHORA, ULTA, drugstore personal care |

#### 12. Education
**Description:** Learning and professional development expenses (for adults).

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Tuition | College, graduate school tuition | university payments, college tuition |
| Books | Textbooks and educational books | AMAZON BOOKS, CHEGG, bookstores, BARNES & NOBLE |
| Courses | Online courses and certifications | UDEMY, COURSERA, LINKEDIN LEARNING, bootcamps |
| Supplies | Educational supplies | school supplies, STAPLES, office supplies for school |

#### 13. Gifts & Donations
**Description:** Money given to others, whether as gifts or charitable donations.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Gifts | Presents for others | gift shops, ETSY, gift purchases at any store |
| Charity | Charitable donations | UNITED WAY, RED CROSS, GOFUNDME, nonprofit donations |
| Religious | Tithes and religious donations | church donations, religious organizations |

#### 14. Financial
**Description:** Banking fees, interest charges, and financial services.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Bank Fees | Account fees, ATM fees, wire fees | BANK FEE, ATM FEE, WIRE TRANSFER FEE, overdraft |
| Interest | Interest charges and late fees | INTEREST CHARGE, LATE FEE, FINANCE CHARGE |
| Investment Fees | Brokerage and investment fees | FIDELITY, SCHWAB, VANGUARD fees, trading fees |
| Other Insurance | Life, disability, umbrella insurance | NORTHWESTERN MUTUAL, life insurance, disability |

#### 15. Income
**Description:** Money coming in (negative amounts in the system).

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Salary | Paycheck deposits | PAYROLL, direct deposit, employer name |
| Refund | Returns and refunds | REFUND, CREDIT, merchandise return |
| Transfer In | Money transferred from other accounts | TRANSFER FROM, DEPOSIT, VENMO (incoming) |
| Interest Earned | Bank interest and dividends | INTEREST PAYMENT, DIVIDEND, APY interest |

#### 16. Transfer
**Description:** Money movement between accounts (neither income nor expense).

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Between Accounts | Transfers to/from own accounts | TRANSFER TO SAVINGS, TRANSFER FROM CHECKING |
| Credit Card Payment | Paying credit card bills | CREDIT CARD PAYMENT, CHASE CARD PAYMENT |

#### 17. Other
**Description:** Transactions that don't fit other categories or need manual review.

| Subcategory | Description | Example Merchants |
|-------------|-------------|-------------------|
| Uncategorized | Needs manual categorization | unknown merchants, unclear transactions |
| Miscellaneous | One-off or unusual expenses | anything that doesn't fit elsewhere |

---

## Merchant Preference Learning

### Problem: Ambiguous Merchants

Some merchants sell multiple product types:
- **Target** → Could be Grocery, Clothing, or Home Goods
- **Amazon** → Could be Electronics, Home Goods, or anything
- **Costco** → Could be Grocery or Gas

### Solution: Learn from User Corrections

When a user changes a transaction's category, the system:

1. **Normalizes the merchant name**: "TARGET #1234 CUPERTINO CA" → "target"
2. **Stores the preference**: Maps normalized merchant to user's chosen category
3. **Increments confidence**: Tracks how many times this mapping was used
4. **Applies automatically**: High-confidence mappings (count > 3) apply without AI

### Preference Schema

```json
// data/preferences.json
{
  "merchants": {
    "target": {
      "categoryId": "food",
      "subcategoryId": "grocery",
      "count": 5,
      "lastUsed": "2025-01-27"
    },
    "costco": {
      "categoryId": "food",
      "subcategoryId": "grocery",
      "count": 12,
      "lastUsed": "2025-01-25"
    }
  }
}
```

### How Preferences Improve Classification

1. **Sent to Claude**: User preferences included in classification prompt
2. **Claude uses as hints**: "User previously categorized 'target' as Food > Grocery"
3. **Auto-apply**: For merchants with count > 3, skip Claude and apply directly

---

## UI Specification

### Layout (Desktop)

```
┌────────────────────────────────────────────────────────────────┐
│  Expense Tracker                          [Date Range ▼]       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │   Monthly Expenses      │  │   Expense by Category       │  │
│  │   (Stacked Bar Chart)   │  │   (Horizontal Bar Chart)    │  │
│  │                         │  │                             │  │
│  │   █ █ █ █               │  │   Grocery    ████████       │  │
│  │   █ █ █ █               │  │   Housing    ███████        │  │
│  │   █ █ █ █               │  │   Kids       █████          │  │
│  │   Jan Feb Mar Apr       │  │   Travel     ████           │  │
│  └─────────────────────────┘  └─────────────────────────────┘  │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  Add Data                                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                          │  │
│  │            ⊕ Drop your bank statements here              │  │
│  │               (PDF files supported)                      │  │
│  │                                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  Transactions                            [Export CSV] [Clear]  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Date     │ Transaction    │ Amount │ Bank  │ Category    │  │
│  │──────────│────────────────│────────│───────│─────────────│  │
│  │ 12/30/25 │ Costco         │ $435   │ Chase │ Food ▼      │  │
│  │ 12/29/25 │ United Airlines│ $1,235 │ Chase │ Travel ▼    │  │
│  │ 12/15/25 │ Central Loan   │ $335   │ Citi  │ Housing ▼   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Components

#### 1. Header
- Title: "Expense Tracker"
- Date range selector dropdown
  - Options: Last month, Last 3 months, Last 6 months, Last 12 months, All time

#### 2. Monthly Expenses Chart (Stacked Bar)
- X-axis: Months
- Y-axis: Dollar amount
- Stacked segments: Top 5-6 categories (others grouped as "Other")
- Hover: Show breakdown tooltip
- Color-coded by category (from taxonomy.json)

#### 3. Expense by Category Chart (Horizontal Bar)
- Y-axis: Category names
- X-axis: Dollar amount
- Sorted by total amount (descending)
- Show dollar values at end of bars
- Color matches stacked bar colors

#### 4. Upload Zone
- Drag-and-drop area
- Click to browse files
- Accepts: PDF files only
- Shows upload progress
- Displays processing status ("Extracting...", "Classifying...")

#### 5. Transactions Table

| Column | Type | Editable | Notes |
|--------|------|----------|-------|
| Date | Date | No | From statement |
| Transaction | Text | No | Merchant/description |
| Amount | Currency | No | Always positive (expenses) |
| Bank | Text | No | Detected from PDF |
| Account | Text | No | e.g., "Checking", "Credit Card" |
| Category | Dropdown | Yes | Primary category - **triggers preference learning** |
| Subcategory | Dropdown | Yes | Depends on category |
| Note | Text | Yes | User notes |

Features:
- Sortable columns
- Inline editing for editable fields
- Delete row option
- **When category changes → updates preferences.json**

---

## Data Model

### Transaction Schema

```typescript
interface Transaction {
  id: string;              // UUID
  date: string;            // ISO date "2025-12-30"
  description: string;     // Original transaction description
  amount: number;          // Positive for expenses, negative for income
  bank: string;            // "Chase", "Citi", etc.
  account: string;         // "Checking", "Sapphire Credit Card"
  categoryId: string;      // References taxonomy category id
  subcategoryId: string;   // References taxonomy subcategory id
  note: string;            // User note
  source: string;          // Filename of source PDF
  createdAt: string;       // ISO timestamp when imported
  modifiedAt: string;      // ISO timestamp when last edited
}
```

### Category Schema

```typescript
interface Category {
  id: string;
  name: string;
  color: string;           // Hex color for charts
  subcategories: Array<{
    id: string;
    name: string;
  }>;
}
```

### Preference Schema

```typescript
interface MerchantPreference {
  categoryId: string;
  subcategoryId: string;
  count: number;           // Times this mapping was used
  lastUsed: string;        // ISO timestamp
}

interface Preferences {
  merchants: Record<string, MerchantPreference>;
}
```

---

## AI Classification

### Approach: Flexible LLM-Based Parsing

Different banks have vastly different statement formats. Instead of rigid parsing rules, we let Claude interpret the text flexibly.

### Classification Prompt

```
You are a financial transaction classifier. Given bank statement text, category taxonomy with descriptions and examples, and user preferences, extract and categorize each transaction.

## Category Taxonomy
[For each category, include: id, name, description, and for each subcategory: id, name, description, examples]

Example format sent to Claude:
- food: "All food and beverage purchases"
  - grocery: "Supermarkets and food stores" (examples: COSTCO, SAFEWAY, WHOLE FOODS, TRADER JOES)
  - restaurant: "Dine-in and takeout meals" (examples: CHIPOTLE, OLIVE GARDEN, MCDONALDS)
  - coffee: "Coffee shops and cafes" (examples: STARBUCKS, PEETS COFFEE, DUNKIN)

## User Preferences (for ambiguous merchants)
[preferences from preferences.json]
Example: "User always categorizes 'TARGET' as food > grocery (used 5 times)"

## Instructions
1. Extract each transaction: date, description, amount
2. Clean up merchant names (remove card numbers, location codes, extra characters)
3. Match merchants to example merchants in taxonomy when possible
4. Use subcategory descriptions to determine best fit
5. Apply user preferences for merchants they've previously categorized
6. Parse dates to YYYY-MM-DD format
7. Positive amounts = expenses, negative = income/credits
8. When uncertain, use "other > uncategorized"

## Bank Statement Text
{pdfText}

Respond with JSON only:
{
  "bank": "Bank Name",
  "account": "Account Type",
  "transactions": [
    {
      "date": "2025-01-15",
      "description": "STARBUCKS",
      "amount": 5.75,
      "categoryId": "food",
      "subcategoryId": "coffee"
    }
  ]
}
```

---

## Edge Cases & Error Handling

1. **Unreadable PDF**: Show error, suggest trying a different file
2. **Duplicate transactions**: Detect by date+amount+description, warn user
3. **Unknown merchant**: Default to "Other > Uncategorized"
4. **Invalid amount**: Show warning, allow manual correction
5. **Date parsing**: Claude handles various formats (MM/DD/YY, YYYY-MM-DD, etc.)
6. **Large PDFs**: Show progress indicator

---

## Success Metrics

1. **Time to categorize**: < 30 seconds per statement
2. **Classification accuracy**: > 85% correct on first pass
3. **Preference learning**: Accuracy improves over time as user corrects
4. **Data retention**: All data persists across sessions

---

## Future Enhancements (Out of Scope for V1)

- [ ] Multi-currency support
- [ ] Budget setting and tracking
- [ ] Recurring transaction detection
- [ ] Spending trends and insights
- [ ] Cloud sync across devices
- [ ] Mobile-responsive design
- [ ] Receipt photo capture
- [ ] Bank account direct connection (Plaid)
- [ ] Split transactions

---

## File Structure

```
expense-tracker/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── classify/route.ts
│   │   │   ├── transactions/route.ts
│   │   │   ├── transactions/[id]/route.ts
│   │   │   ├── preferences/route.ts
│   │   │   └── export/route.ts
│   │   ├── components/
│   │   │   ├── charts/
│   │   │   │   ├── MonthlyExpensesChart.tsx
│   │   │   │   └── CategoryTotalsChart.tsx
│   │   │   ├── DateRangeFilter.tsx
│   │   │   ├── ExportButton.tsx
│   │   │   ├── PDFUploadZone.tsx
│   │   │   └── TransactionsTable.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── lib/
│   │   ├── storage.ts           # Server-side file I/O (CSV + JSON)
│   │   ├── merchantMatcher.ts   # Normalize merchant names
│   │   ├── pdfExtractor.ts      # Client-side PDF text extraction
│   │   └── chartConfig.ts       # Chart.js colors and config
│   └── types/
│       └── index.ts
├── data/
│   ├── taxonomy.json
│   ├── transactions.csv
│   └── preferences.json
├── .env.local
└── package.json
```

---

## Appendix: Sample Data

### Sample Transactions

```csv
date,description,amount,bank,account,categoryId,subcategoryId,note
2025-12-30,COSTCO WHOLESALE,435.67,Chase,Checking,food,grocery,
2025-12-29,UNITED AIRLINES,1235.00,Chase,Sapphire Card,travel,flights,Trip to NYC
2025-12-15,CENTRAL LOAN PAYMENT,335.67,Citi,Checking,housing,mortgage,
2025-12-10,NETFLIX,15.99,Chase,Sapphire Card,entertainment,streaming,
2025-12-08,SHELL OIL,45.23,Chase,Checking,transportation,gas_fuel,
2025-12-05,WHOLE FOODS,127.84,Chase,Sapphire Card,food,grocery,
```

### Sample Preferences

```json
{
  "merchants": {
    "costco": { "categoryId": "food", "subcategoryId": "grocery", "count": 8, "lastUsed": "2025-01-27" },
    "target": { "categoryId": "food", "subcategoryId": "grocery", "count": 5, "lastUsed": "2025-01-25" },
    "amazon": { "categoryId": "shopping", "subcategoryId": "general", "count": 3, "lastUsed": "2025-01-20" }
  }
}
```
