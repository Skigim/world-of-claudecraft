package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"emberfall-server/server"

	"github.com/gorilla/websocket"
)

func TestWebSocketUpgrade(t *testing.T) {
	s := server.NewServer(nil)
	ts := httptest.NewServer(s.Router())
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	dialer := websocket.DefaultDialer
	conn, resp, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to connect to WebSocket: %v", err)
	}
	defer conn.Close()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("Expected status 101 Switching Protocols, got %d", resp.StatusCode)
	}
}
