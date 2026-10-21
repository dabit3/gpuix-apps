package main

import (
	"fmt"
	"net/http"
	"time"
)

type health struct {
	Status  string        `json:"status"`
	Uptime  time.Duration `json:"uptime"`
	Version string        `json:"version"`
}

var started = time.Now()

func main() {
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","uptime":%q,"version":"1.4.2"}`, time.Since(started).Round(time.Second))
	})
	fmt.Println("orbit listening on :8080")
	http.ListenAndServe(":8080", nil)
}
