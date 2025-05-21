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
        this.oscStreamActive = false;
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
                    this.subscribeToOSC();
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
                    switch (message.type) {
                        case 'init':
                            this.handleInit(message);
                            break;
                        case 'schema_update':
                            this.handleSchemaUpdate(message.schema);
                            break;
                        case 'parameter_update':
                            this.handleParameterUpdate(message);
                            break;
                        case 'osc_tunnel':
                            if (this.shouldProcessMessage(message)) {
                                console.log(`[Client] Received tunneled OSC from ${message.source}:`, message.address);
                                this.messageHandlers.forEach(handler => handler(message));
                            }
                            break;
                        default:
                            if (this.shouldProcessMessage(message)) {
                                this.messageHandlers.forEach(handler => handler(message));
                            }
                            break;
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

    subscribeToOSC() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'osc_subscribe' }));
            this.oscStreamActive = true;
            console.log('[Client] Subscribed to OSC stream');
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
            this.schema = null; // Continue without
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
        // Handle initialization logic here
    }

    handleSchemaUpdate(schema) {
        console.log('[Client] Received schema update:', schema);
        this.schema = schema;
    }

    handleParameterUpdate(message) {
        console.log('[Client] Received parameter update:', message);
        // Handle parameter update logic here
    }
}

module.exports = OSCRelayClient;
