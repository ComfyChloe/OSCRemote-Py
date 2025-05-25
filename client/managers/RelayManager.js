const WebSocket = require('ws');

class RelayManager {
    constructor(config) {
        this.config = config;
        this.connectionAttempts = 0;
        this.maxRetries = config?.relay?.connection?.retries ?? 3;
        this.retryDelay = config?.relay?.connection?.retryDelay ?? 5000;
        this.messageHandlers = new Set();
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

                this.setupWebSocketHandlers(resolve, reject);
            } catch (err) {
                console.error('[Relay] Setup error:', err.message);
                reject(err);
            }
        });
    }

    setupWebSocketHandlers(resolve, reject) {
        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                console.log(`[Relay] Received message from server: ${message.type}`);
                this.handleMessage(message);
            } catch (err) {
                console.error('[Relay] Error processing server message:', err);
            }
        });

        this.ws.on('error', this.handleError.bind(this));
        this.ws.on('close', (code, reason) => this.handleClose(code, reason, resolve, reject));
    }

    handleClientMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    handleError(error) {
        console.error(`[Relay] Connection error: ${error.message || 'Unknown error'}`);
        if (error.code) {
            console.error(`[Relay] Error code: ${error.code}`);
        }
    }

    handleClose(code, reason, resolve, reject) {
        console.log(`[Relay] Connection closed${reason ? `: ${reason}` : ''} (Code: ${code})`);
        
        this.connectionAttempts++;
        if (this.maxRetries === -1 || this.connectionAttempts < this.maxRetries) {
            this.scheduleReconnect(resolve, reject);
        } else {
            const error = new Error('Maximum reconnection attempts reached');
            console.error('[Relay] ' + error.message);
            reject(error);
        }
    }

    scheduleReconnect(resolve, reject) {
        const remaining = this.maxRetries === -1 ? 'infinite' : (this.maxRetries - this.connectionAttempts);
        console.log(`[Relay] Connection attempt ${this.connectionAttempts}${this.maxRetries !== -1 ? `/${this.maxRetries}` : ''}`);
        console.log(`[Relay] Reconnecting in ${this.retryDelay/1000} seconds... (Attempts remaining: ${remaining})`);
        
        setTimeout(async () => {
            try {
                await this.connect();
                this.subscribeToOSC();
            } catch (err) {
                console.error('[Relay] Final connection attempt failed');
                reject(err);
            }
        }, this.retryDelay);
    }

    subscribeToOSC() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'osc_subscribe' }));
        }
    }

    handleMessage(message) {
        this.messageHandlers.forEach(handler => handler(message));
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }
}

module.exports = RelayManager;
