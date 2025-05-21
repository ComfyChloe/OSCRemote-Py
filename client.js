const WebSocket = require('ws');

class OSCRelayClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.messageHandlers = new Set();
        this.filters = new Set();
        this.connected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 5;
    }

    async connect() {
        try {
            return new Promise((resolve, reject) => {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.on('open', () => {
                    console.log('[Client] Connected to OSC relay');
                    this.connected = true;
                    this.connectionAttempts = 0;
                    resolve();
                });

                this.ws.on('message', (data) => {
                    const message = JSON.parse(data);
                    if (this.shouldProcessMessage(message)) {
                        this.messageHandlers.forEach(handler => handler(message));
                    }
                });

                this.ws.on('error', (error) => {
                    console.error('[Client] WebSocket error:', error.message);
                    if (!this.connected && this.connectionAttempts >= this.maxRetries) {
                        reject(new Error(`Failed to connect after ${this.maxRetries} attempts`));
                    }
                });

                this.ws.on('close', () => {
                    console.log('[Client] Disconnected from OSC relay');
                    this.connected = false;
                    if (this.connectionAttempts < this.maxRetries) {
                        console.log(`[Client] Retrying connection (${this.connectionAttempts}/${this.maxRetries})...`);
                        setTimeout(() => this.connect(), 2000);
                    }
                });
            });
        } catch (err) {
            console.error('[Client] Connection failed:', err.message);
            throw err;
        }
    }

    subscribeToOSC() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'osc_subscribe' }));
            console.log('[Client] Subscribed to OSC stream');
        }
    }

    send(address, ...args) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = {
                type: 'osc_tunnel',
                address,
                args
            };
            if (this.shouldProcessMessage(message)) {
                this.ws.send(JSON.stringify(message));
                console.log('[Client] Sent OSC message:', address);
            }
        }
    }

    updateParameter(address, value) {
        if (this.connected) {
            this.ws.send(JSON.stringify({
                type: 'parameter_update',
                address,
                value
            }));
        }
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    addFilter(pattern) {
        this.filters.add(pattern);
    }

    shouldProcessMessage(message) {
        if (this.filters.size === 0) return true;
        return Array.from(this.filters).some(pattern => 
            message.address.match(new RegExp(pattern)));
    }

    handleInit(message) {
        console.log('[Client] Received init message:', message);
    }

    handleParameterUpdate(message) {
        console.log('[Client] Received parameter update:', message);
    }
}

module.exports = OSCRelayClient;
