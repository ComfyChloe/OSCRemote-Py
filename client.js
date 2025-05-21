const WebSocket = require('ws');
const fetch = require('node-fetch');  // Add this import

class OSCRelayClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.messageHandlers = new Set();
        this.filters = new Set();
        this.schema = null;
        this.queryPort = 9000;
        this.connected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 3;
    }

    async connect() {
        try {
            this.connectionAttempts++;
            await this.fetchOSCSchema();
            
            return new Promise((resolve, reject) => {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.on('open', () => {
                    console.log('[Client] Connected to OSC relay');
                    this.connected = true;
                    this.connectionAttempts = 0;
                    resolve();
                });

                this.ws.on('error', (error) => {
                    console.error('[Client] WebSocket error:', error.message);
                    if (!this.connected && this.connectionAttempts >= this.maxRetries) {
                        reject(new Error(`Failed to connect after ${this.maxRetries} attempts`));
                    }
                });

                this.ws.on('message', (data) => {
                    const message = JSON.parse(data);
                    if (this.shouldProcessMessage(message)) {
                        this.messageHandlers.forEach(handler => handler(message));
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
            // Continue even if schema fetch fails
            return this.setupWebSocket();
        }
    }

    async fetchOSCSchema() {
        try {
            console.log('[Client] Fetching OSC schema from port', this.queryPort);
            const response = await fetch(`http://localhost:${this.queryPort}/avatar`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.schema = await response.json();
            console.log('[Client] Loaded OSC schema:', Object.keys(this.schema).length, 'endpoints');
        } catch (err) {
            console.warn('[Client] Could not fetch OSC schema:', err.message);
            this.schema = null; // Continue without schema
        }
    }

    send(address, ...args) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = { address, args };
            if (this.shouldProcessMessage(message)) {
                this.ws.send(JSON.stringify(message));
                console.log('[Client] Sent:', message);
            }
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
}

module.exports = OSCRelayClient;
