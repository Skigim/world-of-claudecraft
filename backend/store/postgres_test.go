package store_test

import (
	"context"
	"testing"
	"time"

	"emberfall-server/store"
)

func TestPostgresStore_Connect(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var s store.Store = store.NewPostgresStore()
	
	err := s.Connect(ctx, "postgres://invalid_user:invalid_pass@localhost:5433/invalid_db?sslmode=disable")
	if err == nil {
		t.Fatal("Expected connection to fail with invalid credentials, but it succeeded")
	}
}
