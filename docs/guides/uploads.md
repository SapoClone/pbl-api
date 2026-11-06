# Uploads: images and CSV files go straight to S3

Product images (and import CSVs) are uploaded by the client **directly to S3** with a presigned URL the API issues.
The API never carries the bytes in production. Products store the resulting link (CloudFront or bucket URL), not an
API path. Contract: [catalog, uploads](../specs/2026-10-28-api-contracts/02-catalog-inventory.md).

## The client flow, three steps

```bash
TOKEN=...   # a store member with products.create or products.update
API=https://api.example.com/catalog/api/v1
FILE=binh-xanh.jpg; SIZE=$(stat -c %s "$FILE")

# 1. Register the upload. The plan's storage limit is checked here (409 Q001 when it cannot fit).
curl -s -X POST "$API/uploads/images" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"fileName\":\"$FILE\",\"contentType\":\"image/jpeg\",\"size\":$SIZE}" > up.json
# -> { imageId, uploadUrl, uploadHeaders: {"Content-Type": "image/jpeg"}, publicUrl, expiresAt }

# 2. PUT the file to uploadUrl within 15 minutes, with exactly those headers and exactly SIZE bytes.
curl -s -X PUT "$(jq -r .uploadUrl up.json)" -H 'Content-Type: image/jpeg' --data-binary "@$FILE"

# 3. Tell the API it is there; it checks the object (type and size) and marks it uploaded.
curl -s -X POST "$API/uploads/$(jq -r .imageId up.json)/complete" -H "Authorization: Bearer $TOKEN"

# Then attach: POST/PATCH /products with "imageIds": ["<imageId>"]. The product keeps publicUrl as the image link.
```

The presigned URL signs `Content-Type` and `Content-Length`. A different type or size gets a 403 from S3, and
`complete` would answer 400 and delete the object anyway. The `Authorization` header is **not** sent to S3.

Unattached files are removed: pending uploads after 15 minutes, uploaded but unattached images after 24 hours. Removing
an image from a product, or deleting the product, deletes the object and frees the bytes in the plan.

## Environment (catalog)

| Variable | Meaning |
|---|---|
| `UPLOADS_DRIVER` | `s3` or `local` (default `local`). Production sets `s3`. Validated at boot in `uploads.config.ts`. |
| `AWS_S3_BUCKET`, `AWS_S3_REGION` | The private images bucket (`pbl-images-<account>`). Required for `s3` (region falls back to `AWS_REGION`). |
| `UPLOADS_PUBLIC_BASE_URL` | The CloudFront domain that serves the bucket, for example `https://static.example.com`. Empty means the bucket URL. |
| `AWS_ENDPOINT_URL_S3` | Optional S3 emulator (MinIO, LocalStack); turns on path-style addressing. |
| `CATALOG_UPLOAD_DIR`, `CATALOG_ASSET_BASE_URL` | Local driver only: where files sit on disk and the static base of `publicUrl` (`/static`). |

Credentials are never in env on AWS: the SDK uses the ECS task role. A new dependency pair
(`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) was added, so rebuild the images (`docker compose build`):
they bake `node_modules`.

## Browser access (CORS) and IAM

- The bucket needs a CORS rule for the web app origins: methods `PUT`, `GET`, `HEAD`; allowed headers `Content-Type`,
  `Content-Length`, `x-amz-*`; exposed header `ETag`; a max age. It lives in `pbl-infra/terraform/s3.tf`.
- The catalog task role needs `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `bucket/*` and `s3:ListBucket` on the
  bucket. Presigning needs no call to AWS; the URL is only as strong as the role that signed it.
- Reads go through CloudFront (origin access control), so the bucket stays private.

## The local driver

With `UPLOADS_DRIVER=local` (default, tests, `docker compose`) `uploadUrl` is the API's own
`/catalog/api/v1/uploads/{id}/content`: `PUT` the bytes there with the declared `Content-Type`; that call stores and marks
the upload uploaded in one step (`complete` is then a no-op that returns the same body). Under `s3` that route answers 404.

## Where the code is

`apps/catalog/src/modules/uploads/`: `file-storage.ts` (port, in-memory and disk adapters, driver choice),
`s3-file-storage.ts` (S3 adapter), `uploads.config.ts` (env), `uploads.service.ts` (flow and cleanup),
`uploads-cleanup.job.ts` (schedule). Image release on product edit and delete is in `products.service.ts`.
