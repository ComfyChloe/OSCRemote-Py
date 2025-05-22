const WebSocket = require('ws');

class RelayManager {
    constructor(config) {
        this.config = config;
        this.clients = new Map();
        this.messageHandlers = new Set();
        this.connectionAttempts = 0;
        this.maxRetries = config?.relay?.connection?.retries ?? 3;
        this.retryDelay = config?.relay?.connection?.retryDelay ?? 5000;
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
        console.log(`[Relay] New client connected: ${clientId}`);

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'identify') {
                    console.log(`[Relay] Client ${clientId} identified as: ${message.userId}`);
                } else if (message.type === 'osc_tunnel') {
                    console.log(`[Relay] Message from ${clientId}: ${message.address} | [${message.args.join(', ')}]`);
                }
                this.handleMessage(clientId, message);  // Pass parsed message directly
            } catch (err) {
                console.error(`[Relay] Message parse error from ${clientId}:`, err);
            }
        });

        ws.on('close', () => this.handleDisconnect(clientId));
    }

    handleMessage(clientId, message) {
        // Already parsed message, no need to parse again
        this.messageHandlers.forEach(handler => handler(clientId, message));
        
        // Broadcast OSC messages to other clients
        if (message.type === 'osc_tunnel') {
            this.broadcast(message, clientId);
        }
    }

    handleDisconnect(clientId) {
        this.clients.delete(clientId);
        console.log(`[Relay] Client disconnected: ${clientId}`);
    }

    handleClientMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    broadcast(message, excludeId = null) {
        this.clients.forEach((ws, clientId) => {
            if (clientId !== excludeId && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(message));
                } catch (err) {
                    console.error(`[Relay] Broadcast error to ${clientId}:`, err);
                }
            }
        });
    }

    async connect() {
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                console.log('[Relay] Closing existing connection before reconnect');
                this.ws.close();
            }
            this.ws = null;
        }

        return new Promise((resolve, reject) => {
            try {
                const url = `ws://${this.config.relay.host}:${this.config.relay.port}`;
                console.log(`[Relay] Attempting to connect to ${url}`);
                this.ws = new WebSocket(url);

                this.ws.on('open', () => {
                    console.log('[Relay] Successfully connected to server');
                    this.connectionAttempts = 0;
                    resolve();
                });

                this.ws.on('error', (error) => {
                    const errorMessage = `[Relay] Connection error: ${error.message || 'Unknown error'}`;
                    console.error(errorMessage);
                    if (error.code) {
                        console.error(`[Relay] Error code: ${error.code}`);
                    }
                });

                this.ws.on('close', async (code, reason) => {
                    console.log(`[Relay] Connection closed${reason ? `: ${reason}` : ''} (Code: ${code})`);
                    
                    if (this.maxRetries === -1 || this.connectionAttempts < this.maxRetries) {
                        this.connectionAttempts++;
                        const remaining = this.maxRetries === -1 ? 'infinite' : (this.maxRetries - this.connectionAttempts);
                        console.log(`[Relay] Connection attempt ${this.connectionAttempts}${this.maxRetries !== -1 ? `/${this.maxRetries}` : ''}`);
                        console.log(`[Relay] Reconnecting in ${this.retryDelay/1000} seconds... (Attempts remaining: ${remaining})`);
                        
                        setTimeout(async () => {
                            try {
                                await this.connect();
                                this.subscribeToOSC();
                            } catch (err) {
                                if (this.connectionAttempts >= this.maxRetries && this.maxRetries !== -1) {
                                    console.error('[Relay] Final connection attempt failed');
                                    reject(err);
                                }
                            }
                        }, this.retryDelay);
                    } else if (this.maxRetries !== -1) {
                        const error = new Error('Maximum reconnection attempts reached');
                        console.error('[Relay] ' + error.message);
                        reject(error);
                    }
                });
            } catch (err) {
                console.error('[Relay] Setup error:', err.message);
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