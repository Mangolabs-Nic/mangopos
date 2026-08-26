---
sidebar_position: 3
---

# API reference

## Base URL

| Environment | URL |
| --- | --- |
| Development | `http://localhost:4000/api` |
| Staging | `https://staging-api.mango-labs.dev/api` |
| Production | `https://api.mango-labs.dev/api` |

## Authentication

All API requests require a JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

Token is obtained via Supabase Auth login endpoint.

## Endpoints

### Auth

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/logout` | Invalidate current session |
| GET | `/auth/me` | Get current user profile |

### Sales

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/sales` | List sales (filtered by role) | All |
| GET | `/sales/:id` | Get sale details | All |
| POST | `/sales` | Create new sale | Admin, Cashier |
| POST | `/sales/:id/void` | Void a sale | Admin, Cashier |
| GET | `/sales/:id/receipt` | Generate receipt | All |

### Inventory

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/inventory` | List products with stock | All |
| GET | `/inventory/:id` | Get product details | All |
| POST | `/inventory` | Create product | Admin, Supervisor |
| PUT | `/inventory/:id` | Update product | Admin, Supervisor |
| DELETE | `/inventory/:id` | Delete product | Admin |
| POST | `/inventory/adjust` | Adjust stock level | Admin, Supervisor |

### Expenses

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/expenses` | List expenses | Admin, Supervisor |
| POST | `/expenses` | Create expense | All |
| PUT | `/expenses/:id` | Update expense | Admin, Supervisor |
| DELETE | `/expenses/:id` | Delete expense | Admin |

### Reports

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/reports/sales` | Sales report (date range) | Admin, Supervisor |
| GET | `/reports/sales/export` | Export sales report | Admin, Supervisor |
| GET | `/reports/inventory` | Inventory report | Admin, Supervisor |
| GET | `/reports/financial` | Financial summary | Admin |

### Users

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/users` | List users | Admin |
| POST | `/users` | Create user | Admin |
| PUT | `/users/:id` | Update user | Admin |
| PUT | `/users/:id/role` | Change user role | Admin |
| DELETE | `/users/:id` | Deactivate user | Admin |

### Audit

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/audit` | List audit logs | Admin |
| GET | `/audit/user/:id` | Audit logs for user | Admin, Supervisor |

## Response format

### Success

```json
{
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

### Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      {
        "field": "amount",
        "message": "Amount must be positive"
      }
    ]
  }
}
```

## Rate limits

| Tier | Requests/minute | Burst |
| --- | --- | --- |
| Free | 60 | 10 |
| Paid | 300 | 50 |
