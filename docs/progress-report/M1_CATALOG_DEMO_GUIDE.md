# M1 Catalog Microservice — End-to-End Business Demo Guide

This guide provides both automated verification and step-by-step `curl` commands for the **Required End-to-End Business Demo (Section 15)** covering **Tenant A (`Fashion Store A`)** and **Tenant B (`Fashion Store B`)**.

---

## 1. Automated One-Command Demo Verification

The entire Section 15 business demo runs automatically against real PostgreSQL with a non-superuser runtime role (`NOSUPERUSER NOBYPASSRLS`) via:

```bash
npx jest --config libs/events/test/jest-int.json apps/catalog/test/catalog.int-spec.ts
```

---

## 2. Step-by-Step Interactive `curl` Walkthrough

Assume the local stack is running (`docker compose up -d`) or `platform` (`:3000`) and `catalog` (`:3001`) are started, and `TOKEN_A` / `TOKEN_B` are RS256 access tokens for `Fashion Store A` and `Fashion Store B` respectively.

### Step 1: Create Category Hierarchy (`Clothing -> T-Shirts`) in Tenant A
```bash
# 1a. Root category: Clothing (depth = 1)
CLOTHING_ID=$(curl -s -X POST http://localhost:8080/catalog/api/v1/categories \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Clothing"}' | jq -r '.id')

# 1b. Child category: T-Shirts (depth = 2)
TSHIRTS_ID=$(curl -s -X POST http://localhost:8080/catalog/api/v1/categories \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"T-Shirts\", \"parentId\": \"$CLOTHING_ID\"}" | jq -r '.id')

# 1c. Retrieve hierarchical tree
curl -s http://localhost:8080/catalog/api/v1/categories/tree \
  -H "Authorization: Bearer $TOKEN_A" | jq
```

### Step 2: Create Brand `Local Basic` and Attributes `Color` & `Size`
```bash
BRAND_ID=$(curl -s -X POST http://localhost:8080/catalog/api/v1/brands \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Local Basic", "description": "Everyday Vietnamese essentials"}' | jq -r '.id')

COLOR_ATTR_ID=$(curl -s -X POST http://localhost:8080/catalog/api/v1/attributes \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Color"}' | jq -r '.id')

BLACK_VAL_ID=$(curl -s -X POST "http://localhost:8080/catalog/api/v1/attributes/$COLOR_ATTR_ID/values" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d '{"value": "Black"}' | jq -r '.id')

WHITE_VAL_ID=$(curl -s -X POST "http://localhost:8080/catalog/api/v1/attributes/$COLOR_ATTR_ID/values" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d '{"value": "White"}' | jq -r '.id')

SIZE_ATTR_ID=$(curl -s -X POST http://localhost:8080/catalog/api/v1/attributes \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Size"}' | jq -r '.id')

SIZE_M_ID=$(curl -s -X POST "http://localhost:8080/catalog/api/v1/attributes/$SIZE_ATTR_ID/values" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d '{"value": "M"}' | jq -r '.id')

SIZE_L_ID=$(curl -s -X POST "http://localhost:8080/catalog/api/v1/attributes/$SIZE_ATTR_ID/values" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d '{"value": "L"}' | jq -r '.id')
```

### Step 3: Create Product `Áo thun cotton nam` & Generate 4 Cartesian Variants
```bash
PRODUCT_ID=$(curl -s -X POST http://localhost:8080/catalog/api/v1/products \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Áo thun cotton nam\",
    \"categoryId\": \"$TSHIRTS_ID\",
    \"brandId\": \"$BRAND_ID\",
    \"baseUnit\": \"Cái\",
    \"status\": \"ACTIVE\",
    \"createDefaultVariant\": false
  }" | jq -r '.id')

# Generate 4 variants: TSHIRT-BLK-M, TSHIRT-BLK-L, TSHIRT-WHT-M, TSHIRT-WHT-L
curl -s -X POST "http://localhost:8080/catalog/api/v1/products/$PRODUCT_ID/variants/generate" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{
    \"skuPrefix\": \"TSHIRT\",
    \"basePrice\": \"199000.00\",
    \"axes\": [
      {\"attributeId\": \"$COLOR_ATTR_ID\", \"valueIds\": [\"$BLACK_VAL_ID\", \"$WHITE_VAL_ID\"]},
      {\"attributeId\": \"$SIZE_ATTR_ID\", \"valueIds\": [\"$SIZE_M_ID\", \"$SIZE_L_ID\"]}
    ],
    \"skuTokens\": {\"Black\": \"BLK\", \"White\": \"WHT\", \"M\": \"M\", \"L\": \"L\"}
  }" | jq
```

### Step 4: Configure Default Price List & Resolve Sellable Price
```bash
PRICE_LIST_ID=$(curl -s -X POST http://localhost:8080/catalog/api/v1/price-lists \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Default Retail", "currency": "VND", "isDefault": true, "status": "ACTIVE"}' | jq -r '.id')

# Lookup TSHIRT-BLK-M and resolve its price
VARIANT_BLK_M_ID=$(curl -s "http://localhost:8080/catalog/api/v1/products/lookup?sku=TSHIRT-BLK-M" \
  -H "Authorization: Bearer $TOKEN_A" | jq -r '.variant.id')

curl -s -X PUT "http://localhost:8080/catalog/api/v1/price-lists/$PRICE_LIST_ID/items" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"items\": [{\"variantId\": \"$VARIANT_BLK_M_ID\", \"price\": \"179000.00\"}]}" | jq

curl -s "http://localhost:8080/catalog/api/v1/variants/$VARIANT_BLK_M_ID/price" \
  -H "Authorization: Bearer $TOKEN_A" | jq
```

### Step 5: Verify Tenant B Isolation & Same-SKU Reuse
```bash
# Tenant B sees 0 products from Tenant A
curl -s "http://localhost:8080/catalog/api/v1/products" \
  -H "Authorization: Bearer $TOKEN_B" | jq

# Tenant B cannot access Tenant A's product (returns 404 PRODUCT_NOT_FOUND)
curl -i "http://localhost:8080/catalog/api/v1/products/$PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN_B"

# Tenant B can reuse SKU 'TSHIRT-BLK-M' in its own store (returns 201 Created)
curl -s -X POST http://localhost:8080/catalog/api/v1/products \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Áo thun Tenant B",
    "baseUnit": "Cái",
    "status": "ACTIVE",
    "createDefaultVariant": true,
    "defaultSkuCode": "TSHIRT-BLK-M",
    "defaultBasePrice": "219000.00"
  }' | jq
```
