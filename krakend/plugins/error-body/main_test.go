package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func serve(t *testing.T, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	wrapped, err := HandlerRegisterer.wrap(context.Background(), nil, h)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	return rec
}

type errBody struct {
	Timestamp  string `json:"timestamp"`
	StatusCode int    `json:"statusCode"`
	Error      string `json:"error"`
	Message    string `json:"message"`
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) errBody {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q", ct)
	}
	var b errBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("body not JSON: %v (%q)", err, rec.Body.String())
	}
	if _, err := time.Parse("2006-01-02T15:04:05.000Z07:00", b.Timestamp); err != nil {
		t.Fatalf("timestamp %q: %v", b.Timestamp, err)
	}
	return b
}

func TestEmpty500BecomesStructured503(t *testing.T) {
	rec := serve(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) })
	if rec.Code != 503 {
		t.Fatalf("status = %d", rec.Code)
	}
	b := decode(t, rec)
	if b.StatusCode != 503 || b.Error != "Service Unavailable" || b.Message != "Upstream service unavailable" {
		t.Fatalf("body = %+v", b)
	}
}

func TestEmpty401BecomesStructured401(t *testing.T) {
	rec := serve(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) })
	if rec.Code != 401 {
		t.Fatalf("status = %d", rec.Code)
	}
	b := decode(t, rec)
	if b.StatusCode != 401 || b.Error != "Unauthorized" || b.Message != "Missing or invalid access token" {
		t.Fatalf("body = %+v", b)
	}
}

func TestEmpty403AndOthers(t *testing.T) {
	rec := serve(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) })
	if b := decode(t, rec); rec.Code != 403 || b.Message != "Forbidden" {
		t.Fatalf("403: %d %+v", rec.Code, b)
	}
	rec = serve(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(502) })
	if b := decode(t, rec); rec.Code != 502 || b.Message != "Bad Gateway" {
		t.Fatalf("502: %d %+v", rec.Code, b)
	}
}

func TestErrorWithBodyPassesThrough(t *testing.T) {
	const payload = `{"statusCode":404,"message":"nope"}`
	rec := serve(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(404)
		_, _ = w.Write([]byte(payload))
	})
	if rec.Code != 404 || rec.Body.String() != payload {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestSuccessUnchanged(t *testing.T) {
	rec := serve(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-A", "b")
		_, _ = w.Write([]byte("ok"))
	})
	if rec.Code != 200 || rec.Body.String() != "ok" || rec.Header().Get("X-A") != "b" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	rec = serve(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	if rec.Code != 204 || rec.Body.Len() != 0 {
		t.Fatalf("204: %d %q", rec.Code, rec.Body.String())
	}
}

func TestServiceError500WithBodyStays500(t *testing.T) {
	const payload = `{"statusCode":500,"message":"boom"}`
	rec := serve(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte(payload))
	})
	if rec.Code != 500 || rec.Body.String() != payload {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}
