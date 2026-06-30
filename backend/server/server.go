package server

import (
	"log"
	"net/http"

	"emberfall-server/store"

	"github.com/gorilla/websocket"
)

// Server handles HTTP and WebSocket networking for Emberfall.
type Server struct {
	store    store.Store
	upgrader websocket.Upgrader
}

// NewServer initializes a new Server.
func NewServer(s store.Store) *Server {
	return &Server{
		store: s,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			// CheckOrigin allows all connections in development.
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}
}

// Router returns an http.Handler with all standard routes attached.
func (s *Server) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	return mux
}

// handleWebSocket upgrades the incoming HTTP connection to a continuous WebSocket.
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	log.Println("New WebSocket connection established from", r.RemoteAddr)
}
