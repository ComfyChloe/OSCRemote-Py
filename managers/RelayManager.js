const WebSocket = require('ws');

class RelayManager {
    constructor(config) {
        this.config = config;
        this.clients = new Map();
        this.messageHandlers = new Set();
    }

    startServer() {
        this.server = new WebSocket.Server({ 
            port: this.config.server.port,
            host: this.config.server.host 
        });

        this.server.on('connection', this.handleConnection.bind(this));
    }

    handleConnection(ws, req) {
        const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        this.clients.set(clientId, ws);

        ws.on('message', (data) => this.handleMessage(clientId, data));
        ws.on('close', () => this.handleDisconnect(clientId));
    }

    broadcast(message, excludeId = null) {
        this.clients.forEach((ws, clientId) => {
            if (clientId !== excludeId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        });
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                const url = `ws://${this.config.relay.host}:${this.config.relay.port}`;
                this.ws = new WebSocket(url);

                this.ws.on('open', () => {
                    console.log('[Relay] Connected to server');
                    resolve();
                });

                this.ws.on('message', (data) => {
                    const message = JSON.parse(data);
                    this.messageHandlers.forEach(handler => handler(message));
                });

                this.ws.on('error', reject);
                this.ws.on('close', () => {
                    console.log('[Relay] Disconnected from server');
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    subscribeToOSC() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'osc_subscribe' }));
        }
    }
}

module.exports = RelayManager;