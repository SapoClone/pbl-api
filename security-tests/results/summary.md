# Kết quả chạy bộ kiểm thử bảo mật — secmwc1avod307c

- Thời điểm: 2026-11-11T11:27:16.239Z
- Chế độ: direct (http://127.0.0.1:3000/api/v1)
- Tổng test case: **118** — Passed **116**, Failed **2** (known defects: 2), Unexpected: **0**
- Assertion: 353 (failed: 3) — Requests: 118 — Thời gian: 7.30s

| Nhóm | Tổng | Passed | Failed |
| --- | ---: | ---: | ---: |
| 00 — Preconditions | 4 | 4 | 0 |
| 01 — Authentication | 9 | 9 | 0 |
| 02 — RBAC matrix | 30 | 30 | 0 |
| 03 — RBAC bổ sung | 16 | 16 | 0 |
| 04 — Vai trò & 400/409 | 19 | 19 | 0 |
| 05 — Tenant isolation | 20 | 20 | 0 |
| 06 — Branch isolation | 10 | 10 | 0 |
| 07 — Revocation | 10 | 8 | 2 |

| Test case | HTTP | Kết quả | Ghi chú |
| --- | ---: | --- | --- |
| TC-SEC-SETUP-01 | 200 | Passed |  |
| TC-SEC-SETUP-02 | 200 | Passed |  |
| TC-SEC-SETUP-03 | 200 | Passed |  |
| TC-SEC-SETUP-04 | 200 | Passed |  |
| TC-SEC-AUTH-01 | 401 | Passed |  |
| TC-SEC-AUTH-02 | 401 | Passed |  |
| TC-SEC-AUTH-03 | 401 | Passed |  |
| TC-SEC-AUTH-04 | 401 | Passed |  |
| TC-SEC-AUTH-05 | 401 | Passed |  |
| TC-SEC-AUTH-06 | 200 | Passed |  |
| TC-SEC-AUTH-07 | 401 | Passed |  |
| TC-SEC-AUTH-08 | 200 | Passed |  |
| TC-SEC-AUTH-09 | 401 | Passed |  |
| TC-SEC-RBAC-01 | 200 | Passed |  |
| TC-SEC-RBAC-02 | 200 | Passed |  |
| TC-SEC-RBAC-03 | 200 | Passed |  |
| TC-SEC-RBAC-04 | 200 | Passed |  |
| TC-SEC-RBAC-05 | 403 | Passed |  |
| TC-SEC-RBAC-06 | 200 | Passed |  |
| TC-SEC-RBAC-07 | 422 | Passed |  |
| TC-SEC-RBAC-08 | 422 | Passed |  |
| TC-SEC-RBAC-09 | 403 | Passed |  |
| TC-SEC-RBAC-10 | 403 | Passed |  |
| TC-SEC-RBAC-11 | 403 | Passed |  |
| TC-SEC-RBAC-12 | 403 | Passed |  |
| TC-SEC-RBAC-13 | 404 | Passed |  |
| TC-SEC-RBAC-14 | 404 | Passed |  |
| TC-SEC-RBAC-15 | 403 | Passed |  |
| TC-SEC-RBAC-16 | 403 | Passed |  |
| TC-SEC-RBAC-17 | 403 | Passed |  |
| TC-SEC-RBAC-18 | 403 | Passed |  |
| TC-SEC-RBAC-19 | 404 | Passed |  |
| TC-SEC-RBAC-20 | 404 | Passed |  |
| TC-SEC-RBAC-21 | 403 | Passed |  |
| TC-SEC-RBAC-22 | 403 | Passed |  |
| TC-SEC-RBAC-23 | 403 | Passed |  |
| TC-SEC-RBAC-24 | 403 | Passed |  |
| TC-SEC-RBAC-25 | 404 | Passed |  |
| TC-SEC-RBAC-26 | 404 | Passed |  |
| TC-SEC-RBAC-27 | 403 | Passed |  |
| TC-SEC-RBAC-28 | 403 | Passed |  |
| TC-SEC-RBAC-29 | 403 | Passed |  |
| TC-SEC-RBAC-30 | 403 | Passed |  |
| TC-SEC-X-01 | 201 | Passed |  |
| TC-SEC-X-02 | 200 | Passed |  |
| TC-SEC-X-03 | 403 | Passed |  |
| TC-SEC-X-04 | 422 | Passed |  |
| TC-SEC-X-05 | 403 | Passed |  |
| TC-SEC-X-06 | 404 | Passed |  |
| TC-SEC-X-07 | 403 | Passed |  |
| TC-SEC-X-08 | 200 | Passed |  |
| TC-SEC-X-09 | 403 | Passed |  |
| TC-SEC-X-10 | 403 | Passed |  |
| TC-SEC-X-11 | 403 | Passed |  |
| TC-SEC-X-12 | 403 | Passed |  |
| TC-SEC-X-13 | 422 | Passed |  |
| TC-SEC-X-14 | 403 | Passed |  |
| TC-SEC-X-15 | 200 | Passed |  |
| TC-SEC-X-16 | 403 | Passed |  |
| TC-SEC-ROLE-01 | 201 | Passed |  |
| TC-SEC-ROLE-02 | 409 | Passed |  |
| TC-SEC-ROLE-03 | 400 | Passed |  |
| TC-SEC-ROLE-04 | 400 | Passed |  |
| TC-SEC-ROLE-05 | 400 | Passed |  |
| TC-SEC-ROLE-06 | 400 | Passed |  |
| TC-SEC-ROLE-07 | 409 | Passed |  |
| TC-SEC-ROLE-08 | 204 | Passed |  |
| TC-SEC-ROLE-09 | 403 | Passed |  |
| TC-SEC-ROLE-10 | 403 | Passed |  |
| TC-SEC-ROLE-11 | 400 | Passed |  |
| TC-SEC-ROLE-12 | 400 | Passed |  |
| TC-SEC-ROLE-13 | 400 | Passed |  |
| TC-SEC-ROLE-14 | 400 | Passed |  |
| TC-SEC-ROLE-15 | 400 | Passed |  |
| TC-SEC-ROLE-16 | 400 | Passed |  |
| TC-SEC-ROLE-17 | 400 | Passed |  |
| TC-SEC-ROLE-18 | 422 | Passed |  |
| TC-SEC-ROLE-19 | 400 | Passed |  |
| TC-SEC-TEN-01 | 404 | Passed |  |
| TC-SEC-TEN-02 | 404 | Passed |  |
| TC-SEC-TEN-03 | 404 | Passed |  |
| TC-SEC-TEN-04 | 404 | Passed |  |
| TC-SEC-TEN-05 | 404 | Passed |  |
| TC-SEC-TEN-06 | 404 | Passed |  |
| TC-SEC-TEN-07 | 404 | Passed |  |
| TC-SEC-TEN-08 | 404 | Passed |  |
| TC-SEC-TEN-09 | 404 | Passed |  |
| TC-SEC-TEN-10 | 404 | Passed |  |
| TC-SEC-TEN-11 | 404 | Passed |  |
| TC-SEC-TEN-12 | 404 | Passed |  |
| TC-SEC-TEN-13 | 200 | Passed |  |
| TC-SEC-TEN-14 | 200 | Passed |  |
| TC-SEC-TEN-15 | 200 | Passed |  |
| TC-SEC-TEN-16 | 404 | Passed |  |
| TC-SEC-TEN-17 | 201 | Passed |  |
| TC-SEC-TEN-18 | 200 | Passed |  |
| TC-SEC-TEN-19 | 404 | Passed |  |
| TC-SEC-TEN-20 | 200 | Passed |  |
| TC-SEC-BRA-01 | 200 | Passed |  |
| TC-SEC-BRA-02 | 404 | Passed |  |
| TC-SEC-BRA-03 | 404 | Passed |  |
| TC-SEC-BRA-04 | 200 | Passed |  |
| TC-SEC-BRA-05 | 404 | Passed |  |
| TC-SEC-BRA-06 | 200 | Passed |  |
| TC-SEC-BRA-07 | 403 | Passed |  |
| TC-SEC-BRA-08 | 200 | Passed |  |
| TC-SEC-BRA-09 | 200 | Passed |  |
| TC-SEC-BRA-10 | 200 | Passed |  |
| TC-SEC-REV-01 | 422 | Passed |  |
| TC-SEC-REV-02 | 200 | Passed |  |
| TC-SEC-REV-03 | 422 | Failed (known defect) | HTTP 403: expected response to have status code 403 but got 422<br>Từ chối 403 Forbidden: expected 'Unprocessable Entity' to deeply equal 'Forbidden' |
| TC-SEC-REV-04 | 200 | Passed |  |
| TC-SEC-REV-05 | 403 | Passed |  |
| TC-SEC-REV-06 | 200 | Passed |  |
| TC-SEC-REV-07 | 200 | Passed |  |
| TC-SEC-REV-08 | 200 | Failed (known defect) | HTTP 404: expected response to have status code 404 but got 200 |
| TC-SEC-REV-09 | 200 | Passed |  |
| TC-SEC-REV-10 | 404 | Passed |  |