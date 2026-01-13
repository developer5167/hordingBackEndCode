Payments APIs (Client Admin)

This file documents the payments-related endpoints added to the admin router.

Base path: (same router where `adminApis.js` is mounted)
- These endpoints require `checkValidClient` and `auth` middleware (client-scoped).

Endpoints

1) GET /payments/summary
- Description: Aggregate metrics for the current client.
- Query params: none
- Response (200):
  {
    success: true,
    data: {
      total_transactions: number,
      total_amount_paise: number,
      total_amount: number,        // rupees (amount_paise / 100)
      paid_amount_paise: number,
      paid_amount: number,         // rupees
      paid_count: number,
      failed_count: number,
      today_amount_paise: number,
      today_amount: number,        // rupees
      month_amount_paise: number,
      month_amount: number         // rupees
    }
  }

2) GET /payments/recent
- Description: Paginated list of recent payments for the client.
- Query params:
  - page (default 1)
  - limit (default 20)
  - status (optional) - filter by payment status (e.g. "PAID", "pending")
- Response (200):
  {
    success: true,
    page: number,
    limit: number,
    data: [ { id, plan_id, amount_paise, amount, status, transaction_id, receipt, razorpay_order_id, wallet_applied, created_at }, ... ]
  }

3) GET /payments/recent-by-user
- Description: Aggregated payments grouped by `created_by` (top payers for this client).
- Query params:
  - limit (default 10)
- Response (200):
  { success: true, data: [ { created_by, tx_count, amount_paise, amount }, ... ] }

4) GET /payments/user/:userId
- Description: Paginated list of payments where `created_by = :userId` (scoped to client).
- Params: :userId
- Query params: page (default 1), limit (default 50)
- Response (200):
  { success: true, page, limit, data: [ { id, plan_id, amount_paise, amount, status, transaction_id, receipt, razorpay_order_id, wallet_applied, created_at }, ... ] }

Wallet APIs

5) GET /wallet/balance
- Description: Get the current wallet balance for the client.
- Query params: none
- Response (200):
  {
    success: true,
    data: {
      balance_paise: number,
      balance: number  // rupees
    }
  }

6) GET /wallet/transactions
- Description: Paginated list of wallet transactions (credits/debits).
- Query params:
  - page (default 1)
  - limit (default 50)
  - tr_type (optional) - filter by "credit" or "debit"
- Response (200):
  {
    success: true,
    page: number,
    limit: number,
    total: number,
    totalPages: number,
    data: [ { id, amount_paise, amount, tr_type, balance_after_paise, balance_after, description, reference_type, reference_id, created_by, updated_at }, ... ]
  }

7) GET /wallet/transactions/:id
- Description: Fetch a specific wallet transaction by ID.
- Params: :id (transaction ID)
- Response (200):
  { success: true, data: { id, amount_paise, amount, tr_type, balance_after_paise, balance_after, description, reference_type, reference_id, created_by, updated_at } }
- Response (404): { success: false, message: "transaction_not_found" }

CSV Export APIs

8) GET /payments/export/csv
- Description: Export payments as CSV file (downloadable).
- Query params:
  - status (optional) - filter by status before export
- Response: CSV file with columns: ID, Plan ID, Amount (Paise), Amount (Rupees), Status, Transaction ID, Receipt, Razorpay Order ID, Wallet Applied, Created At

9) GET /wallet/transactions/export/csv
- Description: Export wallet transactions as CSV file (downloadable).
- Query params:
  - tr_type (optional) - filter by "credit" or "debit" before export
- Response: CSV file with columns: ID, Amount (Paise), Amount (Rupees), Type, Balance After (Paise), Balance After (Rupees), Description, Reference Type, Reference ID, Created By, Updated At

Notes / Implementation details
- `payments.amount` in the DB is returned as paise in queries; APIs return both `amount_paise` and `amount` (rupees) for convenience.
- All endpoints are scoped to `req.client_id` (enforced via `checkValidClient`), and require authentication via `auth` middleware.
- `created_by` is used for grouping/filtering; if your system records a different user column, adjust accordingly.

Testing
- Use your existing auth token + client context when calling these endpoints.
- Example curl (replace base URL and token):

  curl -H "Authorization: Bearer <TOKEN>" \
    "https://your-api.example.com/admin/payments/summary"

- Recent payments example:
  curl -H "Authorization: Bearer <TOKEN>" "https://your-api.example.com/admin/payments/recent?page=1&limit=20"

- Wallet balance:
  curl -H "Authorization: Bearer <TOKEN>" "https://your-api.example.com/admin/wallet/balance"

- Wallet transactions:
  curl -H "Authorization: Bearer <TOKEN>" "https://your-api.example.com/admin/wallet/transactions?page=1&limit=50"

- Export payments as CSV:
  curl -H "Authorization: Bearer <TOKEN>" "https://your-api.example.com/admin/payments/export/csv?status=PAID" -o payments.csv

- Export wallet transactions as CSV:
  curl -H "Authorization: Bearer <TOKEN>" "https://your-api.example.com/admin/wallet/transactions/export/csv?tr_type=debit" -o wallet.csv

React Integration Examples

**Fetch payments summary:**
```javascript
const fetchPaymentsSummary = async (token) => {
  const res = await fetch('/admin/payments/summary', {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};
```

**Fetch recent payments:**
```javascript
const fetchRecentPayments = async (token, page = 1, limit = 20) => {
  const res = await fetch(`/admin/payments/recent?page=${page}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};
```

**Fetch wallet balance:**
```javascript
const fetchWalletBalance = async (token) => {
  const res = await fetch('/admin/wallet/balance', {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};
```

**Fetch wallet transactions:**
```javascript
const fetchWalletTransactions = async (token, page = 1, limit = 50, tr_type = null) => {
  let url = `/admin/wallet/transactions?page=${page}&limit=${limit}`;
  if (tr_type) url += `&tr_type=${tr_type}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};
```

**Export payments CSV:**
```javascript
const exportPaymentsCSV = async (token, status = null) => {
  let url = '/admin/payments/export/csv';
  if (status) url += `?status=${status}`;
  window.location.href = url;  // or fetch with Authorization header
};
```

**Export wallet transactions CSV:**
```javascript
const exportWalletCSV = async (token, tr_type = null) => {
  let url = '/admin/wallet/transactions/export/csv';
  if (tr_type) url += `?tr_type=${tr_type}`;
  window.location.href = url;  // or fetch with Authorization header
};
```

File: adminApis.js (added routes near the bottom of the file)
