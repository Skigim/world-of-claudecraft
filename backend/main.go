package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"emberfall-server/server"
	"emberfall-server/store"
)

func main() {
	log.Println("Starting Emberfall Server...")

	dbStore := store.NewPostgresStore()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	connStr := "postgres://user:password@localhost:5432/worldofclaudecraft?sslmode=disable"
	if err := dbStore.Connect(ctx, connStr); err != nil {
		log.Printf("Warning: Database connection failed (expected if docker is not running): %v", err)
	} else {
		log.Println("Database connected successfully.")
	}
	defer dbStore.Close()

	srv := server.NewServer(dbStore)
	
	port := ":8787"
	log.Printf("Server listening on %s", port)
	if err := http.ListenAndServe(port, srv.Router()); err != nil {
		log.Fatalf("Server exited with error: %v", err)
	}
}
