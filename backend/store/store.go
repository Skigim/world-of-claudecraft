package store

import (
	"context"
)

// Account represents a user account in the Emberfall database.
type Account struct {
	ID           int    `db:"id"`
	Username     string `db:"username"`
	PasswordHash string `db:"password_hash"`
}

// Character represents a player character in the Emberfall database.
type Character struct {
	ID        int    `db:"id"`
	AccountID int    `db:"account_id"`
	Name      string `db:"name"`
	Class     string `db:"class"`
	Realm     string `db:"realm"`
	Level     int    `db:"level"`
}

// Store defines the data access layer interface, allowing for future database swaps.
type Store interface {
	// Connect establishes the database connection.
	Connect(ctx context.Context, connectionString string) error
	// Close terminates the database connection.
	Close() error
	// GetAccountByUsername retrieves an account by its unique username.
	GetAccountByUsername(ctx context.Context, username string) (*Account, error)
}
