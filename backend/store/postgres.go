package store

import (
	"context"
	"fmt"
	"github.com/jmoiron/sqlx"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// PostgresStore implements the Store interface using PostgreSQL.
type PostgresStore struct {
	db *sqlx.DB
}

// NewPostgresStore creates a new instance of PostgresStore.
func NewPostgresStore() *PostgresStore {
	return &PostgresStore{}
}

// Connect establishes the connection to the Postgres database.
func (p *PostgresStore) Connect(ctx context.Context, connectionString string) error {
	db, err := sqlx.ConnectContext(ctx, "pgx", connectionString)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	p.db = db
	return nil
}

// Close closes the database connection.
func (p *PostgresStore) Close() error {
	if p.db != nil {
		return p.db.Close()
	}
	return nil
}

// GetAccountByUsername retrieves an account by its unique username.
func (p *PostgresStore) GetAccountByUsername(ctx context.Context, username string) (*Account, error) {
	var account Account
	err := p.db.GetContext(ctx, &account, "SELECT id, username, password_hash FROM accounts WHERE username = $1", username)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}
	return &account, nil
}
