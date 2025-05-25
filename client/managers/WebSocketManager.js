const WebSocket = require('ws');

class WebSocketManager {
    constructor(config) {
        this.config = config;
        this.messageHandlers = new Set();
        this.connectionAttempts = 0;
        this.maxRetries = config?.relay?.connection?.retries ?? 3;
        this.retryDelay = config?.relay?.connection?.retryDelay ?? 5000;
    }

    async connect() {
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                console.log('[WebSocket] Closing existing connection before reconnect');
                this.ws.close();
            }
            this.ws = null;
        }

        return new Promise((resolve, reject) => {
            try {
                const url = `ws://${this.config.relay.host}:${this.config.relay.port}`;
                console.log(`[WebSocket] Attempting to connect to ${url}`);
                this.ws = new WebSocket(url);
                this.setupHandlers(resolve, reject);
            } catch (err) {
                console.error('[WebSocket] Setup error:', err.message);
                reject(err);
            }
        });
    }

    setupHandlers(resolve, reject) {
        this.ws.on('open', () => {
            console.log('[WebSocket] Successfully connected to server');
            this.connectionAttempts = 0;
            resolve();
        });

        this.ws.on('message', this.handleMessage.bind(this));
        this.ws.on('error', this.handleError.bind(this));
        this.ws.on('close', (code, reason) => this.handleClose(code, reason, resolve, reject));
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            this.messageHandlers.forEach(handler => handler(message));
        } catch (err) {
            console.error('[WebSocket] Message parse error:', err);
        }
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    handleError(error) {
        console.error(`[WebSocket] Connection error: ${error.message}`);
    }

    handleClose(code, reason, resolve, reject) {
        console.log(`[WebSocket] Connection closed${reason ? `: ${reason}` : ''} (Code: ${code})`);
        
        this.connectionAttempts++;
        if (this.maxRetries === -1 || this.connectionAttempts < this.maxRetries) {
            this.scheduleReconnect(resolve, reject);
        } else {
            const error = new Error('Maximum reconnection attempts reached');
            console.error('[WebSocket] ' + error.message);
            reject(error);
        }
    }

    scheduleReconnect(resolve, reject) {
        const remaining = this.maxRetries === -1 ? 'infinite' : (this.maxRetries - this.connectionAttempts);
        console.log(`[WebSocket] Reconnecting in ${this.retryDelay/1000} seconds... (Attempts remaining: ${remaining})`);
        
        setTimeout(async () => {
            try {
                await this.connect();
            } catch (err) {
                reject(err);
            }
        }, this.retryDelay);
    }
}

module.exports = WebSocketManager;
