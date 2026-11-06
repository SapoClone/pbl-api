# Workstream E: image uploads saved as S3 links, uploaded with presigned URLs

Not part of the review; the owner's requirement: **images are saved as an S3 link and uploaded with a presigned URL
issued by the API** (the client uploads straight to S3; the API never proxies the bytes in production).
Guide: [uploads](../guides/uploads.md). Contract: catalog `POST /uploads/images`, `/uploads/imports`,
`/uploads/{id}/complete`.

## Rules, as testable sentences

| Id | Rule | Where | Test |
|---|---|---|---|
| E1 | With `UPLOADS_DRIVER=s3`, `POST /uploads/images` and `/imports` return a real presigned S3 PUT URL valid 900 s. It signs `content-type` and `content-length`; the declared type and size are the only ones S3 accepts. | `s3-file-storage.ts` `presignPut` | `s3-file-storage.spec.ts` (signed headers, expiry, size changes the signature) |
| E2 | The object key is built by the server: images `t/<tenant>/p/<uploadId>.<ext>`, imports `t/<tenant>/imports/<uploadId>.csv`. A client never sends a key; unsafe keys are refused. | `uploads.service.ts` `create`, `safe-key.ts` | `file-storage.spec.ts` (unsafe keys), `s3-file-storage.spec.ts` |
| E3 | Type (png/jpeg for images, `text/csv` for imports) and size (1 byte to 5 MB) are validated before a URL is issued. | DTOs, `create` | `app.e2e.spec.ts` |
| E4 | The plan's storage limit is checked before the URL is issued: `used + declared > limit` answers 409 `Q001` with `details {key: storageGb, used, limit, planCode}`. It calls `PlanQuotaService.assertCanStore` only; the counting rule (D34) stays in `plan-quota.service.ts`. | `create` | `catalog-screens.int-spec.ts` (two tests) |
| E5 | `POST /uploads/{id}/complete` HEADs the object. It must exist with the declared type and 1..declared bytes; then the upload is `UPLOADED` with `stored_size`, and usage is announced. Missing, wrong type or wrong size is 400 `UPLOAD_INVALID` (the bad object is deleted). Repeating the call returns the same body. | `uploads.service.ts` `complete` | `catalog-screens.int-spec.ts` (direct uploads) |
| E6 | An upload id of another store is 404. | `complete` (tenant-scoped repository + RLS) | same |
| E7 | `PUT /uploads/{id}/content` works only with the local driver; under `s3` it is 404. | `storeContent` | same |
| E8 | `publicUrl` is `UPLOADS_PUBLIC_BASE_URL/<key>`, else the bucket URL. Product images keep `{key, url, sortOrder}` where `url` is that link. | `S3FileStorage.publicUrl`, `resolveImageIds` | `s3-file-storage.spec.ts`, int spec |
| E9 | Attaching an image needs status UPLOADED (or ATTACHED) and re-checks the object still exists (400 otherwise). | `products.service.ts` `resolveImageIds` | int spec (missing object) |
| E10 | A job (every 10 minutes, one run at a time through an advisory lock) deletes PENDING uploads past `expires_at` and UPLOADED images unattached for 24 h, object first then row, and announces usage for the latter. | `uploads.service.ts` `cleanupUnused`, `uploads-cleanup.job.ts`, migration `1793300000000` | int spec (cleanup) |
| E11 | Removing an image from a product, or deleting the product, deletes the upload row (the bytes leave the plan's count), announces usage, then deletes the object, best effort and logged. | `products.service.ts` `releaseImageUploads`, `deleteObjects` | int spec |
| E12 | `UPLOADS_DRIVER` is `s3` or `local` (default `local`), validated in one place; `s3` without bucket and region stops the service at boot. | `uploads.config.ts` | `s3-file-storage.spec.ts` |

## Decisions and deviations

- **Key layout fix.** The old local key was `t/<tenant>/image/<id>` while `publicUrl` said `/t/<tenant>/p/<id>.ext`; both
  now come from the same key. Existing local rows keep their old key (still valid for `get`).
- **Quota at create and at complete.** `assertCanStore` runs at create (declared size) and again at complete (real size).
  Pending reservations are not counted (D owns the counting), so many parallel pending uploads can overshoot until their
  `complete` calls refuse; objects over the limit stay pending and are removed by the cleanup job.
- **Upload bytes after expiry.** `complete` does not check `expires_at`: S3 already refuses a PUT after the URL expired.
- **`uploadHeaders`** carries `Content-Type` only. `Content-Length` is signed, but browsers and curl set it themselves.
- **Cross-tenant cleanup** reads `uploads` through a SELECT-only RLS policy (`app.uploads_cleanup_scheduler`), like the
  inventory reservation job, then works one row at a time with that row's tenant in `TenantContext`.
- **Raw `images` on a product** (without `imageIds`) is still accepted as given (not backed by an upload). It is a
  pre-existing path; consider closing it.
- **ProductsService** gets the storage as an optional constructor argument (tests that omit it skip the HEAD check).
- Gateway: new route `POST /catalog/api/v1/uploads/{id}/complete` in `krakend/krakend.json`.
- Infra (separate PR in `pbl-infra`, branch `feat/images-bucket-presigned`): bucket CORS, catalog task role policy,
  `UPLOADS_DRIVER=s3`, `UPLOADS_PUBLIC_BASE_URL`, lifecycle rule.
- Dependencies: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` `^3.1129.0` (same line as `client-sqs`); images
  bake `node_modules`, so rebuild them.

## Not verified

No real S3: the adapter is tested with the real SDK presigner (offline, fake credentials) and a faked `send`. A browser
PUT against the CORS rule and CloudFront reads have not been exercised.
