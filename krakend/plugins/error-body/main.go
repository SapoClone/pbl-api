// Command pbl-error-body is a KrakenD http-server plugin that gives
// gateway-generated failures (empty-body error responses) the platform error
// shape: {timestamp, statusCode, error, message}. Responses that carry a body
// pass through untouched.
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

const pluginName = "pbl-error-body"

// HandlerRegisterer is the symbol KrakenD looks up.
var HandlerRegisterer = registerer(pluginName)

type registerer string

func (r registerer) RegisterHandlers(f func(
	name string,
	handler func(context.Context, map[string]interface{}, http.Handler) (http.Handler, error),
)) {
	f(string(r), r.wrap)
}

// RegisterLogger is required by the loader; the plugin does not log.
func (r registerer) RegisterLogger(interface{}) {}

func (r registerer) wrap(_ context.Context, _ map[string]interface{}, next http.Handler) (http.Handler, error) {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		rw := &recorder{ResponseWriter: w}
		next.ServeHTTP(rw, req)
		rw.finish()
	}), nil
}

type body struct {
	Timestamp  string `json:"timestamp"`
	StatusCode int    `json:"statusCode"`
	Error      string `json:"error"`
	Message    string `json:"message"`
}

// recorder defers the status line until the first body byte (or the end of
// the handler) so an empty error response can still be rewritten.
type recorder struct {
	http.ResponseWriter
	status  int
	flushed bool
}

func (r *recorder) WriteHeader(s int) {
	if r.flushed || r.status != 0 {
		return
	}
	// Informational responses are forwarded as-is.
	if s >= 100 && s < 200 && s != http.StatusSwitchingProtocols {
		r.ResponseWriter.WriteHeader(s)
		return
	}
	r.status = s
}

func (r *recorder) flushHeader() {
	if r.flushed {
		return
	}
	r.flushed = true
	if r.status != 0 {
		r.ResponseWriter.WriteHeader(r.status)
	}
}

func (r *recorder) Write(b []byte) (int, error) {
	if len(b) == 0 {
		return 0, nil
	}
	r.flushHeader()
	return r.ResponseWriter.Write(b)
}

func (r *recorder) Flush() {
	r.flushHeader()
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *recorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func (r *recorder) finish() {
	if r.flushed {
		return
	}
	if r.status < 400 {
		r.flushHeader()
		return
	}
	status, msg := r.status, http.StatusText(r.status)
	switch status {
	case http.StatusInternalServerError:
		status, msg = http.StatusServiceUnavailable, "Upstream service unavailable"
	case http.StatusUnauthorized:
		msg = "Missing or invalid access token"
	}
	r.flushed = true
	h := r.Header()
	h.Del("Content-Length")
	h.Set("Content-Type", "application/json")
	r.ResponseWriter.WriteHeader(status)
	_ = json.NewEncoder(r.ResponseWriter).Encode(body{
		Timestamp:  time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00"),
		StatusCode: status,
		Error:      http.StatusText(status),
		Message:    msg,
	})
}

func main() {}
